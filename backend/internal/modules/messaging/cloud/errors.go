package cloud

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	whttp "github.com/piusalfred/whatsapp/pkg/http"
)

// graphCode maps a Graph API error code to (error_code, retryable).
// Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
func graphCode(code int) (string, bool) {
	switch code {
	// Authorization / permission: fix credentials in the panel.
	case 0, 3, 10, 102, 190, 131005:
		return model.ErrCodeCloudAuthFailed, false
	// Throttling: retry later.
	case 4, 80007, 130429, 131048, 131056:
		return model.ErrCodeRateLimited, true
	// Temporary Meta-side failures.
	case 1, 2, 131000, 131016:
		return model.ErrCodeCloudUnavailable, true
	case 131049:
		return model.ErrCodeMarketingLimit, false
	case 131026:
		return model.ErrCodeUndeliverable, false
	case 131021, 131030:
		return model.ErrCodeInvalidRecipient, false
	case 132001:
		return model.ErrCodeTemplateMissing, false
	case 132000, 132012:
		return model.ErrCodeTemplateParamMismatch, false
	case 132005, 132007, 132015, 132016:
		return model.ErrCodeTemplateNotApproved, false
	case 131052, 131053:
		return model.ErrCodeMediaUploadFailed, false
	}
	if code >= 200 && code <= 299 { // permission errors
		return model.ErrCodeCloudAuthFailed, false
	}
	return "graph_" + strconv.Itoa(code), false
}

// GraphAPIError is a Meta error decoded by this package (calls made outside
// the library, e.g. the resumable upload). Status is the HTTP status; Code is
// the Graph error code when the body had one.
type GraphAPIError struct {
	Status  int
	Code    int
	Type    string
	Message string
	Details string
}

func (e *GraphAPIError) Error() string {
	b := fmt.Sprintf("graph api: http %d", e.Status)
	if e.Code != 0 {
		b += fmt.Sprintf(", code %d", e.Code)
	}
	if e.Type != "" {
		b += ", " + e.Type
	}
	if e.Message != "" {
		b += ": " + e.Message
	}
	if e.Details != "" {
		b += " (" + e.Details + ")"
	}
	return b
}

// Classify turns a library (or GraphAPIError) error into a *model.SendError.
// Graph errors are mapped by code; an HTTP failure without a Graph error
// body is a non-retryable send failure (the message tells why); transport
// failures (network, timeouts) are retryable.
func Classify(err error) *model.SendError {
	if err == nil {
		return nil
	}
	var se *model.SendError
	if errors.As(err, &se) {
		return se
	}
	var ge *GraphAPIError
	if errors.As(err, &ge) {
		if ge.Code != 0 {
			code, retry := graphCode(ge.Code)
			return model.NewSendError(code, retry, err)
		}
		if ge.Status >= 500 {
			return model.NewSendError(model.ErrCodeCloudUnavailable, true, err)
		}
		if ge.Status == 401 || ge.Status == 403 {
			return model.NewSendError(model.ErrCodeCloudAuthFailed, false, err)
		}
		return model.NewSendError(model.ErrCodeSendFailed, false, err)
	}
	var re *whttp.ResponseError
	if errors.As(err, &re) {
		if re.Err != nil {
			code, retry := graphCode(re.Err.Code)
			return model.NewSendError(code, retry, err)
		}
		// Non-2xx without a Graph "error" body (the library decodes nothing).
		if re.Code >= 500 {
			return model.NewSendError(model.ErrCodeCloudUnavailable, true, err)
		}
		return model.NewSendError(model.ErrCodeSendFailed, false, err)
	}
	return model.NewSendError(model.ErrCodeCloudUnavailable, true, err)
}

// GraphErrorCode maps a Graph API error code (e.g. from a webhook "failed"
// status) to the outbound_messages.error_code vocabulary.
func GraphErrorCode(code int) string {
	c, _ := graphCode(code)
	return c
}

// GraphMessage returns Meta's human-readable error text (message and
// details) of a classified error, or "" when the error carries none. It is
// safe to show to a platform admin: credentials never appear in it.
func GraphMessage(err error) string {
	var ge *GraphAPIError
	if errors.As(err, &ge) {
		parts := make([]string, 0, 3)
		for _, p := range []string{ge.Message, ge.Details} {
			if p = strings.TrimSpace(p); p != "" && !containsFold(parts, p) {
				parts = append(parts, p)
			}
		}
		if len(parts) == 0 {
			return fmt.Sprintf("HTTP %d", ge.Status)
		}
		return strings.Join(parts, " · ")
	}
	var re *whttp.ResponseError
	if !errors.As(err, &re) {
		return ""
	}
	if re.Err == nil {
		if re.Code != 0 {
			return fmt.Sprintf("HTTP %d", re.Code)
		}
		return ""
	}
	parts := make([]string, 0, 3)
	for _, p := range []string{re.Err.Message, re.Err.UserMsg, re.Err.Details} {
		if p = strings.TrimSpace(p); p != "" && !containsFold(parts, p) {
			parts = append(parts, p)
		}
	}
	if re.Err.Data != nil {
		if d := strings.TrimSpace(re.Err.Data.Details); d != "" && !containsFold(parts, d) {
			parts = append(parts, d)
		}
	}
	return strings.Join(parts, " · ")
}

func containsFold(list []string, s string) bool {
	for _, v := range list {
		if strings.EqualFold(v, s) {
			return true
		}
	}
	return false
}
