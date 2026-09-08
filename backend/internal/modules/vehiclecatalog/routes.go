package vehiclecatalog

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	vehiclehandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog/handler"
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
	requireRead := middleware.RequirePermission(rbac.PermPlatformVehicleBrandsRead)
	requireWrite := middleware.RequirePermission(rbac.PermPlatformVehicleBrandsWrite)
	requireCustomersRead := middleware.RequirePermission(rbac.PermTenantCustomersRead)
	requireOrg := middleware.RequireOrganization(tokens, q)

	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireRead)
	}
	write := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireWrite)
	}

	mux.HandleFunc("GET /v1/public/vehicle-brands/logo/{uuid}", h.PublicStreamLogo)

	mux.Handle("GET /v1/platform/vehicle-brands/meta", read(h.Meta))
	mux.Handle("GET /v1/platform/vehicle-brands", read(h.List))
	mux.Handle("POST /v1/platform/vehicle-brands", write(h.Create))
	mux.Handle("POST /v1/platform/vehicle-brands/import", write(h.Import))
	mux.Handle("GET /v1/platform/vehicle-brands/{uuid}", read(h.Get))
	mux.Handle("PATCH /v1/platform/vehicle-brands/{uuid}", write(h.Patch))
	mux.Handle("DELETE /v1/platform/vehicle-brands/{uuid}", write(h.Delete))
	mux.Handle("PUT /v1/platform/vehicle-brands/{uuid}/logo", write(h.UploadLogo))
	mux.Handle("POST /v1/platform/vehicle-brands/{uuid}/models", write(h.CreateModel))
	mux.Handle("DELETE /v1/platform/vehicle-models/{uuid}", write(h.DeleteModel))
	mux.Handle("POST /v1/platform/vehicle-models/{uuid}/years", write(h.AddYear))
	mux.Handle("DELETE /v1/platform/vehicle-models/{uuid}/years/{year}", write(h.DeleteYear))

	tenantSearch := middleware.Chain(http.HandlerFunc(h.Search), authn, requireOrg, requireCustomersRead)
	mux.Handle("GET /v1/tenant/vehicle-catalog/search", tenantSearch)
}
