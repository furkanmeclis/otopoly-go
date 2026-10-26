// Package model holds the types of the MCP OAuth 2.1 authorization server
// (docs/MCP.md).
package model

import (
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"
)

// Lifetimes of the OAuth artifacts.
const (
	AccessTTL      = time.Hour
	RefreshTTL     = 30 * 24 * time.Hour
	CodeTTL        = 5 * time.Minute
	AuthRequestTTL = 15 * time.Minute
)

// Per-IP limits per hour of the public endpoints.
const (
	RegisterPerHour  = 20
	AuthorizePerHour = 60
	TokenPerHour     = 120
	RevokePerHour    = 120
	RateWindow       = time.Hour
)

// Scopes. mcp:read lists and runs read tools; mcp:write also runs tools that
// change data (business endpoint only).
const (
	ScopeRead  = "mcp:read"
	ScopeWrite = "mcp:write"
)

// AllScopes is the scopes_supported list of the metadata documents.
var AllScopes = []string{ScopeRead, ScopeWrite}

// Token kinds (mcp_oauth_tokens.kind).
const (
	KindAccess  = "access"
	KindRefresh = "refresh"
)

// Grant types of the token endpoint.
const (
	GrantAuthorizationCode = "authorization_code"
	GrantRefreshToken      = "refresh_token"
)

// The protected resources (RFC 8707 audiences): the two MCP endpoints.
const (
	ResourceOrg      = "/mcp/org"
	ResourcePlatform = "/mcp/platform"
)

// Resources lists every MCP endpoint path.
var Resources = []string{ResourceOrg, ResourcePlatform}

// IsResource reports whether path is one of the MCP endpoints.
func IsResource(path string) bool { return slices.Contains(Resources, path) }

// Realms of the endpoints (grant list filter, consent screen).
const (
	RealmOrg      = "org"
	RealmPlatform = "platform"
)

// RealmOf maps an endpoint path to its realm.
func RealmOf(resource string) string {
	if resource == ResourcePlatform {
		return RealmPlatform
	}
	return RealmOrg
}

// ResourceScopes are the scopes a resource can grant: the platform endpoint
// only has read tools.
func ResourceScopes(resource string) []string {
	if resource == ResourcePlatform {
		return []string{ScopeRead}
	}
	return []string{ScopeRead, ScopeWrite}
}

// OAuth error codes (RFC 6749 §5.2, RFC 7591 §3.2.2, RFC 8707 §2).
const (
	ErrInvalidRequest          = "invalid_request"
	ErrInvalidClient           = "invalid_client"
	ErrInvalidGrant            = "invalid_grant"
	ErrUnsupportedGrantType    = "unsupported_grant_type"
	ErrUnsupportedResponseType = "unsupported_response_type"
	ErrInvalidScope            = "invalid_scope"
	ErrInvalidTarget           = "invalid_target"
	ErrInvalidRedirectURI      = "invalid_redirect_uri"
	ErrInvalidClientMetadata   = "invalid_client_metadata"
	ErrAccessDenied            = "access_denied"
	ErrSlowDown                = "slow_down"
	ErrServerError             = "server_error"
)

// Error is an OAuth protocol error, written as {"error", "error_description"}.
type Error struct {
	Status      int
	Code        string
	Description string
	// Redirectable: client and redirect_uri are verified, so the error may go
	// back to the client (RFC 6749 §4.1.2.1); otherwise it is shown to the user.
	Redirectable bool
	RetryAfter   time.Duration
	// Cause is the internal error behind a server_error (logged, never sent).
	Cause error
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("oauth: %s: %v", e.Code, e.Cause)
	}
	return fmt.Sprintf("oauth: %s: %s", e.Code, e.Description)
}

// Unwrap returns the internal cause.
func (e *Error) Unwrap() error { return e.Cause }

// BadRequest builds a 400 OAuth error.
func BadRequest(code, desc string) *Error {
	return &Error{Status: http.StatusBadRequest, Code: code, Description: desc}
}

// Client is a registered (RFC 7591) public client.
type Client struct {
	ClientID     string
	ClientName   string
	RedirectURIs []string
	IssuedAt     time.Time
}

// RegisterInput is the client metadata of a registration request.
type RegisterInput struct {
	ClientName              string   `json:"client_name"`
	RedirectURIs            []string `json:"redirect_uris"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	Scope                   string   `json:"scope"`
}

// AuthorizeInput is an /oauth/authorize request.
type AuthorizeInput struct {
	ClientID            string
	RedirectURI         string
	ResponseType        string
	CodeChallenge       string
	CodeChallengeMethod string
	State               string
	Scope               string
	Resource            string
}

// AuthRequest is a validated authorize request waiting for consent.
type AuthRequest struct {
	ID          uuid.UUID
	ClientID    string
	ClientName  string
	RedirectURI string
	State       string
	Resource    string
	Scopes      []string
	ExpiresAt   time.Time
}

// TokenInput is the form of a token endpoint request.
type TokenInput struct {
	GrantType    string
	ClientID     string
	Code         string
	RedirectURI  string
	CodeVerifier string
	RefreshToken string
	Resource     string
	Scope        string
}

// TokenResponse is the RFC 6749 §5.1 success body.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

// AccessToken is a validated Bearer token of an MCP endpoint.
type AccessToken struct {
	ID       int64
	Family   uuid.UUID
	GrantID  int64
	ClientID string
	UserID   int64
	// OrganizationID is the organization of an /mcp/org token (0 on the
	// platform endpoint).
	OrganizationID int64
	Resource       string
	Scopes         []string
	ExpiresAt      time.Time
}

// HasScope reports whether the token carries scope.
func (t AccessToken) HasScope(scope string) bool { return slices.Contains(t.Scopes, scope) }

// --- consent and connected apps -----------------------------------------------

// Consent decisions.
const (
	DecisionApprove = "approve"
	DecisionDeny    = "deny"
)

// ConsentPath is the frontend consent screen /oauth/authorize redirects to.
const ConsentPath = "/oauth/consent"

// Activity log actions.
const (
	ActionConsentApproved = "mcp.consent_approved"
	ActionConsentDenied   = "mcp.consent_denied"
	ActionGrantRevoked    = "mcp.grant_revoked"
	ActionClientRevoked   = "mcp.client_revoked"
)

// ConsentOrganization is an organization the token may be bound to.
type ConsentOrganization struct {
	UUID uuid.UUID `json:"uuid"`
	Slug string    `json:"slug"`
	Name string    `json:"name"`
	Role string    `json:"role"`
	// ToolCount is the number of MCP tools the user gets there with every
	// requested scope; nil when not computed.
	ToolCount *int `json:"tool_count"`
}

// Consent is what the consent screen shows for a pending request.
type Consent struct {
	RequestID    uuid.UUID `json:"request_uuid"`
	ClientID     string    `json:"client_id"`
	ClientName   string    `json:"client_name"`
	RedirectHost string    `json:"redirect_host"`
	Resource     string    `json:"resource"`
	ResourceURL  string    `json:"resource_url"`
	Realm        string    `json:"realm"`
	Scopes       []string  `json:"scopes"`
	// Organizations is the org picker of /mcp/org (empty on the platform
	// endpoint).
	Organizations []ConsentOrganization `json:"organizations"`
	// PlatformToolCount is the tool count of the platform endpoint.
	PlatformToolCount *int `json:"platform_tool_count"`
	// Allowed is false when the user cannot approve (no organization or no
	// platform permission); the screen then only offers deny.
	Allowed   bool      `json:"allowed"`
	ExpiresAt time.Time `json:"expires_at"`
}

// DecideInput is the body of a consent decision.
type DecideInput struct {
	Decision         string     `json:"decision"`
	OrganizationUUID *uuid.UUID `json:"organization_uuid"`
	// Scopes narrows the requested scopes (omit = all requested).
	Scopes []string `json:"scopes"`
}

// Decision is where to send the browser after a consent decision.
type Decision struct {
	RedirectURL string `json:"redirect_url"`
}

// Grant is one of the user's connected apps.
type Grant struct {
	UUID             uuid.UUID  `json:"uuid"`
	ClientID         string     `json:"client_id"`
	ClientName       string     `json:"client_name"`
	Resource         string     `json:"resource"`
	Realm            string     `json:"realm"`
	Scopes           []string   `json:"scopes"`
	OrganizationUUID *uuid.UUID `json:"organization_uuid"`
	OrganizationSlug *string    `json:"organization_slug"`
	OrganizationName *string    `json:"organization_name"`
	CreatedAt        time.Time  `json:"created_at"`
	LastUsedAt       *time.Time `json:"last_used_at"`
}

// ClientSummary is a registered client in the platform list.
type ClientSummary struct {
	UUID         uuid.UUID  `json:"uuid"`
	ClientID     string     `json:"client_id"`
	ClientName   string     `json:"client_name"`
	RedirectURIs []string   `json:"redirect_uris"`
	CreatedIP    *string    `json:"created_ip"`
	Status       string     `json:"status"`
	ActiveGrants int64      `json:"active_grants"`
	CreatedAt    time.Time  `json:"created_at"`
	LastUsedAt   *time.Time `json:"last_used_at"`
	RevokedAt    *time.Time `json:"revoked_at"`
}

// Client statuses of the platform list.
const (
	ClientStatusActive  = "active"
	ClientStatusRevoked = "revoked"
)
