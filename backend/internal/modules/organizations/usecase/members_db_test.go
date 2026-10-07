package usecase_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type membersEnv struct {
	pool *pgxpool.Pool
	q    *db.Queries
	svc  *orgusecase.Service
}

func newMembersEnv(t *testing.T) *membersEnv {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	return &membersEnv{pool: pool, q: q, svc: orgusecase.New(pool, q)}
}

func (e *membersEnv) user(t *testing.T) db.User {
	t.Helper()
	u, err := e.q.CreateUser(context.Background(), db.CreateUserParams{
		Email: "members-" + uuid.NewString()[:8] + "@example.com", PasswordHash: "x",
		Name: "Mem", Surname: "Ber", Status: "active",
		EmailVerifiedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = e.pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, u.ID) })
	return u
}

func (e *membersEnv) org(t *testing.T) db.Organization {
	t.Helper()
	slugValue := "members-" + uuid.NewString()[:8]
	org, err := e.q.CreateOrganization(context.Background(), db.CreateOrganizationParams{
		Slug: slugValue, Name: "Members " + slugValue, Status: "active",
		AccessStartsAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = e.pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, org.ID) })
	return org
}

func (e *membersEnv) add(t *testing.T, org db.Organization, u db.User, role string) {
	t.Helper()
	if err := e.svc.AddMember(context.Background(), org.Uuid, orgusecase.AddMemberInput{UserUUID: u.Uuid, Role: role}); err != nil {
		t.Fatal(err)
	}
}

func (e *membersEnv) refresh(t *testing.T, u db.User, org *db.Organization) {
	t.Helper()
	var orgID pgtype.Int8
	if org != nil {
		orgID = pgtype.Int8{Int64: org.ID, Valid: true}
	}
	if _, err := e.q.CreateRefreshToken(context.Background(), db.CreateRefreshTokenParams{
		UserID: u.ID, TokenHash: "members-" + uuid.NewString(),
		ExpiresAt:      pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
		OrganizationID: orgID,
	}); err != nil {
		t.Fatal(err)
	}
}

func (e *membersEnv) activeTokens(t *testing.T, u db.User) int {
	t.Helper()
	var n int
	if err := e.pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, u.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *membersEnv) hasRole(t *testing.T, u db.User, slug string) bool {
	t.Helper()
	ok, err := e.q.UserHasRoleSlug(context.Background(), db.UserHasRoleSlugParams{UserID: u.ID, Slug: slug})
	if err != nil {
		t.Fatal(err)
	}
	return ok
}

func TestLastOwnerCannotBeRemovedOrDemoted(t *testing.T) {
	e := newMembersEnv(t)
	ctx := context.Background()
	org := e.org(t)
	owner := e.user(t)
	staff := e.user(t)
	e.add(t, org, owner, "owner")
	e.add(t, org, staff, "staff")

	if err := e.svc.RemoveMember(ctx, org.Uuid, owner.Uuid); !errors.Is(err, orgusecase.ErrLastOwner) {
		t.Fatalf("remove last owner: %v", err)
	}
	if _, err := e.svc.ChangeMemberRole(ctx, org.Uuid, owner.Uuid, "staff"); !errors.Is(err, orgusecase.ErrLastOwner) {
		t.Fatalf("demote last owner: %v", err)
	}

	// A deleted co-owner does not count as an owner.
	ghost := e.user(t)
	e.add(t, org, ghost, "owner")
	if _, err := e.q.SoftDeleteUser(ctx, ghost.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.ChangeMemberRole(ctx, org.Uuid, owner.Uuid, "staff"); !errors.Is(err, orgusecase.ErrLastOwner) {
		t.Fatalf("demote with only a deleted co-owner: %v", err)
	}

	// Promote staff, then the original owner can step down and leave.
	m, err := e.svc.ChangeMemberRole(ctx, org.Uuid, staff.Uuid, "owner")
	if err != nil || m.Role != "owner" {
		t.Fatalf("promote: %+v %v", m, err)
	}
	if !e.hasRole(t, staff, rbac.RoleOrganizationOwner) {
		t.Fatal("promoted member must get organization_owner")
	}
	if _, err := e.svc.ChangeMemberRole(ctx, org.Uuid, owner.Uuid, "staff"); err != nil {
		t.Fatalf("demote with another owner: %v", err)
	}
	if e.hasRole(t, owner, rbac.RoleOrganizationOwner) {
		t.Fatal("demoted member without other owned orgs must lose organization_owner")
	}
	if err := e.svc.RemoveMember(ctx, org.Uuid, owner.Uuid); err != nil {
		t.Fatalf("remove former owner: %v", err)
	}
	if _, err := e.svc.ChangeMemberRole(ctx, org.Uuid, staff.Uuid, "bogus"); !errors.Is(err, orgusecase.ErrInvalidRequest) {
		t.Fatalf("invalid role: %v", err)
	}
	if err := e.svc.RemoveMember(ctx, org.Uuid, owner.Uuid); !errors.Is(err, orgusecase.ErrMemberNotFound) {
		t.Fatalf("remove non-member: %v", err)
	}
}

func TestRemoveMemberRevokesOrganizationAccess(t *testing.T) {
	e := newMembersEnv(t)
	ctx := context.Background()
	org := e.org(t)
	other := e.org(t)
	owner := e.user(t)
	member := e.user(t)
	e.add(t, org, owner, "owner")
	e.add(t, org, member, "staff")
	e.add(t, other, member, "staff")

	e.refresh(t, member, &org)   // session bound to the organization
	e.refresh(t, member, &other) // session in another organization
	e.refresh(t, member, nil)    // platform / no-org session
	if n := e.activeTokens(t, member); n != 3 {
		t.Fatalf("setup: %d active tokens", n)
	}

	if err := e.svc.RemoveMember(ctx, org.Uuid, member.Uuid); err != nil {
		t.Fatalf("remove: %v", err)
	}

	// The organization middleware resolves membership per request.
	if _, err := e.q.GetOrganizationMemberByUserAndOrgUUID(ctx, db.GetOrganizationMemberByUserAndOrgUUIDParams{
		UserID: member.ID, Uuid: org.Uuid,
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("membership must be gone for RequireOrganization, got %v", err)
	}
	var revokedOrg, live int
	if err := e.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE organization_id = $2 AND revoked_at IS NOT NULL),
		       COUNT(*) FILTER (WHERE revoked_at IS NULL)
		FROM refresh_tokens WHERE user_id = $1`, member.ID, org.ID).Scan(&revokedOrg, &live); err != nil {
		t.Fatal(err)
	}
	if revokedOrg != 1 || live != 2 {
		t.Fatalf("org session revoked=%d, other sessions live=%d", revokedOrg, live)
	}
	if !e.hasRole(t, member, rbac.RoleOrganizationUser) {
		t.Fatal("member of another organization keeps organization_user")
	}

	if err := e.svc.RemoveMember(ctx, other.Uuid, member.Uuid); err != nil {
		t.Fatalf("remove from other org: %v", err)
	}
	if e.hasRole(t, member, rbac.RoleOrganizationUser) {
		t.Fatal("user without memberships must lose organization_user")
	}
}
