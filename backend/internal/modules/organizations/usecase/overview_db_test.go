package usecase_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	billingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/usecase"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

type fakeWhatsApp struct {
	session messagingmodel.WhatsAppSession
}

func (f *fakeWhatsApp) GetSession(context.Context, int64) (messagingmodel.WhatsAppSession, error) {
	return f.session, nil
}

func (f *fakeWhatsApp) ListOutbound(_ context.Context, _ int64, limit, offset int32) ([]messagingmodel.OutboundMessage, int64, error) {
	return []messagingmodel.OutboundMessage{{EventType: "x", SenderKind: "platform_cloud"}}, 1, nil
}

func withRecorder(e *membersEnv) {
	e.svc.SetActivity(activity.NewRecorder(e.q, nil))
}

func (e *membersEnv) actorCtx(t *testing.T) (context.Context, db.User) {
	t.Helper()
	admin := e.user(t)
	return authctx.WithPrincipal(context.Background(), authctx.Principal{
		UserID: admin.Uuid, UserInternal: admin.ID, Email: admin.Email, IsSuperAdmin: true,
	}), admin
}

func (e *membersEnv) setAccessEnd(t *testing.T, org db.Organization, status string, end time.Time) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE organizations SET status = $2, access_ends_at = $3 WHERE id = $1`, org.ID, status, end); err != nil {
		t.Fatal(err)
	}
}

func activityActions(t *testing.T, e *membersEnv, org db.Organization) []orgusecase.ActivityEntry {
	t.Helper()
	items, total, err := e.svc.ListActivity(context.Background(), org.Uuid, 50, 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if int(total) != len(items) {
		t.Fatalf("total %d items %d", total, len(items))
	}
	return items
}

func TestOverviewStats(t *testing.T) {
	e := newMembersEnv(t)
	ctx := context.Background()
	org := e.org(t)
	owner := e.user(t)
	staff := e.user(t)
	e.add(t, org, owner, "owner")
	e.add(t, org, staff, "staff")
	for _, name := range []string{"A", "B", "C"} {
		if _, err := e.pool.Exec(ctx, `INSERT INTO customers (organization_id, name) VALUES ($1, $2)`, org.ID, name); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.pool.Exec(ctx, `UPDATE customers SET deleted_at = now() WHERE organization_id = $1 AND name = 'C'`, org.ID); err != nil {
		t.Fatal(err)
	}
	// Another organization's records must not count.
	other := e.org(t)
	if _, err := e.pool.Exec(ctx, `INSERT INTO customers (organization_id, name) VALUES ($1, 'X')`, other.ID); err != nil {
		t.Fatal(err)
	}

	out, err := e.svc.Overview(ctx, org.Uuid)
	if err != nil {
		t.Fatal(err)
	}
	if out.Stats.Customers != 2 || out.Stats.Members != 2 || out.Stats.Jobs != 0 || out.Stats.Quotes != 0 || out.Stats.Contracts != 0 {
		t.Fatalf("stats %+v", out.Stats)
	}
	if out.Stats.LastActivityAt == nil || time.Since(*out.Stats.LastActivityAt) > time.Minute {
		t.Fatalf("last activity %v", out.Stats.LastActivityAt)
	}
	if out.Organization.UUID != org.Uuid || out.Billing != nil || out.WhatsApp != nil {
		t.Fatalf("overview %+v", out)
	}
	if _, err := e.svc.Overview(ctx, uuid.New()); !errors.Is(err, orgusecase.ErrNotFound) {
		t.Fatalf("missing org: %v", err)
	}
}

func TestOverviewBillingAndWhatsApp(t *testing.T) {
	e := newMembersEnv(t)
	ctx := context.Background()
	billing := billingusecase.New(e.pool, e.q, nil, entitlements.New(entitlements.NewDBStore(e.q)))
	if err := billing.EnsureBuiltinFeatures(ctx); err != nil {
		t.Fatal(err)
	}
	e.svc.SetTrialStarter(billing)
	owner := e.user(t)
	res, err := e.svc.RegisterOrganization(ctx, orgusecase.RegisterInput{OrganizationName: "Overview " + uuid.NewString()[:8]}, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = e.pool.Exec(context.Background(), `DELETE FROM organizations WHERE uuid = $1`, res.Organization.UUID)
	})
	org, err := e.q.GetOrganizationByUUID(ctx, res.Organization.UUID)
	if err != nil {
		t.Fatal(err)
	}
	insertOutbound := func(orgID int64, status, delivery, sender string, at time.Time) {
		t.Helper()
		if _, err := e.pool.Exec(ctx, `INSERT INTO outbound_messages (organization_id, event_type, channel, recipient_phone, status, delivery_status, sender_kind, created_at)
			VALUES ($1, 'job.created', 'whatsapp', '905550000000', $2, NULLIF($3, ''), $4, $5)`, orgID, status, delivery, sender, at); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	insertOutbound(org.ID, "sent", "delivered", "org_own", now)
	insertOutbound(org.ID, "sent", "read", "platform_cloud", now)
	insertOutbound(org.ID, "failed", "", "platform_whatsmeow", now)
	insertOutbound(org.ID, "sent", "", "org_own", now.Add(-45*24*time.Hour)) // outside the window

	e.svc.SetOverviewSources(billing, &fakeWhatsApp{session: messagingmodel.WhatsAppSession{
		Status: "connected", PhoneNumber: "905551112233", QRCode: "secret-qr", FallbackToPlatform: true,
	}})
	out, err := e.svc.Overview(ctx, org.Uuid)
	if err != nil {
		t.Fatal(err)
	}
	if out.Billing == nil || out.Billing.Subscription == nil || out.Billing.Subscription.Status != "trial" {
		t.Fatalf("billing %+v", out.Billing)
	}
	keys := map[string]bool{}
	for _, m := range out.Billing.Meters {
		keys[m.Key] = true
	}
	// Limits and toggles of the seeded trial plan.
	for _, k := range []string{"jobs.daily", "staff.count", "whatsapp.enabled", "whatsapp.own_number", "ai.enabled"} {
		if !keys[k] {
			t.Fatalf("meter %s missing: %v", k, keys)
		}
	}
	wa := out.WhatsApp
	if wa == nil || wa.Session.Status != "connected" || !wa.Session.FallbackToPlatform {
		t.Fatalf("whatsapp %+v", wa)
	}
	if o := wa.Outbound; o.Total != 3 || o.Sent != 2 || o.Failed != 1 || o.Delivered != 2 || o.OwnNumber != 1 || o.Platform != 2 || o.LastAt == nil {
		t.Fatalf("outbound summary %+v", o)
	}
	body, _ := json.Marshal(out)
	if strings.Contains(string(body), "secret-qr") {
		t.Fatal("overview leaks the WhatsApp QR code")
	}
}

func TestSetStatusIsAudited(t *testing.T) {
	e := newMembersEnv(t)
	withRecorder(e)
	ctx, admin := e.actorCtx(t)
	org := e.org(t)

	if _, err := e.svc.SetStatus(ctx, org.Uuid, "expired", ""); !errors.Is(err, orgusecase.ErrInvalidRequest) {
		t.Fatalf("invalid status: %v", err)
	}
	got, err := e.svc.SetStatus(ctx, org.Uuid, "suspended", "unpaid invoice")
	if err != nil || got.Status != "suspended" {
		t.Fatalf("suspend: %+v %v", got, err)
	}
	// Same status again: no-op, no extra event.
	if _, err := e.svc.SetStatus(ctx, org.Uuid, "suspended", ""); err != nil {
		t.Fatal(err)
	}
	if got, err = e.svc.SetStatus(ctx, org.Uuid, "active", ""); err != nil || got.Status != "active" {
		t.Fatalf("activate: %+v %v", got, err)
	}
	items := activityActions(t, e, org)
	if len(items) != 2 || items[0].Action != "organizations.activated" || items[1].Action != "organizations.suspended" {
		t.Fatalf("events %+v", items)
	}
	if items[1].Payload["reason"] != "unpaid invoice" || items[1].Payload["from"] != "active" {
		t.Fatalf("payload %+v", items[1].Payload)
	}
	if items[1].Actor == nil || items[1].Actor.UUID != admin.Uuid {
		t.Fatalf("actor %+v", items[1].Actor)
	}
}

type fakeBilling struct {
	end   time.Time
	ok    bool
	calls int
}

func (f *fakeBilling) OrganizationBilling(context.Context, int64) (billingusecase.OrganizationBilling, error) {
	return billingusecase.OrganizationBilling{}, nil
}

func (f *fakeBilling) ExtendLiveSubscription(context.Context, int64, int, string) (time.Time, bool, error) {
	f.calls++
	return f.end, f.ok, nil
}

func TestExtendAccess(t *testing.T) {
	e := newMembersEnv(t)
	withRecorder(e)
	ctx, _ := e.actorCtx(t)

	t.Run("unlimited access cannot be extended", func(t *testing.T) {
		org := e.org(t)
		if _, err := e.svc.ExtendAccess(ctx, org.Uuid, 7, ""); !errors.Is(err, orgusecase.ErrInvalidRequest) {
			t.Fatalf("err %v", err)
		}
	})

	t.Run("days are bounded", func(t *testing.T) {
		org := e.org(t)
		for _, days := range []int{0, -1, orgusecase.MaxAccessExtensionDays + 1} {
			if _, err := e.svc.ExtendAccess(ctx, org.Uuid, days, ""); !errors.Is(err, orgusecase.ErrInvalidRequest) {
				t.Fatalf("days %d: %v", days, err)
			}
		}
	})

	t.Run("expired organization counts from now and is re-activated", func(t *testing.T) {
		org := e.org(t)
		e.setAccessEnd(t, org, "expired", time.Now().Add(-10*24*time.Hour))
		got, err := e.svc.ExtendAccess(ctx, org.Uuid, 30, "goodwill")
		if err != nil {
			t.Fatal(err)
		}
		want := time.Now().AddDate(0, 0, 30)
		if got.Status != "active" || got.AccessEndsAt == nil || got.AccessEndsAt.Sub(want).Abs() > time.Minute {
			t.Fatalf("got %+v", got)
		}
		items := activityActions(t, e, org)
		if len(items) != 1 || items[0].Action != "organizations.access_extended" ||
			items[0].Payload["note"] != "goodwill" || items[0].Payload["status_to"] != "active" {
			t.Fatalf("events %+v", items)
		}
	})

	t.Run("future end is extended from the end; suspended stays suspended", func(t *testing.T) {
		org := e.org(t)
		end := time.Now().Add(5 * 24 * time.Hour).Truncate(time.Second)
		e.setAccessEnd(t, org, "suspended", end)
		got, err := e.svc.ExtendAccess(ctx, org.Uuid, 10, "")
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != "suspended" || !got.AccessEndsAt.Equal(end.AddDate(0, 0, 10)) {
			t.Fatalf("got %+v", got)
		}
	})

	t.Run("live subscription owns the new end", func(t *testing.T) {
		org := e.org(t)
		e.setAccessEnd(t, org, "active", time.Now().Add(24*time.Hour))
		subEnd := time.Now().Add(100 * 24 * time.Hour).Truncate(time.Second)
		fb := &fakeBilling{end: subEnd, ok: true}
		e.svc.SetOverviewSources(fb, nil)
		t.Cleanup(func() { e.svc.SetOverviewSources(nil, nil) })
		got, err := e.svc.ExtendAccess(ctx, org.Uuid, 3, "")
		if err != nil {
			t.Fatal(err)
		}
		if fb.calls != 1 || !got.AccessEndsAt.Equal(subEnd) {
			t.Fatalf("got %+v calls %d", got, fb.calls)
		}
		items := activityActions(t, e, org)
		if len(items) != 1 || items[0].Payload["via_subscription"] != true {
			t.Fatalf("events %+v", items)
		}
	})
}

func TestExtendLiveSubscriptionSyncsAccess(t *testing.T) {
	e := newMembersEnv(t)
	ctx, _ := e.actorCtx(t)
	billing := billingusecase.New(e.pool, e.q, nil, nil)
	e.svc.SetTrialStarter(billing)
	e.svc.SetOverviewSources(billing, nil)
	owner := e.user(t)
	res, err := e.svc.RegisterOrganization(ctx, orgusecase.RegisterInput{OrganizationName: "Extend " + uuid.NewString()[:8]}, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = e.pool.Exec(context.Background(), `DELETE FROM organizations WHERE uuid = $1`, res.Organization.UUID)
	})
	before := *res.Organization.AccessEndsAt
	got, err := e.svc.ExtendAccess(ctx, res.Organization.UUID, 7, "")
	if err != nil {
		t.Fatal(err)
	}
	if got.AccessEndsAt.Sub(before.AddDate(0, 0, 7)).Abs() > time.Second {
		t.Fatalf("access end %v, before %v", got.AccessEndsAt, before)
	}
	org, _ := e.q.GetOrganizationByUUID(ctx, res.Organization.UUID)
	sub, err := e.q.GetLiveSubscription(ctx, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !sub.EndsAt.Time.Equal(*got.AccessEndsAt) {
		t.Fatalf("subscription end %v, access end %v", sub.EndsAt.Time, got.AccessEndsAt)
	}
}

func TestPatchKeepsAccessEndAndIsAudited(t *testing.T) {
	e := newMembersEnv(t)
	withRecorder(e)
	ctx, _ := e.actorCtx(t)
	org := e.org(t)
	end := time.Now().Add(20 * 24 * time.Hour).Truncate(time.Second)
	e.setAccessEnd(t, org, "active", end)

	name := "Renamed " + uuid.NewString()[:6]
	got, err := e.svc.Patch(ctx, org.Uuid, orgusecase.PatchInput{Name: &name})
	if err != nil {
		t.Fatal(err)
	}
	if got.AccessEndsAt == nil || !got.AccessEndsAt.Equal(end) {
		t.Fatalf("access end lost: %v", got.AccessEndsAt)
	}
	items := activityActions(t, e, org)
	if len(items) != 1 || items[0].Action != "organizations.updated" {
		t.Fatalf("events %+v", items)
	}
	changes, _ := items[0].Payload["changes"].(map[string]any)
	if _, ok := changes["name"]; !ok || len(changes) != 1 {
		t.Fatalf("changes %+v", changes)
	}
	// No-op patch records nothing.
	if _, err := e.svc.Patch(ctx, org.Uuid, orgusecase.PatchInput{Name: &name}); err != nil {
		t.Fatal(err)
	}
	if n := len(activityActions(t, e, org)); n != 1 {
		t.Fatalf("events after no-op %d", n)
	}
}

func TestActivityIsScopedToOrganization(t *testing.T) {
	e := newMembersEnv(t)
	rec := activity.NewRecorder(e.q, nil)
	org := e.org(t)
	other := e.org(t)
	actor := e.user(t)
	actorID := actor.ID
	tenantCtx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: org.ID, UUID: org.Uuid})
	rec.Record(tenantCtx, &actorID, "customers.created", "tenant.customers", nil, map[string]any{"name": "A"}, nil)
	rec.Record(activity.WithOrganization(context.Background(), org.ID), nil, "platform.thing", "platform.x", nil, nil, nil)
	otherCtx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: other.ID, UUID: other.Uuid})
	rec.Record(otherCtx, &actorID, "customers.created", "tenant.customers", nil, nil, nil)
	rec.Record(context.Background(), &actorID, "global.thing", "platform.x", nil, nil, nil)

	items := activityActions(t, e, org)
	if len(items) != 2 {
		t.Fatalf("events %+v", items)
	}
	if items[1].Action != "customers.created" || items[1].Actor == nil || items[1].Actor.Email != actor.Email {
		t.Fatalf("tenant event %+v", items[1])
	}
	filtered, total, err := e.svc.ListActivity(context.Background(), org.Uuid, 1, 0, "customers.created", "")
	if err != nil || total != 1 || len(filtered) != 1 {
		t.Fatalf("filtered %+v %d %v", filtered, total, err)
	}
	paged, total, err := e.svc.ListActivity(context.Background(), org.Uuid, 1, 1, "", "")
	if err != nil || total != 2 || len(paged) != 1 || paged[0].Action != "customers.created" {
		t.Fatalf("paged %+v %d %v", paged, total, err)
	}
	t.Cleanup(func() {
		_, _ = e.pool.Exec(context.Background(), `DELETE FROM activity_events WHERE actor_user_id = $1`, actor.ID)
	})
}

func TestListOutboundRequiresOrganization(t *testing.T) {
	e := newMembersEnv(t)
	e.svc.SetOverviewSources(nil, &fakeWhatsApp{})
	if _, _, err := e.svc.ListOutbound(context.Background(), uuid.New(), 20, 0); !errors.Is(err, orgusecase.ErrNotFound) {
		t.Fatalf("err %v", err)
	}
	org := e.org(t)
	items, total, err := e.svc.ListOutbound(context.Background(), org.Uuid, 20, 0)
	if err != nil || total != 1 || len(items) != 1 {
		t.Fatalf("items %+v %d %v", items, total, err)
	}
}
