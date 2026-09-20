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
	EventJobCreated     = "job.created"
	EventJobReady       = "job.ready"
	EventJobDelivered   = "job.delivered"
	EventJobCompleted   = "job.completed" // legacy alias of job.ready
	EventJobPaid        = "job.paid"
	EventJobCancelled   = "job.cancelled"
	EventSaleCreated    = "sale.created"

	SimulateModeEvent         = "event"
	SimulateModeJobLifecycle  = "job_lifecycle"

	OutboundStatusQueued = "queued"
	OutboundStatusSent   = "sent"
	OutboundStatusFailed = "failed"
)

// AllEvents returns all supported event types with their Turkish labels.
func AllEvents() []EventMeta {
	return []EventMeta{
		{Type: EventJobCreated, Label: "İş Oluşturuldu"},
		{Type: EventContractSigned, Label: "Sözleşme İmzalandı"},
		{Type: EventJobReady, Label: "Araç Teslime Hazır"},
		{Type: EventJobDelivered, Label: "Araç Teslim Edildi"},
		{Type: EventJobPaid, Label: "Ödeme Alındı"},
		{Type: EventJobCancelled, Label: "İş İptal Edildi"},
		{Type: EventSaleCreated, Label: "Satış Oluşturuldu"},
	}
}

// EventVariables returns the template variable names for an event.
func EventVariables(eventType string) []string {
	switch eventType {
	case EventContractSigned:
		return []string{"customer_name", "business_name", "contract_title", "plate"}
	case EventJobCreated, EventJobReady, EventJobDelivered, EventJobCompleted, EventJobCancelled:
		return []string{"customer_name", "business_name", "job_id", "plate"}
	case EventJobPaid, EventSaleCreated:
		return []string{"customer_name", "business_name", "amount", "currency", "plate"}
	default:
		return []string{"customer_name", "business_name"}
	}
}

// DefaultTemplate returns the seeded subject/body for an event+channel.
func DefaultTemplate(eventType, channel string) (subject, body string, ok bool) {
	_ = channel
	switch eventType {
	case EventJobCreated:
		return "Aracınız Kabul Edildi",
			"Sayın {{customer_name}},\n\nAracınız ({{plate}}) servisimize alındı. İş No: {{job_id}}\n\nGelişmeleri size bildireceğiz.\n{{business_name}}", true
	case EventContractSigned:
		return "Sözleşmeniz İmzalandı",
			"Sayın {{customer_name}},\n\n\"{{contract_title}}\" sözleşmeniz başarıyla imzalandı.\nPlaka: {{plate}}\n\nİyi günler dileriz.\n{{business_name}}", true
	case EventJobReady, EventJobCompleted:
		return "Aracınız Hazır",
			"Sayın {{customer_name}},\n\nAracınızın işlemi tamamlandı, teslime hazır.\nİş No: {{job_id}} | Plaka: {{plate}}\n\nİyi günler dileriz.\n{{business_name}}", true
	case EventJobDelivered:
		return "Aracınız Teslim Edildi",
			"Sayın {{customer_name}},\n\nAracınız ({{plate}}) teslim edildi. İş No: {{job_id}}\n\nBizi tercih ettiğiniz için teşekkürler.\n{{business_name}}", true
	case EventJobPaid:
		return "Ödemeniz Alındı",
			"Sayın {{customer_name}},\n\nÖdemeniz başarıyla alındı. Tutar: {{amount}} {{currency}}\nPlaka: {{plate}}\n\nTeşekkür ederiz.\n{{business_name}}", true
	case EventJobCancelled:
		return "İşlem İptal Edildi",
			"Sayın {{customer_name}},\n\n{{plate}} plakalı aracınız için işlem iptal edildi. İş No: {{job_id}}\n\nSorularınız için bize ulaşabilirsiniz.\n{{business_name}}", true
	case EventSaleCreated:
		return "Satışınız Oluşturuldu",
			"Sayın {{customer_name}},\n\nSatışınız oluşturuldu. Tutar: {{amount}} {{currency}}\n\nTeşekkür ederiz.\n{{business_name}}", true
	default:
		return "", "", false
	}
}

// SampleVars returns demo values for live preview / simulate.
func SampleVars(eventType string) map[string]string {
	base := map[string]string{
		"customer_name":  "Ahmet Yılmaz",
		"business_name":  "Tech Oto",
		"job_id":         "JOB-DEMO-001",
		"plate":          "34 ABC 123",
		"amount":         "1.250,00",
		"currency":       "TRY",
		"contract_title": "Hizmet Sözleşmesi",
		"sale_uuid":      "sale-demo",
		"instance_uuid":  "contract-demo",
	}
	_ = eventType
	return base
}

// JobLifecycleEvents is the ordered customer-facing job pipeline for simulate.
func JobLifecycleEvents() []string {
	return []string{
		EventJobCreated,
		EventContractSigned,
		EventJobReady,
		EventJobDelivered,
		EventJobPaid,
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
	QRCode       string     `json:"qr_code,omitempty"`
	QRExpiresAt  *time.Time `json:"qr_expires_at,omitempty"`
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
	// Force ignores notification rules (used by simulate / test send).
	Force bool
}

// SimulateInput drives a test send for one event or the full job lifecycle.
type SimulateInput struct {
	Mode      string            `json:"mode"`
	EventType string            `json:"event_type"`
	Channel   string            `json:"channel"`
	Phone     string            `json:"phone"`
	Vars      map[string]string `json:"vars"`
}

// SimulateResultItem is one channel send outcome.
type SimulateResultItem struct {
	EventType         string `json:"event_type"`
	Channel           string `json:"channel"`
	Status            string `json:"status"`
	Body              string `json:"body,omitempty"`
	ProviderReference string `json:"provider_reference,omitempty"`
	ErrorMessage      string `json:"error_message,omitempty"`
}

// SimulateResult is the response for a simulate request.
type SimulateResult struct {
	Items []SimulateResultItem `json:"items"`
}
