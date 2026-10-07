package legal_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/legal"
	legalhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/legal/handler"
	legalusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/legal/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// fakeStore mimics the legal_pages SQL: COALESCE partial update, join on editor.
type fakeStore struct {
	rows map[string]*db.GetLegalPageBySlugRow
}

func newFakeStore() *fakeStore {
	return &fakeStore{rows: map[string]*db.GetLegalPageBySlugRow{
		"privacy": {
			ID: 1, Slug: "privacy",
			TitleTr: "Gizlilik", TitleEn: "Privacy",
			BodyTr: "# Merhaba", BodyEn: "",
			UpdatedAt: pgtype.Timestamptz{Time: time.Date(2026, 10, 7, 9, 0, 0, 0, time.UTC), Valid: true},
		},
	}}
}

func (f *fakeStore) GetLegalPageBySlug(_ context.Context, slug string) (db.GetLegalPageBySlugRow, error) {
	row, ok := f.rows[slug]
	if !ok {
		return db.GetLegalPageBySlugRow{}, pgx.ErrNoRows
	}
	return *row, nil
}

func (f *fakeStore) UpdateLegalPage(_ context.Context, arg db.UpdateLegalPageParams) (int64, error) {
	row, ok := f.rows[arg.Slug]
	if !ok {
		return 0, pgx.ErrNoRows
	}
	set := func(dst *string, v pgtype.Text) {
		if v.Valid {
			*dst = v.String
		}
	}
	set(&row.TitleTr, arg.TitleTr)
	set(&row.TitleEn, arg.TitleEn)
	set(&row.BodyTr, arg.BodyTr)
	set(&row.BodyEn, arg.BodyEn)
	row.UpdatedBy = arg.UpdatedBy
	row.UpdatedAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	if arg.UpdatedBy.Valid {
		row.UpdatedByUuid = pgtype.UUID{Bytes: editorUUID, Valid: true}
		row.UpdatedByName = pgtype.Text{String: "Ada", Valid: true}
		row.UpdatedBySurname = pgtype.Text{String: "Admin", Valid: true}
		row.UpdatedByEmail = pgtype.Text{String: "ada@example.test", Valid: true}
	}
	return row.ID, nil
}

var editorUUID = uuid.MustParse("6f2d4a8e-1c3b-4f5a-9e7d-2b1c0a9f8e7d")

// fakeLoader resolves the principal from the token subject.
type fakeLoader map[string]authctx.Principal

func (l fakeLoader) LoadPrincipal(_ *http.Request, claims jwt.Claims) (authctx.Principal, error) {
	return l[claims.Subject], nil
}

type env struct {
	mux    *http.ServeMux
	store  *fakeStore
	tokens map[string]string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	tm, err := jwt.NewManager("test-secret", time.Minute, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	users := map[string][]string{
		"none":   {},
		"reader": {rbac.PermPlatformLegalRead},
		"writer": {rbac.PermPlatformLegalRead, rbac.PermPlatformLegalWrite},
	}
	loader := fakeLoader{}
	tokens := map[string]string{}
	var internal int64 = 41
	for name, perms := range users {
		id := uuid.New()
		internal++
		loader[id.String()] = authctx.Principal{UserID: id, UserInternal: internal, Permissions: perms}
		tok, _, err := tm.IssueAccess(jwt.AccessInput{UserID: id})
		if err != nil {
			t.Fatal(err)
		}
		tokens[name] = tok
	}
	store := newFakeStore()
	mux := http.NewServeMux()
	legal.RegisterRoutes(mux, legalhandler.New(legalusecase.New(store), nil), tm, loader)
	return &env{mux: mux, store: store, tokens: tokens}
}

func (e *env) do(method, path, user string, body any) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	if user != "" {
		req.Header.Set("Authorization", "Bearer "+e.tokens[user])
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	return rec
}

type envelope[T any] struct {
	Success bool `json:"success"`
	Data    T    `json:"data"`
	Error   struct {
		Code    string `json:"code"`
		Details []struct {
			Field string `json:"field"`
			Code  string `json:"code"`
		} `json:"details"`
	} `json:"error"`
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) envelope[T] {
	t.Helper()
	var out envelope[T]
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return out
}

func TestPublicGet(t *testing.T) {
	e := newEnv(t)

	t.Run("tr default", func(t *testing.T) {
		rec := e.do(http.MethodGet, "/v1/public/legal/privacy", "", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body)
		}
		if cc := rec.Header().Get("Cache-Control"); !strings.HasPrefix(cc, "public") {
			t.Fatalf("Cache-Control = %q", cc)
		}
		got := decode[legalusecase.PublicPage](t, rec).Data
		if got.Locale != "tr" || got.Title != "Gizlilik" || got.Markdown != "# Merhaba" || got.UpdatedAt.IsZero() {
			t.Fatalf("unexpected page %+v", got)
		}
	})

	t.Run("en falls back to tr when empty", func(t *testing.T) {
		rec := e.do(http.MethodGet, "/v1/public/legal/privacy?locale=en", "", nil)
		got := decode[legalusecase.PublicPage](t, rec).Data
		if rec.Code != http.StatusOK || got.Locale != "tr" || got.Title != "Gizlilik" || got.Markdown != "# Merhaba" {
			t.Fatalf("status %d page %+v", rec.Code, got)
		}
	})

	t.Run("en when present", func(t *testing.T) {
		e.store.rows["privacy"].BodyEn = "# Hello"
		t.Cleanup(func() { e.store.rows["privacy"].BodyEn = "" })
		got := decode[legalusecase.PublicPage](t, e.do(http.MethodGet, "/v1/public/legal/privacy?locale=en", "", nil)).Data
		if got.Locale != "en" || got.Title != "Privacy" || got.Markdown != "# Hello" {
			t.Fatalf("unexpected page %+v", got)
		}
	})

	t.Run("unknown slug 404", func(t *testing.T) {
		for _, path := range []string{"/v1/public/legal/terms", "/v1/public/legal/Bad_Slug"} {
			if rec := e.do(http.MethodGet, path, "", nil); rec.Code != http.StatusNotFound {
				t.Fatalf("%s: status %d", path, rec.Code)
			}
		}
	})

	t.Run("invalid locale 400", func(t *testing.T) {
		if rec := e.do(http.MethodGet, "/v1/public/legal/privacy?locale=de", "", nil); rec.Code != http.StatusBadRequest {
			t.Fatalf("status %d", rec.Code)
		}
	})
}

func TestPlatformPermissions(t *testing.T) {
	e := newEnv(t)
	patch := map[string]string{"title_tr": "Yeni"}
	cases := []struct {
		name, method, user string
		want               int
	}{
		{"get anonymous", http.MethodGet, "", http.StatusUnauthorized},
		{"get without permission", http.MethodGet, "none", http.StatusForbidden},
		{"get reader", http.MethodGet, "reader", http.StatusOK},
		{"patch anonymous", http.MethodPatch, "", http.StatusUnauthorized},
		{"patch without permission", http.MethodPatch, "none", http.StatusForbidden},
		{"patch reader", http.MethodPatch, "reader", http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var body any
			if tc.method == http.MethodPatch {
				body = patch
			}
			if rec := e.do(tc.method, "/v1/platform/legal/privacy", tc.user, body); rec.Code != tc.want {
				t.Fatalf("status %d, want %d: %s", rec.Code, tc.want, rec.Body)
			}
		})
	}
	if e.store.rows["privacy"].TitleTr != "Gizlilik" {
		t.Fatal("forbidden PATCH changed the page")
	}
}

func TestPlatformPatch(t *testing.T) {
	t.Run("persists and records editor", func(t *testing.T) {
		e := newEnv(t)
		rec := e.do(http.MethodPatch, "/v1/platform/legal/privacy", "writer", map[string]string{
			"title_en": "  Privacy Policy  ", "markdown_en": "# Hi\r\nthere",
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body)
		}
		got := decode[legalusecase.Page](t, rec).Data
		if got.TitleEN != "Privacy Policy" || got.MarkdownEN != "# Hi\nthere" || got.TitleTR != "Gizlilik" {
			t.Fatalf("unexpected page %+v", got)
		}
		if got.UpdatedBy == nil || got.UpdatedBy.UUID != editorUUID || got.UpdatedBy.Name != "Ada Admin" {
			t.Fatalf("updated_by = %+v", got.UpdatedBy)
		}
		row := e.store.rows["privacy"]
		if !row.UpdatedBy.Valid || row.UpdatedBy.Int64 < 42 || row.BodyTr != "# Merhaba" {
			t.Fatalf("stored row %+v", row)
		}
	})

	t.Run("size limit", func(t *testing.T) {
		e := newEnv(t)
		atLimit := strings.Repeat("a", legalusecase.MaxMarkdownBytes)
		if rec := e.do(http.MethodPatch, "/v1/platform/legal/privacy", "writer",
			map[string]string{"markdown_tr": atLimit}); rec.Code != http.StatusOK {
			t.Fatalf("at limit: status %d", rec.Code)
		}
		rec := e.do(http.MethodPatch, "/v1/platform/legal/privacy", "writer",
			map[string]string{"markdown_en": atLimit + "ş"})
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("over limit: status %d", rec.Code)
		}
		env := decode[json.RawMessage](t, rec)
		if len(env.Error.Details) != 1 || env.Error.Details[0].Field != "markdown_en" || env.Error.Details[0].Code != "too_long" {
			t.Fatalf("details = %+v", env.Error.Details)
		}
		if e.store.rows["privacy"].BodyEn != "" {
			t.Fatal("rejected PATCH was stored")
		}
	})

	t.Run("validation", func(t *testing.T) {
		e := newEnv(t)
		for name, body := range map[string]any{
			"empty body":     map[string]string{},
			"blank tr title": map[string]string{"title_tr": "   "},
			"blank tr body":  map[string]string{"markdown_tr": "\n\n"},
			"long title":     map[string]string{"title_en": strings.Repeat("x", legalusecase.MaxTitleRunes+1)},
			"nul byte":       map[string]string{"markdown_en": "a\x00b"},
		} {
			if rec := e.do(http.MethodPatch, "/v1/platform/legal/privacy", "writer", body); rec.Code != http.StatusBadRequest {
				t.Fatalf("%s: status %d", name, rec.Code)
			}
		}
	})

	t.Run("unknown slug 404", func(t *testing.T) {
		e := newEnv(t)
		if rec := e.do(http.MethodPatch, "/v1/platform/legal/terms", "writer",
			map[string]string{"title_tr": "Koşullar"}); rec.Code != http.StatusNotFound {
			t.Fatalf("status %d", rec.Code)
		}
	})
}
