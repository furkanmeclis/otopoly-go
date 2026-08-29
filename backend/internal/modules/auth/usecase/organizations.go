package usecase

import (
	"context"
	"errors"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
	"github.com/google/uuid"
)

var (
	ErrNoTenantMembership        = errors.New("no tenant membership")
	ErrOrganizationAccessExpired = errors.New("organization access expired")
	ErrOrganizationSuspended     = errors.New("organization suspended")
)

// OrganizationResolver resolves tenant membership for auth flows.
type OrganizationResolver interface {
	ResolveLoginOrganization(ctx context.Context, userID int64, slug string) (uuid.UUID, error)
	ListMembershipsForUser(ctx context.Context, userID int64) ([]orgusecase.MembershipSummary, error)
}

// SetOrganizationResolver wires tenant membership lookups.
func (u *AuthUseCase) SetOrganizationResolver(resolver OrganizationResolver) {
	u.orgResolver = resolver
}

// IssueSessionForOrganization issues tokens scoped to an organization.
func (u *AuthUseCase) IssueSessionForOrganization(ctx context.Context, userUUID, orgUUID uuid.UUID, meta model.SessionMeta) (model.Tokens, error) {
	user, err := u.repo.FindUserByUUID(ctx, userUUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return model.Tokens{}, ErrInvalidCredentials
		}
		return model.Tokens{}, err
	}
	if user.Status != "active" {
		return model.Tokens{}, ErrUserDisabled
	}
	if err := u.repo.UpdateLastLogin(ctx, user.ID); err != nil {
		return model.Tokens{}, err
	}
	return u.issueTokensForUser(ctx, user, meta, &orgUUID)
}

func mapOrganizationSummaries(items []orgusecase.MembershipSummary) []model.OrganizationSummary {
	out := make([]model.OrganizationSummary, 0, len(items))
	for _, item := range items {
		out = append(out, model.OrganizationSummary{
			UUID: item.UUID, Slug: item.Slug, Name: item.Name, Role: item.Role,
			LogoURL: item.LogoURL, Status: item.Status, AccessEndsAt: item.AccessEndsAt,
		})
	}
	return out
}

func mapOrganizationError(err error) error {
	switch {
	case errors.Is(err, orgusecase.ErrNoTenantMembership):
		return ErrNoTenantMembership
	case errors.Is(err, orgusecase.ErrOrganizationAccessExpired):
		return ErrOrganizationAccessExpired
	case errors.Is(err, orgusecase.ErrOrganizationSuspended):
		return ErrOrganizationSuspended
	default:
		return err
	}
}
