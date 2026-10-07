package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	legalusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/legal/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

// publicCacheControl lets the frontend/CDN cache the public page briefly;
// admin edits show up within a minute.
const publicCacheControl = "public, max-age=60, stale-while-revalidate=300"

// maxPatchBody covers two 100 KB Markdown bodies plus JSON escaping.
const maxPatchBody = 1 << 20

// Handler exposes legal page HTTP endpoints.
type Handler struct {
	svc      *legalusecase.Service
	activity *activity.Recorder
}

// New creates a legal pages handler.
func New(svc *legalusecase.Service, rec *activity.Recorder) *Handler {
	return &Handler{svc: svc, activity: rec}
}

// PublicGet serves GET /v1/public/legal/{slug}?locale=tr|en.
func (h *Handler) PublicGet(w http.ResponseWriter, r *http.Request) {
	locale, err := legalusecase.ResolveLocale(r.URL.Query().Get("locale"))
	if err != nil {
		response.ValidationError(w, r, []response.Detail{{
			Field: "locale", Code: "invalid", Message: err.Error(),
		}})
		return
	}
	page, err := h.svc.GetPublic(r.Context(), r.PathValue("slug"), locale)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", publicCacheControl)
	response.JSON(w, r, http.StatusOK, page)
}

// Get serves GET /v1/platform/legal/{slug}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	page, err := h.svc.Get(r.Context(), r.PathValue("slug"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, page)
}

// Patch serves PATCH /v1/platform/legal/{slug}.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	var in legalusecase.PatchInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxPatchBody))
	if err := dec.Decode(&in); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			response.Error(w, r, http.StatusRequestEntityTooLarge, response.CodeValidationError, "request body too large")
			return
		}
		response.BadRequest(w, r, response.CodeValidationError, "invalid body")
		return
	}
	actor := actorInternalID(r)
	page, err := h.svc.Patch(r.Context(), r.PathValue("slug"), actor, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if h.activity != nil {
		h.activity.Record(r.Context(), actor, "legal.page.updated", "platform.legal", nil, map[string]any{
			"slug":   page.Slug,
			"fields": changedFields(in),
		}, r)
	}
	response.JSON(w, r, http.StatusOK, page)
}

func changedFields(in legalusecase.PatchInput) []string {
	out := []string{}
	for _, f := range []struct {
		name string
		v    *string
	}{
		{"title_tr", in.TitleTR}, {"title_en", in.TitleEN},
		{"markdown_tr", in.MarkdownTR}, {"markdown_en", in.MarkdownEN},
	} {
		if f.v != nil {
			out = append(out, f.name)
		}
	}
	return out
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	var verr *legalusecase.ValidationError
	switch {
	case errors.As(err, &verr):
		details := make([]response.Detail, 0, len(verr.Fields))
		for _, f := range verr.Fields {
			details = append(details, response.Detail{Field: f.Field, Code: f.Code, Message: f.Message})
		}
		response.ValidationError(w, r, details)
	case errors.Is(err, legalusecase.ErrNotFound):
		response.NotFound(w, r, "Legal page not found")
	default:
		response.InternalErr(w, r, err, "failed to load legal page")
	}
}

func actorInternalID(r *http.Request) *int64 {
	p, ok := authctx.PrincipalFrom(r.Context())
	if !ok {
		return nil
	}
	id := p.UserInternal
	return &id
}
