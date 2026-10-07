package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	whatsappusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

// Handler exposes platform WhatsApp integration HTTP endpoints.
type Handler struct {
	svc      *whatsappusecase.Service
	activity *activity.Recorder
}

// New creates a platform WhatsApp integration handler.
func New(svc *whatsappusecase.Service, rec *activity.Recorder) *Handler {
	return &Handler{svc: svc, activity: rec}
}

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.svc.Get(r.Context())
	if err != nil {
		response.InternalErr(w, r, err, "failed to load WhatsApp settings")
		return
	}
	response.JSON(w, r, http.StatusOK, settings)
}

func (h *Handler) PatchSettings(w http.ResponseWriter, r *http.Request) {
	var in whatsappusecase.PatchInput
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	uid := actorInternalID(r)
	settings, err := h.svc.Patch(r.Context(), uid, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if h.activity != nil {
		h.activity.Record(r.Context(), uid, "integrations.whatsapp.updated", "platform.integrations.whatsapp", nil, map[string]any{
			"provider":        settings.Provider,
			"app_id":          settings.AppID,
			"waba_id":         settings.WabaID,
			"phone_number_id": settings.PhoneNumberID,
			"api_version":     settings.APIVersion,
		}, r)
	}
	response.JSON(w, r, http.StatusOK, settings)
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, whatsappusecase.ErrInvalidRequest) {
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
		return
	}
	response.InternalErr(w, r, err, "failed to update WhatsApp settings")
}

func actorInternalID(r *http.Request) *int64 {
	p, ok := authctx.PrincipalFrom(r.Context())
	if !ok || p.UserInternal == 0 {
		return nil
	}
	id := p.UserInternal
	return &id
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(dst); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid body")
		return err
	}
	return nil
}
