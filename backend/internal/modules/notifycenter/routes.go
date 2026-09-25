// Package notifycenter wires the central notification service's HTTP routes.
package notifycenter

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	centerhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/handler"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
)

// RegisterRoutes mounts member preference routes. Every member manages only
// their own preferences, so no extra permission slug is needed.
func RegisterRoutes(mux *http.ServeMux, svc *centerusecase.Service, tokens *jwt.Manager, loader middleware.IdentityLoader, q *db.Queries) {
	h := centerhandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	mux.Handle("GET /v1/tenant/notification-preferences", middleware.Chain(http.HandlerFunc(h.GetPreferences), authn, requireOrg))
	mux.Handle("PUT /v1/tenant/notification-preferences", middleware.Chain(http.HandlerFunc(h.PutPreferences), authn, requireOrg))
}
