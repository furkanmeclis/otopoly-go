// Package todos wires organization todos (/v1/tenant/todos).
package todos

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	todoshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/handler"
	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts the todo endpoints.
func RegisterRoutes(
	mux *http.ServeMux,
	svc *todosusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := todoshandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, middleware.RequirePermission(rbac.PermTenantTodosRead))
	}
	write := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, middleware.RequirePermission(rbac.PermTenantTodosWrite))
	}

	mux.Handle("GET /v1/tenant/todos/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/todos/summary", read(h.Summary))
	mux.Handle("GET /v1/tenant/todos/assignees", read(h.Assignees))
	mux.Handle("GET /v1/tenant/todos", read(h.List))
	mux.Handle("POST /v1/tenant/todos", write(h.Create))
	mux.Handle("GET /v1/tenant/todos/{uuid}", read(h.Get))
	mux.Handle("PATCH /v1/tenant/todos/{uuid}", write(h.Patch))
	mux.Handle("DELETE /v1/tenant/todos/{uuid}", write(h.Delete))
	mux.Handle("POST /v1/tenant/todos/{uuid}/complete", write(h.Complete))
	mux.Handle("POST /v1/tenant/todos/{uuid}/reopen", write(h.Reopen))
}
