package repository

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Platform 360° user detail reads and session / device revocation.

// UserSecuritySummary returns sign-in factor flags and tab counters.
func (r *Postgres) UserSecuritySummary(ctx context.Context, userID int64) (model.UserSecurityCounts, error) {
	row, err := r.q.GetUserSecuritySummary(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.UserSecurityCounts{}, ErrNotFound
		}
		return model.UserSecurityCounts{}, err
	}
	return model.UserSecurityCounts{
		Security: model.UserSecurity{
			CreatedAt:        row.CreatedAt.Time,
			LastLoginAt:      timePtr(row.LastLoginAt),
			EmailVerifiedAt:  timePtr(row.EmailVerifiedAt),
			PasswordSet:      row.PasswordSet,
			TwoFactorEnabled: row.TotpEnabled,
			PasskeyCount:     row.PasskeyCount,
		},
		Counts: model.UserCounts{
			Organizations:       row.OrganizationCount,
			ActiveSessions:      row.ActiveSessionCount,
			PushDevices:         row.PushDeviceCount,
			UnreadNotifications: row.UnreadNotificationCount,
		},
	}, nil
}

// ListUserMemberships pages the user's live organization memberships.
func (r *Postgres) ListUserMemberships(ctx context.Context, userID int64, limit, offset int32) ([]model.UserMembership, int64, error) {
	rows, err := r.q.ListUserMembershipsPaged(ctx, db.ListUserMembershipsPagedParams{
		UserID: userID, LimitCount: limit, OffsetCount: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := r.q.CountUserMemberships(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	out := make([]model.UserMembership, 0, len(rows))
	for _, row := range rows {
		out = append(out, model.UserMembership{
			Organization: model.OrganizationRef{UUID: row.Uuid, Slug: row.Slug, Name: row.Name},
			Status:       row.Status,
			AccessEndsAt: timePtr(row.AccessEndsAt),
			Role:         row.Role,
			JoinedAt:     row.JoinedAt.Time,
		})
	}
	return out, total, nil
}

// ListUserSessions pages active refresh sessions (never the token hash).
func (r *Postgres) ListUserSessions(ctx context.Context, userID int64, limit, offset int32) ([]model.UserSession, int64, error) {
	rows, err := r.q.ListUserActiveSessionsPaged(ctx, db.ListUserActiveSessionsPagedParams{
		UserID: userID, LimitCount: limit, OffsetCount: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := r.q.CountUserActiveSessions(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	out := make([]model.UserSession, 0, len(rows))
	for _, row := range rows {
		item := model.UserSession{
			UUID:         row.Uuid,
			LastUsedAt:   row.CreatedAt.Time,
			ExpiresAt:    row.ExpiresAt.Time,
			Impersonated: row.Impersonated,
			Organization: orgRef(row.OrganizationUuid, row.OrganizationSlug, row.OrganizationName),
		}
		if row.UserAgent.Valid && row.UserAgent.String != "" {
			ua := row.UserAgent.String
			item.UserAgent = &ua
		}
		if row.IpAddress != nil {
			ip := row.IpAddress.String()
			item.IPAddress = &ip
		}
		out = append(out, item)
	}
	return out, total, nil
}

// RevokeAllUserSessions revokes every live refresh session of the user.
func (r *Postgres) RevokeAllUserSessions(ctx context.Context, userID int64) (int64, error) {
	return r.q.RevokeAllUserSessions(ctx, userID)
}

// ListUserPushDevices pages push devices, active first (token omitted).
func (r *Postgres) ListUserPushDevices(ctx context.Context, userID int64, limit, offset int32) ([]model.UserPushDevice, int64, error) {
	rows, err := r.q.ListUserPushDevicesPaged(ctx, db.ListUserPushDevicesPagedParams{
		UserID: userID, LimitCount: limit, OffsetCount: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := r.q.CountUserPushDevices(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	out := make([]model.UserPushDevice, 0, len(rows))
	for _, row := range rows {
		out = append(out, model.UserPushDevice{
			UUID:           row.Uuid,
			Platform:       row.Platform,
			DeviceName:     row.DeviceName,
			AppVersion:     row.AppVersion,
			Locale:         row.Locale,
			LastSeenAt:     row.LastSeenAt.Time,
			CreatedAt:      row.CreatedAt.Time,
			DisabledAt:     timePtr(row.DisabledAt),
			DisabledReason: row.DisabledReason,
		})
	}
	return out, total, nil
}

// DeleteUserPushDevice removes one of the user's push devices.
func (r *Postgres) DeleteUserPushDevice(ctx context.Context, userID int64, deviceUUID uuid.UUID) (model.RemovedPushDevice, error) {
	row, err := r.q.DeleteUserPushDeviceByUUID(ctx, db.DeleteUserPushDeviceByUUIDParams{
		Uuid: deviceUUID, UserID: userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.RemovedPushDevice{}, ErrNotFound
		}
		return model.RemovedPushDevice{}, err
	}
	return model.RemovedPushDevice{Platform: row.Platform, DeviceName: row.DeviceName}, nil
}

// OrganizationIDByUUID resolves a live organization (activity filter).
func (r *Postgres) OrganizationIDByUUID(ctx context.Context, id uuid.UUID) (int64, error) {
	row, err := r.q.GetOrganizationByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return row.ID, nil
}

// ListUserActivity pages activity events the user performed.
func (r *Postgres) ListUserActivity(
	ctx context.Context, userID int64, organizationID *int64, action, search string, limit, offset int32,
) ([]model.UserActivityEntry, int64, error) {
	actor := pgtype.Int8{Int64: userID, Valid: true}
	var org pgtype.Int8
	if organizationID != nil {
		org = pgtype.Int8{Int64: *organizationID, Valid: true}
	}
	actionArg := optionalText(action)
	qArg := optionalText(search)
	rows, err := r.q.ListUserActivityPaged(ctx, db.ListUserActivityPagedParams{
		ActorUserID: actor, OrganizationID: org, Action: actionArg, Q: qArg, LimitCount: limit, OffsetCount: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := r.q.CountUserActivity(ctx, db.CountUserActivityParams{
		ActorUserID: actor, OrganizationID: org, Action: actionArg, Q: qArg,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]model.UserActivityEntry, 0, len(rows))
	for _, row := range rows {
		entry := model.UserActivityEntry{
			UUID: row.Uuid, Action: row.Action, Resource: row.Resource, CreatedAt: row.CreatedAt.Time,
			Payload:      map[string]any{},
			Organization: orgRef(row.OrganizationUuid, row.OrganizationSlug, row.OrganizationName),
		}
		_ = json.Unmarshal(row.Payload, &entry.Payload)
		if row.ResourceUuid.Valid {
			ru := uuid.UUID(row.ResourceUuid.Bytes)
			entry.ResourceUUID = &ru
		}
		out = append(out, entry)
	}
	return out, total, nil
}

// ListUserAIUsage returns the user's conversations and quota tokens since
// `since`, per organization membership.
func (r *Postgres) ListUserAIUsage(ctx context.Context, userID int64, since time.Time) ([]model.UserAIOrganizationRow, error) {
	rows, err := r.q.ListUserAIUsageByOrganization(ctx, db.ListUserAIUsageByOrganizationParams{
		UserID: userID, Since: pgtype.Timestamptz{Time: since, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	out := make([]model.UserAIOrganizationRow, 0, len(rows))
	for _, row := range rows {
		out = append(out, model.UserAIOrganizationRow{
			Organization:      model.OrganizationRef{UUID: row.Uuid, Slug: row.Slug, Name: row.Name},
			ConversationCount: row.ConversationCount,
			Tokens:            row.TokensSince,
		})
	}
	return out, nil
}

func orgRef(id pgtype.UUID, slug, name pgtype.Text) *model.OrganizationRef {
	if !id.Valid {
		return nil
	}
	return &model.OrganizationRef{UUID: uuid.UUID(id.Bytes), Slug: slug.String, Name: name.String}
}

func optionalText(v string) pgtype.Text {
	if v == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: v, Valid: true}
}
