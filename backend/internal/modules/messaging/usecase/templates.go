package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Template limits.
const (
	MaxTemplateSubject = 200
	MaxTemplateBody    = 4000
)

// ResolvedTemplate is the effective template for one send.
type ResolvedTemplate struct {
	Subject string
	Body    string
	Locale  string
	// Active is false when the organization switched this channel's template
	// to passive: the channel must not send.
	Active bool
	Custom bool
}

// ResolveTemplate returns the effective template: organization override →
// system default (message_template_defaults) for the locale, then the same for
// Turkish, then the built-in code default. found=false means no template.
func (s *Service) ResolveTemplate(ctx context.Context, orgID int64, eventType, channel, locale string) (ResolvedTemplate, bool, error) {
	locales := []string{normalizeLocale(locale)}
	if locales[0] != "tr" {
		locales = append(locales, "tr")
	}
	for _, loc := range locales {
		if orgID > 0 {
			ov, err := s.q.GetMessageTemplateOverride(ctx, db.GetMessageTemplateOverrideParams{
				OrganizationID: orgID, EventType: eventType, Channel: channel, Locale: loc,
			})
			if err == nil {
				return ResolvedTemplate{Subject: ov.Subject, Body: ov.Body, Locale: loc, Active: ov.IsActive, Custom: true}, true, nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return ResolvedTemplate{}, false, err
			}
		}
		def, err := s.q.GetMessageTemplateDefault(ctx, db.GetMessageTemplateDefaultParams{
			EventType: eventType, Channel: channel, Locale: loc,
		})
		if err == nil {
			return ResolvedTemplate{Subject: def.Subject, Body: def.Body, Locale: loc, Active: true}, true, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return ResolvedTemplate{}, false, err
		}
	}
	if subject, body, ok := model.DefaultTemplate(eventType, channel); ok {
		return ResolvedTemplate{Subject: subject, Body: body, Locale: "tr", Active: true}, true, nil
	}
	return ResolvedTemplate{}, false, nil
}

func normalizeLocale(l string) string {
	if strings.EqualFold(strings.TrimSpace(l), "en") {
		return "en"
	}
	return "tr"
}

// TemplateEntry is one (channel, locale) template of a type in the catalog.
type TemplateEntry struct {
	Channel        string     `json:"channel"`
	Locale         string     `json:"locale"`
	Subject        string     `json:"subject"`
	Body           string     `json:"body"`
	IsActive       bool       `json:"is_active"`
	IsCustom       bool       `json:"is_custom"`
	UUID           *uuid.UUID `json:"uuid,omitempty"`
	DefaultSubject string     `json:"default_subject"`
	DefaultBody    string     `json:"default_body"`
}

// TemplateType is one registered type with its effective templates.
type TemplateType struct {
	Type         string                    `json:"type"`
	Group        string                    `json:"group"`
	Audience     string                    `json:"audience"`
	Channels     []string                  `json:"channels"`
	Placeholders []msgtemplate.Placeholder `json:"placeholders"`
	Templates    []TemplateEntry           `json:"templates"`
}

type tplKey struct{ event, channel, locale string }

// TemplateCatalog lists every registered type × channel × locale with the
// effective template (two queries, no N+1).
func (s *Service) TemplateCatalog(ctx context.Context, orgID int64) ([]TemplateType, error) {
	defs, err := s.q.ListMessageTemplateDefaults(ctx)
	if err != nil {
		return nil, fmt.Errorf("TemplateCatalog defaults: %w", err)
	}
	overrides, err := s.q.ListMessageTemplatesByOrg(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("TemplateCatalog overrides: %w", err)
	}
	defIdx := make(map[tplKey]db.MessageTemplateDefault, len(defs))
	for _, d := range defs {
		defIdx[tplKey{d.EventType, d.Channel, d.Locale}] = d
	}
	ovIdx := make(map[tplKey]db.MessageTemplate, len(overrides))
	for _, o := range overrides {
		ovIdx[tplKey{o.EventType, o.Channel, o.Locale}] = o
	}
	specs := msgtemplate.All()
	out := make([]TemplateType, 0, len(specs))
	for _, spec := range specs {
		tt := TemplateType{
			Type: spec.Type, Group: spec.Group, Audience: spec.Audience,
			Channels: spec.Channels, Placeholders: spec.Placeholders,
		}
		for _, ch := range spec.Channels {
			for _, loc := range msgtemplate.Locales {
				k := tplKey{spec.Type, ch, loc}
				e := TemplateEntry{Channel: ch, Locale: loc, IsActive: true}
				if d, ok := defIdx[k]; ok {
					e.DefaultSubject, e.DefaultBody = d.Subject, d.Body
				} else if sub, body, ok := model.DefaultTemplate(spec.Type, ch); ok && loc == "tr" {
					e.DefaultSubject, e.DefaultBody = sub, body
				}
				e.Subject, e.Body = e.DefaultSubject, e.DefaultBody
				if o, ok := ovIdx[k]; ok {
					id := o.Uuid
					e.UUID = &id
					e.Subject, e.Body, e.IsActive, e.IsCustom = o.Subject, o.Body, o.IsActive, true
				}
				tt.Templates = append(tt.Templates, e)
			}
		}
		out = append(out, tt)
	}
	return out, nil
}

// SaveTemplateInput updates one (type, channel, locale) override.
type SaveTemplateInput struct {
	Subject  string `json:"subject"`
	Body     string `json:"body"`
	IsActive *bool  `json:"is_active"`
}

// ValidationError lists unknown placeholders (400 with details).
type ValidationError struct {
	Field   string
	Unknown []string
	Msg     string
}

func (e *ValidationError) Error() string { return e.Msg }

// Unwrap lets errors.Is(err, ErrInvalidRequest) match.
func (e *ValidationError) Unwrap() error { return ErrInvalidRequest }

// SaveTemplate validates placeholders against the type registry and upserts
// the organization override.
func (s *Service) SaveTemplate(ctx context.Context, orgID int64, eventType, channel, locale string, in SaveTemplateInput) (TemplateEntry, error) {
	spec, ok := msgtemplate.Lookup(eventType)
	if !ok {
		return TemplateEntry{}, fmt.Errorf("%w: unknown template type", ErrInvalidRequest)
	}
	if !spec.HasChannel(channel) {
		return TemplateEntry{}, fmt.Errorf("%w: channel not supported for this type", ErrInvalidRequest)
	}
	if locale != "tr" && locale != "en" {
		return TemplateEntry{}, fmt.Errorf("%w: locale must be tr or en", ErrInvalidRequest)
	}
	subject := strings.TrimSpace(in.Subject)
	body := strings.TrimSpace(in.Body)
	if body == "" {
		return TemplateEntry{}, &ValidationError{Field: "body", Msg: "invalid request: body is required"}
	}
	if len([]rune(subject)) > MaxTemplateSubject {
		return TemplateEntry{}, &ValidationError{Field: "subject", Msg: "invalid request: subject is too long"}
	}
	if len([]rune(body)) > MaxTemplateBody {
		return TemplateEntry{}, &ValidationError{Field: "body", Msg: "invalid request: body is too long"}
	}
	if unk := msgtemplate.Unknown(spec, subject, body); len(unk) > 0 {
		return TemplateEntry{}, &ValidationError{
			Field: "body", Unknown: unk,
			Msg: "invalid request: unknown placeholders: " + strings.Join(unk, ", "),
		}
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	vars, _ := json.Marshal(msgtemplate.Placeholders(subject + "\n" + body))
	row, err := s.q.UpsertMessageTemplate(ctx, db.UpsertMessageTemplateParams{
		OrganizationID: orgID, EventType: eventType, Channel: channel, Locale: locale,
		Subject: subject, Body: body, Variables: vars, IsActive: active,
	})
	if err != nil {
		return TemplateEntry{}, fmt.Errorf("SaveTemplate: %w", err)
	}
	e := TemplateEntry{Channel: channel, Locale: locale, Subject: row.Subject, Body: row.Body, IsActive: row.IsActive, IsCustom: true}
	id := row.Uuid
	e.UUID = &id
	if d, err := s.q.GetMessageTemplateDefault(ctx, db.GetMessageTemplateDefaultParams{EventType: eventType, Channel: channel, Locale: locale}); err == nil {
		e.DefaultSubject, e.DefaultBody = d.Subject, d.Body
	}
	return e, nil
}

// ResetTemplate deletes the override so the system default applies again.
func (s *Service) ResetTemplate(ctx context.Context, orgID int64, eventType, channel, locale string) (TemplateEntry, error) {
	spec, ok := msgtemplate.Lookup(eventType)
	if !ok || !spec.HasChannel(channel) || (locale != "tr" && locale != "en") {
		return TemplateEntry{}, ErrNotFound
	}
	if _, err := s.q.DeleteMessageTemplateByKey(ctx, db.DeleteMessageTemplateByKeyParams{
		OrganizationID: orgID, EventType: eventType, Channel: channel, Locale: locale,
	}); err != nil {
		return TemplateEntry{}, fmt.Errorf("ResetTemplate: %w", err)
	}
	e := TemplateEntry{Channel: channel, Locale: locale, IsActive: true}
	if d, err := s.q.GetMessageTemplateDefault(ctx, db.GetMessageTemplateDefaultParams{EventType: eventType, Channel: channel, Locale: locale}); err == nil {
		e.DefaultSubject, e.DefaultBody = d.Subject, d.Body
		e.Subject, e.Body = d.Subject, d.Body
	}
	return e, nil
}
