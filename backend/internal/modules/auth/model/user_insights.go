package model

import (
	"time"

	"github.com/google/uuid"
)

// Platform 360° user detail payloads. None of them carry secrets: refresh
// token hashes, push tokens and TOTP secrets never leave the repository.

// UserOverview aggregates the platform user detail header and counters.
type UserOverview struct {
	User     PlatformUserDetail `json:"user"`
	Security UserSecurity       `json:"security"`
	Counts   UserCounts         `json:"counts"`
	// AI is nil when the assistant module is not wired.
	AI *UserAIUsage `json:"ai"`
}

// UserSecurity summarizes sign-in factors without exposing them.
type UserSecurity struct {
	CreatedAt        time.Time  `json:"created_at"`
	LastLoginAt      *time.Time `json:"last_login_at"`
	EmailVerifiedAt  *time.Time `json:"email_verified_at"`
	PasswordSet      bool       `json:"password_set"`
	TwoFactorEnabled bool       `json:"two_factor_enabled"`
	PasskeyCount     int64      `json:"passkey_count"`
}

// UserCounts are badge counters for the detail tabs.
type UserCounts struct {
	Organizations       int64 `json:"organizations"`
	ActiveSessions      int64 `json:"active_sessions"`
	PushDevices         int64 `json:"push_devices"`
	UnreadNotifications int64 `json:"unread_notifications"`
}

// UserAIUsage is the user's own assistant usage in the current quota period.
type UserAIUsage struct {
	PeriodStart       time.Time                 `json:"period_start"`
	PeriodEnd         time.Time                 `json:"period_end"`
	ConversationCount int64                     `json:"conversation_count"`
	Tokens            int64                     `json:"tokens"`
	Organizations     []UserAIOrganizationUsage `json:"organizations"`
}

// UserAIOrganizationUsage is per membership: the user's share and the
// organization's monthly quota.
type UserAIOrganizationUsage struct {
	Organization      OrganizationRef `json:"organization"`
	ConversationCount int64           `json:"conversation_count"`
	Tokens            int64           `json:"tokens"`
	Enabled           bool            `json:"enabled"`
	QuotaLimit        int64           `json:"quota_limit"`
	QuotaUsed         int64           `json:"quota_used"`
	Unlimited         bool            `json:"unlimited"`
}

// UserMembership is one organization the user belongs to.
type UserMembership struct {
	Organization OrganizationRef `json:"organization"`
	Status       string          `json:"status"`
	AccessEndsAt *time.Time      `json:"access_ends_at"`
	Role         string          `json:"role"`
	JoinedAt     time.Time       `json:"joined_at"`
}

// UserSession is an active refresh session (metadata only). Refresh tokens
// rotate on every use, so LastUsedAt is when the current token was issued.
type UserSession struct {
	UUID         uuid.UUID        `json:"uuid"`
	UserAgent    *string          `json:"user_agent"`
	IPAddress    *string          `json:"ip_address"`
	LastUsedAt   time.Time        `json:"last_used_at"`
	ExpiresAt    time.Time        `json:"expires_at"`
	Impersonated bool             `json:"impersonated"`
	Organization *OrganizationRef `json:"organization"`
}

// UserPushDevice is a registered mobile push device (the token is omitted).
type UserPushDevice struct {
	UUID           uuid.UUID  `json:"uuid"`
	Platform       string     `json:"platform"`
	DeviceName     string     `json:"device_name"`
	AppVersion     string     `json:"app_version"`
	Locale         string     `json:"locale"`
	LastSeenAt     time.Time  `json:"last_seen_at"`
	CreatedAt      time.Time  `json:"created_at"`
	DisabledAt     *time.Time `json:"disabled_at"`
	DisabledReason string     `json:"disabled_reason"`
}

// UserActivityEntry is an activity event the user performed.
type UserActivityEntry struct {
	UUID         uuid.UUID        `json:"uuid"`
	Action       string           `json:"action"`
	Resource     string           `json:"resource"`
	ResourceUUID *uuid.UUID       `json:"resource_uuid"`
	Payload      map[string]any   `json:"payload"`
	CreatedAt    time.Time        `json:"created_at"`
	Organization *OrganizationRef `json:"organization"`
}

// UserActivityFilter narrows the user's activity list.
type UserActivityFilter struct {
	OrganizationUUID *uuid.UUID
	Action           string
	Q                string
}

// UserSecurityCounts is the repository row behind UserSecurity / UserCounts.
type UserSecurityCounts struct {
	Security UserSecurity
	Counts   UserCounts
}

// UserAIOrganizationRow is the user's usage in one organization.
type UserAIOrganizationRow struct {
	Organization      OrganizationRef
	ConversationCount int64
	Tokens            int64
}

// RemovedPushDevice describes a deleted device for the audit trail.
type RemovedPushDevice struct {
	Platform   string
	DeviceName string
}
