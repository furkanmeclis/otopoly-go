package handler

import (
	"errors"
	"net/http"
	"strings"

	reportsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reports/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

type Handler struct {
	svc *reportsusecase.Service
}

func New(svc *reportsusecase.Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Meta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, h.svc.ResourceMeta())
}

func (h *Handler) Overview(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	item, err := h.svc.Overview(r.Context(), reportsusecase.Query{
		DateFrom:      strings.TrimSpace(q.Get("date_from")),
		DateTo:        strings.TrimSpace(q.Get("date_to")),
		Currency:      strings.TrimSpace(q.Get("currency")),
		PaymentMethod: strings.TrimSpace(q.Get("payment_method")),
		AccountUUID:   strings.TrimSpace(q.Get("account_uuid")),
		SourceType:    strings.TrimSpace(q.Get("source_type")),
		Granularity:   strings.TrimSpace(q.Get("granularity")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, reportsusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	default:
		response.InternalErr(w, r, err, "unexpected error")
	}
}
