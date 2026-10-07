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
	read := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, require(rbac.PermPlatformIntegrationsWhatsAppRead), superAdmin)
	}
	write := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, require(rbac.PermPlatformIntegrationsWhatsAppWrite), superAdmin)
	}

	mux.Handle("PATCH /v1/platform/integrations/whatsapp", write(h.PatchSettings))
	mux.Handle("POST /v1/platform/integrations/whatsapp/test", write(h.TestSend))
	mux.Handle("POST /v1/platform/integrations/whatsapp/session/connect", write(h.ConnectSession))
	mux.Handle("DELETE /v1/platform/integrations/whatsapp/session", write(h.DisconnectSession))
	mux.Handle("GET /v1/platform/integrations/whatsapp/templates", read(h.ListTemplates))
	mux.Handle("POST /v1/platform/integrations/whatsapp/templates/submit", write(h.SubmitTemplates))
	mux.Handle("POST /v1/platform/integrations/whatsapp/templates/sync", write(h.SyncTemplates))
	mux.Handle("PATCH /v1/platform/integrations/whatsapp/templates/{key}", write(h.PatchTemplate))
}

// RegisterWebhookRoutes mounts the public Meta webhook (no auth; signed body,
// rate-limited per IP in the handler).
func RegisterWebhookRoutes(mux *http.ServeMux, h *whatsapphandler.WebhookHandler) {
	mux.HandleFunc("GET /v1/public/whatsapp/webhook", h.Verify)
	mux.HandleFunc("POST /v1/public/whatsapp/webhook", h.Notify)
}
