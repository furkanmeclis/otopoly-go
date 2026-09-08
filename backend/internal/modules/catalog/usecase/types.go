package usecase

import (
	"time"

	"github.com/google/uuid"
)

type Category struct {
	UUID       uuid.UUID  `json:"uuid"`
	Name       string     `json:"name"`
	Kind       string     `json:"kind"`
	ParentUUID *uuid.UUID `json:"parent_uuid,omitempty"`
	ParentName *string    `json:"parent_name,omitempty"`
	SortOrder  int32      `json:"sort_order"`
	IsActive   bool       `json:"is_active"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type Product struct {
	UUID           uuid.UUID  `json:"uuid"`
	CategoryUUID   *uuid.UUID `json:"category_uuid,omitempty"`
	CategoryName   *string    `json:"category_name,omitempty"`
	Name           string     `json:"name"`
	SKU            *string    `json:"sku,omitempty"`
	Barcode        *string    `json:"barcode,omitempty"`
	Unit           string     `json:"unit"`
	CostPrice      string     `json:"cost_price"`
	SalePrice      string     `json:"sale_price"`
	VATRate        string     `json:"vat_rate"`
	Currency       string     `json:"currency"`
	StockQuantity  string     `json:"stock_quantity"`
	MinStockAlert  string     `json:"min_stock_alert"`
	TrackStock     bool       `json:"track_stock"`
	IsActive       bool       `json:"is_active"`
	Description    string     `json:"description"`
	StockStatus    string     `json:"stock_status"` // "in_stock", "low_stock", "out_of_stock", "untracked"
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type ServiceItem struct {
	UUID            uuid.UUID  `json:"uuid"`
	CategoryUUID    *uuid.UUID `json:"category_uuid,omitempty"`
	CategoryName    *string    `json:"category_name,omitempty"`
	Name            string     `json:"name"`
	Code            *string    `json:"code,omitempty"`
	DurationMinutes int32      `json:"duration_minutes"`
	Price           string     `json:"price"`
	VATRate         string     `json:"vat_rate"`
	Currency        string     `json:"currency"`
	IsActive        bool       `json:"is_active"`
	Description     string     `json:"description"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type CatalogSummary struct {
	TotalProducts       int64  `json:"total_products"`
	ActiveProducts      int64  `json:"active_products"`
	LowStockProducts    int64  `json:"low_stock_products"`
	OutOfStockProducts  int64  `json:"out_of_stock_products"`
	TotalStockCostValue string `json:"total_stock_cost_value"`
	TotalStockSaleValue string `json:"total_stock_sale_value"`
	TotalServices       int64  `json:"total_services"`
	ActiveServices      int64  `json:"active_services"`
	TotalCategories     int64  `json:"total_categories"`
}

type ProductFilters struct {
	CategoryUUID *uuid.UUID
	StockStatus  string // "in_stock", "low_stock", "out_of_stock"
	Unit         string
	IsActive     *bool
	TrackStock   *bool
	Q            string
	SortBy       string
}

type ServiceFilters struct {
	CategoryUUID *uuid.UUID
	IsActive     *bool
	Q            string
	SortBy       string
}

type CategoryFilters struct {
	Kind     string // "product", "service"
	IsActive *bool
	Q        string
}

type CreateProductInput struct {
	CategoryUUID  *uuid.UUID `json:"category_uuid"`
	Name          string     `json:"name"`
	SKU           *string    `json:"sku"`
	Barcode       *string    `json:"barcode"`
	Unit          string     `json:"unit"`
	CostPrice     string     `json:"cost_price"`
	SalePrice     string     `json:"sale_price"`
	VATRate       string     `json:"vat_rate"`
	Currency      string     `json:"currency"`
	StockQuantity string     `json:"stock_quantity"`
	MinStockAlert string     `json:"min_stock_alert"`
	TrackStock    *bool      `json:"track_stock"`
	IsActive      *bool      `json:"is_active"`
	Description   string     `json:"description"`
}

type UpdateProductInput struct {
	CategoryUUID  *uuid.UUID `json:"category_uuid"`
	SetCategory   bool       `json:"set_category"`
	Name          *string    `json:"name"`
	SKU           *string    `json:"sku"`
	SetSKU        bool       `json:"set_sku"`
	Barcode       *string    `json:"barcode"`
	SetBarcode    bool       `json:"set_barcode"`
	Unit          *string    `json:"unit"`
	CostPrice     *string    `json:"cost_price"`
	SalePrice     *string    `json:"sale_price"`
	VATRate       *string    `json:"vat_rate"`
	Currency      *string    `json:"currency"`
	StockQuantity *string    `json:"stock_quantity"`
	MinStockAlert *string    `json:"min_stock_alert"`
	TrackStock    *bool      `json:"track_stock"`
	IsActive      *bool      `json:"is_active"`
	Description   *string    `json:"description"`
}

type AdjustStockInput struct {
	Delta       string `json:"delta"`
	Reason      string `json:"reason"`
	Description string `json:"description"`
}

type CreateServiceInput struct {
	CategoryUUID    *uuid.UUID `json:"category_uuid"`
	Name            string     `json:"name"`
	Code            *string    `json:"code"`
	DurationMinutes int32      `json:"duration_minutes"`
	Price           string     `json:"price"`
	VATRate         string     `json:"vat_rate"`
	Currency        string     `json:"currency"`
	IsActive        *bool      `json:"is_active"`
	Description     string     `json:"description"`
}

type UpdateServiceInput struct {
	CategoryUUID    *uuid.UUID `json:"category_uuid"`
	SetCategory     bool       `json:"set_category"`
	Name            *string    `json:"name"`
	Code            *string    `json:"code"`
	SetCode         bool       `json:"set_code"`
	DurationMinutes *int32     `json:"duration_minutes"`
	Price           *string    `json:"price"`
	VATRate         *string    `json:"vat_rate"`
	Currency        *string    `json:"currency"`
	IsActive        *bool      `json:"is_active"`
	Description     *string    `json:"description"`
}

type CreateCategoryInput struct {
	ParentUUID *uuid.UUID `json:"parent_uuid"`
	Name       string     `json:"name"`
	Kind       string     `json:"kind"`
	SortOrder  int32      `json:"sort_order"`
	IsActive   *bool      `json:"is_active"`
}

type UpdateCategoryInput struct {
	ParentUUID *uuid.UUID `json:"parent_uuid"`
	SetParent  bool       `json:"set_parent"`
	Name       *string    `json:"name"`
	Kind       *string    `json:"kind"`
	SortOrder  *int32     `json:"sort_order"`
	IsActive   *bool      `json:"is_active"`
}
