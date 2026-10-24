// Package vehiclebrands serves the legacy tenant vehicle picker search over
// vehicle_model_years. Brand / model / year curation and the public brand
// logo stream moved to the TSB vehicle catalog (modules/vehiclecatalog).
package vehiclebrands

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	vehiclehandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclebrands/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	h *vehiclehandler.Handler,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	authn := middleware.Authenticate(tokens, loader)
	requireCustomersRead := middleware.RequirePermission(rbac.PermTenantCustomersRead)
	requireOrg := middleware.RequireOrganization(tokens, q)

	tenantSearch := middleware.Chain(http.HandlerFunc(h.Search), authn, requireOrg, requireCustomersRead)
	mux.Handle("GET /v1/tenant/vehicle-catalog/search", tenantSearch)
}
