package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	searchadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine/adapters"
	"github.com/google/uuid"
)

var (
	// ErrCannotDeleteSelf: a platform admin tried to delete their own account.
	ErrCannotDeleteSelf = errors.New("cannot delete your own account")
	// ErrNotDeleted: restore was called for a user that is not deleted.
	ErrNotDeleted = errors.New("user is not deleted")
	// ErrEmailInUse: the deleted user's email now belongs to another account.
	ErrEmailInUse = errors.New("email is used by another account")
)

// SoleOwnerError blocks deleting a user that is the last owner of one or more
// organizations; ownership must be transferred (or the business closed) first.
type SoleOwnerError struct {
	Organizations []model.OrganizationRef
}

func (e *SoleOwnerError) Error() string {
	return fmt.Sprintf("user is the only owner of %d organization(s)", len(e.Organizations))
}

// DeletePlatformUser soft-deletes a user from platform admin. It reuses the
// self-service deactivation cleanup (refresh sessions revoked, Apple tokens
// revoked best effort) and additionally detaches push devices, OAuth
// identities and passkeys so they can be reused; the email becomes free for a
// new account because the unique index only covers non-deleted users.
//
// Guards: an admin cannot delete themselves, the last active super admin
// cannot be deleted, only super admins delete super admins, and a user that
// is the only owner of an organization is rejected with SoleOwnerError.
func (u *AuthUseCase) DeletePlatformUser(ctx context.Context, actorUUID, targetUUID uuid.UUID) (model.PublicUser, error) {
	if actorUUID == targetUUID {
		return model.PublicUser{}, ErrCannotDeleteSelf
	}
	user, err := u.repo.FindUserByUUID(ctx, targetUUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return model.PublicUser{}, ErrNotFound
		}
		return model.PublicUser{}, err
	}
	isSA, err := u.repo.UserHasRoleSlug(ctx, user.ID, rbac.RoleSuperAdmin)
	if err != nil {
		return model.PublicUser{}, err
	}
	if isSA {
		if !actorIsSuperAdmin(ctx) {
			return model.PublicUser{}, fmt.Errorf("%w: only a super admin can delete a super admin", ErrForbidden)
		}
		// CountUsersWithRole ignores disabled and deleted users; deleting the
		// only one left would lock everybody out of the platform.
		if user.Status != "disabled" {
			n, err := u.repo.CountUsersWithRole(ctx, rbac.RoleSuperAdmin)
			if err != nil {
				return model.PublicUser{}, err
			}
			if n <= 1 {
				return model.PublicUser{}, ErrLastSuperAdmin
			}
		}
	}
	owned, err := u.repo.ListSoleOwnedOrganizations(ctx, user.ID)
	if err != nil {
		return model.PublicUser{}, err
	}
	if len(owned) > 0 {
		return model.PublicUser{}, &SoleOwnerError{Organizations: owned}
	}

	// Apple must be told before the identities are detached (best effort).
	u.revokeAppleTokens(ctx, user.ID)
	deleted, err := u.repo.SoftDeleteUser(ctx, user.ID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return model.PublicUser{}, ErrNotFound
		}
		return model.PublicUser{}, err
	}
	if u.searchIndexer != nil {
		u.searchIndexer.EnqueueDelete(ctx, searchadapters.SpecUsers, user.UUID.String())
	}
	return model.ToPublicUser(deleted, isSA), nil
}

// RestorePlatformUser clears deleted_at when the email is still free. Revoked
// sessions, push devices, OAuth identities and passkeys are not restored: the
// user signs in again with a password (or sets one via reset).
func (u *AuthUseCase) RestorePlatformUser(ctx context.Context, targetUUID uuid.UUID) (model.PublicUser, error) {
	user, err := u.repo.FindUserByUUIDIncludingDeleted(ctx, targetUUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return model.PublicUser{}, ErrNotFound
		}
		return model.PublicUser{}, err
	}
	if user.DeletedAt == nil {
		return model.PublicUser{}, ErrNotDeleted
	}
	if other, err := u.repo.FindUserByEmail(ctx, user.Email); err == nil && other.ID != user.ID {
		return model.PublicUser{}, ErrEmailInUse
	} else if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return model.PublicUser{}, err
	}
	restored, err := u.repo.RestoreUser(ctx, user.ID)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrEmailTaken):
			return model.PublicUser{}, ErrEmailInUse
		case errors.Is(err, repository.ErrNotFound):
			return model.PublicUser{}, ErrNotDeleted
		}
		return model.PublicUser{}, err
	}
	isSA, err := u.repo.UserHasRoleSlug(ctx, restored.ID, rbac.RoleSuperAdmin)
	if err != nil {
		return model.PublicUser{}, err
	}
	u.indexUserSearch(ctx, restored.UUID.String())
	return model.ToPublicUser(restored, isSA), nil
}
