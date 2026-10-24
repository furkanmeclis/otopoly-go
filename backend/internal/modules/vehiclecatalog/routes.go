// Package vehiclecatalog is the platform vehicle catalog (TSB kasko list):
// display brand / TSB brand / model / type / model-year kasko values,
// imported monthly. Same engine as Rentopia (TEC-997).
package vehiclecatalog

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	cataloghandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// RegisterRoutes mounts /v1/platform/vehicle-catalog/* and the read-only
// /v1/tenant/vehicle-catalog/* lookups for organization members.
func RegisterRoutes(
	mux *http.ServeMux,
	h *cataloghandler.Handler,
	tokens *jwt.Manager,
	loader middleware.IdentityLoader,
	resolver middleware.OrganizationResolver,
) {
	authn := middleware.Authenticate(tokens, loader)
	read := middleware.RequirePermission(rbac.PermPlatformVehicleBrandsRead)
	write := middleware.RequirePermission(rbac.PermPlatformVehicleBrandsWrite)
	route := func(pattern string, fn http.HandlerFunc, mws ...func(http.Handler) http.Handler) {
		mux.Handle(pattern, middleware.Chain(fn, append([]func(http.Handler) http.Handler{authn}, mws...)...))
	}

	// /meta before /{uuid}.
	route("GET /v1/platform/vehicle-catalog/brands/meta", h.BrandsMeta, read)
	route("GET /v1/platform/vehicle-catalog/brands", h.ListBrands, read)
	route("GET /v1/platform/vehicle-catalog/brands/{uuid}", h.GetBrand, read)
	route("PATCH /v1/platform/vehicle-catalog/brands/{uuid}", h.PatchBrand, write)

	route("GET /v1/platform/vehicle-catalog/display-brands/meta", h.DisplayBrandsMeta, read)
	route("GET /v1/platform/vehicle-catalog/display-brands", h.ListDisplayBrands, read)
	route("GET /v1/platform/vehicle-catalog/display-brands/{uuid}", h.GetDisplayBrand, read)
	route("PATCH /v1/platform/vehicle-catalog/display-brands/{uuid}", h.PatchDisplayBrand, write)
	route("POST /v1/platform/vehicle-catalog/display-brands/{uuid}/merge", h.MergeDisplayBrand, write)
	route("POST /v1/platform/vehicle-catalog/display-brands/{uuid}/unmerge", h.UnmergeDisplayBrand, write)
	route("PUT /v1/platform/vehicle-catalog/display-brands/{uuid}/logo", h.UploadDisplayBrandLogo, write)
	route("DELETE /v1/platform/vehicle-catalog/display-brands/{uuid}/logo", h.DeleteDisplayBrandLogo, write)
	// Any signed-in user: tenant vehicle forms show the logo too.
	route("GET /v1/platform/vehicle-catalog/display-brands/{uuid}/logo", h.StreamDisplayBrandLogo)

	route("GET /v1/platform/vehicle-catalog/models/meta", h.ModelsMeta, read)
	route("POST /v1/platform/vehicle-catalog/models/bulk-rules", h.BulkModelRules, write)
	route("GET /v1/platform/vehicle-catalog/models", h.ListModels, read)
	route("POST /v1/platform/vehicle-catalog/models", h.CreateModel, write)
	route("GET /v1/platform/vehicle-catalog/models/{uuid}", h.GetModel, read)
	route("PATCH /v1/platform/vehicle-catalog/models/{uuid}", h.PatchModel, write)
	route("POST /v1/platform/vehicle-catalog/models/{uuid}/merge", h.MergeModel, write)

	route("GET /v1/platform/vehicle-catalog/types/meta", h.TypesMeta, read)
	route("GET /v1/platform/vehicle-catalog/types", h.ListTypes, read)
	route("GET /v1/platform/vehicle-catalog/types/{uuid}", h.GetType, read)
	route("PATCH /v1/platform/vehicle-catalog/types/{uuid}", h.PatchType, write)

	// Brand logo sync (motomarks-mirror). /brand-logos/* before /{uuid} routes.
	route("GET /v1/platform/vehicle-catalog/brand-logos/settings", h.GetBrandLogoSettings, read)
	route("PATCH /v1/platform/vehicle-catalog/brand-logos/settings", h.PatchBrandLogoSettings, write)
	route("POST /v1/platform/vehicle-catalog/brand-logos/test", h.TestBrandLogoConnection, write)
	route("POST /v1/platform/vehicle-catalog/brand-logos/sync", h.RequestBrandLogoSync, write)
	route("GET /v1/platform/vehicle-catalog/brand-logos/runs", h.ListBrandLogoSyncRuns, read)
	route("GET /v1/platform/vehicle-catalog/brand-logos/unmatched", h.ListUnmatchedDisplayBrands, read)
	route("GET /v1/platform/vehicle-catalog/brand-logos/sources", h.SearchBrandLogoSources, read)
	route("GET /v1/platform/vehicle-catalog/brand-logos/sources/{id}/logo", h.StreamSourceLogo, read)
	route("POST /v1/platform/vehicle-catalog/display-brands/{uuid}/motomarks", h.SetDisplayBrandMotomarks, write)

	route("GET /v1/platform/vehicle-catalog/imports/meta", h.ImportsMeta, read)
	route("GET /v1/platform/vehicle-catalog/imports", h.ListImports, read)
	route("POST /v1/platform/vehicle-catalog/imports", h.UploadImport, write)
	route("GET /v1/platform/vehicle-catalog/imports/{uuid}", h.GetImport, read)
	route("POST /v1/platform/vehicle-catalog/imports/{uuid}/apply", h.ApplyImport, write)

	// Public: legacy vehicle brand logo (customer vehicles, job board, quotes).
	mux.HandleFunc("GET /v1/public/vehicle-brands/logo/{uuid}", h.StreamVehicleBrandLogo)

	org := middleware.RequireOrganizationResolver(tokens, resolver)
	route("GET /v1/tenant/vehicle-catalog/brands", h.TenantBrands, org)
	route("GET /v1/tenant/vehicle-catalog/models", h.TenantModels, org)
	route("GET /v1/tenant/vehicle-catalog/types", h.TenantTypes, org)
}
