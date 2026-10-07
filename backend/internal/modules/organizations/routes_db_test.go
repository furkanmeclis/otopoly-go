package organizations_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	authusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	orgmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
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

type routeEnv struct {
	mux    *http.ServeMux
	pool   *pgxpool.Pool
	q      *db.Queries
	store  *stepup.Store
	tokens map[string]string
	ids    map[string]uuid.UUID
}

func newRouteEnv(t *testing.T) *routeEnv {
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
	users := map[string][]string{
		"none":   {},
		"reader": {rbac.PermPlatformOrganizationsRead},
		"admin": {
			rbac.PermPlatformOrganizationsRead, rbac.PermPlatformOrganizationsWrite, rbac.PermPlatformActivityRead,
		},
	}
	env := &routeEnv{pool: pool, q: q, tokens: map[string]string{}, ids: map[string]uuid.UUID{}}
	loader := principalLoader{}
	for name, perms := range users {
		id := uuid.New()
		loader[id.String()] = authctx.Principal{UserID: id, UserInternal: 0, Permissions: perms}
		tok, _, err := tm.IssueAccess(jwt.AccessInput{UserID: id})
		if err != nil {
			t.Fatal(err)
		}
		env.tokens[name], env.ids[name] = tok, id
	}
	mr := miniredis.RunT(t)
	env.store = stepup.NewStore(redis.NewClient(&redis.Options{Addr: mr.Addr()}), "test")
	svc := orgusecase.New(pool, q)
	svc.SetActivity(activity.NewRecorder(q, nil))
	env.mux = http.NewServeMux()
	orgmodule.RegisterRoutes(env.mux, svc, authusecase.New(nil, tm), nil, tm, loader, q, nil,
		stepup.NewService(q, env.store, nil, nil))
	return env
}

func (e *routeEnv) grantStepUp(t *testing.T, user string) {
	t.Helper()
	if _, err := e.store.SetGrant(context.Background(), e.ids[user], "password", time.Minute); err != nil {
		t.Fatal(err)
	}
}

func (e *routeEnv) org(t *testing.T, end time.Time) db.Organization {
	t.Helper()
	slugValue := "route-" + uuid.NewString()[:8]
	org, err := e.q.CreateOrganization(context.Background(), db.CreateOrganizationParams{
		Slug: slugValue, Name: "Route " + slugValue, Status: "active",
		AccessStartsAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
		AccessEndsAt:   pgtype.Timestamptz{Time: end, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = e.pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, org.ID) })
	return org
}

type envelope struct {
	Data  json.RawMessage `json:"data"`
	Error struct {
		Code string `json:"code"`
	} `json:"error"`
}

func (e *routeEnv) do(t *testing.T, method, path, user string, body any) (int, envelope) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Authorization", "Bearer "+e.tokens[user])
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	var env envelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	return rec.Code, env
}

func (e *routeEnv) status(t *testing.T, org db.Organization) (string, time.Time) {
	t.Helper()
	row, err := e.q.GetOrganizationByUUID(context.Background(), org.Uuid)
	if err != nil {
		t.Fatal(err)
	}
	return row.Status, row.AccessEndsAt.Time
}

func TestOrganizationDetailRoutesRequirePermissions(t *testing.T) {
	e := newRouteEnv(t)
	org := e.org(t, time.Now().Add(24*time.Hour))
	base := "/v1/platform/organizations/" + org.Uuid.String()
	cases := []struct {
		method, path, user string
		want               int
	}{
		{http.MethodGet, base + "/overview", "none", http.StatusForbidden},
		{http.MethodGet, base + "/whatsapp/outbound", "none", http.StatusForbidden},
		{http.MethodGet, base + "/activity", "reader", http.StatusForbidden}, // needs platform.activity.read too
		{http.MethodPost, base + "/status", "reader", http.StatusForbidden},
		{http.MethodPost, base + "/extend-access", "reader", http.StatusForbidden},
		{http.MethodGet, base + "/overview", "reader", http.StatusOK},
		{http.MethodGet, base + "/whatsapp/outbound", "reader", http.StatusOK},
		{http.MethodGet, base + "/activity", "admin", http.StatusOK},
		{http.MethodGet, "/v1/platform/organizations/" + uuid.NewString() + "/overview", "reader", http.StatusNotFound},
	}
	for _, tc := range cases {
		if code, _ := e.do(t, tc.method, tc.path, tc.user, nil); code != tc.want {
			t.Fatalf("%s %s as %s: %d, want %d", tc.method, tc.path, tc.user, code, tc.want)
		}
	}
	_, env := e.do(t, http.MethodGet, base+"/activity?limit=5", "admin", nil)
	var page struct {
		Items []any `json:"items"`
		Total int64 `json:"total"`
		Limit int32 `json:"limit"`
	}
	if err := json.Unmarshal(env.Data, &page); err != nil || page.Items == nil || page.Limit != 5 {
		t.Fatalf("activity page %s (%v)", env.Data, err)
	}
}

func TestStatusAndExtendRequireStepUp(t *testing.T) {
	e := newRouteEnv(t)
	end := time.Now().Add(24 * time.Hour).Truncate(time.Second)
	org := e.org(t, end)
	base := "/v1/platform/organizations/" + org.Uuid.String()

	code, env := e.do(t, http.MethodPost, base+"/status", "admin", map[string]any{"status": "suspended"})
	if code != http.StatusForbidden || env.Error.Code != "STEP_UP_REQUIRED" {
		t.Fatalf("status without step-up: %d %q", code, env.Error.Code)
	}
	code, env = e.do(t, http.MethodPost, base+"/extend-access", "admin", map[string]any{"days": 7})
	if code != http.StatusForbidden || env.Error.Code != "STEP_UP_REQUIRED" {
		t.Fatalf("extend without step-up: %d %q", code, env.Error.Code)
	}
	// PATCH may not bypass the gate for status / access changes...
	code, env = e.do(t, http.MethodPatch, base, "admin", map[string]any{"status": "suspended"})
	if code != http.StatusForbidden || env.Error.Code != "STEP_UP_REQUIRED" {
		t.Fatalf("patch status without step-up: %d %q", code, env.Error.Code)
	}
	if status, gotEnd := e.status(t, org); status != "active" || !gotEnd.Equal(end) {
		t.Fatalf("changed without step-up: %s %v", status, gotEnd)
	}
	// ...but profile edits stay ungated.
	if code, _ = e.do(t, http.MethodPatch, base, "admin", map[string]any{"city": "Bursa"}); code != http.StatusOK {
		t.Fatalf("profile patch: %d", code)
	}

	e.grantStepUp(t, "admin")
	if code, _ = e.do(t, http.MethodPost, base+"/status", "admin", map[string]any{"status": "suspended", "reason": "fraud"}); code != http.StatusOK {
		t.Fatalf("status with step-up: %d", code)
	}
	if code, _ = e.do(t, http.MethodPost, base+"/extend-access", "admin", map[string]any{"days": 7}); code != http.StatusOK {
		t.Fatalf("extend with step-up: %d", code)
	}
	status, gotEnd := e.status(t, org)
	if status != "suspended" || !gotEnd.Equal(end.AddDate(0, 0, 7)) {
		t.Fatalf("after: %s %v", status, gotEnd)
	}
	if code, env = e.do(t, http.MethodPost, base+"/status", "admin", map[string]any{"status": "bogus"}); code != http.StatusBadRequest {
		t.Fatalf("bad status: %d %q", code, env.Error.Code)
	}
}
