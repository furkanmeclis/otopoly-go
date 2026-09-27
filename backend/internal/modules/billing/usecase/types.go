package usecase

import (
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
