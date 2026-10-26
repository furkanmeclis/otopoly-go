package messaging

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	messaginghandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/smschannel"
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
	mux.Handle("PATCH /v1/tenant/messaging/session/settings", tWrite(h.UpdateSessionSettings))

	// Outbound log (sender route + delivery status)
	mux.Handle("GET /v1/tenant/messaging/outbound", tRead(h.ListOutbound))

	// Notification rules
	mux.Handle("GET /v1/tenant/messaging/rules", tRead(h.ListRules))
	mux.Handle("PATCH /v1/tenant/messaging/rules/{event_type}/{channel}", tWrite(h.ToggleRule))

	// Message templates
	mux.Handle("GET /v1/tenant/messaging/templates", tRead(h.ListTemplates))
	mux.Handle("POST /v1/tenant/messaging/templates", tWrite(h.UpsertTemplate))
	mux.Handle("GET /v1/tenant/messaging/templates/{uuid}", tRead(h.GetTemplate))
	mux.Handle("PATCH /v1/tenant/messaging/templates/{uuid}", tWrite(h.PatchTemplate))
	mux.Handle("DELETE /v1/tenant/messaging/templates/{uuid}", tWrite(h.DeleteTemplate))

	// Template catalog (types × channels × locales, system defaults + org overrides)
	mux.Handle("GET /v1/tenant/messaging/template-types", tRead(h.TemplateCatalog))
	mux.Handle("PUT /v1/tenant/messaging/template-types/{event_type}/{channel}/{locale}", tWrite(h.SaveTemplateByKey))
	mux.Handle("DELETE /v1/tenant/messaging/template-types/{event_type}/{channel}/{locale}", tWrite(h.ResetTemplateByKey))

	mux.Handle("POST /v1/tenant/messaging/simulate", tWrite(h.Simulate))
}

// RegisterSMSRoutes mounts the organization SMS channel (own Netgsm / Twilio
// account). Reads need tenant.messaging.read; changes, connection tests and
// test SMS need tenant.messaging.write and the owner role (like WhatsApp).
func RegisterSMSRoutes(
	mux *http.ServeMux,
	svc *smschannel.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := smschannel.NewHandler(svc)
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

	mux.Handle("GET /v1/tenant/messaging/sms", tRead(h.Overview))
	mux.Handle("POST /v1/tenant/messaging/sms/estimate", tRead(h.Estimate))
	mux.Handle("PUT /v1/tenant/messaging/sms/{provider}", tWrite(h.Save))
	mux.Handle("PATCH /v1/tenant/messaging/sms/{provider}", tWrite(h.SetActive))
	mux.Handle("DELETE /v1/tenant/messaging/sms/{provider}", tWrite(h.Disconnect))
	mux.Handle("POST /v1/tenant/messaging/sms/{provider}/test", tWrite(h.Test))
	mux.Handle("POST /v1/tenant/messaging/sms/{provider}/test-sms", tWrite(h.SendTest))
}

// RegisterSMSReportRoutes mounts the platform SMS report
// (platform.messaging.sms.read).
func RegisterSMSReportRoutes(
	mux *http.ServeMux,
	report *smschannel.Report,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
) {
	h := smschannel.NewReportHandler(report)
	authn := middleware.Authenticate(tokens, loader)
	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, middleware.RequirePermission(rbac.PermPlatformMessagingSMSRead))
	}
	mux.Handle("GET /v1/platform/messaging/sms/report", read(h.Report))
	mux.Handle("GET /v1/platform/messaging/sms/organizations/{uuid}/messages", read(h.OrgMessages))
}
