package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	billingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

type Handler struct{ svc *billingusecase.Service }

func New(svc *billingusecase.Service) *Handler { return &Handler{svc: svc} }

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, billingusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, billingusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	case errors.Is(err, billingusecase.ErrConflict):
		response.Conflict(w, r, response.CodeConflict, err.Error())
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return false
	}
	return true
}

func pathUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "plan uuid is invalid")
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) TenantOverview(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Overview(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) TenantPlans(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.ListPlans(r.Context(), true)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformListFeatures(w http.ResponseWriter, r *http.Request) {
	includeInactive := r.URL.Query().Get("include_inactive") == "true"
	out, err := h.svc.ListFeatures(r.Context(), includeInactive)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformCreateFeature(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.DisplayFeatureInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreateDisplayFeature(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) PlatformSetFeatureActive(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "feature id is invalid")
		return
	}
	var in struct {
		IsActive bool `json:"is_active"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := h.svc.SetFeatureActive(r.Context(), id, in.IsActive); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"updated": true})
}

func (h *Handler) PlatformListPlans(w http.ResponseWriter, r *http.Request) {
	_ = r.URL.Query().Get("include_inactive") == "true"
	out, err := h.svc.ListPlans(r.Context(), false)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformCreatePlan(w http.ResponseWriter, r *http.Request) {
	var in billingusecase.PlanInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreatePlan(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}

func (h *Handler) PlatformGetPlan(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.GetPlan(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformUpdatePlan(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in billingusecase.PlanInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.UpdatePlan(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

func (h *Handler) PlatformDeletePlan(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeletePlan(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"deleted": true})
}
