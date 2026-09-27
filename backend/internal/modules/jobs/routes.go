package jobs

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	jobshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/handler"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *jobsusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := jobshandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantJobsRead)
	requireWrite := middleware.RequirePermission(rbac.PermTenantJobsWrite)
	requireOwner := middleware.RequireOrgRole("owner")
	requireCustomersRead := middleware.RequirePermission(rbac.PermTenantCustomersRead)

	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireRead)
	}
	write := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireWrite)
	}
	ownerWrite := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireWrite, requireOwner)
	}
	customerJobs := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireCustomersRead, requireRead)
	}

	mux.Handle("GET /v1/tenant/jobs/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/jobs/summary", read(h.Summary))
	mux.Handle("GET /v1/tenant/jobs", read(h.List))
	mux.Handle("POST /v1/tenant/jobs", write(h.Create))
	mux.Handle("GET /v1/tenant/jobs/{uuid}", read(h.Get))
	mux.Handle("PATCH /v1/tenant/jobs/{uuid}", write(h.Patch))
	mux.Handle("POST /v1/tenant/jobs/{uuid}/ready", write(h.Done))
	mux.Handle("POST /v1/tenant/jobs/{uuid}/done", write(h.Done)) // alias for ready
	mux.Handle("POST /v1/tenant/jobs/{uuid}/deliver", write(h.Deliver))
	mux.Handle("POST /v1/tenant/jobs/{uuid}/close", write(h.Close))
	mux.Handle("POST /v1/tenant/jobs/{uuid}/cancel", write(h.Cancel))
	mux.Handle("POST /v1/tenant/jobs/{uuid}/void", ownerWrite(h.Void))
	mux.Handle("POST /v1/tenant/jobs/{uuid}/consumptions", write(h.AddConsumption))
	mux.Handle("PATCH /v1/tenant/jobs/{uuid}/consumptions/{consumptionUuid}", write(h.UpdateConsumption))
	mux.Handle("DELETE /v1/tenant/jobs/{uuid}/consumptions/{consumptionUuid}", write(h.DeleteConsumption))
	mux.Handle("GET /v1/tenant/customers/{uuid}/jobs", customerJobs(h.ListByCustomer))
}
