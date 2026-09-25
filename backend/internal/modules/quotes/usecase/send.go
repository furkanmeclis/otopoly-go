package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Reminder kinds and the hour (Europe/Istanbul) they fire at.
const (
	ReminderBefore3d = "before_3d"
	ReminderBefore1d = "before_1d"
	ReminderLastDay  = "last_day"
	ReminderCustom   = "custom"
	reminderHour     = 10
)

type plannedReminder struct {
	kind   string
	offset int
	fireAt time.Time
}

// planReminders turns requested kinds into fire times; past times are
// dropped (a reminder that can no longer fire is meaningless).
func (s *Service) planReminders(validUntil pgtype.Date, in []ReminderInput) ([]plannedReminder, error) {
	out := make([]plannedReminder, 0, len(in))
	seen := map[string]bool{}
	now := s.now()
	for _, r := range in {
		kind := strings.TrimSpace(r.Kind)
		var day time.Time
		offset := 0
		switch kind {
		case ReminderBefore3d, ReminderBefore1d, ReminderLastDay:
			if !validUntil.Valid {
				return nil, fmt.Errorf("%w: reminders before expiry need valid_until", ErrInvalidRequest)
			}
			offset = map[string]int{ReminderBefore3d: 3, ReminderBefore1d: 1, ReminderLastDay: 0}[kind]
			v := validUntil.Time
			day = time.Date(v.Year(), v.Month(), v.Day()-offset, 0, 0, 0, 0, s.loc)
		case ReminderCustom:
			if r.Date == nil {
				return nil, fmt.Errorf("%w: custom reminder needs a date", ErrInvalidRequest)
			}
			d, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(*r.Date), s.loc)
			if err != nil {
				return nil, fmt.Errorf("%w: invalid reminder date", ErrInvalidRequest)
			}
			if validUntil.Valid {
				v := validUntil.Time
				last := time.Date(v.Year(), v.Month(), v.Day(), 0, 0, 0, 0, s.loc)
				if d.After(last) {
					return nil, fmt.Errorf("%w: reminder date is after valid_until", ErrInvalidRequest)
				}
				offset = int(last.Sub(d).Hours() / 24)
			}
			day = d
		default:
			return nil, fmt.Errorf("%w: unknown reminder kind %q", ErrInvalidRequest, kind)
		}
		fire := time.Date(day.Year(), day.Month(), day.Day(), reminderHour, 0, 0, 0, s.loc)
		key := kind + fire.Format(time.RFC3339)
		if seen[key] || !fire.After(now) {
			continue
		}
		seen[key] = true
		out = append(out, plannedReminder{kind: kind, offset: offset, fireAt: fire})
	}
	return out, nil
}

// replaceRemindersTx cancels open reminders and inserts the planned ones.
func (s *Service) replaceRemindersTx(ctx context.Context, q *db.Queries, row db.Quote, plan []plannedReminder) ([]db.QuoteReminder, []db.QuoteReminder, error) {
	cancelled, err := q.CancelOpenQuoteReminders(ctx, row.ID)
	if err != nil {
		return nil, nil, err
	}
	created := make([]db.QuoteReminder, 0, len(plan))
	for _, p := range plan {
		rem, err := q.CreateQuoteReminder(ctx, db.CreateQuoteReminderParams{
			OrganizationID: row.OrganizationID, QuoteID: row.ID, Kind: p.kind,
			OffsetDays: int32(p.offset), FireAt: pgtype.Timestamptz{Time: p.fireAt, Valid: true},
		})
		if err != nil {
			return nil, nil, err
		}
		created = append(created, rem)
	}
	return cancelled, created, nil
}

// replanReminders recomputes open relative reminders after valid_until changed.
func (s *Service) replanReminders(ctx context.Context, q *db.Queries, row db.Quote) ([]db.QuoteReminder, []db.QuoteReminder, error) {
	existing, err := q.ListQuoteReminders(ctx, row.ID)
	if err != nil {
		return nil, nil, err
	}
	var req []ReminderInput
	for _, r := range existing {
		if r.Status != "pending" && r.Status != "scheduled" {
			continue
		}
		in := ReminderInput{Kind: r.Kind}
		if r.Kind == ReminderCustom {
			d := r.FireAt.Time.In(s.loc).Format("2006-01-02")
			in.Date = &d
		}
		req = append(req, in)
	}
	if len(req) == 0 {
		return nil, nil, nil
	}
	plan, err := s.planReminders(row.ValidUntil, req)
	if err != nil {
		// valid_until cleared or moved before a custom date: drop them all.
		plan = nil
	}
	return s.replaceRemindersTx(ctx, q, row, plan)
}

func toSeamReminder(row db.Quote, r db.QuoteReminder) QuoteReminder {
	return QuoteReminder{
		ReminderID: r.ID, ReminderUUID: r.Uuid, OrganizationID: r.OrganizationID, QuoteID: row.ID,
		QuoteUUID: row.Uuid, Kind: r.Kind, OffsetDays: int(r.OffsetDays), FireAt: r.FireAt.Time,
		ExternalRef: r.ExternalRef,
	}
}

// afterReminderChange notifies the scheduler after commit (fail-soft; the
// outcome is stored on the reminder row).
func (s *Service) afterReminderChange(ctx context.Context, row db.Quote, cancelled, planned []db.QuoteReminder) {
	for _, r := range cancelled {
		if err := s.scheduler.Cancel(ctx, toSeamReminder(row, r)); err != nil && !errors.Is(err, ErrNotConfigured) {
			s.log.Warn("quote_reminder_cancel_failed", "reminder", r.Uuid, "error", err)
		}
	}
	for _, r := range planned {
		ref, err := s.scheduler.Schedule(ctx, toSeamReminder(row, r))
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		if uerr := s.q.SetQuoteReminderScheduled(ctx, db.SetQuoteReminderScheduledParams{
			Ok: err == nil, ExternalRef: ref, Error: msg, ID: r.ID,
		}); uerr != nil {
			s.log.Warn("quote_reminder_update_failed", "reminder", r.Uuid, "error", uerr)
		}
	}
}

// SetReminders replaces the quote's pending reminders.
func (s *Service) SetReminders(ctx context.Context, id uuid.UUID, in []ReminderInput) (Detail, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return Detail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	row, err := q.GetQuoteRowByUUIDForUpdate(ctx, db.GetQuoteRowByUUIDForUpdateParams{Uuid: id, OrganizationID: scope.InternalID})
	if err != nil {
		if isNoRows(err) {
			return Detail{}, ErrNotFound
		}
		return Detail{}, err
	}
	if isTerminal(row.Status) {
		return Detail{}, fmt.Errorf("%w: a %s quote cannot have reminders", ErrConflict, row.Status)
	}
	plan, err := s.planReminders(row.ValidUntil, in)
	if err != nil {
		return Detail{}, err
	}
	cancelled, created, err := s.replaceRemindersTx(ctx, q, row, plan)
	if err != nil {
		return Detail{}, err
	}
	if err := s.addEvent(ctx, q, row.OrganizationID, row.ID, eventOpts{
		kind: "reminders_set", from: row.Status, to: row.Status, body: fmt.Sprintf("%d", len(created)),
	}); err != nil {
		return Detail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	s.afterReminderChange(ctx, row, cancelled, created)
	return s.loadDetail(ctx, row)
}

// buildMessage assembles the messenger payload (renders the PDF when possible).
func (s *Service) buildMessage(ctx context.Context, row db.Quote) (QuoteMessage, error) {
	org, err := s.q.GetOrganizationByID(ctx, row.OrganizationID)
	if err != nil {
		return QuoteMessage{}, err
	}
	refs, err := s.q.GetQuoteRefs(ctx, row.ID)
	if err != nil {
		return QuoteMessage{}, err
	}
	msg := QuoteMessage{
		OrganizationID: org.ID, OrganizationUUID: org.Uuid, OrganizationName: org.Name,
		QuoteID: row.ID, QuoteUUID: row.Uuid, QuoteNumber: row.Number, Status: row.Status,
		CustomerUUID: refs.CustomerUuid, CustomerName: refs.CustomerName, CustomerPhone: refs.CustomerPhone,
		VehiclePlate: row.VehiclePlate, VehicleLabel: row.VehicleLabel,
		GrandTotal: money(row.GrandTotal), Currency: row.Currency,
		ShareURL: s.ShareURL(row.ShareToken), PDFFileName: row.Number + ".pdf", Locale: "tr",
	}
	if row.ValidUntil.Valid {
		v := row.ValidUntil.Time
		msg.ValidUntil = &v
	}
	pdf, key, perr := s.ensurePDF(ctx, row)
	if perr != nil {
		msg.PDFError = perr.Error()
	} else {
		msg.PDF, msg.PDFObjectKey = pdf, key
	}
	return msg, nil
}

// Send generates the PDF, hands it to the QuoteMessenger, moves a draft to
// sent, records a delivery row and (optionally) replaces reminders. The
// quote is marked sent even when the messenger fails — the delivery row
// carries the error and the UI offers retry plus manual fallbacks.
func (s *Service) Send(ctx context.Context, id uuid.UUID, in SendInput) (SendResult, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return SendResult{}, err
	}
	channel := strings.TrimSpace(in.Channel)
	if channel == "" {
		channel = "whatsapp"
	}
	if len(channel) > 16 {
		return SendResult{}, fmt.Errorf("%w: invalid channel", ErrInvalidRequest)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SendResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	cur, err := q.GetQuoteRowByUUIDForUpdate(ctx, db.GetQuoteRowByUUIDForUpdateParams{Uuid: id, OrganizationID: scope.InternalID})
	if err != nil {
		if isNoRows(err) {
			return SendResult{}, ErrNotFound
		}
		return SendResult{}, err
	}
	if !isSendable(cur.Status) {
		return SendResult{}, fmt.Errorf("%w: a %s quote cannot be sent", ErrConflict, cur.Status)
	}
	var plan []plannedReminder
	if in.Reminders != nil {
		if plan, err = s.planReminders(cur.ValidUntil, in.Reminders); err != nil {
			return SendResult{}, err
		}
	}
	refs, err := q.GetQuoteRefs(ctx, cur.ID)
	if err != nil {
		return SendResult{}, err
	}
	delivery, err := q.CreateQuoteDelivery(ctx, db.CreateQuoteDeliveryParams{
		OrganizationID: scope.InternalID, QuoteID: cur.ID, Channel: channel,
		Recipient: refs.CustomerPhone, CreatedBy: actorID(ctx),
	})
	if err != nil {
		return SendResult{}, err
	}
	row := cur
	var cancelled, created []db.QuoteReminder
	if cur.Status == StatusDraft {
		if row, cancelled, err = s.transitionTx(ctx, q, cur, StatusSent, transitionOpts{}); err != nil {
			return SendResult{}, err
		}
	} else if err := s.addEvent(ctx, q, cur.OrganizationID, cur.ID, eventOpts{kind: "resent", from: cur.Status, to: cur.Status}); err != nil {
		return SendResult{}, err
	}
	if in.Reminders != nil {
		c2, cr, err := s.replaceRemindersTx(ctx, q, row, plan)
		if err != nil {
			return SendResult{}, err
		}
		cancelled = append(cancelled, c2...)
		created = cr
	}
	if err := tx.Commit(ctx); err != nil {
		return SendResult{}, err
	}
	s.afterReminderChange(ctx, row, cancelled, created)

	delivery = s.deliver(ctx, row, delivery)
	s.record(ctx, "tenant.quote.send", row.Uuid, map[string]any{
		"number": row.Number, "channel": channel, "delivery_status": delivery.Status,
	})
	detail, err := s.loadDetail(ctx, row)
	if err != nil {
		return SendResult{}, err
	}
	return SendResult{Quote: detail, Delivery: mapDelivery(delivery)}, nil
}

// deliver calls the messenger and stores the outcome on the delivery row.
func (s *Service) deliver(ctx context.Context, row db.Quote, d db.QuoteDelivery) db.QuoteDelivery {
	status, errMsg, ref := "sent", "", ""
	msg, err := s.buildMessage(ctx, row)
	if err == nil {
		if strings.TrimSpace(msg.CustomerPhone) == "" {
			err = errors.New("customer has no phone number")
		} else {
			var res QuoteSendResult
			res, err = s.messenger.SendQuote(ctx, msg)
			ref = res.ProviderRef
		}
	}
	if err != nil {
		status, errMsg = "failed", err.Error()
	}
	updated, uerr := s.q.FinishQuoteDelivery(ctx, db.FinishQuoteDeliveryParams{
		Status: status, Error: truncate(errMsg, 1000), ProviderRef: truncate(ref, 200),
		Recipient: truncate(msg.CustomerPhone, 64), ID: d.ID,
	})
	if uerr != nil {
		s.log.Warn("quote_delivery_update_failed", "delivery", d.Uuid, "error", uerr)
		return d
	}
	return updated
}

// RetryDelivery re-attempts a failed delivery.
func (s *Service) RetryDelivery(ctx context.Context, quoteUUID, deliveryUUID uuid.UUID) (SendResult, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return SendResult{}, err
	}
	row, err := s.q.GetQuoteRowByUUID(ctx, db.GetQuoteRowByUUIDParams{Uuid: quoteUUID, OrganizationID: scope.InternalID})
	if err != nil {
		if isNoRows(err) {
			return SendResult{}, ErrNotFound
		}
		return SendResult{}, err
	}
	d, err := s.q.GetQuoteDeliveryByUUID(ctx, db.GetQuoteDeliveryByUUIDParams{
		Uuid: deliveryUUID, QuoteID: row.ID, OrganizationID: scope.InternalID,
	})
	if err != nil {
		if isNoRows(err) {
			return SendResult{}, ErrNotFound
		}
		return SendResult{}, err
	}
	if d.Status != "failed" {
		return SendResult{}, fmt.Errorf("%w: only failed deliveries can be retried", ErrConflict)
	}
	if row.Status != StatusSent && row.Status != StatusViewed {
		return SendResult{}, fmt.Errorf("%w: a %s quote cannot be sent", ErrConflict, row.Status)
	}
	d = s.deliver(ctx, row, d)
	s.record(ctx, "tenant.quote.send", row.Uuid, map[string]any{"number": row.Number, "retry": true, "delivery_status": d.Status})
	detail, err := s.loadDetail(ctx, row)
	if err != nil {
		return SendResult{}, err
	}
	return SendResult{Quote: detail, Delivery: mapDelivery(d)}, nil
}

// ErrReminderNotApplicable: the quote is no longer open; the reminder was cancelled.
var ErrReminderNotApplicable = errors.New("reminder no longer applicable")

// ReminderMessage is called by the reminder integration when a reminder
// fires (no tenant context needed). It returns the message payload, or
// ErrReminderNotApplicable (and cancels the reminder) when the quote is no
// longer sent/viewed — accepted, rejected, cancelled and expired quotes are
// never reminded.
func (s *Service) ReminderMessage(ctx context.Context, reminderUUID uuid.UUID) (QuoteMessage, QuoteReminder, error) {
	rem, err := s.q.GetQuoteReminderByUUID(ctx, reminderUUID)
	if err != nil {
		if isNoRows(err) {
			return QuoteMessage{}, QuoteReminder{}, ErrNotFound
		}
		return QuoteMessage{}, QuoteReminder{}, err
	}
	row, err := s.q.GetQuoteRowByID(ctx, rem.QuoteID)
	if err != nil {
		return QuoteMessage{}, QuoteReminder{}, err
	}
	seam := toSeamReminder(row, rem)
	if rem.Status != "pending" && rem.Status != "scheduled" {
		return QuoteMessage{}, seam, ErrReminderNotApplicable
	}
	if row.Status != StatusSent && row.Status != StatusViewed {
		_, _ = s.q.FinishQuoteReminder(ctx, db.FinishQuoteReminderParams{Status: "cancelled", Error: "quote is " + row.Status, ID: rem.ID})
		return QuoteMessage{}, seam, ErrReminderNotApplicable
	}
	msg, err := s.buildMessage(ctx, row)
	return msg, seam, err
}

// CompleteReminder records the outcome of a fired reminder (sendErr nil = sent).
func (s *Service) CompleteReminder(ctx context.Context, reminderUUID uuid.UUID, sendErr error) error {
	rem, err := s.q.GetQuoteReminderByUUID(ctx, reminderUUID)
	if err != nil {
		if isNoRows(err) {
			return ErrNotFound
		}
		return err
	}
	status, msg := "sent", ""
	if sendErr != nil {
		status, msg = "failed", truncate(sendErr.Error(), 1000)
	}
	if _, err := s.q.FinishQuoteReminder(ctx, db.FinishQuoteReminderParams{Status: status, Error: msg, ID: rem.ID}); err != nil && !isNoRows(err) {
		return err
	}
	kind := "reminder_sent"
	if sendErr != nil {
		kind = "reminder_failed"
	}
	return s.addEvent(ctx, s.q, rem.OrganizationID, rem.QuoteID, eventOpts{kind: kind, body: rem.Kind + " " + msg, channel: "system"})
}
