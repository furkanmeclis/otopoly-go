// Package handler serves /v1/tenant/stock-reorder.
package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	sru "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/stockreorder/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

type Handler struct {
	svc *sru.Service
}

func New(svc *sru.Service) *Handler { return &Handler{svc: svc} }

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, sru.ErrFeatureDisabled):
		response.Error(w, r, http.StatusForbidden, response.CodeFeatureDisabled, "This feature is not included in your plan")
	case errors.Is(err, sru.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, sru.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, strings.TrimPrefix(err.Error(), "stockreorder: invalid request: "))
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return false
	}
	return true
}

// List: GET /v1/tenant/stock-reorder/suggestions
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	out, err := h.svc.List(r.Context(), sru.ListFilters{
		SupplierUUID: q.Get("supplier_uuid"),
		Urgency:      q.Get("urgency"),
		Q:            q.Get("q"),
		All:          q.Get("all") == "true" || q.Get("all") == "1",
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// Summary: GET /v1/tenant/stock-reorder/summary
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Summary(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// GetSettings: GET /v1/tenant/stock-reorder/settings
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.GetSettings(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// UpdateSettings: PUT /v1/tenant/stock-reorder/settings
func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var in sru.SettingsInput
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

type overrideResponse struct {
	ProductUUID uuid.UUID            `json:"product_uuid"`
	Override    *sru.ProductOverride `json:"override"`
}

func productUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "product uuid is invalid")
		return uuid.Nil, false
	}
	return id, true
}

// GetProduct: GET /v1/tenant/stock-reorder/products/{uuid}
func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	id, ok := productUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.GetProductOverride(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, overrideResponse{ProductUUID: id, Override: out})
}

// PutProduct: PUT /v1/tenant/stock-reorder/products/{uuid}
func (h *Handler) PutProduct(w http.ResponseWriter, r *http.Request) {
	id, ok := productUUID(w, r)
	if !ok {
		return
	}
	var in sru.ProductOverrideInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.SetProductOverride(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, overrideResponse{ProductUUID: id, Override: out})
}

// DeleteProduct: DELETE /v1/tenant/stock-reorder/products/{uuid}
func (h *Handler) DeleteProduct(w http.ResponseWriter, r *http.Request) {
	id, ok := productUUID(w, r)
	if !ok {
		return
	}
	if _, err := h.svc.SetProductOverride(r.Context(), id, sru.ProductOverrideInput{}); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"deleted": true})
}

// CreateDrafts: POST /v1/tenant/stock-reorder/drafts
func (h *Handler) CreateDrafts(w http.ResponseWriter, r *http.Request) {
	var in sru.CreateDraftsInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.CreateDrafts(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, out)
}
