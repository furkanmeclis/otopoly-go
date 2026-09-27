package entitlements

import (
	"context"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// Recomputer rebuilds counters from source tables (spec §12). storage.gb has
// no source table and is left to its running counter.
type Recomputer struct {
	q   *db.Queries
	now func() time.Time
	loc *time.Location
}

func NewRecomputer(q *db.Queries, svc *Service) *Recomputer {
	return &Recomputer{q: q, now: svc.now, loc: svc.loc}
}

func (r *Recomputer) RecomputeUsage(ctx context.Context, orgID int64) error {
	now := r.now().In(r.loc)
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, r.loc)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, r.loc)
	ts := func(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

	daily, err := r.q.CountActiveJobsInRange(ctx, db.CountActiveJobsInRangeParams{
		OrganizationID: orgID,
		FromAt:         ts(dayStart),
		ToAt:           ts(dayStart.AddDate(0, 0, 1)),
	})
	if err != nil {
		return err
	}
	monthly, err := r.q.CountActiveJobsInRange(ctx, db.CountActiveJobsInRangeParams{
		OrganizationID: orgID,
		FromAt:         ts(monthStart),
		ToAt:           ts(monthStart.AddDate(0, 1, 0)),
	})
	if err != nil {
		return err
	}
	members, err := r.q.CountOrgMembers(ctx, orgID)
	if err != nil {
		return err
	}
	customers, err := r.q.CountOrgCustomers(ctx, orgID)
	if err != nil {
		return err
	}
	for _, c := range []struct {
		key, period string
		value       int64
	}{
		{"jobs.daily", PeriodDay, daily},
		{"jobs.monthly", PeriodMonth, monthly},
		{"staff.count", PeriodTotal, members},
		{"customers.count", PeriodTotal, customers},
	} {
		if err := r.q.SetUsageCounter(ctx, db.SetUsageCounterParams{
			OrganizationID: orgID,
			FeatureKey:     c.key,
			PeriodKey:      PeriodKeyAt(c.period, now),
			Value:          c.value,
		}); err != nil {
			return err
		}
	}
	return nil
}

// RecomputeAll runs RecomputeUsage for every organization (daily job).
func (r *Recomputer) RecomputeAll(ctx context.Context) (int, error) {
	ids, err := r.q.ListOrganizationIDs(ctx)
	if err != nil {
		return 0, err
	}
	for _, id := range ids {
		if err := r.RecomputeUsage(ctx, id); err != nil {
			return 0, err
		}
	}
	return len(ids), nil
}
