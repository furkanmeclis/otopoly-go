package finance

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	financehandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/handler"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *financeusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := financehandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)
	requireRead := middleware.RequirePermission(rbac.PermTenantFinanceRead)
	requireWrite := middleware.RequirePermission(rbac.PermTenantFinanceWrite)
	requireOwner := middleware.RequireOrgRole("owner")
	tenantRead := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireRead)
	}
	tenantWrite := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, requireWrite, requireOwner)
	}

	mux.Handle("GET /v1/tenant/finance/accounts/meta", tenantRead(h.AccountsMeta))
	mux.Handle("GET /v1/tenant/finance/accounts", tenantRead(h.ListAccounts))
	mux.Handle("POST /v1/tenant/finance/accounts", tenantWrite(h.CreateAccount))
	mux.Handle("GET /v1/tenant/finance/accounts/{uuid}", tenantRead(h.GetAccount))
	mux.Handle("PATCH /v1/tenant/finance/accounts/{uuid}", tenantWrite(h.PatchAccount))
	mux.Handle("DELETE /v1/tenant/finance/accounts/{uuid}", tenantWrite(h.DeleteAccount))
	mux.Handle("GET /v1/tenant/finance/accounts/{uuid}/balance", tenantRead(h.AccountBalance))
	mux.Handle("GET /v1/tenant/finance/accounts/{uuid}/detail", tenantRead(h.AccountDetail))

	mux.Handle("GET /v1/tenant/finance/categories/meta", tenantRead(h.CategoriesMeta))
	mux.Handle("GET /v1/tenant/finance/categories", tenantRead(h.ListCategories))
	mux.Handle("POST /v1/tenant/finance/categories", tenantWrite(h.CreateCategory))
	mux.Handle("GET /v1/tenant/finance/categories/{uuid}", tenantRead(h.GetCategory))
	mux.Handle("GET /v1/tenant/finance/categories/{uuid}/detail", tenantRead(h.CategoryDetail))
	mux.Handle("PATCH /v1/tenant/finance/categories/{uuid}", tenantWrite(h.PatchCategory))
	mux.Handle("DELETE /v1/tenant/finance/categories/{uuid}", tenantWrite(h.DeleteCategory))

	mux.Handle("GET /v1/tenant/finance/transactions/meta", tenantRead(h.TransactionsMeta))
	mux.Handle("GET /v1/tenant/finance/transactions", tenantRead(h.ListTransactions))
	mux.Handle("POST /v1/tenant/finance/transactions", tenantWrite(h.CreateTransaction))
	mux.Handle("GET /v1/tenant/finance/transactions/{uuid}", tenantRead(h.GetTransaction))
	mux.Handle("POST /v1/tenant/finance/transactions/{uuid}/void", tenantWrite(h.VoidTransaction))

	mux.Handle("POST /v1/tenant/finance/transfers", tenantWrite(h.CreateTransfer))
	mux.Handle("GET /v1/tenant/finance/summary", tenantRead(h.Summary))
}
