package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	notifmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bizclock"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// AccountDeletionGraceDays is the recovery window of a self-service deletion.
// The account is disabled at once and anonymized on the business day
// (Europe/Istanbul) that many days after the confirmation.
const AccountDeletionGraceDays = 30

// ErrConfirmationRequired: deactivation needs a step-up grant or an email code.
var ErrConfirmationRequired = errors.New("confirmation required")

// PendingDeletionError is returned by every sign-in path for an account whose
// deletion is pending. It wraps ErrAccountDeactivated (same error code) and
// carries the anonymization day so clients can offer recovery.
type PendingDeletionError struct {
	// ScheduledOn is the anonymization day, YYYY-MM-DD (Europe/Istanbul).
	ScheduledOn string
}

func (e *PendingDeletionError) Error() string {
	return fmt.Sprintf("%s: deletion scheduled on %s", ErrAccountDeactivated.Error(), e.ScheduledOn)
}

func (e *PendingDeletionError) Unwrap() error { return ErrAccountDeactivated }

// DeletionResult describes a confirmed (pending) account deletion.
type DeletionResult struct {
	UserID   int64
	UserUUID uuid.UUID
	// ScheduledOn is the anonymization day, YYYY-MM-DD (Europe/Istanbul).
	ScheduledOn string
	// OwnedOrganizations are businesses the user owns. They are not deleted:
	// business records stay and other members keep their access.
	OwnedOrganizations []model.OwnedOrganization
}

// RecoveryResult describes a cancelled deletion.
type RecoveryResult struct {
	UserID   int64
	UserUUID uuid.UUID
}

// SetAppURL sets the public web URL used in account emails (recovery link).
func (u *AuthUseCase) SetAppURL(raw string) {
	u.appURL = strings.TrimRight(strings.TrimSpace(raw), "/")
}

// RequestAccountDeactivationCode emails a confirmation code to the caller.
// Passwordless users (Apple / Google / email-code only) confirm with it.
func (u *AuthUseCase) RequestAccountDeactivationCode(ctx context.Context, userUUID uuid.UUID) error {
	user, err := u.repo.FindUserByUUID(ctx, userUUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return ErrNotFound
		}
		return err
	}
	if u.isReviewAccount(normalizeEmail(user.Email)) {
		return nil
	}
	return u.sendEmailCode(ctx, user, normalizeEmail(user.Email), otpTypeAccountDeactivation, "auth.account_deactivation_code", nil)
}

// DeactivateAccount is the signed-in variant of self-service account
// deletion (web profile, mobile app). It schedules the same 30-day
// recoverable deletion as the public flow; see scheduleDeletion.
//
// Confirmation: stepUpVerified (recent /v1/auth/step-up/* grant) or a valid
// account-deactivation email code.
func (u *AuthUseCase) DeactivateAccount(ctx context.Context, userUUID uuid.UUID, code string, stepUpVerified bool) (DeletionResult, error) {
	user, err := u.repo.FindUserByUUID(ctx, userUUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return DeletionResult{}, ErrNotFound
		}
		return DeletionResult{}, err
	}
	if user.DeactivatedAt != nil || user.PendingDeletion() {
		return DeletionResult{}, ErrAccountDeactivated
	}
	if err := u.guardLastSuperAdmin(ctx, user); err != nil {
		return DeletionResult{}, err
	}

	var otpID int64
	code = strings.TrimSpace(code)
	switch {
	case code != "":
		otpID, err = u.checkEmailCode(ctx, normalizeEmail(user.Email), otpTypeAccountDeactivation, code)
		if err != nil {
			return DeletionResult{}, err
		}
	case !stepUpVerified:
		return DeletionResult{}, ErrConfirmationRequired
	}
	return u.scheduleDeletion(ctx, user, otpID)
}

// RequestPublicAccountDeletion emails a deletion confirmation code from the
// public /account/delete page. The answer never reveals whether the email
// has an account: unknown, already pending or anonymized addresses simply
// get no email.
func (u *AuthUseCase) RequestPublicAccountDeletion(ctx context.Context, email string) error {
	email = normalizeEmail(email)
	if email == "" || !strings.Contains(email, "@") {
		return fmt.Errorf("%w: a valid email is required", ErrInvalidRequest)
	}
	if u.isReviewAccount(email) {
		return nil
	}
	user, err := u.repo.FindUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			if u.log != nil {
				u.log.InfoContext(ctx, "auth_account_deletion_unknown_account")
			}
			return nil
		}
		return err
	}
	if user.PendingDeletion() || user.AnonymizedAt != nil {
		return nil
	}
	return u.sendEmailCode(ctx, user, normalizeEmail(user.Email), otpTypeAccountDeactivation, "auth.account_deactivation_code", nil)
}

// ConfirmPublicAccountDeletion verifies the emailed code and schedules the
// deletion. Accounts with authenticator 2FA also need totpCode
// (ErrMFARequired keeps the email code valid for the retry).
func (u *AuthUseCase) ConfirmPublicAccountDeletion(ctx context.Context, email, code, totpCode string) (DeletionResult, error) {
	email = normalizeEmail(email)
	code = strings.TrimSpace(code)
	if email == "" || code == "" {
		return DeletionResult{}, fmt.Errorf("%w: email and code are required", ErrInvalidRequest)
	}
	user, err := u.repo.FindUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return DeletionResult{}, ErrInvalidEmailCode
		}
		return DeletionResult{}, err
	}
	otpID, err := u.checkEmailCode(ctx, email, otpTypeAccountDeactivation, code)
	if err != nil {
		return DeletionResult{}, err
	}
	if user.PendingDeletion() || user.AnonymizedAt != nil {
		return DeletionResult{}, ErrInvalidEmailCode
	}
	if err := u.checkLoginMFA(ctx, user.ID, totpCode, false); err != nil {
		u.countFailedSecondFactor(ctx, otpID, err)
		return DeletionResult{}, err
	}
	if err := u.guardLastSuperAdmin(ctx, user); err != nil {
		return DeletionResult{}, err
	}
	return u.scheduleDeletion(ctx, user, otpID)
}

// RequestAccountRecoveryCode emails a recovery code when the address belongs
// to an account with a pending deletion. Always succeeds for the caller.
func (u *AuthUseCase) RequestAccountRecoveryCode(ctx context.Context, email string) error {
	email = normalizeEmail(email)
	if email == "" || !strings.Contains(email, "@") {
		return fmt.Errorf("%w: a valid email is required", ErrInvalidRequest)
	}
	if u.isReviewAccount(email) {
		return nil
	}
	user, err := u.repo.FindUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil
		}
		return err
	}
	if !user.PendingDeletion() {
		return nil
	}
	return u.sendEmailCode(ctx, user, normalizeEmail(user.Email), otpTypeAccountRecovery, "auth.account_recovery_code", nil)
}

// RecoverAccount cancels a pending deletion after the emailed recovery code
// is verified and re-enables the account (its status before the deletion is
// restored). Sessions revoked at deletion stay revoked: the user signs in
// again normally.
func (u *AuthUseCase) RecoverAccount(ctx context.Context, email, code string) (RecoveryResult, error) {
	email = normalizeEmail(email)
	code = strings.TrimSpace(code)
	if email == "" || code == "" {
		return RecoveryResult{}, fmt.Errorf("%w: email and code are required", ErrInvalidRequest)
	}
	user, err := u.repo.FindUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return RecoveryResult{}, ErrInvalidEmailCode
		}
		return RecoveryResult{}, err
	}
	otpID, err := u.checkEmailCode(ctx, email, otpTypeAccountRecovery, code)
	if err != nil {
		return RecoveryResult{}, err
	}
	if !user.PendingDeletion() {
		return RecoveryResult{}, ErrInvalidEmailCode
	}
	if err := u.consumeEmailCode(ctx, otpID); err != nil {
		return RecoveryResult{}, err
	}
	recovered, err := u.repo.CancelUserDeletion(ctx, user.ID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return RecoveryResult{}, ErrInvalidEmailCode
		}
		return RecoveryResult{}, err
	}
	u.indexUserSearch(ctx, recovered.UUID.String())
	if u.notifier != nil {
		uid := recovered.ID
		to := recovered.Email
		_, _ = u.notifier.Enqueue(ctx, notifmodel.EnqueueInput{
			UserID: &uid, Channels: []string{notifmodel.ChannelEmail},
			TemplateCode: "auth.account_recovered", SourceEvent: "auth.account_recovered",
			SecurityEmail: true, Recipient: &to, Language: recovered.Locale,
			TemplateVars: map[string]string{"name": recovered.Name},
		})
	}
	return RecoveryResult{UserID: recovered.ID, UserUUID: recovered.UUID}, nil
}

// guardLastSuperAdmin refuses to delete the last active super admin.
func (u *AuthUseCase) guardLastSuperAdmin(ctx context.Context, user model.User) error {
	isSuperAdmin, err := u.repo.UserHasRoleSlug(ctx, user.ID, rbac.RoleSuperAdmin)
	if err != nil {
		return err
	}
	if !isSuperAdmin {
		return nil
	}
	n, err := u.repo.CountUsersWithRole(ctx, rbac.RoleSuperAdmin)
	if err != nil {
		return err
	}
	if n <= 1 {
		return ErrLastSuperAdmin
	}
	return nil
}

// scheduleDeletion disables the account now and schedules anonymization
// AccountDeletionGraceDays business days ahead: status disabled +
// deactivated_at, every refresh session revoked, stored Apple tokens revoked
// (best effort) and a confirmation email with the recovery link. Owned
// organizations are left untouched (business data retained, other members
// keep access).
func (u *AuthUseCase) scheduleDeletion(ctx context.Context, user model.User, otpID int64) (DeletionResult, error) {
	day := bizclock.DayOf(u.now()).AddDate(0, 0, AccountDeletionGraceDays).Format(bizclock.DayLayout)
	scheduled, err := u.repo.ScheduleUserDeletion(ctx, user.ID, day)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return DeletionResult{}, ErrAccountDeactivated
		}
		return DeletionResult{}, err
	}
	if err := u.consumeEmailCode(ctx, otpID); err != nil && u.log != nil {
		u.log.Warn("account_deletion_code_consume_failed", "user_id", user.ID, "error", err)
	}
	if err := u.repo.RevokeAllRefresh(ctx, user.ID); err != nil {
		return DeletionResult{}, err
	}
	u.revokeAppleTokens(ctx, user.ID)
	u.indexUserSearch(ctx, user.UUID.String())
	owned, err := u.repo.ListOwnedOrganizations(ctx, user.ID)
	if err != nil {
		if u.log != nil {
			u.log.Warn("account_deletion_owned_orgs_failed", "user_id", user.ID, "error", err)
		}
		owned = nil
	}
	if owned == nil {
		owned = []model.OwnedOrganization{}
	}
	if u.notifier != nil {
		uid := user.ID
		to := user.Email
		_, _ = u.notifier.Enqueue(ctx, notifmodel.EnqueueInput{
			UserID: &uid, Channels: []string{notifmodel.ChannelEmail},
			TemplateCode: "auth.account_deletion_scheduled", SourceEvent: "auth.account_deletion_scheduled",
			SecurityEmail: true, Recipient: &to, Language: user.Locale,
			TemplateVars: map[string]string{
				"name":          user.Name,
				"deletion_date": formatDeletionDate(scheduled.DeletionScheduledOn, user.Locale),
				"recover_url":   u.recoverURL(user.Locale),
			},
		})
	}
	return DeletionResult{
		UserID: user.ID, UserUUID: user.UUID,
		ScheduledOn: scheduled.DeletionScheduledOn, OwnedOrganizations: owned,
	}, nil
}

// recoverURL is the public recovery page in the user's language.
func (u *AuthUseCase) recoverURL(locale string) string {
	path := "/account/delete?mode=recover"
	if strings.HasPrefix(strings.ToLower(locale), "en") {
		path = "/en" + path
	}
	return u.appURL + path
}

// formatDeletionDate renders a YYYY-MM-DD day for emails (tr: 02.01.2006).
func formatDeletionDate(day, locale string) string {
	t, err := time.Parse(bizclock.DayLayout, day)
	if err != nil {
		return day
	}
	if strings.HasPrefix(strings.ToLower(locale), "en") {
		return t.Format("2 January 2006")
	}
	return t.Format("02.01.2006")
}

// revokeAppleTokens revokes every stored Apple refresh token of the user.
// Failures are logged and skipped: deactivation must not depend on Apple.
func (u *AuthUseCase) revokeAppleTokens(ctx context.Context, userID int64) {
	if u.native.Apple == nil || u.box == nil {
		return
	}
	accounts, err := u.repo.ListOAuthAccountsByUserID(ctx, userID)
	if err != nil {
		return
	}
	for _, acc := range accounts {
		if acc.Provider != model.OAuthProviderApple || acc.RefreshTokenEnc == nil || *acc.RefreshTokenEnc == "" {
			continue
		}
		token, err := u.box.Decrypt(*acc.RefreshTokenEnc)
		if err != nil || token == "" {
			continue
		}
		clientID, clientSecret := "", ""
		if acc.ClientID != nil && *acc.ClientID != "" {
			clientID = *acc.ClientID // native: secret is generated from the .p8 key
		} else if u.native.Clients != nil {
			// Web (NextAuth) token: use the web client; prefer a generated
			// secret, fall back to the configured web client secret JWT.
			id, secret, err := u.native.Clients.ClientCredentials(ctx, model.OAuthProviderApple)
			if err == nil {
				clientID = id
				if !u.native.Apple.Configured(ctx) {
					clientSecret = secret
				}
			}
		}
		if clientID == "" || (clientSecret == "" && !u.native.Apple.Configured(ctx)) {
			continue
		}
		rctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err = u.native.Apple.Revoke(rctx, clientID, clientSecret, token)
		cancel()
		if err != nil {
			if u.log != nil {
				u.log.Warn("apple_token_revoke_failed", "user_id", userID, "error", err)
			}
			continue
		}
		cid := clientID
		if err := u.repo.UpdateOAuthAccountRefreshToken(ctx, acc.ID, nil, &cid); err != nil && u.log != nil {
			u.log.Warn("apple_token_clear_failed", "user_id", userID, "error", err)
		}
	}
}
