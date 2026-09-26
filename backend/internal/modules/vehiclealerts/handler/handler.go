package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	vausecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclealerts/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

type Handler struct {
	svc *vausecase.Service
}

func New(svc *vausecase.Service) *Handler {
	return &Handler{svc: svc}
}

func orgID(r *http.Request) int64 {
	return orgctx.MustScope(r.Context()).InternalID
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, vausecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	case errors.Is(err, vausecase.ErrWhatsAppNotConnected):
		response.Conflict(w, r, "WHATSAPP_NOT_CONNECTED", "WhatsApp is not connected")
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

// GetSettings returns vehicle alert settings, members and services.
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.GetSettings(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// UpdateSettings saves events, services, recipients and batch window.
func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var in vausecase.UpdateInput
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

// SendTest sends a sample alert to the saved recipients.
func (h *Handler) SendTest(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.SendTest(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}
