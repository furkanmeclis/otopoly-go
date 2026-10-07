// Package usecase serves the public legal pages (privacy policy, later terms)
// and their platform-admin editing.
package usecase

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	LocaleTR = "tr"
	LocaleEN = "en"

	// MaxMarkdownBytes caps the Markdown body per locale.
	MaxMarkdownBytes = 100 * 1024
	// MaxTitleRunes caps the title per locale.
	MaxTitleRunes = 200
)

var (
	ErrNotFound      = errors.New("legal page not found")
	ErrInvalidLocale = errors.New("locale must be tr or en")
)

var slugRE = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ValidSlug reports whether slug has the legal_pages slug shape.
func ValidSlug(slug string) bool {
	return len(slug) <= 64 && slugRE.MatchString(slug)
}

// FieldError is one invalid PATCH field.
type FieldError struct {
	Field   string
	Code    string
	Message string
}

// ValidationError lists invalid PATCH fields.
type ValidationError struct {
	Fields []FieldError
}

func (e *ValidationError) Error() string {
	if len(e.Fields) == 0 {
		return "invalid request"
	}
	return e.Fields[0].Message
}

// Store is the persistence the service needs (implemented by *db.Queries).
type Store interface {
	GetLegalPageBySlug(ctx context.Context, slug string) (db.GetLegalPageBySlugRow, error)
	UpdateLegalPage(ctx context.Context, arg db.UpdateLegalPageParams) (int64, error)
}

// Service reads and edits legal pages.
type Service struct {
	store Store
}

// New creates a legal pages service.
func New(store Store) *Service {
	return &Service{store: store}
}

// PublicPage is one legal page in a single locale.
type PublicPage struct {
	Slug      string    `json:"slug"`
	Locale    string    `json:"locale"`
	Title     string    `json:"title"`
	Markdown  string    `json:"markdown"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Editor is the user who last saved the page.
type Editor struct {
	UUID  uuid.UUID `json:"uuid"`
	Name  string    `json:"name"`
	Email string    `json:"email"`
}

// Page is the admin view with every locale.
type Page struct {
	Slug       string    `json:"slug"`
	TitleTR    string    `json:"title_tr"`
	TitleEN    string    `json:"title_en"`
	MarkdownTR string    `json:"markdown_tr"`
	MarkdownEN string    `json:"markdown_en"`
	UpdatedAt  time.Time `json:"updated_at"`
	UpdatedBy  *Editor   `json:"updated_by"`
}

// PatchInput is a partial update; nil fields are kept.
type PatchInput struct {
	TitleTR    *string `json:"title_tr"`
	TitleEN    *string `json:"title_en"`
	MarkdownTR *string `json:"markdown_tr"`
	MarkdownEN *string `json:"markdown_en"`
}

// ResolveLocale maps the ?locale= query value; empty means tr.
func ResolveLocale(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", LocaleTR:
		return LocaleTR, nil
	case LocaleEN:
		return LocaleEN, nil
	default:
		return "", ErrInvalidLocale
	}
}

// GetPublic returns the page in locale, falling back to tr when the locale's
// body is empty.
func (s *Service) GetPublic(ctx context.Context, slug, locale string) (PublicPage, error) {
	row, err := s.get(ctx, slug)
	if err != nil {
		return PublicPage{}, err
	}
	out := PublicPage{
		Slug: row.Slug, Locale: LocaleTR, Title: row.TitleTr, Markdown: row.BodyTr,
		UpdatedAt: row.UpdatedAt.Time,
	}
	if locale == LocaleEN && strings.TrimSpace(row.BodyEn) != "" {
		out.Locale = LocaleEN
		out.Markdown = row.BodyEn
		if strings.TrimSpace(row.TitleEn) != "" {
			out.Title = row.TitleEn
		}
	}
	return out, nil
}

// Get returns the admin view of the page.
func (s *Service) Get(ctx context.Context, slug string) (Page, error) {
	row, err := s.get(ctx, slug)
	if err != nil {
		return Page{}, err
	}
	return mapPage(row), nil
}

// Patch validates and saves in, recording actorID as the editor.
func (s *Service) Patch(ctx context.Context, slug string, actorID *int64, in PatchInput) (Page, error) {
	if !ValidSlug(slug) {
		return Page{}, ErrNotFound
	}
	in = normalize(in)
	if err := validate(in); err != nil {
		return Page{}, err
	}
	params := db.UpdateLegalPageParams{
		TitleTr: text(in.TitleTR), TitleEn: text(in.TitleEN),
		BodyTr: text(in.MarkdownTR), BodyEn: text(in.MarkdownEN),
		Slug: slug,
	}
	if actorID != nil {
		params.UpdatedBy = pgtype.Int8{Int64: *actorID, Valid: true}
	}
	if _, err := s.store.UpdateLegalPage(ctx, params); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page{}, ErrNotFound
		}
		return Page{}, err
	}
	return s.Get(ctx, slug)
}

func (s *Service) get(ctx context.Context, slug string) (db.GetLegalPageBySlugRow, error) {
	if !ValidSlug(slug) {
		return db.GetLegalPageBySlugRow{}, ErrNotFound
	}
	row, err := s.store.GetLegalPageBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.GetLegalPageBySlugRow{}, ErrNotFound
	}
	return row, err
}

func mapPage(row db.GetLegalPageBySlugRow) Page {
	out := Page{
		Slug: row.Slug, TitleTR: row.TitleTr, TitleEN: row.TitleEn,
		MarkdownTR: row.BodyTr, MarkdownEN: row.BodyEn, UpdatedAt: row.UpdatedAt.Time,
	}
	if row.UpdatedByUuid.Valid {
		out.UpdatedBy = &Editor{
			UUID:  uuid.UUID(row.UpdatedByUuid.Bytes),
			Name:  strings.TrimSpace(row.UpdatedByName.String + " " + row.UpdatedBySurname.String),
			Email: row.UpdatedByEmail.String,
		}
	}
	return out
}

func normalize(in PatchInput) PatchInput {
	trim := func(p *string) *string {
		if p == nil {
			return nil
		}
		v := strings.TrimSpace(*p)
		return &v
	}
	lf := func(p *string) *string {
		if p == nil {
			return nil
		}
		v := strings.ReplaceAll(*p, "\r\n", "\n")
		return &v
	}
	return PatchInput{
		TitleTR: trim(in.TitleTR), TitleEN: trim(in.TitleEN),
		MarkdownTR: lf(in.MarkdownTR), MarkdownEN: lf(in.MarkdownEN),
	}
}

func validate(in PatchInput) error {
	var fields []FieldError
	add := func(field, code, msg string) {
		fields = append(fields, FieldError{Field: field, Code: code, Message: msg})
	}
	if in.TitleTR == nil && in.TitleEN == nil && in.MarkdownTR == nil && in.MarkdownEN == nil {
		add("body", "required", "at least one field is required")
	}
	checkText := func(field string, v *string, required bool, maxBytes, maxRunes int) {
		if v == nil {
			return
		}
		switch {
		case !utf8.ValidString(*v) || strings.ContainsRune(*v, 0):
			add(field, "invalid", field+" must be valid UTF-8 text")
		case required && strings.TrimSpace(*v) == "":
			add(field, "required", field+" is required")
		case maxBytes > 0 && len(*v) > maxBytes:
			add(field, "too_long", field+" must be at most 100 KB")
		case maxRunes > 0 && utf8.RuneCountInString(*v) > maxRunes:
			add(field, "too_long", field+" must be at most 200 characters")
		}
	}
	checkText("title_tr", in.TitleTR, true, 0, MaxTitleRunes)
	checkText("title_en", in.TitleEN, false, 0, MaxTitleRunes)
	checkText("markdown_tr", in.MarkdownTR, true, MaxMarkdownBytes, 0)
	checkText("markdown_en", in.MarkdownEN, false, MaxMarkdownBytes, 0)
	if len(fields) > 0 {
		return &ValidationError{Fields: fields}
	}
	return nil
}

func text(p *string) pgtype.Text {
	if p == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *p, Valid: true}
}
