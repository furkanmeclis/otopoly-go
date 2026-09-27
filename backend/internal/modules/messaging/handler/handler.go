package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

// Handler holds the messaging service.
type Handler struct {
	svc *messagingusecase.Service
}

// New creates a new messaging Handler.
func New(svc *messagingusecase.Service) *Handler {
	return &Handler{svc: svc}
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	var le *entitlements.LimitError
	if errors.As(err, &le) {
		middleware.WriteLimitReached(w, r, le.Decision)
		return
	}
	if errors.Is(err, entitlements.ErrFeatureDisabled) {
		response.Error(w, r, http.StatusForbidden, response.CodeFeatureDisabled, "This feature is not included in your plan")
		return
	}
	var verr *messagingusecase.ValidationError
	if errors.As(err, &verr) {
		details := []response.Detail{{Field: verr.Field, Message: verr.Msg, Code: "invalid"}}
		for _, k := range verr.Unknown {
			details = append(details, response.Detail{Field: verr.Field, Message: "{{" + k + "}}", Code: "unknown_placeholder"})
		}
		response.ValidationError(w, r, details)
		return
	}
	switch {
	case errors.Is(err, messagingusecase.ErrNotFound):
		response.NotFound(w, r, "not found")
	case errors.Is(err, messagingusecase.ErrForbidden):
		response.Forbidden(w, r, "forbidden")
	case errors.Is(err, messagingusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func orgID(r *http.Request) int64 {
	scope := orgctx.MustScope(r.Context())
	return scope.InternalID
}

// GetSession returns the WhatsApp session status for the current organization.
func (h *Handler) GetSession(w http.ResponseWriter, r *http.Request) {
	sess, err := h.svc.GetSession(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, sess)
}

// ConnectWhatsApp initiates a QR-based WhatsApp connection.
func (h *Handler) ConnectWhatsApp(w http.ResponseWriter, r *http.Request) {
	sess, err := h.svc.ConnectWhatsApp(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, sess)
}

// DisconnectWhatsApp disconnects the WhatsApp session.
func (h *Handler) DisconnectWhatsApp(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DisconnectWhatsApp(r.Context(), orgID(r)); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"success": true})
}

// ListRules returns notification rules for all events and channels.
func (h *Handler) ListRules(w http.ResponseWriter, r *http.Request) {
	rules, err := h.svc.ListRules(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, rules)
}

// ToggleRule enables or disables a notification rule.
func (h *Handler) ToggleRule(w http.ResponseWriter, r *http.Request) {
	eventType := r.PathValue("event_type")
	channel := r.PathValue("channel")
	if eventType == "" || channel == "" {
		response.BadRequest(w, r, response.CodeValidationError, "event_type and channel are required")
		return
	}
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	rule, err := h.svc.ToggleRule(r.Context(), orgID(r), eventType, channel, body.Enabled)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, rule)
}

// ListTemplates returns all message templates for the current organization.
func (h *Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	tpls, err := h.svc.ListTemplates(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, tpls)
}

// UpsertTemplate creates or updates a message template.
func (h *Handler) UpsertTemplate(w http.ResponseWriter, r *http.Request) {
	var in model.UpsertTemplateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	tpl, err := h.svc.UpsertTemplate(r.Context(), orgID(r), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, tpl)
}

// GetTemplate returns a single message template by UUID.
func (h *Handler) GetTemplate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid uuid")
		return
	}
	tpl, err := h.svc.GetTemplate(r.Context(), orgID(r), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, tpl)
}

// PatchTemplate partially updates a message template.
func (h *Handler) PatchTemplate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid uuid")
		return
	}
	var in model.PatchTemplateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	tpl, err := h.svc.PatchTemplate(r.Context(), orgID(r), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, tpl)
}

// DeleteTemplate removes a message template.
func (h *Handler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid uuid")
		return
	}
	if err := h.svc.DeleteTemplate(r.Context(), orgID(r), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"success": true})
}

// Simulate sends a test WhatsApp message for one event or the full job lifecycle.
func (h *Handler) Simulate(w http.ResponseWriter, r *http.Request) {
	var in model.SimulateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	result, err := h.svc.Simulate(r.Context(), orgID(r), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, result)
}

// TemplateCatalog lists template types with placeholders and effective templates.
func (h *Handler) TemplateCatalog(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.TemplateCatalog(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, items)
}

// SaveTemplateByKey upserts the organization override for type/channel/locale.
func (h *Handler) SaveTemplateByKey(w http.ResponseWriter, r *http.Request) {
	var in messagingusecase.SaveTemplateInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return
	}
	e, err := h.svc.SaveTemplate(r.Context(), orgID(r), r.PathValue("event_type"), r.PathValue("channel"), r.PathValue("locale"), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, e)
}

// ResetTemplateByKey deletes the override (system default applies).
func (h *Handler) ResetTemplateByKey(w http.ResponseWriter, r *http.Request) {
	e, err := h.svc.ResetTemplate(r.Context(), orgID(r), r.PathValue("event_type"), r.PathValue("channel"), r.PathValue("locale"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, e)
}
