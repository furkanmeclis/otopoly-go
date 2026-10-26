package usecase

import (
	"time"

	"github.com/google/uuid"
)

// CustomerRef is a customer in the exclude list.
type CustomerRef struct {
	UUID  uuid.UUID `json:"uuid"`
	Name  string    `json:"name"`
	Phone string    `json:"phone"`
}

// TemplateInfo is the effective review request text for the current channel
// and default locale (edited in Ayarlar → Mesajlar, type review.request).
type TemplateInfo struct {
	Channel  string `json:"channel"`
	Locale   string `json:"locale"`
	Body     string `json:"body"`
	IsCustom bool   `json:"is_custom"`
	Active   bool   `json:"active"`
	// Preview is Body rendered with sample values.
	Preview string `json:"preview"`
}

// Usage is the reviews.monthly counter of the current month (limit -1 =
// unlimited).
type Usage struct {
	Used  int64 `json:"used"`
	Limit int64 `json:"limit"`
}

// Settings is the organization's review collection configuration.
type Settings struct {
	Enabled            bool          `json:"enabled"`
	Channel            string        `json:"channel"`
	DelayMinutes       int           `json:"delay_minutes"`
	QuietHoursEnabled  bool          `json:"quiet_hours_enabled"`
	QuietStartHour     int           `json:"quiet_start_hour"`
	QuietEndHour       int           `json:"quiet_end_hour"`
	GoogleReviewURL    string        `json:"google_review_url"`
	HighScoreThreshold int           `json:"high_score_threshold"`
	MinDaysBetween     int           `json:"min_days_between"`
	ConsentText        string        `json:"consent_text"`
	DefaultLocale      string        `json:"default_locale"`
	ExcludedCustomers  []CustomerRef `json:"excluded_customers"`
	// Read-only status.
	WhatsAppAvailable bool `json:"whatsapp_available"`
	SMSAvailable      bool `json:"sms_available"`
	// EffectiveChannel is the channel a request would use now ("" = none).
	EffectiveChannel string       `json:"effective_channel"`
	Template         TemplateInfo `json:"template"`
	Usage            Usage        `json:"usage"`
}

// UpdateSettingsInput changes settings; omitted (null) fields keep their value.
type UpdateSettingsInput struct {
	Enabled               *bool        `json:"enabled"`
	Channel               *string      `json:"channel"`
	DelayMinutes          *int         `json:"delay_minutes"`
	QuietHoursEnabled     *bool        `json:"quiet_hours_enabled"`
	QuietStartHour        *int         `json:"quiet_start_hour"`
	QuietEndHour          *int         `json:"quiet_end_hour"`
	GoogleReviewURL       *string      `json:"google_review_url"`
	HighScoreThreshold    *int         `json:"high_score_threshold"`
	MinDaysBetween        *int         `json:"min_days_between"`
	ConsentText           *string      `json:"consent_text"`
	DefaultLocale         *string      `json:"default_locale"`
	ExcludedCustomerUUIDs *[]uuid.UUID `json:"excluded_customer_uuids"`
}

// TestInput sends a test request; Phone defaults to the member's
// notification phone.
type TestInput struct {
	Phone string `json:"phone"`
}

// TestResult reports a test send.
type TestResult struct {
	Review    ReviewDetail `json:"review"`
	Channel   string       `json:"channel"`
	Phone     string       `json:"phone"`
	PublicURL string       `json:"public_url"`
}

// Review is one review request in lists.
type Review struct {
	UUID             uuid.UUID  `json:"uuid"`
	Kind             string     `json:"kind"`
	Status           string     `json:"status"`
	SkipReason       string     `json:"skip_reason"`
	Error            string     `json:"error"`
	Channel          string     `json:"channel"`
	Locale           string     `json:"locale"`
	CustomerUUID     *uuid.UUID `json:"customer_uuid"`
	CustomerName     string     `json:"customer_name"`
	CustomerPhone    string     `json:"customer_phone"`
	JobUUID          *uuid.UUID `json:"job_uuid"`
	Plate            string     `json:"plate"`
	Score            *int       `json:"score"`
	Comment          string     `json:"comment"`
	Rating           string     `json:"rating"` // high | low | ""
	GoogleRedirects  int        `json:"google_redirects"`
	FollowUpStatus   string     `json:"follow_up_status"` // none | required | done
	FollowUpNote     string     `json:"follow_up_note"`
	FollowedUpAt     *time.Time `json:"followed_up_at"`
	FollowedUpByName string     `json:"followed_up_by_name"`
	SendAt           time.Time  `json:"send_at"`
	Deferred         bool       `json:"deferred"`
	SentAt           *time.Time `json:"sent_at"`
	OpenedAt         *time.Time `json:"opened_at"`
	AnsweredAt       *time.Time `json:"answered_at"`
	ExpiresAt        *time.Time `json:"expires_at"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// ReviewDetail is the full review request.
type ReviewDetail struct {
	Review
	Consent            bool       `json:"consent"`
	ViewCount          int        `json:"view_count"`
	GoogleRedirectedAt *time.Time `json:"google_redirected_at"`
	CancelledAt        *time.Time `json:"cancelled_at"`
	// PublicURL is only returned for test requests.
	PublicURL string `json:"public_url,omitempty"`
}

// ListFilters narrows the list.
type ListFilters struct {
	Q            string
	Status       string // scheduled | sent | opened | answered | expired | cancelled | skipped | failed
	FollowUp     string // none | required | done
	Rating       string // high | low
	Score        int    // 1..5
	Channel      string // sms | whatsapp
	CustomerUUID *uuid.UUID
	Days         int
	IncludeTests bool
	Sort         string
}

// FollowUpInput marks a review handled ("ele alındı").
type FollowUpInput struct {
	Note string `json:"note"`
}

// ScoreCount is one bar of the distribution.
type ScoreCount struct {
	Score int   `json:"score"`
	Count int64 `json:"count"`
}

// TrendPoint is one week / month of the trend chart.
type TrendPoint struct {
	PeriodStart  string  `json:"period_start"`
	Sent         int64   `json:"sent"`
	Answered     int64   `json:"answered"`
	AverageScore float64 `json:"average_score"`
}

// Summary powers the tiles and the trend chart.
type Summary struct {
	Days             int          `json:"days"`
	Bucket           string       `json:"bucket"` // week | month
	SentCount        int64        `json:"sent_count"`
	OpenedCount      int64        `json:"opened_count"`
	AnsweredCount    int64        `json:"answered_count"`
	ScheduledCount   int64        `json:"scheduled_count"`
	ResponseRate     float64      `json:"response_rate"` // answered / sent (0..1)
	AverageScore     float64      `json:"average_score"`
	Distribution     []ScoreCount `json:"distribution"`
	Promoters        int64        `json:"promoters"`  // 5
	Passives         int64        `json:"passives"`   // 4
	Detractors       int64        `json:"detractors"` // 1-3
	NPS              int          `json:"nps"`        // promoters% - detractors%
	GoogleRedirects  int64        `json:"google_redirects"`
	FollowUpRequired int64        `json:"follow_up_required"`
	Trend            []TrendPoint `json:"trend"`
}

// Public page states.
const (
	PublicStateOpen     = "open"
	PublicStateAnswered = "answered"
	PublicStateExpired  = "expired"
)

// PublicReview is the customer page (no internal ids).
type PublicReview struct {
	State               string     `json:"state"`
	OrganizationName    string     `json:"organization_name"`
	OrganizationLogoURL *string    `json:"organization_logo_url"`
	OrganizationPhone   string     `json:"organization_phone"`
	PrimaryColor        string     `json:"primary_color"`
	CustomerFirstName   string     `json:"customer_first_name"`
	Locale              string     `json:"locale"`
	ConsentText         string     `json:"consent_text"`
	ExpiresAt           *time.Time `json:"expires_at"`
	Score               *int       `json:"score"`
	Comment             string     `json:"comment"`
	AnsweredAt          *time.Time `json:"answered_at"`
	// Result after answering: high (thank you + Google) | low (we'll call you).
	Result string `json:"result,omitempty"`
	// GoogleReviewURL is set only for high scores when configured.
	GoogleReviewURL string `json:"google_review_url,omitempty"`
}

// PublicAnswerInput is the customer's answer.
type PublicAnswerInput struct {
	Score   int    `json:"score"`
	Comment string `json:"comment"`
	Consent bool   `json:"consent"`
}

// GoogleRedirect is the counted redirect target.
type GoogleRedirect struct {
	URL string `json:"url"`
}

// ClientInfo identifies the public caller.
type ClientInfo struct {
	IP        string
	UserAgent string
}
