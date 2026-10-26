// Package insights serves the 360° summaries of the tenant detail pages.
package insights

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	insightshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/insights/handler"
	insightsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/insights/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *insightsusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := insightshandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	guard := func(handler http.HandlerFunc, perms ...string) http.Handler {
		chain := []func(http.Handler) http.Handler{authn, requireOrg}
		for _, p := range perms {
			chain = append(chain, middleware.RequirePermission(p))
		}
		return middleware.Chain(http.HandlerFunc(handler), chain...)
	}

	mux.Handle("GET /v1/tenant/catalog/products/{uuid}/summary", guard(h.ProductSummary, rbac.PermTenantCatalogRead))
	mux.Handle("GET /v1/tenant/catalog/products/{uuid}/movements", guard(h.ProductMovements, rbac.PermTenantCatalogRead))
	mux.Handle("GET /v1/tenant/catalog/services/{uuid}/summary", guard(h.ServiceSummary, rbac.PermTenantCatalogRead))
	mux.Handle("GET /v1/tenant/catalog/services/{uuid}/jobs", guard(h.ServiceJobs, rbac.PermTenantCatalogRead, rbac.PermTenantJobsRead))
	mux.Handle("GET /v1/tenant/customers/{uuid}/summary", guard(h.CustomerSummary, rbac.PermTenantCustomersRead))
	mux.Handle("GET /v1/tenant/suppliers/{uuid}/summary", guard(h.SupplierSummary, rbac.PermTenantSuppliersRead))
}
