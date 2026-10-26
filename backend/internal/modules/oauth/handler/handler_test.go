package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/google/uuid"
)

type fakeService struct {
	gotIP    string
	gotToken model.TokenInput
	err      error
}

func (f *fakeService) Register(_ context.Context, ip string, in model.RegisterInput) (model.Client, error) {
	f.gotIP = ip
	if f.err != nil {
		return model.Client{}, f.err
	}
	return model.Client{ClientID: "mcp_x", ClientName: in.ClientName, RedirectURIs: in.RedirectURIs, IssuedAt: time.Unix(1700000000, 0)}, nil
}

func (f *fakeService) Exchange(_ context.Context, _ string, in model.TokenInput) (model.TokenResponse, error) {
	f.gotToken = in
	if f.err != nil {
		return model.TokenResponse{}, f.err
	}
	return model.TokenResponse{AccessToken: "a", TokenType: "Bearer", ExpiresIn: 3600, RefreshToken: "r", Scope: "mcp:read"}, nil
}

func (f *fakeService) Revoke(context.Context, string, string, string) error { return f.err }

func (f *fakeService) AuthorizationServerMetadata() map[string]any {
	return map[string]any{"issuer": "https://app.test"}
}

func (f *fakeService) ProtectedResourceMetadata(resource string) map[string]any {
	return map[string]any{"resource": "https://app.test" + resource}
}

func TestRegisterAndMetadata(t *testing.T) {
	svc := &fakeService{}
	h := New(svc, nil)
	req := httptest.NewRequest(http.MethodPost, "/oauth/register", strings.NewReader(`{"client_name":"Claude","redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}`))
	req.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.1")
	rec := httptest.NewRecorder()
	h.Register(rec, req)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != http.StatusCreated || body["client_id"] != "mcp_x" || body["token_endpoint_auth_method"] != "none" ||
		body["scope"] != "mcp:read mcp:write" || svc.gotIP != "203.0.113.9" {
		t.Fatalf("register = %d %s ip=%s", rec.Code, rec.Body, svc.gotIP)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "*" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("headers = %v", rec.Header())
	}

	rec = httptest.NewRecorder()
	h.Register(rec, httptest.NewRequest(http.MethodPost, "/oauth/register", strings.NewReader(`not json`)))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_client_metadata") {
		t.Fatalf("bad body = %d %s", rec.Code, rec.Body)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/oauth-protected-resource/mcp/{endpoint}", h.ProtectedResource)
	for path, want := range map[string]int{
		"/.well-known/oauth-protected-resource/mcp/org":      http.StatusOK,
		"/.well-known/oauth-protected-resource/mcp/platform": http.StatusOK,
		"/.well-known/oauth-protected-resource/mcp/dealer":   http.StatusNotFound,
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != want {
			t.Errorf("%s = %d", path, rec.Code)
		}
	}
}

func TestTokenErrors(t *testing.T) {
	svc := &fakeService{}
	h := New(svc, nil)
	form := url.Values{"grant_type": {"authorization_code"}, "client_id": {"mcp_x"}, "code": {"c"},
		"redirect_uri": {"https://claude.ai/cb"}, "code_verifier": {"v"}, "resource": {"https://app.test/mcp/org"}}
	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		rec := httptest.NewRecorder()
		h.Token(rec, req)
		return rec
	}
	if rec := post(); rec.Code != http.StatusOK || svc.gotToken.Resource != "https://app.test/mcp/org" || svc.gotToken.CodeVerifier != "v" {
		t.Fatalf("token = %d %s %+v", rec.Code, rec.Body, svc.gotToken)
	}
	svc.err = &model.Error{Status: http.StatusUnauthorized, Code: model.ErrInvalidClient, Description: "unknown"}
	if rec := post(); rec.Code != http.StatusUnauthorized || rec.Header().Get("WWW-Authenticate") == "" {
		t.Fatalf("invalid client = %d %v", rec.Code, rec.Header())
	}
	svc.err = &model.Error{Status: http.StatusTooManyRequests, Code: model.ErrSlowDown, RetryAfter: 30 * time.Second}
	if rec := post(); rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "31" {
		t.Fatalf("rate limit = %d %v", rec.Code, rec.Header())
	}
	svc.err = errors.New("db down")
	rec := post()
	if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), "db down") {
		t.Fatalf("internal error leaked: %d %s", rec.Code, rec.Body)
	}
}

type fakeConsent struct {
	to  string
	err error
}

func (f fakeConsent) Authorize(context.Context, string, model.AuthorizeInput) (string, error) {
	return f.to, f.err
}
func (fakeConsent) Consent(context.Context, usecase.Actor, uuid.UUID) (model.Consent, error) {
	return model.Consent{}, usecase.ErrNotFound
}
func (fakeConsent) Decide(context.Context, usecase.Actor, uuid.UUID, model.DecideInput) (model.Decision, error) {
	return model.Decision{}, &usecase.ForbiddenError{Message: "no"}
}
func (fakeConsent) ListGrants(context.Context, int64, usecase.GrantFilter) ([]model.Grant, int64, error) {
	return nil, 0, nil
}
func (fakeConsent) RevokeGrant(context.Context, usecase.Actor, uuid.UUID) error { return nil }
func (fakeConsent) ListClients(context.Context, usecase.ClientFilter) ([]model.ClientSummary, int64, error) {
	return nil, 0, nil
}
func (fakeConsent) RevokeClient(context.Context, usecase.Actor, uuid.UUID) error { return nil }

func TestAuthorizeRedirectsOrRendersError(t *testing.T) {
	c := NewConsent(fakeConsent{to: "https://app.test/oauth/consent?request=1"}, New(&fakeService{}, nil))
	rec := httptest.NewRecorder()
	c.Authorize(rec, httptest.NewRequest(http.MethodGet, "/oauth/authorize?client_id=x", nil))
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "https://app.test/oauth/consent?request=1" {
		t.Fatalf("authorize = %d %v", rec.Code, rec.Header())
	}
	c = NewConsent(fakeConsent{err: model.BadRequest(model.ErrInvalidClient, "unknown <client>")}, New(&fakeService{}, nil))
	rec = httptest.NewRecorder()
	c.Authorize(rec, httptest.NewRequest(http.MethodGet, "/oauth/authorize", nil))
	if rec.Code != http.StatusBadRequest || rec.Header().Get("Location") != "" || strings.Contains(rec.Body.String(), "<client>") {
		t.Fatalf("unknown client must render an escaped page: %d %s", rec.Code, rec.Body)
	}
}

func TestConsentErrorsMapToEnvelope(t *testing.T) {
	c := NewConsent(fakeConsent{}, New(&fakeService{}, nil))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/mcp/oauth/requests/{uuid}", c.ConsentInfo)
	mux.HandleFunc("POST /v1/mcp/oauth/requests/{uuid}/decide", c.Decide)
	ctx := authctx.WithPrincipal(context.Background(), authctx.Principal{UserInternal: 1})
	id := uuid.NewString()
	for _, tc := range []struct {
		method, path, body string
		want               int
	}{
		{http.MethodGet, "/v1/mcp/oauth/requests/" + id, "", http.StatusNotFound},
		{http.MethodGet, "/v1/mcp/oauth/requests/not-a-uuid", "", http.StatusNotFound},
		{http.MethodPost, "/v1/mcp/oauth/requests/" + id + "/decide", `{"decision":"approve"}`, http.StatusForbidden},
		{http.MethodPost, "/v1/mcp/oauth/requests/" + id + "/decide", `{"decision":"approve","extra":1}`, http.StatusBadRequest},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)).WithContext(ctx)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Errorf("%s %s = %d %s", tc.method, tc.path, rec.Code, rec.Body)
		}
	}
}
