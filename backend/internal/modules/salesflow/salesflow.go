// Package salesflow integrates leads & quotes with the notification center
// and todos:
//
//   - QuoteMessenger: "send to customer" through notifycenter.Dispatch
//     (WhatsApp first, e-mail when the organization rule and the customer allow).
//   - ReminderScheduler: quote reminders through notifycenter.Schedule, with a
//     send-time Preparer (skips closed quotes, refreshes vars) and a SentHook
//     that records the outcome on the quote reminder.
//   - Notifier: team notifications (quote.team_created, quote.team_expiring).
//   - Links: the todos LinkResolver for leads and quotes (org-scoped, batched).
//   - OutboundFailed: mirrors a late WhatsApp failure onto quote rows.
//
// Wiring lives in internal/httpserver/server.go.
package salesflow

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
	_ "time/tzdata" // Europe/Istanbul in minimal containers.

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

// Notification kinds and subject types owned by this integration.
const (
	KindQuoteSent         = "quote.sent"
	KindQuoteReminder     = "quote.reminder"
	KindQuoteExpiring     = "quote.expiring"
	KindQuoteTeamCreated  = "quote.team_created"
	KindQuoteTeamExpiring = "quote.team_expiring"
	KindQuoteTeamAccepted = "quote.team_accepted"
	KindQuoteTeamRejected = "quote.team_rejected"

	// SubjectQuote: one-off quote notifications (send, team created).
	SubjectQuote = centermodel.SubjectQuote
	// SubjectQuoteReminder: customer reminders; subject id = quote_reminders.id.
	SubjectQuoteReminder = "quote_reminder"
	// SubjectQuoteExpiry: team "expires tomorrow"; subject id = quotes.id.
	SubjectQuoteExpiry = "quote_expiry"

	teamExpiryHour = 10
)

// Stable error prefixes (the UI maps them to localized hints).
var (
	ErrWhatsAppNotConnected = errors.New("whatsapp_not_connected: WhatsApp is not connected (Settings > Messages)")
	ErrCustomerNoPhone      = errors.New("customer_no_phone: the customer has no phone number")
)

// Center is the notification center surface used here.
type Center interface {
	Dispatch(ctx context.Context, n centermodel.Notification) (centermodel.Result, error)
	Schedule(ctx context.Context, sn centermodel.ScheduledNotification) (centermodel.Result, error)
	CancelBySubject(ctx context.Context, subjectType string, subjectID int64) (int64, error)
}

// Channels is the organization messaging state (messaging module).
type Channels interface {
	WhatsAppConnected(ctx context.Context, orgID int64) (bool, error)
	RuleChannels(ctx context.Context, orgID int64, kind string) ([]string, error)
	ResolveTemplate(ctx context.Context, orgID int64, kind, channel, locale string) (centerusecase.Template, bool, error)
}

// Quotes is the quotes service surface used by reminders.
type Quotes interface {
	ReminderUUID(ctx context.Context, orgID, reminderID int64) (uuid.UUID, error)
	ReminderMessage(ctx context.Context, reminderUUID uuid.UUID) (quotesusecase.QuoteMessage, quotesusecase.QuoteReminder, error)
	CompleteReminder(ctx context.Context, reminderUUID uuid.UUID, sendErr error) error
	AsyncSendFailed(ctx context.Context, orgID int64, ref, reason string) error
}

// Store is the persistence surface (satisfied by *db.Queries).
type Store interface {
	GetQuoteRowByUUID(ctx context.Context, arg db.GetQuoteRowByUUIDParams) (db.Quote, error)
	GetQuoteRowByID(ctx context.Context, id int64) (db.Quote, error)
	GetQuoteNotifyPeople(ctx context.Context, arg db.GetQuoteNotifyPeopleParams) (db.GetQuoteNotifyPeopleRow, error)
	ListQuoteDecisionRecipients(ctx context.Context, arg db.ListQuoteDecisionRecipientsParams) ([]int64, error)
	GetNotificationOrganization(ctx context.Context, id int64) (db.GetNotificationOrganizationRow, error)
	ResolveTodoLeadLink(ctx context.Context, arg db.ResolveTodoLeadLinkParams) (int64, error)
	ResolveTodoQuoteLink(ctx context.Context, arg db.ResolveTodoQuoteLinkParams) (int64, error)
	DescribeTodoLeadLinks(ctx context.Context, arg db.DescribeTodoLeadLinksParams) ([]db.DescribeTodoLeadLinksRow, error)
	DescribeTodoQuoteLinks(ctx context.Context, arg db.DescribeTodoQuoteLinksParams) ([]db.DescribeTodoQuoteLinksRow, error)
}

// Integration bundles the adapters. Build with New, then pass it to
// quotesSvc.SetMessenger / SetReminderScheduler / SetNotifier,
// todosSvc.SetLinkResolver and call Register on the center.
type Integration struct {
	center   Center
	channels Channels
	quotes   Quotes
	store    Store
	log      *slog.Logger
	loc      *time.Location
	now      func() time.Time
}

// New builds the integration. quotes may be set later with SetQuotes (the
// quotes service is constructed after the center).
func New(center Center, channels Channels, store Store, log *slog.Logger) *Integration {
	if log == nil {
		log = slog.Default()
	}
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Integration{center: center, channels: channels, store: store, log: log, loc: loc, now: time.Now}
}

// SetQuotes installs the quotes service (reminder guard / completion).
func (x *Integration) SetQuotes(q Quotes) { x.quotes = q }

// SetClock overrides time (tests).
func (x *Integration) SetClock(now func() time.Time) { x.now = now }

// Registrar is the center's hook registration surface.
type Registrar interface {
	RegisterGuard(subjectType string, g centerusecase.Guard)
	RegisterPreparer(subjectType string, p centerusecase.Preparer)
	RegisterSentHook(subjectType string, h centerusecase.SentHook)
}

// Register installs the send-time preparer / guard and the sent hook.
func (x *Integration) Register(r Registrar) {
	r.RegisterPreparer(SubjectQuoteReminder, x.PrepareReminder)
	r.RegisterSentHook(SubjectQuoteReminder, x.ReminderSent)
	r.RegisterGuard(SubjectQuoteExpiry, x.ExpiryGuard)
}

// withOrg makes sure ctx carries the organization scope (worker contexts
// have none; request contexts already carry the same org).
func withOrg(ctx context.Context, orgID int64) context.Context {
	if sc, ok := orgctx.ScopeFrom(ctx); ok && sc.InternalID == orgID {
		return ctx
	}
	return orgctx.WithScope(ctx, orgctx.Scope{InternalID: orgID})
}

func appPath(ctx context.Context, format string, args ...any) string {
	sc, ok := orgctx.ScopeFrom(ctx)
	if !ok || sc.Slug == "" {
		return ""
	}
	return "/t/" + sc.Slug + fmt.Sprintf(format, args...)
}
