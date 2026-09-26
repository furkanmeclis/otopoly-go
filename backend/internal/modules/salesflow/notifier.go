package salesflow

import (
	"context"
	"fmt"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
)

var _ quotesusecase.QuoteNotifier = (*Integration)(nil)

// QuoteChanged implements quotesusecase.QuoteNotifier (fail-soft).
func (x *Integration) QuoteChanged(ctx context.Context, ev quotesusecase.QuoteEvent) {
	ctx = withOrg(ctx, ev.OrganizationID)
	switch ev.Kind {
	case "created":
		x.teamCreated(ctx, ev)
	case "sent", "updated", "status":
		x.syncTeamExpiry(ctx, ev)
	}
}

func (x *Integration) people(ctx context.Context, ev quotesusecase.QuoteEvent) (db.GetQuoteNotifyPeopleRow, error) {
	return x.store.GetQuoteNotifyPeople(ctx, db.GetQuoteNotifyPeopleParams{ID: ev.QuoteID, OrganizationID: ev.OrganizationID})
}

func teamVars(ev quotesusecase.QuoteEvent, p db.GetQuoteNotifyPeopleRow) map[string]string {
	vars := map[string]string{
		"quote_number":    ev.Number,
		"customer_name":   p.CustomerName,
		"total_amount":    FormatMoney(ev.GrandTotal, ev.Currency, "tr"),
		"created_by_name": p.CreatedByName,
	}
	if ev.ValidUntil != nil {
		vars["valid_until_iso"] = dateOnly(*ev.ValidUntil)
	}
	return vars
}

// teamCreated tells the lead's assignee about a new quote made by someone
// else (skipped without a lead / assignee or when they created it).
func (x *Integration) teamCreated(ctx context.Context, ev quotesusecase.QuoteEvent) {
	p, err := x.people(ctx, ev)
	if err != nil {
		x.log.Warn("quote_team_created_lookup_failed", "quote", ev.QuoteUUID, "error", err)
		return
	}
	if !p.LeadAssigneeID.Valid {
		return
	}
	assignee := p.LeadAssigneeID.Int64
	creator := ev.ActorID
	if creator == 0 {
		creator = ev.CreatedBy
	}
	if assignee == creator {
		return
	}
	if _, err := x.center.Dispatch(ctx, centermodel.Notification{
		OrgID: ev.OrganizationID, Kind: KindQuoteTeamCreated,
		SubjectType: SubjectQuote, SubjectID: ev.QuoteID,
		Recipient: centermodel.Recipient{UserID: assignee},
		Vars:      teamVars(ev, p),
		ActionURL: appPath(ctx, "/quotes/%s", ev.QuoteUUID),
		DedupeKey: fmt.Sprintf("%s:%s:u%d", KindQuoteTeamCreated, ev.QuoteUUID, assignee),
		CreatedBy: creator,
	}); err != nil {
		x.log.Warn("quote_team_created_dispatch_failed", "quote", ev.QuoteUUID, "error", err)
	}
}

// TeamExpiryAt is when the team "expires tomorrow" notice fires: 10:00
// (Europe/Istanbul) on the day before valid_until.
func (x *Integration) TeamExpiryAt(validUntil time.Time) time.Time {
	return time.Date(validUntil.Year(), validUntil.Month(), validUntil.Day()-1, teamExpiryHour, 0, 0, 0, x.loc)
}

// syncTeamExpiry (re)schedules the team "quote expires tomorrow" notice for
// sent / viewed quotes, one per recipient (creator + lead assignee), and
// cancels it otherwise. ExpiryGuard re-checks the quote at send time.
func (x *Integration) syncTeamExpiry(ctx context.Context, ev quotesusecase.QuoteEvent) {
	if _, err := x.center.CancelBySubject(ctx, SubjectQuoteExpiry, ev.QuoteID); err != nil {
		x.log.Warn("quote_team_expiry_cancel_failed", "quote", ev.QuoteUUID, "error", err)
		return
	}
	if ev.ValidUntil == nil || (ev.Status != quotesusecase.StatusSent && ev.Status != quotesusecase.StatusViewed) {
		return
	}
	fireAt := x.TeamExpiryAt(*ev.ValidUntil)
	if !fireAt.After(x.now()) {
		return
	}
	p, err := x.people(ctx, ev)
	if err != nil {
		x.log.Warn("quote_team_expiry_lookup_failed", "quote", ev.QuoteUUID, "error", err)
		return
	}
	var recipients []int64
	for _, id := range []int64{p.CreatedBy.Int64, p.LeadAssigneeID.Int64} {
		if id > 0 && (len(recipients) == 0 || recipients[0] != id) {
			recipients = append(recipients, id)
		}
	}
	vars := teamVars(ev, p)
	for _, uid := range recipients {
		if _, err := x.center.Schedule(ctx, centermodel.ScheduledNotification{
			Notification: centermodel.Notification{
				OrgID: ev.OrganizationID, Kind: KindQuoteTeamExpiring,
				SubjectType: SubjectQuoteExpiry, SubjectID: ev.QuoteID,
				Recipient: centermodel.Recipient{UserID: uid},
				Vars:      vars,
				ActionURL: appPath(ctx, "/quotes/%s", ev.QuoteUUID),
				DedupeKey: fmt.Sprintf("%s:%s:%s:u%d", KindQuoteTeamExpiring, ev.QuoteUUID, dateOnly(*ev.ValidUntil), uid),
				CreatedBy: ev.ActorID,
			},
			FireAt: fireAt,
		}); err != nil {
			// e.g. the creator left the organization.
			x.log.Warn("quote_team_expiry_schedule_failed", "quote", ev.QuoteUUID, "user_id", uid, "error", err)
		}
	}
}

// ExpiryGuard: the team notice only goes out while the quote is still
// sent / viewed and valid (not accepted, rejected, cancelled or expired).
func (x *Integration) ExpiryGuard(ctx context.Context, orgID, quoteID int64) (bool, error) {
	q, err := x.store.GetQuoteRowByID(ctx, quoteID)
	if err != nil {
		if isNoRows(err) {
			return false, nil
		}
		return false, err
	}
	if q.OrganizationID != orgID {
		return false, nil
	}
	if q.Status != quotesusecase.StatusSent && q.Status != quotesusecase.StatusViewed {
		return false, nil
	}
	if q.ValidUntil.Valid {
		n := x.now().In(x.loc)
		today := time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
		if q.ValidUntil.Time.Before(today) {
			return false, nil
		}
	}
	return true, nil
}
