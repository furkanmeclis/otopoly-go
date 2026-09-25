// Package model holds the public types of the central notification service.
// Other modules import only this package plus the usecase.Service methods
// (Schedule / CancelBySubject / Dispatch).
package model

import (
	"time"

	"github.com/google/uuid"
)

// Channels handled by the center.
const (
	ChannelInapp    = "inapp"
	ChannelEmail    = "email"
	ChannelWhatsApp = "whatsapp"
	ChannelSMS      = "sms"
)

// AllChannels in display order.
var AllChannels = []string{ChannelInapp, ChannelEmail, ChannelWhatsApp, ChannelSMS}

// Scheduled row statuses.
const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusSent       = "sent"
	StatusCancelled  = "cancelled"
	StatusFailed     = "failed"
)

// Subject types used by core modules.
const (
	SubjectTodo  = "todo"
	SubjectQuote = "quote"
	SubjectLead  = "lead"
)

// Attachment is an optional document sent with WhatsApp (and e-mail later).
// Prefer ObjectKey (an object already in storage, e.g. a quote PDF); Data is
// uploaded to storage by the center before the send is queued.
type Attachment struct {
	ObjectKey string `json:"object_key,omitempty"`
	Data      []byte `json:"-"`
	FileName  string `json:"file_name"`
	MimeType  string `json:"mime_type"`
}

// Recipient is exactly one of: an organization member (UserID), a customer
// (CustomerID, phone/email looked up), or a raw phone/e-mail.
type Recipient struct {
	UserID     int64
	CustomerID int64
	Phone      string
	Email      string
}

// Notification is one message to one recipient.
//
//   - Kind is a msgtemplate type ("todo.reminder", "quote.sent", ...): it picks
//     the template (per org override → system default, per locale) and the
//     user-preference row.
//   - Channels: empty → user preferences (member recipients) or the org's
//     notification rules for Kind (customer recipients). Non-empty → exactly
//     these channels (still limited to channels the recipient can receive and
//     whose template is active).
//   - DedupeKey: optional; defaults to kind:subject:recipient:slot. It is
//     scoped per organization and guarantees at-most-once delivery.
type Notification struct {
	OrgID       int64 // 0 → taken from orgctx
	Kind        string
	SubjectType string
	SubjectID   int64
	Recipient   Recipient
	Channels    []string
	Vars        map[string]string
	Locale      string // "" → user locale / "tr"
	ActionURL   string // in-app link (relative app path)
	Attachment  *Attachment
	DedupeKey   string
	MaxAttempts int32 // default 5
	CreatedBy   int64
}

// ScheduledNotification is a Notification that fires at FireAt.
type ScheduledNotification struct {
	Notification
	FireAt time.Time
}

// Result describes the stored row after Schedule / Dispatch.
type Result struct {
	UUID      uuid.UUID `json:"uuid"`
	Status    string    `json:"status"`
	Duplicate bool      `json:"duplicate"`
	// Delivered lists channels handed off by Dispatch (empty for Schedule).
	Delivered []string `json:"delivered,omitempty"`
	LastError string   `json:"last_error,omitempty"`
}

// ChannelPrefs is one type's channel switches for a member.
type ChannelPrefs struct {
	Inapp    bool `json:"inapp"`
	Email    bool `json:"email"`
	WhatsApp bool `json:"whatsapp"`
	SMS      bool `json:"sms"`
}

// Enabled reports a channel switch.
func (p ChannelPrefs) Enabled(ch string) bool {
	switch ch {
	case ChannelInapp:
		return p.Inapp
	case ChannelEmail:
		return p.Email
	case ChannelWhatsApp:
		return p.WhatsApp
	case ChannelSMS:
		return p.SMS
	}
	return false
}

// TypePreference is the API projection of one notification type.
type TypePreference struct {
	Type     string       `json:"type"`
	Channels []string     `json:"channels"`
	Prefs    ChannelPrefs `json:"prefs"`
	Custom   bool         `json:"custom"`
}

// Preferences is the member's notification preference page.
type Preferences struct {
	Phone string           `json:"phone"`
	Types []TypePreference `json:"types"`
}

// PreferencesInput updates the page.
type PreferencesInput struct {
	Phone *string `json:"phone"`
	Types []struct {
		Type  string       `json:"type"`
		Prefs ChannelPrefs `json:"prefs"`
	} `json:"types"`
}
