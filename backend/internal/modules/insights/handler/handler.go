package handler

import (
	"errors"
	"net/http"
	"strconv"

	insightsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/insights/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

type Handler struct {
	svc *insightsusecase.Service
}

func New(svc *insightsusecase.Service) *Handler {
	return &Handler{svc: svc}
}

func pathUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid UUID")
		return uuid.Nil, false
	}
	return id, true
}

func limit(r *http.Request) int32 {
	n, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	return insightsusecase.ClampLimit(n)
}

func write(w http.ResponseWriter, r *http.Request, data any, err error, what string) {
	if err != nil {
		if errors.Is(err, insightsusecase.ErrNotFound) {
			response.NotFound(w, r, what+" not found")
			return
		}
		response.InternalErr(w, r, err, "failed to load "+what+" summary")
		return
	}
	response.JSON(w, r, http.StatusOK, data)
}

func (h *Handler) ProductSummary(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.ProductSummary(r.Context(), id)
	write(w, r, out, err, "Product")
}

func (h *Handler) ProductMovements(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	items, err := h.svc.ProductMovements(r.Context(), id, limit(r))
	write(w, r, map[string]any{"items": items, "total": len(items)}, err, "Product")
}

func (h *Handler) ServiceSummary(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.ServiceSummary(r.Context(), id)
	write(w, r, out, err, "Service")
}

func (h *Handler) ServiceJobs(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	items, err := h.svc.ServiceJobs(r.Context(), id, limit(r))
	write(w, r, map[string]any{"items": items, "total": len(items)}, err, "Service")
}

func (h *Handler) CustomerSummary(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.CustomerSummary(r.Context(), id)
	write(w, r, out, err, "Customer")
}

func (h *Handler) SupplierSummary(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	out, err := h.svc.SupplierSummary(r.Context(), id)
	write(w, r, out, err, "Supplier")
}
