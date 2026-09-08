package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

type Handler struct {
	svc *customersusecase.Service
}

func New(svc *customersusecase.Service) *Handler {
	return &Handler{svc: svc}
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, customersusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, customersusecase.ErrConflict):
		response.Conflict(w, r, response.CodeConflict, err.Error())
	case errors.Is(err, customersusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func (h *Handler) Meta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.ResourceMeta())
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if banned := apiquery.ForbiddenParams(r.URL.Query()); len(banned) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "forbidden query parameter")
		return
	}
	q := apiquery.Parse(r.URL.Query())
	var isActive *bool
	if v := r.URL.Query().Get("is_active"); v != "" {
		b := v == "true"
		isActive = &b
	}
	items, total, err := h.svc.List(r.Context(), q.Limit, q.Offset, customersusecase.Filters{
		Q:        q.Q,
		Kind:     r.URL.Query().Get("kind"),
		IsActive: isActive,
		Sort:     strings.TrimSpace(r.URL.Query().Get("sort")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var in customersusecase.CreateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.Create(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "customer uuid is invalid")
		return
	}
	item, err := h.svc.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "customer uuid is invalid")
		return
	}
	var in customersusecase.PatchInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.Patch(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "customer uuid is invalid")
		return
	}
	if err := h.svc.Delete(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}

func (h *Handler) AddVehicle(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "customer uuid is invalid")
		return
	}
	var in customersusecase.CreateVehicleInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	item, err := h.svc.AddVehicle(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) DeleteVehicle(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "vehicle uuid is invalid")
		return
	}
	if err := h.svc.DeleteVehicle(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}
