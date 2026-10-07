package repository_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type fakeAIQuota struct {
	start, end time.Time
}

func (f fakeAIQuota) CurrentPeriod() (time.Time, time.Time) { return f.start, f.end }

func (f fakeAIQuota) OrganizationQuota(_ context.Context, _ uuid.UUID) (usecase.OrganizationAIQuota, error) {
	return usecase.OrganizationAIQuota{Enabled: true, Limit: 1000, Used: 400}, nil
}

func (e *deleteDBEnv) insights() *usecase.UserInsights {
	return usecase.NewUserInsights(e.uc, e.repo)
}

func (e *deleteDBEnv) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func (e *deleteDBEnv) session(t *testing.T, u db.User, hash string, expires time.Time, org *db.Organization) db.RefreshToken {
	t.Helper()
	params := db.CreateRefreshTokenParams{
		UserID: u.ID, TokenHash: hash,
		ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true},
		UserAgent: pgtype.Text{String: "Mozilla/5.0 test", Valid: true},
	}
	if org != nil {
		params.OrganizationID = pgtype.Int8{Int64: org.ID, Valid: true}
	}
	row, err := e.q.CreateRefreshToken(context.Background(), params)
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func (e *deleteDBEnv) device(t *testing.T, u db.User, token string) db.PushDevice {
	t.Helper()
	row, err := e.q.UpsertPushDevice(context.Background(), db.UpsertPushDeviceParams{
		UserID: u.ID, Token: token, Platform: "ios", Locale: "tr", AppVersion: "1.2.3", DeviceName: "iPhone 15",
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func mustNotContain(t *testing.T, v any, secrets ...string) {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range secrets {
		if strings.Contains(string(raw), s) {
			t.Fatalf("response leaks secret %q: %s", s, raw)
		}
	}
}

func TestUserOverviewCountsAndAIUsageDB(t *testing.T) {
	e := newDeleteDBEnv(t)
	ctx := context.Background()
	u := e.user(t, "insight-"+uuid.NewString()[:8]+"@example.com")
	other := e.user(t, "insight-o-"+uuid.NewString()[:8]+"@example.com")
	orgA := e.org(t, u)
	orgB := e.org(t, u, other)
	gone := e.org(t, u)
	e.exec(t, `UPDATE organizations SET deleted_at = NOW() WHERE id = $1`, gone.ID)

	// Sessions: two live, one revoked, one expired.
	e.session(t, u, "hash-live-1-"+uuid.NewString(), time.Now().Add(time.Hour), &orgA)
	e.session(t, u, "hash-live-2-"+uuid.NewString(), time.Now().Add(time.Hour), nil)
	revoked := e.session(t, u, "hash-revoked-"+uuid.NewString(), time.Now().Add(time.Hour), nil)
	e.exec(t, `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, revoked.ID)
	e.session(t, u, "hash-expired-"+uuid.NewString(), time.Now().Add(-time.Minute), nil)

	// Devices: one active, one disabled (not counted as active).
	e.device(t, u, "ExponentPushToken["+uuid.NewString()+"]")
	disabled := e.device(t, u, "ExponentPushToken["+uuid.NewString()+"]")
	e.exec(t, `UPDATE push_devices SET disabled_at = NOW() WHERE id = $1`, disabled.ID)

	// 2FA + passkey.
	e.exec(t, `INSERT INTO user_totp (user_id, secret_enc, enabled) VALUES ($1, 'enc-secret', TRUE)`, u.ID)
	if _, err := e.q.CreateWebAuthnCredential(ctx, db.CreateWebAuthnCredentialParams{
		UserID: u.ID, CredentialID: "cred-" + uuid.NewString(), PublicKey: "pk", DeviceType: "singleDevice",
		ProviderAccountID: "cred",
	}); err != nil {
		t.Fatal(err)
	}

	// Notifications: one unread in-app, one read in-app, one email.
	for _, n := range []struct {
		channel string
		read    bool
	}{{"inapp", false}, {"inapp", true}, {"email", false}} {
		row, err := e.q.CreateNotification(ctx, db.CreateNotificationParams{
			UserID: pgtype.Int8{Int64: u.ID, Valid: true}, Channel: n.channel, Status: "sent", Priority: "normal",
			Title: "t", Body: "b", Payload: []byte(`{}`), MaxAttempts: 1,
		})
		if err != nil {
			t.Fatal(err)
		}
		if n.read {
			e.exec(t, `UPDATE notifications SET read_at = NOW() WHERE id = $1`, row.ID)
		}
	}
	t.Cleanup(func() { _, _ = e.pool.Exec(context.Background(), `DELETE FROM notifications WHERE user_id = $1`, u.ID) })

	// AI: two conversations in A (one deleted), usage in the period, before it,
	// and by another member (not counted).
	periodStart := time.Now().Add(-24 * time.Hour)
	for i := 0; i < 2; i++ {
		c, err := e.q.CreateAIConversation(ctx, db.CreateAIConversationParams{OrganizationID: orgA.ID, UserID: u.ID, Title: "c"})
		if err != nil {
			t.Fatal(err)
		}
		if i == 1 {
			e.exec(t, `UPDATE ai_conversations SET deleted_at = NOW() WHERE id = $1`, c.ID)
		}
	}
	usage := func(org db.Organization, user db.User, tokens int64, at time.Time) {
		e.exec(t, `INSERT INTO ai_usage (organization_id, user_id, provider, model, input_tokens, output_tokens, cache_write_tokens, created_at)
			VALUES ($1, $2, 'fake', 'm', $3, 10, 5, $4)`, org.ID, user.ID, tokens, at)
	}
	usage(orgA, u, 100, time.Now())                  // 115
	usage(orgB, u, 20, time.Now())                   // 35
	usage(orgA, u, 999, periodStart.Add(-time.Hour)) // before the period
	usage(orgB, other, 500, time.Now())              // another member

	svc := e.insights()
	svc.SetAIQuotaSource(fakeAIQuota{start: periodStart, end: periodStart.AddDate(0, 1, 0)})
	out, err := svc.Overview(e.ctx, u.Uuid)
	if err != nil {
		t.Fatal(err)
	}
	if out.User.UUID != u.Uuid || out.User.Email != u.Email {
		t.Fatalf("user: %+v", out.User)
	}
	want := model.UserCounts{Organizations: 2, ActiveSessions: 2, PushDevices: 1, UnreadNotifications: 1}
	if out.Counts != want {
		t.Fatalf("counts = %+v, want %+v", out.Counts, want)
	}
	if !out.Security.TwoFactorEnabled || out.Security.PasskeyCount != 1 || !out.Security.PasswordSet ||
		out.Security.EmailVerifiedAt == nil || out.Security.CreatedAt.IsZero() {
		t.Fatalf("security: %+v", out.Security)
	}
	if out.AI == nil || out.AI.ConversationCount != 1 || out.AI.Tokens != 150 || len(out.AI.Organizations) != 2 {
		t.Fatalf("ai: %+v", out.AI)
	}
	for _, o := range out.AI.Organizations {
		if o.QuotaLimit != 1000 || o.QuotaUsed != 400 || !o.Enabled {
			t.Fatalf("org quota: %+v", o)
		}
		if o.Organization.UUID == orgB.Uuid && (o.Tokens != 35 || o.ConversationCount != 0) {
			t.Fatalf("org B usage: %+v", o)
		}
	}
	mustNotContain(t, out, "enc-secret", "hash-live", "ExponentPushToken")

	// Without an AI source the section is omitted.
	plain, err := e.insights().Overview(e.ctx, u.Uuid)
	if err != nil || plain.AI != nil {
		t.Fatalf("overview without ai: %+v %v", plain.AI, err)
	}
	if _, err := svc.Overview(e.ctx, uuid.New()); !errors.Is(err, usecase.ErrNotFound) {
		t.Fatalf("unknown user: %v", err)
	}
}

func TestUserMembershipsPagedDB(t *testing.T) {
	e := newDeleteDBEnv(t)
	u := e.user(t, "insight-m-"+uuid.NewString()[:8]+"@example.com")
	orgA := e.org(t, u)
	orgB := e.org(t)
	if _, err := e.q.CreateOrganizationMember(context.Background(), db.CreateOrganizationMemberParams{
		OrganizationID: orgB.ID, UserID: u.ID, Role: "staff",
	}); err != nil {
		t.Fatal(err)
	}
	svc := e.insights()
	all, total, err := svc.ListMemberships(e.ctx, u.Uuid, 10, 0)
	if err != nil || total != 2 || len(all) != 2 {
		t.Fatalf("memberships: %+v total=%d err=%v", all, total, err)
	}
	roles := map[uuid.UUID]string{}
	for _, m := range all {
		roles[m.Organization.UUID] = m.Role
		if m.JoinedAt.IsZero() || m.Status != "active" || m.Organization.Name == "" {
			t.Fatalf("membership fields: %+v", m)
		}
	}
	if roles[orgA.Uuid] != "owner" || roles[orgB.Uuid] != "staff" {
		t.Fatalf("roles: %+v", roles)
	}
	page, total, err := svc.ListMemberships(e.ctx, u.Uuid, 1, 1)
	if err != nil || total != 2 || len(page) != 1 || page[0].Organization.UUID != all[1].Organization.UUID {
		t.Fatalf("second page: %+v total=%d err=%v", page, total, err)
	}
}

func TestUserSessionsListAndRevokeDB(t *testing.T) {
	e := newDeleteDBEnv(t)
	u := e.user(t, "insight-s-"+uuid.NewString()[:8]+"@example.com")
	other := e.user(t, "insight-s2-"+uuid.NewString()[:8]+"@example.com")
	org := e.org(t, u)
	hash := "hash-secret-" + uuid.NewString()
	withOrg := e.session(t, u, hash, time.Now().Add(time.Hour), &org)
	plain := e.session(t, u, "hash-secret-"+uuid.NewString(), time.Now().Add(time.Hour), nil)
	e.session(t, u, "hash-secret-"+uuid.NewString(), time.Now().Add(-time.Minute), nil) // expired
	foreign := e.session(t, other, "hash-secret-"+uuid.NewString(), time.Now().Add(time.Hour), nil)

	svc := e.insights()
	items, total, err := svc.ListSessions(e.ctx, u.Uuid, 20, 0)
	if err != nil || total != 2 || len(items) != 2 {
		t.Fatalf("sessions: %+v total=%d err=%v", items, total, err)
	}
	var found bool
	for _, s := range items {
		if s.UUID == withOrg.Uuid {
			found = true
			if s.Organization == nil || s.Organization.UUID != org.Uuid || s.UserAgent == nil || s.LastUsedAt.IsZero() {
				t.Fatalf("session metadata: %+v", s)
			}
		}
	}
	if !found {
		t.Fatal("org session missing")
	}
	mustNotContain(t, items, "hash-secret")

	// Another user's session cannot be revoked through this user.
	if err := svc.RevokeSession(e.ctx, u.Uuid, foreign.Uuid); !errors.Is(err, usecase.ErrNotFound) {
		t.Fatalf("foreign session: %v", err)
	}
	if err := svc.RevokeSession(e.ctx, u.Uuid, plain.Uuid); err != nil {
		t.Fatal(err)
	}
	if err := svc.RevokeSession(e.ctx, u.Uuid, plain.Uuid); !errors.Is(err, usecase.ErrNotFound) {
		t.Fatalf("revoking twice: %v", err)
	}
	if n := e.count(t, `SELECT COUNT(*) FROM refresh_tokens WHERE uuid = $1 AND revoked_at IS NOT NULL`, plain.Uuid); n != 1 {
		t.Fatal("session not revoked")
	}

	n, err := svc.RevokeAllSessions(e.ctx, u.Uuid)
	if err != nil || n != 2 { // live org session + expired (never revoked) row
		t.Fatalf("revoke all: n=%d err=%v", n, err)
	}
	if _, total, _ := svc.ListSessions(e.ctx, u.Uuid, 20, 0); total != 0 {
		t.Fatalf("sessions after revoke all: %d", total)
	}
	if c := e.count(t, `SELECT COUNT(*) FROM refresh_tokens WHERE id = $1 AND revoked_at IS NULL`, foreign.ID); c != 1 {
		t.Fatal("other user's session must stay live")
	}
}

func TestUserDevicesListAndRemoveDB(t *testing.T) {
	e := newDeleteDBEnv(t)
	u := e.user(t, "insight-d-"+uuid.NewString()[:8]+"@example.com")
	other := e.user(t, "insight-d2-"+uuid.NewString()[:8]+"@example.com")
	active := e.device(t, u, "ExponentPushToken[secret-"+uuid.NewString()+"]")
	disabled := e.device(t, u, "ExponentPushToken[secret-"+uuid.NewString()+"]")
	e.exec(t, `UPDATE push_devices SET disabled_at = NOW(), disabled_reason = 'DeviceNotRegistered' WHERE id = $1`, disabled.ID)
	foreign := e.device(t, other, "ExponentPushToken[secret-"+uuid.NewString()+"]")

	svc := e.insights()
	items, total, err := svc.ListDevices(e.ctx, u.Uuid, 20, 0)
	if err != nil || total != 2 || len(items) != 2 {
		t.Fatalf("devices: %+v total=%d err=%v", items, total, err)
	}
	if items[0].UUID != active.Uuid || items[0].DeviceName != "iPhone 15" || items[0].Platform != "ios" || items[0].AppVersion != "1.2.3" {
		t.Fatalf("active device first: %+v", items[0])
	}
	if items[1].DisabledAt == nil || items[1].DisabledReason != "DeviceNotRegistered" {
		t.Fatalf("disabled device: %+v", items[1])
	}
	mustNotContain(t, items, "ExponentPushToken", "secret-")

	if _, err := svc.RemoveDevice(e.ctx, u.Uuid, foreign.Uuid); !errors.Is(err, usecase.ErrNotFound) {
		t.Fatalf("foreign device: %v", err)
	}
	removed, err := svc.RemoveDevice(e.ctx, u.Uuid, active.Uuid)
	if err != nil || removed.Platform != "ios" || removed.DeviceName != "iPhone 15" {
		t.Fatalf("remove: %+v %v", removed, err)
	}
	if c := e.count(t, `SELECT COUNT(*) FROM push_devices WHERE user_id = $1`, u.ID); c != 1 {
		t.Fatalf("devices left: %d", c)
	}
	if c := e.count(t, `SELECT COUNT(*) FROM push_devices WHERE id = $1`, foreign.ID); c != 1 {
		t.Fatal("other user's device must stay")
	}
}

func TestUserActivityFilterDB(t *testing.T) {
	e := newDeleteDBEnv(t)
	u := e.user(t, "insight-a-"+uuid.NewString()[:8]+"@example.com")
	other := e.user(t, "insight-a2-"+uuid.NewString()[:8]+"@example.com")
	orgA := e.org(t, u)
	orgB := e.org(t, u)
	insert := func(actor db.User, action string, org *db.Organization) {
		var orgID pgtype.Int8
		if org != nil {
			orgID = pgtype.Int8{Int64: org.ID, Valid: true}
		}
		if _, err := e.q.InsertActivityEvent(context.Background(), db.InsertActivityEventParams{
			ActorUserID: pgtype.Int8{Int64: actor.ID, Valid: true}, Action: action, Resource: "customers",
			Payload: []byte(`{"name":"x"}`), OrganizationID: orgID,
		}); err != nil {
			t.Fatal(err)
		}
	}
	insert(u, "customers.created", &orgA)
	insert(u, "customers.updated", &orgA)
	insert(u, "customers.created", &orgB)
	insert(u, "users.login", nil)
	insert(other, "customers.created", &orgA)
	t.Cleanup(func() {
		_, _ = e.pool.Exec(context.Background(), `DELETE FROM activity_events WHERE actor_user_id IN ($1, $2)`, u.ID, other.ID)
	})

	svc := e.insights()
	all, total, err := svc.ListActivity(e.ctx, u.Uuid, model.UserActivityFilter{}, 20, 0)
	if err != nil || total != 4 || len(all) != 4 {
		t.Fatalf("all activity: total=%d len=%d err=%v", total, len(all), err)
	}
	a := orgA.Uuid
	inA, total, err := svc.ListActivity(e.ctx, u.Uuid, model.UserActivityFilter{OrganizationUUID: &a}, 20, 0)
	if err != nil || total != 2 {
		t.Fatalf("org A activity: total=%d err=%v", total, err)
	}
	for _, entry := range inA {
		if entry.Organization == nil || entry.Organization.UUID != orgA.Uuid || entry.Payload["name"] != "x" {
			t.Fatalf("org A entry: %+v", entry)
		}
	}
	created, total, err := svc.ListActivity(e.ctx, u.Uuid, model.UserActivityFilter{OrganizationUUID: &a, Action: "customers.created"}, 20, 0)
	if err != nil || total != 1 || len(created) != 1 {
		t.Fatalf("action filter: total=%d err=%v", total, err)
	}
	page, total, err := svc.ListActivity(e.ctx, u.Uuid, model.UserActivityFilter{}, 2, 2)
	if err != nil || total != 4 || len(page) != 2 {
		t.Fatalf("paging: len=%d total=%d err=%v", len(page), total, err)
	}
	missing := uuid.New()
	if _, _, err := svc.ListActivity(e.ctx, u.Uuid, model.UserActivityFilter{OrganizationUUID: &missing}, 20, 0); !errors.Is(err, usecase.ErrNotFound) {
		t.Fatalf("unknown org filter: %v", err)
	}
}
