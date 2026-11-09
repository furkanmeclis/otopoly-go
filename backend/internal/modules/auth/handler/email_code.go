package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

const (
	codeRequestIPLimit     = 10
	codeRequestEmailLimit  = 5
	codeVerifyIPLimit      = 30
	codeVerifyEmailLimit   = 10
	nativeOAuthIPLimit     = 30
	deactivateRequestLimit = 5
	authRateWindow         = 15 * time.Minute
)

type rateCheck struct {
	action  string
	subject string
	limit   int
}

// allowRates applies every check (per-IP, per-email, ...) and writes 429 on the first denial.
func (h *Handler) allowRates(w http.ResponseWriter, r *http.Request, checks ...rateCheck) bool {
	if h.limiter == nil {
		return true
	}
	for _, c := range checks {
		if strings.TrimSpace(c.subject) == "" {
			continue
		}
		ok, retry := h.limiter.Allow(r.Context(), c.action, c.subject, c.limit, authRateWindow)
		if h.writeRateLimited(w, r, ok, retry) {
			return false
		}
	}
	return true
}

func emailSubject(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// RequestEmailCode is POST /v1/auth/email-code/request.
func (h *Handler) RequestEmailCode(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	ip := sessionMeta(r).IP
	if !h.allowRates(
		w, r,
		rateCheck{"email_code_request_ip", ip, codeRequestIPLimit},
		rateCheck{"email_code_request_email", emailSubject(in.Email), codeRequestEmailLimit},
	) {
		return
	}
	if err := h.uc.RequestLoginCode(r.Context(), in.Email); err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]string{"status": "accepted"})
}

// VerifyEmailCode is POST /v1/auth/email-code/verify.
func (h *Handler) VerifyEmailCode(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email            string `json:"email"`
		Code             string `json:"code"`
		TOTPCode         string `json:"totp_code"`
		OrganizationSlug string `json:"organization_slug"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	ip := sessionMeta(r).IP
	if !h.allowRates(
		w, r,
		rateCheck{"email_code_verify_ip", ip, codeVerifyIPLimit},
		rateCheck{"email_code_verify_email", emailSubject(in.Email), codeVerifyEmailLimit},
	) {
		return
	}
	tokens, err := h.uc.VerifyLoginCode(r.Context(), in.Email, in.Code, in.TOTPCode, in.OrganizationSlug, sessionMeta(r))
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, tokens)
}

// RequestAccountDeactivationCode is POST /v1/auth/account/deactivate/request.
func (h *Handler) RequestAccountDeactivationCode(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	if p.ImpersonatorUserID != nil {
		response.Forbidden(w, r, "Stop impersonating before deleting an account")
		return
	}
	if !h.allowRates(w, r, rateCheck{"account_deactivate_request", p.UserID.String(), deactivateRequestLimit}) {
		return
	}
	if err := h.uc.RequestAccountDeactivationCode(r.Context(), p.UserID); err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]string{"status": "accepted"})
}

// accountDeletionResponse is the body of a confirmed (pending) deletion.
type accountDeletionResponse struct {
	Status              string                    `json:"status"`
	DeletionScheduledOn string                    `json:"deletion_scheduled_on"`
	GraceDays           int                       `json:"grace_days"`
	OwnedOrganizations  []model.OwnedOrganization `json:"owned_organizations"`
}

func deletionResponse(res usecase.DeletionResult) accountDeletionResponse {
	owned := res.OwnedOrganizations
	if owned == nil {
		owned = []model.OwnedOrganization{}
	}
	return accountDeletionResponse{
		Status: "scheduled", DeletionScheduledOn: res.ScheduledOn,
		GraceDays: usecase.AccountDeletionGraceDays, OwnedOrganizations: owned,
	}
}

// DeactivateAccount is POST /v1/auth/account/deactivate (signed-in deletion).
func (h *Handler) DeactivateAccount(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	if p.ImpersonatorUserID != nil {
		response.Forbidden(w, r, "Stop impersonating before deleting an account")
		return
	}
	var in struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	if !h.allowRates(w, r, rateCheck{"account_deactivate", p.UserID.String(), codeVerifyEmailLimit}) {
		return
	}
	stepUpOK := false
	if strings.TrimSpace(in.Code) == "" && h.stepUp != nil {
		ok, err := h.stepUp.HasValidGrant(r.Context(), p.UserID)
		if err != nil {
			response.InternalErr(w, r, err, "Failed to verify step-up grant")
			return
		}
		stepUpOK = ok
	}
	res, err := h.uc.DeactivateAccount(r.Context(), p.UserID, in.Code, stepUpOK)
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	if h.stepUp != nil {
		_ = h.stepUp.RevokeGrant(r.Context(), p.UserID)
	}
	method := "step_up"
	if strings.TrimSpace(in.Code) != "" {
		method = "email_code"
	}
	h.recordDeletionScheduled(r, res, method, "app")
	response.JSON(w, r, http.StatusOK, deletionResponse(res))
}

// RequestPublicAccountDeletion is POST /v1/auth/account/deletion/request
// (public /account/delete page). Always 200 accepted (no enumeration).
func (h *Handler) RequestPublicAccountDeletion(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	if !h.allowRates(
		w, r,
		rateCheck{"account_deletion_request_ip", sessionMeta(r).IP, codeRequestIPLimit},
		rateCheck{"account_deletion_request_email", emailSubject(in.Email), codeRequestEmailLimit},
	) {
		return
	}
	if err := h.uc.RequestPublicAccountDeletion(r.Context(), in.Email); err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]string{"status": "accepted"})
}

// ConfirmPublicAccountDeletion is POST /v1/auth/account/deletion/confirm.
func (h *Handler) ConfirmPublicAccountDeletion(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Code     string `json:"code"`
		TOTPCode string `json:"totp_code"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	if !h.allowRates(
		w, r,
		rateCheck{"account_deletion_confirm_ip", sessionMeta(r).IP, codeVerifyIPLimit},
		rateCheck{"account_deletion_confirm_email", emailSubject(in.Email), codeVerifyEmailLimit},
	) {
		return
	}
	res, err := h.uc.ConfirmPublicAccountDeletion(r.Context(), in.Email, in.Code, in.TOTPCode)
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	h.recordDeletionScheduled(r, res, "email_code", "web")
	response.JSON(w, r, http.StatusOK, deletionResponse(res))
}

// RequestAccountRecovery is POST /v1/auth/account/recovery/request.
// Always 200 accepted; a code is sent only for a pending deletion.
func (h *Handler) RequestAccountRecovery(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	if !h.allowRates(
		w, r,
		rateCheck{"account_recovery_request_ip", sessionMeta(r).IP, codeRequestIPLimit},
		rateCheck{"account_recovery_request_email", emailSubject(in.Email), codeRequestEmailLimit},
	) {
		return
	}
	if err := h.uc.RequestAccountRecoveryCode(r.Context(), in.Email); err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]string{"status": "accepted"})
}

// ConfirmAccountRecovery is POST /v1/auth/account/recovery/confirm.
func (h *Handler) ConfirmAccountRecovery(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		return
	}
	if !h.allowRates(
		w, r,
		rateCheck{"account_recovery_confirm_ip", sessionMeta(r).IP, codeVerifyIPLimit},
		rateCheck{"account_recovery_confirm_email", emailSubject(in.Email), codeVerifyEmailLimit},
	) {
		return
	}
	res, err := h.uc.RecoverAccount(r.Context(), in.Email, in.Code)
	if err != nil {
		writeUsecaseError(w, r, err)
		return
	}
	if h.activity != nil {
		id := res.UserID
		uid := res.UserUUID
		h.activity.Record(r.Context(), &id, "auth.account_deletion_cancelled", "auth.account", &uid, map[string]any{
			"method": "email_code",
		}, r)
	}
	response.JSON(w, r, http.StatusOK, map[string]string{"status": "recovered"})
}

// recordDeletionScheduled audits the deletion and marks every owned
// organization's log (the business stays; its owner account goes away).
func (h *Handler) recordDeletionScheduled(r *http.Request, res usecase.DeletionResult, method, channel string) {
	if h.activity == nil {
		return
	}
	id := res.UserID
	uid := res.UserUUID
	h.activity.Record(r.Context(), &id, "auth.account_deletion_scheduled", "auth.account", &uid, map[string]any{
		"method": method, "channel": channel,
		"deletion_scheduled_on": res.ScheduledOn,
		"owned_organizations":   len(res.OwnedOrganizations),
	}, r)
	for _, org := range res.OwnedOrganizations {
		orgUUID := org.UUID
		ctx := activity.WithOrganization(r.Context(), org.ID)
		h.activity.Record(ctx, &id, "organizations.owner_deletion_scheduled", "organizations", &orgUUID, map[string]any{
			"deletion_scheduled_on": res.ScheduledOn,
			"other_members":         org.OtherMembers,
			"other_owners":          org.OtherOwners,
		}, r)
	}
}
