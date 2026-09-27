// Package leads wires tenant lead routes.
package leads

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	leadshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/leads/handler"
	leadsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/leads/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts /v1/tenant/leads/*.
func RegisterRoutes(
	mux *http.ServeMux,
	svc *leadsusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
	ent *entitlements.Service,
) {
	h := leadshandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireFeature := middleware.RequireFeature(ent, "module.quotes")
	read := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, requireFeature, middleware.RequirePermission(rbac.PermTenantLeadsRead))
	}
	write := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, requireFeature, middleware.RequirePermission(rbac.PermTenantLeadsWrite))
	}
	todo := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, requireFeature,
			middleware.RequirePermission(rbac.PermTenantLeadsWrite),
			middleware.RequirePermission(rbac.PermTenantTodosWrite))
	}
	mux.Handle("GET /v1/tenant/leads/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/leads/summary", read(h.Summary))
	mux.Handle("GET /v1/tenant/leads/assignees", read(h.Assignees))
	mux.Handle("GET /v1/tenant/leads", read(h.List))
	mux.Handle("POST /v1/tenant/leads", write(h.Create))
	mux.Handle("GET /v1/tenant/leads/{uuid}", read(h.Get))
	mux.Handle("PATCH /v1/tenant/leads/{uuid}", write(h.Patch))
	mux.Handle("DELETE /v1/tenant/leads/{uuid}", write(h.Delete))
	mux.Handle("POST /v1/tenant/leads/{uuid}/notes", write(h.AddNote))
	mux.Handle("POST /v1/tenant/leads/{uuid}/todo", todo(h.CreateTodo))
}
