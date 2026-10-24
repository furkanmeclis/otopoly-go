package vehiclecatalog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	cataloghandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type stubLoader struct{ perms []string }

func (s stubLoader) LoadPrincipal(_ *http.Request, _ jwt.Claims) (authctx.Principal, error) {
	return authctx.Principal{UserID: uuid.New(), UserInternal: 42, Permissions: s.perms}, nil
}

// stubResolver knows one organization (acme) with user 42 as a member.
type stubResolver struct{ acme uuid.UUID }

func (s stubResolver) GetOrganizationMemberByUserAndOrgUUID(_ context.Context, userID int64, orgUUID uuid.UUID) (db.GetOrganizationMemberByUserAndOrgUUIDRow, error) {
	if orgUUID != s.acme || userID != 42 {
		return db.GetOrganizationMemberByUserAndOrgUUIDRow{}, pgx.ErrNoRows
	}
	return db.GetOrganizationMemberByUserAndOrgUUIDRow{
		OrganizationID: 1, UserID: userID, Role: "staff", OrganizationUuid: orgUUID,
		OrganizationSlug: "acme", OrganizationName: "Acme", OrganizationStatus: "active",
		SubscriptionStatus: "active",
	}, nil
}

func setup(t *testing.T, perms []string, org *uuid.UUID) (*http.ServeMux, string) {
	t.Helper()
	tokens, err := jwt.NewManager("test-access-secret-0123456789abcdef", time.Minute, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	access, _, err := tokens.IssueAccess(jwt.AccessInput{UserID: uuid.New(), OrganizationID: org})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	// Only paths that answer before reaching the use case are exercised.
	RegisterRoutes(mux, cataloghandler.New(nil, nil), tokens, stubLoader{perms: perms}, stubResolver{acme: acmeUUID})
	return mux, access
}

var acmeUUID = uuid.New()

func call(mux *http.ServeMux, method, path, token string) int {
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	return rr.Code
}

func TestPlatformRoutesRequireCatalogPermissions(t *testing.T) {
	t.Parallel()
	mux, token := setup(t, nil, nil)
	if code := call(mux, http.MethodGet, "/v1/platform/vehicle-catalog/brands", ""); code != http.StatusUnauthorized {
		t.Fatalf("anonymous = %d", code)
	}
	if code := call(mux, http.MethodGet, "/v1/platform/vehicle-catalog/brands", token); code != http.StatusForbidden {
		t.Fatalf("no permission = %d", code)
	}

	readOnly, rt := setup(t, []string{rbac.PermPlatformVehicleBrandsRead}, nil)
	if code := call(readOnly, http.MethodGet, "/v1/platform/vehicle-catalog/types/meta", rt); code != http.StatusOK {
		t.Fatalf("meta = %d", code)
	}
	if code := call(readOnly, http.MethodGet, "/v1/platform/vehicle-catalog/brands?sort=bogus", rt); code != http.StatusBadRequest {
		t.Fatalf("bad sort = %d", code)
	}
	if code := call(readOnly, http.MethodGet, "/v1/platform/vehicle-catalog/types?year=abc", rt); code != http.StatusBadRequest {
		t.Fatalf("bad year = %d", code)
	}
	if code := call(readOnly, http.MethodPost, "/v1/platform/vehicle-catalog/imports/"+uuid.NewString()+"/apply", rt); code != http.StatusForbidden {
		t.Fatalf("apply without write = %d", code)
	}
	if code := call(readOnly, http.MethodGet, "/v1/platform/vehicle-catalog/display-brands/meta", rt); code != http.StatusOK {
		t.Fatalf("display brands meta = %d", code)
	}
	if code := call(readOnly, http.MethodGet, "/v1/platform/vehicle-catalog/display-brands?sort=bogus", rt); code != http.StatusBadRequest {
		t.Fatalf("display brands bad sort = %d", code)
	}
	if code := call(mux, http.MethodGet, "/v1/platform/vehicle-catalog/display-brands", token); code != http.StatusForbidden {
		t.Fatalf("display brands without permission = %d", code)
	}
	for _, path := range []string{
		"/v1/platform/vehicle-catalog/display-brands/" + uuid.NewString() + "/merge",
		"/v1/platform/vehicle-catalog/display-brands/" + uuid.NewString() + "/unmerge",
		"/v1/platform/vehicle-catalog/models/bulk-rules",
	} {
		if code := call(readOnly, http.MethodPost, path, rt); code != http.StatusForbidden {
			t.Fatalf("POST %s without write = %d", path, code)
		}
	}
	// The logo stream only needs a session (tenant forms show it too).
	if code := call(mux, http.MethodGet, "/v1/platform/vehicle-catalog/display-brands/not-a-uuid/logo", token); code != http.StatusBadRequest {
		t.Fatalf("logo without catalog permission = %d", code)
	}
	if code := call(mux, http.MethodGet, "/v1/platform/vehicle-catalog/display-brands/"+uuid.NewString()+"/logo", ""); code != http.StatusUnauthorized {
		t.Fatalf("anonymous logo = %d", code)
	}
}

func TestTenantRoutes(t *testing.T) {
	t.Parallel()
	noOrg, token := setup(t, nil, nil)
	if code := call(noOrg, http.MethodGet, "/v1/tenant/vehicle-catalog/brands", token); code != http.StatusForbidden {
		t.Fatalf("token without organization = %d, want 403", code)
	}

	other := uuid.New()
	nonMember, token := setup(t, nil, &other)
	if code := call(nonMember, http.MethodGet, "/v1/tenant/vehicle-catalog/models", token); code != http.StatusForbidden {
		t.Fatalf("non-member = %d", code)
	}

	acme := acmeUUID
	member, token := setup(t, nil, &acme)
	// Members need no catalog permission; the brand filter is validated.
	if code := call(member, http.MethodGet, "/v1/tenant/vehicle-catalog/models", token); code != http.StatusBadRequest {
		t.Fatalf("missing brand = %d", code)
	}
	if code := call(member, http.MethodGet, "/v1/tenant/vehicle-catalog/types?model=nope", token); code != http.StatusBadRequest {
		t.Fatalf("bad model = %d", code)
	}
}
