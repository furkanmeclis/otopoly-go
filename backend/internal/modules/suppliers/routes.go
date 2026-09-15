package suppliers

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	suppliershandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/suppliers/handler"
	suppliersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/suppliers/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *suppliersusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := suppliershandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantSuppliersRead)
	requireWrite := middleware.RequirePermission(rbac.PermTenantSuppliersWrite)
	requireOwner := middleware.RequireOrgRole("owner")

	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireRead)
	}
	write := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireWrite, requireOwner)
	}

	mux.Handle("GET /v1/tenant/suppliers/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/suppliers", read(h.List))
	mux.Handle("POST /v1/tenant/suppliers", write(h.Create))
	mux.Handle("GET /v1/tenant/suppliers/{uuid}", read(h.Get))
	mux.Handle("PATCH /v1/tenant/suppliers/{uuid}", write(h.Patch))
	mux.Handle("DELETE /v1/tenant/suppliers/{uuid}", write(h.Delete))
}
