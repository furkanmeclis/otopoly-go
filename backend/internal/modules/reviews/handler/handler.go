// Package handler exposes the tenant and public review HTTP endpoints.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	reviewsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reviews/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

// RateLimiter is the fixed-window limiter of the public routes (nil = off).
type RateLimiter interface {
	Allow(ctx context.Context, action, subject string, limit int, window time.Duration) (bool, time.Duration)
}

// Handler serves reviews.
type Handler struct {
	svc     *reviewsusecase.Service
	limiter RateLimiter
}

// New builds the handler.
func New(svc *reviewsusecase.Service, limiter RateLimiter) *Handler {
	return &Handler{svc: svc, limiter: limiter}
}

const maxBody = 64 << 10

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	var le *entitlements.LimitError
	switch {
	case errors.As(err, &le):
		middleware.WriteLimitReached(w, r, le.Decision)
	case errors.Is(err, entitlements.ErrFeatureDisabled):
		response.Error(w, r, http.StatusForbidden, response.CodeFeatureDisabled, "This feature is not included in your plan")
	case errors.Is(err, reviewsusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, reviewsusecase.ErrAlreadyAnswered):
		response.Conflict(w, r, "ALREADY_ANSWERED", "this review was already answered")
	case errors.Is(err, reviewsusecase.ErrExpired):
		response.Error(w, r, http.StatusGone, "REVIEW_EXPIRED", "this review link has expired")
	case errors.Is(err, reviewsusecase.ErrChannelUnavailable):
		response.Conflict(w, r, "CHANNEL_UNAVAILABLE", "no WhatsApp or SMS channel can send now")
	case errors.Is(err, reviewsusecase.ErrConflict):
		response.Conflict(w, r, response.CodeConflict, err.Error())
	case errors.Is(err, reviewsusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return false
	}
	return true
}

func pathUUID(w http.ResponseWriter, r *http.Request, key string) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue(key))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, key+" is invalid")
		return uuid.Nil, false
	}
	return id, true
}

func queryInt(r *http.Request, key string) (int, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return 0, true
	}
	n, err := strconv.Atoi(raw)
	return n, err == nil
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return host
}

func (h *Handler) allow(w http.ResponseWriter, r *http.Request, action string, limit int, window time.Duration) bool {
	if h.limiter == nil {
		return true
	}
	if ok, _ := h.limiter.Allow(r.Context(), action, clientIP(r), limit, window); !ok {
		response.TooManyRequests(w, r, "too many requests")
		return false
	}
	return true
}

// ---- tenant

// Meta serves GET /v1/tenant/reviews/meta.
func (h *Handler) Meta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.ResourceMeta())
}

// List serves GET /v1/tenant/reviews.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if banned := apiquery.ForbiddenParams(r.URL.Query()); len(banned) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "forbidden query parameter")
		return
	}
	q := apiquery.Parse(r.URL.Query())
	qs := r.URL.Query()
	f := reviewsusecase.ListFilters{
		Q: q.Q, Status: qs.Get("status"), FollowUp: qs.Get("follow_up"), Rating: qs.Get("rating"),
		Channel: qs.Get("channel"), Sort: strings.TrimSpace(qs.Get("sort")),
		IncludeTests: qs.Get("include_tests") == "true" || qs.Get("include_tests") == "1",
	}
	var ok bool
	if f.Score, ok = queryInt(r, "score"); !ok {
		response.BadRequest(w, r, response.CodeValidationError, "score is invalid")
		return
	}
	if f.Days, ok = queryInt(r, "days"); !ok {
		response.BadRequest(w, r, response.CodeValidationError, "days is invalid")
		return
	}
	if raw := strings.TrimSpace(qs.Get("customer_uuid")); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			response.BadRequest(w, r, response.CodeValidationError, "customer_uuid is invalid")
			return
		}
		f.CustomerUUID = &id
	}
	items, total, err := h.svc.List(r.Context(), q.Limit, q.Offset, f)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

// Summary serves GET /v1/tenant/reviews/summary.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	days, ok := queryInt(r, "days")
	if !ok {
		response.BadRequest(w, r, response.CodeValidationError, "days is invalid")
		return
	}
	out, err := h.svc.Summary(r.Context(), days)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// Get serves GET /v1/tenant/reviews/{uuid}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// FollowUp serves POST /v1/tenant/reviews/{uuid}/follow-up.
func (h *Handler) FollowUp(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in reviewsusecase.FollowUpInput
	if r.ContentLength != 0 && !decode(w, r, &in) {
		return
	}
	out, err := h.svc.MarkFollowedUp(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// GetSettings serves GET /v1/tenant/reviews/settings.
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.GetSettings(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// UpdateSettings serves PUT /v1/tenant/reviews/settings.
func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var in reviewsusecase.UpdateSettingsInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.UpdateSettings(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// SendTest serves POST /v1/tenant/reviews/settings/test.
func (h *Handler) SendTest(w http.ResponseWriter, r *http.Request) {
	var in reviewsusecase.TestInput
	if r.ContentLength != 0 && !decode(w, r, &in) {
		return
	}
	out, err := h.svc.SendTest(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// ---- public

func noIndex(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
}

// PublicGet serves GET /v1/public/reviews/{token}.
func (h *Handler) PublicGet(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, "review_public_view", 60, time.Minute) {
		return
	}
	out, err := h.svc.PublicGet(r.Context(), r.PathValue("token"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	noIndex(w)
	response.JSON(w, r, http.StatusOK, out)
}

// PublicAnswer serves POST /v1/public/reviews/{token}.
func (h *Handler) PublicAnswer(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, "review_public_answer", 10, 15*time.Minute) {
		return
	}
	var in reviewsusecase.PublicAnswerInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.PublicAnswer(r.Context(), r.PathValue("token"), in,
		reviewsusecase.ClientInfo{IP: clientIP(r), UserAgent: r.UserAgent()})
	if err != nil {
		writeError(w, r, err)
		return
	}
	noIndex(w)
	response.JSON(w, r, http.StatusOK, out)
}

// PublicGoogle serves POST /v1/public/reviews/{token}/google.
func (h *Handler) PublicGoogle(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, "review_public_google", 20, time.Minute) {
		return
	}
	out, err := h.svc.PublicGoogleRedirect(r.Context(), r.PathValue("token"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	noIndex(w)
	response.JSON(w, r, http.StatusOK, out)
}
