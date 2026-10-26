package usecase

import (
	"context"
	"errors"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

// SMS send classes (platform/sms).
const (
	smsClassTransactional = "transactional"
	smsClassOTP           = "otp"
)

// SMSChannel delivers SMS through the organization's active provider
// account (smschannel.Service).
type SMSChannel interface {
	Available(ctx context.Context, orgID int64) (bool, error)
	Deliver(ctx context.Context, orgID int64, phone, body, class string) (model.SMSDelivery, error)
}

// SetSMSChannel installs the organization SMS channel. Without it SMS falls
// back to the legacy channel sender (no-op).
func (s *Service) SetSMSChannel(c SMSChannel) *Service {
	s.smsCh = c
	return s
}

// SMSAvailable reports whether the organization has an active SMS provider.
func (s *Service) SMSAvailable(ctx context.Context, orgID int64) (bool, error) {
	if s.smsCh == nil {
		return false, nil
	}
	return s.smsCh.Available(ctx, orgID)
}

// ChannelAvailable reports whether messages on channel can be sent now.
func (s *Service) ChannelAvailable(ctx context.Context, orgID int64, channel string) (bool, error) {
	switch channel {
	case model.ChannelSMS:
		return s.SMSAvailable(ctx, orgID)
	case model.ChannelWhatsApp:
		return s.WhatsAppAvailable(ctx, orgID)
	default:
		return false, nil
	}
}

func (s *Service) deliverSMS(ctx context.Context, orgID int64, phone, body, class string) (deliveryResult, error) {
	if _, ok := orgctx.ScopeFrom(ctx); !ok && orgID > 0 {
		ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: orgID})
	}
	d, err := s.smsCh.Deliver(ctx, orgID, phone, body, class)
	res := deliveryResult{Ref: d.MessageID, DeliveryStatus: d.Status}
	if d.Provider != "" {
		res.SenderKind = model.SMSSenderKind(d.Provider)
	}
	return res, err
}

// recordDeliveryStatus stores the provider's initial status of an SMS.
func (s *Service) recordDeliveryStatus(ctx context.Context, orgID, id int64, res deliveryResult, sendErr error) {
	if sendErr != nil || res.DeliveryStatus == "" || id == 0 {
		return
	}
	_ = s.q.SetOutboundMessageDeliveryStatus(ctx, db.SetOutboundMessageDeliveryStatusParams{
		ID: id, OrganizationID: orgID, DeliveryStatus: optText(res.DeliveryStatus),
	})
}

// LogSMSTest records a channel-settings test SMS in the outbound log
// (smschannel.TestSender). The body is not stored.
func (s *Service) LogSMSTest(ctx context.Context, orgID int64, phone string, d model.SMSDelivery, sendErr error) {
	res := deliveryResult{Ref: d.MessageID, DeliveryStatus: d.Status}
	if d.Provider != "" {
		res.SenderKind = model.SMSSenderKind(d.Provider)
	}
	var se *model.SendError
	if sendErr != nil && !errors.As(sendErr, &se) {
		sendErr = model.NewSendError(model.ErrCodeSendFailed, false, sendErr)
	}
	s.logOutbound(ctx, outboundLog{
		OrgID: orgID, EventType: model.EventSMSTest, Channel: model.ChannelSMS, Phone: phone,
		SubjectType: "sms_test",
	}, res, sendErr)
}
