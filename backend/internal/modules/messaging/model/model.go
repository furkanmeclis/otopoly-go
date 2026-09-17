package model

import (
	"time"

	"github.com/google/uuid"
)

const (
	StatusDisconnected = "disconnected"
	StatusQRPending    = "qr_pending"
	StatusConnected    = "connected"
	StatusError        = "error"

	ChannelWhatsApp = "whatsapp"
	ChannelSMS      = "sms"

	EventContractSigned = "contract.signed"
	EventJobCompleted   = "job.completed"
	EventJobPaid        = "job.paid"
	EventSaleCreated    = "sale.created"

	OutboundStatusQueued = "queued"
	OutboundStatusSent   = "sent"
	OutboundStatusFailed = "failed"
)

// AllEvents returns all supported event types with their Turkish labels.
func AllEvents() []EventMeta {
	return []EventMeta{
		{Type: EventContractSigned, Label: "Sözleşme İmzalandı"},
		{Type: EventJobCompleted, Label: "İş Tamamlandı"},
		{Type: EventJobPaid, Label: "Ödeme Alındı"},
		{Type: EventSaleCreated, Label: "Satış Oluşturuldu"},
	}
}

type EventMeta struct {
	Type  string `json:"type"`
	Label string `json:"label"`
}

type WhatsAppSession struct {
	UUID         uuid.UUID  `json:"uuid"`
	Status       string     `json:"status"`
	JID          string     `json:"jid,omitempty"`
	PhoneNumber  string     `json:"phone_number,omitempty"`
	DisplayName  string     `json:"display_name,omitempty"`
	LastSeenAt   *time.Time `json:"last_seen_at,omitempty"`
	ErrorMessage string     `json:"error_message,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type NotificationRule struct {
	UUID      uuid.UUID `json:"uuid"`
	EventType string    `json:"event_type"`
	Channel   string    `json:"channel"`
	Enabled   bool      `json:"enabled"`
}

type RuleList struct {
	EventType  string             `json:"event_type"`
	EventLabel string             `json:"event_label"`
	Rules      []NotificationRule `json:"rules"`
}

type MessageTemplate struct {
	UUID      uuid.UUID `json:"uuid"`
	EventType string    `json:"event_type"`
	Channel   string    `json:"channel"`
	Locale    string    `json:"locale"`
	Subject   string    `json:"subject"`
	Body      string    `json:"body"`
	Variables []string  `json:"variables"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type OutboundMessage struct {
	UUID              uuid.UUID  `json:"uuid"`
	EventType         string     `json:"event_type"`
	Channel           string     `json:"channel"`
	RecipientPhone    string     `json:"recipient_phone"`
	Status            string     `json:"status"`
	ProviderReference string     `json:"provider_reference,omitempty"`
	ErrorMessage      string     `json:"error_message,omitempty"`
	SubjectType       string     `json:"subject_type,omitempty"`
	SubjectUUID       *uuid.UUID `json:"subject_uuid,omitempty"`
	SentAt            *time.Time `json:"sent_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

// QRCodeResponse is returned when connecting a WhatsApp session.
type QRCodeResponse struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Input types
type UpsertTemplateInput struct {
	EventType string   `json:"event_type"`
	Channel   string   `json:"channel"`
	Locale    string   `json:"locale"`
	Subject   string   `json:"subject"`
	Body      string   `json:"body"`
	Variables []string `json:"variables"`
}

type PatchTemplateInput struct {
	Subject   *string  `json:"subject"`
	Body      *string  `json:"body"`
	Variables []string `json:"variables"`
	IsActive  *bool    `json:"is_active"`
}

// DispatchInput is the payload the event handler passes to Send.
type DispatchInput struct {
	OrgID          int64
	EventType      string
	RecipientPhone string
	Vars           map[string]string
	SubjectType    string
	SubjectUUID    *uuid.UUID
}
