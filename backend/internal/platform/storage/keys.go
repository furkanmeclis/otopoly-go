package storage

import (
	"fmt"

	"github.com/google/uuid"
)

// AppLogoObjectKey builds app/branding/logo.{ext} for system letterhead.
func AppLogoObjectKey(ext string) string {
	return fmt.Sprintf("app/branding/logo.%s", trimExt(ext))
}

// ExportObjectKey builds exports/{jobUUID}/export.{ext}.
func ExportObjectKey(jobUUID, ext string) string {
	return fmt.Sprintf("exports/%s/export.%s", jobUUID, trimExt(ext))
}

// ImportSourceObjectKey builds imports/{jobUUID}/source.{ext}.
func ImportSourceObjectKey(jobUUID, ext string) string {
	return fmt.Sprintf("imports/%s/source.%s", jobUUID, trimExt(ext))
}

// VehicleBrandLogoObjectKey builds vehicle-brands/{uuid}/logo.{ext}.
func VehicleBrandLogoObjectKey(brandUUID uuid.UUID, ext string) string {
	return fmt.Sprintf("vehicle-brands/%s/logo.%s", brandUUID.String(), trimExt(ext))
}

// ContractExecutedPDFObjectKey builds contracts/{org}/{instance}/executed.pdf.
func ContractExecutedPDFObjectKey(orgUUID, instanceUUID uuid.UUID) string {
	return fmt.Sprintf("contracts/%s/%s/executed.pdf", orgUUID.String(), instanceUUID.String())
}

// ContractSignatureObjectKey builds contracts/{org}/{instance}/signatures/{signer}.png.
func ContractSignatureObjectKey(orgUUID, instanceUUID, signerUUID uuid.UUID) string {
	return fmt.Sprintf(
		"contracts/%s/%s/signatures/%s.png",
		orgUUID.String(),
		instanceUUID.String(),
		signerUUID.String(),
	)
}

// ContractMediaObjectKey builds contracts/{org}/{instance}/media/{media}.{ext}.
func ContractMediaObjectKey(orgUUID, instanceUUID, mediaUUID uuid.UUID, ext string) string {
	return fmt.Sprintf(
		"contracts/%s/%s/media/%s.%s",
		orgUUID.String(),
		instanceUUID.String(),
		mediaUUID.String(),
		trimExt(ext),
	)
}

func trimExt(ext string) string {
	for len(ext) > 0 && ext[0] == '.' {
		ext = ext[1:]
	}
	return ext
}

// CatalogImportObjectKey builds catalog/imports/{importUUID}/source.{ext}
// for the uploaded TSB kasko list of a vehicle catalog import.
func CatalogImportObjectKey(importUUID, ext string) string {
	return fmt.Sprintf("catalog/imports/%s/source.%s", importUUID, trimExt(ext))
}

// CatalogBrandLogoObjectKey builds catalog/brands/{displayBrandUUID}/logo.{ext}
// for catalog display brand logos (served through the API, never by URL).
func CatalogBrandLogoObjectKey(displayBrandUUID, ext string) string {
	return fmt.Sprintf("catalog/brands/%s/logo.%s", displayBrandUUID, trimExt(ext))
}

// BrandLogoObjectKey builds brand-logos/{motomarksID}/{variant}-md.{ext} for
// a logo variant (badge, wordmark, full) copied from the brand logo mirror.
func BrandLogoObjectKey(motomarksID, variant, ext string) string {
	return fmt.Sprintf("brand-logos/%s/%s-md.%s", motomarksID, variant, trimExt(ext))
}
