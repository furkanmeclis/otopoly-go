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
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/password"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourcemeta"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
	ErrConflict       = errors.New("conflict")
)

type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
	act  *activity.Recorder
}

func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder) *Service {
	return &Service{pool: pool, q: q, act: act}
}

func (s *Service) ResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantStaff()
}

func (s *Service) requireOrgID(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, errors.New("organization context required")
	}
	return scope.InternalID, nil
}

func (s *Service) recordActivity(ctx context.Context, action, resource string, resourceUUID *uuid.UUID, payload map[string]any) {
	if s.act == nil {
		return
	}
	var actorID *int64
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		id := p.UserInternal
		actorID = &id
	}
	s.act.Record(ctx, actorID, action, resource, resourceUUID, payload, nil)
}

type Member struct {
	UUID      uuid.UUID `json:"uuid"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Surname   string    `json:"surname"`
	Status    string    `json:"status"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

type MemberOption struct {
	UUID    uuid.UUID `json:"uuid"`
	Email   string    `json:"email"`
	Name    string    `json:"name"`
	Surname string    `json:"surname"`
	Role    string    `json:"role"`
	Label   string    `json:"label"`
}

type CreateInput struct {
	Name     string `json:"name"`
	Surname  string `json:"surname"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type ResetPasswordInput struct {
	Password string `json:"password"`
}

type PatchInput struct {
	Status *string `json:"status"`
}

func (s *Service) List(ctx context.Context) ([]Member, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListOrganizationMembers(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := make([]Member, 0, len(rows))
	for _, row := range rows {
		if row.Role != "staff" {
			continue
		}
		out = append(out, Member{
			UUID:      row.Uuid,
			Email:     row.Email,
			Name:      row.Name,
			Surname:   row.Surname,
			Status:    row.Status,
			Role:      row.Role,
			CreatedAt: row.CreatedAt.Time,
		})
	}
	return out, nil
}

func (s *Service) Options(ctx context.Context) ([]MemberOption, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListOrganizationMemberOptions(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := make([]MemberOption, 0, len(rows))
	for _, row := range rows {
		label := strings.TrimSpace(row.Name + " " + row.Surname)
		if label == "" {
			label = row.Email
		}
		out = append(out, MemberOption{
			UUID:    row.Uuid,
			Email:   row.Email,
			Name:    row.Name,
			Surname: row.Surname,
			Role:    row.Role,
			Label:   label,
		})
	}
	return out, nil
}

func (s *Service) Create(ctx context.Context, in CreateInput) (Member, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Member{}, err
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Surname = strings.TrimSpace(in.Surname)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if in.Name == "" || in.Surname == "" || in.Email == "" {
		return Member{}, fmt.Errorf("%w: name, surname, and email are required", ErrInvalidRequest)
	}
	if strings.TrimSpace(in.Password) == "" {
		return Member{}, fmt.Errorf("%w: password is required", ErrInvalidRequest)
	}
	if len(in.Password) < 8 {
		return Member{}, fmt.Errorf("%w: password must be at least 8 characters", ErrInvalidRequest)
	}
	if _, err := s.q.GetUserByEmail(ctx, in.Email); err == nil {
		return Member{}, fmt.Errorf("%w: email already registered", ErrConflict)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Member{}, err
	}
	hash, err := password.Hash(in.Password)
	if err != nil {
		return Member{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Member{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	user, err := qtx.CreateUser(ctx, db.CreateUserParams{
		Email:           in.Email,
		PasswordHash:    hash,
		Name:            in.Name,
		Surname:         in.Surname,
		Status:          "active",
		EmailVerifiedAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
	})
	if err != nil {
		return Member{}, err
	}
	if _, err := qtx.CreateOrganizationMember(ctx, db.CreateOrganizationMemberParams{
		OrganizationID: orgID,
		UserID:         user.ID,
		Role:           "staff",
	}); err != nil {
		return Member{}, err
	}
	if err := qtx.AssignUserRoleBySlug(ctx, db.AssignUserRoleBySlugParams{
		UserID: user.ID,
		Slug:   rbac.RoleOrganizationUser,
	}); err != nil {
		return Member{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Member{}, err
	}
	m := Member{
		UUID:      user.Uuid,
		Email:     user.Email,
		Name:      user.Name,
		Surname:   user.Surname,
		Status:    user.Status,
		Role:      "staff",
		CreatedAt: user.CreatedAt.Time,
	}
	s.recordActivity(ctx, "staff.create", "tenant.staff", &user.Uuid, map[string]any{"email": user.Email})
	return m, nil
}

func (s *Service) Patch(ctx context.Context, userUUID uuid.UUID, in PatchInput) (Member, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Member{}, err
	}
	row, err := s.q.GetOrganizationMemberByUserUUID(ctx, db.GetOrganizationMemberByUserUUIDParams{
		OrganizationID: orgID,
		Uuid:           userUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Member{}, ErrNotFound
		}
		return Member{}, err
	}
	if row.Role != "staff" {
		return Member{}, fmt.Errorf("%w: only staff members can be managed here", ErrInvalidRequest)
	}
	if in.Status == nil {
		return Member{}, fmt.Errorf("%w: status is required", ErrInvalidRequest)
	}
	status := strings.TrimSpace(*in.Status)
	if status != "active" && status != "inactive" {
		return Member{}, fmt.Errorf("%w: status must be active or inactive", ErrInvalidRequest)
	}
	updated, err := s.q.UpdateUserPlatform(ctx, db.UpdateUserPlatformParams{
		Uuid:   userUUID,
		Status: pgtype.Text{String: status, Valid: true},
	})
	if err != nil {
		return Member{}, err
	}
	m := Member{
		UUID:      updated.Uuid,
		Email:     updated.Email,
		Name:      updated.Name,
		Surname:   updated.Surname,
		Status:    updated.Status,
		Role:      row.Role,
		CreatedAt: row.CreatedAt.Time,
	}
	s.recordActivity(ctx, "staff.update", "tenant.staff", &userUUID, map[string]any{"status": status})
	return m, nil
}

func (s *Service) ResetPassword(ctx context.Context, userUUID uuid.UUID, in ResetPasswordInput) error {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.GetOrganizationMemberByUserUUID(ctx, db.GetOrganizationMemberByUserUUIDParams{
		OrganizationID: orgID,
		Uuid:           userUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if row.Role != "staff" {
		return fmt.Errorf("%w: only staff members can be managed here", ErrInvalidRequest)
	}
	if strings.TrimSpace(in.Password) == "" {
		return fmt.Errorf("%w: password is required", ErrInvalidRequest)
	}
	if len(in.Password) < 8 {
		return fmt.Errorf("%w: password must be at least 8 characters", ErrInvalidRequest)
	}
	hash, err := password.Hash(in.Password)
	if err != nil {
		return err
	}
	if err := s.q.UpdateUserPasswordByID(ctx, db.UpdateUserPasswordByIDParams{
		ID:           row.UserID,
		PasswordHash: hash,
	}); err != nil {
		return err
	}
	s.recordActivity(ctx, "staff.reset_password", "tenant.staff", &userUUID, nil)
	return nil
}
