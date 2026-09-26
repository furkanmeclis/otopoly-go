package salesflow

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	"github.com/google/uuid"
)

var _ quotesusecase.ReminderScheduler = (*Integration)(nil)

// ReminderKind maps a quote reminder preset to the template type: the
// day-before and last-day presets use quote.expiring, the rest quote.reminder.
func ReminderKind(kind string) string {
	switch kind {
	case quotesusecase.ReminderBefore1d, quotesusecase.ReminderLastDay:
		return KindQuoteExpiring
	}
	return KindQuoteReminder
}

// Schedule implements quotesusecase.ReminderScheduler. Vars are refreshed at
// send time by PrepareReminder; the returned reference is the notification
// uuid (stored as the reminder's external_ref).
func (x *Integration) Schedule(ctx context.Context, r quotesusecase.QuoteReminder) (string, error) {
	ctx = withOrg(ctx, r.OrganizationID)
	q, err := x.store.GetQuoteRowByUUID(ctx, db.GetQuoteRowByUUIDParams{Uuid: r.QuoteUUID, OrganizationID: r.OrganizationID})
	if err != nil {
		return "", fmt.Errorf("load quote: %w", err)
	}
	vars := map[string]string{"quote_number": q.Number}
	if q.ValidUntil.Valid {
		vars["valid_until_iso"] = dateOnly(q.ValidUntil.Time)
	}
	res, err := x.center.Schedule(ctx, centermodel.ScheduledNotification{
		Notification: centermodel.Notification{
			OrgID: r.OrganizationID, Kind: ReminderKind(r.Kind),
			SubjectType: SubjectQuoteReminder, SubjectID: r.ReminderID,
			Recipient: centermodel.Recipient{CustomerID: q.CustomerID},
			Channels:  []string{centermodel.ChannelWhatsApp},
			Vars:      vars,
			DedupeKey: fmt.Sprintf("%s:%s", SubjectQuoteReminder, r.ReminderUUID),
		},
		FireAt: r.FireAt,
	})
	if err != nil {
		return "", err
	}
	return res.UUID.String(), nil
}

// Cancel implements quotesusecase.ReminderScheduler.
func (x *Integration) Cancel(ctx context.Context, r quotesusecase.QuoteReminder) error {
	_, err := x.center.CancelBySubject(withOrg(ctx, r.OrganizationID), SubjectQuoteReminder, r.ReminderID)
	return err
}

// PrepareReminder is the center Preparer for quote reminders: it skips (and
// the quotes module cancels) reminders of quotes that are no longer sent /
// viewed, refreshes the vars from the current quote and requires a
// connected WhatsApp line (otherwise the center retries with backoff).
func (x *Integration) PrepareReminder(ctx context.Context, orgID, reminderID int64) (centerusecase.Prepared, error) {
	if x.quotes == nil {
		return centerusecase.Prepared{}, errors.New("quotes integration not configured")
	}
	id, err := x.quotes.ReminderUUID(ctx, orgID, reminderID)
	if errors.Is(err, quotesusecase.ErrNotFound) {
		return centerusecase.Prepared{Skip: true}, nil
	}
	if err != nil {
		return centerusecase.Prepared{}, err
	}
	msg, _, err := x.quotes.ReminderMessage(ctx, id)
	if errors.Is(err, quotesusecase.ErrReminderNotApplicable) || errors.Is(err, quotesusecase.ErrNotFound) {
		return centerusecase.Prepared{Skip: true}, nil
	}
	if err != nil {
		return centerusecase.Prepared{}, err
	}
	if msg.OrganizationID != orgID {
		return centerusecase.Prepared{Skip: true}, nil
	}
	if err := x.whatsAppReady(ctx, orgID); err != nil {
		return centerusecase.Prepared{}, err
	}
	return centerusecase.Prepared{Vars: quoteVars(msg)}, nil
}

// ReminderSent is the center SentHook: it records the attempt's final
// outcome on the quote reminder (retries in progress are left alone).
func (x *Integration) ReminderSent(ctx context.Context, ev centerusecase.SentEvent) {
	if ev.Skipped || x.quotes == nil {
		return
	}
	var sendErr error
	switch ev.Status {
	case centermodel.StatusSent:
		if !slices.Contains(ev.Delivered, centermodel.ChannelWhatsApp) {
			sendErr = errors.New(nonEmpty(ev.LastError, "whatsapp message was not queued"))
		}
	case centermodel.StatusFailed, centermodel.StatusCancelled:
		sendErr = errors.New(nonEmpty(ev.LastError, "reminder was not delivered ("+ev.Status+")"))
	default:
		return // pending: the center retries
	}
	id, err := x.quotes.ReminderUUID(ctx, ev.OrgID, ev.SubjectID)
	if err != nil {
		x.log.Warn("quote_reminder_lookup_failed", "reminder_id", ev.SubjectID, "error", err)
		return
	}
	if err := x.quotes.CompleteReminder(ctx, id, sendErr); err != nil {
		x.log.Warn("quote_reminder_complete_failed", "reminder", id, "error", err)
	}
}

// OutboundFailed mirrors a final asynchronous WhatsApp/SMS failure of a
// quote send or reminder onto the quote delivery / reminder row. Wire it as
// the messaging OutboundObserver (only failures of quote.* sends matter).
func (x *Integration) OutboundFailed(ctx context.Context, orgID int64, kind string, ref *uuid.UUID, reason string) {
	if x.quotes == nil || ref == nil {
		return
	}
	switch kind {
	case KindQuoteSent, KindQuoteReminder, KindQuoteExpiring:
	default:
		return
	}
	if err := x.quotes.AsyncSendFailed(withOrg(ctx, orgID), orgID, ref.String(), reason); err != nil {
		x.log.Warn("quote_async_failure_record_failed", "ref", ref.String(), "error", err)
	}
}

func nonEmpty(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
