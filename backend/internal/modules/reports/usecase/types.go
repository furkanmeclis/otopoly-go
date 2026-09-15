package usecase

import (
	"time"

	"github.com/google/uuid"
)

type Filters struct {
	DateFrom      string  `json:"date_from"`
	DateTo        string  `json:"date_to"`
	Currency      *string `json:"currency,omitempty"`
	PaymentMethod *string `json:"payment_method,omitempty"`
	AccountUUID   *string `json:"account_uuid,omitempty"`
	SourceType    *string `json:"source_type,omitempty"`
	Granularity   string  `json:"granularity"`
}

type KPIs struct {
	TotalIncome      string `json:"total_income"`
	TotalExpense     string `json:"total_expense"`
	NetProfit        string `json:"net_profit"`
	IncomeCount      int64  `json:"income_count"`
	ExpenseCount     int64  `json:"expense_count"`
	JobCount         int64  `json:"job_count"`
	JobPaidCount     int64  `json:"job_paid_count"`
	JobDoneCount     int64  `json:"job_done_count"`
	JobInProgress    int64  `json:"job_in_progress_count"`
	JobCancelled     int64  `json:"job_cancelled_count"`
	JobPaidTotal     string `json:"job_paid_total"`
	AvgTicket        string `json:"avg_ticket"`
	VehiclesServed   int64  `json:"vehicles_served"`
	SaleCount        int64  `json:"sale_count"`
	SaleTotal        string `json:"sale_total"`
	PurchaseCount    int64  `json:"purchase_count"`
	PurchaseTotal    string `json:"purchase_total"`
	CariCharged      string `json:"cari_charged"`
	CariCollected    string `json:"cari_collected"`
	CariOutstanding  string `json:"cari_outstanding"`
	CariChargeCount  int64  `json:"cari_charge_count"`
	CariPaymentCount int64  `json:"cari_payment_count"`
	CashTotal        string `json:"cash_total"`
	CardTotal        string `json:"card_total"`
	CariPaymentTotal string `json:"cari_payment_total"`
}

type NamedTotal struct {
	Key   string `json:"key,omitempty"`
	Name  string `json:"name"`
	Total string `json:"total"`
	Count int64  `json:"count"`
	Qty   string `json:"qty,omitempty"`
}

type SourceTotal struct {
	SourceType string `json:"source_type"`
	Type       string `json:"type"`
	Total      string `json:"total"`
	Count      int64  `json:"count"`
}

type TimeseriesPoint struct {
	Date     string `json:"date"`
	Income   string `json:"income"`
	Expense  string `json:"expense"`
	Net      string `json:"net"`
	JobPaid  string `json:"job_paid"`
	JobCount int64  `json:"job_count"`
}

type CariReceivable struct {
	AccountUUID   uuid.UUID `json:"account_uuid"`
	CustomerUUID  uuid.UUID `json:"customer_uuid"`
	CustomerName  string    `json:"customer_name"`
	CustomerPhone string    `json:"customer_phone"`
	Currency      string    `json:"currency"`
	Balance       string    `json:"balance"`
	LastEntryDate *string   `json:"last_entry_date,omitempty"`
}

type TopCustomer struct {
	CustomerUUID uuid.UUID `json:"customer_uuid"`
	CustomerName string    `json:"customer_name"`
	JobTotal     string    `json:"job_total"`
	JobCount     int64     `json:"job_count"`
}

type Overview struct {
	Filters            Filters           `json:"filters"`
	KPIs               KPIs              `json:"kpis"`
	Timeseries         []TimeseriesPoint `json:"timeseries"`
	Services           []NamedTotal      `json:"services"`
	Products           []NamedTotal      `json:"products"`
	ExpensesByCategory []NamedTotal      `json:"expenses_by_category"`
	IncomeByCategory   []NamedTotal      `json:"income_by_category"`
	PaymentsByMethod   []NamedTotal      `json:"payments_by_method"`
	RevenueBySource    []SourceTotal     `json:"revenue_by_source"`
	CariReceivables    []CariReceivable  `json:"cari_receivables"`
	TopCustomers       []TopCustomer     `json:"top_customers"`
	GeneratedAt        time.Time         `json:"generated_at"`
}
