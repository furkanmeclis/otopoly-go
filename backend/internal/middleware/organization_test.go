package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type fakeOrgResolver struct {
	row db.GetOrganizationMemberByUserAndOrgUUIDRow
	err error
}

func (f fakeOrgResolver) GetOrganizationMemberByUserAndOrgUUID(context.Context, int64, uuid.UUID) (db.GetOrganizationMemberByUserAndOrgUUIDRow, error) {
	return f.row, f.err
}

func TestRequireOrganizationReadOnly(t *testing.T) {
	tokens, err := jwt.NewManager("test-secret", time.Hour, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	userID := uuid.New()
	orgID := uuid.New()
	token, _, err := tokens.IssueAccess(jwt.AccessInput{UserID: userID, OrganizationID: &orgID})
	if err != nil {
		t.Fatal(err)
	}
	row := db.GetOrganizationMemberByUserAndOrgUUIDRow{
		OrganizationID: 7, UserID: 42, Role: "owner", OrganizationUuid: orgID,
		OrganizationSlug: "acme", OrganizationStatus: "active", OrganizationName: "Acme",
		AccessStartsAt:     pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
		SubscriptionStatus: "read_only",
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	withPrincipal := func(req *http.Request) *http.Request {
		ctx := authctx.WithPrincipal(req.Context(), authctx.Principal{UserID: userID, UserInternal: 42})
		req = req.WithContext(ctx)
		req.Header.Set("Authorization", "Bearer "+token)
		return req
	}
	handler := RequireOrganizationResolver(tokens, fakeOrgResolver{row: row})(next)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, withPrincipal(httptest.NewRequest(http.MethodGet, "/v1/tenant/jobs", nil)))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET must pass, got %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, withPrincipal(httptest.NewRequest(http.MethodPost, "/v1/tenant/jobs", strings.NewReader(`{}`))))
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), response.CodeSubscriptionReadOnly) {
		t.Fatalf("POST must 403 subscription read-only, got %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, withPrincipal(httptest.NewRequest(http.MethodPost, "/v1/tenant/billing/orders", strings.NewReader(`{}`))))
	if rec.Code != http.StatusOK {
		t.Fatalf("billing write exemption must pass, got %d %s", rec.Code, rec.Body.String())
	}
}
