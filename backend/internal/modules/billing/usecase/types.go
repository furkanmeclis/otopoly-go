package usecase

import (
	"io"
	"time"

	"github.com/google/uuid"
)

type Feature struct {
	ID        int64  `json:"id"`
	Key       string `json:"key"`
	Kind      string `json:"kind"`
	Unit      string `json:"unit"`
	Period    string `json:"period"`
	LabelTR   string `json:"label_tr"`
	LabelEN   string `json:"label_en"`
	SortOrder int32  `json:"sort_order"`
	IsBuiltin bool   `json:"is_builtin"`
	IsActive  bool   `json:"is_active"`
}

type DisplayFeatureInput struct {
	Key       string `json:"key"`
	LabelTR   string `json:"label_tr"`
	LabelEN   string `json:"label_en"`
	SortOrder int32  `json:"sort_order"`
}

type PlanFeatureValue struct {
	Key          string  `json:"key"`
	ValueInt     *int64  `json:"value_int"`
	ValueBool    *bool   `json:"value_bool"`
	DisplayText  string  `json:"display_text"`
	Enforcement  string  `json:"enforcement"`
	TolerancePct int32   `json:"tolerance_pct"`
	WarnPct      int32   `json:"warn_pct"`
	MinValue     *int64  `json:"min_value"`
	MaxValue     *int64  `json:"max_value"`
	Step         *int64  `json:"step"`
	UnitPrice    *string `json:"unit_price"`
	// Catalog fields, filled on reads so clients can label rows.
	Kind    string `json:"kind,omitempty"`
	Unit    string `json:"unit,omitempty"`
	LabelTR string `json:"label_tr,omitempty"`
	LabelEN string `json:"label_en,omitempty"`
}

type Plan struct {
	UUID                  uuid.UUID          `json:"uuid"`
	Code                  string             `json:"code"`
	Name                  string             `json:"name"`
	Description           string             `json:"description"`
	PriceMonthly          string             `json:"price_monthly"`
	YearlyPricing         string             `json:"yearly_pricing"`
	PriceYearly           string             `json:"price_yearly"`
	YearlyDiscountValue   string             `json:"yearly_discount_value"`
	EffectiveYearly       string             `json:"effective_yearly"`
	Currency              string             `json:"currency"`
	TrialDays             int32              `json:"trial_days"`
	IsPublic              bool               `json:"is_public"`
	IsCustomizable        bool               `json:"is_customizable"`
	IsActive              bool               `json:"is_active"`
	Badge                 string             `json:"badge"`
	SortOrder             int32              `json:"sort_order"`
	Features              []PlanFeatureValue `json:"features"`
	LiveSubscriptions     int64              `json:"live_subscriptions"`
	internalID            int64
	internalPlanFeatureID int64
}

type PlanInput struct {
	Code                string             `json:"code"`
	Name                string             `json:"name"`
	Description         string             `json:"description"`
	PriceMonthly        string             `json:"price_monthly"`
	YearlyPricing       string             `json:"yearly_pricing"`
	PriceYearly         string             `json:"price_yearly"`
	YearlyDiscountValue string             `json:"yearly_discount_value"`
	TrialDays           int32              `json:"trial_days"`
	IsPublic            bool               `json:"is_public"`
	IsCustomizable      bool               `json:"is_customizable"`
	IsActive            bool               `json:"is_active"`
	Badge               string             `json:"badge"`
	SortOrder           int32              `json:"sort_order"`
	Features            []PlanFeatureValue `json:"features"`
}

type UsageMeter struct {
	Key          string `json:"key"`
	Kind         string `json:"kind"`
	Unit         string `json:"unit"`
	Period       string `json:"period"`
	PeriodKey    string `json:"period_key"`
	Limit        *int64 `json:"limit"`
	Used         int64  `json:"used"`
	WarnPct      int32  `json:"warn_pct"`
	TolerancePct int32  `json:"tolerance_pct"`
	Enforcement  string `json:"enforcement"`
	Enabled      *bool  `json:"enabled"`
	LabelTR      string `json:"label_tr"`
	LabelEN      string `json:"label_en"`
}

type Overview struct {
	Subscription *SubscriptionView `json:"subscription"`
	Plan         *Plan             `json:"plan"`
	Meters       []UsageMeter      `json:"meters"`
	OpenOrder    *Order            `json:"open_order"`
}

type SubscriptionView struct {
	UUID          uuid.UUID  `json:"uuid"`
	PlanCode      string     `json:"plan_code"`
	PlanName      string     `json:"plan_name"`
	Period        string     `json:"period"`
	Status        string     `json:"status"`
	StartsAt      time.Time  `json:"starts_at"`
	EndsAt        time.Time  `json:"ends_at"`
	GraceEndsAt   *time.Time `json:"grace_ends_at"`
	DaysLeft      int        `json:"days_left"`
	CreditBalance string     `json:"credit_balance"`
	Source        string     `json:"source"`
}

type PlanRef struct {
	UUID uuid.UUID `json:"uuid"`
	Code string    `json:"code"`
	Name string    `json:"name"`
}

type OrganizationRef struct {
	UUID uuid.UUID `json:"uuid"`
	Slug string    `json:"slug"`
	Name string    `json:"name"`
}

type QuoteLine struct {
	Kind   string `json:"kind"`
	Label  string `json:"label"`
	Amount string `json:"amount"`
}

type DiscountPreviewError struct {
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

type OrderPreview struct {
	Kind            string                `json:"kind"`
	Plan            PlanRef               `json:"plan"`
	Period          string                `json:"period"`
	ListPrice       string                `json:"list_price"`
	ProrationCredit string                `json:"proration_credit"`
	DiscountCode    *string               `json:"discount_code"`
	DiscountAmount  string                `json:"discount_amount"`
	CreditApplied   string                `json:"credit_applied"`
	CreditSurplus   string                `json:"credit_surplus"`
	Total           string                `json:"total"`
	VATRate         int32                 `json:"vat_rate"`
	VATAmount       string                `json:"vat_amount"`
	StartsAt        time.Time             `json:"starts_at"`
	EndsAt          time.Time             `json:"ends_at"`
	Lines           []QuoteLine           `json:"lines"`
	DiscountError   *DiscountPreviewError `json:"discount_error"`
}

type BankInstructions struct {
	BankName            string `json:"bank_name"`
	AccountHolder       string `json:"account_holder"`
	IBAN                string `json:"iban"`
	Amount              string `json:"amount"`
	ReferenceCode       string `json:"reference_code"`
	PaymentInstructions string `json:"payment_instructions"`
}

type Order struct {
	UUID               uuid.UUID         `json:"uuid"`
	ReferenceCode      string            `json:"reference_code"`
	Kind               string            `json:"kind"`
	Status             string            `json:"status"`
	Channel            string            `json:"channel"`
	Plan               PlanRef           `json:"plan"`
	Period             string            `json:"period"`
	ListPrice          string            `json:"list_price"`
	ProrationCredit    string            `json:"proration_credit"`
	DiscountCode       *string           `json:"discount_code"`
	DiscountAmount     string            `json:"discount_amount"`
	CreditApplied      string            `json:"credit_applied"`
	CreditSurplus      string            `json:"credit_surplus"`
	Total              string            `json:"total"`
	VATAmount          string            `json:"vat_amount"`
	Lines              []QuoteLine       `json:"lines"`
	HasReceipt         bool              `json:"has_receipt"`
	ReceiptContentType *string           `json:"receipt_content_type"`
	ReportNote         string            `json:"report_note"`
	ReportedAt         *time.Time        `json:"reported_at"`
	ReviewedAt         *time.Time        `json:"reviewed_at"`
	RejectReason       string            `json:"reject_reason"`
	ExpiresAt          time.Time         `json:"expires_at"`
	CreatedAt          time.Time         `json:"created_at"`
	Instructions       *BankInstructions `json:"instructions"`
	Organization       *OrganizationRef  `json:"organization"`
}

type OrderInput struct {
	PlanUUID     uuid.UUID `json:"plan_uuid"`
	Period       string    `json:"period"`
	DiscountCode string    `json:"discount_code"`
}

type ReportInput struct {
	Note        string
	Filename    string
	ContentType string
	Size        int64
	Body        io.Reader
}

type OrdersSummary struct {
	PendingPayment  int64 `json:"pending_payment"`
	PaymentReported int64 `json:"payment_reported"`
}

type AdminSubscription struct {
	UUID          uuid.UUID       `json:"uuid"`
	Organization  OrganizationRef `json:"organization"`
	Plan          PlanRef         `json:"plan"`
	Period        string          `json:"period"`
	Status        string          `json:"status"`
	StartsAt      time.Time       `json:"starts_at"`
	EndsAt        time.Time       `json:"ends_at"`
	DaysLeft      int             `json:"days_left"`
	PricePaid     string          `json:"price_paid"`
	CreditBalance string          `json:"credit_balance"`
	Source        string          `json:"source"`
	Note          string          `json:"note"`
	CreatedAt     time.Time       `json:"created_at"`
}

type AdminSubscriptionInput struct {
	OrganizationUUID uuid.UUID `json:"organization_uuid"`
	PlanUUID         uuid.UUID `json:"plan_uuid"`
	Period           string    `json:"period"`
	StartsAt         time.Time `json:"starts_at"`
	EndsAt           time.Time `json:"ends_at"`
	PricePaid        string    `json:"price_paid"`
	Note             string    `json:"note"`
}

type AdminSubscriptionPatch struct {
	EndsAt   *time.Time `json:"ends_at"`
	PlanUUID *uuid.UUID `json:"plan_uuid"`
	Note     string     `json:"note"`
}
