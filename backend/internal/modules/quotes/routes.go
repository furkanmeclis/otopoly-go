// Package quotes wires tenant quote routes and the public share-link routes.
package quotes

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	quoteshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/handler"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts /v1/tenant/quotes/* and /v1/public/quotes/{token}/*.
func RegisterRoutes(
	mux *http.ServeMux,
	svc *quotesusecase.Service,
	limiter quoteshandler.RateLimiter,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
	ent *entitlements.Service,
) {
	h := quoteshandler.New(svc, limiter)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireFeature := middleware.RequireFeature(ent, "module.quotes")
	read := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, requireFeature, middleware.RequirePermission(rbac.PermTenantQuotesRead))
	}
	write := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, requireFeature, middleware.RequirePermission(rbac.PermTenantQuotesWrite))
	}
	// Converting creates a job: needs jobs.write too.
	convert := func(fn http.HandlerFunc) http.Handler {
		return middleware.Chain(fn, authn, requireOrg, requireFeature,
			middleware.RequirePermission(rbac.PermTenantQuotesWrite),
			middleware.RequirePermission(rbac.PermTenantJobsWrite))
	}

	mux.Handle("GET /v1/tenant/quotes/meta", read(h.Meta))
	mux.Handle("GET /v1/tenant/quotes/summary", read(h.Summary))
	mux.Handle("GET /v1/tenant/quotes", read(h.List))
	mux.Handle("POST /v1/tenant/quotes", write(h.Create))
	mux.Handle("GET /v1/tenant/quotes/{uuid}", read(h.Get))
	mux.Handle("PUT /v1/tenant/quotes/{uuid}", write(h.Update))
	mux.Handle("POST /v1/tenant/quotes/{uuid}/duplicate", write(h.Duplicate))
	mux.Handle("POST /v1/tenant/quotes/{uuid}/status", write(h.SetStatus))
	mux.Handle("GET /v1/tenant/quotes/{uuid}/send-preview", write(h.SendPreview))
	mux.Handle("POST /v1/tenant/quotes/{uuid}/send", write(h.Send))
	mux.Handle("POST /v1/tenant/quotes/{uuid}/deliveries/{deliveryUuid}/retry", write(h.RetryDelivery))
	mux.Handle("PUT /v1/tenant/quotes/{uuid}/reminders", write(h.SetReminders))
	mux.Handle("GET /v1/tenant/quotes/{uuid}/pdf", read(h.PDF))
	mux.Handle("GET /v1/tenant/quotes/{uuid}/convert", read(h.ConvertPreview))
	mux.Handle("POST /v1/tenant/quotes/{uuid}/convert", convert(h.Convert))

	mux.HandleFunc("GET /v1/public/quotes/{token}", h.PublicGet)
	mux.HandleFunc("GET /v1/public/quotes/{token}/pdf", h.PublicPDF)
	mux.HandleFunc("POST /v1/public/quotes/{token}/accept", h.PublicAccept)
	mux.HandleFunc("POST /v1/public/quotes/{token}/reject", h.PublicReject)
}
