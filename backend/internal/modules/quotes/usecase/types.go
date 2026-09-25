package usecase

import (
	"time"

	"github.com/google/uuid"
)

// Line is a quote line in API responses.
type Line struct {
	UUID               uuid.UUID  `json:"uuid"`
	LineType           string     `json:"line_type"`
	ServiceUUID        *uuid.UUID `json:"service_uuid,omitempty"`
	ProductUUID        *uuid.UUID `json:"product_uuid,omitempty"`
	Description        string     `json:"description"`
	Quantity           string     `json:"quantity"`
	Unit               string     `json:"unit"`
	UnitPrice          string     `json:"unit_price"`
	DiscountType       string     `json:"discount_type"`
	DiscountValue      string     `json:"discount_value"`
	VATRate            string     `json:"vat_rate"`
	LineSubtotal       string     `json:"line_subtotal"`
	LineDiscount       string     `json:"line_discount"`
	QuoteDiscountShare string     `json:"quote_discount_share"`
	NetAmount          string     `json:"net_amount"`
	VATAmount          string     `json:"vat_amount"`
	LineTotal          string     `json:"line_total"`
	SortOrder          int32      `json:"sort_order"`
}

// Ref is a related record.
type Ref struct {
	UUID  uuid.UUID `json:"uuid"`
	Label string    `json:"label"`
}

// Quote is the list shape.
type Quote struct {
	UUID          uuid.UUID  `json:"uuid"`
	Number        string     `json:"number"`
	Status        string     `json:"status"`
	Currency      string     `json:"currency"`
	GrandTotal    string     `json:"grand_total"`
	ValidUntil    *string    `json:"valid_until"`
	Expired       bool       `json:"is_past_valid_until"`
	CustomerUUID  uuid.UUID  `json:"customer_uuid"`
	CustomerName  string     `json:"customer_name"`
	CustomerPhone string     `json:"customer_phone"`
	VehiclePlate  string     `json:"vehicle_plate"`
	VehicleLabel  string     `json:"vehicle_label"`
	LeadUUID      *uuid.UUID `json:"lead_uuid"`
	JobUUID       *uuid.UUID `json:"job_uuid"`
	LineCount     int64      `json:"line_count"`
	SentAt        *time.Time `json:"sent_at"`
	ViewedAt      *time.Time `json:"viewed_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// Event is one quote history row.
type Event struct {
	UUID       uuid.UUID `json:"uuid"`
	Kind       string    `json:"kind"`
	FromStatus string    `json:"from_status"`
	ToStatus   string    `json:"to_status"`
	Body       string    `json:"body"`
	Channel    string    `json:"channel"`
	ActorName  string    `json:"actor_name"`
	IP         string    `json:"ip,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// Delivery is one send attempt history row.
type Delivery struct {
	UUID          uuid.UUID  `json:"uuid"`
	Channel       string     `json:"channel"`
	Recipient     string     `json:"recipient"`
	Status        string     `json:"status"`
	Error         string     `json:"error"`
	AttemptCount  int32      `json:"attempt_count"`
	LastAttemptAt *time.Time `json:"last_attempt_at"`
	SentAt        *time.Time `json:"sent_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

// Reminder is one desired reminder.
type Reminder struct {
	UUID        uuid.UUID  `json:"uuid"`
	Kind        string     `json:"kind"`
	OffsetDays  int32      `json:"offset_days"`
	FireAt      time.Time  `json:"fire_at"`
	Status      string     `json:"status"`
	Error       string     `json:"error"`
	SentAt      *time.Time `json:"sent_at"`
	CancelledAt *time.Time `json:"cancelled_at"`
}

// Detail is the full quote.
type Detail struct {
	Quote
	LeadUUID          *uuid.UUID `json:"lead_uuid"`
	VehicleUUID       *uuid.UUID `json:"vehicle_uuid"`
	VehicleModelUUID  *uuid.UUID `json:"vehicle_model_uuid"`
	VehicleModelLabel string     `json:"vehicle_model_label"`
	VehicleYear       *int       `json:"vehicle_year"`
	CustomerEmail     string     `json:"customer_email"`
	PricesIncludeVAT  bool       `json:"prices_include_vat"`
	DiscountType      string     `json:"discount_type"`
	DiscountValue     string     `json:"discount_value"`
	Subtotal          string     `json:"subtotal"`
	DiscountTotal     string     `json:"discount_total"`
	VATTotal          string     `json:"vat_total"`
	Notes             string     `json:"notes"`
	Terms             string     `json:"terms"`
	ShareURL          string     `json:"share_url"`
	ViewCount         int32      `json:"view_count"`
	AcceptedAt        *time.Time `json:"accepted_at"`
	RejectedAt        *time.Time `json:"rejected_at"`
	ExpiredAt         *time.Time `json:"expired_at"`
	CancelledAt       *time.Time `json:"cancelled_at"`
	DecisionNote      string     `json:"decision_note"`
	DecisionChannel   string     `json:"decision_channel"`
	ConvertedAt       *time.Time `json:"converted_at"`
	CreatedByName     string     `json:"created_by_name"`
	AllowedStatuses   []string   `json:"allowed_statuses"`
	CanEdit           bool       `json:"can_edit"`
	CanSend           bool       `json:"can_send"`
	CanConvert        bool       `json:"can_convert"`
	Lines             []Line     `json:"lines"`
	Events            []Event    `json:"events"`
	Deliveries        []Delivery `json:"deliveries"`
	Reminders         []Reminder `json:"reminders"`
}

// Summary powers the dashboard and nav badge.
type Summary struct {
	Currency           string `json:"currency"`
	OpenCount          int64  `json:"open_count"`
	DraftCount         int64  `json:"draft_count"`
	AwaitingCount      int64  `json:"awaiting_count"`
	PendingTotal       string `json:"pending_total"`
	ExpiringSoon       int64  `json:"expiring_soon"`
	AcceptedMonth      int64  `json:"accepted_month"`
	AcceptedMonthTotal string `json:"accepted_month_total"`
}

// ListFilters narrows the list.
type ListFilters struct {
	Q            string
	Status       string // draft|sent|viewed|accepted|rejected|expired|cancelled|open
	CustomerUUID *uuid.UUID
	LeadUUID     *uuid.UUID
	Sort         string
}

// LineInput is one line in create / update.
type LineInput struct {
	LineType      string     `json:"line_type"` // service | product | custom
	ServiceUUID   *uuid.UUID `json:"service_uuid"`
	ProductUUID   *uuid.UUID `json:"product_uuid"`
	Description   string     `json:"description"`
	Quantity      string     `json:"quantity"`
	Unit          string     `json:"unit"`
	UnitPrice     *string    `json:"unit_price"`
	DiscountType  string     `json:"discount_type"`
	DiscountValue string     `json:"discount_value"`
	VATRate       *string    `json:"vat_rate"`
}

// VehicleInput is the optional vehicle: an existing customer vehicle, or free
// text (plate optional) with an optional catalog model/year.
type VehicleInput struct {
	VehicleUUID *uuid.UUID `json:"vehicle_uuid"`
	Plate       string     `json:"plate"`
	Label       string     `json:"label"`
	ModelUUID   *uuid.UUID `json:"model_uuid"`
	Year        *int       `json:"year"`
}

// SaveInput creates or fully replaces a quote's editable content.
type SaveInput struct {
	CustomerUUID     uuid.UUID     `json:"customer_uuid"`
	LeadUUID         *uuid.UUID    `json:"lead_uuid"`
	Vehicle          *VehicleInput `json:"vehicle"`
	Currency         string        `json:"currency"`
	PricesIncludeVAT *bool         `json:"prices_include_vat"`
	DiscountType     string        `json:"discount_type"`
	DiscountValue    string        `json:"discount_value"`
	ValidUntil       *string       `json:"valid_until"` // yyyy-MM-dd or "" to clear
	Notes            string        `json:"notes"`
	Terms            string        `json:"terms"`
	Lines            []LineInput   `json:"lines"`
}

// StatusInput is a manual status change from the tenant UI.
type StatusInput struct {
	Status string `json:"status"` // sent | accepted | rejected | cancelled
	Note   string `json:"note"`
}

// ReminderInput is one desired reminder.
type ReminderInput struct {
	Kind string  `json:"kind"` // before_3d | before_1d | last_day | custom
	Date *string `json:"date"` // custom only: yyyy-MM-dd
}

// SendInput sends the quote to the customer.
type SendInput struct {
	Channel   string          `json:"channel"`   // default whatsapp
	Reminders []ReminderInput `json:"reminders"` // replaces pending reminders when non-nil
}

// SendResult reports the outcome of a send.
type SendResult struct {
	Quote    Detail   `json:"quote"`
	Delivery Delivery `json:"delivery"`
}

// ConvertInput fills what the quote lacks to become a job.
type ConvertInput struct {
	VehicleUUID  *uuid.UUID `json:"vehicle_uuid"`
	Plate        string     `json:"plate"`
	ModelUUID    *uuid.UUID `json:"model_uuid"`
	Year         *int       `json:"year"`
	AssigneeUUID *uuid.UUID `json:"assignee_uuid"`
	Notes        string     `json:"notes"`
}

// ConvertLine previews one quote line in the conversion.
type ConvertLine struct {
	Description string `json:"description"`
	LineType    string `json:"line_type"`
	Quantity    string `json:"quantity"`
	UnitPrice   string `json:"unit_price"` // job unit price (after discounts, incl. VAT)
	LineTotal   string `json:"line_total"`
	Included    bool   `json:"included"`
	Reason      string `json:"reason,omitempty"` // why a line is not transferred
}

// ConvertPreview is what the confirm dialog shows.
type ConvertPreview struct {
	CanConvert      bool          `json:"can_convert"`
	Blocker         string        `json:"blocker,omitempty"`
	WillAccept      bool          `json:"will_accept"`
	CustomerName    string        `json:"customer_name"`
	VehicleUUID     *uuid.UUID    `json:"vehicle_uuid"`
	VehicleLabel    string        `json:"vehicle_label"`
	Plate           string        `json:"plate"`
	CreatesVehicle  bool          `json:"creates_vehicle"`
	Missing         []string      `json:"missing"` // plate | model
	CustomerVehicle []Ref         `json:"customer_vehicles"`
	Lines           []ConvertLine `json:"lines"`
	JobTotal        string        `json:"job_total"`
	SkippedTotal    string        `json:"skipped_total"`
	Currency        string        `json:"currency"`
	LeadUUID        *uuid.UUID    `json:"lead_uuid"`
}

// ConvertResult links the created job.
type ConvertResult struct {
	JobUUID uuid.UUID `json:"job_uuid"`
	Quote   Detail    `json:"quote"`
}

// PublicLine is a line on the public page.
type PublicLine struct {
	Description string `json:"description"`
	Quantity    string `json:"quantity"`
	Unit        string `json:"unit"`
	UnitPrice   string `json:"unit_price"`
	Discount    string `json:"discount"`
	VATRate     string `json:"vat_rate"`
	LineTotal   string `json:"line_total"`
}

// PublicQuote is the read-only customer view (no internal ids).
type PublicQuote struct {
	Number           string       `json:"number"`
	Status           string       `json:"status"`
	OrganizationName string       `json:"organization_name"`
	OrganizationLogo *string      `json:"organization_logo_url"`
	OrganizationTel  string       `json:"organization_phone"`
	OrganizationAddr string       `json:"organization_address"`
	PrimaryColor     string       `json:"primary_color"`
	CustomerName     string       `json:"customer_name"`
	VehiclePlate     string       `json:"vehicle_plate"`
	VehicleLabel     string       `json:"vehicle_label"`
	Currency         string       `json:"currency"`
	PricesIncludeVAT bool         `json:"prices_include_vat"`
	Subtotal         string       `json:"subtotal"`
	DiscountTotal    string       `json:"discount_total"`
	VATTotal         string       `json:"vat_total"`
	GrandTotal       string       `json:"grand_total"`
	ValidUntil       *string      `json:"valid_until"`
	Notes            string       `json:"notes"`
	Terms            string       `json:"terms"`
	IssuedAt         time.Time    `json:"issued_at"`
	DecidedAt        *time.Time   `json:"decided_at"`
	CanDecide        bool         `json:"can_decide"`
	Lines            []PublicLine `json:"lines"`
}

// PublicDecisionInput is accept / reject from the public page.
type PublicDecisionInput struct {
	Note string `json:"note"`
}

// ClientInfo is request evidence for public actions.
type ClientInfo struct {
	IP        string
	UserAgent string
}
