package sales

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	saleshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/sales/handler"
	salesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/sales/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *salesusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := saleshandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantSalesRead)
	requireWrite := middleware.RequirePermission(rbac.PermTenantSalesWrite)
	requireOwner := middleware.RequireOrgRole("owner")

	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireRead)
	}
	write := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireWrite, requireOwner)
	}

	mux.Handle("GET /v1/tenant/sales/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/sales/summary", read(h.Summary))
	mux.Handle("GET /v1/tenant/sales", read(h.List))
	mux.Handle("POST /v1/tenant/sales", write(h.Create))
	mux.Handle("GET /v1/tenant/sales/{uuid}", read(h.Get))
	mux.Handle("POST /v1/tenant/sales/{uuid}/void", write(h.Void))
}
