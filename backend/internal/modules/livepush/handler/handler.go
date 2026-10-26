// Package handler exposes the Live Activity / widget push registration API
// under /v1/tenant/live-activities (organization from X-Organization).
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/livepush/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

// RateLimiter is a fixed-window limiter (satisfied by *ratelimit.Limiter).
type RateLimiter interface {
	Allow(ctx context.Context, action, subject string, limit int, window time.Duration) (bool, time.Duration)
}

// Registration runs on activity start, token rotation and app launch; a
// client loop must not hammer the database.
const (
	registerLimit  = 30
	registerWindow = time.Minute
)

// Handler serves the registration endpoints.
type Handler struct {
	svc     *usecase.Service
	limiter RateLimiter
}

// New creates the handler.
func New(svc *usecase.Service) *Handler { return &Handler{svc: svc} }

// SetRateLimiter enables the per-user limit.
func (h *Handler) SetRateLimiter(l RateLimiter) { h.limiter = l }

func (h *Handler) rateLimited(w http.ResponseWriter, r *http.Request) bool {
	if h.limiter == nil {
		return false
	}
	p, ok := authctx.PrincipalFrom(r.Context())
	if !ok || p.UserInternal <= 0 {
		return false
	}
	allowed, retry := h.limiter.Allow(r.Context(), "live_activity", strconv.FormatInt(p.UserInternal, 10), registerLimit, registerWindow)
	if allowed {
		return false
	}
	if retry > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())+1))
	}
	response.TooManyRequests(w, r, "Too many Live Activity requests. Try again in a moment.")
	return true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid request body")
		return false
	}
	return true
}

func validation(w http.ResponseWriter, r *http.Request, errs map[string]string) {
	fields := make([]string, 0, len(errs))
	for f := range errs {
		fields = append(fields, f)
	}
	sort.Strings(fields)
	details := make([]response.Detail, 0, len(fields))
	for _, f := range fields {
		details = append(details, response.Detail{Field: f, Message: f + " is " + errs[f], Code: errs[f]})
	}
	response.ValidationError(w, r, details)
}

func writeErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, usecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, usecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func jobUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "job uuid is invalid")
		return uuid.Nil, false
	}
	return id, true
}

// RegisterActivity handles PUT /v1/tenant/live-activities/jobs/{uuid}.
func (h *Handler) RegisterActivity(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	if h.rateLimited(w, r) {
		return
	}
	id, ok := jobUUID(w, r)
	if !ok {
		return
	}
	var in usecase.ActivityInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if errs := usecase.ValidateActivity(in); len(errs) > 0 {
		validation(w, r, errs)
		return
	}
	item, err := h.svc.RegisterActivity(r.Context(), p.UserInternal, id, in)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

// UnregisterActivity handles POST /v1/tenant/live-activities/jobs/{uuid}/unregister.
func (h *Handler) UnregisterActivity(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	if h.rateLimited(w, r) {
		return
	}
	id, ok := jobUUID(w, r)
	if !ok {
		return
	}
	var body struct {
		ActivityID  string `json:"activity_id"`
		DeviceToken string `json:"device_token"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if len(body.ActivityID) > 128 || len(body.DeviceToken) > 255 {
		validation(w, r, map[string]string{"activity_id": "invalid"})
		return
	}
	if err := h.svc.UnregisterActivity(r.Context(), p.UserInternal, id, body.ActivityID, body.DeviceToken); err != nil {
		writeErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]string{"status": "ok"})
}

// RegisterDevice handles PUT /v1/tenant/live-activities/device.
func (h *Handler) RegisterDevice(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	if h.rateLimited(w, r) {
		return
	}
	var in usecase.DeviceInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if errs := usecase.ValidateDevice(in); len(errs) > 0 {
		validation(w, r, errs)
		return
	}
	item, err := h.svc.RegisterDevice(r.Context(), p.UserInternal, in)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

// UnregisterDevice handles DELETE /v1/tenant/live-activities/device/{token}.
func (h *Handler) UnregisterDevice(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	if h.rateLimited(w, r) {
		return
	}
	token := strings.TrimSpace(r.PathValue("token"))
	if token == "" || len(token) > 255 {
		validation(w, r, map[string]string{"token": "invalid"})
		return
	}
	if err := h.svc.UnregisterDevice(r.Context(), p.UserInternal, token); err != nil {
		writeErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]string{"status": "ok"})
}
