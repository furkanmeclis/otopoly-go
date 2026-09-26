package contracts

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	contractshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/contracts/handler"
	contractsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/contracts/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func RegisterRoutes(
	mux *http.ServeMux,
	svc *contractsusecase.Service,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	q *db.Queries,
) {
	h := contractshandler.New(svc)
	authn := middleware.Authenticate(tokens, loader)
	requireOrg := middleware.RequireOrganization(tokens, q)

	platformRead := middleware.RequirePermission(rbac.PermPlatformContractPresetsRead)
	platformWrite := middleware.RequirePermission(rbac.PermPlatformContractPresetsWrite)
	tenantRead := middleware.RequirePermission(rbac.PermTenantContractsRead)
	tenantWrite := middleware.RequirePermission(rbac.PermTenantContractsWrite)
	requireOwner := middleware.RequireOrgRole("owner")

	pRead := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, platformRead)
	}
	pWrite := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, platformWrite)
	}
	tRead := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, tenantRead)
	}
	tWrite := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, tenantWrite)
	}
	tOwnerWrite := func(handler http.HandlerFunc) http.Handler {
		return middleware.Chain(http.HandlerFunc(handler), authn, requireOrg, tenantWrite, requireOwner)
	}

	// Platform presets
	mux.Handle("GET /v1/platform/contract-presets/meta", pRead(h.PresetMeta))
	mux.Handle("GET /v1/platform/contract-presets", pRead(h.ListPresets))
	mux.Handle("POST /v1/platform/contract-presets", pWrite(h.CreatePreset))
	mux.Handle("GET /v1/platform/contract-presets/{uuid}", pRead(h.GetPreset))
	mux.Handle("PATCH /v1/platform/contract-presets/{uuid}", pWrite(h.PatchPreset))
	mux.Handle("DELETE /v1/platform/contract-presets/{uuid}", pWrite(h.DeletePreset))

	// Tenant templates (owner)
	mux.Handle("GET /v1/tenant/contracts/templates/meta", tRead(h.TemplateMeta))
	mux.Handle("GET /v1/tenant/contracts/presets", tRead(h.ListPresetsForTenant))
	mux.Handle("GET /v1/tenant/contracts/templates", tRead(h.ListTemplates))
	mux.Handle("POST /v1/tenant/contracts/templates", tOwnerWrite(h.CreateTemplate))
	mux.Handle("POST /v1/tenant/contracts/templates/clone", tOwnerWrite(h.CloneTemplate))
	mux.Handle("GET /v1/tenant/contracts/templates/{uuid}", tRead(h.GetTemplate))
	mux.Handle("PATCH /v1/tenant/contracts/templates/{uuid}", tOwnerWrite(h.PatchTemplate))
	mux.Handle("DELETE /v1/tenant/contracts/templates/{uuid}", tOwnerWrite(h.DeleteTemplate))

	// Tenant instances — staff may create/sign; void stays owner
	mux.Handle("GET /v1/tenant/contracts/instances", tRead(h.ListInstances))
	mux.Handle("POST /v1/tenant/contracts/instances", tWrite(h.CreateInstance))
	mux.Handle("GET /v1/tenant/contracts/instances/{uuid}", tRead(h.GetInstance))
	mux.Handle("POST /v1/tenant/contracts/instances/{uuid}/void", tOwnerWrite(h.VoidInstance))
	mux.Handle("POST /v1/tenant/contracts/instances/{uuid}/finalize", tWrite(h.FinalizeInstance))
	mux.Handle("POST /v1/tenant/contracts/instances/{uuid}/signers/{signerUuid}/sign", tWrite(h.Sign))
	mux.Handle("POST /v1/tenant/contracts/instances/{uuid}/signers/{signerUuid}/otp", tWrite(h.SendSignerOTP))
	mux.Handle("POST /v1/tenant/contracts/instances/{uuid}/signers/{signerUuid}/otp/verify", tWrite(h.VerifySignerOTP))
	mux.Handle("POST /v1/tenant/contracts/instances/{uuid}/media", tWrite(h.UploadMedia))
	mux.Handle("DELETE /v1/tenant/contracts/instances/{uuid}/media/{mediaUuid}", tWrite(h.DeleteMedia))
	mux.Handle("GET /v1/tenant/contracts/instances/{uuid}/pdf", tRead(h.DownloadPDF))
}
