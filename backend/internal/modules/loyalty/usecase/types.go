package usecase

import (
	"time"

	"github.com/google/uuid"
)

// Ref is a named reference (service, category, plan, …).
type Ref struct {
	UUID uuid.UUID `json:"uuid"`
	Name string    `json:"name"`
}

// Reward types of a stamp campaign.
const (
	RewardFreeService = "free_service"
	RewardPercent     = "percent"
	RewardFixed       = "fixed"
)

// Application kinds (what covered a job line).
const (
	KindReward       = "reward"
	KindPackage      = "package"
	KindSubscription = "subscription"
)

// Campaign is a stamp campaign ("10 yıkama 1 bedava").
type Campaign struct {
	UUID           uuid.UUID `json:"uuid"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	Services       []Ref     `json:"services"`
	Categories     []Ref     `json:"categories"`
	StampsRequired int32     `json:"stamps_required"`
	// RewardType: free_service (RewardService for free) | percent
	// (RewardValue % off an eligible line) | fixed (RewardValue off).
	RewardType       string    `json:"reward_type"`
	RewardService    *Ref      `json:"reward_service,omitempty"`
	RewardValue      string    `json:"reward_value"`
	ValidFrom        *string   `json:"valid_from,omitempty"`
	ValidUntil       *string   `json:"valid_until,omitempty"`
	IsActive         bool      `json:"is_active"`
	PerCustomerLimit *int32    `json:"per_customer_limit,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// CampaignInput creates or replaces a campaign.
type CampaignInput struct {
	Name              string      `json:"name"`
	Description       string      `json:"description"`
	ServiceUUIDs      []uuid.UUID `json:"service_uuids"`
	CategoryUUIDs     []uuid.UUID `json:"category_uuids"`
	StampsRequired    int32       `json:"stamps_required"`
	RewardType        string      `json:"reward_type"`
	RewardServiceUUID *uuid.UUID  `json:"reward_service_uuid"`
	RewardValue       string      `json:"reward_value"`
	ValidFrom         *string     `json:"valid_from"`
	ValidUntil        *string     `json:"valid_until"`
	IsActive          *bool       `json:"is_active"`
	PerCustomerLimit  *int32      `json:"per_customer_limit"`
}

// PackageItem is one service of a package definition.
type PackageItem struct {
	ServiceUUID uuid.UUID `json:"service_uuid"`
	ServiceName string    `json:"service_name"`
	Quantity    int32     `json:"quantity"`
	// UnitPrice is the service's current list price (for "you save" hints).
	UnitPrice string `json:"unit_price"`
}

// Package is a prepaid package definition.
type Package struct {
	UUID         uuid.UUID     `json:"uuid"`
	Name         string        `json:"name"`
	Description  string        `json:"description"`
	Price        string        `json:"price"`
	Currency     string        `json:"currency"`
	ValidityDays *int32        `json:"validity_days,omitempty"`
	IsActive     bool          `json:"is_active"`
	Items        []PackageItem `json:"items"`
	// ListValue is the items at the services' current prices.
	ListValue string    `json:"list_value"`
	SoldCount int64     `json:"sold_count"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// PackageItemInput is one service of a package definition.
type PackageItemInput struct {
	ServiceUUID uuid.UUID `json:"service_uuid"`
	Quantity    int32     `json:"quantity"`
}

// PackageInput creates or replaces a package definition.
type PackageInput struct {
	Name         string             `json:"name"`
	Description  string             `json:"description"`
	Price        string             `json:"price"`
	Currency     string             `json:"currency"`
	ValidityDays *int32             `json:"validity_days"`
	IsActive     *bool              `json:"is_active"`
	Items        []PackageItemInput `json:"items"`
}

// Plan is a subscription plan.
type Plan struct {
	UUID         uuid.UUID `json:"uuid"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	Price        string    `json:"price"`
	Currency     string    `json:"currency"`
	PeriodMonths int32     `json:"period_months"`
	// UsesPerPeriod is nil for unlimited.
	UsesPerPeriod *int32    `json:"uses_per_period,omitempty"`
	Services      []Ref     `json:"services"`
	Categories    []Ref     `json:"categories"`
	IsActive      bool      `json:"is_active"`
	ActiveCount   int64     `json:"active_count"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// PlanInput creates or replaces a plan.
type PlanInput struct {
	Name          string      `json:"name"`
	Description   string      `json:"description"`
	Price         string      `json:"price"`
	Currency      string      `json:"currency"`
	PeriodMonths  int32       `json:"period_months"`
	UsesPerPeriod *int32      `json:"uses_per_period"`
	ServiceUUIDs  []uuid.UUID `json:"service_uuids"`
	CategoryUUIDs []uuid.UUID `json:"category_uuids"`
	IsActive      *bool       `json:"is_active"`
}

// Credit is one service's credits in a customer package.
type Credit struct {
	ServiceUUID uuid.UUID `json:"service_uuid"`
	ServiceName string    `json:"service_name"`
	Total       int32     `json:"total"`
	Used        int32     `json:"used"`
	Remaining   int32     `json:"remaining"`
}

// CustomerPackage is a package sold to a customer. State is active
// (usable) | expired | used_up | cancelled.
type CustomerPackage struct {
	UUID          uuid.UUID  `json:"uuid"`
	PackageUUID   *uuid.UUID `json:"package_uuid,omitempty"`
	CustomerUUID  uuid.UUID  `json:"customer_uuid"`
	CustomerName  string     `json:"customer_name"`
	Name          string     `json:"name"`
	Price         string     `json:"price"`
	Currency      string     `json:"currency"`
	State         string     `json:"state"`
	PurchasedAt   time.Time  `json:"purchased_at"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	PaymentMethod string     `json:"payment_method"`
	CreditsTotal  int64      `json:"credits_total"`
	CreditsUsed   int64      `json:"credits_used"`
	Credits       []Credit   `json:"credits"`
	Notes         string     `json:"notes"`
	CancelledAt   *time.Time `json:"cancelled_at,omitempty"`
}

// Usage is one use of a package / subscription on a job.
type Usage struct {
	UUID           uuid.UUID `json:"uuid"`
	JobUUID        uuid.UUID `json:"job_uuid"`
	Plate          string    `json:"plate"`
	LineName       string    `json:"line_name"`
	Units          int32     `json:"units"`
	DiscountAmount string    `json:"discount_amount"`
	// Status is applied or reverted.
	Status      string    `json:"status"`
	PeriodStart *string   `json:"period_start,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// CustomerPackageDetail adds the usage history.
type CustomerPackageDetail struct {
	CustomerPackage
	Usage []Usage `json:"usage"`
}

// PaymentInput takes money: cash / card into a finance account, or cari
// (charged to the customer's account).
type PaymentInput struct {
	Method             string     `json:"method"`
	FinanceAccountUUID *uuid.UUID `json:"finance_account_uuid"`
}

// SellPackageInput sells a package definition to a customer.
type SellPackageInput struct {
	PackageUUID        uuid.UUID  `json:"package_uuid"`
	CustomerUUID       uuid.UUID  `json:"customer_uuid"`
	Method             string     `json:"method"`
	FinanceAccountUUID *uuid.UUID `json:"finance_account_uuid"`
	Notes              string     `json:"notes"`
}

// CancelResult tells whether the sale was refunded (no credit used yet).
type CancelResult struct {
	CustomerPackageDetail
	Refunded bool `json:"refunded"`
}

// Period is a subscription period [start, end) with the uses in it.
type Period struct {
	Start string `json:"start"`
	End   string `json:"end"`
	Used  int64  `json:"used"`
	// Limit is nil for unlimited.
	Limit     *int32 `json:"limit,omitempty"`
	Remaining *int64 `json:"remaining,omitempty"`
}

// Subscription is a customer's subscription. State is active (today is
// paid) | past_due (the current period is unpaid) | cancelled. RenewalDate
// is paid_through: the start of the next period to pay.
type Subscription struct {
	UUID          uuid.UUID  `json:"uuid"`
	PlanUUID      *uuid.UUID `json:"plan_uuid,omitempty"`
	CustomerUUID  uuid.UUID  `json:"customer_uuid"`
	CustomerName  string     `json:"customer_name"`
	CustomerPhone string     `json:"customer_phone"`
	VehicleUUID   *uuid.UUID `json:"vehicle_uuid,omitempty"`
	Plate         *string    `json:"plate,omitempty"`
	Name          string     `json:"name"`
	Price         string     `json:"price"`
	Currency      string     `json:"currency"`
	PeriodMonths  int32      `json:"period_months"`
	UsesPerPeriod *int32     `json:"uses_per_period,omitempty"`
	StartDate     string     `json:"start_date"`
	RenewalDate   string     `json:"renewal_date"`
	// DaysUntilRenewal is negative when overdue.
	DaysUntilRenewal int        `json:"days_until_renewal"`
	State            string     `json:"state"`
	CurrentPeriod    *Period    `json:"current_period,omitempty"`
	Notes            string     `json:"notes"`
	CancelledAt      *time.Time `json:"cancelled_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// SubscriptionPayment is one paid period.
type SubscriptionPayment struct {
	UUID               uuid.UUID `json:"uuid"`
	PeriodStart        string    `json:"period_start"`
	PeriodEnd          string    `json:"period_end"`
	Amount             string    `json:"amount"`
	Currency           string    `json:"currency"`
	Method             string    `json:"method"`
	FinanceAccountName string    `json:"finance_account_name,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
}

// SubscriptionDetail adds payments, usage and the next period to pay.
type SubscriptionDetail struct {
	Subscription
	NextPeriod Period                `json:"next_period"`
	Payments   []SubscriptionPayment `json:"payments"`
	Usage      []Usage               `json:"usage"`
}

// StartSubscriptionInput starts a subscription; Payment collects the first
// period right away (optional).
type StartSubscriptionInput struct {
	PlanUUID     uuid.UUID     `json:"plan_uuid"`
	CustomerUUID uuid.UUID     `json:"customer_uuid"`
	VehicleUUID  *uuid.UUID    `json:"vehicle_uuid"`
	StartDate    *string       `json:"start_date"`
	Notes        string        `json:"notes"`
	Payment      *PaymentInput `json:"payment"`
}

// StampCard is a customer's progress in one campaign.
type StampCard struct {
	CampaignUUID   uuid.UUID `json:"campaign_uuid"`
	CampaignName   string    `json:"campaign_name"`
	StampsRequired int32     `json:"stamps_required"`
	// Stamps is the progress towards the next reward (0..required-1);
	// Balance is every unredeemed stamp.
	Stamps           int64  `json:"stamps"`
	Balance          int64  `json:"balance"`
	RewardsAvailable int64  `json:"rewards_available"`
	RewardsRedeemed  int64  `json:"rewards_redeemed"`
	RewardType       string `json:"reward_type"`
	RewardValue      string `json:"reward_value"`
	RewardService    *Ref   `json:"reward_service,omitempty"`
	// Active: the campaign runs today (only active cards earn and redeem).
	Active       bool `json:"active"`
	LimitReached bool `json:"limit_reached"`
}

// CustomerLoyalty is the customer 360 loyalty section.
type CustomerLoyalty struct {
	CustomerUUID  uuid.UUID         `json:"customer_uuid"`
	Stamps        []StampCard       `json:"stamps"`
	Packages      []CustomerPackage `json:"packages"`
	Subscriptions []Subscription    `json:"subscriptions"`
	// RewardsAvailable sums every card (badge).
	RewardsAvailable int64 `json:"rewards_available"`
}

// Application is loyalty applied to a job line.
type Application struct {
	UUID           uuid.UUID  `json:"uuid"`
	Kind           string     `json:"kind"`
	SourceUUID     *uuid.UUID `json:"source_uuid,omitempty"`
	SourceName     string     `json:"source_name"`
	LineUUID       uuid.UUID  `json:"line_uuid"`
	LineName       string     `json:"line_name"`
	Units          int32      `json:"units"`
	DiscountAmount string     `json:"discount_amount"`
	Status         string     `json:"status"`
	CreatedAt      time.Time  `json:"created_at"`
}

// Option is something loyalty can cover on a job line right now.
type Option struct {
	Kind           string    `json:"kind"`
	SourceUUID     uuid.UUID `json:"source_uuid"`
	SourceName     string    `json:"source_name"`
	LineUUID       uuid.UUID `json:"line_uuid"`
	LineName       string    `json:"line_name"`
	Units          int32     `json:"units"`
	DiscountAmount string    `json:"discount_amount"`
	// Remaining is what is left after this use (credits / uses); nil for an
	// unlimited subscription or a reward.
	Remaining *int64 `json:"remaining,omitempty"`
}

// JobLoyalty is the job form's "Kampanya / Paket / Abonelik" section.
type JobLoyalty struct {
	JobUUID      uuid.UUID `json:"job_uuid"`
	CustomerUUID uuid.UUID `json:"customer_uuid"`
	// Editable: the job is unpaid and open, so loyalty can be applied or
	// reverted.
	Editable bool          `json:"editable"`
	Applied  []Application `json:"applied"`
	Options  []Option      `json:"options"`
	// Stamps shows the customer's cards (progress hint on the job).
	Stamps []StampCard `json:"stamps"`
	// StampsEarned lists campaigns this job earned a stamp in.
	StampsEarned []Ref `json:"stamps_earned"`
}

// ApplyInput applies one option to a job line.
type ApplyInput struct {
	Kind       string    `json:"kind"`
	SourceUUID uuid.UUID `json:"source_uuid"`
	LineUUID   uuid.UUID `json:"line_uuid"`
}

// Overview is the module's counters plus upcoming renewals (dashboard tile).
type Overview struct {
	ActiveCampaigns        int64          `json:"active_campaigns"`
	ActivePackages         int64          `json:"active_packages"`
	ActivePlans            int64          `json:"active_plans"`
	CustomerPackagesActive int64          `json:"customer_packages_active"`
	SubscriptionsActive    int64          `json:"subscriptions_active"`
	SubscriptionsPastDue   int64          `json:"subscriptions_past_due"`
	RenewalsUpcoming       int64          `json:"renewals_upcoming"`
	HorizonDays            int            `json:"horizon_days"`
	Renewals               []Subscription `json:"renewals"`
}

// ListFilter is the common list query.
type ListFilter struct {
	Q        string
	IsActive *bool
	Limit    int32
	Offset   int32
}

// CustomerPackageFilter filters packages sold.
type CustomerPackageFilter struct {
	Q            string
	CustomerUUID *uuid.UUID
	State        string
	Limit        int32
	Offset       int32
}

// SubscriptionFilter filters subscriptions; DueWithinDays lists active
// subscriptions renewing within n days (overdue included).
type SubscriptionFilter struct {
	Q             string
	CustomerUUID  *uuid.UUID
	State         string
	DueWithinDays *int
	Limit         int32
	Offset        int32
}
