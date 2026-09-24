// Package handler exposes organization todos over HTTP.
package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

// Handler serves /v1/tenant/todos.
type Handler struct {
	svc *todosusecase.Service
}

// New creates the handler.
func New(svc *todosusecase.Service) *Handler { return &Handler{svc: svc} }

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, todosusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, todosusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	if err := dec.Decode(dst); err != nil {
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

// Meta returns the resource meta.
func (h *Handler) Meta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.ResourceMeta())
}

// Summary returns open/overdue/today counts.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	s, err := h.svc.Summary(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, s)
}

// Assignees lists members todos can be assigned to.
func (h *Handler) Assignees(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.Assignees(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, items)
}

// List lists todos.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if banned := apiquery.ForbiddenParams(r.URL.Query()); len(banned) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "forbidden query parameter")
		return
	}
	q := apiquery.Parse(r.URL.Query())
	items, total, err := h.svc.List(r.Context(), q.Limit, q.Offset, todosusecase.ListFilters{
		Status:   strings.TrimSpace(r.URL.Query().Get("status")),
		Scope:    strings.TrimSpace(r.URL.Query().Get("scope")),
		Assignee: strings.TrimSpace(r.URL.Query().Get("assignee")),
		Q:        q.Q,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

// Get returns one todo.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	item, err := h.svc.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

// Create adds a todo.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var in todosusecase.CreateInput
	if !decode(w, r, &in) {
		return
	}
	in.ViaAI = false
	item, err := h.svc.Create(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

// Patch updates a todo.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in todosusecase.PatchInput
	if !decode(w, r, &in) {
		return
	}
	item, err := h.svc.Patch(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

// Complete marks a todo done.
func (h *Handler) Complete(w http.ResponseWriter, r *http.Request) { h.setStatus(w, r, "done") }

// Reopen marks a todo open again.
func (h *Handler) Reopen(w http.ResponseWriter, r *http.Request) { h.setStatus(w, r, "open") }

func (h *Handler) setStatus(w http.ResponseWriter, r *http.Request, status string) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	item, err := h.svc.SetStatus(r.Context(), id, status)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

// Delete removes a todo.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"deleted": true})
}
