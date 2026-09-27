package exports

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	exporthandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/exports/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/stepup"
)

// RegisterRoutes mounts export routes.
func RegisterRoutes(
	mux *http.ServeMux,
	h *exporthandler.Handler,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	stepUp *stepup.Service,
	q *db.Queries,
	ent *entitlements.Service,
) {
	authn := middleware.Authenticate(tokens, loader)
	require := func(slug string) func(http.Handler) http.Handler {
		return middleware.RequirePermission(slug)
	}
	var requireStepUp func(http.Handler) http.Handler
	if stepUp != nil {
		requireStepUp = middleware.RequireStepUp(stepUp)
	} else {
		requireStepUp = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("GET /v1/platform/exports", middleware.Chain(
		http.HandlerFunc(h.List), authn, require(rbac.PermPlatformExportsRead),
	))
	mux.Handle("GET /v1/platform/exports/{uuid}", middleware.Chain(
		http.HandlerFunc(h.Get), authn, require(rbac.PermPlatformExportsRead),
	))
	mux.Handle("GET /v1/platform/exports/{uuid}/download", middleware.Chain(
		http.HandlerFunc(h.Download), authn, require(rbac.PermPlatformExportsRead),
	))

	mux.Handle("POST /v1/platform/users/export", middleware.Chain(
		http.HandlerFunc(h.RequestUsersExport), authn, require(rbac.PermPlatformUsersExport), requireStepUp,
	))
	mux.Handle("POST /v1/platform/roles/export", middleware.Chain(
		http.HandlerFunc(h.RequestRolesExport), authn, require(rbac.PermPlatformRolesExport), requireStepUp,
	))
	mux.Handle("POST /v1/platform/notifications/export", middleware.Chain(
		http.HandlerFunc(h.RequestNotificationsExport), authn, require(rbac.PermPlatformNotificationsExport), requireStepUp,
	))
	mux.Handle("POST /v1/platform/activity/export", middleware.Chain(
		http.HandlerFunc(h.RequestActivityExport), authn, require(rbac.PermPlatformActivityRead), requireStepUp,
	))

	requireOrg := middleware.RequireOrganization(tokens, q)
	requireReportsFeature := middleware.RequireFeature(ent, "module.reports")
	tenantExport := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireReportsFeature, require(rbac.PermTenantFinanceExport))
	}
	cariExport := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireReportsFeature, require(rbac.PermTenantCariExport))
	}
	jobsExport := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireReportsFeature, require(rbac.PermTenantJobsExport))
	}
	salesExport := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireReportsFeature, require(rbac.PermTenantSalesExport))
	}
	suppliersExport := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireReportsFeature, require(rbac.PermTenantSuppliersExport))
	}
	purchasesExport := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireReportsFeature, require(rbac.PermTenantPurchasesExport))
	}
	reportsExport := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireReportsFeature, require(rbac.PermTenantReportsExport))
	}
	mux.Handle("GET /v1/tenant/exports", tenantExport(h.ListTenant))
	mux.Handle("GET /v1/tenant/exports/{uuid}", tenantExport(h.GetTenant))
	mux.Handle("GET /v1/tenant/exports/{uuid}/download", tenantExport(h.DownloadTenant))
	mux.Handle("POST /v1/tenant/finance/accounts/export", tenantExport(h.RequestFinanceAccountsExport))
	mux.Handle("POST /v1/tenant/finance/categories/export", tenantExport(h.RequestFinanceCategoriesExport))
	mux.Handle("POST /v1/tenant/finance/transactions/export", tenantExport(h.RequestFinanceTransactionsExport))
	mux.Handle("POST /v1/tenant/cari/export", cariExport(h.RequestCariExport))
	mux.Handle("POST /v1/tenant/cari/{uuid}/entries/export", cariExport(h.RequestCariEntriesExport))
	mux.Handle("POST /v1/tenant/jobs/export", jobsExport(h.RequestJobsExport))
	mux.Handle("POST /v1/tenant/sales/export", salesExport(h.RequestSalesExport))
	mux.Handle("POST /v1/tenant/suppliers/export", suppliersExport(h.RequestSuppliersExport))
	mux.Handle("POST /v1/tenant/purchases/export", purchasesExport(h.RequestPurchasesExport))
	mux.Handle("POST /v1/tenant/reports/export", reportsExport(h.RequestReportsExport))
}
