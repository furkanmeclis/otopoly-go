// Package livepush keeps job Live Activities / Live Updates and the Home
// Screen widgets fresh while the mobile app is closed (see usecase).
package livepush

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/livepush/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts /v1/tenant/live-activities/*. Every route needs the
// organization (X-Organization) and tenant.jobs.read: activities and widgets
// show jobs, and pushes only ever go to the caller's own devices.
func RegisterRoutes(mux *http.ServeMux, h *handler.Handler, tokens *jwt.Manager, loader middleware.IdentityLoader, q *db.Queries) {
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantJobsRead)
	read := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, requireRead)
	}
	mux.Handle("GET /v1/tenant/live-activities/widget-snapshot", read(h.WidgetSnapshot))
	mux.Handle("PUT /v1/tenant/live-activities/device", read(h.RegisterDevice))
	mux.Handle("DELETE /v1/tenant/live-activities/device/{token}", read(h.UnregisterDevice))
	mux.Handle("PUT /v1/tenant/live-activities/jobs/{uuid}", read(h.RegisterActivity))
	mux.Handle("POST /v1/tenant/live-activities/jobs/{uuid}/unregister", read(h.UnregisterActivity))
}
