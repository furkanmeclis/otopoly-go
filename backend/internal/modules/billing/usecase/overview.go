package usecase

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/jackc/pgx/v5"
)

const mbPerGB int64 = 1024

func (s *Service) Overview(ctx context.Context) (Overview, error) {
	scope := orgctx.MustScope(ctx)
	sub, err := s.q.GetLiveSubscription(ctx, scope.InternalID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Overview{Meters: []UsageMeter{}}, nil
		}
		return Overview{}, err
	}
	plan, err := s.GetPlan(ctx, sub.PlanUuid)
	if err != nil {
		return Overview{}, err
	}
	view := SubscriptionView{
		UUID: sub.Uuid, PlanCode: sub.PlanCode, PlanName: sub.PlanName, Period: sub.Period,
		Status: sub.Status, StartsAt: sub.StartsAt.Time, EndsAt: sub.EndsAt.Time,
		CreditBalance: numericString(sub.CreditBalance), Source: sub.Source,
	}
	if sub.GraceEndsAt.Valid {
		t := sub.GraceEndsAt.Time
		view.GraceEndsAt = &t
	}
	view.DaysLeft = daysLeft(view.EndsAt, time.Now())
	meters, err := s.usageMeters(ctx, scope.InternalID)
	if err != nil {
		return Overview{}, err
	}
	return Overview{Subscription: &view, Plan: &plan, Meters: meters}, nil
}

func (s *Service) usageMeters(ctx context.Context, orgID int64) ([]UsageMeter, error) {
	if s.ent == nil {
		return []UsageMeter{}, nil
	}
	snap, err := s.ent.Snapshot(ctx, orgID)
	if err != nil {
		return nil, err
	}
	features, err := s.q.ListBillingFeatures(ctx, true)
	if err != nil {
		return nil, err
	}
	labels := make(map[string]Feature, len(features))
	for _, f := range features {
		labels[f.Key] = mapFeature(f)
	}
	usageByKey := make(map[string]entitlements.Usage, len(snap.Usage))
	for _, u := range snap.Usage {
		usageByKey[u.Key] = u
	}
	out := make([]UsageMeter, 0, len(snap.Features))
	for _, f := range snap.Features {
		if f.Kind != "limit" && f.Kind != "toggle" {
			continue
		}
		label := labels[f.Key]
		m := UsageMeter{
			Key: f.Key, Kind: f.Kind, Unit: label.Unit, Period: f.Period,
			WarnPct: int32(f.WarnPct), TolerancePct: int32(f.TolerancePct),
			Enforcement: f.Enforcement, LabelTR: label.LabelTR, LabelEN: label.LabelEN,
		}
		if f.Kind == "toggle" {
			enabled := f.Enabled
			m.Enabled = &enabled
			out = append(out, m)
			continue
		}
		u := usageByKey[f.Key]
		m.PeriodKey = u.PeriodKey
		m.Used = u.Used
		limit := f.Limit
		if f.Key == "storage.gb" {
			m.Used = u.Used / mbPerGB
			if limit >= 0 {
				limit = limit / mbPerGB
			}
		}
		if limit >= 0 {
			v := limit
			m.Limit = &v
		}
		out = append(out, m)
	}
	return out, nil
}

func daysLeft(ends, now time.Time) int {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	d := ends.In(loc).Sub(now.In(loc))
	if d <= 0 {
		return 0
	}
	return int(math.Ceil(d.Hours() / 24))
}
