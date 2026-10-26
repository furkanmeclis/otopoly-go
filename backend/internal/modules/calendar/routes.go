// Package calendar wires the organization calendar (/v1/tenant/calendar).
package calendar

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	calendarhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/calendar/handler"
	calendarusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/calendar/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts the calendar endpoints. Every module layer in the
// feed is additionally filtered by that module's own read permission and
// plan feature, and moving an item needs that module's write permission.
func RegisterRoutes(
	mux *http.ServeMux,
	svc *calendarusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := calendarhandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg,
			middleware.RequirePermission(rbac.PermTenantCalendarRead))
	}
	write := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg,
			middleware.RequirePermission(rbac.PermTenantCalendarWrite))
	}

	mux.Handle("GET /v1/tenant/calendar/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/calendar/feed", read(h.Feed))
	// Per-layer write permission is checked in the use case.
	mux.Handle("POST /v1/tenant/calendar/items/move", read(h.Move))
	mux.Handle("POST /v1/tenant/calendar/events", write(h.CreateEvent))
	mux.Handle("GET /v1/tenant/calendar/events/{uuid}", read(h.GetEvent))
	mux.Handle("PUT /v1/tenant/calendar/events/{uuid}", write(h.UpdateEvent))
	mux.Handle("DELETE /v1/tenant/calendar/events/{uuid}", write(h.DeleteEvent))
}
