package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	notifmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/pushtext"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// recipient is the resolved addressable recipient of a row.
type recipient struct {
	userID int64
	name   string
	email  string
	phone  string
	locale string
	isUser bool
}

// process delivers one claimed (processing) row and records the outcome.
// It never returns an error: failures become retries / failed status.
func (s *Service) process(ctx context.Context, row db.ScheduledNotification) db.ScheduledNotification {
	ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: row.OrganizationID})
	delivered, lastErr, retry, noChannel := s.deliver(ctx, row)
	var (
		out db.ScheduledNotification
		err error
	)
	switch {
	case noChannel != "":
		out, err = s.q.MarkScheduledNotificationCancelled(ctx, db.MarkScheduledNotificationCancelledParams{ID: row.ID, LastError: noChannel})
	case retry:
		out, err = s.q.MarkScheduledNotificationRetry(ctx, db.MarkScheduledNotificationRetryParams{
			ID:                row.ID,
			NextAttemptAt:     pgtype.Timestamptz{Time: s.now().UTC().Add(BackoffFor(row.Attempts)), Valid: true},
			DeliveredChannels: delivered,
			LastError:         lastErr,
		})
		s.log.Warn("notifycenter_delivery_retry", "id", row.ID, "kind", row.Kind, "attempts", row.Attempts, "error", lastErr)
	default:
		out, err = s.q.MarkScheduledNotificationSent(ctx, db.MarkScheduledNotificationSentParams{
			ID: row.ID, DeliveredChannels: delivered, LastError: lastErr,
		})
	}
	if err != nil {
		s.log.Error("notifycenter_status_update_failed", "id", row.ID, "error", err)
		row.DeliveredChannels, row.LastError = delivered, lastErr
		return row
	}
	s.afterSend(ctx, out, noChannel == reasonIneligible)
	return out
}

// reasonIneligible is the cancel reason when a Guard / Preparer declines.
const reasonIneligible = "subject no longer eligible"

// afterSend runs the subject's SentHook (panics are contained).
func (s *Service) afterSend(ctx context.Context, row db.ScheduledNotification, skipped bool) {
	h, ok := s.hooks[row.SubjectType]
	if !ok {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			s.log.Error("notifycenter_sent_hook_panic", "id", row.ID, "panic", r)
		}
	}()
	h(ctx, SentEvent{
		OrgID: row.OrganizationID, UUID: row.Uuid, Kind: row.Kind,
		SubjectType: row.SubjectType, SubjectID: row.SubjectID, Status: row.Status,
		Delivered: row.DeliveredChannels, LastError: row.LastError, Skipped: skipped,
	})
}

// deliver sends every channel not yet delivered. retry=true when at least one
// channel failed with an error; noChannel is set when nothing can be sent.
func (s *Service) deliver(ctx context.Context, row db.ScheduledNotification) (delivered []string, lastErr string, retry bool, noChannel string) {
	delivered = append([]string{}, row.DeliveredChannels...)
	if g, ok := s.guards[row.SubjectType]; ok {
		okSend, err := g(ctx, row.OrganizationID, row.SubjectID)
		if err != nil {
			return delivered, "guard: " + err.Error(), true, ""
		}
		if !okSend {
			return delivered, "", false, reasonIneligible
		}
	}
	var fresh map[string]string
	if p, ok := s.preps[row.SubjectType]; ok {
		prep, err := p(ctx, row.OrganizationID, row.SubjectID)
		if err != nil {
			return delivered, "prepare: " + err.Error(), true, ""
		}
		if prep.Skip {
			return delivered, "", false, reasonIneligible
		}
		fresh = prep.Vars
	}
	spec, ok := msgtemplate.Lookup(row.Kind)
	if !ok {
		return delivered, "", false, "unknown kind"
	}
	org, err := s.q.GetNotificationOrganization(ctx, row.OrganizationID)
	if err != nil {
		return delivered, "organization: " + err.Error(), true, ""
	}
	rcpt, err := s.resolveRecipient(ctx, row)
	if errors.Is(err, pgx.ErrNoRows) {
		return delivered, "", false, "recipient not found"
	}
	if err != nil {
		return delivered, "recipient: " + err.Error(), true, ""
	}
	channels, err := s.resolveChannels(ctx, row, spec, rcpt)
	if err != nil {
		return delivered, "channels: " + err.Error(), true, ""
	}
	if len(channels) == 0 {
		return delivered, "", false, "no deliverable channel"
	}
	locale := row.Locale
	if locale == "" {
		locale = rcpt.locale
	}
	if locale != "en" {
		locale = "tr"
	}
	vars := map[string]string{}
	_ = json.Unmarshal(row.Vars, &vars)
	for k, v := range fresh {
		vars[k] = v
	}
	vars = s.enrichVars(vars, locale, org, rcpt, row)

	var att model.Attachment
	if len(row.Attachment) > 0 {
		_ = json.Unmarshal(row.Attachment, &att)
	}
	done := map[string]bool{}
	for _, ch := range delivered {
		done[ch] = true
	}
	attempted := 0
	var errs []string
	for _, ch := range channels {
		if done[ch] {
			continue
		}
		tpl, found, err := s.resolveTemplate(ctx, row.OrganizationID, row.Kind, ch, locale)
		if err != nil {
			errs = append(errs, ch+": "+err.Error())
			attempted++
			continue
		}
		if !found || !tpl.Active {
			continue // passive or missing template: channel disabled
		}
		attempted++
		title := msgtemplate.Render(tpl.Subject, vars)
		body := msgtemplate.Render(tpl.Body, vars)
		if err := s.send(ctx, row, ch, rcpt, title, body, att, vars); err != nil {
			errs = append(errs, ch+": "+err.Error())
			continue
		}
		delivered = append(delivered, ch)
	}
	if len(errs) > 0 {
		return delivered, strings.Join(errs, "; "), true, ""
	}
	if attempted == 0 && len(delivered) == len(row.DeliveredChannels) {
		return delivered, "", false, "no active template for selected channels"
	}
	return delivered, "", false, ""
}

func (s *Service) resolveTemplate(ctx context.Context, orgID int64, kind, ch, locale string) (Template, bool, error) {
	if s.msg == nil {
		return Template{}, false, nil
	}
	return s.msg.ResolveTemplate(ctx, orgID, kind, ch, locale)
}

func (s *Service) resolveRecipient(ctx context.Context, row db.ScheduledNotification) (recipient, error) {
	r := recipient{phone: row.RecipientPhone, email: row.RecipientEmail}
	switch {
	case row.RecipientUserID.Valid:
		u, err := s.q.GetNotificationRecipientUser(ctx, db.GetNotificationRecipientUserParams{
			OrganizationID: row.OrganizationID, UserID: row.RecipientUserID.Int64,
		})
		if err != nil {
			return r, err
		}
		r.isUser, r.userID = true, u.ID
		r.name = strings.TrimSpace(u.Name + " " + u.Surname)
		r.locale = u.Locale
		if r.email == "" {
			r.email = u.Email
		}
		if r.phone == "" {
			if ms, err := s.q.GetNotificationMemberSettings(ctx, db.GetNotificationMemberSettingsParams{
				UserID: u.ID, OrganizationID: row.OrganizationID,
			}); err == nil {
				r.phone = ms.Phone
			}
		}
	case row.RecipientCustomerID.Valid:
		c, err := s.q.GetNotificationRecipientCustomer(ctx, db.GetNotificationRecipientCustomerParams{
			OrganizationID: row.OrganizationID, ID: row.RecipientCustomerID.Int64,
		})
		if err != nil {
			return r, err
		}
		r.name = c.Name
		if r.phone == "" {
			r.phone = c.Phone
		}
		if r.email == "" {
			r.email = c.Email
		}
	}
	return r, nil
}

// resolveChannels picks channels: explicit row channels, else member
// preferences (staff) or organization rules (customers); then drops channels
// the recipient cannot receive.
func (s *Service) resolveChannels(ctx context.Context, row db.ScheduledNotification, spec msgtemplate.TypeSpec, r recipient) ([]string, error) {
	var wanted []string
	switch {
	case len(row.Channels) > 0:
		wanted = row.Channels
	case r.isUser:
		prefs, err := s.userPrefs(ctx, r.userID, row.OrganizationID, row.Kind, r.phone)
		if err != nil {
			return nil, err
		}
		for _, ch := range model.AllChannels {
			if prefs.Enabled(ch) {
				wanted = append(wanted, ch)
			}
		}
	default:
		if s.msg != nil {
			rules, err := s.msg.RuleChannels(ctx, row.OrganizationID, row.Kind)
			if err != nil {
				return nil, err
			}
			wanted = rules
		}
	}
	return FilterChannels(wanted, spec, r.isUser, r.phone, r.email), nil
}

// FilterChannels keeps supported channels the recipient can receive.
func FilterChannels(wanted []string, spec msgtemplate.TypeSpec, isUser bool, phone, email string) []string {
	var out []string
	seen := map[string]bool{}
	for _, ch := range wanted {
		if seen[ch] || !spec.HasChannel(ch) {
			continue
		}
		seen[ch] = true
		switch ch {
		case model.ChannelInapp:
			if !isUser {
				continue
			}
		case model.ChannelEmail:
			if strings.TrimSpace(email) == "" {
				continue
			}
		case model.ChannelWhatsApp, model.ChannelSMS:
			if strings.TrimSpace(phone) == "" {
				continue
			}
		}
		out = append(out, ch)
	}
	return out
}

func (s *Service) send(ctx context.Context, row db.ScheduledNotification, ch string, r recipient, title, body string, att model.Attachment, vars map[string]string) error {
	payload := map[string]any{
		"kind": row.Kind, "subject_type": row.SubjectType, "notification_uuid": row.Uuid.String(),
	}
	if ch == model.ChannelInapp {
		// Lock-screen-safe variables for the mobile push mirror (pushtext).
		pv := map[string]string{}
		for _, k := range pushtext.SafeVars {
			if v := vars[k]; v != "" {
				pv[k] = v
			}
		}
		if len(pv) > 0 {
			payload["push_vars"] = pv
		}
	}
	switch ch {
	case model.ChannelInapp, model.ChannelEmail:
		if s.inbox == nil {
			return errors.New("inbox unavailable")
		}
		in := notifmodel.EnqueueInput{
			TenantID: &row.OrganizationID, Channels: []string{ch}, Priority: notifmodel.PriorityNormal,
			Title: title, Body: body, Payload: payload, SourceEvent: "notifycenter." + row.Kind,
			Language: r.locale,
		}
		if r.isUser {
			uid := r.userID
			in.UserID = &uid
		}
		if ch == model.ChannelInapp && row.ActionUrl != "" {
			u := row.ActionUrl
			in.ActionURL = &u
		}
		if ch == model.ChannelEmail {
			addr := r.email
			in.Recipient = &addr
		}
		_, err := s.inbox.Enqueue(ctx, in)
		return err
	case model.ChannelWhatsApp, model.ChannelSMS:
		if s.msg == nil {
			return errors.New("messaging unavailable")
		}
		id := row.Uuid
		return s.msg.QueueSend(ctx, OutboundMessage{
			OrgID: row.OrganizationID, Kind: row.Kind, Channel: ch, Phone: r.phone, Body: body,
			AttachmentKey: att.ObjectKey, AttachmentName: att.FileName, AttachmentMime: att.MimeType,
			SubjectType: row.SubjectType, SubjectUUID: &id, ScheduledNotificationID: row.ID,
			Vars: vars,
		})
	}
	return fmt.Errorf("unknown channel %s", ch)
}

// enrichVars adds organization/recipient values and localizes the generic
// time helpers: due_at_iso → due_at + due_in, valid_until_iso → valid_until.
func (s *Service) enrichVars(vars map[string]string, locale string, org db.GetNotificationOrganizationRow, r recipient, row db.ScheduledNotification) map[string]string {
	setIfEmpty := func(k, v string) {
		if vars[k] == "" {
			vars[k] = v
		}
	}
	setIfEmpty("company_name", org.Name)
	setIfEmpty("business_name", vars["company_name"])
	if row.RecipientCustomerID.Valid {
		setIfEmpty("customer_name", r.name)
	}
	if r.isUser {
		setIfEmpty("assignee_name", r.name)
	}
	if iso := vars["due_at_iso"]; iso != "" {
		if due, err := time.Parse(time.RFC3339, iso); err == nil {
			vars["due_at"] = FormatDateTime(due.In(s.loc), locale)
			ref := s.now()
			if row.FireAt.Valid && row.FireAt.Time.After(ref) {
				ref = row.FireAt.Time
			}
			vars["due_in"] = HumanizeUntil(due.Sub(ref), locale)
		}
	}
	if iso := vars["valid_until_iso"]; iso != "" {
		if t, err := time.Parse(time.RFC3339, iso); err == nil {
			vars["valid_until"] = FormatDate(t.In(s.loc), locale)
		} else if d, err := time.Parse("2006-01-02", iso); err == nil {
			vars["valid_until"] = FormatDate(d, locale)
		}
	}
	if row.ActionUrl != "" && s.appURL != "" {
		link := s.appURL + row.ActionUrl
		if row.SubjectType == model.SubjectTodo {
			setIfEmpty("todo_link", link)
		}
		setIfEmpty("app_link", link)
	}
	return vars
}

var enMonths = []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

// FormatDate formats a date per locale.
func FormatDate(t time.Time, locale string) string {
	if locale == "en" {
		return fmt.Sprintf("%s %d, %d", enMonths[t.Month()-1], t.Day(), t.Year())
	}
	return t.Format("02.01.2006")
}

// FormatDateTime formats date + time per locale.
func FormatDateTime(t time.Time, locale string) string {
	return FormatDate(t, locale) + " " + t.Format("15:04")
}

// HumanizeUntil renders a lead time ("15 dakika sonra" / "in 15 minutes").
func HumanizeUntil(d time.Duration, locale string) string {
	mins := int(d.Round(time.Minute) / time.Minute)
	tr := locale != "en"
	switch {
	case mins <= 0:
		if tr {
			return "şimdi"
		}
		return "now"
	case mins < 60:
		if tr {
			return fmt.Sprintf("%d dakika sonra", mins)
		}
		return plural(mins, "in %d minute", "in %d minutes")
	case mins < 24*60:
		h := (mins + 30) / 60
		if tr {
			return fmt.Sprintf("%d saat sonra", h)
		}
		return plural(h, "in %d hour", "in %d hours")
	default:
		days := (mins + 12*60) / (24 * 60)
		if tr {
			return fmt.Sprintf("%d gün sonra", days)
		}
		return plural(days, "in %d day", "in %d days")
	}
}

func plural(n int, one, many string) string {
	if n == 1 {
		return fmt.Sprintf(one, n)
	}
	return fmt.Sprintf(many, n)
}

func uploadAttachment(ctx context.Context, store storage.Driver, orgID int64, a *model.Attachment) (string, error) {
	name := path.Base(strings.ReplaceAll(strings.TrimSpace(a.FileName), "\\", "/"))
	if name == "" || name == "." || name == "/" || name == ".." {
		name = "document"
	}
	mime := a.MimeType
	if mime == "" {
		mime = "application/octet-stream"
	}
	key := fmt.Sprintf("notifications/attachments/%d/%s/%s", orgID, uuid.NewString(), name)
	if err := store.Upload(ctx, storage.File{Body: bytes.NewReader(a.Data), Size: int64(len(a.Data)), ContentType: mime, Filename: name}, key); err != nil {
		return "", fmt.Errorf("attachment upload: %w", err)
	}
	return key, nil
}
