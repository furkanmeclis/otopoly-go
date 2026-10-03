package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	authusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	billingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/usecase"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ratelimit"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type regGate struct{ enabled bool }

func (g *regGate) CanPasswordRegister(context.Context) (bool, error) { return g.enabled, nil }
func (g *regGate) CanPasswordLogin(context.Context) (bool, error)    { return true, nil }
func (g *regGate) CanPasskeyLogin(context.Context) (bool, error)     { return true, nil }
func (g *regGate) RegistrationEnabled(context.Context) (bool, error) { return g.enabled, nil }
func (g *regGate) DefaultRoleID(context.Context) (*int64, error)     { return nil, nil }

type selfCreateEnv struct {
	h    *Handler
	q    *db.Queries
	pool *pgxpool.Pool
	gate *regGate
}

func newSelfCreateEnv(t *testing.T) *selfCreateEnv {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	svc := orgusecase.New(pool, q)
	svc.SetTrialStarter(billingusecase.New(pool, q, nil, entitlements.New(entitlements.NewDBStore(q))))
	tokens, err := jwt.NewManager("test-secret-key-32-bytes-minimum!", time.Minute, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	auth := authusecase.New(nil, tokens)
	gate := &regGate{enabled: true}
	auth.SetAuthSettings(gate)
	h := New(svc, auth, nil)
	mr := miniredis.RunT(t)
	h.SetRateLimiter(ratelimit.New(redis.NewClient(&redis.Options{Addr: mr.Addr()}), "test"))
	return &selfCreateEnv{h: h, q: q, pool: pool, gate: gate}
}

func (e *selfCreateEnv) user(t *testing.T) db.User {
	t.Helper()
	u, err := e.q.CreateUser(context.Background(), db.CreateUserParams{
		Email: "selfcreate-" + uuid.NewString()[:8] + "@example.com", PasswordHash: "x",
		Name: "Self", Surname: "Create", Status: "active",
		EmailVerifiedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = e.pool.Exec(ctx, `DELETE FROM organizations WHERE id IN (SELECT organization_id FROM organization_members WHERE user_id = $1)`, u.ID)
		_, _ = e.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, u.ID)
	})
	return u
}

type createResp struct {
	Success bool `json:"success"`
	Data    struct {
		Organization struct {
			UUID string `json:"uuid"`
			Slug string `json:"slug"`
			Name string `json:"name"`
		} `json:"organization"`
	} `json:"data"`
	Error struct {
		Code    string `json:"code"`
		Details []struct {
			Field string `json:"field"`
		} `json:"details"`
	} `json:"error"`
}

func (e *selfCreateEnv) post(t *testing.T, u db.User, body string) (int, createResp) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/organizations", strings.NewReader(body))
	req = req.WithContext(authctx.WithPrincipal(req.Context(), authctx.Principal{UserID: u.Uuid, UserInternal: u.ID, Email: u.Email}))
	rec := httptest.NewRecorder()
	e.h.CreateOwnedOrganization(rec, req)
	var out createResp
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestCreateOwnedOrganizationDB(t *testing.T) {
	e := newSelfCreateEnv(t)
	u := e.user(t)
	before := time.Now().Add(-time.Second)

	code, out := e.post(t, u, `{"organization_name":"  Mobil Oto Yıkama  ","phone":"05550000000","city":"İstanbul","district":"Kadıköy","address":"Moda"}`)
	if code != http.StatusCreated || !out.Success {
		t.Fatalf("create: %d %+v", code, out)
	}
	if out.Data.Organization.Name != "Mobil Oto Yıkama" || out.Data.Organization.Slug == "" || out.Data.Organization.UUID == "" {
		t.Fatalf("organization = %+v", out.Data.Organization)
	}
	orgUUID := uuid.MustParse(out.Data.Organization.UUID)
	org, err := e.q.GetOrganizationByUUID(context.Background(), orgUUID)
	if err != nil {
		t.Fatal(err)
	}
	if org.City != "İstanbul" || org.Phone != "05550000000" || org.PlanCode.String != "trial" || org.Status != "active" {
		t.Fatalf("org row = %+v", org)
	}
	if org.AccessStartsAt.Time.Before(before) || org.AccessStartsAt.Time.After(time.Now()) {
		t.Fatalf("access_starts_at must be now: %v", org.AccessStartsAt.Time)
	}
	trial := org.AccessEndsAt.Time.Sub(org.AccessStartsAt.Time)
	if trial < 13*24*time.Hour || trial > 15*24*time.Hour {
		t.Fatalf("trial window = %v", trial)
	}
	members, err := e.q.ListOrganizationMembersByUserID(context.Background(), u.ID)
	if err != nil || len(members) != 1 || members[0].Role != "owner" {
		t.Fatalf("members=%+v err=%v", members, err)
	}
	if sub, err := e.q.GetLiveSubscription(context.Background(), org.ID); err != nil || sub.Status != "trial" {
		t.Fatalf("trial subscription=%+v err=%v", sub, err)
	}

	// One self-serve business per user.
	code, out = e.post(t, u, `{"organization_name":"Second Shop"}`)
	if code != http.StatusConflict || out.Error.Code != "CONFLICT" {
		t.Fatalf("second create: %d %+v", code, out)
	}
}

func TestCreateOwnedOrganizationStaffElsewhereAllowed(t *testing.T) {
	e := newSelfCreateEnv(t)
	owner := e.user(t)
	if code, _ := e.post(t, owner, `{"organization_name":"Owner Shop"}`); code != http.StatusCreated {
		t.Fatalf("owner create: %d", code)
	}
	ownerOrgs, _ := e.q.ListOrganizationMembersByUserID(context.Background(), owner.ID)
	org, err := e.q.GetOrganizationByUUID(context.Background(), ownerOrgs[0].Uuid)
	if err != nil {
		t.Fatal(err)
	}
	staff := e.user(t)
	if _, err := e.q.CreateOrganizationMember(context.Background(), db.CreateOrganizationMemberParams{
		OrganizationID: org.ID, UserID: staff.ID, Role: "staff",
	}); err != nil {
		t.Fatal(err)
	}
	if code, out := e.post(t, staff, `{"organization_name":"Staff Own Shop"}`); code != http.StatusCreated {
		t.Fatalf("staff create: %d %+v", code, out)
	}
}

func TestCreateOwnedOrganizationRegistrationDisabled(t *testing.T) {
	e := newSelfCreateEnv(t)
	e.gate.enabled = false
	u := e.user(t)
	code, out := e.post(t, u, `{"organization_name":"Closed Shop"}`)
	if code != http.StatusForbidden || out.Error.Code != "FORBIDDEN" {
		t.Fatalf("got %d %+v", code, out)
	}
	if members, _ := e.q.ListOrganizationMembersByUserID(context.Background(), u.ID); len(members) != 0 {
		t.Fatal("no organization may be created")
	}
}

func TestCreateOwnedOrganizationValidation(t *testing.T) {
	e := newSelfCreateEnv(t)
	u := e.user(t)
	cases := []struct {
		body  string
		field string
	}{
		{`{}`, "organization_name"},
		{`{"organization_name":" a "}`, "organization_name"},
		{`{"organization_name":"` + strings.Repeat("x", 121) + `"}`, "organization_name"},
		{`{"organization_name":"Fine","phone":"` + strings.Repeat("1", 33) + `"}`, "phone"},
	}
	for _, c := range cases {
		code, out := e.post(t, u, c.body)
		if code != http.StatusBadRequest || out.Error.Code != "VALIDATION_ERROR" || len(out.Error.Details) == 0 || out.Error.Details[0].Field != c.field {
			t.Fatalf("%s: %d %+v", c.body, code, out)
		}
	}
	if code, out := e.post(t, u, `{"organization_name":"Fine","unknown":1}`); code != http.StatusBadRequest || out.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("unknown field: %d %+v", code, out)
	}
}

func TestCreateOwnedOrganizationRateLimited(t *testing.T) {
	e := newSelfCreateEnv(t)
	u := e.user(t)
	if code, _ := e.post(t, u, `{"organization_name":"Limit Shop"}`); code != http.StatusCreated {
		t.Fatalf("first: %d", code)
	}
	for i := 0; i < ownedOrgCreateLimit-1; i++ {
		if code, _ := e.post(t, u, `{"organization_name":"Limit Shop"}`); code != http.StatusConflict {
			t.Fatalf("attempt %d: %d", i, code)
		}
	}
	if code, out := e.post(t, u, `{"organization_name":"Limit Shop"}`); code != http.StatusTooManyRequests || out.Error.Code != "RATE_LIMITED" {
		t.Fatalf("limit: %d %+v", code, out)
	}
}
