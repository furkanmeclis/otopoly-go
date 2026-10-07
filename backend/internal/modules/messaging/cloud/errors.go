package cloud

import (
	"errors"
	"strconv"

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

// Classify turns a library error into a *model.SendError. Graph errors are
// mapped by code; transport/decode failures (network, 5xx without a Graph
// body) are retryable.
func Classify(err error) *model.SendError {
	if err == nil {
		return nil
	}
	var se *model.SendError
	if errors.As(err, &se) {
		return se
	}
	var re *whttp.ResponseError
	if errors.As(err, &re) && re.Err != nil {
		code, retry := graphCode(re.Err.Code)
		return model.NewSendError(code, retry, err)
	}
	return model.NewSendError(model.ErrCodeCloudUnavailable, true, err)
}
