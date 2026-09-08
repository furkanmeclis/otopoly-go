package customers

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	customershandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/handler"
	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *customersusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := customershandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantCustomersRead)
	requireWrite := middleware.RequirePermission(rbac.PermTenantCustomersWrite)
	requireOwner := middleware.RequireOrgRole("owner")

	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireRead)
	}
	write := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireWrite, requireOwner)
	}

	mux.Handle("GET /v1/tenant/customers/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/customers", read(h.List))
	mux.Handle("POST /v1/tenant/customers", write(h.Create))
	mux.Handle("GET /v1/tenant/customers/{uuid}", read(h.Get))
	mux.Handle("PATCH /v1/tenant/customers/{uuid}", write(h.Patch))
	mux.Handle("DELETE /v1/tenant/customers/{uuid}", write(h.Delete))
	mux.Handle("POST /v1/tenant/customers/{uuid}/vehicles", write(h.AddVehicle))
	mux.Handle("DELETE /v1/tenant/customer-vehicles/{uuid}", write(h.DeleteVehicle))
}
