package usecase

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type planToggle map[int64]bool

func (p planToggle) Enabled(_ context.Context, orgID int64, _ string) (bool, error) {
	on, ok := p[orgID]
	return !ok || on, nil
}

// The full flow on a real database: registration → authorize → consent →
// code exchange (PKCE) → token validation → refresh rotation → reuse
// detection → disconnect.
func TestOAuthFlowDB(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := database.NewPoolFromDSN(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	suffix := uuid.NewString()[:8]
	now := time.Now().UTC()
	org, err := q.CreateOrganization(ctx, db.CreateOrganizationParams{
		Slug: "mcp-flow-" + suffix, Name: "MCP Flow " + suffix, Status: "active",
		AccessStartsAt: pgtype.Timestamptz{Time: now.Add(-time.Hour), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	var userID int64
	var userUUID uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO users (email, password_hash, name, surname) VALUES ($1, 'x', 'M', 'C') RETURNING id, uuid`,
		"mcp-"+suffix+"@example.test").Scan(&userID, &userUUID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, org.ID, userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM mcp_oauth_clients WHERE client_name = $1`, "Flow "+suffix)
		_, _ = pool.Exec(c, `DELETE FROM organization_members WHERE organization_id = $1`, org.ID)
		_, _ = pool.Exec(c, `DELETE FROM users WHERE id = $1`, userID)
		_, _ = pool.Exec(c, `DELETE FROM organizations WHERE id = $1`, org.ID)
	})

	issuer := "https://app.otopoly.test"
	plan := planToggle{}
	svc := New(pool, plan, nil, issuer, nil)
	redirect := "http://127.0.0.1:33418/callback"
	client, err := svc.Register(ctx, "203.0.113.1", model.RegisterInput{ClientName: "Flow " + suffix, RedirectURIs: []string{redirect}})
	if err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("v", 50)
	to, err := svc.Authorize(ctx, "203.0.113.1", model.AuthorizeInput{
		ClientID: client.ClientID, RedirectURI: redirect, ResponseType: "code", CodeChallenge: S256(verifier),
		CodeChallengeMethod: "S256", State: "st", Resource: issuer + model.ResourceOrg,
	})
	if err != nil || !strings.HasPrefix(to, issuer+model.ConsentPath+"?request=") {
		t.Fatalf("authorize = %q %v", to, err)
	}
	reqID := uuid.MustParse(strings.TrimPrefix(to, issuer+model.ConsentPath+"?request="))
	actor := Actor{Principal: authctx.Principal{UserID: userUUID, UserInternal: userID, Permissions: []string{rbac.PermTenantMCPConnect}}}

	consent, err := svc.Consent(ctx, actor, reqID)
	if err != nil || !consent.Allowed || len(consent.Organizations) != 1 || consent.Organizations[0].UUID != org.Uuid {
		t.Fatalf("consent = %+v %v", consent, err)
	}
	if _, err := svc.Consent(ctx, Actor{Principal: authctx.Principal{UserInternal: userID}}, reqID); err != nil {
		t.Fatal(err)
	}
	other := uuid.New()
	var fe *ForbiddenError
	if _, err := svc.Decide(ctx, actor, reqID, model.DecideInput{Decision: model.DecisionApprove, OrganizationUUID: &other}); !errors.As(err, &fe) {
		t.Fatalf("foreign organization = %v", err)
	}
	dec, err := svc.Decide(ctx, actor, reqID, model.DecideInput{Decision: model.DecisionApprove, OrganizationUUID: &org.Uuid,
		Scopes: []string{model.ScopeRead}})
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(dec.RedirectURL)
	code := u.Query().Get("code")
	if code == "" || u.Query().Get("state") != "st" || u.Query().Get("iss") != issuer {
		t.Fatalf("redirect = %s", dec.RedirectURL)
	}
	if _, err := svc.Decide(ctx, actor, reqID, model.DecideInput{Decision: model.DecisionDeny}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second decision = %v", err)
	}

	exchange := model.TokenInput{GrantType: model.GrantAuthorizationCode, ClientID: client.ClientID, Code: code,
		RedirectURI: redirect, CodeVerifier: strings.Repeat("w", 50), Resource: issuer + model.ResourceOrg}
	if _, err := svc.Exchange(ctx, "ip", exchange); err == nil {
		t.Fatal("wrong verifier accepted")
	}
	exchange.CodeVerifier = verifier
	tok, err := svc.Exchange(ctx, "ip", exchange)
	if err != nil || tok.Scope != model.ScopeRead || tok.ExpiresIn != 3600 {
		t.Fatalf("exchange = %+v %v", tok, err)
	}
	at, err := svc.ValidateAccessToken(ctx, tok.AccessToken, model.ResourceOrg)
	if err != nil || at.OrganizationID != org.ID || at.UserID != userID || at.HasScope(model.ScopeWrite) {
		t.Fatalf("validate = %+v %v", at, err)
	}
	if _, err := svc.ValidateAccessToken(ctx, tok.AccessToken, model.ResourcePlatform); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("token on the other endpoint = %v", err)
	}
	plan[org.ID] = false
	if _, err := svc.ValidateAccessToken(ctx, tok.AccessToken, model.ResourceOrg); !errors.Is(err, ErrFeatureDisabled) {
		t.Fatalf("plan off = %v", err)
	}
	delete(plan, org.ID)

	refreshed, err := svc.Exchange(ctx, "ip", model.TokenInput{GrantType: model.GrantRefreshToken, ClientID: client.ClientID, RefreshToken: tok.RefreshToken})
	if err != nil || refreshed.RefreshToken == tok.RefreshToken {
		t.Fatalf("refresh = %+v %v", refreshed, err)
	}
	if _, err := svc.ValidateAccessToken(ctx, tok.AccessToken, model.ResourceOrg); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("old access token still valid after rotation")
	}
	// Reusing the rotated refresh token revokes the family.
	if _, err := svc.Exchange(ctx, "ip", model.TokenInput{GrantType: model.GrantRefreshToken, ClientID: client.ClientID, RefreshToken: tok.RefreshToken}); err == nil {
		t.Fatal("rotated refresh token accepted")
	}
	if _, err := svc.ValidateAccessToken(ctx, refreshed.AccessToken, model.ResourceOrg); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("family not revoked on refresh reuse")
	}
	// A replayed code is refused.
	if _, err := svc.Exchange(ctx, "ip", exchange); err == nil {
		t.Fatal("code replay accepted")
	}

	grants, total, err := svc.ListGrants(ctx, userID, GrantFilter{Limit: 10})
	if err != nil || total != 1 || grants[0].OrganizationUUID == nil || *grants[0].OrganizationUUID != org.Uuid {
		t.Fatalf("grants = %+v %d %v", grants, total, err)
	}
	if err := svc.RevokeGrant(ctx, actor, grants[0].UUID); err != nil {
		t.Fatal(err)
	}
	if err := svc.RevokeGrant(ctx, actor, grants[0].UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second revoke = %v", err)
	}
	if err := svc.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
}
