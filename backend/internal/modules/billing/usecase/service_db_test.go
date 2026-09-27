package usecase

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestServiceDBPlanTrialOverview(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	svc := New(pool, q, nil, entitlements.New(entitlements.NewDBStore(q)))
	if err := svc.EnsureBuiltinFeatures(ctx); err != nil {
		t.Fatal(err)
	}
	code := "pro_test_" + uuid.NewString()[:8]
	jobsLimit := int64(50)
	quotes := true
	plan, err := svc.CreatePlan(ctx, PlanInput{
		Code: code, Name: "Pro Test", PriceMonthly: "1500", YearlyPricing: "discount_percent",
		YearlyDiscountValue: "10", IsPublic: true, IsActive: true,
		Features: []PlanFeatureValue{
			{Key: "jobs.daily", ValueInt: &jobsLimit, Enforcement: "hard", TolerancePct: 10, WarnPct: 80},
			{Key: "module.quotes", ValueBool: &quotes, Enforcement: "hard", WarnPct: 80},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_plans WHERE uuid = $1`, plan.UUID)
	})
	plans, err := svc.ListPlans(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	var found Plan
	for _, p := range plans {
		if p.Code == code {
			found = p
		}
	}
	if found.EffectiveYearly != "16200.00" || len(found.Features) != 2 {
		t.Fatalf("plan = %+v", found)
	}
	jobsLimit = 60
	if _, err := svc.UpdatePlan(ctx, plan.UUID, PlanInput{
		Name: "Pro Test", PriceMonthly: "1500", YearlyPricing: "discount_percent",
		YearlyDiscountValue: "10", IsPublic: true, IsActive: true,
		Features: []PlanFeatureValue{
			{Key: "jobs.daily", ValueInt: &jobsLimit, Enforcement: "hard", TolerancePct: 10, WarnPct: 80},
			{Key: "module.quotes", ValueBool: &quotes, Enforcement: "hard", WarnPct: 80},
		},
	}); err != nil {
		t.Fatal(err)
	}
	trial, err := q.GetBillingPlanByCode(ctx, "trial")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.DeletePlan(ctx, trial.Uuid); !errors.Is(err, ErrConflict) {
		t.Fatalf("DeletePlan(trial) err=%v", err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	org, err := q.CreateOrganization(ctx, db.CreateOrganizationParams{
		Slug: "billing-test-" + uuid.NewString()[:8], Name: "Billing Test",
		Status: "active", PlanCode: pgtype.Text{String: "trial", Valid: true},
		AccessStartsAt: pgtype.Timestamptz{Time: now, Valid: true},
		AccessEndsAt:   pgtype.Timestamptz{Time: now.Add(14 * 24 * time.Hour), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, org.ID)
	})
	_, err = svc.StartTrialTx(ctx, q, org.ID, now)
	if err != nil {
		t.Fatal(err)
	}
	sub, err := q.GetLiveSubscription(ctx, org.ID)
	if err != nil || sub.Status != "trial" {
		t.Fatalf("subscription=%+v err=%v", sub, err)
	}
	ovCtx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID, UUID: org.Uuid, Slug: org.Slug, Name: org.Name})
	ov, err := svc.Overview(ovCtx)
	if err != nil {
		t.Fatal(err)
	}
	if ov.Subscription == nil || ov.Plan == nil {
		t.Fatalf("overview missing subscription/plan: %+v", ov)
	}
	var sawJobs, sawAI bool
	for _, m := range ov.Meters {
		if m.Key == "jobs.daily" && m.Limit != nil && *m.Limit == 10 && m.Used == 0 {
			sawJobs = true
		}
		if m.Key == "ai.enabled" && m.Enabled != nil && !*m.Enabled {
			sawAI = true
		}
	}
	if !sawJobs || !sawAI {
		t.Fatalf("meters=%+v", ov.Meters)
	}
}
