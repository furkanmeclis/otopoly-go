package repository_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type deleteDBEnv struct {
	pool *pgxpool.Pool
	q    *db.Queries
	repo *repository.Postgres
	uc   *usecase.AuthUseCase
	ctx  context.Context
}

func newDeleteDBEnv(t *testing.T) *deleteDBEnv {
	t.Helper()
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
	repo := repository.NewPostgres(pool, q)
	tokens, err := jwt.NewManager("test-secret-key-32-bytes-minimum!", time.Minute, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	actor := authctx.WithPrincipal(ctx, authctx.Principal{UserID: uuid.New(), IsSuperAdmin: true})
	return &deleteDBEnv{pool: pool, q: q, repo: repo, uc: usecase.New(repo, tokens), ctx: actor}
}

func (e *deleteDBEnv) user(t *testing.T, email string) db.User {
	t.Helper()
	u, err := e.q.CreateUser(context.Background(), db.CreateUserParams{
		Email: email, PasswordHash: "x", Name: "Del", Surname: "Test", Status: "active",
		EmailVerifiedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = e.pool.Exec(ctx, `DELETE FROM organizations WHERE id IN (SELECT organization_id FROM organization_members WHERE user_id = $1)`, u.ID)
		_, _ = e.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, u.ID)
	})
	return u
}

func (e *deleteDBEnv) org(t *testing.T, owners ...db.User) db.Organization {
	t.Helper()
	ctx := context.Background()
	slugValue := "deltest-" + uuid.NewString()[:8]
	org, err := e.q.CreateOrganization(ctx, db.CreateOrganizationParams{
		Slug: slugValue, Name: "Del " + slugValue, Status: "active",
		AccessStartsAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = e.pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, org.ID) })
	for _, u := range owners {
		if _, err := e.q.CreateOrganizationMember(ctx, db.CreateOrganizationMemberParams{
			OrganizationID: org.ID, UserID: u.ID, Role: "owner",
		}); err != nil {
			t.Fatal(err)
		}
	}
	return org
}

func (e *deleteDBEnv) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestDeletePlatformUserCleansUpDB(t *testing.T) {
	e := newDeleteDBEnv(t)
	ctx := context.Background()
	email := "deltest-" + uuid.NewString()[:8] + "@example.com"
	u := e.user(t, email)

	if _, err := e.q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		UserID: u.ID, TokenHash: "deltest-" + uuid.NewString(),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.q.UpsertPushDevice(ctx, db.UpsertPushDeviceParams{
		UserID: u.ID, Token: "ExponentPushToken[" + uuid.NewString() + "]", Platform: "ios", Locale: "tr",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.q.UpsertPushSubscription(ctx, db.UpsertPushSubscriptionParams{
		UserID: u.ID, Endpoint: "https://push.example/" + uuid.NewString(), KeyP256dh: "k", KeyAuth: "a",
	}); err != nil {
		t.Fatal(err)
	}
	subject := "apple-" + uuid.NewString()
	if _, err := e.q.CreateOAuthAccount(ctx, db.CreateOAuthAccountParams{
		UserID: u.ID, Provider: "apple", ProviderAccountID: subject, Type: "oidc",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.q.CreateWebAuthnCredential(ctx, db.CreateWebAuthnCredentialParams{
		UserID: u.ID, CredentialID: "cred-" + uuid.NewString(), PublicKey: "pk", DeviceType: "singleDevice",
		ProviderAccountID: "cred",
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := e.uc.DeletePlatformUser(e.ctx, uuid.New(), u.Uuid); err != nil {
		t.Fatalf("delete: %v", err)
	}

	if n := e.count(t, `SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, u.ID); n != 0 {
		t.Fatalf("active refresh tokens left: %d", n)
	}
	for table, n := range map[string]int{
		"push_devices":         e.count(t, `SELECT COUNT(*) FROM push_devices WHERE user_id = $1`, u.ID),
		"push_subscriptions":   e.count(t, `SELECT COUNT(*) FROM push_subscriptions WHERE user_id = $1`, u.ID),
		"oauth_accounts":       e.count(t, `SELECT COUNT(*) FROM oauth_accounts WHERE user_id = $1`, u.ID),
		"webauthn_credentials": e.count(t, `SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = $1`, u.ID),
	} {
		if n != 0 {
			t.Fatalf("%s rows left: %d", table, n)
		}
	}
	if n := e.count(t, `SELECT COUNT(*) FROM users WHERE id = $1 AND deleted_at IS NOT NULL`, u.ID); n != 1 {
		t.Fatal("user row must be kept with deleted_at")
	}

	// The email and the Apple subject are free for a new account.
	fresh := e.user(t, email)
	if _, err := e.q.CreateOAuthAccount(ctx, db.CreateOAuthAccountParams{
		UserID: fresh.ID, Provider: "apple", ProviderAccountID: subject, Type: "oidc",
	}); err != nil {
		t.Fatalf("relink apple subject: %v", err)
	}

	// Restore is refused while the email is taken (index + use case check).
	if _, err := e.repo.RestoreUser(ctx, u.ID); !errors.Is(err, repository.ErrEmailTaken) {
		t.Fatalf("repository restore with taken email: %v", err)
	}
	if _, err := e.uc.RestorePlatformUser(e.ctx, u.Uuid); !errors.Is(err, usecase.ErrEmailInUse) {
		t.Fatalf("use case restore with taken email: %v", err)
	}
	if _, err := e.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, fresh.ID); err != nil {
		t.Fatal(err)
	}
	restored, err := e.uc.RestorePlatformUser(e.ctx, u.Uuid)
	if err != nil || restored.DeletedAt != nil {
		t.Fatalf("restore: %+v %v", restored, err)
	}
}

func TestSoleOwnedOrganizationsDB(t *testing.T) {
	e := newDeleteDBEnv(t)
	ctx := context.Background()
	alice := e.user(t, "deltest-a-"+uuid.NewString()[:8]+"@example.com")
	bob := e.user(t, "deltest-b-"+uuid.NewString()[:8]+"@example.com")
	solo := e.org(t, alice)
	_ = e.org(t, alice, bob) // co-owned: not blocking

	_, err := e.uc.DeletePlatformUser(e.ctx, uuid.New(), alice.Uuid)
	var sole *usecase.SoleOwnerError
	if !errors.As(err, &sole) || len(sole.Organizations) != 1 || sole.Organizations[0].UUID != solo.Uuid {
		t.Fatalf("expected only the solo org to block, got %v", err)
	}

	// Bob may leave: alice still owns the shared org. Afterwards alice is the
	// sole owner of both, because deleted co-owners do not count.
	if _, err := e.uc.DeletePlatformUser(e.ctx, uuid.New(), bob.Uuid); err != nil {
		t.Fatalf("delete co-owner: %v", err)
	}
	owned, err := e.repo.ListSoleOwnedOrganizations(ctx, alice.ID)
	if err != nil || len(owned) != 2 {
		t.Fatalf("after co-owner deletion: %+v %v", owned, err)
	}
}
