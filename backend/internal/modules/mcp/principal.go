package mcp

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	oauthmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
	oauthusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/jackc/pgx/v5"
)

// ErrForbidden: the token is valid but its user may no longer act there
// (membership or the connect permission lost, organization suspended or
// expired). The endpoint answers 403.
var ErrForbidden = errors.New("mcp: forbidden")

// Principal is who a tool call runs as: the token's user with the
// permissions held now, and on /mcp/org the organization scope.
type Principal struct {
	Realm string
	Auth  authctx.Principal
	// Scope is the organization of an /mcp/org token (zero on the platform
	// endpoint).
	Scope orgctx.Scope
	// ReadOnly is set when the organization's subscription is read only:
	// write tools are not offered (same rule as the panel).
	ReadOnly bool
	// Scopes are the OAuth scopes of the token.
	Scopes []string
}

// CanWrite reports whether write tools may run: the token carries
// mcp:write and the organization is not read only.
func (p Principal) CanWrite() bool {
	if p.ReadOnly {
		return false
	}
	for _, s := range p.Scopes {
		if s == oauthmodel.ScopeWrite {
			return true
		}
	}
	return false
}

// AccessResolver reads a user's stored roles and permissions
// (*authusecase.AuthUseCase).
type AccessResolver interface {
	ResolveUserAccess(ctx context.Context, userID int64) (roles []string, isSuperAdmin bool, perms []string, err error)
}

// PrincipalQueries are the reads of the resolver (*db.Queries).
type PrincipalQueries interface {
	GetUserByID(ctx context.Context, id int64) (db.User, error)
	GetOrganizationByID(ctx context.Context, id int64) (db.Organization, error)
	GetOrganizationMemberByUserAndOrgUUID(ctx context.Context, arg db.GetOrganizationMemberByUserAndOrgUUIDParams) (db.GetOrganizationMemberByUserAndOrgUUIDRow, error)
}

// StoreResolver builds the principal of a token on every request, so a lost
// membership, role or permission applies at once.
type StoreResolver struct {
	Q      PrincipalQueries
	Access AccessResolver
	Now    func() time.Time
}

// Resolve implements Resolver.
func (s StoreResolver) Resolve(ctx context.Context, tok oauthmodel.AccessToken) (Principal, error) {
	user, err := s.Q.GetUserByID(ctx, tok.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, ErrForbidden
	}
	if err != nil {
		return Principal{}, fmt.Errorf("mcp: user: %w", err)
	}
	if !oauthusecase.UserActive(user) {
		return Principal{}, ErrForbidden
	}
	roles, superAdmin, perms, err := s.Access.ResolveUserAccess(ctx, user.ID)
	if err != nil {
		return Principal{}, fmt.Errorf("mcp: access: %w", err)
	}
	p := Principal{
		Realm: oauthmodel.RealmOf(tok.Resource), Scopes: tok.Scopes,
		Auth: authctx.Principal{
			UserID: user.Uuid, UserInternal: user.ID, Email: user.Email,
			Roles: roles, Permissions: perms, IsSuperAdmin: superAdmin,
		},
	}
	if tok.Resource == oauthmodel.ResourcePlatform {
		if !p.Auth.HasPermission(rbac.PermPlatformMCPConnect) {
			return Principal{}, ErrForbidden
		}
		return p, nil
	}
	if tok.OrganizationID <= 0 || !p.Auth.HasPermission(rbac.PermTenantMCPConnect) {
		return Principal{}, ErrForbidden
	}
	org, err := s.Q.GetOrganizationByID(ctx, tok.OrganizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, ErrForbidden
	}
	if err != nil {
		return Principal{}, fmt.Errorf("mcp: organization: %w", err)
	}
	member, err := s.Q.GetOrganizationMemberByUserAndOrgUUID(ctx, db.GetOrganizationMemberByUserAndOrgUUIDParams{UserID: user.ID, Uuid: org.Uuid})
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, ErrForbidden
	}
	if err != nil {
		return Principal{}, fmt.Errorf("mcp: membership: %w", err)
	}
	if !s.orgOpen(member) {
		return Principal{}, ErrForbidden
	}
	orgUUID := member.OrganizationUuid
	p.Auth.OrganizationUUID = &orgUUID
	p.Scope = orgctx.Scope{
		InternalID: member.OrganizationID, UUID: member.OrganizationUuid, Slug: member.OrganizationSlug,
		Name: member.OrganizationName, MemberRole: member.Role,
	}
	p.ReadOnly = member.SubscriptionStatus == "read_only"
	return p, nil
}

// orgOpen mirrors the panel organization gate (RequireOrganization):
// suspended or expired organizations and closed access windows are refused.
func (s StoreResolver) orgOpen(m db.GetOrganizationMemberByUserAndOrgUUIDRow) bool {
	if m.OrganizationStatus == "suspended" || m.OrganizationStatus == "expired" {
		return false
	}
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	if m.AccessStartsAt.Valid && m.AccessStartsAt.Time.After(now) {
		return false
	}
	if m.AccessEndsAt.Valid && !m.AccessEndsAt.Time.After(now) {
		return false
	}
	return true
}
