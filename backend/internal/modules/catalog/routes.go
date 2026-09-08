package catalog

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	bulkhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/bulk/handler"
	cataloghandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/catalog/handler"
	catalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/catalog/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *catalogusecase.Service,
	bulkH *bulkhandler.Handler,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := cataloghandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantCatalogRead)
	requireWrite := middleware.RequirePermission(rbac.PermTenantCatalogWrite)
	requireOwner := middleware.RequireOrgRole("owner")

	tenantRead := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireRead)
	}
	tenantWrite := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireWrite, requireOwner)
	}

	// Summary
	mux.Handle("GET /v1/tenant/catalog/summary", tenantRead(h.Summary))

	// Categories
	mux.Handle("GET /v1/tenant/catalog/categories/meta", tenantRead(h.CategoriesMeta))
	mux.Handle("GET /v1/tenant/catalog/categories", tenantRead(h.ListCategories))
	mux.Handle("POST /v1/tenant/catalog/categories", tenantWrite(h.CreateCategory))
	mux.Handle("GET /v1/tenant/catalog/categories/{uuid}", tenantRead(h.GetCategory))
	mux.Handle("PATCH /v1/tenant/catalog/categories/{uuid}", tenantWrite(h.PatchCategory))
	mux.Handle("DELETE /v1/tenant/catalog/categories/{uuid}", tenantWrite(h.DeleteCategory))

	// Products
	mux.Handle("GET /v1/tenant/catalog/products/meta", tenantRead(h.ProductsMeta))
	mux.Handle("GET /v1/tenant/catalog/products", tenantRead(h.ListProducts))
	mux.Handle("POST /v1/tenant/catalog/products", tenantWrite(h.CreateProduct))
	if bulkH != nil {
		mux.Handle("POST /v1/tenant/catalog/products/bulk", tenantWrite(bulkH.ExecuteCatalogProducts))
	}
	mux.Handle("GET /v1/tenant/catalog/products/{uuid}", tenantRead(h.GetProduct))
	mux.Handle("PATCH /v1/tenant/catalog/products/{uuid}", tenantWrite(h.PatchProduct))
	mux.Handle("POST /v1/tenant/catalog/products/{uuid}/stock-adjustment", tenantWrite(h.AdjustProductStock))
	mux.Handle("DELETE /v1/tenant/catalog/products/{uuid}", tenantWrite(h.DeleteProduct))

	// Services
	mux.Handle("GET /v1/tenant/catalog/services/meta", tenantRead(h.ServicesMeta))
	mux.Handle("GET /v1/tenant/catalog/services", tenantRead(h.ListServices))
	mux.Handle("POST /v1/tenant/catalog/services", tenantWrite(h.CreateService))
	if bulkH != nil {
		mux.Handle("POST /v1/tenant/catalog/services/bulk", tenantWrite(bulkH.ExecuteCatalogServices))
	}
	mux.Handle("GET /v1/tenant/catalog/services/{uuid}", tenantRead(h.GetService))
	mux.Handle("PATCH /v1/tenant/catalog/services/{uuid}", tenantWrite(h.PatchService))
	mux.Handle("DELETE /v1/tenant/catalog/services/{uuid}", tenantWrite(h.DeleteService))
}
