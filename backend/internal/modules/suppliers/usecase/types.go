package usecase

import (
	"time"

	"github.com/google/uuid"
)

type Supplier struct {
	UUID      uuid.UUID `json:"uuid"`
	Name      string    `json:"name"`
	Phone     string    `json:"phone"`
	Email     string    `json:"email"`
	TaxID     string    `json:"tax_id"`
	Notes     string    `json:"notes"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Filters struct {
	Q        string
	IsActive *bool
	Sort     string
}

type CreateInput struct {
	Name     string `json:"name"`
	Phone    string `json:"phone"`
	Email    string `json:"email"`
	TaxID    string `json:"tax_id"`
	Notes    string `json:"notes"`
	IsActive *bool  `json:"is_active"`
}

type PatchInput struct {
	Name     *string `json:"name"`
	Phone    *string `json:"phone"`
	Email    *string `json:"email"`
	TaxID    *string `json:"tax_id"`
	Notes    *string `json:"notes"`
	IsActive *bool   `json:"is_active"`
}
