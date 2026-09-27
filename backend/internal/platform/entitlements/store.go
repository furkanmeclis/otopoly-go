package entitlements

import (
	"context"
	"strconv"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
)

const mbPerGB int64 = 1024

// DBStore reads plan values and counters with sqlc (queries/entitlements.sql).
type DBStore struct{ q *db.Queries }

func NewDBStore(q *db.Queries) *DBStore { return &DBStore{q: q} }

func (s *DBStore) Features(ctx context.Context, orgID int64) ([]Feature, error) {
	rows, err := s.q.GetEffectiveFeatures(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := make([]Feature, 0, len(rows))
	for _, r := range rows {
		f := Feature{Key: r.Key, Kind: r.Kind, Period: r.Period, Enforcement: r.Enforcement,
			Limit: -1, TolerancePct: int(r.TolerancePct), WarnPct: int(r.WarnPct)}
		if r.ValueInt.Valid {
			f.Limit = r.ValueInt.Int64
			if f.Key == "storage.gb" {
				f.Limit *= mbPerGB
			}
		}
		if r.ValueBool.Valid {
			f.Enabled = r.ValueBool.Bool
		}
		if r.CustomValue != "" {
			if f.Kind == KindToggle {
				f.Enabled = r.CustomValue == "true"
			} else if n, err := strconv.ParseInt(r.CustomValue, 10, 64); err == nil {
				f.Limit = n
				if f.Key == "storage.gb" {
					f.Limit *= mbPerGB
				}
			}
		}
		out = append(out, f)
	}
	return out, nil
}

func (s *DBStore) Usage(ctx context.Context, orgID int64, key, periodKey string) (int64, error) {
	return s.q.GetUsageCounter(ctx, db.GetUsageCounterParams{OrganizationID: orgID, FeatureKey: key, PeriodKey: periodKey})
}

func (s *DBStore) Consume(ctx context.Context, orgID int64, key, periodKey string, delta int64) (int64, error) {
	return s.q.ConsumeUsage(ctx, db.ConsumeUsageParams{OrganizationID: orgID, FeatureKey: key, PeriodKey: periodKey, Delta: delta})
}
