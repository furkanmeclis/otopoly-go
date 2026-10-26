package usecase

import (
	"time"

	"github.com/google/uuid"
)

// MonthPoint is one month of a 12-month trend (month = first day, UTC).
type MonthPoint struct {
	Month   string `json:"month"` // YYYY-MM
	Count   int64  `json:"count"`
	Qty     string `json:"qty,omitempty"`
	Amount  string `json:"amount"`
	Amount2 string `json:"amount_secondary,omitempty"`
}

// ============================================================================
// Product
// ============================================================================

// ProductSummary is the 360° view of a product. Blocks the caller may not
// read (no sales / purchases / jobs permission) are omitted (null).
type ProductSummary struct {
	ProductUUID uuid.UUID `json:"product_uuid"`
	Currency    string    `json:"currency"`
	Stock       struct {
		Tracked     bool   `json:"tracked"`
		Quantity    string `json:"quantity"`
		MinAlert    string `json:"min_alert"`
		Status      string `json:"status"`
		CostValue   string `json:"cost_value"`
		SaleValue   string `json:"sale_value"`
		CoverageQty string `json:"coverage_qty"` // quantity - min_alert
	} `json:"stock"`
	Pricing struct {
		CostPrice     string  `json:"cost_price"`
		SalePrice     string  `json:"sale_price"`
		UnitMargin    string  `json:"unit_margin"`
		MarginPercent float64 `json:"margin_percent"`
	} `json:"pricing"`
	Sales     *ProductSalesBlock    `json:"sales"`
	Purchases *ProductPurchaseBlock `json:"purchases"`
	Jobs      *ProductJobsBlock     `json:"jobs"`
}

type ProductSalesBlock struct {
	SaleCount     int64        `json:"sale_count"`
	SoldQty       string       `json:"sold_qty"`
	Revenue       string       `json:"revenue"`
	LastSoldAt    *time.Time   `json:"last_sold_at"`
	LastSalePrice *string      `json:"last_sale_price"`
	Monthly       []MonthPoint `json:"monthly"`
}

type ProductPurchaseBlock struct {
	PurchaseCount    int64      `json:"purchase_count"`
	PurchasedQty     string     `json:"purchased_qty"`
	Spend            string     `json:"spend"`
	AvgUnitCost      string     `json:"avg_unit_cost"`
	LastPurchasedAt  *time.Time `json:"last_purchased_at"`
	LastPurchaseCost *string    `json:"last_purchase_cost"`
}

type ProductJobsBlock struct {
	LineJobCount        int64      `json:"line_job_count"`
	LineQty             string     `json:"line_qty"`
	LineRevenue         string     `json:"line_revenue"`
	ConsumptionJobCount int64      `json:"consumption_job_count"`
	ConsumedQty         string     `json:"consumed_qty"`
	LastConsumedAt      *time.Time `json:"last_consumed_at"`
}

// ProductMovement is one row of the product's stock ledger: purchase (+),
// sale (-) or job consumption (-).
type ProductMovement struct {
	Kind        string     `json:"kind"` // purchase | sale | job
	RefUUID     uuid.UUID  `json:"ref_uuid"`
	Status      string     `json:"status"`
	OccurredAt  time.Time  `json:"occurred_at"`
	PartyName   string     `json:"party_name"`
	PartyUUID   *uuid.UUID `json:"party_uuid"`
	Plate       string     `json:"plate,omitempty"`
	ServiceName string     `json:"service_name,omitempty"`
	Qty         string     `json:"qty"`        // signed: + into stock, - out of stock
	UnitPrice   string     `json:"unit_price"` // cost for purchases / jobs, price for sales
	Total       string     `json:"total"`
	Currency    string     `json:"currency"`
	// Effective is false for voided documents and reverted consumptions.
	Effective bool `json:"effective"`
}

// ============================================================================
// Service
// ============================================================================

type ServiceSummary struct {
	ServiceUUID uuid.UUID `json:"service_uuid"`
	Currency    string    `json:"currency"`
	Pricing     struct {
		Price           string  `json:"price"`
		RecipeCost      string  `json:"recipe_cost"`
		RecipeItemCount int     `json:"recipe_item_count"`
		UnitMargin      string  `json:"unit_margin"`
		MarginPercent   float64 `json:"margin_percent"`
		DurationMinutes int32   `json:"duration_minutes"`
	} `json:"pricing"`
	Usage *ServiceUsageBlock `json:"usage"`
}

type ServiceUsageBlock struct {
	JobCount      int64        `json:"job_count"`
	LineCount     int64        `json:"line_count"`
	CustomerCount int64        `json:"customer_count"`
	Qty           string       `json:"qty"`
	Revenue       string       `json:"revenue"`
	AvgUnitPrice  string       `json:"avg_unit_price"`
	AvgJobMinutes float64      `json:"avg_job_minutes"`
	FirstUsedAt   *time.Time   `json:"first_used_at"`
	LastUsedAt    *time.Time   `json:"last_used_at"`
	Monthly       []MonthPoint `json:"monthly"`
}

// ServiceJob is a job that has this service on a line.
type ServiceJob struct {
	UUID          uuid.UUID  `json:"uuid"`
	Status        string     `json:"status"`
	PaymentStatus string     `json:"payment_status"`
	StartedAt     time.Time  `json:"started_at"`
	CompletedAt   *time.Time `json:"completed_at"`
	Plate         string     `json:"plate"`
	VehicleLabel  string     `json:"vehicle_label"`
	CustomerUUID  uuid.UUID  `json:"customer_uuid"`
	CustomerName  string     `json:"customer_name"`
	BrandUUID     uuid.UUID  `json:"brand_uuid"`
	BrandName     string     `json:"brand_name"`
	BrandLogoURL  *string    `json:"brand_logo_url"`
	Qty           string     `json:"qty"`
	LineTotal     string     `json:"line_total"`
	Currency      string     `json:"currency"`
}

// ============================================================================
// Customer
// ============================================================================

type CustomerSummary struct {
	CustomerUUID uuid.UUID `json:"customer_uuid"`
	VehicleCount int       `json:"vehicle_count"`
	// TotalSpend = jobs.spend + sales.spend over the blocks the caller can read.
	TotalSpend  string                `json:"total_spend"`
	LastVisitAt *time.Time            `json:"last_visit_at"`
	Jobs        *CustomerJobsBlock    `json:"jobs"`
	Sales       *CustomerSalesBlock   `json:"sales"`
	Quotes      *CustomerQuotesBlock  `json:"quotes"`
	Leads       *CustomerLeadsBlock   `json:"leads"`
	Monthly     []MonthPoint          `json:"monthly"`
	TopServices []CustomerTopService  `json:"top_services"`
	Vehicles    []CustomerVehicleStat `json:"vehicles"`
	RecentSales []CustomerSale        `json:"recent_sales"`
}

type CustomerJobsBlock struct {
	JobCount       int64      `json:"job_count"`
	OpenJobCount   int64      `json:"open_job_count"`
	UnpaidJobCount int64      `json:"unpaid_job_count"`
	Spend          string     `json:"spend"`
	UnpaidAmount   string     `json:"unpaid_amount"`
	FirstVisitAt   *time.Time `json:"first_visit_at"`
	LastVisitAt    *time.Time `json:"last_visit_at"`
}

type CustomerSalesBlock struct {
	SaleCount  int64      `json:"sale_count"`
	Spend      string     `json:"spend"`
	LastSoldAt *time.Time `json:"last_sold_at"`
}

type CustomerQuotesBlock struct {
	QuoteCount         int64 `json:"quote_count"`
	OpenQuoteCount     int64 `json:"open_quote_count"`
	AcceptedQuoteCount int64 `json:"accepted_quote_count"`
}

type CustomerLeadsBlock struct {
	LeadCount     int64 `json:"lead_count"`
	OpenLeadCount int64 `json:"open_lead_count"`
}

type CustomerTopService struct {
	ServiceUUID *uuid.UUID `json:"service_uuid"`
	Name        string     `json:"name"`
	JobCount    int64      `json:"job_count"`
	Revenue     string     `json:"revenue"`
	LastUsedAt  *time.Time `json:"last_used_at"`
}

type CustomerVehicleStat struct {
	VehicleUUID uuid.UUID  `json:"vehicle_uuid"`
	JobCount    int64      `json:"job_count"`
	Spend       string     `json:"spend"`
	LastVisitAt *time.Time `json:"last_visit_at"`
}

type CustomerSale struct {
	UUID        uuid.UUID `json:"uuid"`
	Status      string    `json:"status"`
	Method      string    `json:"method"`
	TotalAmount string    `json:"total_amount"`
	Currency    string    `json:"currency"`
	SoldAt      time.Time `json:"sold_at"`
	LineCount   int64     `json:"line_count"`
}

// ============================================================================
// Supplier
// ============================================================================

type SupplierSummary struct {
	SupplierUUID uuid.UUID              `json:"supplier_uuid"`
	Purchases    *SupplierPurchaseBlock `json:"purchases"`
}

type SupplierPurchaseBlock struct {
	PurchaseCount    int64                `json:"purchase_count"`
	Spend            string               `json:"spend"`
	AvgPurchase      string               `json:"avg_purchase"`
	ProductCount     int64                `json:"product_count"`
	FirstPurchasedAt *time.Time           `json:"first_purchased_at"`
	LastPurchasedAt  *time.Time           `json:"last_purchased_at"`
	Monthly          []MonthPoint         `json:"monthly"`
	TopProducts      []SupplierTopProduct `json:"top_products"`
	Recent           []SupplierPurchase   `json:"recent"`
}

type SupplierTopProduct struct {
	ProductUUID     uuid.UUID  `json:"product_uuid"`
	Name            string     `json:"name"`
	Unit            string     `json:"unit"`
	Qty             string     `json:"qty"`
	Spend           string     `json:"spend"`
	LastPurchasedAt *time.Time `json:"last_purchased_at"`
}

type SupplierPurchase struct {
	UUID        uuid.UUID `json:"uuid"`
	Status      string    `json:"status"`
	Method      string    `json:"method"`
	TotalAmount string    `json:"total_amount"`
	Currency    string    `json:"currency"`
	PurchasedAt time.Time `json:"purchased_at"`
	LineCount   int64     `json:"line_count"`
}
