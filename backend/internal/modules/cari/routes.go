package cari

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	carihandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/handler"
	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *cariusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := carihandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantCariRead)
	requireWrite := middleware.RequirePermission(rbac.PermTenantCariWrite)
	requireOwner := middleware.RequireOrgRole("owner")

	read := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireRead)
	}
	write := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireWrite, requireOwner)
	}

	mux.Handle("GET /v1/tenant/cari/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/cari/summary", read(h.Summary))
	mux.Handle("GET /v1/tenant/cari", read(h.List))
	mux.Handle("GET /v1/tenant/cari/{uuid}", read(h.Get))
	mux.Handle("GET /v1/tenant/cari/{uuid}/entries", read(h.ListEntries))
	mux.Handle("POST /v1/tenant/cari/{uuid}/charges", write(h.CreateCharge))
	mux.Handle("POST /v1/tenant/cari/{uuid}/payments", write(h.CreatePayment))
	mux.Handle("POST /v1/tenant/cari/{uuid}/adjustments", write(h.CreateAdjustment))
	mux.Handle("POST /v1/tenant/cari/entries/{uuid}/void", write(h.VoidEntry))
}
