// Package oauth is the MCP OAuth 2.1 authorization server (docs/MCP.md). The
// protocol endpoints sit outside /v1 at the paths MCP clients expect; the
// frontend proxies /oauth/*, /.well-known/* and /mcp/* to Go because only the
// frontend is public in production.
package oauth

import (
	"log/slog"
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

// RegisterRoutes mounts the public protocol endpoints (no session; per-IP
// limits in the usecase), GET /oauth/authorize and the /v1 session endpoints.
func RegisterRoutes(mux *http.ServeMux, svc *usecase.Service, tokens *jwt.Manager, loader middleware.IdentityLoader, log *slog.Logger) {
	h := handler.New(svc, log)
	mux.HandleFunc("GET /.well-known/oauth-authorization-server", h.AuthorizationServer)
	mux.HandleFunc("GET /.well-known/oauth-authorization-server/mcp/{endpoint}", h.AuthorizationServer)
	mux.HandleFunc("GET /.well-known/openid-configuration", h.AuthorizationServer)
	mux.HandleFunc("GET /.well-known/oauth-protected-resource/mcp/{endpoint}", h.ProtectedResource)
	mux.HandleFunc("POST /oauth/register", h.Register)
	mux.HandleFunc("POST /oauth/token", h.Token)
	mux.HandleFunc("POST /oauth/revoke", h.Revoke)
	for _, p := range []string{
		"/.well-known/oauth-authorization-server",
		"/.well-known/oauth-authorization-server/mcp/{endpoint}",
		"/.well-known/openid-configuration",
		"/.well-known/oauth-protected-resource/mcp/{endpoint}",
		"/oauth/register", "/oauth/token", "/oauth/revoke",
	} {
		mux.HandleFunc("OPTIONS "+p, h.Preflight)
	}

	c := handler.NewConsent(svc, h)
	mux.HandleFunc("GET /oauth/authorize", c.Authorize)

	authn := middleware.Authenticate(tokens, loader)
	session := func(fn http.HandlerFunc) http.Handler { return middleware.Chain(fn, authn) }
	mux.Handle("GET /v1/mcp/info", session(info(svc)))
	mux.Handle("GET /v1/mcp/oauth/requests/{uuid}", session(c.ConsentInfo))
	mux.Handle("POST /v1/mcp/oauth/requests/{uuid}/decide", session(c.Decide))
	mux.Handle("GET /v1/mcp/grants", session(c.ListGrants))
	mux.Handle("DELETE /v1/mcp/grants/{uuid}", session(c.RevokeGrant))

	platform := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, middleware.RequirePermission(rbac.PermPlatformMCPManage))
	}
	mux.Handle("GET /v1/platform/mcp/clients", platform(c.ListClients))
	mux.Handle("DELETE /v1/platform/mcp/clients/{uuid}", platform(c.RevokeClient))
}

// Info is GET /v1/mcp/info: the public endpoint URLs for the connect guides
// and whether the caller may connect them.
type Info struct {
	OrgURL             string   `json:"org_url"`
	PlatformURL        string   `json:"platform_url"`
	Issuer             string   `json:"issuer"`
	Scopes             []string `json:"scopes"`
	CanConnectOrg      bool     `json:"can_connect_org"`
	CanConnectPlatform bool     `json:"can_connect_platform"`
}

func info(svc *usecase.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := authctx.MustPrincipal(r.Context())
		response.JSON(w, r, http.StatusOK, Info{
			OrgURL: svc.ResourceURL(model.ResourceOrg), PlatformURL: svc.ResourceURL(model.ResourcePlatform),
			Issuer: svc.Issuer(), Scopes: model.AllScopes,
			CanConnectOrg:      p.HasPermission(rbac.PermTenantMCPConnect),
			CanConnectPlatform: usecase.PlatformAllowed(p),
		})
	}
}
