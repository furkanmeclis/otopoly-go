package smschannel

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

// Handler serves /v1/tenant/messaging/sms*.
type Handler struct {
	svc *Service
}

// NewHandler wraps the service.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func orgID(r *http.Request) int64 { return orgctx.MustScope(r.Context()).InternalID }

func actorID(r *http.Request) *int64 {
	p, ok := authctx.PrincipalFrom(r.Context())
	if !ok || p.UserInternal == 0 {
		return nil
	}
	id := p.UserInternal
	return &id
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		response.NotFound(w, r, "sms provider account not found")
	case errors.Is(err, ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	default:
		response.InternalErr(w, r, err, "request failed")
	}
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(dst); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid JSON body")
		return false
	}
	return true
}

// Overview lists the providers and the organization's accounts (masked).
func (h *Handler) Overview(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Overview(r.Context(), orgID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// Save connects or updates a provider account.
func (h *Handler) Save(w http.ResponseWriter, r *http.Request) {
	var in SaveInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.Save(r.Context(), orgID(r), actorID(r), r.PathValue("provider"), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// SetActive enables or disables a provider account as the SMS channel.
func (h *Handler) SetActive(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IsActive *bool `json:"is_active"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.IsActive == nil {
		response.BadRequest(w, r, response.CodeValidationError, "is_active is required")
		return
	}
	out, err := h.svc.SetActive(r.Context(), orgID(r), actorID(r), r.PathValue("provider"), *in.IsActive)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// Disconnect deletes a provider account and its credentials.
func (h *Handler) Disconnect(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Disconnect(r.Context(), orgID(r), actorID(r), r.PathValue("provider")); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"success": true})
}

// Test runs the provider's connection check.
func (h *Handler) Test(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Test(r.Context(), orgID(r), actorID(r), r.PathValue("provider"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// SendTest sends a test SMS to a number.
func (h *Handler) SendTest(w http.ResponseWriter, r *http.Request) {
	var in TestSMSInput
	if !decode(w, r, &in) {
		return
	}
	out, err := h.svc.SendTest(r.Context(), orgID(r), actorID(r), r.PathValue("provider"), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// Estimate returns the character / part estimate of a text.
func (h *Handler) Estimate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Body     string `json:"body"`
		Provider string `json:"provider"`
	}
	if !decode(w, r, &in) {
		return
	}
	provider := strings.TrimSpace(in.Provider)
	if provider == "" {
		ov, err := h.svc.Overview(r.Context(), orgID(r))
		if err != nil {
			writeError(w, r, err)
			return
		}
		provider = ov.ActiveProvider
	}
	if provider == "" {
		provider = sms.ProviderNetgsm
	}
	if _, err := h.svc.provider(provider); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"provider": provider, "segments": sms.Estimate(in.Body, provider)})
}
