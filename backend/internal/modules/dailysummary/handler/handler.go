package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	dsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/dailysummary/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

type Handler struct {
	svc *dsusecase.Service
}

func New(svc *dsusecase.Service) *Handler {
	return &Handler{svc: svc}
}

func orgID(r *http.Request) int64 {
	return orgctx.MustScope(r.Context()).InternalID
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, dsusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	case errors.Is(err, dsusecase.ErrWhatsAppNotConnected):
		response.Conflict(w, r, "WHATSAPP_NOT_CONNECTED", "WhatsApp is not connected")
	case errors.Is(err, dsusecase.ErrNoRecipientsWithPhone):
		response.Conflict(w, r, "NO_RECIPIENT_PHONE", "No selected recipient has a WhatsApp number")
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

// GetSettings returns the end-of-day summary settings and selectable members.
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.GetSettings(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// UpdateSettings saves enabled flag, send time (HH:MM) and recipients.
func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var in dsusecase.UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	out, err := h.svc.UpdateSettings(r.Context(), orgID(r), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// Preview renders today's summary so far.
func (h *Handler) Preview(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Preview(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// SendTest sends today's summary so far to the saved recipients now.
func (h *Handler) SendTest(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.SendTest(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}
