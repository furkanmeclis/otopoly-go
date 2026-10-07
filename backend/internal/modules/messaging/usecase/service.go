package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/catalog"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrForbidden      = errors.New("forbidden")
	ErrInvalidRequest = errors.New("invalid request")
)

// Querier is the persistence surface used by the messaging service.
type Querier interface {
	GetWhatsAppSession(ctx context.Context, organizationID int64) (db.WhatsappSession, error)
	ListConnectedWhatsAppSessions(ctx context.Context) ([]db.WhatsappSession, error)
	UpsertWhatsAppSession(ctx context.Context, arg db.UpsertWhatsAppSessionParams) (db.WhatsappSession, error)
	UpdateWhatsAppSessionQR(ctx context.Context, arg db.UpdateWhatsAppSessionQRParams) (db.WhatsappSession, error)
	UpsertNotificationRule(ctx context.Context, arg db.UpsertNotificationRuleParams) (db.NotificationRule, error)
	ListNotificationRulesByOrg(ctx context.Context, organizationID int64) ([]db.NotificationRule, error)
	GetNotificationRule(ctx context.Context, arg db.GetNotificationRuleParams) (db.NotificationRule, error)
	UpsertMessageTemplate(ctx context.Context, arg db.UpsertMessageTemplateParams) (db.MessageTemplate, error)
	ListMessageTemplatesByOrg(ctx context.Context, organizationID int64) ([]db.MessageTemplate, error)
	GetMessageTemplate(ctx context.Context, arg db.GetMessageTemplateParams) (db.MessageTemplate, error)
	GetMessageTemplateByKey(ctx context.Context, arg db.GetMessageTemplateByKeyParams) (db.MessageTemplate, error)
	DeleteMessageTemplate(ctx context.Context, arg db.DeleteMessageTemplateParams) error
	InsertOutboundMessage(ctx context.Context, arg db.InsertOutboundMessageParams) (db.OutboundMessage, error)
	UpdateOutboundMessageStatus(ctx context.Context, arg db.UpdateOutboundMessageStatusParams) (db.OutboundMessage, error)
	GetMessageTemplateDefault(ctx context.Context, arg db.GetMessageTemplateDefaultParams) (db.MessageTemplateDefault, error)
	ListMessageTemplateDefaults(ctx context.Context) ([]db.MessageTemplateDefault, error)
	GetMessageTemplateOverride(ctx context.Context, arg db.GetMessageTemplateOverrideParams) (db.MessageTemplate, error)
	DeleteMessageTemplateByKey(ctx context.Context, arg db.DeleteMessageTemplateByKeyParams) (int64, error)
	InsertQueuedOutboundMessage(ctx context.Context, arg db.InsertQueuedOutboundMessageParams) (db.OutboundMessage, error)
	ClaimOutboundMessage(ctx context.Context, id int64) (db.OutboundMessage, error)
	FinishOutboundMessage(ctx context.Context, arg db.FinishOutboundMessageParams) (db.OutboundMessage, error)
	ListOutboundMessagesByOrg(ctx context.Context, arg db.ListOutboundMessagesByOrgParams) ([]db.OutboundMessage, error)
	CountOutboundMessagesByOrg(ctx context.Context, organizationID int64) (int64, error)
	SetOutboundMessageSender(ctx context.Context, arg db.SetOutboundMessageSenderParams) error
	SetWhatsAppSessionFallback(ctx context.Context, arg db.SetWhatsAppSessionFallbackParams) (db.WhatsappSession, error)
	// Platform sender.
	GetPlatformWhatsAppSettings(ctx context.Context) (db.PlatformWhatsappSetting, error)
	UpdatePlatformWhatsAppSession(ctx context.Context, arg db.UpdatePlatformWhatsAppSessionParams) (db.PlatformWhatsappSetting, error)
	UpdatePlatformWhatsAppQR(ctx context.Context, arg db.UpdatePlatformWhatsAppQRParams) (db.PlatformWhatsappSetting, error)
	GetWhatsAppCloudTemplateByKey(ctx context.Context, key string) (db.WhatsappCloudTemplate, error)
}

// ChannelSender is a generic send interface for a messaging channel.
type ChannelSender interface {
	Channel() string
	Send(ctx context.Context, phone, body string) (string, error)
}

// Service orchestrates messaging: sessions, rules, templates, dispatch.
type Service struct {
	q        Querier
	wp       *providers.WhatsAppProvider
	sms      *providers.NoopSMSProvider
	channels map[string]ChannelSender
	enq      Enqueuer
	store    storage.Driver
	observer OutboundObserver
	ent      *entitlements.Service
	cloud    CloudSender
	// platformInfo is the platform brand used by platform-number messages.
	platformInfo PlatformInfoFunc
}

// New builds a messaging service.
func New(q Querier, wp *providers.WhatsAppProvider, sms *providers.NoopSMSProvider) *Service {
	s := &Service{
		q:        q,
		wp:       wp,
		sms:      sms,
		channels: make(map[string]ChannelSender),
	}
	if wp != nil {
		s.channels[model.ChannelWhatsApp] = wp
	}
	if sms != nil {
		s.channels[model.ChannelSMS] = sms
	}
	return s
}

func (s *Service) SetEntitlements(e *entitlements.Service) { s.ent = e }

// SetCloudSender installs the WhatsApp Cloud API sender (platform number).
func (s *Service) SetCloudSender(c CloudSender) *Service {
	s.cloud = c
	return s
}

// --- WhatsApp Session ---

// GetSession returns the own-number session plus the sender routing flags.
func (s *Service) GetSession(ctx context.Context, orgID int64) (model.WhatsAppSession, error) {
	out := model.WhatsAppSession{Status: model.StatusDisconnected, FallbackToPlatform: true}
	row, err := s.q.GetWhatsAppSession(ctx, orgID)
	switch {
	case err == nil:
		out = mapSession(row)
	case !errors.Is(err, pgx.ErrNoRows):
		return model.WhatsAppSession{}, fmt.Errorf("GetSession: %w", err)
	}
	if out.OwnNumberEntitled, err = s.ownNumberEntitled(ctx, orgID); err != nil {
		return model.WhatsAppSession{}, fmt.Errorf("GetSession entitlement: %w", err)
	}
	if _, err := s.platformKind(ctx); err == nil {
		out.PlatformSenderAvailable = true
	} else if model.ErrorCodeOf(err) == "" {
		return model.WhatsAppSession{}, fmt.Errorf("GetSession platform: %w", err)
	}
	return out, nil
}

// SessionSettingsInput updates own-session routing settings.
type SessionSettingsInput struct {
	FallbackToPlatform *bool `json:"fallback_to_platform"`
}

// UpdateSessionSettings stores fallback_to_platform for the organization.
func (s *Service) UpdateSessionSettings(ctx context.Context, orgID int64, in SessionSettingsInput) (model.WhatsAppSession, error) {
	if in.FallbackToPlatform == nil {
		return model.WhatsAppSession{}, fmt.Errorf("%w: fallback_to_platform is required", ErrInvalidRequest)
	}
	if _, err := s.q.SetWhatsAppSessionFallback(ctx, db.SetWhatsAppSessionFallbackParams{
		OrganizationID: orgID, FallbackToPlatform: *in.FallbackToPlatform,
	}); err != nil {
		return model.WhatsAppSession{}, fmt.Errorf("UpdateSessionSettings: %w", err)
	}
	return s.GetSession(ctx, orgID)
}

// ConnectWhatsApp starts QR pairing of the organization's own number
// (requires whatsapp.own_number).
func (s *Service) ConnectWhatsApp(ctx context.Context, orgID int64) (model.WhatsAppSession, error) {
	if err := s.requireOwnNumber(ctx, orgID); err != nil {
		return model.WhatsAppSession{}, err
	}
	if s.wp == nil {
		return model.WhatsAppSession{}, fmt.Errorf("%w: whatsapp provider not configured", ErrInvalidRequest)
	}
	row, err := s.q.UpsertWhatsAppSession(ctx, db.UpsertWhatsAppSessionParams{
		OrganizationID: orgID,
		Status:         model.StatusQRPending,
		Jid:            "",
		PhoneNumber:    "",
		DisplayName:    "",
		ErrorMessage:   "",
		QrCode:         "",
		QrExpiresAt:    pgtype.Timestamptz{},
	})
	if err != nil {
		return model.WhatsAppSession{}, fmt.Errorf("ConnectWhatsApp upsert: %w", err)
	}
	// Fire-and-forget pairing; QR arrives via UpdateSessionQR callback.
	if _, err := s.wp.GenerateQR(ctx); err != nil {
		_, _ = s.q.UpsertWhatsAppSession(ctx, db.UpsertWhatsAppSessionParams{
			OrganizationID: orgID,
			Status:         model.StatusError,
			ErrorMessage:   err.Error(),
		})
		return model.WhatsAppSession{}, fmt.Errorf("ConnectWhatsApp: %w", err)
	}
	return mapSession(row), nil
}

// UpdateSessionQR persists a freshly emitted QR code for polling clients.
func (s *Service) UpdateSessionQR(ctx context.Context, orgID int64, code string, expiresAt time.Time) error {
	_, err := s.q.UpdateWhatsAppSessionQR(ctx, db.UpdateWhatsAppSessionQRParams{
		OrganizationID: orgID,
		QrCode:         code,
		QrExpiresAt:    pgtype.Timestamptz{Time: expiresAt.UTC(), Valid: true},
	})
	return err
}

// UpdateSessionConnected marks the session connected or disconnected from WhatsMeow events.
func (s *Service) UpdateSessionConnected(ctx context.Context, orgID int64, jid, phone, displayName string, connected bool) error {
	status := model.StatusDisconnected
	if connected {
		status = model.StatusConnected
	}
	_, err := s.q.UpsertWhatsAppSession(ctx, db.UpsertWhatsAppSessionParams{
		OrganizationID: orgID,
		Status:         status,
		Jid:            jid,
		PhoneNumber:    phone,
		DisplayName:    displayName,
		LastSeenAt:     pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		ErrorMessage:   "",
		QrCode:         "",
		QrExpiresAt:    pgtype.Timestamptz{},
	})
	return err
}

func (s *Service) DisconnectWhatsApp(ctx context.Context, orgID int64) error {
	if s.wp != nil {
		_ = s.wp.Disconnect(ctx)
	}
	_, err := s.q.UpsertWhatsAppSession(ctx, db.UpsertWhatsAppSessionParams{
		OrganizationID: orgID,
		Status:         model.StatusDisconnected,
		Jid:            "",
		PhoneNumber:    "",
		DisplayName:    "",
		ErrorMessage:   "",
		QrCode:         "",
		QrExpiresAt:    pgtype.Timestamptz{},
	})
	if err != nil {
		return fmt.Errorf("DisconnectWhatsApp: %w", err)
	}
	return nil
}

// EnsureWhatsAppConnected restores the in-memory client from sqlstore when the
// DB session is connected but the process lost its live connection (e.g. air reload).
func (s *Service) EnsureWhatsAppConnected(ctx context.Context, orgID int64) error {
	if s.wp == nil {
		return fmt.Errorf("whatsapp provider not configured")
	}
	row, err := s.q.GetWhatsAppSession(ctx, orgID)
	if err != nil {
		return fmt.Errorf("EnsureWhatsAppConnected: %w", err)
	}
	if row.Status != model.StatusConnected || strings.TrimSpace(row.Jid) == "" {
		return fmt.Errorf("whatsapp session not connected for org %d", orgID)
	}
	return s.wp.RestoreSession(orgID, row.Jid)
}

// RestoreConnectedSessions reconnects all DB-connected WhatsApp sessions after process start.
func (s *Service) RestoreConnectedSessions(ctx context.Context) {
	if s.wp == nil {
		return
	}
	rows, err := s.q.ListConnectedWhatsAppSessions(ctx)
	if err != nil {
		return
	}
	for _, row := range rows {
		orgID, jid := row.OrganizationID, row.Jid
		go func() {
			if err := s.wp.RestoreSession(orgID, jid); err != nil {
				// Best-effort; Dispatch will retry via EnsureWhatsAppConnected.
				_ = err
			}
		}()
	}
}

// --- Notification Rules ---

func (s *Service) ListRules(ctx context.Context, orgID int64) ([]model.RuleList, error) {
	_ = s.EnsureDefaultTemplates(ctx, orgID)

	rows, err := s.q.ListNotificationRulesByOrg(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("ListRules: %w", err)
	}

	// Index existing rules
	index := make(map[string]map[string]db.NotificationRule) // event -> channel -> rule
	for _, row := range rows {
		if index[row.EventType] == nil {
			index[row.EventType] = make(map[string]db.NotificationRule)
		}
		index[row.EventType][row.Channel] = row
	}

	channels := []string{model.ChannelWhatsApp, model.ChannelSMS}
	events := model.AllEvents()
	result := make([]model.RuleList, 0, len(events))

	for _, ev := range events {
		rl := model.RuleList{
			EventType:  ev.Type,
			EventLabel: ev.Label,
			Rules:      make([]model.NotificationRule, 0, len(channels)),
		}
		for _, ch := range channels {
			r := model.NotificationRule{
				EventType: ev.Type,
				Channel:   ch,
				Enabled:   false,
			}
			if dbRow, ok := index[ev.Type][ch]; ok {
				r.UUID = dbRow.Uuid
				r.Enabled = dbRow.Enabled
			}
			rl.Rules = append(rl.Rules, r)
		}
		result = append(result, rl)
	}
	return result, nil
}

func (s *Service) ToggleRule(ctx context.Context, orgID int64, eventType, channel string, enabled bool) (model.NotificationRule, error) {
	row, err := s.q.UpsertNotificationRule(ctx, db.UpsertNotificationRuleParams{
		OrganizationID: orgID,
		EventType:      eventType,
		Channel:        channel,
		Enabled:        enabled,
	})
	if err != nil {
		return model.NotificationRule{}, fmt.Errorf("ToggleRule: %w", err)
	}
	return model.NotificationRule{
		UUID:      row.Uuid,
		EventType: row.EventType,
		Channel:   row.Channel,
		Enabled:   row.Enabled,
	}, nil
}

// --- Message Templates ---

func (s *Service) ListTemplates(ctx context.Context, orgID int64) ([]model.MessageTemplate, error) {
	rows, err := s.q.ListMessageTemplatesByOrg(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("ListTemplates: %w", err)
	}
	out := make([]model.MessageTemplate, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapTemplate(row))
	}
	return out, nil
}

func (s *Service) UpsertTemplate(ctx context.Context, orgID int64, in model.UpsertTemplateInput) (model.MessageTemplate, error) {
	if err := s.requireOwnNumber(ctx, orgID); err != nil {
		return model.MessageTemplate{}, err
	}
	if strings.TrimSpace(in.EventType) == "" || strings.TrimSpace(in.Channel) == "" {
		return model.MessageTemplate{}, fmt.Errorf("%w: event_type and channel are required", ErrInvalidRequest)
	}
	locale := in.Locale
	if locale == "" {
		locale = "tr"
	}
	varBytes, err := json.Marshal(in.Variables)
	if err != nil {
		return model.MessageTemplate{}, fmt.Errorf("%w: invalid variables", ErrInvalidRequest)
	}
	row, err := s.q.UpsertMessageTemplate(ctx, db.UpsertMessageTemplateParams{
		OrganizationID: orgID,
		EventType:      in.EventType,
		Channel:        in.Channel,
		Locale:         locale,
		Subject:        in.Subject,
		Body:           in.Body,
		Variables:      varBytes,
		IsActive:       true,
	})
	if err != nil {
		return model.MessageTemplate{}, fmt.Errorf("UpsertTemplate: %w", err)
	}
	return mapTemplate(row), nil
}

func (s *Service) GetTemplate(ctx context.Context, orgID int64, id uuid.UUID) (model.MessageTemplate, error) {
	row, err := s.q.GetMessageTemplate(ctx, db.GetMessageTemplateParams{
		Uuid:           id,
		OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.MessageTemplate{}, ErrNotFound
		}
		return model.MessageTemplate{}, fmt.Errorf("GetTemplate: %w", err)
	}
	return mapTemplate(row), nil
}

func (s *Service) PatchTemplate(ctx context.Context, orgID int64, id uuid.UUID, in model.PatchTemplateInput) (model.MessageTemplate, error) {
	if err := s.requireOwnNumber(ctx, orgID); err != nil {
		return model.MessageTemplate{}, err
	}
	existing, err := s.GetTemplate(ctx, orgID, id)
	if err != nil {
		return model.MessageTemplate{}, err
	}

	subject := existing.Subject
	if in.Subject != nil {
		subject = *in.Subject
	}
	body := existing.Body
	if in.Body != nil {
		body = *in.Body
	}
	variables := existing.Variables
	if in.Variables != nil {
		variables = in.Variables
	}
	isActive := existing.IsActive
	if in.IsActive != nil {
		isActive = *in.IsActive
	}

	varBytes, err := json.Marshal(variables)
	if err != nil {
		return model.MessageTemplate{}, fmt.Errorf("%w: invalid variables", ErrInvalidRequest)
	}
	row, err := s.q.UpsertMessageTemplate(ctx, db.UpsertMessageTemplateParams{
		OrganizationID: orgID,
		EventType:      existing.EventType,
		Channel:        existing.Channel,
		Locale:         existing.Locale,
		Subject:        subject,
		Body:           body,
		Variables:      varBytes,
		IsActive:       isActive,
	})
	if err != nil {
		return model.MessageTemplate{}, fmt.Errorf("PatchTemplate: %w", err)
	}
	return mapTemplate(row), nil
}

func (s *Service) DeleteTemplate(ctx context.Context, orgID int64, id uuid.UUID) error {
	if err := s.requireOwnNumber(ctx, orgID); err != nil {
		return err
	}
	_, err := s.GetTemplate(ctx, orgID, id)
	if err != nil {
		return err
	}
	return s.q.DeleteMessageTemplate(ctx, db.DeleteMessageTemplateParams{
		Uuid:           id,
		OrganizationID: orgID,
	})
}

// --- Dispatch ---

func (s *Service) Dispatch(ctx context.Context, in model.DispatchInput) error {
	if _, ok := orgctx.ScopeFrom(ctx); !ok && in.OrgID > 0 {
		ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: in.OrgID})
	}
	_ = s.EnsureDefaultTemplates(ctx, in.OrgID)

	channels := []string{model.ChannelWhatsApp, model.ChannelSMS}
	for _, ch := range channels {
		if !in.Force {
			rule, err := s.q.GetNotificationRule(ctx, db.GetNotificationRuleParams{
				OrganizationID: in.OrgID,
				EventType:      in.EventType,
				Channel:        ch,
			})
			if err != nil || !rule.Enabled {
				continue
			}
		}

		body, ok := s.resolveBody(ctx, in.OrgID, in.EventType, ch, in.Vars)
		if !ok {
			continue
		}

		var res deliveryResult
		var sendErr error
		if ch == model.ChannelWhatsApp {
			res, sendErr = s.deliverWhatsApp(ctx, outboundDelivery{
				OrgID: in.OrgID, EventType: in.EventType, Phone: in.RecipientPhone, Body: body, Vars: in.Vars,
			})
		} else {
			sender, ok := s.channels[ch]
			if !ok {
				continue
			}
			res.Ref, sendErr = sender.Send(ctx, in.RecipientPhone, body)
		}

		payload, _ := json.Marshal(in.Vars)
		s.logOutbound(ctx, outboundLog{
			OrgID: in.OrgID, EventType: in.EventType, Channel: ch, Phone: in.RecipientPhone,
			Payload: payload, SubjectType: in.SubjectType, SubjectUUID: in.SubjectUUID,
		}, res, sendErr)
	}
	return nil
}

// outboundLog identifies an inline (non-queued) send for outbound_messages.
type outboundLog struct {
	OrgID       int64
	EventType   string
	Channel     string
	Phone       string
	Payload     []byte
	SubjectType string
	SubjectUUID *uuid.UUID
}

// logOutbound records an inline send (status, provider ref, sender route).
func (s *Service) logOutbound(ctx context.Context, l outboundLog, res deliveryResult, sendErr error) {
	status := model.OutboundStatusSent
	errMsg := ""
	ref := res.Ref
	var sentAt pgtype.Timestamptz
	if sendErr != nil {
		status = model.OutboundStatusFailed
		errMsg = sendErr.Error()
		ref = ""
	} else {
		_ = sentAt.Scan(time.Now())
	}
	payload := l.Payload
	if len(payload) == 0 {
		payload = []byte(`{}`)
	}
	outMsg, err := s.q.InsertOutboundMessage(ctx, db.InsertOutboundMessageParams{
		OrganizationID: l.OrgID,
		EventType:      l.EventType,
		Channel:        l.Channel,
		RecipientPhone: l.Phone,
		Status:         model.OutboundStatusQueued,
		Payload:        payload,
		SubjectType:    l.SubjectType,
		SubjectUuid:    toPgtypeUUID(l.SubjectUUID),
	})
	if err != nil {
		return
	}
	_, _ = s.q.UpdateOutboundMessageStatus(ctx, db.UpdateOutboundMessageStatusParams{
		ID:                outMsg.ID,
		Status:            status,
		ProviderReference: ref,
		ErrorMessage:      errMsg,
		SentAt:            sentAt,
	})
	s.recordSender(ctx, outMsg.ID, res, sendErr)
}

// ErrChannelUnavailable is returned when a transactional send cannot use the org channel.
var ErrChannelUnavailable = errors.New("messaging channel unavailable")

// SendDirectInput is a transactional message that bypasses notification rules
// and templates (e.g. contract OTP codes).
type SendDirectInput struct {
	OrgID          int64
	EventType      string
	Channel        string
	RecipientPhone string
	Body           string
	SubjectType    string
	SubjectUUID    *uuid.UUID
	// Vars feed the platform catalog entry when the platform number sends
	// (e.g. code, business_name, minutes for contract.otp). Never persisted.
	Vars map[string]string
}

// SendDirect delivers a pre-rendered body through the resolved sender and
// logs the outbound row. Neither body nor vars are persisted (OTP secrets).
func (s *Service) SendDirect(ctx context.Context, in SendDirectInput) (string, error) {
	channel := strings.TrimSpace(in.Channel)
	if channel == "" {
		channel = model.ChannelWhatsApp
	}
	if strings.TrimSpace(in.RecipientPhone) == "" {
		return "", fmt.Errorf("%w: phone is required", ErrInvalidRequest)
	}
	if _, ok := orgctx.ScopeFrom(ctx); !ok && in.OrgID > 0 {
		ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: in.OrgID})
	}
	var res deliveryResult
	var sendErr error
	if channel == model.ChannelWhatsApp {
		res, sendErr = s.deliverWhatsApp(ctx, outboundDelivery{
			OrgID: in.OrgID, EventType: in.EventType, Phone: in.RecipientPhone, Body: in.Body, Vars: in.Vars,
		})
	} else {
		sender, ok := s.channels[channel]
		if !ok {
			return "", fmt.Errorf("%w: %s", ErrChannelUnavailable, channel)
		}
		res.Ref, sendErr = sender.Send(ctx, in.RecipientPhone, in.Body)
	}
	s.logOutbound(ctx, outboundLog{
		OrgID: in.OrgID, EventType: in.EventType, Channel: channel, Phone: in.RecipientPhone,
		SubjectType: in.SubjectType, SubjectUUID: in.SubjectUUID,
	}, res, sendErr)
	if sendErr != nil {
		return "", fmt.Errorf("%w: %w", ErrChannelUnavailable, sendErr)
	}
	if in.EventType == model.EventContractOTP && res.SenderKind == model.SenderPlatformCloud {
		s.sendContractOTPNotice(ctx, in)
	}
	return res.Ref, nil
}

// sendContractOTPNotice follows a platform Cloud OTP with the UTILITY notice
// (contract context, KVKK notice, platform info): Meta fixes the
// AUTHENTICATION body. It has its own outbound row; a failure does not undo
// the OTP, which is already sent and counted.
func (s *Service) sendContractOTPNotice(ctx context.Context, in SendDirectInput) {
	vars := make(map[string]string, len(in.Vars))
	for k, v := range in.Vars {
		if k != "code" {
			vars[k] = v
		}
	}
	res, err := s.deliverWhatsApp(ctx, outboundDelivery{
		OrgID: in.OrgID, EventType: model.EventContractOTPNotice, Phone: in.RecipientPhone, Vars: vars,
	})
	s.logOutbound(ctx, outboundLog{
		OrgID: in.OrgID, EventType: model.EventContractOTPNotice, Channel: model.ChannelWhatsApp, Phone: in.RecipientPhone,
		SubjectType: in.SubjectType, SubjectUUID: in.SubjectUUID,
	}, res, err)
}

// Simulate sends test messages (rules ignored) for one event or the full job lifecycle.
func (s *Service) Simulate(ctx context.Context, orgID int64, in model.SimulateInput) (model.SimulateResult, error) {
	phone := strings.TrimSpace(in.Phone)
	if phone == "" {
		return model.SimulateResult{}, fmt.Errorf("%w: phone is required", ErrInvalidRequest)
	}
	channel := strings.TrimSpace(in.Channel)
	if channel == "" {
		channel = model.ChannelWhatsApp
	}
	if channel != model.ChannelWhatsApp {
		return model.SimulateResult{}, fmt.Errorf("%w: only whatsapp simulate is supported", ErrInvalidRequest)
	}
	mode := strings.TrimSpace(in.Mode)
	if mode == "" {
		mode = model.SimulateModeEvent
	}

	var eventTypes []string
	switch mode {
	case model.SimulateModeJobLifecycle:
		eventTypes = model.JobLifecycleEvents()
	case model.SimulateModeEvent:
		if strings.TrimSpace(in.EventType) == "" {
			return model.SimulateResult{}, fmt.Errorf("%w: event_type is required", ErrInvalidRequest)
		}
		eventTypes = []string{in.EventType}
	default:
		return model.SimulateResult{}, fmt.Errorf("%w: invalid mode", ErrInvalidRequest)
	}

	_ = s.EnsureDefaultTemplates(ctx, orgID)
	if _, ok := orgctx.ScopeFrom(ctx); !ok {
		ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: orgID})
	}
	vars := model.SampleVars("")
	for k, v := range in.Vars {
		vars[k] = v
	}

	result := model.SimulateResult{Items: make([]model.SimulateResultItem, 0, len(eventTypes))}
	for _, eventType := range eventTypes {
		item := model.SimulateResultItem{EventType: eventType, Channel: channel}
		body, ok := s.resolveBody(ctx, orgID, eventType, channel, vars)
		if !ok {
			item.Status = model.OutboundStatusFailed
			item.ErrorMessage = "template missing"
			result.Items = append(result.Items, item)
			continue
		}
		item.Body = body

		res, sendErr := s.deliverWhatsApp(ctx, outboundDelivery{
			OrgID: orgID, EventType: eventType, Phone: phone, Body: body, Vars: vars,
		})
		item.SenderKind = res.SenderKind
		if sendErr != nil {
			item.Status = model.OutboundStatusFailed
			item.ErrorMessage = sendErr.Error()
			item.ErrorCode = model.ErrorCodeOf(sendErr)
		} else {
			item.Status = model.OutboundStatusSent
			item.ProviderReference = res.Ref
			if res.SenderKind != model.SenderOrgOwn {
				// The platform number sends the catalog text, not the org template.
				if e, ok := catalog.Lookup(eventType); ok {
					item.Body = e.RenderText(vars)
				}
			}
		}

		payload, _ := json.Marshal(vars)
		s.logOutbound(ctx, outboundLog{
			OrgID: orgID, EventType: eventType, Channel: channel, Phone: phone,
			Payload: payload, SubjectType: "simulate",
		}, res, sendErr)
		result.Items = append(result.Items, item)
	}
	return result, nil
}

// EnsureDefaultTemplates migrates legacy rules. Templates are no longer copied per
// organization: system defaults apply until an override is saved.
func (s *Service) EnsureDefaultTemplates(ctx context.Context, orgID int64) error {
	// Migrate legacy job.completed rule → job.ready when the new rule is absent.
	if legacy, err := s.q.GetNotificationRule(ctx, db.GetNotificationRuleParams{
		OrganizationID: orgID,
		EventType:      model.EventJobCompleted,
		Channel:        model.ChannelWhatsApp,
	}); err == nil && legacy.Enabled {
		if _, err := s.q.GetNotificationRule(ctx, db.GetNotificationRuleParams{
			OrganizationID: orgID,
			EventType:      model.EventJobReady,
			Channel:        model.ChannelWhatsApp,
		}); errors.Is(err, pgx.ErrNoRows) {
			_, _ = s.q.UpsertNotificationRule(ctx, db.UpsertNotificationRuleParams{
				OrganizationID: orgID,
				EventType:      model.EventJobReady,
				Channel:        model.ChannelWhatsApp,
				Enabled:        true,
			})
		}
	}

	// Defaults live in message_template_defaults; organizations only store overrides.
	return nil
}

func (s *Service) resolveBody(ctx context.Context, orgID int64, eventType, channel string, vars map[string]string) (string, bool) {
	tpl, found, err := s.ResolveTemplate(ctx, orgID, eventType, channel, "tr")
	if err != nil || !found || !tpl.Active {
		return "", false
	}
	return renderTemplate(tpl.Body, vars), true
}

// --- helpers ---

func mapSession(row db.WhatsappSession) model.WhatsAppSession {
	m := model.WhatsAppSession{
		UUID:         row.Uuid,
		Status:       row.Status,
		JID:          row.Jid,
		PhoneNumber:  row.PhoneNumber,
		DisplayName:  row.DisplayName,
		QRCode:       row.QrCode,
		ErrorMessage: row.ErrorMessage,
		// Routing flag; entitlement / platform flags are filled by GetSession.
		FallbackToPlatform: row.FallbackToPlatform,
	}
	if row.QrExpiresAt.Valid {
		t := row.QrExpiresAt.Time
		m.QRExpiresAt = &t
	}
	if row.LastSeenAt.Valid {
		t := row.LastSeenAt.Time
		m.LastSeenAt = &t
	}
	if row.CreatedAt.Valid {
		m.CreatedAt = row.CreatedAt.Time
	}
	if row.UpdatedAt.Valid {
		m.UpdatedAt = row.UpdatedAt.Time
	}
	return m
}

func mapTemplate(row db.MessageTemplate) model.MessageTemplate {
	var vars []string
	_ = json.Unmarshal(row.Variables, &vars)
	if vars == nil {
		vars = []string{}
	}
	m := model.MessageTemplate{
		UUID:      row.Uuid,
		EventType: row.EventType,
		Channel:   row.Channel,
		Locale:    row.Locale,
		Subject:   row.Subject,
		Body:      row.Body,
		Variables: vars,
		IsActive:  row.IsActive,
	}
	if row.CreatedAt.Valid {
		m.CreatedAt = row.CreatedAt.Time
	}
	if row.UpdatedAt.Valid {
		m.UpdatedAt = row.UpdatedAt.Time
	}
	return m
}

// renderTemplate renders via the shared placeholder engine. business_name
// and company_name are aliases of each other.
func renderTemplate(tplStr string, vars map[string]string) string {
	return msgtemplate.Render(tplStr, WithCompanyAlias(vars))
}

// WithCompanyAlias fills company_name/business_name from each other.
func WithCompanyAlias(vars map[string]string) map[string]string {
	out := make(map[string]string, len(vars)+1)
	for k, v := range vars {
		out[k] = v
	}
	if out["company_name"] == "" {
		out["company_name"] = out["business_name"]
	}
	if out["business_name"] == "" {
		out["business_name"] = out["company_name"]
	}
	return out
}

func toPgtypeUUID(u *uuid.UUID) pgtype.UUID {
	if u == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *u, Valid: true}
}
