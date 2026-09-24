// Package handler exposes the AI assistant over HTTP (tenant chat + platform admin).
package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	aiusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

// Error codes.
const (
	CodeAIDisabled      = "AI_DISABLED"
	CodeAINotConfigured = "AI_NOT_CONFIGURED"
	CodeAIOrgDisabled   = "AI_ORG_DISABLED"
	CodeAIQuotaExceeded = "AI_QUOTA_EXCEEDED"
)

// Handler serves AI endpoints.
type Handler struct {
	svc      *aiusecase.Service
	activity *activity.Recorder
	// heartbeat is the SSE keep-alive interval.
	heartbeat time.Duration
}

// New creates the handler.
func New(svc *aiusecase.Service, rec *activity.Recorder) *Handler {
	return &Handler{svc: svc, activity: rec, heartbeat: 15 * time.Second}
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, aiusecase.ErrInvalidRequest):
		response.BadRequest(w, r, response.CodeValidationError, err.Error())
	case errors.Is(err, aiusecase.ErrNotFound):
		response.NotFound(w, r, "Not found")
	case errors.Is(err, aiusecase.ErrNoContext):
		response.Error(w, r, http.StatusForbidden, "ORGANIZATION_CONTEXT_REQUIRED", "Organization context is required")
	case errors.Is(err, aiusecase.ErrDisabled):
		response.Error(w, r, http.StatusForbidden, CodeAIDisabled, "The AI assistant is disabled")
	case errors.Is(err, aiusecase.ErrNotConfigured):
		response.Error(w, r, http.StatusForbidden, CodeAINotConfigured, "The AI assistant is not configured")
	case errors.Is(err, aiusecase.ErrOrgDisabled):
		response.Error(w, r, http.StatusForbidden, CodeAIOrgDisabled, "The AI assistant is disabled for this organization")
	case errors.Is(err, aiusecase.ErrQuotaExceeded):
		response.Error(w, r, http.StatusForbidden, CodeAIQuotaExceeded, "Monthly AI token quota exceeded")
	default:
		response.InternalErr(w, r, err, "unexpected error")
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(dst); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid body")
		return false
	}
	return true
}

func pathUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "invalid uuid")
		return uuid.Nil, false
	}
	return id, true
}

func actorID(r *http.Request) *int64 {
	p, ok := authctx.PrincipalFrom(r.Context())
	if !ok {
		return nil
	}
	id := p.UserInternal
	return &id
}

// ------------------------------------------------------------------ tenant

// Status reports assistant availability for the current user.
func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	st, err := h.svc.Status(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, st)
}

// ListConversations lists the user's conversations.
func (h *Handler) ListConversations(w http.ResponseWriter, r *http.Request) {
	if banned := apiquery.ForbiddenParams(r.URL.Query()); len(banned) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "forbidden query parameter")
		return
	}
	q := apiquery.Parse(r.URL.Query())
	items, total, err := h.svc.ListConversations(r.Context(), q.Limit, q.Offset, q.Q)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

type titleBody struct {
	Title string `json:"title"`
}

// CreateConversation starts a conversation.
func (h *Handler) CreateConversation(w http.ResponseWriter, r *http.Request) {
	var in titleBody
	if r.ContentLength != 0 {
		if !decodeJSON(w, r, &in) {
			return
		}
	}
	c, err := h.svc.CreateConversation(r.Context(), in.Title)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, c)
}

// GetConversation returns a conversation with messages.
func (h *Handler) GetConversation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	c, err := h.svc.GetConversation(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, c)
}

// RenameConversation updates the title.
func (h *Handler) RenameConversation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in titleBody
	if !decodeJSON(w, r, &in) {
		return
	}
	c, err := h.svc.RenameConversation(r.Context(), id, in.Title)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, c)
}

// DeleteConversation soft-deletes a conversation.
func (h *Handler) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteConversation(r.Context(), id); err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"deleted": true})
}

// sseWriter serializes events onto a text/event-stream response.
type sseWriter struct {
	mu  sync.Mutex
	w   http.ResponseWriter
	rc  *http.ResponseController
	err error
}

func (s *sseWriter) write(chunk string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return
	}
	if _, err := fmt.Fprint(s.w, chunk); err != nil {
		s.err = err
		return
	}
	if err := s.rc.Flush(); err != nil {
		s.err = err
	}
}

func (s *sseWriter) send(event string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		raw = []byte(`{}`)
	}
	s.write("event: " + event + "\ndata: " + string(raw) + "\n\n")
}

// SendMessage streams the assistant's answer as server-sent events:
// message_start, text_delta, tool_start, tool_result, chart, error,
// message_done, title.
func (h *Handler) SendMessage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in aiusecase.SendInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Locale) == "" {
		in.Locale = r.Header.Get("Accept-Language")
		if len(in.Locale) > 2 {
			in.Locale = in.Locale[:2]
		}
	}
	turn, err := h.svc.PrepareMessage(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}

	rc := http.NewResponseController(w)
	// Streams outlive the server's default write timeout.
	_ = rc.SetWriteDeadline(time.Now().Add(15 * time.Minute))
	hdr := w.Header()
	hdr.Set("Content-Type", "text/event-stream; charset=utf-8")
	hdr.Set("Cache-Control", "no-cache, no-transform")
	hdr.Set("Connection", "keep-alive")
	hdr.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	sse := &sseWriter{w: w, rc: rc}
	sse.write(": stream open\n\n")

	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(h.heartbeat)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-r.Context().Done():
				return
			case <-ticker.C:
				sse.write(": ping\n\n")
			}
		}
	}()
	err = h.svc.RunTurn(r.Context(), turn, sse.send)
	close(done)
	if err != nil {
		slog.ErrorContext(r.Context(), "ai_turn_failed", "error", err)
		sse.send(aiusecase.EventError, map[string]string{"code": "internal_error", "message": "unexpected error"})
	}
}

// ------------------------------------------------------------------ platform

// GetSettings returns platform AI settings.
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	st, err := h.svc.Settings(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, st)
}

// PatchSettings updates platform AI settings.
func (h *Handler) PatchSettings(w http.ResponseWriter, r *http.Request) {
	var in aiusecase.PatchSettingsInput
	if !decodeJSON(w, r, &in) {
		return
	}
	st, err := h.svc.PatchSettings(r.Context(), actorID(r), in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if h.activity != nil {
		h.activity.Record(r.Context(), actorID(r), "ai.settings.updated", "platform.ai", nil, map[string]any{
			"provider":        st.Provider,
			"model":           st.Model,
			"effort":          st.Effort,
			"chat_enabled":    st.Features.Chat,
			"api_key_changed": (in.APIKey != nil && strings.TrimSpace(*in.APIKey) != "") || in.ClearAPIKey,
		}, r)
	}
	response.JSON(w, r, http.StatusOK, st)
}

// TestConnection runs a minimal provider call.
func (h *Handler) TestConnection(w http.ResponseWriter, r *http.Request) {
	res, err := h.svc.TestConnection(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, res)
}

// Usage returns per-organization usage for a month.
func (h *Handler) Usage(w http.ResponseWriter, r *http.Request) {
	res, err := h.svc.Usage(r.Context(), r.URL.Query().Get("month"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, res)
}

// GetOrgSettings returns the per-organization override.
func (h *Handler) GetOrgSettings(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	res, err := h.svc.OrgSettings(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, res)
}

// PutOrgSettings replaces the per-organization override.
func (h *Handler) PutOrgSettings(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r)
	if !ok {
		return
	}
	var in aiusecase.PutOrgSettingsInput
	if !decodeJSON(w, r, &in) {
		return
	}
	res, err := h.svc.PutOrgSettings(r.Context(), id, in)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if h.activity != nil {
		h.activity.Record(r.Context(), actorID(r), "ai.organization.updated", "platform.ai", &id, map[string]any{
			"enabled":             res.Enabled,
			"monthly_token_quota": res.MonthlyTokenQuota,
		}, r)
	}
	response.JSON(w, r, http.StatusOK, res)
}
