// Package handler is the HTTP layer of the organization calendar.
package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	calendarusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/calendar/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

type Handler struct {
	svc *calendarusecase.Service
}

func New(svc *calendarusecase.Service) *Handler {
	return &Handler{svc: svc}
}

// Meta returns layers the caller may see/move, event colours and time zone.
func (h *Handler) Meta(w http.ResponseWriter, r *http.Request) {
	meta, err := h.svc.GetMeta(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, meta)
}

// Feed returns own events plus module layers for ?from=YYYY-MM-DD&to=YYYY-MM-DD
// (to exclusive) and optional ?layers=events,jobs,…
func (h *Handler) Feed(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	layers, err := calendarusecase.ParseLayers(q.Get("layers"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	feed, err := h.svc.GetFeed(r.Context(), q.Get("from"), q.Get("to"), layers)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, feed)
}

// Move reschedules an event, todo or lead follow-up (drag and drop).
func (h *Handler) Move(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	var in calendarusecase.MoveInput
	if !decode(w, r, &in) {
		return
	}
	item, err := h.svc.Move(r.Context(), p.UserInternal, in, r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) CreateEvent(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	var in calendarusecase.EventInput
	if !decode(w, r, &in) {
		return
	}
	item, err := h.svc.CreateEvent(r.Context(), p.UserInternal, in, r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) GetEvent(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	item, err := h.svc.GetEvent(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) UpdateEvent(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in calendarusecase.EventInput
	if !decode(w, r, &in) {
		return
	}
	item, err := h.svc.UpdateEvent(r.Context(), p.UserInternal, id, in, r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) DeleteEvent(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteEvent(r.Context(), p.UserInternal, id, r); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"deleted": true})
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, calendarusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, calendarusecase.ErrForbidden):
		response.Forbidden(w, r, err.Error())
	case errors.Is(err, calendarusecase.ErrInvalidRequest):
		response.ValidationError(w, r, []response.Detail{{Message: err.Error()}})
	default:
		response.InternalErr(w, r, err, "calendar request failed")
	}
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(dst); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid body")
		return false
	}
	return true
}

func pathUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid uuid")
		return uuid.Nil, false
	}
	return id, true
}
