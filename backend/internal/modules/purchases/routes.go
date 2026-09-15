package purchases

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	purchaseshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases/handler"
	purchasesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *purchasesusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := purchaseshandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantPurchasesRead)
	requireWrite := middleware.RequirePermission(rbac.PermTenantPurchasesWrite)
	requireOwner := middleware.RequireOrgRole("owner")

	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireRead)
	}
	write := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireWrite, requireOwner)
	}

	mux.Handle("GET /v1/tenant/purchases/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/purchases", read(h.List))
	mux.Handle("POST /v1/tenant/purchases", write(h.Create))
	mux.Handle("GET /v1/tenant/purchases/{uuid}", read(h.Get))
	mux.Handle("POST /v1/tenant/purchases/{uuid}/void", write(h.Void))
}
