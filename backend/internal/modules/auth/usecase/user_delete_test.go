package usecase

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/password"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

type deleteEnv struct {
	repo  *memRepo
	uc    *AuthUseCase
	admin model.User
	ctx   context.Context
}

func newDeleteEnv(t *testing.T) *deleteEnv {
	t.Helper()
	repo := newMemRepo()
	tokens, err := jwt.NewManager("test-secret-key-32-bytes-minimum!", time.Minute, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	uc := New(repo, tokens)
	uc.SetAuthSettings(testAuthGate{passwordRegister: true, passwordLogin: true, passkeyLogin: true, registration: true})
	hash, _ := password.Hash("Password1!")
	admin, _, err := repo.UpsertSuperAdmin(context.Background(), "admin@example.com", "Ada", "Admin", hash)
	if err != nil {
		t.Fatal(err)
	}
	ctx := authctx.WithPrincipal(context.Background(), authctx.Principal{
		UserID: admin.UUID, UserInternal: admin.ID, IsSuperAdmin: true,
	})
	return &deleteEnv{repo: repo, uc: uc, admin: admin, ctx: ctx}
}

func (e *deleteEnv) user(t *testing.T, email string) model.User {
	t.Helper()
	hash, _ := password.Hash("Password1!")
	u, err := e.repo.CreateUser(context.Background(), model.User{
		Email: email, PasswordHash: hash, Name: "Test", Surname: "User", Status: "active",
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestDeletePlatformUserCannotDeleteSelf(t *testing.T) {
	e := newDeleteEnv(t)
	if _, err := e.uc.DeletePlatformUser(e.ctx, e.admin.UUID, e.admin.UUID); !errors.Is(err, ErrCannotDeleteSelf) {
		t.Fatalf("expected ErrCannotDeleteSelf, got %v", err)
	}
}

func TestDeletePlatformUserLastSuperAdmin(t *testing.T) {
	e := newDeleteEnv(t)
	// The actor is a second (disabled) super admin deleting the only active one.
	other := e.user(t, "other@example.com")
	other.Status = "disabled"
	e.repo.users[other.ID], e.repo.byUUID[other.UUID], e.repo.byEmail[other.Email] = other, other, other
	e.repo.userRoles[other.ID] = []string{rbac.RoleSuperAdmin}
	if _, err := e.uc.DeletePlatformUser(e.ctx, other.UUID, e.admin.UUID); !errors.Is(err, ErrLastSuperAdmin) {
		t.Fatalf("expected ErrLastSuperAdmin, got %v", err)
	}
	if _, err := e.repo.FindUserByUUID(context.Background(), e.admin.UUID); err != nil {
		t.Fatalf("last super admin must still exist: %v", err)
	}

	// With a second active super admin the delete goes through.
	second := e.user(t, "second@example.com")
	e.repo.userRoles[second.ID] = []string{rbac.RoleSuperAdmin}
	if _, err := e.uc.DeletePlatformUser(e.ctx, second.UUID, e.admin.UUID); err != nil {
		t.Fatalf("delete with another super admin: %v", err)
	}
}

func TestDeletePlatformUserSuperAdminNeedsSuperAdminActor(t *testing.T) {
	e := newDeleteEnv(t)
	target := e.user(t, "sa2@example.com")
	e.repo.userRoles[target.ID] = []string{rbac.RoleSuperAdmin}
	ctx := authctx.WithPrincipal(context.Background(), authctx.Principal{UserID: uuid.New(), IsSuperAdmin: false})
	if _, err := e.uc.DeletePlatformUser(ctx, uuid.New(), target.UUID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestDeletePlatformUserSoleOwnerBlocked(t *testing.T) {
	e := newDeleteEnv(t)
	owner := e.user(t, "owner@example.com")
	orgs := []model.OrganizationRef{
		{UUID: uuid.New(), Slug: "oto-a", Name: "Oto A"},
		{UUID: uuid.New(), Slug: "oto-b", Name: "Oto B"},
	}
	e.repo.soleOwned[owner.ID] = orgs
	_, err := e.uc.DeletePlatformUser(e.ctx, e.admin.UUID, owner.UUID)
	var sole *SoleOwnerError
	if !errors.As(err, &sole) {
		t.Fatalf("expected SoleOwnerError, got %v", err)
	}
	if len(sole.Organizations) != 2 || sole.Organizations[1].Slug != "oto-b" {
		t.Fatalf("organizations = %+v", sole.Organizations)
	}
	if _, err := e.repo.FindUserByUUID(context.Background(), owner.UUID); err != nil {
		t.Fatalf("blocked user must not be deleted: %v", err)
	}
}

func TestDeletePlatformUserFreesEmailAndRestore(t *testing.T) {
	e := newDeleteEnv(t)
	target := e.user(t, "gone@example.com")

	out, err := e.uc.DeletePlatformUser(e.ctx, e.admin.UUID, target.UUID)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if out.DeletedAt == nil {
		t.Fatal("deleted_at must be set in the response")
	}
	if _, err := e.uc.Login(context.Background(), "gone@example.com", "Password1!", "", "", model.SessionMeta{}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("deleted user must not sign in, got %v", err)
	}
	if _, err := e.uc.LoadUserByUUID(context.Background(), target.UUID); err == nil {
		t.Fatal("access tokens of a deleted user must stop resolving")
	}
	detail, err := e.uc.GetPlatformUser(e.ctx, target.UUID)
	if err != nil || detail.DeletedAt == nil {
		t.Fatalf("platform detail of deleted user: %+v, %v", detail, err)
	}
	items, total, err := e.uc.ListPlatformUsers(e.ctx, 20, 0, "", UserStatusDeleted, "")
	if err != nil || total != 1 || items[0].UUID != target.UUID {
		t.Fatalf("deleted filter: total=%d items=%+v err=%v", total, items, err)
	}
	if _, err := e.uc.DeletePlatformUser(e.ctx, e.admin.UUID, target.UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete must be not found, got %v", err)
	}

	// The email is free again: a new account takes it, so restore must refuse.
	newcomer, err := e.uc.Register(context.Background(), model.RegisterInput{
		Email: "gone@example.com", Password: "Password1!", Name: "New", Surname: "Comer",
	})
	if err != nil {
		t.Fatalf("re-register with freed email: %v", err)
	}
	if _, err := e.uc.RestorePlatformUser(e.ctx, target.UUID); !errors.Is(err, ErrEmailInUse) {
		t.Fatalf("expected ErrEmailInUse, got %v", err)
	}

	// Once the newcomer is gone the original account can come back.
	if _, err := e.uc.DeletePlatformUser(e.ctx, e.admin.UUID, newcomer.UUID); err != nil {
		t.Fatalf("delete newcomer: %v", err)
	}
	restored, err := e.uc.RestorePlatformUser(e.ctx, target.UUID)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.DeletedAt != nil {
		t.Fatal("restored user must not carry deleted_at")
	}
	if _, err := e.uc.RestorePlatformUser(e.ctx, target.UUID); !errors.Is(err, ErrNotDeleted) {
		t.Fatalf("restoring a live user: got %v", err)
	}
	if _, err := e.uc.Login(context.Background(), "gone@example.com", "Password1!", "", "", model.SessionMeta{}); err != nil {
		t.Fatalf("restored user signs in with the password: %v", err)
	}
}
