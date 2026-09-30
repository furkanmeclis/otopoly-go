package usecase

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

// fakeCenter records dispatches and dedupes by key like the real center.
type fakeCenter struct {
	mu   sync.Mutex
	seen map[string]bool
	sent []centermodel.Notification
}

func (f *fakeCenter) Dispatch(_ context.Context, n centermodel.Notification) (centermodel.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.seen == nil {
		f.seen = map[string]bool{}
	}
	if f.seen[n.DedupeKey] {
		return centermodel.Result{Duplicate: true}, nil
	}
	f.seen[n.DedupeKey] = true
	f.sent = append(f.sent, n)
	return centermodel.Result{UUID: uuid.New(), Status: "sent"}, nil
}

func (f *fakeCenter) kinds() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.sent))
	for _, n := range f.sent {
		out = append(out, n.Kind)
	}
	return out
}

func TestOwnerAlertsDBThresholdsDedupeAndReached(t *testing.T) {
	svc, q, pool, ctx := newOrdersDBFixture(t)
	if err := svc.EnsureBuiltinFeatures(ctx); err != nil {
		t.Fatal(err)
	}
	org := createBillingTestOrg(t, q, pool)
	now := time.Now().UTC()
	if _, err := svc.StartTrialTx(ctx, q, org.ID, now); err != nil {
		t.Fatal(err)
	}
	suffix := uuid.NewString()[:8]
	var ownerID, staffID int64
	if err := pool.QueryRow(ctx, `INSERT INTO users (email, password_hash, name, surname, locale) VALUES ($1, 'x', 'Owner', 'O', 'en') RETURNING id`, "owner-"+suffix+"@example.test").Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO users (email, password_hash, name, surname) VALUES ($1, 'x', 'Staff', 'S') RETURNING id`, "staff-"+suffix+"@example.test").Scan(&staffID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []int64{ownerID, staffID})
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_usage_counters WHERE organization_id = $1`, org.ID)
	})
	if _, err := pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'staff')`, org.ID, ownerID, staffID); err != nil {
		t.Fatal(err)
	}

	center := &fakeCenter{}
	svc.SetOwnerAlerts(center, "https://otopoly.app/")
	ent := entitlements.New(entitlements.NewDBStore(q))
	ent.SetAlerter(svc)
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID, UUID: org.Uuid, Slug: org.Slug})

	// Trial: jobs.daily = 10, warn 80%.
	for range 7 {
		if err := ent.Consume(octx, org.ID, "jobs.daily", 1); err != nil {
			t.Fatal(err)
		}
	}
	if got := center.kinds(); len(got) != 0 {
		t.Fatalf("no alert expected below 80%%, got %v", got)
	}
	if err := ent.Consume(octx, org.ID, "jobs.daily", 1); err != nil { // 8/10
		t.Fatal(err)
	}
	if got := center.kinds(); len(got) != 1 || got[0] != KindUsageWarning {
		t.Fatalf("after 8/10 kinds=%v", got)
	}
	n := center.sent[0]
	if n.Recipient.UserID != ownerID {
		t.Fatalf("alert must go to the owner only, got user %d", n.Recipient.UserID)
	}
	if n.Locale != "en" || n.Vars["feature_label"] != "Daily jobs" || n.Vars["used"] != "8" || n.Vars["limit"] != "10" || n.Vars["percent"] != "80" {
		t.Fatalf("vars=%v locale=%s", n.Vars, n.Locale)
	}
	wantPath := "/t/" + org.Slug + "/settings/billing"
	if n.ActionURL != wantPath || n.Vars["billing_link"] != "https://otopoly.app"+wantPath {
		t.Fatalf("action=%q link=%q", n.ActionURL, n.Vars["billing_link"])
	}
	if len(n.Channels) != 2 {
		t.Fatalf("channels=%v", n.Channels)
	}

	if err := ent.Consume(octx, org.ID, "jobs.daily", 2); err != nil { // 10/10
		t.Fatal(err)
	}
	if got := center.kinds(); len(got) != 2 || got[1] != KindLimitFull {
		t.Fatalf("after 10/10 kinds=%v", got)
	}

	_, err := ent.Check(octx, org.ID, "jobs.daily", 1)
	var le *entitlements.LimitError
	if !errors.As(err, &le) {
		t.Fatalf("expected LimitError, got %v", err)
	}
	if !le.OwnerNotified || le.Used != 10 || le.Limit != 10 {
		t.Fatalf("decision=%+v", le.Decision)
	}
	if got := center.kinds(); len(got) != 3 || got[2] != KindLimitReached {
		t.Fatalf("after refusal kinds=%v", got)
	}
	// Second refusal in the same period: deduped, still reported as notified.
	_, err = ent.Check(octx, org.ID, "jobs.daily", 1)
	if !errors.As(err, &le) || !le.OwnerNotified {
		t.Fatalf("second refusal err=%v", err)
	}
	if got := center.kinds(); len(got) != 3 {
		t.Fatalf("dedupe failed, kinds=%v", got)
	}
}

func TestOwnerAlertsDBNoCenterReportsNotNotified(t *testing.T) {
	svc, q, pool, ctx := newOrdersDBFixture(t)
	org := createBillingTestOrg(t, q, pool)
	if _, err := svc.StartTrialTx(ctx, q, org.ID, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if svc.LimitAlert(ctx, entitlements.Alert{OrgID: org.ID, Key: "jobs.daily", Threshold: entitlements.ThresholdReached, Used: 10, Limit: 10}) {
		t.Fatal("without a notification center the owner is not notified")
	}
}
