package httpserver

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/cache"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	activityusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/activity/usecase"
	aitools "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	aiusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/usecase"
	authusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	billingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/usecase"
	leadsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/leads/usecase"
	logsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/logs/usecase"
	mcpmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/mcp"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/mcp/orgtools"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/mcp/platformtools"
	oauthmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth"
	oauthmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
	oauthusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/usecase"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ratelimit"
)

// mcpDeps are the services the MCP server and its OAuth authorization server
// are built from (docs/MCP.md).
type mcpDeps struct {
	auth         *authusecase.AuthUseCase
	orgs         *orgusecase.Service
	billing      *billingusecase.Service
	ai           *aiusecase.Service
	aiTools      *aitools.Registry
	logs         *logsusecase.Service
	leads        *leadsusecase.Service
	quotes       *quotesusecase.Service
	entitlements *entitlements.Service
	activity     *activity.Recorder
	limiter      *ratelimit.Limiter
	tokens       *jwt.Manager
	loader       middleware.IdentityLoader
}

// registerMCP mounts the OAuth endpoints (/.well-known/*, /oauth/*, /v1/mcp/*,
// /v1/platform/mcp/*) and the MCP endpoints (/mcp/org, /mcp/platform). The
// issuer is the public frontend origin, which proxies these paths to Go.
func (s *Server) registerMCP(mux *http.ServeMux, d mcpDeps) {
	issuer := s.cfg.Auth.FrontendURL
	oauthSvc := oauthusecase.New(s.db, d.entitlements, d.limiter, issuer, s.log)
	oauthSvc.SetActivityRecorder(d.activity)

	orgReg := aitools.NewRegistry(d.aiTools.All()...)
	for _, t := range orgtools.Tools(orgtools.Deps{Leads: d.leads, Quotes: d.quotes}) {
		orgReg.Register(t)
	}
	platformReg := platformtools.Registry(platformtools.Deps{
		Organizations: d.orgs, Users: d.auth, Billing: d.billing, AIUsage: d.ai,
		Logs: d.logs, Activity: activityusecase.New(s.queries), Health: s.infraChecks,
	})
	sets := map[string]mcpmodule.ToolSet{
		oauthmodel.ResourceOrg:      mcpmodule.OrgTools{Registry: orgReg, Gate: d.ai.MCPGate, Features: d.entitlements},
		oauthmodel.ResourcePlatform: mcpmodule.PlatformTools{Registry: platformReg},
	}
	principals := mcpmodule.StoreResolver{Q: s.queries, Access: d.auth}
	oauthSvc.SetToolCounter(mcpmodule.ToolCounter{Principals: principals, Sets: sets})

	oauthmodule.RegisterRoutes(mux, oauthSvc, d.tokens, d.loader, s.log)
	mcpmodule.RegisterRoutes(mux, mcpmodule.New(mcpmodule.Config{
		Tokens: oauthSvc, Principals: principals, Sets: sets,
		Limiter: d.limiter, Activity: d.activity, Log: s.log,
	}))

	ctx, cancel := context.WithCancel(context.Background())
	s.mcpCleanupStop = cancel
	go runMCPCleanup(ctx, oauthSvc, s.log)
}

// runMCPCleanup deletes expired OAuth requests, codes and tokens and never
// connected client registrations every hour.
func runMCPCleanup(ctx context.Context, svc *oauthusecase.Service, log *slog.Logger) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			runCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
			if err := svc.Cleanup(runCtx); err != nil {
				log.Warn("mcp_oauth_cleanup_failed", "error", err)
			}
			cancel()
		}
	}
}

// infraChecks pings the infrastructure for the platform system_health tool
// (the same checks as /readyz).
func (s *Server) infraChecks(ctx context.Context) map[string]string {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	checks := map[string]string{"postgres": "ok", "redis": "ok", "storage": "disabled", "meilisearch": "disabled"}
	if err := database.Ping(ctx, s.db); err != nil {
		checks["postgres"] = "down"
	}
	if err := cache.Ping(ctx, s.redis); err != nil {
		checks["redis"] = "down"
	}
	if s.storage != nil {
		checks["storage"] = "ok"
		if err := s.storage.Ping(ctx); err != nil {
			checks["storage"] = "down"
		}
	}
	if s.searchClient != nil && s.searchClient.Enabled() {
		checks["meilisearch"] = "ok"
		if err := s.searchClient.Ping(ctx); err != nil {
			checks["meilisearch"] = "down"
		}
	}
	return checks
}
