// Package netgsm is the Netgsm SMS adapter (Turkey). It uses Netgsm's REST v2
// API with HTTP Basic authentication (usercode:password):
//
//	POST {base}/sms/rest/v2/send       {"msgheader","encoding","iysfilter","messages":[{"msg","no"}]}
//	POST {base}/sms/rest/v2/otp        {"msgheader","msg","no"}  (OTP lane)
//	GET  {base}/sms/rest/v2/msgheader  (connection test: the account's headers)
//
// Answers carry "code" ("00" = accepted) and "jobid". Classification: an
// answered error code is a definitive *sms.Rejected; a transport error, an
// HTTP 5xx or an unreadable 2xx is *sms.Uncertain.
package netgsm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms"
)

// Default base URL and paths.
const (
	DefaultBaseURL = "https://api.netgsm.com.tr"

	PathSend      = "/sms/rest/v2/send"
	PathOTP       = "/sms/rest/v2/otp"
	PathMsgHeader = "/sms/rest/v2/msgheader"
)

// Credential field keys.
const (
	FieldUserCode = "usercode"
	FieldPassword = "password"
)

// CodeOK is the accepted answer code.
const CodeOK = "00"

// rejections maps answered error codes to a description and whether sending
// again later may help.
var rejections = map[string]struct {
	msg       string
	retryable bool
}{
	"20":  {"message text is invalid or too long", false},
	"30":  {"invalid usercode / password or no API access (check the IP restriction)", false},
	"40":  {"the message header (msgheader) is not defined for the account", false},
	"41":  {"the message header (msgheader) is not defined for the account", false},
	"50":  {"the number is blocked by İYS control", false},
	"51":  {"no İYS brand code is defined for the account", false},
	"60":  {"no record found", false},
	"70":  {"invalid or missing parameters", false},
	"80":  {"sending limit exceeded", true},
	"85":  {"duplicate send limit reached for the number", true},
	"100": {"Netgsm system error", true},
}

// Config holds the base URL and the HTTP client.
type Config struct {
	BaseURL    string
	HTTPClient *http.Client
}

// Adapter implements sms.Provider for Netgsm.
type Adapter struct {
	base   string
	client *http.Client
}

var _ sms.Provider = (*Adapter)(nil)

// New builds the adapter.
func New(cfg Config) *Adapter {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		base = DefaultBaseURL
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	return &Adapter{base: base, client: client}
}

// Code implements sms.Provider.
func (a *Adapter) Code() string { return sms.ProviderNetgsm }

// Fields implements sms.Provider. The message header is the account sender.
func (a *Adapter) Fields() []sms.Field {
	return []sms.Field{
		{Key: FieldUserCode, Secret: false, Required: true},
		{Key: FieldPassword, Secret: true, Required: true},
	}
}

// Number renders a normalized number the way Netgsm expects it: Turkish
// numbers as 90XXXXXXXXXX, others with the international "00" prefix.
func Number(e164 string) string {
	d := sms.Digits(e164)
	if sms.IsTurkish(e164) {
		return d
	}
	return "00" + d
}

type answer struct {
	Code        string   `json:"code"`
	JobID       string   `json:"jobid"`
	Description string   `json:"description"`
	MsgHeaders  []string `json:"msgheaders"`
}

func (a *Adapter) do(ctx context.Context, creds sms.Credentials, method, path string, body any) (answer, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return answer{}, err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.base+path, reader)
	if err != nil {
		return answer{}, err
	}
	req.SetBasicAuth(creds.Get(FieldUserCode), creds.Get(FieldPassword))
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := a.client.Do(req)
	if err != nil {
		return answer{}, sms.TransportError(err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return answer{}, &sms.Uncertain{Err: err}
	}
	if res.StatusCode >= 500 {
		return answer{}, &sms.Uncertain{Err: fmt.Errorf("http %d", res.StatusCode)}
	}
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return answer{}, &sms.Rejected{Code: "30", Message: rejections["30"].msg, Auth: true}
	}
	var out answer
	if err := json.Unmarshal(raw, &out); err != nil {
		if res.StatusCode >= 400 {
			return answer{}, &sms.Rejected{Code: strconv.Itoa(res.StatusCode), Message: "http " + strconv.Itoa(res.StatusCode)}
		}
		// A 2xx we cannot read: the provider may have accepted it.
		return answer{}, &sms.Uncertain{Err: fmt.Errorf("unreadable answer: %w", err)}
	}
	return out, nil
}

func rejection(code, desc string) *sms.Rejected {
	r, ok := rejections[code]
	if !ok {
		msg := strings.TrimSpace(desc)
		if msg == "" {
			msg = "unknown error code"
		}
		return &sms.Rejected{Code: code, Message: msg}
	}
	return &sms.Rejected{
		Code: code, Message: r.msg, Retryable: r.retryable,
		Auth: code == "30", InvalidNumber: code == "50",
	}
}

// Check implements sms.Provider: lists the account's message headers
// (authenticated, sends nothing); sender must be one of them.
func (a *Adapter) Check(ctx context.Context, creds sms.Credentials, sender string) (sms.CheckResult, error) {
	out, err := a.do(ctx, creds, http.MethodGet, PathMsgHeader, nil)
	if err != nil {
		return sms.CheckResult{}, err
	}
	if out.Code != CodeOK {
		return sms.CheckResult{}, rejection(out.Code, out.Description)
	}
	res := sms.CheckResult{Senders: out.MsgHeaders}
	want := strings.TrimSpace(sender)
	if len(out.MsgHeaders) > 0 && want != "" {
		for _, h := range out.MsgHeaders {
			if strings.EqualFold(strings.TrimSpace(h), want) {
				res.Detail = "msgheader " + strings.TrimSpace(h)
				return res, nil
			}
		}
		return res, &sms.Rejected{Code: "40", Message: rejections["40"].msg}
	}
	return res, nil
}

// Send implements sms.Provider. OTP messages use the OTP endpoint, others the
// bulk endpoint with one message. Turkish letters switch the encoding to TR.
func (a *Adapter) Send(ctx context.Context, creds sms.Credentials, msg sms.Message) (sms.SendResult, error) {
	header := strings.TrimSpace(msg.Sender)
	if header == "" {
		return sms.SendResult{}, fmt.Errorf("%w: msgheader", sms.ErrMissingField)
	}
	no := Number(msg.To)
	var (
		out answer
		err error
	)
	if msg.Class == sms.ClassOTP {
		out, err = a.do(ctx, creds, http.MethodPost, PathOTP, map[string]any{
			"msgheader": header, "msg": msg.Body, "no": no,
		})
	} else {
		body := map[string]any{
			"msgheader": header,
			"messages":  []map[string]string{{"msg": msg.Body, "no": no}},
			// Service notices (no marketing): no İYS consent filter.
			"iysfilter": "0",
		}
		if sms.HasTurkish(msg.Body) {
			body["encoding"] = "TR"
		}
		out, err = a.do(ctx, creds, http.MethodPost, PathSend, body)
	}
	if err != nil {
		return sms.SendResult{}, err
	}
	if out.Code != CodeOK {
		return sms.SendResult{}, rejection(out.Code, out.Description)
	}
	if strings.TrimSpace(out.JobID) == "" {
		return sms.SendResult{}, &sms.Uncertain{Err: errors.New("accepted without a jobid")}
	}
	return sms.SendResult{MessageID: out.JobID, Status: "accepted"}, nil
}
