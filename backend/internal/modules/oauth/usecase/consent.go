package usecase

// The /oauth/authorize endpoint, the consent screen data and decision, the
// user's connected apps and the platform client list.
//
//   - /mcp/org: the user picks one organization they are an active member of
//     and hold tenant.mcp.connect in, with MCP on in its plan. The token is
//     bound to that organization.
//   - /mcp/platform: the user must hold platform.mcp.connect (super admins
//     do); the token has no organization.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrNotFound: the request, grant or client is missing, expired, foreign or
// already decided (404).
var ErrNotFound = errors.New("oauth: not found")

// ForbiddenError is a consent the caller may not give (403).
type ForbiddenError struct{ Message string }

func (e *ForbiddenError) Error() string { return "oauth: forbidden: " + e.Message }

func forbidden(msg string) error { return &ForbiddenError{Message: msg} }

func invalid(field, msg string) error {
	return &apiquery.ValidationError{Details: []apiquery.Detail{{Field: field, Message: msg}}}
}

// ToolCounter counts the MCP tools a user would get on an endpoint (in an
// organization for /mcp/org) with the given scopes; the consent screen shows
// it (mcp.ToolCounter).
type ToolCounter interface {
	CountTools(ctx context.Context, userID, orgID int64, resource string, scopes []string) (int, error)
}

// SetToolCounter attaches the consent tool count; without it the count is
// null.
func (s *Service) SetToolCounter(c ToolCounter) { s.tools = c }

// Actor is the signed-in user deciding on consent or managing grants.
type Actor struct {
	Principal authctx.Principal
	Request   *http.Request
}

func (a Actor) userID() int64 { return a.Principal.UserInternal }

// --- authorize endpoint ------------------------------------------------------------

// Authorize serves GET /oauth/authorize: it applies the per-IP limit,
// validates and stores the request and returns where to send the browser:
// the consent screen, or (for errors after client and redirect_uri are
// verified) the client's redirect_uri with error, state and iss. An unknown
// client, an unregistered redirect_uri or the rate limit is returned as a
// *model.Error that must be shown to the user, never redirected.
func (s *Service) Authorize(ctx context.Context, ip string, in model.AuthorizeInput) (string, error) {
	if err := s.allow(ctx, "authorize", ip, model.AuthorizePerHour); err != nil {
		return "", err
	}
	req, err := s.CreateAuthRequest(ctx, in)
	if err != nil {
		var oe *model.Error
		if errors.As(err, &oe) {
			if !oe.Redirectable {
				return "", oe
			}
			return s.errorRedirect(in.RedirectURI, in.State, oe.Code, oe.Description)
		}
		return "", serverError(err)
	}
	return s.issuer + model.ConsentPath + "?request=" + req.ID.String(), nil
}

// errorRedirect builds the client redirect of an authorization error (RFC
// 6749 §4.1.2.1, iss per RFC 9207).
func (s *Service) errorRedirect(redirectURI, state, code, desc string) (string, error) {
	u, err := url.Parse(redirectURI)
	if err != nil {
		return "", serverError(err)
	}
	v := u.Query()
	v.Set("error", code)
	if desc != "" {
		v.Set("error_description", desc)
	}
	if state != "" {
		v.Set("state", state)
	}
	v.Set("iss", s.issuer)
	u.RawQuery = v.Encode()
	return u.String(), nil
}

// --- consent ------------------------------------------------------------------------

type selectableOrg struct {
	model.ConsentOrganization
	id int64
}

// selectable lists the organizations the actor may bind an /mcp/org token
// to: active membership, tenant.mcp.connect and MCP on in the plan.
func (s *Service) selectable(ctx context.Context, a Actor) ([]selectableOrg, error) {
	if !a.Principal.HasPermission(rbac.PermTenantMCPConnect) {
		return nil, nil
	}
	rows, err := s.q.ListMCPOAuthSelectableOrgs(ctx, a.userID())
	if err != nil {
		return nil, fmt.Errorf("oauth: organizations: %w", err)
	}
	out := make([]selectableOrg, 0, len(rows))
	for _, r := range rows {
		on, err := s.mcpEnabled(ctx, r.ID)
		if err != nil {
			return nil, err
		}
		if !on {
			continue
		}
		out = append(out, selectableOrg{
			ConsentOrganization: model.ConsentOrganization{UUID: r.Uuid, Slug: r.Slug, Name: r.Name, Role: r.Role},
			id:                  r.ID,
		})
	}
	return out, nil
}

// PlatformAllowed reports whether the principal may connect the platform
// endpoint.
func PlatformAllowed(p authctx.Principal) bool { return p.HasPermission(rbac.PermPlatformMCPConnect) }

// Consent returns the consent screen data of a pending request.
func (s *Service) Consent(ctx context.Context, a Actor, id uuid.UUID) (model.Consent, error) {
	req, err := s.GetAuthRequest(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Consent{}, ErrNotFound
	}
	if err != nil {
		return model.Consent{}, err
	}
	host := req.RedirectURI
	if u, err := url.Parse(req.RedirectURI); err == nil && u.Host != "" {
		host = u.Host
	}
	out := model.Consent{
		RequestID: req.ID, ClientID: req.ClientID, ClientName: req.ClientName, RedirectHost: host,
		Resource: req.Resource, ResourceURL: s.ResourceURL(req.Resource), Realm: model.RealmOf(req.Resource),
		Scopes: req.Scopes, Organizations: []model.ConsentOrganization{}, ExpiresAt: req.ExpiresAt,
	}
	if req.Resource == model.ResourcePlatform {
		out.Allowed = PlatformAllowed(a.Principal)
		if out.Allowed && s.tools != nil {
			n, err := s.tools.CountTools(ctx, a.userID(), 0, req.Resource, req.Scopes)
			if err != nil {
				return model.Consent{}, fmt.Errorf("oauth: tool count: %w", err)
			}
			out.PlatformToolCount = &n
		}
		return out, nil
	}
	orgs, err := s.selectable(ctx, a)
	if err != nil {
		return model.Consent{}, err
	}
	for _, o := range orgs {
		co := o.ConsentOrganization
		if s.tools != nil {
			n, err := s.tools.CountTools(ctx, a.userID(), o.id, req.Resource, req.Scopes)
			if err != nil {
				return model.Consent{}, fmt.Errorf("oauth: tool count: %w", err)
			}
			co.ToolCount = &n
		}
		out.Organizations = append(out.Organizations, co)
	}
	out.Allowed = len(out.Organizations) > 0
	return out, nil
}

// GrantedScopes resolves the scopes of an approval: the requested scopes,
// narrowed by the user's choice (write implies read). An empty choice keeps
// every requested scope.
func GrantedScopes(requested, chosen []string) ([]string, error) {
	if len(chosen) == 0 {
		return slices.Clone(requested), nil
	}
	want := map[string]bool{}
	for _, sc := range chosen {
		if !slices.Contains(requested, sc) {
			return nil, invalid("scopes", "only requested scopes can be granted")
		}
		want[sc] = true
	}
	want[model.ScopeRead] = true
	out := make([]string, 0, len(want))
	for _, sc := range model.AllScopes {
		if want[sc] && slices.Contains(requested, sc) {
			out = append(out, sc)
		}
	}
	return out, nil
}

// Decide approves (binding the token to the chosen organization) or denies a
// pending request and returns the client redirect: the code on approval,
// error=access_denied on denial. The request is consumed either way.
func (s *Service) Decide(ctx context.Context, a Actor, id uuid.UUID, in model.DecideInput) (model.Decision, error) {
	if in.Decision != model.DecisionApprove && in.Decision != model.DecisionDeny {
		return model.Decision{}, invalid("decision", "must be approve or deny")
	}
	req, err := s.GetAuthRequest(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Decision{}, ErrNotFound
	}
	if err != nil {
		return model.Decision{}, err
	}
	payload := map[string]any{"client_id": req.ClientID, "client_name": req.ClientName, "resource": req.Resource}
	if in.Decision == model.DecisionDeny {
		return s.deny(ctx, a, req, payload)
	}
	scopes, err := GrantedScopes(req.Scopes, in.Scopes)
	if err != nil {
		return model.Decision{}, err
	}
	payload["scopes"] = scopes

	var orgID int64
	if req.Resource == model.ResourcePlatform {
		if !PlatformAllowed(a.Principal) {
			return model.Decision{}, forbidden("the platform MCP endpoint requires the platform.mcp.connect permission")
		}
	} else {
		if in.OrganizationUUID == nil {
			return model.Decision{}, invalid("organization_uuid", "required to approve")
		}
		orgs, err := s.selectable(ctx, a)
		if err != nil {
			return model.Decision{}, err
		}
		var chosen *selectableOrg
		for i := range orgs {
			if orgs[i].UUID == *in.OrganizationUUID {
				chosen = &orgs[i]
				break
			}
		}
		if chosen == nil {
			return model.Decision{}, forbidden("the organization cannot be connected: no membership, no tenant.mcp.connect permission or MCP is off in its plan")
		}
		orgID = chosen.id
		payload["organization_uuid"] = chosen.UUID.String()
		payload["organization_name"] = chosen.Name
	}
	redirect, grant, err := s.issueCode(ctx, req.ID, a.userID(), orgID, scopes)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Decision{}, ErrNotFound
	}
	if err != nil {
		return model.Decision{}, err
	}
	g := grant.Uuid
	rctx := ctx
	if orgID > 0 {
		rctx = activity.WithOrganization(ctx, orgID)
	}
	s.record(rctx, a.userID(), model.ActionConsentApproved, "mcp_oauth_grants", &g, payload, a.Request)
	return model.Decision{RedirectURL: redirect}, nil
}

func (s *Service) deny(ctx context.Context, a Actor, req model.AuthRequest, payload map[string]any) (model.Decision, error) {
	n, err := s.q.DeleteMCPOAuthAuthRequest(ctx, req.ID)
	if err != nil {
		return model.Decision{}, err
	}
	if n == 0 {
		return model.Decision{}, ErrNotFound
	}
	id := req.ID
	s.record(ctx, a.userID(), model.ActionConsentDenied, "mcp_oauth_auth_requests", &id, payload, a.Request)
	redirect, err := s.errorRedirect(req.RedirectURI, req.State, model.ErrAccessDenied, "the user denied access")
	if err != nil {
		return model.Decision{}, err
	}
	return model.Decision{RedirectURL: redirect}, nil
}

// --- connected apps -------------------------------------------------------------------

// GrantFilter is a parsed grant list query.
type GrantFilter struct {
	Q                string
	Resource         string
	OrganizationUUID *uuid.UUID
	Limit, Offset    int32
}

// ParseGrantFilter reads q, realm (org|platform), organization_uuid, limit
// and offset.
func ParseGrantFilter(values url.Values) (GrantFilter, error) {
	q := apiquery.Parse(values)
	f := GrantFilter{Q: strings.TrimSpace(q.Q), Limit: q.Limit, Offset: q.Offset}
	switch strings.TrimSpace(values.Get("realm")) {
	case "":
	case model.RealmOrg:
		f.Resource = model.ResourceOrg
	case model.RealmPlatform:
		f.Resource = model.ResourcePlatform
	default:
		return f, invalid("realm", "must be org or platform")
	}
	if raw := strings.TrimSpace(values.Get("organization_uuid")); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			return f, invalid("organization_uuid", "must be a uuid")
		}
		f.OrganizationUUID = &id
	}
	return f, nil
}

func textNarg(s string) (t pgtype.Text) {
	if s != "" {
		t.String, t.Valid = s, true
	}
	return t
}

func uuidNarg(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}

// ListGrants lists the user's connected apps (live grants of live clients).
func (s *Service) ListGrants(ctx context.Context, userID int64, f GrantFilter) ([]model.Grant, int64, error) {
	rows, err := s.q.ListUserMCPOAuthGrants(ctx, db.ListUserMCPOAuthGrantsParams{
		UserID: userID, Resource: textNarg(f.Resource), OrganizationUuid: uuidNarg(f.OrganizationUUID),
		Q: textNarg(f.Q), RowLimit: f.Limit, RowOffset: f.Offset,
	})
	if err != nil {
		return nil, 0, fmt.Errorf("oauth: grants: %w", err)
	}
	total, err := s.q.CountUserMCPOAuthGrants(ctx, db.CountUserMCPOAuthGrantsParams{
		UserID: userID, Resource: textNarg(f.Resource), OrganizationUuid: uuidNarg(f.OrganizationUUID), Q: textNarg(f.Q),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("oauth: grants count: %w", err)
	}
	out := make([]model.Grant, 0, len(rows))
	for _, r := range rows {
		g := model.Grant{
			UUID: r.Uuid, ClientID: r.ClientID, ClientName: r.ClientName, Resource: r.Resource,
			Realm: model.RealmOf(r.Resource), Scopes: r.Scopes,
			CreatedAt: r.CreatedAt.Time, LastUsedAt: timePtr(r.LastUsedAt),
		}
		if r.OrganizationUuid.Valid {
			id := uuid.UUID(r.OrganizationUuid.Bytes)
			slug, name := r.OrganizationSlug.String, r.OrganizationName.String
			g.OrganizationUUID, g.OrganizationSlug, g.OrganizationName = &id, &slug, &name
		}
		if g.Scopes == nil {
			g.Scopes = []string{}
		}
		out = append(out, g)
	}
	return out, total, nil
}

// RevokeGrant disconnects one of the actor's apps: the grant and every token
// family issued under it (its access tokens answer 401 at once).
func (s *Service) RevokeGrant(ctx context.Context, a Actor, id uuid.UUID) error {
	var g db.RevokeUserMCPOAuthGrantRow
	err := s.inTx(ctx, func(q *db.Queries) error {
		var err error
		g, err = q.RevokeUserMCPOAuthGrant(ctx, db.RevokeUserMCPOAuthGrantParams{Uuid: id, UserID: a.userID()})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		return q.RevokeMCPOAuthGrantTokens(ctx, g.ID)
	})
	if err != nil {
		return err
	}
	s.record(ctx, a.userID(), model.ActionGrantRevoked, "mcp_oauth_grants", &g.Uuid,
		map[string]any{"client_id": g.ClientID, "client_name": g.ClientName, "resource": g.Resource}, a.Request)
	return nil
}

// --- platform clients -----------------------------------------------------------------

// ClientFilter is a parsed client list query.
type ClientFilter struct {
	Q             string
	Status        string
	Limit, Offset int32
}

// ParseClientFilter reads q, status (active|revoked), limit and offset.
func ParseClientFilter(values url.Values) (ClientFilter, error) {
	q := apiquery.Parse(values)
	f := ClientFilter{Q: strings.TrimSpace(q.Q), Limit: q.Limit, Offset: q.Offset}
	switch st := strings.TrimSpace(values.Get("status")); st {
	case "", model.ClientStatusActive, model.ClientStatusRevoked:
		f.Status = st
	default:
		return f, invalid("status", "must be active or revoked")
	}
	return f, nil
}

// ListClients lists every registered client (platform admin).
func (s *Service) ListClients(ctx context.Context, f ClientFilter) ([]model.ClientSummary, int64, error) {
	rows, err := s.q.ListMCPOAuthClients(ctx, db.ListMCPOAuthClientsParams{
		Status: textNarg(f.Status), Q: textNarg(f.Q), RowLimit: f.Limit, RowOffset: f.Offset,
	})
	if err != nil {
		return nil, 0, fmt.Errorf("oauth: clients: %w", err)
	}
	total, err := s.q.CountMCPOAuthClients(ctx, db.CountMCPOAuthClientsParams{Status: textNarg(f.Status), Q: textNarg(f.Q)})
	if err != nil {
		return nil, 0, fmt.Errorf("oauth: clients count: %w", err)
	}
	out := make([]model.ClientSummary, 0, len(rows))
	for _, r := range rows {
		c := model.ClientSummary{
			UUID: r.Uuid, ClientID: r.ClientID, ClientName: r.ClientName, RedirectURIs: r.RedirectUris,
			Status: model.ClientStatusActive, ActiveGrants: r.ActiveGrants, CreatedAt: r.CreatedAt.Time,
			LastUsedAt: timePtr(r.LastUsedAt), RevokedAt: timePtr(r.RevokedAt),
		}
		if r.CreatedIp.Valid {
			ip := r.CreatedIp.String
			c.CreatedIP = &ip
		}
		if r.RevokedAt.Valid {
			c.Status = model.ClientStatusRevoked
		}
		if c.RedirectURIs == nil {
			c.RedirectURIs = []string{}
		}
		out = append(out, c)
	}
	return out, total, nil
}

// RevokeClient blocks a client and everything issued to it: grants, tokens,
// pending requests and unused codes. Revoking again is a no-op success.
func (s *Service) RevokeClient(ctx context.Context, a Actor, id uuid.UUID) error {
	c, err := s.q.GetMCPOAuthClientByUUID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := s.q.RevokeMCPOAuthClient(ctx, c.ClientID); err != nil {
		return err
	}
	s.record(ctx, a.userID(), model.ActionClientRevoked, "mcp_oauth_clients", &c.Uuid,
		map[string]any{"client_id": c.ClientID, "client_name": c.ClientName, "already_revoked": c.RevokedAt.Valid}, a.Request)
	return nil
}

func timePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}
