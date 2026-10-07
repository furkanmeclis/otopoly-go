package usecase

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	"github.com/google/uuid"
)

// UserInsightsStore is the persistence slice behind the platform 360° user
// detail (implemented by repository.Postgres).
type UserInsightsStore interface {
	FindUserByUUIDIncludingDeleted(ctx context.Context, id uuid.UUID) (model.User, error)
	UserSecuritySummary(ctx context.Context, userID int64) (model.UserSecurityCounts, error)
	ListUserMemberships(ctx context.Context, userID int64, limit, offset int32) ([]model.UserMembership, int64, error)
	ListUserSessions(ctx context.Context, userID int64, limit, offset int32) ([]model.UserSession, int64, error)
	RevokeSession(ctx context.Context, userID int64, sessionUUID uuid.UUID) error
	RevokeAllUserSessions(ctx context.Context, userID int64) (int64, error)
	ListUserPushDevices(ctx context.Context, userID int64, limit, offset int32) ([]model.UserPushDevice, int64, error)
	DeleteUserPushDevice(ctx context.Context, userID int64, deviceUUID uuid.UUID) (model.RemovedPushDevice, error)
	OrganizationIDByUUID(ctx context.Context, id uuid.UUID) (int64, error)
	ListUserActivity(ctx context.Context, userID int64, organizationID *int64, action, search string, limit, offset int32) ([]model.UserActivityEntry, int64, error)
	ListUserAIUsage(ctx context.Context, userID int64, since time.Time) ([]model.UserAIOrganizationRow, error)
}

// OrganizationAIQuota is an organization's monthly assistant quota.
type OrganizationAIQuota struct {
	Enabled   bool
	Limit     int64
	Used      int64
	Unlimited bool
}

// AIQuotaSource reads assistant quota (implemented by an adapter over the AI
// service; nil hides the AI section).
type AIQuotaSource interface {
	CurrentPeriod() (start, end time.Time)
	OrganizationQuota(ctx context.Context, orgUUID uuid.UUID) (OrganizationAIQuota, error)
}

// UserInsights serves the platform 360° user detail.
type UserInsights struct {
	auth  *AuthUseCase
	store UserInsightsStore
	ai    AIQuotaSource
}

// NewUserInsights wires the 360° reads; auth provides the user detail.
func NewUserInsights(auth *AuthUseCase, store UserInsightsStore) *UserInsights {
	return &UserInsights{auth: auth, store: store}
}

// SetAIQuotaSource enables the AI usage section of the overview.
func (s *UserInsights) SetAIQuotaSource(ai AIQuotaSource) {
	s.ai = ai
}

// userID resolves a user including soft-deleted ones (history stays viewable).
func (s *UserInsights) userID(ctx context.Context, id uuid.UUID) (int64, error) {
	user, err := s.store.FindUserByUUIDIncludingDeleted(ctx, id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return user.ID, nil
}

// Overview returns the user detail, security summary, counters and AI usage.
func (s *UserInsights) Overview(ctx context.Context, id uuid.UUID) (model.UserOverview, error) {
	detail, err := s.auth.GetPlatformUser(ctx, id)
	if err != nil {
		return model.UserOverview{}, err
	}
	uid, err := s.userID(ctx, id)
	if err != nil {
		return model.UserOverview{}, err
	}
	summary, err := s.store.UserSecuritySummary(ctx, uid)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return model.UserOverview{}, ErrNotFound
		}
		return model.UserOverview{}, err
	}
	out := model.UserOverview{User: detail, Security: summary.Security, Counts: summary.Counts}
	if s.ai != nil {
		ai, err := s.aiUsage(ctx, uid)
		if err != nil {
			return model.UserOverview{}, err
		}
		out.AI = ai
	}
	return out, nil
}

func (s *UserInsights) aiUsage(ctx context.Context, userID int64) (*model.UserAIUsage, error) {
	start, end := s.ai.CurrentPeriod()
	rows, err := s.store.ListUserAIUsage(ctx, userID, start)
	if err != nil {
		return nil, err
	}
	out := &model.UserAIUsage{PeriodStart: start, PeriodEnd: end, Organizations: make([]model.UserAIOrganizationUsage, 0, len(rows))}
	for _, row := range rows {
		quota, err := s.ai.OrganizationQuota(ctx, row.Organization.UUID)
		if err != nil {
			return nil, err
		}
		out.ConversationCount += row.ConversationCount
		out.Tokens += row.Tokens
		out.Organizations = append(out.Organizations, model.UserAIOrganizationUsage{
			Organization:      row.Organization,
			ConversationCount: row.ConversationCount,
			Tokens:            row.Tokens,
			Enabled:           quota.Enabled,
			QuotaLimit:        quota.Limit,
			QuotaUsed:         quota.Used,
			Unlimited:         quota.Unlimited,
		})
	}
	return out, nil
}

// ListMemberships pages the user's organization memberships.
func (s *UserInsights) ListMemberships(ctx context.Context, id uuid.UUID, limit, offset int32) ([]model.UserMembership, int64, error) {
	uid, err := s.userID(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	return s.store.ListUserMemberships(ctx, uid, limit, offset)
}

// ListSessions pages the user's active sessions (metadata only).
func (s *UserInsights) ListSessions(ctx context.Context, id uuid.UUID, limit, offset int32) ([]model.UserSession, int64, error) {
	uid, err := s.userID(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	return s.store.ListUserSessions(ctx, uid, limit, offset)
}

// RevokeSession revokes one of the user's sessions. A session of another
// user (or an already revoked one) is ErrNotFound.
func (s *UserInsights) RevokeSession(ctx context.Context, id, sessionUUID uuid.UUID) error {
	if sessionUUID == uuid.Nil {
		return fmt.Errorf("%w: session id is required", ErrInvalidRequest)
	}
	uid, err := s.userID(ctx, id)
	if err != nil {
		return err
	}
	if err := s.store.RevokeSession(ctx, uid, sessionUUID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

// RevokeAllSessions revokes every session of the user; returns how many.
func (s *UserInsights) RevokeAllSessions(ctx context.Context, id uuid.UUID) (int64, error) {
	uid, err := s.userID(ctx, id)
	if err != nil {
		return 0, err
	}
	return s.store.RevokeAllUserSessions(ctx, uid)
}

// ListDevices pages the user's push devices.
func (s *UserInsights) ListDevices(ctx context.Context, id uuid.UUID, limit, offset int32) ([]model.UserPushDevice, int64, error) {
	uid, err := s.userID(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	return s.store.ListUserPushDevices(ctx, uid, limit, offset)
}

// RemoveDevice deletes one of the user's push devices. A device of another
// user is ErrNotFound.
func (s *UserInsights) RemoveDevice(ctx context.Context, id, deviceUUID uuid.UUID) (model.RemovedPushDevice, error) {
	if deviceUUID == uuid.Nil {
		return model.RemovedPushDevice{}, fmt.Errorf("%w: device id is required", ErrInvalidRequest)
	}
	uid, err := s.userID(ctx, id)
	if err != nil {
		return model.RemovedPushDevice{}, err
	}
	removed, err := s.store.DeleteUserPushDevice(ctx, uid, deviceUUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return model.RemovedPushDevice{}, ErrNotFound
		}
		return model.RemovedPushDevice{}, err
	}
	return removed, nil
}

// ListActivity pages events the user performed, optionally per organization.
// An unknown organization filter is ErrNotFound.
func (s *UserInsights) ListActivity(
	ctx context.Context, id uuid.UUID, filter model.UserActivityFilter, limit, offset int32,
) ([]model.UserActivityEntry, int64, error) {
	uid, err := s.userID(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	var orgID *int64
	if filter.OrganizationUUID != nil {
		oid, err := s.store.OrganizationIDByUUID(ctx, *filter.OrganizationUUID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				return nil, 0, ErrNotFound
			}
			return nil, 0, err
		}
		orgID = &oid
	}
	return s.store.ListUserActivity(ctx, uid, orgID, filter.Action, filter.Q, limit, offset)
}
