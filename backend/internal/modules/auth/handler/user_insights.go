package handler

import (
	"net/http"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

// Platform 360° user detail: overview, paged memberships / sessions / push
// devices / activity, and audited (step-up gated) session and device revocation.

// SetUserInsights wires the 360° user detail service.
func (h *Handler) SetUserInsights(svc *usecase.UserInsights) {
	h.insights = svc
}

func (h *Handler) insightsReady(w http.ResponseWriter, r *http.Request) bool {
	if h.insights == nil {
		response.Internal(w, r, "User detail is not configured")
		return false
	}
	return true
}

func userPath(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "user uuid is invalid")
		return uuid.Nil, false
	}
	return id, true
}

// pageParams parses limit/offset (default 20, max 100) and rejects page=.
func pageParams(w http.ResponseWriter, r *http.Request) (apiquery.Query, int32, int32, bool) {
	if bad := apiquery.ForbiddenParams(r.URL.Query()); len(bad) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "unsupported query parameter: "+bad[0])
		return apiquery.Query{}, 0, 0, false
	}
	q := apiquery.Parse(r.URL.Query())
	limit, offset := apiquery.Clamp(q.Limit, q.Offset, 20, 100)
	return q, limit, offset, true
}

// PlatformUserOverview is GET /v1/platform/users/{uuid}/overview.
func (h *Handler) PlatformUserOverview(w http.ResponseWriter, r *http.Request) {
	id, ok := userPath(w, r)
	if !ok || !h.insightsReady(w, r) {
		return
	}
	out, err := h.insights.Overview(r.Context(), id)
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// PlatformUserOrganizations is GET /v1/platform/users/{uuid}/organizations.
func (h *Handler) PlatformUserOrganizations(w http.ResponseWriter, r *http.Request) {
	id, ok := userPath(w, r)
	if !ok || !h.insightsReady(w, r) {
		return
	}
	_, limit, offset, ok := pageParams(w, r)
	if !ok {
		return
	}
	items, total, err := h.insights.ListMemberships(r.Context(), id, limit, offset)
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, limit, offset))
}

// PlatformUserSessions is GET /v1/platform/users/{uuid}/sessions.
func (h *Handler) PlatformUserSessions(w http.ResponseWriter, r *http.Request) {
	id, ok := userPath(w, r)
	if !ok || !h.insightsReady(w, r) {
		return
	}
	_, limit, offset, ok := pageParams(w, r)
	if !ok {
		return
	}
	items, total, err := h.insights.ListSessions(r.Context(), id, limit, offset)
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, limit, offset))
}

// PlatformRevokeUserSession is DELETE /v1/platform/users/{uuid}/sessions/{sessionUuid}.
func (h *Handler) PlatformRevokeUserSession(w http.ResponseWriter, r *http.Request) {
	id, ok := userPath(w, r)
	if !ok || !h.insightsReady(w, r) {
		return
	}
	sessionUUID, err := uuid.Parse(r.PathValue("sessionUuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "session uuid is invalid")
		return
	}
	if err := h.insights.RevokeSession(r.Context(), id, sessionUUID); err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	h.recordUserEvent(r, "users.session_revoked", id, map[string]any{"session_uuid": sessionUUID.String()})
	response.JSON(w, r, http.StatusOK, map[string]string{"status": "revoked"})
}

// PlatformRevokeAllUserSessions is POST /v1/platform/users/{uuid}/sessions/revoke-all.
func (h *Handler) PlatformRevokeAllUserSessions(w http.ResponseWriter, r *http.Request) {
	id, ok := userPath(w, r)
	if !ok || !h.insightsReady(w, r) {
		return
	}
	n, err := h.insights.RevokeAllSessions(r.Context(), id)
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	h.recordUserEvent(r, "users.sessions_revoked", id, map[string]any{"count": n})
	response.JSON(w, r, http.StatusOK, map[string]any{"status": "revoked", "revoked": n})
}

// PlatformUserDevices is GET /v1/platform/users/{uuid}/devices.
func (h *Handler) PlatformUserDevices(w http.ResponseWriter, r *http.Request) {
	id, ok := userPath(w, r)
	if !ok || !h.insightsReady(w, r) {
		return
	}
	_, limit, offset, ok := pageParams(w, r)
	if !ok {
		return
	}
	items, total, err := h.insights.ListDevices(r.Context(), id, limit, offset)
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, limit, offset))
}

// PlatformRemoveUserDevice is DELETE /v1/platform/users/{uuid}/devices/{deviceUuid}.
func (h *Handler) PlatformRemoveUserDevice(w http.ResponseWriter, r *http.Request) {
	id, ok := userPath(w, r)
	if !ok || !h.insightsReady(w, r) {
		return
	}
	deviceUUID, err := uuid.Parse(r.PathValue("deviceUuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "device uuid is invalid")
		return
	}
	removed, err := h.insights.RemoveDevice(r.Context(), id, deviceUUID)
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	h.recordUserEvent(r, "users.device_removed", id, map[string]any{
		"device_uuid": deviceUUID.String(), "platform": removed.Platform, "device_name": removed.DeviceName,
	})
	response.JSON(w, r, http.StatusOK, map[string]string{"status": "removed"})
}

// PlatformUserActivity is GET /v1/platform/users/{uuid}/activity
// (events the user performed; optional organization_uuid / action filters).
func (h *Handler) PlatformUserActivity(w http.ResponseWriter, r *http.Request) {
	id, ok := userPath(w, r)
	if !ok || !h.insightsReady(w, r) {
		return
	}
	q, limit, offset, ok := pageParams(w, r)
	if !ok {
		return
	}
	filter := model.UserActivityFilter{Action: strings.TrimSpace(r.URL.Query().Get("action")), Q: q.Q}
	if raw := strings.TrimSpace(r.URL.Query().Get("organization_uuid")); raw != "" {
		orgUUID, err := uuid.Parse(raw)
		if err != nil {
			response.BadRequest(w, r, response.CodeValidationError, "organization_uuid is invalid")
			return
		}
		filter.OrganizationUUID = &orgUUID
	}
	items, total, err := h.insights.ListActivity(r.Context(), id, filter, limit, offset)
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, limit, offset))
}

// recordUserEvent audits a platform action on the target user.
func (h *Handler) recordUserEvent(r *http.Request, action string, target uuid.UUID, payload map[string]any) {
	if h.activity == nil {
		return
	}
	p := authctx.MustPrincipal(r.Context())
	h.activity.Record(r.Context(), &p.UserInternal, action, "platform.users", &target, payload, r)
}
