package messaging

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	messaginghandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/handler"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts messaging routes.
func RegisterRoutes(
	mux *http.ServeMux,
	svc *messagingusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := messaginghandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)

	tenantRead := middleware.RequirePermission(rbac.PermTenantMessagingRead)
	tenantWrite := middleware.RequirePermission(rbac.PermTenantMessagingWrite)
	requireOwner := middleware.RequireOrgRole("owner")

	tRead := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, tenantRead)
	}
	tWrite := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, tenantWrite, requireOwner)
	}

	// WhatsApp session
	mux.Handle("GET /v1/tenant/messaging/session", tRead(h.GetSession))
	mux.Handle("POST /v1/tenant/messaging/session/connect", tWrite(h.ConnectWhatsApp))
	mux.Handle("DELETE /v1/tenant/messaging/session", tWrite(h.DisconnectWhatsApp))

	// Notification rules
	mux.Handle("GET /v1/tenant/messaging/rules", tRead(h.ListRules))
	mux.Handle("PATCH /v1/tenant/messaging/rules/{event_type}/{channel}", tWrite(h.ToggleRule))

	// Message templates
	mux.Handle("GET /v1/tenant/messaging/templates", tRead(h.ListTemplates))
	mux.Handle("POST /v1/tenant/messaging/templates", tWrite(h.UpsertTemplate))
	mux.Handle("GET /v1/tenant/messaging/templates/{uuid}", tRead(h.GetTemplate))
	mux.Handle("PATCH /v1/tenant/messaging/templates/{uuid}", tWrite(h.PatchTemplate))
	mux.Handle("DELETE /v1/tenant/messaging/templates/{uuid}", tWrite(h.DeleteTemplate))
}
