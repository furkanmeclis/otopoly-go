// Package handler exposes member notification preferences over HTTP.
package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

// Handler serves /v1/tenant/notification-preferences.
type Handler struct {
	svc *centerusecase.Service
}

// New creates the handler.
func New(svc *centerusecase.Service) *Handler { return &Handler{svc: svc} }

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, centerusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	case errors.Is(err, centerusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

// GetPreferences returns the caller's per-type channel preferences.
func (h *Handler) GetPreferences(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.GetPreferences(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, p)
}

// PutPreferences updates phone and per-type switches.
func (h *Handler) PutPreferences(w http.ResponseWriter, r *http.Request) {
	var in model.PreferencesInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	p, err := h.svc.UpdatePreferences(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, p)
}
