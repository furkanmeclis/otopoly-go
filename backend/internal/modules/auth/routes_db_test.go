package auth_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	authmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/stepup"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type principalLoader map[string]authctx.Principal

func (l principalLoader) LoadPrincipal(_ *http.Request, claims jwt.Claims) (authctx.Principal, error) {
	p, ok := l[claims.Subject]
	if !ok {
		return authctx.Principal{}, errors.New("unknown user")
	}
	return p, nil
}

type insightsEnv struct {
	mux    *http.ServeMux
	pool   *pgxpool.Pool
	q      *db.Queries
	store  *stepup.Store
	tokens map[string]string
	ids    map[string]uuid.UUID
	admin  db.User
}

func (e *insightsEnv) user(t *testing.T, prefix string) db.User {
	t.Helper()
	u, err := e.q.CreateUser(context.Background(), db.CreateUserParams{
		Email: prefix + "-" + uuid.NewString()[:8] + "@example.com", PasswordHash: "x",
		Name: "Route", Surname: "Test", Status: "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = e.pool.Exec(ctx, `DELETE FROM activity_events WHERE actor_user_id = $1`, u.ID)
		_, _ = e.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, u.ID)
	})
	return u
}

func newInsightsEnv(t *testing.T) *insightsEnv {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	tm, err := jwt.NewManager("test-secret-key-32-bytes-minimum!", time.Minute, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	env := &insightsEnv{pool: pool, q: q, tokens: map[string]string{}, ids: map[string]uuid.UUID{}}
	env.admin = env.user(t, "insights-admin")
	users := map[string][]string{
		"none":   {},
		"reader": {rbac.PermPlatformUsersRead},
		"admin":  {rbac.PermPlatformUsersRead, rbac.PermPlatformUsersWrite, rbac.PermPlatformActivityRead},
	}
	loader := principalLoader{}
	for name, perms := range users {
		id, internal := uuid.New(), int64(0)
		if name == "admin" {
			id, internal = env.admin.Uuid, env.admin.ID
		}
		loader[id.String()] = authctx.Principal{UserID: id, UserInternal: internal, Permissions: perms}
		tok, _, err := tm.IssueAccess(jwt.AccessInput{UserID: id})
		if err != nil {
			t.Fatal(err)
		}
		env.tokens[name], env.ids[name] = tok, id
	}
	mr := miniredis.RunT(t)
	env.store = stepup.NewStore(redis.NewClient(&redis.Options{Addr: mr.Addr()}), "test")
	stepUpSvc := stepup.NewService(q, env.store, nil, nil)

	repo := repository.NewPostgres(pool, q)
	uc := usecase.New(repo, tm)
	h := handler.New(uc, nil, nil, nil, nil, "adapter-secret", stepUpSvc, activity.NewRecorder(q, nil))
	h.SetUserInsights(usecase.NewUserInsights(uc, repo))
	env.mux = http.NewServeMux()
	authmodule.RegisterRoutes(env.mux, h, tm, loader, stepUpSvc)
	return env
}

func (e *insightsEnv) do(t *testing.T, method, path, user string) (int, string, string) {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Authorization", "Bearer "+e.tokens[user])
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	return rec.Code, env.Error.Code, rec.Body.String()
}

func (e *insightsEnv) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *insightsEnv) fixtures(t *testing.T, target db.User) (db.RefreshToken, db.PushDevice, string, string) {
	t.Helper()
	ctx := context.Background()
	hash := "route-hash-" + uuid.NewString()
	sess, err := e.q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		UserID: target.ID, TokenHash: hash, ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	push := "ExponentPushToken[route-" + uuid.NewString() + "]"
	dev, err := e.q.UpsertPushDevice(ctx, db.UpsertPushDeviceParams{UserID: target.ID, Token: push, Platform: "android"})
	if err != nil {
		t.Fatal(err)
	}
	return sess, dev, hash, push
}

func TestUserDetailRoutesRequirePermissions(t *testing.T) {
	e := newInsightsEnv(t)
	target := e.user(t, "insights-target")
	_, _, hash, push := e.fixtures(t, target)
	base := "/v1/platform/users/" + target.Uuid.String()
	cases := []struct {
		method, path, user string
		want               int
	}{
		{http.MethodGet, base + "/overview", "none", http.StatusForbidden},
		{http.MethodGet, base + "/sessions", "none", http.StatusForbidden},
		{http.MethodGet, base + "/activity", "reader", http.StatusForbidden}, // needs platform.activity.read too
		{http.MethodDelete, base + "/sessions/" + uuid.NewString(), "reader", http.StatusForbidden},
		{http.MethodPost, base + "/sessions/revoke-all", "reader", http.StatusForbidden},
		{http.MethodDelete, base + "/devices/" + uuid.NewString(), "reader", http.StatusForbidden},
		{http.MethodGet, base + "/overview", "reader", http.StatusOK},
		{http.MethodGet, base + "/organizations", "reader", http.StatusOK},
		{http.MethodGet, base + "/sessions", "reader", http.StatusOK},
		{http.MethodGet, base + "/devices", "reader", http.StatusOK},
		{http.MethodGet, base + "/activity?organization_uuid=" + uuid.NewString(), "admin", http.StatusNotFound},
		{http.MethodGet, base + "/activity?organization_uuid=nope", "admin", http.StatusBadRequest},
		{http.MethodGet, base + "/activity", "admin", http.StatusOK},
		{http.MethodGet, base + "/sessions?page=2", "reader", http.StatusBadRequest},
		{http.MethodGet, "/v1/platform/users/" + uuid.NewString() + "/overview", "reader", http.StatusNotFound},
		{http.MethodGet, "/v1/platform/users/" + uuid.NewString() + "/sessions", "reader", http.StatusNotFound},
	}
	for _, tc := range cases {
		code, _, body := e.do(t, tc.method, tc.path, tc.user)
		if code != tc.want {
			t.Fatalf("%s %s as %s: %d, want %d (%s)", tc.method, tc.path, tc.user, code, tc.want, body)
		}
		if strings.Contains(body, hash) || strings.Contains(body, push) {
			t.Fatalf("%s %s leaks a token: %s", tc.method, tc.path, body)
		}
	}
}

func TestSessionAndDeviceRevocationRequireStepUpAndAreAudited(t *testing.T) {
	e := newInsightsEnv(t)
	target := e.user(t, "insights-target")
	sess, dev, _, _ := e.fixtures(t, target)
	other, err := e.q.CreateRefreshToken(context.Background(), db.CreateRefreshTokenParams{
		UserID: target.ID, TokenHash: "route-hash-" + uuid.NewString(),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	base := "/v1/platform/users/" + target.Uuid.String()
	gated := []struct{ method, path string }{
		{http.MethodDelete, base + "/sessions/" + sess.Uuid.String()},
		{http.MethodPost, base + "/sessions/revoke-all"},
		{http.MethodDelete, base + "/devices/" + dev.Uuid.String()},
	}
	for _, g := range gated {
		if code, errCode, _ := e.do(t, g.method, g.path, "admin"); code != http.StatusForbidden || errCode != "STEP_UP_REQUIRED" {
			t.Fatalf("%s %s without step-up: %d %q", g.method, g.path, code, errCode)
		}
	}
	if n := e.count(t, `SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, target.ID); n != 2 {
		t.Fatalf("sessions revoked without step-up: %d live", n)
	}
	if n := e.count(t, `SELECT COUNT(*) FROM push_devices WHERE id = $1`, dev.ID); n != 1 {
		t.Fatal("device removed without step-up")
	}

	if _, err := e.store.SetGrant(context.Background(), e.ids["admin"], "password", time.Minute); err != nil {
		t.Fatal(err)
	}
	if code, _, body := e.do(t, http.MethodDelete, base+"/sessions/"+sess.Uuid.String(), "admin"); code != http.StatusOK {
		t.Fatalf("revoke session: %d %s", code, body)
	}
	if code, _, _ := e.do(t, http.MethodDelete, base+"/sessions/"+sess.Uuid.String(), "admin"); code != http.StatusNotFound {
		t.Fatalf("revoke twice: %d", code)
	}
	if n := e.count(t, `SELECT COUNT(*) FROM refresh_tokens WHERE id = $1 AND revoked_at IS NULL`, other.ID); n != 1 {
		t.Fatal("single revoke must keep the other session")
	}
	code, _, body := e.do(t, http.MethodPost, base+"/sessions/revoke-all", "admin")
	if code != http.StatusOK || !strings.Contains(body, `"revoked":1`) {
		t.Fatalf("revoke all: %d %s", code, body)
	}
	if code, _, body := e.do(t, http.MethodDelete, base+"/devices/"+dev.Uuid.String(), "admin"); code != http.StatusOK {
		t.Fatalf("remove device: %d %s", code, body)
	}
	if n := e.count(t, `SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, target.ID); n != 0 {
		t.Fatalf("live sessions left: %d", n)
	}

	for _, action := range []string{"users.session_revoked", "users.sessions_revoked", "users.device_removed"} {
		if n := e.count(t, `SELECT COUNT(*) FROM activity_events
			WHERE action = $1 AND actor_user_id = $2 AND resource = 'platform.users' AND resource_uuid = $3`,
			action, e.admin.ID, target.Uuid); n != 1 {
			t.Fatalf("audit %s: %d events", action, n)
		}
	}
}
