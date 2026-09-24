package usecase

import (
	"time"

	"github.com/google/uuid"
)

type Line struct {
	UUID        uuid.UUID  `json:"uuid"`
	LineType    string     `json:"line_type"`
	ServiceUUID *uuid.UUID `json:"service_uuid,omitempty"`
	Name        string     `json:"name"`
	UnitPrice   string     `json:"unit_price"`
	Qty         string     `json:"qty"`
	VatRate     string     `json:"vat_rate"`
	LineTotal   string     `json:"line_total"`
	Currency    string     `json:"currency"`
	SortOrder   int32      `json:"sort_order"`
}

type Payment struct {
	UUID                   uuid.UUID  `json:"uuid"`
	Method                 string     `json:"method"`
	Amount                 string     `json:"amount"`
	Currency               string     `json:"currency"`
	Status                 string     `json:"status"`
	FinanceAccountUUID     *uuid.UUID `json:"finance_account_uuid,omitempty"`
	FinanceAccountName     *string    `json:"finance_account_name,omitempty"`
	FinanceTransactionUUID *uuid.UUID `json:"finance_transaction_uuid,omitempty"`
	CariEntryUUID          *uuid.UUID `json:"cari_entry_uuid,omitempty"`
	CreatedAt              time.Time  `json:"created_at"`
	VoidedAt               *time.Time `json:"voided_at,omitempty"`
}

type Job struct {
	UUID          uuid.UUID  `json:"uuid"`
	CustomerUUID  uuid.UUID  `json:"customer_uuid"`
	VehicleUUID   uuid.UUID  `json:"vehicle_uuid"`
	CustomerName  string     `json:"customer_name"`
	CustomerPhone string     `json:"customer_phone"`
	Plate         string     `json:"plate"`
	VehicleLabel  string     `json:"vehicle_label"`
	Status        string     `json:"status"`
	PaymentStatus string     `json:"payment_status"`
	Currency      string     `json:"currency"`
	Notes         string     `json:"notes"`
	TotalAmount   string     `json:"total_amount"`
	AssigneeUUID  *uuid.UUID `json:"assignee_uuid,omitempty"`
	AssigneeName  string     `json:"assignee_name,omitempty"`
	StartedAt     time.Time  `json:"started_at"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
	PaidAt        *time.Time `json:"paid_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type JobDetail struct {
	Job
	Lines    []Line    `json:"lines"`
	Payments []Payment `json:"payments"`
}

type Summary struct {
	JobCount  int64  `json:"job_count"`
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
	ServiceUUID uuid.UUID `json:"service_uuid"`
	UnitPrice   *string   `json:"unit_price"`
	Qty         *string   `json:"qty"`
}

type CreateInput struct {
	CustomerUUID uuid.UUID         `json:"customer_uuid"`
	VehicleUUID  uuid.UUID         `json:"vehicle_uuid"`
	AssigneeUUID *uuid.UUID        `json:"assignee_uuid"`
	Notes        string            `json:"notes"`
	StartedAt    *string           `json:"started_at"`
	Currency     string            `json:"currency"`
	Lines        []CreateLineInput `json:"lines"`
}

type PatchInput struct {
	Notes        *string    `json:"notes"`
	AssigneeUUID *uuid.UUID `json:"assignee_uuid"`
}

type CloseInput struct {
	Method             string     `json:"method"` // cash | card | cari
	FinanceAccountUUID *uuid.UUID `json:"finance_account_uuid"`
}
