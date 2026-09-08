package usecase

import (
	"time"

	"github.com/google/uuid"
)

type Brand struct {
	UUID       uuid.UUID `json:"uuid"`
	Name       string    `json:"name"`
	LogoURL    *string   `json:"logo_url,omitempty"`
	IsActive   bool      `json:"is_active"`
	ModelCount int64     `json:"model_count"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type Model struct {
	UUID      uuid.UUID `json:"uuid"`
	Name      string    `json:"name"`
	IsActive  bool      `json:"is_active"`
	Years     []int     `json:"years"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type BrandDetail struct {
	Brand
	Models []Model `json:"models"`
}

type BrandFilters struct {
	Q        string
	IsActive *bool
	Sort     string
}

type CreateBrandInput struct {
	Name     string `json:"name"`
	IsActive *bool  `json:"is_active"`
}

type PatchBrandInput struct {
	Name     *string `json:"name"`
	IsActive *bool   `json:"is_active"`
}

type CreateModelInput struct {
	Name     string `json:"name"`
	IsActive *bool  `json:"is_active"`
	Years    []int  `json:"years"`
}

type AddYearInput struct {
	Year int `json:"year"`
}

type CatalogOption struct {
	BrandUUID uuid.UUID `json:"brand_uuid"`
	BrandName string    `json:"brand_name"`
	LogoURL   *string   `json:"logo_url,omitempty"`
	ModelUUID uuid.UUID `json:"model_uuid"`
	ModelName string    `json:"model_name"`
	Year      int       `json:"year"`
}

type ImportResult struct {
	BrandsCreated int `json:"brands_created"`
	BrandsUpdated int `json:"brands_updated"`
	ModelsCreated int `json:"models_created"`
	YearsAdded    int `json:"years_added"`
}
