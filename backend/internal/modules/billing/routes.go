package billing

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	billinghandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/handler"
	billingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *billingusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := billinghandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	tenantRead := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, middleware.RequirePermission(rbac.PermTenantBillingRead))
	}
	platformRead := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, middleware.RequirePermission(rbac.PermPlatformBillingRead))
	}
	platformWrite := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, middleware.RequirePermission(rbac.PermPlatformBillingWrite))
	}

	mux.Handle("GET /v1/tenant/billing/overview", tenantRead(h.TenantOverview))
	mux.Handle("GET /v1/tenant/billing/plans", tenantRead(h.TenantPlans))
	mux.Handle("GET /v1/platform/billing/features", platformRead(h.PlatformListFeatures))
	mux.Handle("POST /v1/platform/billing/features", platformWrite(h.PlatformCreateFeature))
	mux.Handle("PATCH /v1/platform/billing/features/{id}", platformWrite(h.PlatformSetFeatureActive))
	mux.Handle("GET /v1/platform/billing/plans", platformRead(h.PlatformListPlans))
	mux.Handle("POST /v1/platform/billing/plans", platformWrite(h.PlatformCreatePlan))
	mux.Handle("GET /v1/platform/billing/plans/{uuid}", platformRead(h.PlatformGetPlan))
	mux.Handle("PUT /v1/platform/billing/plans/{uuid}", platformWrite(h.PlatformUpdatePlan))
	mux.Handle("DELETE /v1/platform/billing/plans/{uuid}", platformWrite(h.PlatformDeletePlan))
}
