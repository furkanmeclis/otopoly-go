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
