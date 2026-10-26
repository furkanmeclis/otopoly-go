// Package usecase is the MCP OAuth 2.1 authorization server (docs/MCP.md):
// dynamic client registration (RFC 7591), authorization code + PKCE S256,
// rotating refresh tokens with family revocation on reuse, revocation (RFC
// 7009), resource-bound (RFC 8707) access token validation and the RFC 8414 /
// RFC 9728 metadata documents. consent.go holds the authorize endpoint, the
// consent decision and the connected apps.
package usecase

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// FeatureMCP is the plan toggle of MCP connections (undefined = on).
const FeatureMCP = "mcp.enabled"

// maxRedirectURIs bounds a registration (chk_mcp_oauth_clients_redirect_uris).
const maxRedirectURIs = 10

// clientIDPrefix marks the client ids this server issues.
const clientIDPrefix = "mcp_"

var (
	// ErrUnauthorized: the Bearer token is unknown, expired, revoked, of a
	// revoked grant or client, of an inactive user, or of another resource.
	// The MCP endpoint answers 401 with WWW-Authenticate.
	ErrUnauthorized = errors.New("oauth: invalid access token")
	// ErrFeatureDisabled: the token is valid but the organization's plan has
	// MCP connections off. The MCP endpoint answers 403.
	ErrFeatureDisabled = errors.New("oauth: mcp connections are disabled for the organization")
)

// DB is the connection the service runs on.
type DB interface {
	db.DBTX
	Begin(ctx context.Context) (pgx.Tx, error)
}

// FeatureChecker reports a plan toggle of an organization (entitlements).
type FeatureChecker interface {
	Enabled(ctx context.Context, orgID int64, key string) (bool, error)
}

// Limiter is the fixed window limiter (ratelimit.Limiter).
type Limiter interface {
	Allow(ctx context.Context, action, subject string, limit int, window time.Duration) (bool, time.Duration)
}

// ActivityRecorder writes audit events (*activity.Recorder).
type ActivityRecorder interface {
	Record(ctx context.Context, actorID *int64, action, resource string, resourceUUID *uuid.UUID, payload map[string]any, r *http.Request)
}

// Service is the authorization server.
type Service struct {
	db       DB
	q        *db.Queries
	features FeatureChecker
	limiter  Limiter
	tools    ToolCounter
	activity ActivityRecorder
	issuer   string
	log      *slog.Logger
	now      func() time.Time
}

// New builds the service. issuer is the public origin MCP clients reach (the
// frontend, which proxies /oauth/*, /.well-known/* and /mcp/* to Go).
func New(conn DB, features FeatureChecker, limiter Limiter, issuer string, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	s := &Service{
		db: conn, features: features, limiter: limiter,
		issuer: strings.TrimRight(issuer, "/"), log: log, now: time.Now,
	}
	if conn != nil {
		s.q = db.New(conn)
	}
	return s
}

// SetClock overrides the clock (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// SetActivityRecorder attaches the audit log.
func (s *Service) SetActivityRecorder(r ActivityRecorder) { s.activity = r }

// Issuer is the authorization server identifier (RFC 8414 issuer).
func (s *Service) Issuer() string { return s.issuer }

// ResourceURL is the absolute URI of an MCP endpoint path.
func (s *Service) ResourceURL(path string) string { return s.issuer + path }

// --- rate limits ---------------------------------------------------------------

func (s *Service) allow(ctx context.Context, action, ip string, limit int) error {
	if s.limiter == nil {
		return nil
	}
	ok, retry := s.limiter.Allow(ctx, "mcp_oauth_"+action, ip, limit, model.RateWindow)
	if ok {
		return nil
	}
	return &model.Error{
		Status: http.StatusTooManyRequests, Code: model.ErrSlowDown,
		Description: "too many requests, try again later", RetryAfter: retry,
	}
}

// --- helpers -------------------------------------------------------------------

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// HashToken is the stored form of codes and tokens (SHA-256, hex).
func HashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func orgArg(id int64) pgtype.Int8 { return pgtype.Int8{Int64: id, Valid: id > 0} }

func serverError(err error) *model.Error {
	return &model.Error{Status: http.StatusInternalServerError, Code: model.ErrServerError, Description: "internal server error", Cause: err}
}

// ValidVerifier checks RFC 7636 §4.1 code_verifier syntax.
func ValidVerifier(v string) bool {
	if len(v) < 43 || len(v) > 128 {
		return false
	}
	for _, c := range v {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '.', c == '_', c == '~':
		default:
			return false
		}
	}
	return true
}

// S256 is the PKCE S256 code challenge of a verifier.
func S256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// ValidRedirect accepts https URLs, loopback http URLs and private-use
// scheme URLs of native clients (cursor://, vscode://), without a fragment
// or credentials (RFC 8252, OAuth 2.1 §2.3.1).
func ValidRedirect(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Fragment != "" || u.User != nil || u.Scheme == "" {
		return false
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		return u.Host != ""
	case "http":
		h := u.Hostname()
		return h == "localhost" || h == "127.0.0.1" || h == "::1"
	case "javascript", "data", "file", "vbscript", "ftp", "ws", "wss":
		return false
	}
	// Private-use URI scheme of a native app: reverse domain or app name.
	return strings.Contains(u.Scheme, ".") || len(u.Scheme) >= 3
}

// resourcePath resolves an RFC 8707 resource indicator to an MCP endpoint
// path: an absolute URI on the issuer's origin naming one of the endpoints.
func (s *Service) resourcePath(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Fragment != "" || u.RawQuery != "" || !u.IsAbs() {
		return "", false
	}
	iss, err := url.Parse(s.issuer)
	if err != nil || !strings.EqualFold(u.Scheme, iss.Scheme) || !strings.EqualFold(u.Host, iss.Host) {
		return "", false
	}
	p := strings.TrimRight(u.Path, "/")
	if !model.IsResource(p) {
		return "", false
	}
	return p, true
}

// ResolveScopes turns a requested scope string into the scopes granted on
// resource. Unknown values are ignored (RFC 6749 §3.3 lets the server grant
// less); no known scope means every scope of the resource; write implies
// read. The result is in canonical order.
func ResolveScopes(raw, resource string) []string {
	allowed := model.ResourceScopes(resource)
	want := map[string]bool{}
	for _, f := range strings.Fields(raw) {
		if slices.Contains(allowed, f) {
			want[f] = true
		}
	}
	if len(want) == 0 {
		return slices.Clone(allowed)
	}
	want[model.ScopeRead] = true
	out := make([]string, 0, len(want))
	for _, sc := range model.AllScopes {
		if want[sc] {
			out = append(out, sc)
		}
	}
	return out
}

func (s *Service) inTx(ctx context.Context, fn func(q *db.Queries) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(s.q.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// mcpEnabled reports whether the organization's plan allows MCP. Platform
// tokens (orgID 0) have no plan.
func (s *Service) mcpEnabled(ctx context.Context, orgID int64) (bool, error) {
	if orgID <= 0 || s.features == nil {
		return true, nil
	}
	return s.features.Enabled(ctx, orgID, FeatureMCP)
}

func (s *Service) record(ctx context.Context, actorID int64, action, resource string, id *uuid.UUID, payload map[string]any, r *http.Request) {
	if s.activity == nil {
		return
	}
	actor := actorID
	s.activity.Record(context.WithoutCancel(ctx), &actor, action, resource, id, payload, r)
}

// --- registration (RFC 7591) -----------------------------------------------------

// Register stores a public client. Only token_endpoint_auth_method none, the
// authorization_code and refresh_token grants and response type code are
// accepted.
func (s *Service) Register(ctx context.Context, ip string, in model.RegisterInput) (model.Client, error) {
	if err := s.allow(ctx, "register", ip, model.RegisterPerHour); err != nil {
		return model.Client{}, err
	}
	if err := ValidateRegistration(in); err != nil {
		return model.Client{}, err
	}
	name := strings.TrimSpace(in.ClientName)
	if name == "" {
		name = "MCP client"
	}
	if r := []rune(name); len(r) > 200 {
		name = string(r[:200])
	}
	var createdIP pgtype.Text
	if ip = strings.TrimSpace(ip); ip != "" {
		if len(ip) > 64 {
			ip = ip[:64]
		}
		createdIP = pgtype.Text{String: ip, Valid: true}
	}
	c, err := s.q.CreateMCPOAuthClient(ctx, db.CreateMCPOAuthClientParams{
		ClientID: clientIDPrefix + randomToken(18), ClientName: name,
		RedirectUris: in.RedirectURIs, CreatedIp: createdIP,
	})
	if err != nil {
		return model.Client{}, fmt.Errorf("oauth: register client: %w", err)
	}
	return model.Client{ClientID: c.ClientID, ClientName: c.ClientName, RedirectURIs: c.RedirectUris, IssuedAt: c.CreatedAt.Time}, nil
}

// ValidateRegistration checks RFC 7591 client metadata.
func ValidateRegistration(in model.RegisterInput) error {
	if len(in.RedirectURIs) == 0 || len(in.RedirectURIs) > maxRedirectURIs {
		return model.BadRequest(model.ErrInvalidRedirectURI, "1 to 10 redirect_uris are required")
	}
	for _, u := range in.RedirectURIs {
		if !ValidRedirect(u) {
			return model.BadRequest(model.ErrInvalidRedirectURI, "redirect URIs must be https, http on a loopback host or a native app scheme, without a fragment")
		}
	}
	if in.TokenEndpointAuthMethod != "" && in.TokenEndpointAuthMethod != "none" {
		return model.BadRequest(model.ErrInvalidClientMetadata, "only public clients (token_endpoint_auth_method=none) are supported")
	}
	for _, g := range in.GrantTypes {
		if g != model.GrantAuthorizationCode && g != model.GrantRefreshToken {
			return model.BadRequest(model.ErrInvalidClientMetadata, "only the authorization_code and refresh_token grants are supported")
		}
	}
	for _, rt := range in.ResponseTypes {
		if rt != "code" {
			return model.BadRequest(model.ErrInvalidClientMetadata, "only response_type code is supported")
		}
	}
	return nil
}

// --- authorization request -------------------------------------------------------

// CreateAuthRequest validates an authorize request and stores it for consent.
// An unknown client or an unregistered redirect_uri is a non-redirectable
// error; every later error is Redirectable. PKCE S256 is required (plain is
// rejected). resource names one of the MCP endpoints; when it is missing the
// business endpoint is assumed (clients that predate RFC 8707).
func (s *Service) CreateAuthRequest(ctx context.Context, in model.AuthorizeInput) (model.AuthRequest, error) {
	client, err := s.q.GetMCPOAuthClient(ctx, in.ClientID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && client.RevokedAt.Valid) {
		return model.AuthRequest{}, model.BadRequest(model.ErrInvalidClient, "unknown client_id")
	}
	if err != nil {
		return model.AuthRequest{}, fmt.Errorf("oauth: client: %w", err)
	}
	if !slices.Contains(client.RedirectUris, in.RedirectURI) {
		return model.AuthRequest{}, model.BadRequest(model.ErrInvalidRequest, "redirect_uri is not registered for this client")
	}
	resource, sc, err := s.validateAuthorize(in)
	if err != nil {
		return model.AuthRequest{}, err
	}
	state := pgtype.Text{String: in.State, Valid: in.State != ""}
	req, err := s.q.CreateMCPOAuthAuthRequest(ctx, db.CreateMCPOAuthAuthRequestParams{
		ClientID: client.ClientID, RedirectUri: in.RedirectURI, CodeChallenge: in.CodeChallenge,
		State: state, Scopes: sc, Resource: resource, ExpiresAt: ts(s.now().Add(model.AuthRequestTTL)),
	})
	if err != nil {
		return model.AuthRequest{}, fmt.Errorf("oauth: auth request: %w", err)
	}
	return model.AuthRequest{
		ID: req.ID, ClientID: client.ClientID, ClientName: client.ClientName, RedirectURI: req.RedirectUri,
		State: in.State, Resource: resource, Scopes: sc, ExpiresAt: req.ExpiresAt.Time,
	}, nil
}

// validateAuthorize checks the redirectable part of an authorize request.
func (s *Service) validateAuthorize(in model.AuthorizeInput) (string, []string, error) {
	fail := func(code, desc string) error {
		e := model.BadRequest(code, desc)
		e.Redirectable = true
		return e
	}
	if in.ResponseType != "code" {
		return "", nil, fail(model.ErrUnsupportedResponseType, "only response_type=code is supported")
	}
	if in.CodeChallengeMethod != "S256" {
		return "", nil, fail(model.ErrInvalidRequest, "PKCE with code_challenge_method=S256 is required")
	}
	if len(in.CodeChallenge) != 43 {
		return "", nil, fail(model.ErrInvalidRequest, "code_challenge must be a base64url SHA-256 digest")
	}
	resource := model.ResourceOrg
	if strings.TrimSpace(in.Resource) != "" {
		p, ok := s.resourcePath(in.Resource)
		if !ok {
			return "", nil, fail(model.ErrInvalidTarget, "resource must be one of the MCP endpoint URLs")
		}
		resource = p
	}
	return resource, ResolveScopes(in.Scope, resource), nil
}

// GetAuthRequest returns a pending (unexpired) request; pgx.ErrNoRows when
// missing.
func (s *Service) GetAuthRequest(ctx context.Context, id uuid.UUID) (model.AuthRequest, error) {
	r, err := s.q.GetMCPOAuthAuthRequest(ctx, id)
	if err != nil {
		return model.AuthRequest{}, err
	}
	return model.AuthRequest{
		ID: r.ID, ClientID: r.ClientID, ClientName: r.ClientName, RedirectURI: r.RedirectUri,
		State: r.State.String, Resource: r.Resource, Scopes: r.Scopes, ExpiresAt: r.ExpiresAt.Time,
	}, nil
}

// issueCode approves a pending request: it claims the request, records the
// grant (connected app) and returns the client redirect carrying the code,
// state and iss (RFC 9207). The caller has checked membership and
// permissions; scopes are the granted subset of the requested ones.
func (s *Service) issueCode(ctx context.Context, requestID uuid.UUID, userID, orgID int64, scopes []string) (string, db.McpOauthGrant, error) {
	code := randomToken(32)
	var redirect string
	var grant db.McpOauthGrant
	err := s.inTx(ctx, func(q *db.Queries) error {
		req, err := q.GetMCPOAuthAuthRequest(ctx, requestID)
		if err != nil {
			return err
		}
		n, err := q.DeleteMCPOAuthAuthRequest(ctx, requestID)
		if err != nil {
			return err
		}
		if n == 0 {
			return pgx.ErrNoRows
		}
		grant, err = q.UpsertMCPOAuthGrant(ctx, db.UpsertMCPOAuthGrantParams{
			UserID: userID, ClientID: req.ClientID, OrganizationID: orgArg(orgID),
			Resource: req.Resource, Scopes: scopes,
		})
		if err != nil {
			return err
		}
		if err := q.CreateMCPOAuthCode(ctx, db.CreateMCPOAuthCodeParams{
			CodeHash: HashToken(code), GrantID: grant.ID, ClientID: req.ClientID, UserID: userID,
			OrganizationID: orgArg(orgID), RedirectUri: req.RedirectUri,
			CodeChallenge: req.CodeChallenge, Resource: req.Resource, Scopes: scopes,
			ExpiresAt: ts(s.now().Add(model.CodeTTL)),
		}); err != nil {
			return err
		}
		redirect, err = s.codeRedirect(req.RedirectUri, code, req.State.String)
		return err
	})
	if err != nil {
		return "", db.McpOauthGrant{}, err
	}
	return redirect, grant, nil
}

func (s *Service) codeRedirect(redirectURI, code, state string) (string, error) {
	u, err := url.Parse(redirectURI)
	if err != nil {
		return "", err
	}
	v := u.Query()
	v.Set("code", code)
	if state != "" {
		v.Set("state", state)
	}
	v.Set("iss", s.issuer)
	u.RawQuery = v.Encode()
	return u.String(), nil
}

// --- token endpoint --------------------------------------------------------------

// Exchange serves the token endpoint: authorization_code (PKCE S256) and
// refresh_token (rotating). A replayed code or rotated refresh token revokes
// every token of its family.
func (s *Service) Exchange(ctx context.Context, ip string, in model.TokenInput) (model.TokenResponse, error) {
	if err := s.allow(ctx, "token", ip, model.TokenPerHour); err != nil {
		return model.TokenResponse{}, err
	}
	switch in.GrantType {
	case model.GrantAuthorizationCode:
		return s.exchangeCode(ctx, in)
	case model.GrantRefreshToken:
		return s.refresh(ctx, in)
	case "":
		return model.TokenResponse{}, model.BadRequest(model.ErrInvalidRequest, "grant_type is required")
	default:
		return model.TokenResponse{}, model.BadRequest(model.ErrUnsupportedGrantType, "use authorization_code or refresh_token")
	}
}

func (s *Service) activeClient(ctx context.Context, clientID string) error {
	if clientID == "" {
		return model.BadRequest(model.ErrInvalidRequest, "client_id is required")
	}
	c, err := s.q.GetMCPOAuthClient(ctx, clientID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && c.RevokedAt.Valid) {
		return &model.Error{Status: http.StatusUnauthorized, Code: model.ErrInvalidClient, Description: "unknown or revoked client"}
	}
	if err != nil {
		return serverError(err)
	}
	return nil
}

// grantAllowed checks the user and the organization behind a grant at issue
// time: the user must be active and MCP on in the organization's plan.
func (s *Service) grantAllowed(ctx context.Context, q *db.Queries, userID, orgID int64) error {
	u, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return model.BadRequest(model.ErrInvalidGrant, "the user of this grant is not available")
	}
	if !UserActive(u) {
		return model.BadRequest(model.ErrInvalidGrant, "the user of this grant is not active")
	}
	on, err := s.mcpEnabled(ctx, orgID)
	if err != nil {
		return serverError(err)
	}
	if !on {
		return model.BadRequest(model.ErrInvalidGrant, "MCP connections are not enabled for this organization")
	}
	return nil
}

// UserActive reports whether a user may still act (not disabled or
// deactivated).
func UserActive(u db.User) bool {
	return u.Status != "disabled" && !u.DeactivatedAt.Valid && !u.DeletedAt.Valid
}

var (
	errCodeNotUsable = errors.New("oauth: code not usable")
	errRefreshRaced  = errors.New("oauth: refresh token already rotated")
)

func (s *Service) exchangeCode(ctx context.Context, in model.TokenInput) (model.TokenResponse, error) {
	if err := s.activeClient(ctx, in.ClientID); err != nil {
		return model.TokenResponse{}, err
	}
	if in.Code == "" || in.RedirectURI == "" || in.CodeVerifier == "" {
		return model.TokenResponse{}, model.BadRequest(model.ErrInvalidRequest, "code, redirect_uri and code_verifier are required")
	}
	resource := ""
	if strings.TrimSpace(in.Resource) != "" {
		p, ok := s.resourcePath(in.Resource)
		if !ok {
			return model.TokenResponse{}, model.BadRequest(model.ErrInvalidTarget, "resource must be one of the MCP endpoint URLs")
		}
		resource = p
	}
	codeHash := HashToken(in.Code)
	family := uuid.New()
	var out model.TokenResponse
	// Claim, check and issue in one transaction: a failed check leaves the
	// code unused, a successful exchange commits the claim with the tokens.
	err := s.inTx(ctx, func(q *db.Queries) error {
		code, err := q.UseMCPOAuthCode(ctx, db.UseMCPOAuthCodeParams{CodeHash: codeHash, Family: pgtype.UUID{Bytes: family, Valid: true}})
		if errors.Is(err, pgx.ErrNoRows) {
			return errCodeNotUsable
		}
		if err != nil {
			return serverError(err)
		}
		if code.ClientID != in.ClientID || code.RedirectUri != in.RedirectURI {
			return model.BadRequest(model.ErrInvalidGrant, "client_id or redirect_uri does not match the code")
		}
		if !ValidVerifier(in.CodeVerifier) || S256(in.CodeVerifier) != code.CodeChallenge {
			return model.BadRequest(model.ErrInvalidGrant, "PKCE verification failed")
		}
		if resource != "" && code.Resource != resource {
			return model.BadRequest(model.ErrInvalidTarget, "resource does not match the authorization")
		}
		if err := s.grantAllowed(ctx, q, code.UserID, code.OrganizationID.Int64); err != nil {
			return err
		}
		out, err = s.issue(ctx, q, issueArgs{
			family: family, grantID: code.GrantID, clientID: code.ClientID, userID: code.UserID,
			orgID: code.OrganizationID.Int64, resource: code.Resource, scopes: code.Scopes,
		})
		return err
	})
	if errors.Is(err, errCodeNotUsable) {
		// A replayed code: revoke whatever was issued from it (RFC 6749 §4.1.2).
		if fam, ferr := s.q.GetUsedMCPOAuthCodeFamily(ctx, codeHash); ferr == nil && fam.Valid {
			if rerr := s.q.RevokeMCPOAuthFamily(ctx, uuid.UUID(fam.Bytes)); rerr != nil {
				s.log.Error("mcp_oauth_code_reuse_revoke_failed", "error", rerr)
			}
			s.log.Warn("mcp_oauth_code_reuse", "client_id", in.ClientID)
		}
		return model.TokenResponse{}, model.BadRequest(model.ErrInvalidGrant, "the code is invalid, expired or already used")
	}
	if err != nil {
		return model.TokenResponse{}, asOAuthError(err)
	}
	s.touchClient(ctx, in.ClientID)
	return out, nil
}

func (s *Service) refresh(ctx context.Context, in model.TokenInput) (model.TokenResponse, error) {
	if err := s.activeClient(ctx, in.ClientID); err != nil {
		return model.TokenResponse{}, err
	}
	if in.RefreshToken == "" {
		return model.TokenResponse{}, model.BadRequest(model.ErrInvalidRequest, "refresh_token is required")
	}
	h := HashToken(in.RefreshToken)
	tok, err := s.q.GetActiveMCPOAuthToken(ctx, db.GetActiveMCPOAuthTokenParams{TokenHash: h, Kind: model.KindRefresh})
	if errors.Is(err, pgx.ErrNoRows) {
		// A rotated (revoked) refresh token used again: revoke the family.
		if old, oerr := s.q.GetMCPOAuthTokenAnyState(ctx, db.GetMCPOAuthTokenAnyStateParams{TokenHash: h, Kind: model.KindRefresh}); oerr == nil && old.RevokedAt.Valid {
			if rerr := s.q.RevokeMCPOAuthFamily(ctx, old.Family); rerr != nil {
				s.log.Error("mcp_oauth_refresh_reuse_revoke_failed", "error", rerr)
			}
			s.log.Warn("mcp_oauth_refresh_reuse", "client_id", old.ClientID, "user_id", old.UserID)
		}
		return model.TokenResponse{}, model.BadRequest(model.ErrInvalidGrant, "the refresh token is invalid or expired")
	}
	if err != nil {
		return model.TokenResponse{}, serverError(err)
	}
	if tok.ClientID != in.ClientID {
		return model.TokenResponse{}, model.BadRequest(model.ErrInvalidGrant, "the refresh token was issued to another client")
	}
	if in.Resource != "" {
		if p, ok := s.resourcePath(in.Resource); !ok || p != tok.Resource {
			return model.TokenResponse{}, model.BadRequest(model.ErrInvalidTarget, "resource does not match the grant")
		}
	}
	// A refresh may narrow the scopes, never widen them (RFC 6749 §6).
	scopes := tok.Scopes
	if strings.TrimSpace(in.Scope) != "" {
		var narrowed []string
		for _, sc := range ResolveScopes(in.Scope, tok.Resource) {
			if slices.Contains(tok.Scopes, sc) {
				narrowed = append(narrowed, sc)
			}
		}
		if len(narrowed) == 0 {
			return model.TokenResponse{}, model.BadRequest(model.ErrInvalidScope, "the requested scope exceeds the grant")
		}
		scopes = narrowed
	}
	var out model.TokenResponse
	raced := false
	err = s.inTx(ctx, func(q *db.Queries) error {
		if err := s.grantAllowed(ctx, q, tok.UserID, tok.OrganizationID.Int64); err != nil {
			return err
		}
		// Revoking is the claim: of two concurrent refreshes only one wins,
		// and the loser is treated as reuse.
		n, err := q.RevokeMCPOAuthToken(ctx, tok.ID)
		if err != nil {
			return serverError(err)
		}
		if n == 0 {
			raced = true
			return errRefreshRaced
		}
		// Retire the old access token with the old refresh token.
		if err := q.RevokeMCPOAuthFamily(ctx, tok.Family); err != nil {
			return serverError(err)
		}
		out, err = s.issue(ctx, q, issueArgs{
			family: tok.Family, grantID: tok.GrantID, clientID: tok.ClientID, userID: tok.UserID,
			orgID: tok.OrganizationID.Int64, resource: tok.Resource, scopes: scopes,
		})
		return err
	})
	if raced {
		if rerr := s.q.RevokeMCPOAuthFamily(ctx, tok.Family); rerr != nil {
			s.log.Error("mcp_oauth_refresh_race_revoke_failed", "error", rerr)
		}
		s.log.Warn("mcp_oauth_refresh_race", "client_id", tok.ClientID, "user_id", tok.UserID)
		return model.TokenResponse{}, model.BadRequest(model.ErrInvalidGrant, "the refresh token is invalid or expired")
	}
	if err != nil {
		return model.TokenResponse{}, asOAuthError(err)
	}
	s.touchClient(ctx, in.ClientID)
	return out, nil
}

type issueArgs struct {
	family             uuid.UUID
	grantID, userID    int64
	orgID              int64
	clientID, resource string
	scopes             []string
}

func (s *Service) issue(ctx context.Context, q *db.Queries, a issueArgs) (model.TokenResponse, error) {
	access, refresh := randomToken(32), randomToken(32)
	now := s.now()
	for _, t := range []struct {
		raw, kind string
		ttl       time.Duration
	}{{access, model.KindAccess, model.AccessTTL}, {refresh, model.KindRefresh, model.RefreshTTL}} {
		if err := q.CreateMCPOAuthToken(ctx, db.CreateMCPOAuthTokenParams{
			TokenHash: HashToken(t.raw), Kind: t.kind, Family: a.family, GrantID: a.grantID,
			ClientID: a.clientID, UserID: a.userID, OrganizationID: orgArg(a.orgID),
			Resource: a.resource, Scopes: a.scopes, ExpiresAt: ts(now.Add(t.ttl)),
		}); err != nil {
			return model.TokenResponse{}, serverError(err)
		}
	}
	return model.TokenResponse{
		AccessToken: access, TokenType: "Bearer", ExpiresIn: int(model.AccessTTL.Seconds()),
		RefreshToken: refresh, Scope: strings.Join(a.scopes, " "),
	}, nil
}

func (s *Service) touchClient(ctx context.Context, clientID string) {
	if err := s.q.TouchMCPOAuthClient(ctx, clientID); err != nil {
		s.log.Warn("mcp_oauth_client_touch_failed", "error", err)
	}
}

func asOAuthError(err error) error {
	var oe *model.Error
	if errors.As(err, &oe) {
		return oe
	}
	return serverError(err)
}

// --- revocation (RFC 7009) ---------------------------------------------------------

// Revoke revokes the family of an access or refresh token. Unknown tokens and
// tokens of another client are ignored (the endpoint always answers 200).
func (s *Service) Revoke(ctx context.Context, ip, clientID, token string) error {
	if err := s.allow(ctx, "revoke", ip, model.RevokePerHour); err != nil {
		return err
	}
	if token == "" {
		return model.BadRequest(model.ErrInvalidRequest, "token is required")
	}
	h := HashToken(token)
	for _, kind := range []string{model.KindAccess, model.KindRefresh} {
		t, err := s.q.GetMCPOAuthTokenAnyState(ctx, db.GetMCPOAuthTokenAnyStateParams{TokenHash: h, Kind: kind})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return serverError(err)
		}
		if clientID != "" && t.ClientID != clientID {
			return nil
		}
		if err := s.q.RevokeMCPOAuthFamily(ctx, t.Family); err != nil {
			return serverError(err)
		}
	}
	return nil
}

// --- resource server ----------------------------------------------------------------

// ValidateAccessToken resolves a raw Bearer token for the MCP endpoint at
// resource. The token must be live, of a live grant and client, of an active
// user and issued for that endpoint (audience); otherwise ErrUnauthorized.
// With MCP off in the organization's plan it returns ErrFeatureDisabled.
func (s *Service) ValidateAccessToken(ctx context.Context, raw, resource string) (model.AccessToken, error) {
	if raw == "" {
		return model.AccessToken{}, ErrUnauthorized
	}
	t, err := s.q.GetActiveMCPOAuthToken(ctx, db.GetActiveMCPOAuthTokenParams{TokenHash: HashToken(raw), Kind: model.KindAccess})
	if errors.Is(err, pgx.ErrNoRows) {
		return model.AccessToken{}, ErrUnauthorized
	}
	if err != nil {
		return model.AccessToken{}, fmt.Errorf("oauth: token: %w", err)
	}
	if t.UserStatus == "disabled" || t.Resource != resource {
		return model.AccessToken{}, ErrUnauthorized
	}
	on, err := s.mcpEnabled(ctx, t.OrganizationID.Int64)
	if err != nil {
		return model.AccessToken{}, err
	}
	if !on {
		return model.AccessToken{}, ErrFeatureDisabled
	}
	if err := s.q.TouchMCPOAuthToken(ctx, t.ID); err != nil {
		s.log.Warn("mcp_oauth_token_touch_failed", "error", err)
	}
	return model.AccessToken{
		ID: t.ID, Family: t.Family, GrantID: t.GrantID, ClientID: t.ClientID, UserID: t.UserID,
		OrganizationID: t.OrganizationID.Int64, Resource: t.Resource, Scopes: t.Scopes,
		ExpiresAt: t.ExpiresAt.Time,
	}, nil
}

// --- metadata -------------------------------------------------------------------------

// AuthorizationServerMetadata is the RFC 8414 document.
func (s *Service) AuthorizationServerMetadata() map[string]any {
	return map[string]any{
		"issuer":                                         s.issuer,
		"authorization_endpoint":                         s.issuer + "/oauth/authorize",
		"token_endpoint":                                 s.issuer + "/oauth/token",
		"registration_endpoint":                          s.issuer + "/oauth/register",
		"revocation_endpoint":                            s.issuer + "/oauth/revoke",
		"response_types_supported":                       []string{"code"},
		"response_modes_supported":                       []string{"query"},
		"grant_types_supported":                          []string{model.GrantAuthorizationCode, model.GrantRefreshToken},
		"code_challenge_methods_supported":               []string{"S256"},
		"token_endpoint_auth_methods_supported":          []string{"none"},
		"revocation_endpoint_auth_methods_supported":     []string{"none"},
		"scopes_supported":                               model.AllScopes,
		"authorization_response_iss_parameter_supported": true,
	}
}

// ProtectedResourceMetadata is the RFC 9728 document of an MCP endpoint.
func (s *Service) ProtectedResourceMetadata(resource string) map[string]any {
	name := "Otopoly MCP"
	if resource == model.ResourcePlatform {
		name = "Otopoly MCP (platform)"
	}
	return map[string]any{
		"resource":                 s.ResourceURL(resource),
		"authorization_servers":    []string{s.issuer},
		"scopes_supported":         model.ResourceScopes(resource),
		"bearer_methods_supported": []string{"header"},
		"resource_name":            name,
	}
}

// ResourceMetadataURL is the RFC 9728 metadata URL of an MCP endpoint (for the
// WWW-Authenticate challenge).
func (s *Service) ResourceMetadataURL(resource string) string {
	return s.issuer + "/.well-known/oauth-protected-resource" + resource
}

// --- maintenance ------------------------------------------------------------------------

// UnusedClientAge is how old a never connected registration must be before
// Cleanup deletes it.
const UnusedClientAge = 7 * 24 * time.Hour

// Cleanup removes expired requests, codes and tokens and registrations that
// never connected (idempotent; run periodically).
func (s *Service) Cleanup(ctx context.Context) error {
	createdBefore := ts(s.now().Add(-UnusedClientAge))
	var total int64
	for _, f := range []func(context.Context) (int64, error){
		s.q.CleanupMCPOAuthAuthRequests, s.q.CleanupMCPOAuthCodes, s.q.CleanupMCPOAuthTokens,
		func(ctx context.Context) (int64, error) { return s.q.CleanupMCPOAuthClients(ctx, createdBefore) },
	} {
		n, err := f(ctx)
		if err != nil {
			return fmt.Errorf("oauth: cleanup: %w", err)
		}
		total += n
	}
	if total > 0 {
		s.log.Info("mcp_oauth_cleanup", "deleted", total)
	}
	return nil
}
