package reports

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	reportshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reports/handler"
	reportsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reports/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *reportsusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := reportshandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantReportsRead)

	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireRead)
	}

	mux.Handle("GET /v1/tenant/reports/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/reports/overview", read(h.Overview))
}
