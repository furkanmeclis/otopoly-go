package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	_ "time/tzdata" // Europe/Istanbul in minimal containers.

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Errors.
var (
	ErrInvalidRequest = errors.New("invalid request")
	ErrNotFound       = errors.New("not found")
)

// Tuning.
const (
	DefaultMaxAttempts int32 = 5
	sweepBatchSize     int32 = 100
	sweepMaxBatches          = 20
	stuckAfter               = 10 * time.Minute
)

// retryBackoff is the delay before attempt n+1 (n = attempts so far).
var retryBackoff = []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, 3 * time.Hour}

// BackoffFor returns the retry delay after `attempts` attempts.
func BackoffFor(attempts int32) time.Duration {
	if attempts <= 0 {
		return retryBackoff[0]
	}
	if int(attempts) > len(retryBackoff) {
		return retryBackoff[len(retryBackoff)-1]
	}
	return retryBackoff[attempts-1]
}

// Service is the central notification service.
type Service struct {
	q      Querier
	inbox  Inbox
	msg    Messenger
	store  storage.Driver
	log    *slog.Logger
	now    func() time.Time
	loc    *time.Location
	appURL string
	guards map[string]Guard
}

// New builds the service. inbox / msg may be nil (channel then unavailable).
func New(q Querier, inbox Inbox, msg Messenger, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Service{q: q, inbox: inbox, msg: msg, log: log, now: time.Now, loc: loc, guards: map[string]Guard{}}
}

// SetStorage enables uploading attachment bytes (required for Schedule with Data).
func (s *Service) SetStorage(store storage.Driver) *Service { s.store = store; return s }

// SetAppURL sets the public frontend origin used for absolute links in e-mail/WhatsApp.
func (s *Service) SetAppURL(u string) *Service { s.appURL = strings.TrimRight(u, "/"); return s }

// SetClock overrides time (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// RegisterGuard installs a send-time eligibility check for a subject type.
func (s *Service) RegisterGuard(subjectType string, g Guard) { s.guards[subjectType] = g }

func (s *Service) orgID(ctx context.Context, explicit int64) (int64, error) {
	sc, ok := orgctx.ScopeFrom(ctx)
	switch {
	case explicit > 0 && ok && sc.InternalID > 0 && sc.InternalID != explicit:
		return 0, fmt.Errorf("%w: organization mismatch", ErrInvalidRequest)
	case explicit > 0:
		return explicit, nil
	case ok && sc.InternalID > 0:
		return sc.InternalID, nil
	}
	return 0, fmt.Errorf("%w: organization context required", ErrInvalidRequest)
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidRequest, fmt.Sprintf(format, args...))
}

// DedupeKey builds the default key: kind, subject, recipient and fire minute.
func DedupeKey(n model.Notification, fireAt time.Time) string {
	r := n.Recipient
	var who string
	switch {
	case r.UserID > 0:
		who = fmt.Sprintf("u%d", r.UserID)
	case r.CustomerID > 0:
		who = fmt.Sprintf("c%d", r.CustomerID)
	case r.Phone != "":
		who = "p" + digits(r.Phone)
	default:
		who = "e" + strings.ToLower(strings.TrimSpace(r.Email))
	}
	return fmt.Sprintf("%s:%s:%d:%s:%d", n.Kind, n.SubjectType, n.SubjectID, who, fireAt.UTC().Unix()/60)
}

func digits(v string) string {
	var b strings.Builder
	for _, r := range v {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Schedule stores a notification that fires at FireAt. Same dedupe key →
// no second row (Result.Duplicate); a cancelled slot is revived.
func (s *Service) Schedule(ctx context.Context, sn model.ScheduledNotification) (model.Result, error) {
	row, dup, err := s.insert(ctx, sn)
	if err != nil {
		return model.Result{}, err
	}
	return model.Result{UUID: row.Uuid, Status: row.Status, Duplicate: dup, LastError: row.LastError}, nil
}

// Dispatch sends now: the notification is stored (dedupe applies) and
// delivered inline. Failed channels are retried by the scheduler sweep.
func (s *Service) Dispatch(ctx context.Context, n model.Notification) (model.Result, error) {
	row, dup, err := s.insert(ctx, model.ScheduledNotification{Notification: n, FireAt: s.now()})
	if err != nil {
		return model.Result{}, err
	}
	res := model.Result{UUID: row.Uuid, Status: row.Status, Duplicate: dup, LastError: row.LastError}
	if dup {
		res.Delivered = row.DeliveredChannels
		return res, nil
	}
	claimed, err := s.q.ClaimScheduledNotificationByID(ctx, row.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return res, nil // a sweeper got it first
	}
	if err != nil {
		return res, err
	}
	final := s.process(ctx, claimed)
	res.Status, res.Delivered, res.LastError = final.Status, final.DeliveredChannels, final.LastError
	return res, nil
}

// CancelBySubject cancels all pending notifications of a subject in the
// organization from ctx (orgctx). Sent rows are kept for dedupe/audit.
func (s *Service) CancelBySubject(ctx context.Context, subjectType string, subjectID int64) (int64, error) {
	orgID, err := s.orgID(ctx, 0)
	if err != nil {
		return 0, err
	}
	return s.q.CancelScheduledNotificationsBySubject(ctx, db.CancelScheduledNotificationsBySubjectParams{
		OrganizationID: orgID, SubjectType: subjectType, SubjectID: subjectID,
	})
}

// PendingFireTimes returns pending fire times per subject for a page (one query).
func (s *Service) PendingFireTimes(ctx context.Context, subjectType string, ids []int64) (map[int64][]time.Time, error) {
	out := map[int64][]time.Time{}
	if len(ids) == 0 {
		return out, nil
	}
	orgID, err := s.orgID(ctx, 0)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListPendingRemindersForSubjects(ctx, db.ListPendingRemindersForSubjectsParams{
		OrganizationID: orgID, SubjectType: subjectType, SubjectIds: ids,
	})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.SubjectID] = append(out[r.SubjectID], r.FireAt.Time)
	}
	return out, nil
}

func (s *Service) insert(ctx context.Context, sn model.ScheduledNotification) (db.ScheduledNotification, bool, error) {
	n := sn.Notification
	orgID, err := s.orgID(ctx, n.OrgID)
	if err != nil {
		return db.ScheduledNotification{}, false, err
	}
	spec, ok := msgtemplate.Lookup(n.Kind)
	if !ok {
		return db.ScheduledNotification{}, false, invalid("unknown notification kind %q", n.Kind)
	}
	if strings.TrimSpace(n.SubjectType) == "" {
		return db.ScheduledNotification{}, false, invalid("subject_type is required")
	}
	if sn.FireAt.IsZero() {
		return db.ScheduledNotification{}, false, invalid("fire_at is required")
	}
	for _, ch := range n.Channels {
		if !spec.HasChannel(ch) {
			return db.ScheduledNotification{}, false, invalid("channel %q not supported for %s", ch, n.Kind)
		}
	}
	r := n.Recipient
	p := db.InsertScheduledNotificationParams{
		OrganizationID: orgID, Kind: n.Kind, SubjectType: n.SubjectType, SubjectID: n.SubjectID,
		RecipientPhone: strings.TrimSpace(r.Phone), RecipientEmail: strings.TrimSpace(r.Email),
		Channels: n.Channels, Locale: n.Locale, ActionUrl: n.ActionURL,
		FireAt:      pgtype.Timestamptz{Time: sn.FireAt.UTC(), Valid: true},
		MaxAttempts: n.MaxAttempts,
	}
	if p.Channels == nil {
		p.Channels = []string{}
	}
	if p.MaxAttempts <= 0 {
		p.MaxAttempts = DefaultMaxAttempts
	}
	switch {
	case r.UserID > 0:
		// Tenant isolation: user recipients must be members of the org.
		if _, err := s.q.GetNotificationRecipientUser(ctx, db.GetNotificationRecipientUserParams{OrganizationID: orgID, UserID: r.UserID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return db.ScheduledNotification{}, false, invalid("recipient user is not a member of this organization")
			}
			return db.ScheduledNotification{}, false, err
		}
		p.RecipientUserID = pgtype.Int8{Int64: r.UserID, Valid: true}
	case r.CustomerID > 0:
		if _, err := s.q.GetNotificationRecipientCustomer(ctx, db.GetNotificationRecipientCustomerParams{OrganizationID: orgID, ID: r.CustomerID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return db.ScheduledNotification{}, false, invalid("recipient customer not found")
			}
			return db.ScheduledNotification{}, false, err
		}
		p.RecipientCustomerID = pgtype.Int8{Int64: r.CustomerID, Valid: true}
	case p.RecipientPhone == "" && p.RecipientEmail == "":
		return db.ScheduledNotification{}, false, invalid("recipient is required")
	}
	vars := n.Vars
	if vars == nil {
		vars = map[string]string{}
	}
	if p.Vars, err = json.Marshal(vars); err != nil {
		return db.ScheduledNotification{}, false, err
	}
	if a := n.Attachment; a != nil {
		key := a.ObjectKey
		if key == "" && len(a.Data) > 0 {
			if s.store == nil {
				return db.ScheduledNotification{}, false, invalid("attachment bytes need object storage")
			}
			if key, err = uploadAttachment(ctx, s.store, orgID, a); err != nil {
				return db.ScheduledNotification{}, false, err
			}
		}
		if key != "" {
			p.Attachment, _ = json.Marshal(model.Attachment{ObjectKey: key, FileName: a.FileName, MimeType: a.MimeType})
		}
	}
	if n.CreatedBy > 0 {
		p.CreatedBy = pgtype.Int8{Int64: n.CreatedBy, Valid: true}
	}
	key := strings.TrimSpace(n.DedupeKey)
	if key == "" {
		key = DedupeKey(n, sn.FireAt)
	}
	if len(key) > 255 {
		return db.ScheduledNotification{}, false, invalid("dedupe_key too long")
	}
	p.DedupeKey = key
	row, err := s.q.InsertScheduledNotification(ctx, p)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, gerr := s.q.GetScheduledNotificationByKey(ctx, db.GetScheduledNotificationByKeyParams{OrganizationID: orgID, DedupeKey: key})
		if gerr != nil {
			return db.ScheduledNotification{}, false, gerr
		}
		return existing, true, nil
	}
	if err != nil {
		return db.ScheduledNotification{}, false, fmt.Errorf("insert scheduled notification: %w", err)
	}
	return row, false, nil
}

// ProcessDue is the scheduler sweep: releases stuck rows, then claims due rows
// in batches (FOR UPDATE SKIP LOCKED) and delivers them.
func (s *Service) ProcessDue(ctx context.Context) error {
	now := s.now().UTC()
	if n, err := s.q.ReleaseStuckScheduledNotifications(ctx, pgtype.Timestamptz{Time: now.Add(-stuckAfter), Valid: true}); err != nil {
		return fmt.Errorf("release stuck notifications: %w", err)
	} else if n > 0 {
		s.log.Warn("notifycenter_released_stuck", "count", n)
	}
	for range sweepMaxBatches {
		rows, err := s.q.ClaimDueScheduledNotifications(ctx, db.ClaimDueScheduledNotificationsParams{
			Now: pgtype.Timestamptz{Time: now, Valid: true}, LimitCount: sweepBatchSize,
		})
		if err != nil {
			return fmt.Errorf("claim due notifications: %w", err)
		}
		for _, row := range rows {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			s.process(ctx, row)
		}
		if int32(len(rows)) < sweepBatchSize {
			return nil
		}
	}
	return nil
}
