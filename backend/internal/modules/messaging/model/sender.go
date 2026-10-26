package model

import "errors"

// Sender kinds recorded on outbound_messages.sender_kind.
const (
	SenderOrgOwn            = "org_own"
	SenderPlatformWhatsmeow = "platform_whatsmeow"
	SenderPlatformCloud     = "platform_cloud"
	// SMS through the organization's own provider account.
	SenderSMSNetgsm = "sms_netgsm"
	SenderSMSTwilio = "sms_twilio"
)

// SMSSenderKind returns the sender kind of an SMS provider code.
func SMSSenderKind(provider string) string { return "sms_" + provider }

// PlatformOrgKey is the reserved whatsmeow client key of the platform number
// (organization ids start at 1).
const PlatformOrgKey int64 = 0

// Error codes recorded on outbound_messages.error_code.
const (
	ErrCodeOwnSessionDisconnected      = "own_session_disconnected"
	ErrCodePlatformSenderNotConfigured = "platform_sender_not_configured"
	ErrCodePlatformSenderUnavailable   = "platform_sender_unavailable"
	ErrCodeTemplateNotApproved         = "template_not_approved"
	ErrCodeCloudAuthFailed             = "cloud_auth_failed"
	ErrCodeCloudUnavailable            = "cloud_unavailable"
	ErrCodeRateLimited                 = "rate_limited"
	ErrCodeMarketingLimit              = "marketing_limit"
	ErrCodeUndeliverable               = "undeliverable"
	ErrCodeTemplateMissing             = "template_missing"
	ErrCodeTemplateParamMismatch       = "template_param_mismatch"
	ErrCodeInvalidRecipient            = "invalid_recipient"
	ErrCodeMediaUploadFailed           = "media_upload_failed"
	ErrCodeSendFailed                  = "send_failed"
	// Plan gates of platform-number sends (whatsapp.enabled / whatsapp.monthly).
	ErrCodeFeatureNotEntitled = "feature_not_entitled"
	ErrCodeQuotaExceeded      = "quota_exceeded"
	// SMS channel (organization provider account).
	ErrCodeSMSNotConfigured = "sms_not_configured"
	ErrCodeSMSAuthFailed    = "sms_auth_failed"
	ErrCodeSMSRejected      = "sms_rejected"
	ErrCodeSMSUnavailable   = "sms_unavailable"
	// ErrCodeSMSOutcomeUnknown: the provider may have accepted the message;
	// it is not retried automatically (no duplicate SMS).
	ErrCodeSMSOutcomeUnknown = "sms_outcome_unknown"
)

// SMSDelivery is an SMS accepted by the organization's provider.
type SMSDelivery struct {
	Provider  string
	MessageID string
	// Status is the provider's initial status (accepted, queued…).
	Status string
	// To is the normalized E.164 recipient.
	To string
}

// SendError is a classified WhatsApp send failure. Retryable errors are
// retried by the messaging queue; the others fail the message immediately.
type SendError struct {
	Code      string
	Retryable bool
	Err       error
}

func (e *SendError) Error() string {
	if e.Err == nil {
		return e.Code
	}
	return e.Code + ": " + e.Err.Error()
}

func (e *SendError) Unwrap() error { return e.Err }

// NewSendError builds a classified send error.
func NewSendError(code string, retryable bool, err error) *SendError {
	return &SendError{Code: code, Retryable: retryable, Err: err}
}

// ErrorCodeOf returns the classified code of err ("" when unclassified).
func ErrorCodeOf(err error) string {
	var se *SendError
	if errors.As(err, &se) {
		return se.Code
	}
	return ""
}

// IsRetryable reports whether a send error may be retried. Unclassified
// errors (network, live session hiccups) are retryable.
func IsRetryable(err error) bool {
	var se *SendError
	if errors.As(err, &se) {
		return se.Retryable
	}
	return err != nil
}
