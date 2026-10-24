package usecase

import "github.com/google/uuid"

// CatalogOption is one "brand model · year" row of the tenant vehicle picker.
type CatalogOption struct {
	BrandUUID uuid.UUID `json:"brand_uuid"`
	BrandName string    `json:"brand_name"`
	LogoURL   *string   `json:"logo_url,omitempty"`
	ModelUUID uuid.UUID `json:"model_uuid"`
	ModelName string    `json:"model_name"`
	Year      int       `json:"year"`
}
