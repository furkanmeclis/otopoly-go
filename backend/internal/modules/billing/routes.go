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
	tenantWrite := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, middleware.RequirePermission(rbac.PermTenantBillingWrite))
	}
	platformRead := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, middleware.RequirePermission(rbac.PermPlatformBillingRead))
	}
	platformWrite := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, middleware.RequirePermission(rbac.PermPlatformBillingWrite))
	}
	platformSettings := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, middleware.RequirePermission(rbac.PermPlatformBillingSettings))
	}

	mux.Handle("GET /v1/tenant/billing/overview", tenantRead(h.TenantOverview))
	mux.Handle("GET /v1/tenant/billing/plans", tenantRead(h.TenantPlans))
	mux.Handle("POST /v1/tenant/billing/orders/preview", tenantRead(h.PreviewOrder))
	mux.Handle("POST /v1/tenant/billing/orders", tenantWrite(h.CreateOrder))
	mux.Handle("GET /v1/tenant/billing/orders", tenantRead(h.ListOrders))
	mux.Handle("GET /v1/tenant/billing/orders/{uuid}", tenantRead(h.GetOrder))
	mux.Handle("POST /v1/tenant/billing/orders/{uuid}/report", tenantWrite(h.ReportPayment))
	mux.Handle("POST /v1/tenant/billing/orders/{uuid}/cancel", tenantWrite(h.CancelOrder))
	mux.Handle("GET /v1/tenant/billing/orders/{uuid}/receipt", tenantRead(h.OpenReceipt))
	mux.Handle("GET /v1/platform/billing/features", platformRead(h.PlatformListFeatures))
	mux.Handle("POST /v1/platform/billing/features", platformWrite(h.PlatformCreateFeature))
	mux.Handle("PATCH /v1/platform/billing/features/{id}", platformWrite(h.PlatformSetFeatureActive))
	mux.Handle("GET /v1/platform/billing/plans", platformRead(h.PlatformListPlans))
	mux.Handle("POST /v1/platform/billing/plans", platformWrite(h.PlatformCreatePlan))
	mux.Handle("GET /v1/platform/billing/plans/{uuid}", platformRead(h.PlatformGetPlan))
	mux.Handle("PUT /v1/platform/billing/plans/{uuid}", platformWrite(h.PlatformUpdatePlan))
	mux.Handle("DELETE /v1/platform/billing/plans/{uuid}", platformWrite(h.PlatformDeletePlan))
	mux.Handle("GET /v1/platform/billing/orders", platformRead(h.PlatformListOrders))
	mux.Handle("GET /v1/platform/billing/orders/summary", platformRead(h.PlatformOrdersSummary))
	mux.Handle("GET /v1/platform/billing/orders/{uuid}", platformRead(h.PlatformGetOrder))
	mux.Handle("GET /v1/platform/billing/orders/{uuid}/receipt", platformRead(h.PlatformOpenReceipt))
	mux.Handle("POST /v1/platform/billing/orders/{uuid}/approve", platformWrite(h.PlatformApproveOrder))
	mux.Handle("POST /v1/platform/billing/orders/{uuid}/reject", platformWrite(h.PlatformRejectOrder))
	mux.Handle("GET /v1/platform/billing/subscriptions", platformRead(h.PlatformListSubscriptions))
	mux.Handle("POST /v1/platform/billing/subscriptions", platformWrite(h.PlatformCreateSubscription))
	mux.Handle("PATCH /v1/platform/billing/subscriptions/{uuid}", platformWrite(h.PlatformUpdateSubscription))
	mux.Handle("GET /v1/platform/billing/discount-codes", platformRead(h.PlatformListDiscountCodes))
	mux.Handle("POST /v1/platform/billing/discount-codes", platformWrite(h.PlatformCreateDiscountCode))
	mux.Handle("GET /v1/platform/billing/discount-codes/{uuid}", platformRead(h.PlatformGetDiscountCode))
	mux.Handle("PUT /v1/platform/billing/discount-codes/{uuid}", platformWrite(h.PlatformUpdateDiscountCode))
	mux.Handle("DELETE /v1/platform/billing/discount-codes/{uuid}", platformWrite(h.PlatformDeleteDiscountCode))
	mux.Handle("GET /v1/platform/billing/settings", platformRead(h.PlatformGetSettings))
	mux.Handle("PUT /v1/platform/billing/settings", platformSettings(h.PlatformUpdateSettings))
}
