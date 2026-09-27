// Package handler exposes tenant and public quote HTTP endpoints.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

// RateLimiter is the fixed-window limiter used on public routes (nil = off).
type RateLimiter interface {
	Allow(ctx context.Context, action, subject string, limit int, window time.Duration) (bool, time.Duration)
}

// Handler serves quotes.
type Handler struct {
	svc     *quotesusecase.Service
	limiter RateLimiter
}

// New builds the handler.
func New(svc *quotesusecase.Service, limiter RateLimiter) *Handler {
	return &Handler{svc: svc, limiter: limiter}
}

const maxBody = 1 << 20

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	var le *entitlements.LimitError
	switch {
	case errors.As(err, &le):
		middleware.WriteLimitReached(w, r, le.Decision)
	case errors.Is(err, entitlements.ErrFeatureDisabled):
		response.Error(w, r, http.StatusForbidden, response.CodeFeatureDisabled, "This feature is not included in your plan")
	case errors.Is(err, quotesusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, quotesusecase.ErrVehicleRequired):
		response.BadRequest(w, r, "VEHICLE_REQUIRED", err.Error())
	case errors.Is(err, quotesusecase.ErrInvalidTransition):
		response.Conflict(w, r, "INVALID_TRANSITION", err.Error())
	case errors.Is(err, quotesusecase.ErrConflict):
		response.Conflict(w, r, response.CodeConflict, err.Error())
	case errors.Is(err, quotesusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	case errors.Is(err, quotesusecase.ErrNotConfigured):
		response.ServiceUnavailable(w, r, "NOT_CONFIGURED", "messaging is not configured")
	case errors.Is(err, quotesusecase.ErrPDFUnavailable):
		response.ServiceUnavailable(w, r, "PDF_UNAVAILABLE", "PDF could not be generated")
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

func queryUUID(r *http.Request, key string) (*uuid.UUID, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%s is invalid", key)
	}
	return &id, nil
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

func client(r *http.Request) quotesusecase.ClientInfo {
	return quotesusecase.ClientInfo{IP: clientIP(r), UserAgent: r.UserAgent()}
}

func writePDF(w http.ResponseWriter, data []byte, filename string, inline bool) {
	disp := "attachment"
	if inline {
		disp = "inline"
	}
	safe := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-' {
			return r
		}
		return '_'
	}, filename)
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename="%s"; filename*=UTF-8''%s`, disp, safe, url.PathEscape(filename)))
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = w.Write(data)
}

// ---- tenant

func (h *Handler) Meta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.ResourceMeta())
}

func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Summary(r.Context(), r.URL.Query().Get("currency"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if banned := apiquery.ForbiddenParams(r.URL.Query()); len(banned) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "forbidden query parameter")
		return
	}
	q := apiquery.Parse(r.URL.Query())
	customer, err := queryUUID(r, "customer_uuid")
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
		return
	}
	lead, err := queryUUID(r, "lead_uuid")
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
		return
	}
	items, total, err := h.svc.List(r.Context(), q.Limit, q.Offset, quotesusecase.ListFilters{
		Q: q.Q, Status: r.URL.Query().Get("status"), CustomerUUID: customer, LeadUUID: lead,
		Sort: strings.TrimSpace(r.URL.Query().Get("sort")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var in quotesusecase.SaveInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.Create(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

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

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in quotesusecase.SaveInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.Update(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) Duplicate(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.Duplicate(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) SetStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in quotesusecase.StatusInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.SetStatus(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) Send(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in quotesusecase.SendInput
	if r.ContentLength != 0 && !decode(w, r, &in) {
		return
	}
	out, err := h.svc.Send(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// SendPreview renders the customer message for the send dialog.
func (h *Handler) SendPreview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.SendPreview(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) RetryDelivery(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	did, ok := pathUUID(w, r, "deliveryUuid")
	if !ok {
		return
	}
	out, err := h.svc.RetryDelivery(r.Context(), id, did)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) SetReminders(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in struct {
		Reminders []quotesusecase.ReminderInput `json:"reminders"`
	}
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.SetReminders(r.Context(), id, in.Reminders)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PDF(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	data, name, err := h.svc.PDF(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writePDF(w, data, name, r.URL.Query().Get("inline") == "1")
}

func (h *Handler) ConvertPreview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	out, err := h.svc.ConvertPreview(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) Convert(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "uuid")
	if !ok {
		return
	}
	var in quotesusecase.ConvertInput
	if r.ContentLength != 0 && !decode(w, r, &in) {
		return
	}
	out, err := h.svc.Convert(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

// ---- public (share link)

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

func (h *Handler) PublicGet(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, "quote_public_view", 60, time.Minute) {
		return
	}
	out, err := h.svc.PublicGet(r.Context(), r.PathValue("token"), client(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) publicDecide(w http.ResponseWriter, r *http.Request, accept bool) {
	if !h.allow(w, r, "quote_public_decide", 10, 15*time.Minute) {
		return
	}
	var in quotesusecase.PublicDecisionInput
	if r.ContentLength != 0 && !decode(w, r, &in) {
		return
	}
	out, err := h.svc.PublicDecide(r.Context(), r.PathValue("token"), accept, in, client(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PublicAccept(w http.ResponseWriter, r *http.Request) { h.publicDecide(w, r, true) }

func (h *Handler) PublicReject(w http.ResponseWriter, r *http.Request) { h.publicDecide(w, r, false) }

func (h *Handler) PublicPDF(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, "quote_public_pdf", 20, time.Minute) {
		return
	}
	data, name, err := h.svc.PublicPDF(r.Context(), r.PathValue("token"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("X-Robots-Tag", "noindex")
	writePDF(w, data, name, r.URL.Query().Get("inline") == "1")
}
