package staff

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	staffhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/staff/handler"
	staffusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/staff/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *staffusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := staffhandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantStaffRead)
	requireWrite := middleware.RequirePermission(rbac.PermTenantStaffWrite)
	requireOwner := middleware.RequireOrgRole("owner")
	requireJobsRead := middleware.RequirePermission(rbac.PermTenantJobsRead)

	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireRead)
	}
	write := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireWrite, requireOwner)
	}
	// Assignee picker: any jobs reader can list active members.
	options := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireJobsRead)
	}

	mux.Handle("GET /v1/tenant/staff/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/staff/options", options(h.Options))
	mux.Handle("GET /v1/tenant/staff", read(h.List))
	mux.Handle("POST /v1/tenant/staff", write(h.Create))
	mux.Handle("PATCH /v1/tenant/staff/{uuid}", write(h.Patch))
	mux.Handle("POST /v1/tenant/staff/{uuid}/reset-password", write(h.ResetPassword))
}
