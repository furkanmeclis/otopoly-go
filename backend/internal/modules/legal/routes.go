package legal

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	legalhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/legal/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts /v1/public/legal/{slug} and /v1/platform/legal/{slug}.
func RegisterRoutes(
	mux *http.ServeMux,
	h *legalhandler.Handler,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
) {
	authn := middleware.Authenticate(tokens, loader)

	mux.HandleFunc("GET /v1/public/legal/{slug}", h.PublicGet)
	mux.Handle("GET /v1/platform/legal/{slug}", middleware.Chain(
		http.HandlerFunc(h.Get), authn, middleware.RequirePermission(rbac.PermPlatformLegalRead),
	))
	mux.Handle("PATCH /v1/platform/legal/{slug}", middleware.Chain(
		http.HandlerFunc(h.Patch), authn, middleware.RequirePermission(rbac.PermPlatformLegalWrite),
	))
}
