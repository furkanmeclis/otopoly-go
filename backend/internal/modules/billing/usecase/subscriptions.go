package usecase

import (
	"context"
	"errors"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) StartTrialTx(ctx context.Context, qtx *db.Queries, orgID int64, now time.Time) (time.Time, error) {
	plan, err := qtx.GetBillingPlanByCode(ctx, "trial")
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, ErrNotFound
		}
		return time.Time{}, err
	}
	ends := now.Add(time.Duration(plan.TrialDays) * 24 * time.Hour)
	var zero pgtype.Numeric
	_ = zero.Scan("0")
	if _, err := qtx.CreateSubscription(ctx, db.CreateSubscriptionParams{
		OrganizationID: orgID,
		PlanID:         plan.ID,
		Period:         "monthly",
		Status:         "trial",
		StartsAt:       pgtype.Timestamptz{Time: now, Valid: true},
		EndsAt:         pgtype.Timestamptz{Time: ends, Valid: true},
		PricePaid:      zero,
		Source:         "self_service",
		Note:           "",
		CreatedBy:      pgtype.Int8{},
	}); err != nil {
		return time.Time{}, err
	}
	if err := qtx.SetOrganizationAccess(ctx, db.SetOrganizationAccessParams{
		PlanCode:       pgtype.Text{String: "trial", Valid: true},
		AccessStartsAt: pgtype.Timestamptz{Time: now, Valid: true},
		AccessEndsAt:   pgtype.Timestamptz{Time: ends, Valid: true},
		ID:             orgID,
	}); err != nil {
		return time.Time{}, err
	}
	return ends, nil
}

// continuousAccessStart is the access_starts_at to store when a subscription
// period starting at next replaces an organization's access window. A
// renewal begins when the paid period ends (pricing.Compute), so next can lie
// in the future; storing it as access_starts_at would lock the organization
// out until then. While the current window is open and reaches next, keep the
// current start so access stays continuous.
func continuousAccessStart(ctx context.Context, qtx *db.Queries, orgID int64, next pgtype.Timestamptz, now time.Time) (pgtype.Timestamptz, error) {
	if !next.Valid || !next.Time.After(now) {
		return next, nil
	}
	org, err := qtx.GetOrganizationByID(ctx, orgID)
	if err != nil {
		return pgtype.Timestamptz{}, err
	}
	if keepCurrentAccessStart(org.AccessStartsAt, org.AccessEndsAt, next.Time, now) {
		return org.AccessStartsAt, nil
	}
	return next, nil
}

func keepCurrentAccessStart(curStart, curEnd pgtype.Timestamptz, next, now time.Time) bool {
	if !curStart.Valid || curStart.Time.After(now) {
		return false
	}
	// Open-ended access, or a window that runs at least until next.
	return !curEnd.Valid || !curEnd.Time.Before(next)
}
