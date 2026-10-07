package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	whatsappusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/usecase"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

// PlatformSender is the platform number surface of the messaging module.
type PlatformSender interface {
	ConnectPlatformWhatsApp(ctx context.Context) error
	DisconnectPlatformWhatsApp(ctx context.Context) error
	SendPlatformTest(ctx context.Context, in messagingusecase.PlatformTestInput) (messagingusecase.PlatformTestResult, error)
}

// Handler exposes platform WhatsApp integration HTTP endpoints.
type Handler struct {
	svc       *whatsappusecase.Service
	activity  *activity.Recorder
	templates *whatsappusecase.Templates
	sender    PlatformSender
}

// New creates a platform WhatsApp integration handler.
func New(svc *whatsappusecase.Service, rec *activity.Recorder) *Handler {
	return &Handler{svc: svc, activity: rec}
}

// WithPlatform attaches the template catalog service and platform sender.
func (h *Handler) WithPlatform(templates *whatsappusecase.Templates, sender PlatformSender) *Handler {
	h.templates, h.sender = templates, sender
	return h
}

func (h *Handler) record(r *http.Request, action string, meta map[string]any) {
	if h.activity != nil {
		h.activity.Record(r.Context(), actorInternalID(r), action, "platform.integrations.whatsapp", nil, meta, r)
	}
}

// TestSend sends a test message from the platform number.
func (h *Handler) TestSend(w http.ResponseWriter, r *http.Request) {
	var in messagingusecase.PlatformTestInput
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	res, err := h.sender.SendPlatformTest(r.Context(), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.record(r, "integrations.whatsapp.test_sent", map[string]any{
		"sender_kind": res.SenderKind, "template_name": res.TemplateName,
	})
	response.JSON(w, r, http.StatusOK, res)
}

// ConnectSession starts QR pairing of the platform whatsmeow number; the QR
// is then polled from GET /v1/platform/integrations/whatsapp.
func (h *Handler) ConnectSession(w http.ResponseWriter, r *http.Request) {
	if err := h.sender.ConnectPlatformWhatsApp(r.Context()); err != nil {
		writeError(w, r, err)
		return
	}
	h.record(r, "integrations.whatsapp.session_connect", nil)
	h.GetSettings(w, r)
}

// DisconnectSession logs the platform whatsmeow number out.
func (h *Handler) DisconnectSession(w http.ResponseWriter, r *http.Request) {
	if err := h.sender.DisconnectPlatformWhatsApp(r.Context()); err != nil {
		writeError(w, r, err)
		return
	}
	h.record(r, "integrations.whatsapp.session_disconnect", nil)
	h.GetSettings(w, r)
}

// ListTemplates returns the catalog with Meta state.
func (h *Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	items, err := h.templates.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"items": items})
}

// SubmitTemplates submits not-yet-submitted templates (all or given keys).
func (h *Handler) SubmitTemplates(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Keys []string `json:"keys"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &in); err != nil {
			return
		}
	}
	results, err := h.templates.Submit(r.Context(), in.Keys)
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.record(r, "integrations.whatsapp.templates_submitted", map[string]any{"count": len(results)})
	items, err := h.templates.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"results": results, "items": items})
}

// SyncTemplates pulls template statuses from Meta.
func (h *Handler) SyncTemplates(w http.ResponseWriter, r *http.Request) {
	items, err := h.templates.Sync(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.record(r, "integrations.whatsapp.templates_synced", map[string]any{"count": len(items)})
	response.JSON(w, r, http.StatusOK, map[string]any{"items": items})
}

// PatchTemplate sets or clears the Meta name override of a catalog key.
func (h *Handler) PatchTemplate(w http.ResponseWriter, r *http.Request) {
	var in whatsappusecase.OverrideInput
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	key := r.PathValue("key")
	item, err := h.templates.SetOverride(r.Context(), key, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.record(r, "integrations.whatsapp.template_override", map[string]any{
		"key": key, "override_name": item.OverrideName,
	})
	response.JSON(w, r, http.StatusOK, item)
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
	if errors.Is(err, whatsappusecase.ErrInvalidRequest) || errors.Is(err, messagingusecase.ErrInvalidRequest) {
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
		return
	}
	if errors.Is(err, whatsappusecase.ErrTemplateNotFound) {
		response.NotFound(w, r, "template not found")
		return
	}
	// Classified sender / Meta errors: 409 with the error code (e.g.
	// CLOUD_AUTH_FAILED, PLATFORM_SENDER_NOT_CONFIGURED, GRAPH_100).
	var se *messagingmodel.SendError
	if errors.As(err, &se) {
		response.Error(w, r, http.StatusConflict, strings.ToUpper(se.Code), se.Error())
		return
	}
	response.InternalErr(w, r, err, "WhatsApp integration request failed")
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
