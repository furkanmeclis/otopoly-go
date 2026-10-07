package handler

import (
	"errors"
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

// DeletePlatformUser is DELETE /v1/platform/users/{uuid} (soft delete).
func (h *Handler) DeletePlatformUser(w http.ResponseWriter, r *http.Request) {
	targetUUID, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "user uuid is invalid")
		return
	}
	p := authctx.MustPrincipal(r.Context())
	// While impersonating, the principal is the impersonated user; the real
	// actor must not be able to delete themselves through it either.
	if p.ImpersonatorUserID != nil && *p.ImpersonatorUserID == targetUUID {
		writeUserDeleteError(w, r, usecase.ErrCannotDeleteSelf)
		return
	}
	user, err := h.uc.DeletePlatformUser(r.Context(), p.UserID, targetUUID)
	if err != nil {
		writeUserDeleteError(w, r, err)
		return
	}
	if h.activity != nil {
		h.activity.Record(r.Context(), &p.UserInternal, "users.deleted", "platform.users", &targetUUID, map[string]any{
			"email": user.Email,
		}, r)
	}
	response.JSON(w, r, http.StatusOK, user)
}

// RestorePlatformUser is POST /v1/platform/users/{uuid}/restore.
func (h *Handler) RestorePlatformUser(w http.ResponseWriter, r *http.Request) {
	targetUUID, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "user uuid is invalid")
		return
	}
	user, err := h.uc.RestorePlatformUser(r.Context(), targetUUID)
	if err != nil {
		writeUserDeleteError(w, r, err)
		return
	}
	if h.activity != nil {
		p := authctx.MustPrincipal(r.Context())
		h.activity.Record(r.Context(), &p.UserInternal, "users.restored", "platform.users", &targetUUID, map[string]any{
			"email": user.Email,
		}, r)
	}
	response.JSON(w, r, http.StatusOK, user)
}

func writeUserDeleteError(w http.ResponseWriter, r *http.Request, err error) {
	var sole *usecase.SoleOwnerError
	switch {
	case errors.As(err, &sole):
		response.RecordFailure(w, err)
		details := make([]response.Detail, 0, len(sole.Organizations))
		for _, org := range sole.Organizations {
			details = append(details, response.Detail{Field: org.UUID.String(), Message: org.Name, Code: org.Slug})
		}
		response.ErrorWithDetails(w, r, http.StatusConflict, response.CodeSoleOrganizationOwner,
			"The user is the only owner of these organizations. Transfer ownership or close them first.", details)
	case errors.Is(err, usecase.ErrCannotDeleteSelf):
		response.RecordFailure(w, err)
		response.Conflict(w, r, response.CodeCannotDeleteSelf, "You cannot delete your own account")
	case errors.Is(err, usecase.ErrLastSuperAdmin):
		response.RecordFailure(w, err)
		response.Conflict(w, r, response.CodeLastSuperAdmin, "Cannot delete the last super admin")
	case errors.Is(err, usecase.ErrEmailInUse):
		response.RecordFailure(w, err)
		response.Conflict(w, r, response.CodeEmailInUse, "Another account uses this email; the user cannot be restored")
	case errors.Is(err, usecase.ErrNotDeleted):
		response.RecordFailure(w, err)
		response.Conflict(w, r, response.CodeConflict, "User is not deleted")
	default:
		writeUsecaseError(w, r, err)
	}
}
