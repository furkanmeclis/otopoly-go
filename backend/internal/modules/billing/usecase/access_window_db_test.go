package usecase

import (
	"bytes"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/jackc/pgx/v5/pgtype"
)

// A renewal order starts when the paid period ends. Approving it must not
// move the organization's access_starts_at into the future (that locked the
// organization out for a year: window +1y..+2y).
func TestOrdersDBRenewalKeepsAccessOpen(t *testing.T) {
	svc, q, pool, ctx := newOrdersDBFixture(t)
	plan := createBillingTestPlan(t, svc, "renewal_access", "500.00")
	org := createBillingTestOrg(t, q, pool)
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID, UUID: org.Uuid, Slug: org.Slug, Name: org.Name})

	type period struct{ StartsAt, EndsAt time.Time }
	approveYearly := func(wantKind string) period {
		t.Helper()
		order, err := svc.CreateOrder(octx, OrderInput{PlanUUID: plan.UUID, Period: "yearly"})
		if err != nil {
			t.Fatal(err)
		}
		if order.Kind != wantKind {
			t.Fatalf("kind=%s want %s", order.Kind, wantKind)
		}
		if _, err := svc.ReportPayment(octx, order.UUID, ReportInput{
			Filename: "r.pdf", ContentType: "application/pdf", Size: 1, Body: bytes.NewReader([]byte("r")),
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.ApproveOrder(ctx, order.UUID, "ok"); err != nil {
			t.Fatal(err)
		}
		sub, err := q.GetLiveSubscription(ctx, org.ID)
		if err != nil {
			t.Fatal(err)
		}
		return period{StartsAt: sub.StartsAt.Time, EndsAt: sub.EndsAt.Time}
	}

	first := approveYearly("new")
	renewal := approveYearly("renew")
	if !renewal.StartsAt.After(time.Now().Add(300 * 24 * time.Hour)) {
		t.Fatalf("renewal should start when the first year ends: %v", renewal.StartsAt)
	}

	row, err := q.GetOrganizationByID(ctx, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if row.AccessStartsAt.Time.After(now) {
		t.Fatalf("access_starts_at moved into the future: %v", row.AccessStartsAt.Time)
	}
	if row.AccessStartsAt.Time.After(first.StartsAt.Add(time.Second)) {
		t.Fatalf("access_starts_at=%v want first period start %v", row.AccessStartsAt.Time, first.StartsAt)
	}
	if !row.AccessEndsAt.Valid || !row.AccessEndsAt.Time.Equal(renewal.EndsAt) {
		t.Fatalf("access_ends_at=%v want %v", row.AccessEndsAt.Time, renewal.EndsAt)
	}

	// Admin extension of the renewal subscription keeps the window open too.
	sub, err := q.GetLiveSubscription(ctx, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateSubscriptionAdmin(ctx, sub.Uuid, AdminSubscriptionPatch{
		EndsAt: ptrTime(sub.EndsAt.Time.AddDate(0, 1, 0)), Note: "extend",
	}); err != nil {
		t.Fatal(err)
	}
	row, err = q.GetOrganizationByID(ctx, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AccessStartsAt.Time.After(time.Now()) {
		t.Fatalf("extension moved access_starts_at into the future: %v", row.AccessStartsAt.Time)
	}
}

func TestKeepCurrentAccessStart(t *testing.T) {
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	ts := func(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
	yearLater := now.AddDate(1, 0, 0)
	cases := []struct {
		name       string
		start, end pgtype.Timestamptz
		next       time.Time
		want       bool
	}{
		{"renewal of open window", ts(now.Add(-time.Hour)), ts(yearLater), yearLater, true},
		{"open-ended window", ts(now.Add(-time.Hour)), pgtype.Timestamptz{}, yearLater, true},
		{"expired window, future start honored", ts(now.AddDate(-1, 0, 0)), ts(now.Add(-time.Hour)), now.AddDate(0, 1, 0), false},
		{"gap before next start", ts(now.Add(-time.Hour)), ts(now.AddDate(0, 1, 0)), yearLater, false},
		{"current window not started", ts(now.Add(time.Hour)), ts(yearLater), yearLater, false},
	}
	for _, c := range cases {
		if got := keepCurrentAccessStart(c.start, c.end, c.next, now); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}
