package usecase

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/catalog"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/cloud"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Template status values (whatsapp_cloud_templates.status).
const (
	TemplateStatusNotSubmitted = "not_submitted"
	TemplateStatusRejected     = "rejected"
)

// ErrTemplateNotFound is returned for an unknown catalog key.
var ErrTemplateNotFound = errors.New("template not found")

// TemplateStore is the persistence surface of the template catalog.
type TemplateStore interface {
	ListWhatsAppCloudTemplates(ctx context.Context) ([]db.WhatsappCloudTemplate, error)
	EnsureWhatsAppCloudTemplate(ctx context.Context, arg db.EnsureWhatsAppCloudTemplateParams) (db.WhatsappCloudTemplate, error)
	SetWhatsAppCloudTemplateOverride(ctx context.Context, arg db.SetWhatsAppCloudTemplateOverrideParams) (db.WhatsappCloudTemplate, error)
	UpdateWhatsAppCloudTemplateStatus(ctx context.Context, arg db.UpdateWhatsAppCloudTemplateStatusParams) (db.WhatsappCloudTemplate, error)
}

// TemplateAPI is Meta's template management API (cloud.Client).
type TemplateAPI interface {
	CreateTemplate(ctx context.Context, def cloud.TemplateDefinition) (cloud.CreatedTemplate, error)
	ListTemplates(ctx context.Context) ([]cloud.RemoteTemplate, error)
}

// Templates manages the platform template catalog against Meta.
type Templates struct {
	q   TemplateStore
	api TemplateAPI
}

// NewTemplates creates the template catalog service.
func NewTemplates(q TemplateStore, api TemplateAPI) *Templates {
	return &Templates{q: q, api: api}
}

// Template is one catalog entry with its stored Meta state.
type Template struct {
	Key            string     `json:"key"`
	MetaName       string     `json:"meta_name"`
	OverrideName   *string    `json:"override_name"`
	EffectiveName  string     `json:"effective_name"`
	Language       string     `json:"language"`
	Category       string     `json:"category"`
	Status         string     `json:"status"`
	MetaTemplateID string     `json:"meta_template_id"`
	RejectedReason string     `json:"rejected_reason"`
	LastSyncedAt   *time.Time `json:"last_synced_at"`
	Body           string     `json:"body"`
	Params         []string   `json:"params"`
	Examples       []string   `json:"examples"`
	HeaderDocument bool       `json:"header_document"`
	CopyCodeButton bool       `json:"copy_code_button"`
}

func mapTemplate(e catalog.Entry, row *db.WhatsappCloudTemplate) Template {
	t := Template{
		Key: e.Key, MetaName: e.MetaName, EffectiveName: e.MetaName, Language: e.Language, Category: e.Category,
		Status: TemplateStatusNotSubmitted, Body: e.Body, Params: e.Params, Examples: e.Examples,
		HeaderDocument: e.HeaderDocument, CopyCodeButton: e.CopyCodeButton,
	}
	if row == nil {
		return t
	}
	t.Status, t.MetaTemplateID, t.RejectedReason = row.Status, row.MetaTemplateID, row.RejectedReason
	if row.OverrideName.Valid && row.OverrideName.String != "" {
		name := row.OverrideName.String
		t.OverrideName, t.EffectiveName = &name, name
	}
	if row.LastSyncedAt.Valid {
		ts := row.LastSyncedAt.Time
		t.LastSyncedAt = &ts
	}
	return t
}

func (s *Templates) rows(ctx context.Context) (map[string]db.WhatsappCloudTemplate, error) {
	rows, err := s.q.ListWhatsAppCloudTemplates(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]db.WhatsappCloudTemplate, len(rows))
	for _, r := range rows {
		out[r.Key] = r
	}
	return out, nil
}

// List returns the code catalog merged with stored Meta state.
func (s *Templates) List(ctx context.Context) ([]Template, error) {
	idx, err := s.rows(ctx)
	if err != nil {
		return nil, err
	}
	entries := catalog.All()
	out := make([]Template, 0, len(entries))
	for _, e := range entries {
		var row *db.WhatsappCloudTemplate
		if r, ok := idx[e.Key]; ok {
			row = &r
		}
		out = append(out, mapTemplate(e, row))
	}
	return out, nil
}

// SubmitResult is the outcome for one key.
type SubmitResult struct {
	Key     string `json:"key"`
	Status  string `json:"status"`
	Skipped string `json:"skipped,omitempty"`
	Error   string `json:"error,omitempty"`
}

// fatal reports errors that make every further Meta call pointless.
func fatal(err error) bool {
	switch model.ErrorCodeOf(err) {
	case model.ErrCodeCloudAuthFailed, model.ErrCodePlatformSenderNotConfigured:
		return true
	}
	return false
}

// Submit creates not-yet-submitted catalog templates in Meta (all, or the
// given keys). Entries mapped to a manual template (override) are skipped.
func (s *Templates) Submit(ctx context.Context, keys []string) ([]SubmitResult, error) {
	targets := catalog.All()
	explicit := len(keys) > 0
	if explicit {
		targets = targets[:0:0]
		for _, k := range keys {
			e, ok := catalog.Lookup(strings.TrimSpace(k))
			if !ok || e.Key != strings.TrimSpace(k) {
				return nil, fmt.Errorf("%w: unknown template key %q", ErrInvalidRequest, k)
			}
			targets = append(targets, e)
		}
	}
	idx, err := s.rows(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]SubmitResult, 0, len(targets))
	for _, e := range targets {
		row, ok := idx[e.Key]
		if !ok {
			if row, err = s.q.EnsureWhatsAppCloudTemplate(ctx, db.EnsureWhatsAppCloudTemplateParams{
				Key: e.Key, MetaName: e.MetaName, Language: e.Language, Category: e.Category,
			}); err != nil {
				return nil, err
			}
		}
		res := SubmitResult{Key: e.Key, Status: row.Status}
		switch {
		case row.OverrideName.Valid && row.OverrideName.String != "":
			res.Skipped = "override"
		case row.Status != TemplateStatusNotSubmitted:
			res.Skipped = "already_submitted"
		}
		if res.Skipped != "" {
			if explicit {
				out = append(out, res)
			}
			continue
		}
		created, err := s.api.CreateTemplate(ctx, cloud.TemplateDefinition{
			Name: e.MetaName, Language: e.Language, Category: e.Category, Body: e.Body, Examples: e.Examples,
			HeaderDocument: e.HeaderDocument, CopyCode: e.CopyCodeButton, CodeExpirationMinutes: e.CodeExpirationMinutes,
		})
		if err != nil {
			if fatal(err) {
				return nil, err
			}
			res.Error = model.ErrorCodeOf(err)
			if res.Error == "" {
				res.Error = model.ErrCodeSendFailed
			}
			out = append(out, res)
			continue
		}
		updated, err := s.q.UpdateWhatsAppCloudTemplateStatus(ctx, db.UpdateWhatsAppCloudTemplateStatusParams{
			Key: e.Key, Status: cloud.MapStatus(created.Status), MetaTemplateID: created.ID,
		})
		if err != nil {
			return nil, err
		}
		res.Status = updated.Status
		out = append(out, res)
	}
	return out, nil
}

func remoteKey(name, lang string) string {
	return strings.ToLower(strings.TrimSpace(name)) + "|" + strings.ToLower(strings.TrimSpace(lang))
}

// Sync pulls template statuses from Meta and updates every catalog row
// (matched by effective name + language). Templates missing in Meta go back
// to not_submitted.
func (s *Templates) Sync(ctx context.Context) ([]Template, error) {
	remote, err := s.api.ListTemplates(ctx)
	if err != nil {
		return nil, err
	}
	byName := make(map[string]cloud.RemoteTemplate, len(remote))
	for _, r := range remote {
		byName[remoteKey(r.Name, r.Language)] = r
	}
	idx, err := s.rows(ctx)
	if err != nil {
		return nil, err
	}
	for _, e := range catalog.All() {
		row, ok := idx[e.Key]
		if !ok {
			if row, err = s.q.EnsureWhatsAppCloudTemplate(ctx, db.EnsureWhatsAppCloudTemplateParams{
				Key: e.Key, MetaName: e.MetaName, Language: e.Language, Category: e.Category,
			}); err != nil {
				return nil, err
			}
		}
		name := e.MetaName
		if row.OverrideName.Valid && row.OverrideName.String != "" {
			name = row.OverrideName.String
		}
		p := db.UpdateWhatsAppCloudTemplateStatusParams{Key: e.Key, Status: TemplateStatusNotSubmitted}
		if r, found := byName[remoteKey(name, row.Language)]; found {
			p.Status, p.MetaTemplateID = cloud.MapStatus(r.Status), r.ID
			if p.Status == TemplateStatusRejected && !strings.EqualFold(r.RejectedReason, "NONE") {
				p.RejectedReason = r.RejectedReason
			}
		}
		if _, err := s.q.UpdateWhatsAppCloudTemplateStatus(ctx, p); err != nil {
			return nil, err
		}
	}
	return s.List(ctx)
}

var templateNameRE = regexp.MustCompile(`^[a-z0-9_]{1,512}$`)

// OverrideInput sets (string) or clears (null / "") the Meta name override.
type OverrideInput struct {
	OverrideName *string `json:"override_name"`
}

// SetOverride maps a catalog key to a template created manually in Meta.
// The stored Meta state is reset until the next sync.
func (s *Templates) SetOverride(ctx context.Context, key string, in OverrideInput) (Template, error) {
	e, ok := catalog.Lookup(key)
	if !ok || e.Key != key {
		return Template{}, ErrTemplateNotFound
	}
	var name pgtype.Text
	if in.OverrideName != nil {
		v := strings.TrimSpace(*in.OverrideName)
		if v != "" {
			if !templateNameRE.MatchString(v) {
				return Template{}, fmt.Errorf("%w: override_name must be lowercase letters, digits and underscores", ErrInvalidRequest)
			}
			name = pgtype.Text{String: v, Valid: true}
		}
	}
	if _, err := s.q.EnsureWhatsAppCloudTemplate(ctx, db.EnsureWhatsAppCloudTemplateParams{
		Key: e.Key, MetaName: e.MetaName, Language: e.Language, Category: e.Category,
	}); err != nil {
		return Template{}, err
	}
	if _, err := s.q.SetWhatsAppCloudTemplateOverride(ctx, db.SetWhatsAppCloudTemplateOverrideParams{
		Key: e.Key, OverrideName: name,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Template{}, ErrTemplateNotFound
		}
		return Template{}, err
	}
	row, err := s.q.UpdateWhatsAppCloudTemplateStatus(ctx, db.UpdateWhatsAppCloudTemplateStatusParams{
		Key: e.Key, Status: TemplateStatusNotSubmitted,
	})
	if err != nil {
		return Template{}, err
	}
	return mapTemplate(e, &row), nil
}
