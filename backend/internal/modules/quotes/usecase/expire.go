package usecase

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/jackc/pgx/v5/pgtype"
)

const expireBatch = 200

// ExpireDue marks open (draft / sent / viewed) quotes whose valid_until day
// has passed (Europe/Istanbul) as expired, records a quote event and cancels
// their pending reminders. Accepted, rejected and cancelled quotes are never
// touched. Idempotent; safe to run concurrently (SKIP LOCKED). Worker entry.
func (s *Service) ExpireDue(ctx context.Context) (int, error) {
	today := pgtype.Date{Time: s.today(), Valid: true}
	total := 0
	for {
		n, err := s.expireBatch(ctx, today)
		total += n
		if err != nil || n < expireBatch {
			return total, err
		}
	}
}

func (s *Service) expireBatch(ctx context.Context, today pgtype.Date) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	rows, err := q.ExpireDueQuotes(ctx, db.ExpireDueQuotesParams{Today: today, LimitCount: expireBatch})
	if err != nil {
		return 0, err
	}
	type pair struct {
		quote db.Quote
		rems  []db.QuoteReminder
	}
	var toCancel []pair
	for _, r := range rows {
		if err := s.addEvent(ctx, q, r.OrganizationID, r.ID, eventOpts{
			kind: "status_changed", from: r.FromStatus, to: StatusExpired, channel: "system",
		}); err != nil {
			return 0, err
		}
		rems, err := q.CancelOpenQuoteReminders(ctx, r.ID)
		if err != nil {
			return 0, err
		}
		if len(rems) > 0 {
			toCancel = append(toCancel, pair{quote: db.Quote{ID: r.ID, Uuid: r.Uuid, OrganizationID: r.OrganizationID}, rems: rems})
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	for _, p := range toCancel {
		s.afterReminderChange(ctx, p.quote, p.rems, nil)
	}
	if len(rows) > 0 {
		s.log.Info("quotes_expired", "count", len(rows))
	}
	return len(rows), nil
}
