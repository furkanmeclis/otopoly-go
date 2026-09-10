package usecase

import (
	"time"

	"github.com/google/uuid"
)

type Customer struct {
	UUID             uuid.UUID  `json:"uuid"`
	Name             string     `json:"name"`
	Phone            string     `json:"phone"`
	Email            string     `json:"email"`
	Kind             string     `json:"kind"`
	Notes            string     `json:"notes"`
	IsActive         bool       `json:"is_active"`
	VehicleCount     int64      `json:"vehicle_count"`
	CariAccountUUID  *uuid.UUID `json:"cari_account_uuid,omitempty"`
	CariBalance      *string    `json:"cari_balance,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type Vehicle struct {
	UUID      uuid.UUID `json:"uuid"`
	Plate     string    `json:"plate"`
	BrandUUID uuid.UUID `json:"brand_uuid"`
	BrandName string    `json:"brand_name"`
	LogoURL   *string   `json:"logo_url,omitempty"`
	ModelUUID uuid.UUID `json:"model_uuid"`
	ModelName string    `json:"model_name"`
	Year      int       `json:"year"`
	CreatedAt time.Time `json:"created_at"`
}

type CustomerDetail struct {
	Customer
	Vehicles []Vehicle `json:"vehicles"`
}

type Filters struct {
	Q        string
	Kind     string
	IsActive *bool
	Sort     string
}

type CreateInput struct {
	Name     string              `json:"name"`
	Phone    string              `json:"phone"`
	Email    string              `json:"email"`
	Kind     string              `json:"kind"`
	Notes    string              `json:"notes"`
	IsActive *bool               `json:"is_active"`
	Vehicle  *CreateVehicleInput `json:"vehicle"`
}

type PatchInput struct {
	Name     *string `json:"name"`
	Phone    *string `json:"phone"`
	Email    *string `json:"email"`
	Kind     *string `json:"kind"`
	Notes    *string `json:"notes"`
	IsActive *bool   `json:"is_active"`
}

type CreateVehicleInput struct {
	Plate     string    `json:"plate"`
	ModelUUID uuid.UUID `json:"model_uuid"`
	Year      int       `json:"year"`
}
