package usecase

import (
	"time"

	"github.com/google/uuid"
)

type Line struct {
	UUID        uuid.UUID `json:"uuid"`
	ProductUUID uuid.UUID `json:"product_uuid"`
	Name        string    `json:"name"`
	UnitPrice   string    `json:"unit_price"`
	Qty         string    `json:"qty"`
	VatRate     string    `json:"vat_rate"`
	LineTotal   string    `json:"line_total"`
	Currency    string    `json:"currency"`
	SortOrder   int32     `json:"sort_order"`
}

type Sale struct {
	UUID                   uuid.UUID  `json:"uuid"`
	CustomerUUID           *uuid.UUID `json:"customer_uuid,omitempty"`
	CustomerName           string     `json:"customer_name"`
	CustomerPhone          string     `json:"customer_phone"`
	Status                 string     `json:"status"`
	Currency               string     `json:"currency"`
	TotalAmount            string     `json:"total_amount"`
	Method                 string     `json:"method"`
	FinanceAccountUUID     *uuid.UUID `json:"finance_account_uuid,omitempty"`
	FinanceAccountName     *string    `json:"finance_account_name,omitempty"`
	FinanceTransactionUUID *uuid.UUID `json:"finance_transaction_uuid,omitempty"`
	CariEntryUUID          *uuid.UUID `json:"cari_entry_uuid,omitempty"`
	Notes                  string     `json:"notes"`
	SoldAt                 time.Time  `json:"sold_at"`
	CreatedAt              time.Time  `json:"created_at"`
	VoidedAt               *time.Time `json:"voided_at,omitempty"`
}

type SaleDetail struct {
	Sale
	Lines []Line `json:"lines"`
}

type Summary struct {
	SaleCount int64  `json:"sale_count"`
	CardTotal string `json:"card_total"`
	CariTotal string `json:"cari_total"`
	NetTotal  string `json:"net_total"`
	PaidTotal string `json:"paid_total"`
	Date      string `json:"date"`
}

type ListFilters struct {
	Q        string
	Status   string
	DateFrom string
	DateTo   string
	Sort     string
	// Location sets the day boundaries of DateFrom/DateTo (nil = server local
	// time, the HTTP API default).
	Location *time.Location
}

type CreateLineInput struct {
	ProductUUID uuid.UUID `json:"product_uuid"`
	UnitPrice   *string   `json:"unit_price"`
	Qty         *string   `json:"qty"`
}

type CreateInput struct {
	CustomerUUID       *uuid.UUID        `json:"customer_uuid"`
	Notes              string            `json:"notes"`
	Method             string            `json:"method"` // cash | card | cari
	FinanceAccountUUID *uuid.UUID        `json:"finance_account_uuid"`
	Currency           string            `json:"currency"`
	SoldAt             *string           `json:"sold_at"`
	Lines              []CreateLineInput `json:"lines"`
}
