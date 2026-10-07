package whatsapp

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	whatsapphandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts platform WhatsApp integration routes.
func RegisterRoutes(
	mux *http.ServeMux,
	h *whatsapphandler.Handler,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
) {
	authn := middleware.Authenticate(tokens, loader)
	require := func(slug string) func(http.Handler) http.Handler {
		return middleware.RequirePermission(slug)
	}
	superAdmin := middleware.RequireSuperAdmin

	mux.Handle("GET /v1/platform/integrations/whatsapp", middleware.Chain(
		http.HandlerFunc(h.GetSettings), authn, require(rbac.PermPlatformIntegrationsWhatsAppRead), superAdmin,
	))
	mux.Handle("PATCH /v1/platform/integrations/whatsapp", middleware.Chain(
		http.HandlerFunc(h.PatchSettings), authn, require(rbac.PermPlatformIntegrationsWhatsAppWrite), superAdmin,
	))
}
