package usecase

import (
	"time"

	"github.com/google/uuid"
)

type Line struct {
	UUID        uuid.UUID `json:"uuid"`
	ProductUUID uuid.UUID `json:"product_uuid"`
	Name        string    `json:"name"`
	UnitCost    string    `json:"unit_cost"`
	Qty         string    `json:"qty"`
	LineTotal   string    `json:"line_total"`
	Currency    string    `json:"currency"`
	SortOrder   int32     `json:"sort_order"`
}

type Purchase struct {
	UUID                   uuid.UUID  `json:"uuid"`
	SupplierUUID           uuid.UUID  `json:"supplier_uuid"`
	SupplierName           string     `json:"supplier_name"`
	Status                 string     `json:"status"`
	Currency               string     `json:"currency"`
	TotalAmount            string     `json:"total_amount"`
	Method                 string     `json:"method"`
	FinanceAccountUUID     *uuid.UUID `json:"finance_account_uuid,omitempty"`
	FinanceAccountName     *string    `json:"finance_account_name,omitempty"`
	FinanceTransactionUUID *uuid.UUID `json:"finance_transaction_uuid,omitempty"`
	Notes                  string     `json:"notes"`
	PurchasedAt            time.Time  `json:"purchased_at"`
	CreatedAt              time.Time  `json:"created_at"`
	VoidedAt               *time.Time `json:"voided_at,omitempty"`
}

type PurchaseDetail struct {
	Purchase
	Lines []Line `json:"lines"`
}

type ListFilters struct {
	Q        string
	Status   string
	DateFrom string
	DateTo   string
	Sort     string
}

type CreateLineInput struct {
	ProductUUID uuid.UUID `json:"product_uuid"`
	UnitCost    *string   `json:"unit_cost"`
	Qty         *string   `json:"qty"`
}

type CreateInput struct {
	SupplierUUID       uuid.UUID         `json:"supplier_uuid"`
	Notes              string            `json:"notes"`
	Method             string            `json:"method"` // cash | card
	FinanceAccountUUID uuid.UUID         `json:"finance_account_uuid"`
	Currency           string            `json:"currency"`
	PurchasedAt        *string           `json:"purchased_at"`
	Lines              []CreateLineInput `json:"lines"`
}
