// Package usecase is the central notification service: one entry point
// (Schedule / Dispatch / CancelBySubject) that renders per-org templates and
// fans a notification out to in-app, e-mail, WhatsApp and SMS according to
// user preferences (members) or organization rules (customers).
package usecase

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	notifmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/model"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Querier is the persistence surface (satisfied by *db.Queries).
type Querier interface {
	InsertScheduledNotification(ctx context.Context, arg db.InsertScheduledNotificationParams) (db.ScheduledNotification, error)
	GetScheduledNotificationByKey(ctx context.Context, arg db.GetScheduledNotificationByKeyParams) (db.ScheduledNotification, error)
	ClaimDueScheduledNotifications(ctx context.Context, arg db.ClaimDueScheduledNotificationsParams) ([]db.ScheduledNotification, error)
	ClaimScheduledNotificationByID(ctx context.Context, id int64) (db.ScheduledNotification, error)
	MarkScheduledNotificationSent(ctx context.Context, arg db.MarkScheduledNotificationSentParams) (db.ScheduledNotification, error)
	MarkScheduledNotificationRetry(ctx context.Context, arg db.MarkScheduledNotificationRetryParams) (db.ScheduledNotification, error)
	MarkScheduledNotificationCancelled(ctx context.Context, arg db.MarkScheduledNotificationCancelledParams) (db.ScheduledNotification, error)
	ReleaseStuckScheduledNotifications(ctx context.Context, staleBefore pgtype.Timestamptz) (int64, error)
	CancelScheduledNotificationsBySubject(ctx context.Context, arg db.CancelScheduledNotificationsBySubjectParams) (int64, error)
	ListScheduledNotificationsBySubject(ctx context.Context, arg db.ListScheduledNotificationsBySubjectParams) ([]db.ScheduledNotification, error)
	ListPendingRemindersForSubjects(ctx context.Context, arg db.ListPendingRemindersForSubjectsParams) ([]db.ListPendingRemindersForSubjectsRow, error)
	ListNotificationTypePreferences(ctx context.Context, arg db.ListNotificationTypePreferencesParams) ([]db.NotificationTypePreference, error)
	GetNotificationTypePreference(ctx context.Context, arg db.GetNotificationTypePreferenceParams) (db.NotificationTypePreference, error)
	UpsertNotificationTypePreference(ctx context.Context, arg db.UpsertNotificationTypePreferenceParams) (db.NotificationTypePreference, error)
	GetNotificationMemberSettings(ctx context.Context, arg db.GetNotificationMemberSettingsParams) (db.NotificationMemberSetting, error)
	UpsertNotificationMemberSettings(ctx context.Context, arg db.UpsertNotificationMemberSettingsParams) (db.NotificationMemberSetting, error)
	GetNotificationRecipientUser(ctx context.Context, arg db.GetNotificationRecipientUserParams) (db.GetNotificationRecipientUserRow, error)
	GetNotificationRecipientCustomer(ctx context.Context, arg db.GetNotificationRecipientCustomerParams) (db.GetNotificationRecipientCustomerRow, error)
	GetNotificationOrganization(ctx context.Context, id int64) (db.GetNotificationOrganizationRow, error)
}

// Inbox delivers in-app and e-mail notifications (notifications module).
type Inbox interface {
	Enqueue(ctx context.Context, in notifmodel.EnqueueInput) ([]notifmodel.Notification, error)
}

// Template is a resolved message template.
type Template struct {
	Subject string
	Body    string
	Active  bool
}

// OutboundMessage is a rendered WhatsApp/SMS message.
type OutboundMessage struct {
	OrgID                   int64
	Kind                    string
	Channel                 string
	Phone                   string
	Body                    string
	AttachmentKey           string
	AttachmentName          string
	AttachmentMime          string
	AttachmentData          []byte
	SubjectType             string
	SubjectUUID             *uuid.UUID
	ScheduledNotificationID int64
	// Vars are the rendered template variables (platform catalog params).
	Vars map[string]string
}

// Messenger is the messaging module (templates, org rules, WhatsApp/SMS queue).
type Messenger interface {
	ResolveTemplate(ctx context.Context, orgID int64, kind, channel, locale string) (Template, bool, error)
	RuleChannels(ctx context.Context, orgID int64, kind string) ([]string, error)
	QueueSend(ctx context.Context, msg OutboundMessage) error
}

// Guard reports whether a subject is still eligible at send time (e.g. the
// todo is still open). Returning false cancels the notification.
type Guard func(ctx context.Context, orgID, subjectID int64) (bool, error)

// Preparer is a guard that can also refresh template variables at send time
// (e.g. a quote reminder re-reads the current total). Skip=true cancels the
// notification like a Guard returning false. Vars override the stored vars.
type Preparer func(ctx context.Context, orgID, subjectID int64) (Prepared, error)

// Prepared is the outcome of a Preparer.
type Prepared struct {
	Skip bool
	Vars map[string]string
}

// SentEvent describes the stored outcome of one delivery attempt.
type SentEvent struct {
	OrgID       int64
	UUID        uuid.UUID
	Kind        string
	SubjectType string
	SubjectID   int64
	// Status is the row status after the attempt: sent | pending (retry
	// scheduled) | failed (attempts exhausted) | cancelled.
	Status    string
	Delivered []string
	LastError string
	// Skipped: a Guard / Preparer declined the subject (no longer eligible).
	Skipped bool
}

// SentHook runs after every delivery attempt of a subject type (Dispatch and
// sweep). It must be quick and must not fail the delivery.
type SentHook func(ctx context.Context, ev SentEvent)
