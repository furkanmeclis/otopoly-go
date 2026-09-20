package usecase

import (
	"time"

	"github.com/google/uuid"
)

type Account struct {
	UUID          uuid.UUID `json:"uuid"`
	CustomerUUID  uuid.UUID `json:"customer_uuid"`
	CustomerName  string    `json:"customer_name"`
	CustomerPhone string    `json:"customer_phone"`
	CustomerKind  string    `json:"customer_kind,omitempty"`
	Currency      string    `json:"currency"`
	Balance       string    `json:"balance"`
	IsActive      bool      `json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type AccountDetail struct {
	Account
	CustomerEmail     string `json:"customer_email"`
	CustomerTaxID     string `json:"customer_tax_id,omitempty"`
	CustomerTaxOffice string `json:"customer_tax_office,omitempty"`
	CustomerIsActive  bool   `json:"customer_is_active"`
}

type Entry struct {
	UUID                   uuid.UUID  `json:"uuid"`
	AccountUUID            uuid.UUID  `json:"account_uuid"`
	Type                   string     `json:"type"`
	Status                 string     `json:"status"`
	Amount                 string     `json:"amount"`
	BalanceAfter           string     `json:"balance_after"`
	EntryDate              string     `json:"entry_date"`
	Description            string     `json:"description"`
	ReferenceNo            *string    `json:"reference_no,omitempty"`
	PaymentMethod          *string    `json:"payment_method,omitempty"`
	FinanceAccountUUID     *uuid.UUID `json:"finance_account_uuid,omitempty"`
	FinanceAccountName     *string    `json:"finance_account_name,omitempty"`
	FinanceTransactionUUID *uuid.UUID `json:"finance_transaction_uuid,omitempty"`
	CreatedAt              time.Time  `json:"created_at"`
	VoidedAt               *time.Time `json:"voided_at,omitempty"`
}

type Summary struct {
	TotalReceivable  string `json:"total_receivable"`
	AccountCount     int64  `json:"account_count"`
	WithBalanceCount int64  `json:"with_balance_count"`
}

type ListFilters struct {
	Q          string
	IsActive   *bool
	HasBalance *bool
	Sort       string
}

type EntryFilters struct {
	Q        string
	Type     string
	Status   string
	DateFrom string
	DateTo   string
}

type ChargeInput struct {
	Amount      string  `json:"amount"`
	EntryDate   string  `json:"entry_date"`
	Description string  `json:"description"`
	ReferenceNo *string `json:"reference_no"`
}

type PaymentInput struct {
	Amount             string    `json:"amount"`
	EntryDate          string    `json:"entry_date"`
	Description        string    `json:"description"`
	ReferenceNo        *string   `json:"reference_no"`
	PaymentMethod      string    `json:"payment_method"`
	FinanceAccountUUID uuid.UUID `json:"finance_account_uuid"`
}

type AdjustmentInput struct {
	Amount      string  `json:"amount"`
	Direction   string  `json:"direction"` // increase | decrease
	EntryDate   string  `json:"entry_date"`
	Description string  `json:"description"`
	ReferenceNo *string `json:"reference_no"`
}
