// Package ai wires the AI assistant module (tenant chat + platform settings).
package ai

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	aihandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts /v1/tenant/ai/* and /v1/platform/ai/*.
func RegisterRoutes(
	mux *http.ServeMux,
	h *aihandler.Handler,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireUse := middleware.RequirePermission(rbac.PermTenantAIUse)

	tenant := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireUse)
	}
	mux.Handle("GET /v1/tenant/ai/status", tenant(h.Status))
	mux.Handle("GET /v1/tenant/ai/conversations", tenant(h.ListConversations))
	mux.Handle("POST /v1/tenant/ai/conversations", tenant(h.CreateConversation))
	mux.Handle("GET /v1/tenant/ai/conversations/{uuid}", tenant(h.GetConversation))
	mux.Handle("PATCH /v1/tenant/ai/conversations/{uuid}", tenant(h.RenameConversation))
	mux.Handle("DELETE /v1/tenant/ai/conversations/{uuid}", tenant(h.DeleteConversation))
	mux.Handle("POST /v1/tenant/ai/conversations/{uuid}/messages", tenant(h.SendMessage))
	mux.Handle("POST /v1/tenant/ai/actions/{uuid}/confirm", tenant(h.ConfirmAction))
	mux.Handle("POST /v1/tenant/ai/actions/{uuid}/cancel", tenant(h.CancelAction))
	mux.Handle("POST /v1/tenant/ai/voice/transcribe", tenant(h.Transcribe))
	mux.Handle("POST /v1/tenant/ai/voice/speech", tenant(h.Speech))

	platform := func(handler http.HandlerFunc, perm string) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, middleware.RequirePermission(perm))
	}
	mux.Handle("GET /v1/platform/ai/settings", platform(h.GetSettings, rbac.PermPlatformAIRead))
	mux.Handle("PATCH /v1/platform/ai/settings", platform(h.PatchSettings, rbac.PermPlatformAIWrite))
	mux.Handle("POST /v1/platform/ai/settings/test", platform(h.TestConnection, rbac.PermPlatformAIWrite))
	mux.Handle("POST /v1/platform/ai/voice/test", platform(h.TestVoice, rbac.PermPlatformAIWrite))
	mux.Handle("GET /v1/platform/ai/voice/models", platform(h.VoiceModels, rbac.PermPlatformAIRead))
	mux.Handle("POST /v1/platform/ai/voice/models/download", platform(h.DownloadVoiceModel, rbac.PermPlatformAIWrite))
	mux.Handle("GET /v1/platform/ai/usage", platform(h.Usage, rbac.PermPlatformAIRead))
	mux.Handle("GET /v1/platform/ai/organizations/{uuid}", platform(h.GetOrgSettings, rbac.PermPlatformAIRead))
	mux.Handle("PUT /v1/platform/ai/organizations/{uuid}", platform(h.PutOrgSettings, rbac.PermPlatformAIWrite))
}
