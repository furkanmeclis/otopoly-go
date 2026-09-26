package messaging

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
)

// CenterMessenger adapts the messaging service to the notification center
// (templates, organization rules and queued WhatsApp/SMS sends).
type CenterMessenger struct {
	svc   *messagingusecase.Service
	rules interface {
		ListNotificationRulesByOrg(ctx context.Context, organizationID int64) ([]db.NotificationRule, error)
	}
}

// NewCenterMessenger wraps the messaging service.
func NewCenterMessenger(svc *messagingusecase.Service, q *db.Queries) *CenterMessenger {
	return &CenterMessenger{svc: svc, rules: q}
}

var _ centerusecase.Messenger = (*CenterMessenger)(nil)

// ResolveTemplate returns the effective org template.
func (m *CenterMessenger) ResolveTemplate(ctx context.Context, orgID int64, kind, channel, locale string) (centerusecase.Template, bool, error) {
	t, found, err := m.svc.ResolveTemplate(ctx, orgID, kind, channel, locale)
	if err != nil || !found {
		return centerusecase.Template{}, found, err
	}
	return centerusecase.Template{Subject: t.Subject, Body: t.Body, Active: t.Active}, true, nil
}

// RuleChannels returns the organization's enabled channels for a customer event.
func (m *CenterMessenger) RuleChannels(ctx context.Context, orgID int64, kind string) ([]string, error) {
	rows, err := m.rules.ListNotificationRulesByOrg(ctx, orgID)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, r := range rows {
		if r.EventType == kind && r.Enabled {
			out = append(out, r.Channel)
		}
	}
	return out, nil
}

// QueueSend persists and queues a WhatsApp/SMS message.
func (m *CenterMessenger) QueueSend(ctx context.Context, msg centerusecase.OutboundMessage) error {
	var att *messagingusecase.OutboundAttachment
	if msg.AttachmentKey != "" || len(msg.AttachmentData) > 0 {
		att = &messagingusecase.OutboundAttachment{
			ObjectKey: msg.AttachmentKey, FileName: msg.AttachmentName,
			MimeType: msg.AttachmentMime, Data: msg.AttachmentData,
		}
	}
	_, err := m.svc.QueueSend(ctx, messagingusecase.OutboundRequest{
		OrgID: msg.OrgID, EventType: msg.Kind, Channel: msg.Channel, Phone: msg.Phone, Body: msg.Body,
		Attachment: att, SubjectType: msg.SubjectType, SubjectUUID: msg.SubjectUUID,
		ScheduledNotificationID: msg.ScheduledNotificationID,
	})
	return err
}

// WhatsAppConnected reports whether the organization's WhatsApp line is connected.
func (m *CenterMessenger) WhatsAppConnected(ctx context.Context, orgID int64) (bool, error) {
	s, err := m.svc.GetSession(ctx, orgID)
	if err != nil {
		return false, err
	}
	return s.Status == messagingmodel.StatusConnected, nil
}
