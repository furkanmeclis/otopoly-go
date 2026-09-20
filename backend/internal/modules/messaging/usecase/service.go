package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
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

// --- WhatsApp Session ---

func (s *Service) GetSession(ctx context.Context, orgID int64) (model.WhatsAppSession, error) {
	row, err := s.q.GetWhatsAppSession(ctx, orgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.WhatsAppSession{
				Status: model.StatusDisconnected,
			}, nil
		}
		return model.WhatsAppSession{}, fmt.Errorf("GetSession: %w", err)
	}
	return mapSession(row), nil
}

func (s *Service) ConnectWhatsApp(ctx context.Context, orgID int64) (model.WhatsAppSession, error) {
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

		sender, ok := s.channels[ch]
		if !ok {
			continue
		}

		if ch == model.ChannelWhatsApp {
			_ = s.EnsureWhatsAppConnected(ctx, in.OrgID)
		}

		ref, sendErr := sender.Send(ctx, in.RecipientPhone, body)

		status := model.OutboundStatusSent
		errMsg := ""
		var sentAt pgtype.Timestamptz
		provRef := ref
		if sendErr != nil {
			status = model.OutboundStatusFailed
			errMsg = sendErr.Error()
			provRef = ""
		} else {
			_ = sentAt.Scan(time.Now())
		}

		payload, _ := json.Marshal(in.Vars)
		outMsg, dbErr := s.q.InsertOutboundMessage(ctx, db.InsertOutboundMessageParams{
			OrganizationID: in.OrgID,
			EventType:      in.EventType,
			Channel:        ch,
			RecipientPhone: in.RecipientPhone,
			Status:         model.OutboundStatusQueued,
			Payload:        payload,
			SubjectType:    in.SubjectType,
			SubjectUuid:    toPgtypeUUID(in.SubjectUUID),
		})
		if dbErr == nil {
			_, _ = s.q.UpdateOutboundMessageStatus(ctx, db.UpdateOutboundMessageStatusParams{
				ID:                outMsg.ID,
				Status:            status,
				ProviderReference: provRef,
				ErrorMessage:      errMsg,
				SentAt:            sentAt,
			})
		}
	}
	return nil
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
	sender, ok := s.channels[channel]
	if !ok {
		return model.SimulateResult{}, fmt.Errorf("%w: channel unavailable", ErrInvalidRequest)
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
	_ = s.EnsureWhatsAppConnected(ctx, orgID)

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

		ref, sendErr := sender.Send(ctx, phone, body)
		status := model.OutboundStatusSent
		errMsg := ""
		var sentAt pgtype.Timestamptz
		provRef := ref
		if sendErr != nil {
			status = model.OutboundStatusFailed
			errMsg = sendErr.Error()
			provRef = ""
			item.Status = status
			item.ErrorMessage = errMsg
		} else {
			_ = sentAt.Scan(time.Now())
			item.Status = status
			item.ProviderReference = provRef
		}

		payload, _ := json.Marshal(vars)
		outMsg, dbErr := s.q.InsertOutboundMessage(ctx, db.InsertOutboundMessageParams{
			OrganizationID: orgID,
			EventType:      eventType,
			Channel:        channel,
			RecipientPhone: phone,
			Status:         model.OutboundStatusQueued,
			Payload:        payload,
			SubjectType:    "simulate",
		})
		if dbErr == nil {
			_, _ = s.q.UpdateOutboundMessageStatus(ctx, db.UpdateOutboundMessageStatusParams{
				ID:                outMsg.ID,
				Status:            status,
				ProviderReference: provRef,
				ErrorMessage:      errMsg,
				SentAt:            sentAt,
			})
		}
		result.Items = append(result.Items, item)
	}
	return result, nil
}

// EnsureDefaultTemplates upserts missing active templates for known events.
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

	for _, ev := range model.AllEvents() {
		for _, ch := range []string{model.ChannelWhatsApp} {
			_, err := s.q.GetMessageTemplateByKey(ctx, db.GetMessageTemplateByKeyParams{
				OrganizationID: orgID,
				EventType:      ev.Type,
				Channel:        ch,
				Locale:         "tr",
			})
			if err == nil {
				continue
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			subject, body, ok := model.DefaultTemplate(ev.Type, ch)
			if !ok {
				continue
			}
			vars, _ := json.Marshal(model.EventVariables(ev.Type))
			_, _ = s.q.UpsertMessageTemplate(ctx, db.UpsertMessageTemplateParams{
				OrganizationID: orgID,
				EventType:      ev.Type,
				Channel:        ch,
				Locale:         "tr",
				Subject:        subject,
				Body:           body,
				Variables:      vars,
				IsActive:       true,
			})
		}
	}
	return nil
}

func (s *Service) resolveBody(ctx context.Context, orgID int64, eventType, channel string, vars map[string]string) (string, bool) {
	tmpl, err := s.q.GetMessageTemplateByKey(ctx, db.GetMessageTemplateByKeyParams{
		OrganizationID: orgID,
		EventType:      eventType,
		Channel:        channel,
		Locale:         "tr",
	})
	var raw string
	if err != nil {
		subject, body, ok := model.DefaultTemplate(eventType, channel)
		_ = subject
		if !ok {
			return "", false
		}
		raw = body
	} else {
		raw = tmpl.Body
	}
	return renderTemplate(raw, vars), true
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

// renderTemplate replaces {{key}} placeholders (Mustache-lite). Dot form {{.key}} is also accepted.
func renderTemplate(tplStr string, vars map[string]string) string {
	out := tplStr
	for k, v := range vars {
		out = strings.ReplaceAll(out, "{{"+k+"}}", v)
		out = strings.ReplaceAll(out, "{{."+k+"}}", v)
	}
	return out
}

func toPgtypeUUID(u *uuid.UUID) pgtype.UUID {
	if u == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *u, Valid: true}
}
