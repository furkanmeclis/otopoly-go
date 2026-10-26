package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database"

	"github.com/alicebob/miniredis/v2"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	authmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/identity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	orgmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/oidc"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ratelimit"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/stepup"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// nativeVerifier stands in for Apple / Google: it returns whatever identity
// the test put behind the raw id_token string.
type nativeVerifier struct{ identities map[string]oidc.Claims }

func (v *nativeVerifier) Verify(_ context.Context, provider, raw string, _ []string, _ string) (oidc.Claims, error) {
	c, ok := v.identities[raw]
	if !ok {
		return oidc.Claims{}, oidc.ErrInvalidToken
	}
	c.Provider = provider
	return c, nil
}

// registrationGate is the auth_settings singleton without touching the shared
// row (other suites run against the same database).
type registrationGate struct{ open *bool }

func (g registrationGate) CanPasswordRegister(context.Context) (bool, error) { return *g.open, nil }
func (g registrationGate) CanPasswordLogin(context.Context) (bool, error)    { return true, nil }
func (g registrationGate) CanPasskeyLogin(context.Context) (bool, error)     { return true, nil }
func (g registrationGate) RegistrationEnabled(context.Context) (bool, error) { return *g.open, nil }
func (g registrationGate) DefaultRoleID(context.Context) (*int64, error)     { return nil, nil }

type nativeEnv struct {
	mux      *http.ServeMux
	pool     *pgxpool.Pool
	q        *db.Queries
	verifier *nativeVerifier
	open     *bool
	suffix   string
}

type apiResult struct {
	status int
	data   map[string]any
	code   string
	detail map[string]string
	raw    string
}

func newNativeEnv(t *testing.T) *nativeEnv {
	t.Helper()
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
	tm, err := jwt.NewManager("test-secret-key-32-bytes-minimum!", time.Minute, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	box, err := crypto.NewSecretBox("0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	open := true
	env := &nativeEnv{pool: pool, q: q, verifier: &nativeVerifier{identities: map[string]oidc.Claims{}}, open: &open, suffix: uuid.NewString()[:8]}

	repo := repository.NewPostgres(pool, q)
	uc := usecase.New(repo, tm)
	uc.SetSecretBox(box, "Test")
	uc.SetAuthSettings(registrationGate{open: env.open})
	uc.SetNativeOAuth(usecase.NativeOAuthConfig{Verifier: env.verifier, AppleClientIDs: []string{"com.otopoly.app"}})
	orgSvc := orgusecase.New(pool, q)
	uc.SetOrganizationResolver(orgSvc)

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	stepUpSvc := stepup.NewService(q, stepup.NewStore(rdb, "test"), nil, nil)
	limiter := ratelimit.New(rdb, "test")
	h := handler.New(uc, nil, nil, nil, nil, "adapter-secret", stepUpSvc, activity.NewRecorder(q, nil))
	h.SetRateLimiter(limiter)
	loader := identity.Loader{UC: uc}
	env.mux = http.NewServeMux()
	authmodule.RegisterRoutes(env.mux, h, tm, loader, stepUpSvc)
	orgmodule.RegisterRoutes(env.mux, orgSvc, uc, nil, tm, loader, q, limiter, stepUpSvc)

	t.Cleanup(func() {
		c := context.Background()
		like := "%" + env.suffix + "%"
		_, _ = pool.Exec(c, `DELETE FROM organizations WHERE id IN (
			SELECT organization_id FROM organization_members m JOIN users u ON u.id = m.user_id WHERE u.email LIKE $1)`, like)
		_, _ = pool.Exec(c, `DELETE FROM oauth_accounts WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`, like)
		_, _ = pool.Exec(c, `DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`, like)
		_, _ = pool.Exec(c, `DELETE FROM users WHERE email LIKE $1`, like)
	})
	return env
}

// apple registers an Apple identity (subject + relay e-mail) and returns the
// raw id_token that resolves to it.
func (e *nativeEnv) apple(sub, email string) string {
	raw := "idt-" + sub
	e.verifier.identities[raw] = oidc.Claims{
		Subject: sub, Email: email, EmailVerified: true, IsPrivateEmail: strings.HasSuffix(email, "@privaterelay.appleid.com"),
		Audience: "com.otopoly.app",
	}
	return raw
}

func (e *nativeEnv) relayEmail(name string) string {
	return name + "-" + e.suffix + "@privaterelay.appleid.com"
}

func (e *nativeEnv) call(t *testing.T, method, path, token string, body any) apiResult {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "203.0.113.7:1234"
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	var env struct {
		Data  map[string]any `json:"data"`
		Error struct {
			Code    string `json:"code"`
			Details []struct {
				Field   string `json:"field"`
				Message string `json:"message"`
			} `json:"details"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	out := apiResult{status: rec.Code, data: env.Data, code: env.Error.Code, detail: map[string]string{}, raw: rec.Body.String()}
	for _, d := range env.Error.Details {
		out.detail[d.Field] = d.Message
	}
	return out
}

func (e *nativeEnv) expect(t *testing.T, res apiResult, status int, code, what string) {
	t.Helper()
	if res.status != status || res.code != code {
		t.Fatalf("%s: got %d %q, want %d %q (%s)", what, res.status, res.code, status, code, res.raw)
	}
}

func str(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

// nativeApple runs POST /oauth/apple/native and, when the relay choice comes
// back, "No, create a new account" (POST /oauth/link/create).
func (e *nativeEnv) signUpRelay(t *testing.T, idToken string) (tokens map[string]any, ticket string) {
	t.Helper()
	res := e.call(t, http.MethodPost, "/v1/auth/oauth/apple/native", "", map[string]string{"id_token": idToken, "given_name": "Deniz"})
	e.expect(t, res, http.StatusConflict, "OAUTH_LINK_CHOICE_REQUIRED", "relay sign-in")
	ticket = res.detail["link_ticket"]
	if ticket == "" || res.detail["register_allowed"] != "true" || res.detail["provider"] != "apple" {
		t.Fatalf("link choice details = %v", res.detail)
	}
	created := e.call(t, http.MethodPost, "/v1/auth/oauth/link/create", "", map[string]string{"link_ticket": ticket})
	e.expect(t, created, http.StatusOK, "", "link/create")
	return created.data, ticket
}

func TestNativeAppleRelaySignUpToBusinessDB(t *testing.T) {
	e := newNativeEnv(t)
	email := e.relayEmail("relay-new")
	idt := e.apple("apple-sub-new-"+e.suffix, email)

	tokens, ticket := e.signUpRelay(t, idt)
	access, refresh := str(tokens, "access_token"), str(tokens, "refresh_token")
	if access == "" || refresh == "" {
		t.Fatalf("tokens = %v", tokens)
	}

	me := e.call(t, http.MethodGet, "/v1/auth/me", access, nil)
	e.expect(t, me, http.StatusOK, "", "me after sign-up")
	user, _ := me.data["user"].(map[string]any)
	if str(user, "email") != email || str(user, "name") != "Deniz" {
		t.Fatalf("me.user = %v", user)
	}
	if orgs, _ := me.data["organizations"].([]any); len(orgs) != 0 {
		t.Fatalf("new account has organizations: %v", orgs)
	}

	// A retried link/create (double tap, lost response) signs into the same account.
	again := e.call(t, http.MethodPost, "/v1/auth/oauth/link/create", "", map[string]string{"link_ticket": ticket})
	e.expect(t, again, http.StatusOK, "", "link/create retry")
	againMe := e.call(t, http.MethodGet, "/v1/auth/me", str(again.data, "access_token"), nil)
	if u, _ := againMe.data["user"].(map[string]any); str(u, "uuid") != str(user, "uuid") {
		t.Fatalf("retry signed into another account: %v", againMe.raw)
	}

	// The refresh token of the fresh (organization-less) session works.
	refreshed := e.call(t, http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refresh_token": refresh})
	e.expect(t, refreshed, http.StatusOK, "", "refresh before the business exists")
	access = str(refreshed.data, "access_token")

	created := e.call(t, http.MethodPost, "/v1/auth/organizations", access, map[string]string{
		"organization_name": "Relay Oto " + e.suffix, "phone": "05321234567", "city": "İzmir",
	})
	e.expect(t, created, http.StatusCreated, "", "create business")
	org, _ := created.data["organization"].(map[string]any)
	slug := str(org, "slug")
	if slug == "" {
		t.Fatalf("organization = %v", created.raw)
	}

	scoped := e.call(t, http.MethodPost, "/v1/auth/organization-context", access, map[string]string{"organization_slug": slug})
	e.expect(t, scoped, http.StatusOK, "", "organization context")
	scopedMe := e.call(t, http.MethodGet, "/v1/auth/me", str(scoped.data, "access_token"), nil)
	e.expect(t, scopedMe, http.StatusOK, "", "me in the business")
	orgs, _ := scopedMe.data["organizations"].([]any)
	if len(orgs) != 1 || str(orgs[0].(map[string]any), "slug") != slug || str(orgs[0].(map[string]any), "role") != "owner" {
		t.Fatalf("organizations = %v", scopedMe.raw)
	}
	if perms, _ := scopedMe.data["permissions"].([]any); len(perms) == 0 {
		t.Fatalf("owner has no tenant permissions: %v", scopedMe.raw)
	}

	// Refreshing the organization-scoped session keeps working (no sign-out loop).
	scopedRefresh := e.call(t, http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refresh_token": str(scoped.data, "refresh_token")})
	e.expect(t, scopedRefresh, http.StatusOK, "", "refresh in the business")
	if e.call(t, http.MethodGet, "/v1/auth/me", str(scopedRefresh.data, "access_token"), nil).status != http.StatusOK {
		t.Fatal("refreshed organization token rejected")
	}
	// The rotated (first) refresh token is single use.
	e.expect(t, e.call(t, http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refresh_token": refresh}), http.StatusUnauthorized, "UNAUTHENTICATED", "reused refresh token")

	// Same Apple subject later: plain sign-in into the same account, straight into the business.
	signIn := e.call(t, http.MethodPost, "/v1/auth/oauth/apple/native", "", map[string]string{"id_token": idt})
	e.expect(t, signIn, http.StatusOK, "", "same Apple subject signs in again")
	withSlug := e.call(t, http.MethodPost, "/v1/auth/oauth/apple/native", "", map[string]string{"id_token": idt, "organization_slug": slug})
	e.expect(t, withSlug, http.StatusOK, "", "sign in with organization_slug")
	signedMe := e.call(t, http.MethodGet, "/v1/auth/me", str(withSlug.data, "access_token"), nil)
	if u, _ := signedMe.data["user"].(map[string]any); str(u, "uuid") != str(user, "uuid") {
		t.Fatalf("second sign-in landed elsewhere: %v", signedMe.raw)
	}
}

func TestNativeAppleRelayRegistrationClosedDB(t *testing.T) {
	e := newNativeEnv(t)
	*e.open = false
	idt := e.apple("apple-sub-closed-"+e.suffix, e.relayEmail("relay-closed"))
	res := e.call(t, http.MethodPost, "/v1/auth/oauth/apple/native", "", map[string]string{"id_token": idt})
	e.expect(t, res, http.StatusConflict, "OAUTH_LINK_CHOICE_REQUIRED", "relay sign-in")
	if res.detail["register_allowed"] != "false" {
		t.Fatalf("register_allowed = %q", res.detail["register_allowed"])
	}
	created := e.call(t, http.MethodPost, "/v1/auth/oauth/link/create", "", map[string]string{"link_ticket": res.detail["link_ticket"]})
	e.expect(t, created, http.StatusForbidden, "FORBIDDEN", "link/create with registration closed")
	if n := e.count(t, `SELECT count(*) FROM users WHERE email = $1`, e.relayEmail("relay-closed")); n != 0 {
		t.Fatalf("closed registration created %d users", n)
	}
}

// A relay address that belonged to an account deleted by an admin (soft
// delete frees the e-mail and drops identities): a new account is created.
func TestNativeAppleRelayAfterDeletedAccountDB(t *testing.T) {
	e := newNativeEnv(t)
	email := e.relayEmail("relay-deleted")
	sub := "apple-sub-deleted-" + e.suffix
	idt := e.apple(sub, email)
	first, _ := e.signUpRelay(t, idt)
	oldMe := e.call(t, http.MethodGet, "/v1/auth/me", str(first, "access_token"), nil)
	oldUUID := str(oldMe.data["user"].(map[string]any), "uuid")
	if _, err := e.pool.Exec(context.Background(), `DELETE FROM oauth_accounts WHERE user_id = (SELECT id FROM users WHERE uuid = $1)`, oldUUID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `UPDATE users SET deleted_at = NOW() WHERE uuid = $1`, oldUUID); err != nil {
		t.Fatal(err)
	}

	second, _ := e.signUpRelay(t, idt)
	newMe := e.call(t, http.MethodGet, "/v1/auth/me", str(second, "access_token"), nil)
	e.expect(t, newMe, http.StatusOK, "", "me of the new account")
	if str(newMe.data["user"].(map[string]any), "uuid") == oldUUID {
		t.Fatal("deleted account was revived")
	}
}

// Self-service deletion (deactivation) keeps the identity: the same Apple
// sign-in answers ACCOUNT_DEACTIVATED, never a link choice or a loop.
func TestNativeAppleRelayDeactivatedAccountDB(t *testing.T) {
	e := newNativeEnv(t)
	email := e.relayEmail("relay-deact")
	idt := e.apple("apple-sub-deact-"+e.suffix, email)
	first, ticket := e.signUpRelay(t, idt)
	if _, err := e.pool.Exec(context.Background(), `UPDATE users SET status = 'disabled', deactivated_at = NOW() WHERE email = $1`, email); err != nil {
		t.Fatal(err)
	}
	e.expect(t, e.call(t, http.MethodPost, "/v1/auth/oauth/apple/native", "", map[string]string{"id_token": idt}), http.StatusForbidden, "ACCOUNT_DEACTIVATED", "deactivated sign-in")
	e.expect(t, e.call(t, http.MethodPost, "/v1/auth/oauth/link/create", "", map[string]string{"link_ticket": ticket}), http.StatusForbidden, "ACCOUNT_DEACTIVATED", "link/create retry")
	if res := e.call(t, http.MethodGet, "/v1/auth/me", str(first, "access_token"), nil); res.status == http.StatusOK {
		t.Fatalf("deactivated account still reads /me: %s", res.raw)
	}

	// Identity removed as well: the relay address still belongs to the deactivated account.
	if _, err := e.pool.Exec(context.Background(), `DELETE FROM oauth_accounts WHERE user_id = (SELECT id FROM users WHERE email = $1)`, email); err != nil {
		t.Fatal(err)
	}
	e.expect(t, e.call(t, http.MethodPost, "/v1/auth/oauth/apple/native", "", map[string]string{"id_token": idt}), http.StatusForbidden, "ACCOUNT_DEACTIVATED", "deactivated relay account, identity gone")
}

// The relay account exists by e-mail but its Apple identity is gone (unlinked
// on the web, or a link/create that stored the user and failed before the
// link): the relay address proves the same Apple ID, so it signs in again.
func TestNativeAppleRelayExistingUserWithoutIdentityDB(t *testing.T) {
	e := newNativeEnv(t)
	email := e.relayEmail("relay-unlinked")
	sub := "apple-sub-unlinked-" + e.suffix
	idt := e.apple(sub, email)
	first, ticket := e.signUpRelay(t, idt)
	uuidBefore := str(e.call(t, http.MethodGet, "/v1/auth/me", str(first, "access_token"), nil).data["user"].(map[string]any), "uuid")
	if _, err := e.pool.Exec(context.Background(), `DELETE FROM oauth_accounts WHERE provider = 'apple' AND provider_account_id = $1`, sub); err != nil {
		t.Fatal(err)
	}

	// link/create retried with the old ticket re-links instead of a CONFLICT dead end.
	retry := e.call(t, http.MethodPost, "/v1/auth/oauth/link/create", "", map[string]string{"link_ticket": ticket})
	e.expect(t, retry, http.StatusOK, "", "link/create after the identity was lost")
	if got := str(e.call(t, http.MethodGet, "/v1/auth/me", str(retry.data, "access_token"), nil).data["user"].(map[string]any), "uuid"); got != uuidBefore {
		t.Fatalf("link/create made a second account %s != %s", got, uuidBefore)
	}

	if _, err := e.pool.Exec(context.Background(), `DELETE FROM oauth_accounts WHERE provider = 'apple' AND provider_account_id = $1`, sub); err != nil {
		t.Fatal(err)
	}
	signIn := e.call(t, http.MethodPost, "/v1/auth/oauth/apple/native", "", map[string]string{"id_token": idt})
	e.expect(t, signIn, http.StatusOK, "", "relay sign-in re-links the same Apple ID")
	if got := str(e.call(t, http.MethodGet, "/v1/auth/me", str(signIn.data, "access_token"), nil).data["user"].(map[string]any), "uuid"); got != uuidBefore {
		t.Fatalf("sign-in landed in %s, want %s", got, uuidBefore)
	}
	if n := e.count(t, `SELECT count(*) FROM oauth_accounts WHERE provider = 'apple' AND provider_account_id = $1`, sub); n != 1 {
		t.Fatalf("identity rows = %d", n)
	}

	// Another Apple ID already linked to that account: never taken over.
	other := e.apple("apple-sub-other-"+e.suffix, email)
	e.expect(t, e.call(t, http.MethodPost, "/v1/auth/oauth/apple/native", "", map[string]string{"id_token": other}), http.StatusConflict, "CONFLICT", "different Apple subject, same relay address")
}

func (e *nativeEnv) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
