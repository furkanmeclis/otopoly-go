package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
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
	EditTemplate(ctx context.Context, metaTemplateID string, def cloud.TemplateDefinition) (cloud.CreatedTemplate, error)
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

// rowKey identifies one stored template: catalog key + language.
func rowKey(key, lang string) string { return key + "|" + lang }

func (s *Templates) rows(ctx context.Context) (map[string]db.WhatsappCloudTemplate, error) {
	rows, err := s.q.ListWhatsAppCloudTemplates(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]db.WhatsappCloudTemplate, len(rows))
	for _, r := range rows {
		out[rowKey(r.Key, r.Language)] = r
	}
	return out, nil
}

// ensureRow returns the stored row of an entry variant, inserting it first
// when the catalog grew since the last boot seed.
func (s *Templates) ensureRow(ctx context.Context, idx map[string]db.WhatsappCloudTemplate, e catalog.Entry) (db.WhatsappCloudTemplate, error) {
	if row, ok := idx[rowKey(e.Key, e.Language)]; ok {
		return row, nil
	}
	row, err := s.q.EnsureWhatsAppCloudTemplate(ctx, db.EnsureWhatsAppCloudTemplateParams{
		Key: e.Key, MetaName: e.MetaName, Language: e.Language, Category: e.Category,
	})
	if err != nil {
		return row, err
	}
	idx[rowKey(e.Key, e.Language)] = row
	return row, nil
}

// List returns the code catalog (every language) merged with stored Meta
// state, ordered by entry then language.
func (s *Templates) List(ctx context.Context) ([]Template, error) {
	idx, err := s.rows(ctx)
	if err != nil {
		return nil, err
	}
	variants := catalog.AllVariants()
	out := make([]Template, 0, len(variants))
	for _, e := range variants {
		var row *db.WhatsappCloudTemplate
		if r, ok := idx[rowKey(e.Key, e.Language)]; ok {
			row = &r
		}
		out = append(out, mapTemplate(e, row))
	}
	return out, nil
}

// SubmitResult is the outcome for one key + language.
type SubmitResult struct {
	Key      string `json:"key"`
	Language string `json:"language"`
	Status   string `json:"status"`
	Skipped  string `json:"skipped,omitempty"`
	Error    string `json:"error,omitempty"`
	// Message is Meta's error text (when Error is set and Meta gave one).
	Message string `json:"message,omitempty"`
}

// SubmitInput selects what to submit: every variant when both lists are
// empty; otherwise the given keys (every language) narrowed to the given
// languages.
type SubmitInput struct {
	Keys      []string `json:"keys"`
	Languages []string `json:"languages"`
}

// resolveTargets turns a SubmitInput into catalog variants (validated).
func resolveTargets(in SubmitInput) ([]catalog.Entry, bool, error) {
	explicit := len(in.Keys) > 0 || len(in.Languages) > 0
	langs := map[string]bool{}
	for _, l := range in.Languages {
		l = strings.ToLower(strings.TrimSpace(l))
		if !catalog.HasLanguage(l) {
			return nil, explicit, fmt.Errorf("%w: unknown template language %q", ErrInvalidRequest, l)
		}
		langs[l] = true
	}
	var base []catalog.Entry
	if len(in.Keys) == 0 {
		base = catalog.All()
	} else {
		for _, k := range in.Keys {
			e, ok := catalog.Lookup(strings.TrimSpace(k))
			if !ok || e.Key != strings.TrimSpace(k) {
				return nil, explicit, fmt.Errorf("%w: unknown template key %q", ErrInvalidRequest, k)
			}
			base = append(base, e)
		}
	}
	var out []catalog.Entry
	for _, e := range base {
		for _, lang := range catalog.Languages {
			if len(langs) > 0 && !langs[lang] {
				continue
			}
			if v, ok := e.Localize(lang); ok {
				out = append(out, v)
			}
		}
	}
	return out, explicit, nil
}

func definitionOf(e catalog.Entry) cloud.TemplateDefinition {
	return cloud.TemplateDefinition{
		Name: e.MetaName, Language: e.Language, Category: e.Category, Body: e.Body, Examples: e.Examples,
		HeaderDocument: e.HeaderDocument, CopyCode: e.CopyCodeButton, CodeExpirationMinutes: e.CodeExpirationMinutes,
	}
}

// fatal reports errors that make every further Meta call pointless.
func fatal(err error) bool {
	switch model.ErrorCodeOf(err) {
	case model.ErrCodeCloudAuthFailed, model.ErrCodePlatformSenderNotConfigured:
		return true
	}
	return false
}

// Submit sends catalog templates to Meta: `not_submitted` variants are
// created; `rejected` variants that still exist in Meta are edited in place
// (Meta reviews them again), the others re-created. Entries mapped to a
// manual template (override) are skipped.
func (s *Templates) Submit(ctx context.Context, in SubmitInput) ([]SubmitResult, error) {
	targets, explicit, err := resolveTargets(in)
	if err != nil {
		return nil, err
	}
	idx, err := s.rows(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]SubmitResult, 0, len(targets))
	for _, e := range targets {
		row, err := s.ensureRow(ctx, idx, e)
		if err != nil {
			return nil, err
		}
		res := SubmitResult{Key: e.Key, Language: e.Language, Status: row.Status}
		switch {
		case row.OverrideName.Valid && row.OverrideName.String != "":
			res.Skipped = "override"
		case row.Status != TemplateStatusNotSubmitted && row.Status != TemplateStatusRejected:
			res.Skipped = "already_submitted"
		}
		if res.Skipped != "" {
			if explicit {
				out = append(out, res)
			}
			continue
		}
		var created cloud.CreatedTemplate
		if row.Status == TemplateStatusRejected && strings.TrimSpace(row.MetaTemplateID) != "" {
			created, err = s.api.EditTemplate(ctx, row.MetaTemplateID, definitionOf(e))
		} else {
			created, err = s.api.CreateTemplate(ctx, definitionOf(e))
		}
		if err != nil {
			if fatal(err) {
				return nil, err
			}
			res.Error = model.ErrorCodeOf(err)
			if res.Error == "" {
				res.Error = model.ErrCodeSendFailed
			}
			res.Message = cloud.GraphMessage(err)
			slog.Warn("whatsapp template submit failed",
				"key", e.Key, "language", e.Language, "meta_name", e.MetaName,
				"error_code", res.Error, "error", err.Error())
			out = append(out, res)
			continue
		}
		updated, err := s.q.UpdateWhatsAppCloudTemplateStatus(ctx, db.UpdateWhatsAppCloudTemplateStatusParams{
			Key: e.Key, Language: e.Language, Status: cloud.MapStatus(created.Status), MetaTemplateID: created.ID,
		})
		if err != nil {
			return nil, err
		}
		idx[rowKey(e.Key, e.Language)] = updated
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
	for _, e := range catalog.AllVariants() {
		row, err := s.ensureRow(ctx, idx, e)
		if err != nil {
			return nil, err
		}
		name := e.MetaName
		if row.OverrideName.Valid && row.OverrideName.String != "" {
			name = row.OverrideName.String
		}
		p := db.UpdateWhatsAppCloudTemplateStatusParams{Key: e.Key, Language: e.Language, Status: TemplateStatusNotSubmitted}
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

// SetOverride maps a catalog key + language to a template created manually
// in Meta. The stored Meta state is reset until the next sync.
func (s *Templates) SetOverride(ctx context.Context, key, language string, in OverrideInput) (Template, error) {
	e, ok := catalog.Lookup(key)
	if !ok || e.Key != key {
		return Template{}, ErrTemplateNotFound
	}
	language = strings.ToLower(strings.TrimSpace(language))
	if e, ok = e.Localize(language); !ok || !catalog.HasLanguage(language) {
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
		Key: e.Key, Language: e.Language, OverrideName: name,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Template{}, ErrTemplateNotFound
		}
		return Template{}, err
	}
	row, err := s.q.UpdateWhatsAppCloudTemplateStatus(ctx, db.UpdateWhatsAppCloudTemplateStatusParams{
		Key: e.Key, Language: e.Language, Status: TemplateStatusNotSubmitted,
	})
	if err != nil {
		return Template{}, err
	}
	return mapTemplate(e, &row), nil
}
