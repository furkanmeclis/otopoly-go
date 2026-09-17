package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"text/template"
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
	UpsertWhatsAppSession(ctx context.Context, arg db.UpsertWhatsAppSessionParams) (db.WhatsappSession, error)
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

func (s *Service) requireOrgID(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, fmt.Errorf("organization context required")
	}
	return scope.InternalID, nil
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

func (s *Service) ConnectWhatsApp(ctx context.Context, orgID int64) (model.QRCodeResponse, error) {
	if s.wp == nil {
		return model.QRCodeResponse{}, fmt.Errorf("%w: whatsapp provider not configured", ErrInvalidRequest)
	}
	qr, err := s.wp.GenerateQR(ctx)
	if err != nil {
		return model.QRCodeResponse{}, fmt.Errorf("ConnectWhatsApp: %w", err)
	}
	_, err = s.q.UpsertWhatsAppSession(ctx, db.UpsertWhatsAppSessionParams{
		OrganizationID: orgID,
		Status:         model.StatusQRPending,
		Jid:            "",
		PhoneNumber:    "",
		DisplayName:    "",
		ErrorMessage:   "",
	})
	if err != nil {
		return model.QRCodeResponse{}, fmt.Errorf("ConnectWhatsApp upsert: %w", err)
	}
	return qr, nil
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
	})
	if err != nil {
		return fmt.Errorf("DisconnectWhatsApp: %w", err)
	}
	return nil
}

// --- Notification Rules ---

func (s *Service) ListRules(ctx context.Context, orgID int64) ([]model.RuleList, error) {
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
	channels := []string{model.ChannelWhatsApp, model.ChannelSMS}
	for _, ch := range channels {
		rule, err := s.q.GetNotificationRule(ctx, db.GetNotificationRuleParams{
			OrganizationID: in.OrgID,
			EventType:      in.EventType,
			Channel:        ch,
		})
		if err != nil {
			continue // no rule → skip
		}
		if !rule.Enabled {
			continue
		}

		tmpl, err := s.q.GetMessageTemplateByKey(ctx, db.GetMessageTemplateByKeyParams{
			OrganizationID: in.OrgID,
			EventType:      in.EventType,
			Channel:        ch,
			Locale:         "tr",
		})
		if err != nil {
			continue // no template → skip
		}

		body, err := renderTemplate(tmpl.Body, in.Vars)
		if err != nil {
			body = tmpl.Body
		}

		sender, ok := s.channels[ch]
		if !ok {
			continue
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

// --- helpers ---

func mapSession(row db.WhatsappSession) model.WhatsAppSession {
	m := model.WhatsAppSession{
		UUID:         row.Uuid,
		Status:       row.Status,
		JID:          row.Jid,
		PhoneNumber:  row.PhoneNumber,
		DisplayName:  row.DisplayName,
		ErrorMessage: row.ErrorMessage,
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

func renderTemplate(tplStr string, vars map[string]string) (string, error) {
	t, err := template.New("msg").Parse(tplStr)
	if err != nil {
		return tplStr, err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, vars); err != nil {
		return tplStr, err
	}
	return buf.String(), nil
}

func toPgtypeUUID(u *uuid.UUID) pgtype.UUID {
	if u == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *u, Valid: true}
}
