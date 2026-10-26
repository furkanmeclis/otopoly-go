// Package loyalty wires the loyalty and packages module (Sadakat ve
// Paketler): /v1/tenant/loyalty/*, the job section
// (/v1/tenant/jobs/{uuid}/loyalty) and the customer 360 section
// (/v1/tenant/customers/{uuid}/loyalty). The plan toggle loyalty.enabled
// gates every route.
package loyalty

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	loyaltyhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/loyalty/handler"
	loyaltyusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/loyalty/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts the module.
func RegisterRoutes(
	mux *http.ServeMux,
	svc *loyaltyusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
	ent *entitlements.Service,
) {
	h := loyaltyhandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	feature := middleware.RequireFeature(ent, loyaltyusecase.FeatureKey)
	with := func(fn http.HandlerFunc, perms ...string) http.Handler {
		mws := []func(http.Handler) http.Handler{authn, requireOrg, feature}
		for _, p := range perms {
			mws = append(mws, middleware.RequirePermission(p))
		}
		return middleware.Chain(fn, mws...)
	}
	read := rbac.PermTenantLoyaltyRead
	apply := rbac.PermTenantLoyaltyApply
	write := rbac.PermTenantLoyaltyWrite

	mux.Handle("GET /v1/tenant/loyalty/overview", with(h.Overview, read))

	mux.Handle("GET /v1/tenant/loyalty/campaigns", with(h.ListCampaigns, read))
	mux.Handle("POST /v1/tenant/loyalty/campaigns", with(h.CreateCampaign, read, write))
	mux.Handle("GET /v1/tenant/loyalty/campaigns/{uuid}", with(h.GetCampaign, read))
	mux.Handle("PUT /v1/tenant/loyalty/campaigns/{uuid}", with(h.UpdateCampaign, read, write))
	mux.Handle("DELETE /v1/tenant/loyalty/campaigns/{uuid}", with(h.DeleteCampaign, read, write))

	mux.Handle("GET /v1/tenant/loyalty/packages", with(h.ListPackages, read))
	mux.Handle("POST /v1/tenant/loyalty/packages", with(h.CreatePackage, read, write))
	mux.Handle("GET /v1/tenant/loyalty/packages/{uuid}", with(h.GetPackage, read))
	mux.Handle("PUT /v1/tenant/loyalty/packages/{uuid}", with(h.UpdatePackage, read, write))
	mux.Handle("DELETE /v1/tenant/loyalty/packages/{uuid}", with(h.DeletePackage, read, write))

	mux.Handle("GET /v1/tenant/loyalty/plans", with(h.ListPlans, read))
	mux.Handle("POST /v1/tenant/loyalty/plans", with(h.CreatePlan, read, write))
	mux.Handle("GET /v1/tenant/loyalty/plans/{uuid}", with(h.GetPlan, read))
	mux.Handle("PUT /v1/tenant/loyalty/plans/{uuid}", with(h.UpdatePlan, read, write))
	mux.Handle("DELETE /v1/tenant/loyalty/plans/{uuid}", with(h.DeletePlan, read, write))

	mux.Handle("GET /v1/tenant/loyalty/customer-packages", with(h.ListCustomerPackages, read))
	mux.Handle("POST /v1/tenant/loyalty/customer-packages", with(h.SellPackage, read, apply))
	mux.Handle("GET /v1/tenant/loyalty/customer-packages/{uuid}", with(h.GetCustomerPackage, read))
	mux.Handle("POST /v1/tenant/loyalty/customer-packages/{uuid}/cancel", with(h.CancelCustomerPackage, read, write))

	mux.Handle("GET /v1/tenant/loyalty/subscriptions", with(h.ListSubscriptions, read))
	mux.Handle("POST /v1/tenant/loyalty/subscriptions", with(h.StartSubscription, read, apply))
	mux.Handle("GET /v1/tenant/loyalty/subscriptions/{uuid}", with(h.GetSubscription, read))
	mux.Handle("POST /v1/tenant/loyalty/subscriptions/{uuid}/payments", with(h.PaySubscription, read, apply))
	mux.Handle("POST /v1/tenant/loyalty/subscriptions/{uuid}/cancel", with(h.CancelSubscription, read, write))

	mux.Handle("GET /v1/tenant/customers/{uuid}/loyalty", with(h.CustomerLoyalty, rbac.PermTenantCustomersRead, read))
	mux.Handle("GET /v1/tenant/jobs/{uuid}/loyalty", with(h.JobLoyalty, rbac.PermTenantJobsRead, read))
	mux.Handle("POST /v1/tenant/jobs/{uuid}/loyalty/apply", with(h.ApplyToJob, rbac.PermTenantJobsWrite, read, apply))
	mux.Handle("POST /v1/tenant/jobs/{uuid}/loyalty/{applicationUuid}/revert", with(h.RevertOnJob, rbac.PermTenantJobsWrite, read, apply))
}
