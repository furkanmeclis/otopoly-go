// Package apnskey mounts the platform APNs key endpoints (Live Activity
// pushes). They sit under the Apple integration and reuse its permissions.
package apnskey

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/apnskey/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts /v1/platform/integrations/apple/apns.
func RegisterRoutes(mux *http.ServeMux, h *handler.Handler, tokens *jwt.Manager, loader middleware.IdentityLoader) {
	authn := middleware.Authenticate(tokens, loader)
	read := middleware.RequirePermission(rbac.PermPlatformIntegrationsAppleRead)
	write := middleware.RequirePermission(rbac.PermPlatformIntegrationsAppleWrite)
	superAdmin := middleware.RequireSuperAdmin
	const base = "/v1/platform/integrations/apple/apns"

	mux.Handle("GET "+base, middleware.Chain(http.HandlerFunc(h.Get), authn, read, superAdmin))
	mux.Handle("PUT "+base, middleware.Chain(http.HandlerFunc(h.Put), authn, write, superAdmin))
	mux.Handle("DELETE "+base, middleware.Chain(http.HandlerFunc(h.Delete), authn, write, superAdmin))
	mux.Handle("POST "+base+"/test", middleware.Chain(http.HandlerFunc(h.Test), authn, write, superAdmin))
}
