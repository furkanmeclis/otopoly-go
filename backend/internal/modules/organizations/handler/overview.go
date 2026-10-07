package handler

import (
	"context"
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

// StepUpChecker reports whether the user holds a fresh step-up grant.
type StepUpChecker interface {
	HasValidGrant(ctx context.Context, userUUID uuid.UUID) (bool, error)
}

// SetStepUp gates PATCH changes to status, plan or the access window behind
// step-up (the dedicated status / extend-access routes use the middleware).
func (h *Handler) SetStepUp(c StepUpChecker) {
	h.stepUp = c
}

// requireStepUp writes STEP_UP_REQUIRED and returns false without a grant.
func (h *Handler) requireStepUp(w http.ResponseWriter, r *http.Request) bool {
	if h.stepUp == nil {
		return true
	}
	p, ok := authctx.PrincipalFrom(r.Context())
	if !ok {
		response.Unauthorized(w, r, "Authentication is required")
		return false
	}
	valid, err := h.stepUp.HasValidGrant(r.Context(), p.UserID)
	if err != nil {
		response.Internal(w, r, "Failed to verify step-up grant")
		return false
	}
	if !valid {
		response.StepUpRequired(w, r)
		return false
	}
	return true
}

func orgPath(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "organization uuid is invalid")
		return uuid.Nil, false
	}
	return id, true
}

// PlatformOverview is GET /v1/platform/organizations/{uuid}/overview.
func (h *Handler) PlatformOverview(w http.ResponseWriter, r *http.Request) {
	id, ok := orgPath(w, r)
	if !ok {
		return
	}
	out, err := h.svc.Overview(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, out)
}

// PlatformActivity is GET /v1/platform/organizations/{uuid}/activity.
func (h *Handler) PlatformActivity(w http.ResponseWriter, r *http.Request) {
	id, ok := orgPath(w, r)
	if !ok {
		return
	}
	if bad := apiquery.ForbiddenParams(r.URL.Query()); len(bad) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "unsupported query parameter: "+bad[0])
		return
	}
	q := apiquery.Parse(r.URL.Query())
	limit, offset := apiquery.Clamp(q.Limit, q.Offset, 20, 100)
	items, total, err := h.svc.ListActivity(r.Context(), id, limit, offset, r.URL.Query().Get("action"), q.Q)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, limit, offset))
}

// PlatformOutbound is GET /v1/platform/organizations/{uuid}/whatsapp/outbound.
func (h *Handler) PlatformOutbound(w http.ResponseWriter, r *http.Request) {
	id, ok := orgPath(w, r)
	if !ok {
		return
	}
	if bad := apiquery.ForbiddenParams(r.URL.Query()); len(bad) > 0 {
		response.BadRequest(w, r, response.CodeValidationError, "unsupported query parameter: "+bad[0])
		return
	}
	q := apiquery.Parse(r.URL.Query())
	limit, offset := apiquery.Clamp(q.Limit, q.Offset, 20, 100)
	items, total, err := h.svc.ListOutbound(r.Context(), id, limit, offset)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, limit, offset))
}

// PlatformSetStatus is POST /v1/platform/organizations/{uuid}/status
// (suspend / activate; step-up gated by the route).
func (h *Handler) PlatformSetStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := orgPath(w, r)
	if !ok {
		return
	}
	var in struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	org, err := h.svc.SetStatus(r.Context(), id, in.Status, in.Reason)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, org)
}

// PlatformExtendAccess is POST /v1/platform/organizations/{uuid}/extend-access
// (step-up gated by the route).
func (h *Handler) PlatformExtendAccess(w http.ResponseWriter, r *http.Request) {
	id, ok := orgPath(w, r)
	if !ok {
		return
	}
	var in struct {
		Days int    `json:"days"`
		Note string `json:"note"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	org, err := h.svc.ExtendAccess(r.Context(), id, in.Days, in.Note)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, org)
}
