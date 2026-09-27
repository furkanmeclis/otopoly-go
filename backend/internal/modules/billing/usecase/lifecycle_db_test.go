package usecase

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestLifecycleDBIdempotentReminderAndGraceDaysZero(t *testing.T) {
	svc, q, pool, ctx := newOrdersDBFixture(t)
	notifier := &billingLifecycleNotifier{}
	svc.SetNotifier(notifier)
	plan := createBillingTestPlan(t, svc, "lifecycle_zero", "500.00")
	if _, err := pool.Exec(ctx, `UPDATE billing_settings SET grace_days = 0, reminder_days = '{3}' WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	org := createBillingTestOrg(t, q, pool)
	now := time.Now().UTC().Truncate(time.Second)
	sub, err := svc.CreateSubscriptionAdmin(ctx, AdminSubscriptionInput{
		OrganizationUUID: org.Uuid, PlanUUID: plan.UUID, Period: "monthly",
		StartsAt: now.AddDate(0, -1, 0), EndsAt: now.Add(-time.Hour), PricePaid: "0.00", Note: "expired",
	})
	if err != nil {
		t.Fatal(err)
	}
	res, err := svc.RunLifecycle(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.MovedToReadOnly == 0 {
		t.Fatalf("expected direct read_only, result=%+v", res)
	}
	live, err := q.GetLiveSubscription(ctx, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if live.Status != "read_only" || live.GraceEndsAt.Valid {
		t.Fatalf("live subscription = %+v", live)
	}
	if live.Uuid != sub.UUID {
		t.Fatalf("unexpected live subscription uuid %s", live.Uuid)
	}

	org2 := createBillingTestOrg(t, q, pool)
	_, err = svc.CreateSubscriptionAdmin(ctx, AdminSubscriptionInput{
		OrganizationUUID: org2.Uuid, PlanUUID: plan.UUID, Period: "monthly",
		StartsAt: now.AddDate(0, -1, 0), EndsAt: now.AddDate(0, 0, 3), PricePaid: "0.00", Note: "ending soon",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RunLifecycle(ctx, now); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RunLifecycle(ctx, now); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM billing_reminder_log WHERE organization_id = $1 AND kind = 'ends_in_3'`, org2.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("ends_in_3 reminder log count=%d", count)
	}
}

func TestLifecycleDBTrialGraceAndReadOnly(t *testing.T) {
	svc, q, pool, ctx := newOrdersDBFixture(t)
	if _, err := pool.Exec(ctx, `UPDATE billing_settings SET grace_days = 1 WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	trial, err := q.GetBillingPlanByCode(ctx, "trial")
	if err != nil {
		t.Fatal(err)
	}
	org := createBillingTestOrg(t, q, pool)
	now := time.Now().UTC().Truncate(time.Second)
	created, err := svc.CreateSubscriptionAdmin(ctx, AdminSubscriptionInput{
		OrganizationUUID: org.Uuid, PlanUUID: trial.Uuid, Period: "monthly",
		StartsAt: now.AddDate(0, 0, -15), EndsAt: now.Add(-time.Hour), PricePaid: "0.00", Note: "trial expired",
	})
	if err != nil {
		t.Fatal(err)
	}
	res, err := svc.RunLifecycle(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.MovedToGrace == 0 {
		t.Fatalf("expected trial to move to grace, result=%+v", res)
	}
	live, err := q.GetLiveSubscription(ctx, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if live.Status != "grace" || !live.GraceEndsAt.Valid {
		t.Fatalf("live subscription after grace = %+v", live)
	}
	if _, err := svc.RunLifecycle(ctx, live.GraceEndsAt.Time.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	live, err = q.GetLiveSubscription(ctx, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if live.Status != "read_only" || live.Uuid != created.UUID {
		t.Fatalf("live subscription after read-only = %+v", live)
	}
	var accessEnds pgtype.Timestamptz
	if err := pool.QueryRow(ctx, `SELECT access_ends_at FROM organizations WHERE id = $1`, org.ID).Scan(&accessEnds); err != nil {
		t.Fatal(err)
	}
	if accessEnds.Valid {
		t.Fatalf("access_ends_at must be cleared, got %+v", accessEnds)
	}
}

func TestLifecycleDBOrderApprovalExitsReadOnly(t *testing.T) {
	svc, q, pool, ctx := newOrdersDBFixture(t)
	plan := createBillingTestPlan(t, svc, "lifecycle_approval", "500.00")
	org := createBillingTestOrg(t, q, pool)
	now := time.Now().UTC().Truncate(time.Second)
	if _, err := svc.CreateSubscriptionAdmin(ctx, AdminSubscriptionInput{
		OrganizationUUID: org.Uuid, PlanUUID: plan.UUID, Period: "monthly",
		StartsAt: now.AddDate(0, -2, 0), EndsAt: now.AddDate(0, -1, 0), PricePaid: "0.00", Note: "old",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_subscriptions SET status = 'read_only' WHERE organization_id = $1`, org.ID); err != nil {
		t.Fatal(err)
	}
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID, UUID: org.Uuid, Slug: org.Slug, Name: org.Name})
	order, err := svc.CreateOrder(octx, OrderInput{PlanUUID: plan.UUID, Period: "monthly"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReportPayment(octx, order.UUID, ReportInput{
		Filename: "receipt.pdf", ContentType: "application/pdf", Size: 7, Body: strings.NewReader("receipt"),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApproveOrder(ctx, order.UUID, "ok"); err != nil {
		t.Fatal(err)
	}
	live, err := q.GetLiveSubscription(ctx, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if live.Status != "active" || live.GraceEndsAt.Valid || !live.EndsAt.Time.After(now) {
		t.Fatalf("approved subscription = %+v", live)
	}
}

type billingLifecycleNotifier struct {
	orgEvents []string
}

func (n *billingLifecycleNotifier) NotifyOrganization(_ context.Context, _ int64, title, _, _ string) {
	n.orgEvents = append(n.orgEvents, title)
}

func (n *billingLifecycleNotifier) NotifyOrganizationEmail(ctx context.Context, orgID int64, title, body, link string) {
	n.NotifyOrganization(ctx, orgID, title, body, link)
}

func (n *billingLifecycleNotifier) NotifyPlatform(context.Context, string, string, string) {}

var _ Notifier = (*billingLifecycleNotifier)(nil)
