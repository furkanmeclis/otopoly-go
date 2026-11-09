package repository_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestAccountDeletionScheduleRecoverAndAnonymizeDB(t *testing.T) {
	e := newDeleteDBEnv(t)
	ctx := context.Background()
	email := "anontest-" + uuid.NewString()[:8] + "@example.com"
	u := e.user(t, email)
	staff := e.user(t, "anonstaff-"+uuid.NewString()[:8]+"@example.com")
	org := e.org(t, u)
	if _, err := e.q.CreateOrganizationMember(ctx, db.CreateOrganizationMemberParams{
		OrganizationID: org.ID, UserID: staff.ID, Role: "staff",
	}); err != nil {
		t.Fatal(err)
	}

	// Schedule → recover → schedule again.
	pending, err := e.repo.ScheduleUserDeletion(ctx, u.ID, "2026-12-10")
	if err != nil {
		t.Fatal(err)
	}
	if !pending.PendingDeletion() || pending.Status != "disabled" || pending.DeactivatedAt == nil || pending.DeletionScheduledOn != "2026-12-10" {
		t.Fatalf("pending: %+v", pending)
	}
	if _, err := e.repo.ScheduleUserDeletion(ctx, u.ID, "2026-12-11"); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("double schedule: %v", err)
	}
	recovered, err := e.repo.CancelUserDeletion(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Status != "active" || recovered.DeactivatedAt != nil || recovered.PendingDeletion() {
		t.Fatalf("recovered: %+v", recovered)
	}
	if _, err := e.repo.ScheduleUserDeletion(ctx, u.ID, "2026-12-10"); err != nil {
		t.Fatal(err)
	}

	owned, err := e.repo.ListOwnedOrganizations(ctx, u.ID)
	if err != nil || len(owned) != 1 || owned[0].OtherMembers != 1 || owned[0].OtherOwners != 0 {
		t.Fatalf("owned: %+v %v", owned, err)
	}

	// Personal data around the account.
	if _, err := e.q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		UserID: u.ID, TokenHash: "anontest-" + uuid.NewString(),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.q.UpsertPushDevice(ctx, db.UpsertPushDeviceParams{
		UserID: u.ID, Token: "ExponentPushToken[" + uuid.NewString() + "]", Platform: "ios", Locale: "tr",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.q.CreateOAuthAccount(ctx, db.CreateOAuthAccountParams{
		UserID: u.ID, Provider: "google", ProviderAccountID: "g-" + uuid.NewString(), Type: "oidc",
	}); err != nil {
		t.Fatal(err)
	}
	mustExec := func(sql string, args ...any) {
		t.Helper()
		if _, err := e.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(`INSERT INTO otp_codes (user_id, email, code_hash, type, expires_at) VALUES ($1, $2, 'h', 'login_code', NOW() + interval '1 hour')`, u.ID, email)
	mustExec(`INSERT INTO notifications (user_id, channel, title, body, recipient) VALUES ($1, 'email', 'Hi', 'Hello Del', $2)`, u.ID, email)
	mustExec(`INSERT INTO notification_member_settings (user_id, organization_id, phone) VALUES ($1, $2, '+905551112233')`, u.ID, org.ID)
	mustExec(`INSERT INTO activity_events (actor_user_id, action, ip_address, user_agent) VALUES ($1, 'test.anon', '10.0.0.1', 'UA')`, u.ID)

	// The job does not touch accounts before their day.
	anon := usecase.NewAccountAnonymizer(e.repo, nil, nil)
	anon.SetClock(func() time.Time { return time.Date(2026, 12, 9, 12, 0, 0, 0, time.UTC) })
	if _, err := anon.AnonymizeDue(ctx); err != nil {
		t.Fatal(err)
	}
	if got, _ := e.repo.FindUserByEmail(ctx, email); got.ID != u.ID {
		t.Fatal("anonymized before the scheduled day")
	}

	before, after, err := e.repo.AnonymizeUser(ctx, u.ID, model.AnonymizedIdentity{
		Email: "deleted-" + uuid.NewString() + "@anonymized.invalid", PasswordHash: "!anonymized",
		Name: usecase.AnonymizedName, Surname: usecase.AnonymizedSurname,
	})
	if err != nil {
		t.Fatalf("anonymize: %v", err)
	}
	if before.Email != email || after.AnonymizedAt == nil || after.DeletedAt == nil ||
		!strings.HasSuffix(after.Email, "@anonymized.invalid") || after.Name != usecase.AnonymizedName {
		t.Fatalf("after: %+v", after)
	}
	if _, _, err := e.repo.AnonymizeUser(ctx, u.ID, model.AnonymizedIdentity{Email: "x@anonymized.invalid"}); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("second anonymize: %v", err)
	}
	for name, sql := range map[string]string{
		"refresh_tokens":               `SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`,
		"push_devices":                 `SELECT COUNT(*) FROM push_devices WHERE user_id = $1`,
		"oauth_accounts":               `SELECT COUNT(*) FROM oauth_accounts WHERE user_id = $1`,
		"otp_codes":                    `SELECT COUNT(*) FROM otp_codes WHERE user_id = $1`,
		"notifications":                `SELECT COUNT(*) FROM notifications WHERE user_id = $1`,
		"notification_member_settings": `SELECT COUNT(*) FROM notification_member_settings WHERE user_id = $1`,
		"activity ip":                  `SELECT COUNT(*) FROM activity_events WHERE actor_user_id = $1 AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)`,
	} {
		if n := e.count(t, sql, u.ID); n != 0 {
			t.Fatalf("%s left: %d", name, n)
		}
	}
	// Business side stays: audit row, membership, organization.
	if n := e.count(t, `SELECT COUNT(*) FROM activity_events WHERE actor_user_id = $1`, u.ID); n != 1 {
		t.Fatalf("audit rows: %d", n)
	}
	if n := e.count(t, `SELECT COUNT(*) FROM organization_members WHERE user_id = $1 AND organization_id = $2`, u.ID, org.ID); n != 1 {
		t.Fatal("membership must be kept")
	}
	if n := e.count(t, `SELECT COUNT(*) FROM organizations WHERE id = $1 AND deleted_at IS NULL`, org.ID); n != 1 {
		t.Fatal("organization must be kept")
	}
	if _, err := e.repo.FindUserByEmail(ctx, email); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("old email still resolves: %v", err)
	}
	// Anonymized accounts are final.
	if _, err := e.uc.RestorePlatformUser(e.ctx, u.Uuid); !errors.Is(err, usecase.ErrAccountAnonymized) {
		t.Fatalf("restore: %v", err)
	}
}

func TestAnonymizeDueRunsOnScheduledIstanbulDayDB(t *testing.T) {
	e := newDeleteDBEnv(t)
	ctx := context.Background()
	u := e.user(t, "anonday-"+uuid.NewString()[:8]+"@example.com")
	if _, err := e.repo.ScheduleUserDeletion(ctx, u.ID, "2026-12-10"); err != nil {
		t.Fatal(err)
	}
	anon := usecase.NewAccountAnonymizer(e.repo, nil, nil)
	// 21:30 UTC on 9 Dec = 00:30 on 10 Dec in Istanbul.
	anon.SetClock(func() time.Time { return time.Date(2026, 12, 9, 21, 30, 0, 0, time.UTC) })
	if _, err := anon.AnonymizeDue(ctx); err != nil {
		t.Fatal(err)
	}
	if n := e.count(t, `SELECT COUNT(*) FROM users WHERE id = $1 AND anonymized_at IS NOT NULL`, u.ID); n != 1 {
		t.Fatal("due account not anonymized on its Istanbul day")
	}
}
