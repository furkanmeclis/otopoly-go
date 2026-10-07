package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	// ErrMemberNotFound: the user is not a member of the organization.
	ErrMemberNotFound = errors.New("member not found")
	// ErrLastOwner: the change would leave the organization without an owner.
	ErrLastOwner = errors.New("organization must keep at least one owner")
)

// Member is a platform-admin view of an organization member.
type Member struct {
	UUID      uuid.UUID `json:"uuid"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Surname   string    `json:"surname"`
	Status    string    `json:"status"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

// SetActivity attaches the audit recorder (optional).
func (s *Service) SetActivity(act *activity.Recorder) {
	s.act = act
}

func (s *Service) recordActivity(ctx context.Context, action string, org db.Organization, payload map[string]any) {
	if s.act == nil {
		return
	}
	orgUUID := org.Uuid
	var actorID *int64
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		id := p.UserInternal
		actorID = &id
	}
	s.act.Record(activity.WithOrganization(ctx, org.ID), actorID, action, "platform.organizations", &orgUUID, payload, nil)
}

func validMemberRole(role string) bool {
	return role == "owner" || role == "staff"
}

// memberTx loads the organization, locks it for the duration of tx (so two
// concurrent changes cannot both pass the last-owner check) and returns the
// target membership.
func (s *Service) memberTx(ctx context.Context, qtx *db.Queries, orgUUID, userUUID uuid.UUID) (db.Organization, db.GetOrganizationMemberByUserUUIDRow, error) {
	org, err := qtx.GetOrganizationByUUID(ctx, orgUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Organization{}, db.GetOrganizationMemberByUserUUIDRow{}, ErrNotFound
		}
		return db.Organization{}, db.GetOrganizationMemberByUserUUIDRow{}, err
	}
	if err := qtx.LockOrganizationMembers(ctx, org.ID); err != nil {
		return db.Organization{}, db.GetOrganizationMemberByUserUUIDRow{}, err
	}
	row, err := qtx.GetOrganizationMemberByUserUUID(ctx, db.GetOrganizationMemberByUserUUIDParams{
		OrganizationID: org.ID, Uuid: userUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Organization{}, db.GetOrganizationMemberByUserUUIDRow{}, ErrMemberNotFound
		}
		return db.Organization{}, db.GetOrganizationMemberByUserUUIDRow{}, err
	}
	return org, row, nil
}

// ensureAnotherOwner fails with ErrLastOwner when the member is the only owner.
func ensureAnotherOwner(ctx context.Context, qtx *db.Queries, orgID int64, role string) error {
	if role != "owner" {
		return nil
	}
	owners, err := qtx.CountOrganizationOwners(ctx, orgID)
	if err != nil {
		return err
	}
	if owners <= 1 {
		return ErrLastOwner
	}
	return nil
}

// syncMembershipRoles keeps the global organization_owner / organization_user
// roles (granted by AddMember and business creation) in line with the
// memberships the user still has.
func syncMembershipRoles(ctx context.Context, qtx *db.Queries, userID int64) error {
	counts, err := qtx.CountOrganizationMembershipsByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if counts.Owners == 0 {
		if err := qtx.RemoveUserRoleBySlug(ctx, db.RemoveUserRoleBySlugParams{
			UserID: userID, Slug: rbac.RoleOrganizationOwner,
		}); err != nil {
			return err
		}
	} else if err := qtx.AssignUserRoleBySlug(ctx, db.AssignUserRoleBySlugParams{
		UserID: userID, Slug: rbac.RoleOrganizationOwner,
	}); err != nil {
		return err
	}
	if counts.Total == 0 {
		return qtx.RemoveUserRoleBySlug(ctx, db.RemoveUserRoleBySlugParams{
			UserID: userID, Slug: rbac.RoleOrganizationUser,
		})
	}
	return nil
}

// ChangeMemberRole switches a member between owner and staff (platform only).
// The last owner cannot be demoted.
func (s *Service) ChangeMemberRole(ctx context.Context, orgUUID, userUUID uuid.UUID, role string) (Member, error) {
	role = strings.TrimSpace(role)
	if !validMemberRole(role) {
		return Member{}, fmt.Errorf("%w: role must be owner or staff", ErrInvalidRequest)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Member{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	org, row, err := s.memberTx(ctx, qtx, orgUUID, userUUID)
	if err != nil {
		return Member{}, err
	}
	member := Member{
		UUID: row.UserUuid, Email: row.Email, Name: row.Name, Surname: row.Surname,
		Status: row.Status, Role: role, CreatedAt: row.CreatedAt.Time,
	}
	if row.Role == role {
		return member, nil
	}
	if err := ensureAnotherOwner(ctx, qtx, org.ID, row.Role); err != nil {
		return Member{}, err
	}
	if _, err := qtx.UpdateOrganizationMemberRole(ctx, db.UpdateOrganizationMemberRoleParams{
		OrganizationID: org.ID, UserID: row.UserID, Role: role,
	}); err != nil {
		return Member{}, err
	}
	if err := syncMembershipRoles(ctx, qtx, row.UserID); err != nil {
		return Member{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Member{}, err
	}
	s.recordActivity(ctx, "organizations.member_role_changed", org, map[string]any{
		"user_uuid": row.UserUuid.String(), "email": row.Email, "from": row.Role, "to": role,
	})
	return member, nil
}

// RemoveMember deletes a membership (platform only). The last owner cannot be
// removed. Refresh sessions bound to the organization are revoked; tenant
// requests are already rejected because RequireOrganization re-checks the
// membership on every call.
func (s *Service) RemoveMember(ctx context.Context, orgUUID, userUUID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	org, row, err := s.memberTx(ctx, qtx, orgUUID, userUUID)
	if err != nil {
		return err
	}
	if err := ensureAnotherOwner(ctx, qtx, org.ID, row.Role); err != nil {
		return err
	}
	if _, err := qtx.DeleteOrganizationMember(ctx, db.DeleteOrganizationMemberParams{
		OrganizationID: org.ID, UserID: row.UserID,
	}); err != nil {
		return err
	}
	if err := qtx.RevokeRefreshTokensForUserOrganization(ctx, db.RevokeRefreshTokensForUserOrganizationParams{
		UserID: row.UserID, OrganizationID: pgtype.Int8{Int64: org.ID, Valid: true},
	}); err != nil {
		return err
	}
	if err := syncMembershipRoles(ctx, qtx, row.UserID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.recordActivity(ctx, "organizations.member_removed", org, map[string]any{
		"user_uuid": row.UserUuid.String(), "email": row.Email, "role": row.Role,
	})
	return nil
}
