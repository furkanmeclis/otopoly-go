package usecase

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotConfigured is returned by the default (stub) seams below. The send
// flow records it on the delivery / reminder row; the UI offers retry and the
// manual fallbacks (copy share link, download PDF).
var ErrNotConfigured = errors.New("not configured")

// QuoteMessage is everything a messenger needs to deliver a quote to the
// customer: rendered data for the message template plus the PDF.
type QuoteMessage struct {
	OrganizationID   int64
	OrganizationUUID uuid.UUID
	OrganizationName string
	QuoteID          int64
	QuoteUUID        uuid.UUID
	QuoteNumber      string
	Status           string
	CustomerID       int64
	CustomerUUID     uuid.UUID
	CustomerName     string
	CustomerPhone    string
	CustomerEmail    string
	VehiclePlate     string
	VehicleLabel     string
	GrandTotal       string // "1250.00"
	Currency         string // "TRY"
	ValidUntil       *time.Time
	ShareURL         string // public link (/q/{token})
	// PDF bytes (nil when rendering failed; see PDFError). PDFObjectKey is the
	// API-owned storage key of the same document, PDFFileName a download name.
	PDF          []byte
	PDFObjectKey string
	PDFFileName  string
	PDFError     string
	Locale       string
	// DeliveryUUID / Attempt identify one "send to customer" attempt (zero
	// for reminders and previews); messengers use them for idempotency.
	DeliveryUUID uuid.UUID
	Attempt      int32
}

// QuoteSendResult is what a messenger reports back on success.
type QuoteSendResult struct {
	Channel     string // e.g. "whatsapp"
	ProviderRef string // provider message id (optional)
}

// QuoteMessenger sends a quote (message + PDF) to the customer. Implemented
// by the notification / message-template integration.
type QuoteMessenger interface {
	SendQuote(ctx context.Context, msg QuoteMessage) (QuoteSendResult, error)
}

// QuotePreview is the rendered customer message shown before sending.
type QuotePreview struct {
	Channel            string `json:"channel"`
	ChannelConnected   bool   `json:"channel_connected"`
	CustomerPhone      string `json:"customer_phone"`
	Message            string `json:"message"`
	TemplateActive     bool   `json:"template_active"`
	AttachmentFileName string `json:"attachment_file_name"`
}

// QuotePreviewer is optionally implemented by a QuoteMessenger.
type QuotePreviewer interface {
	PreviewQuote(ctx context.Context, msg QuoteMessage) (QuotePreview, error)
}

// QuoteEvent is published after a quote write (post-commit, fail-soft).
type QuoteEvent struct {
	Kind           string // created | sent | updated | status | decided (customer via share link)
	OrganizationID int64
	QuoteID        int64
	QuoteUUID      uuid.UUID
	Number         string
	Status         string
	GrandTotal     string
	Currency       string
	ValidUntil     *time.Time
	CreatedBy      int64
	// ActorID is the user who made the change (0 for system / public).
	ActorID int64
}

// QuoteNotifier reacts to quote changes (internal notifications). The
// default is a no-op.
type QuoteNotifier interface {
	QuoteChanged(ctx context.Context, ev QuoteEvent)
}

type noopNotifier struct{}

func (noopNotifier) QuoteChanged(context.Context, QuoteEvent) {}

// QuoteReminder is one desired reminder handed to the scheduler.
type QuoteReminder struct {
	ReminderID     int64
	ReminderUUID   uuid.UUID
	OrganizationID int64
	QuoteID        int64
	QuoteUUID      uuid.UUID
	Kind           string // before_3d | before_1d | last_day | custom
	OffsetDays     int
	FireAt         time.Time
	ExternalRef    string // set when the scheduler accepted it earlier
}

// ReminderScheduler schedules / cancels quote reminders. When a reminder
// fires, the integration calls Service.ReminderMessage (to render the
// template) and Service.CompleteReminder (to record the outcome). Schedule
// returns an optional external reference stored on the reminder row.
type ReminderScheduler interface {
	Schedule(ctx context.Context, r QuoteReminder) (externalRef string, err error)
	Cancel(ctx context.Context, r QuoteReminder) error
}

// NoopMessenger is the default messenger: it always reports ErrNotConfigured.
type NoopMessenger struct{}

// SendQuote implements QuoteMessenger.
func (NoopMessenger) SendQuote(context.Context, QuoteMessage) (QuoteSendResult, error) {
	return QuoteSendResult{}, ErrNotConfigured
}

// NoopReminderScheduler is the default scheduler: reminders stay "pending"
// with error "not configured"; Cancel is a no-op.
type NoopReminderScheduler struct{}

// Schedule implements ReminderScheduler.
func (NoopReminderScheduler) Schedule(context.Context, QuoteReminder) (string, error) {
	return "", ErrNotConfigured
}

// Cancel implements ReminderScheduler.
func (NoopReminderScheduler) Cancel(context.Context, QuoteReminder) error { return nil }
