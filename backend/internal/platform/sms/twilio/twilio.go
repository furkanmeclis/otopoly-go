// Package twilio is the Twilio SMS adapter (international). It uses the
// Programmable Messaging REST API with HTTP Basic authentication
// (AccountSid:AuthToken):
//
//	POST {base}/2010-04-01/Accounts/{AccountSid}/Messages.json  (To, Body, From | MessagingServiceSid)
//	GET  {base}/2010-04-01/Accounts/{AccountSid}.json           (connection test)
//	GET  {base}/2010-04-01/Accounts/{AccountSid}/Balance.json   (credit, best effort)
//
// Classification: a 4xx answer is a definitive *sms.Rejected (429 retryable);
// a transport error, a 5xx or an unreadable 2xx is *sms.Uncertain.
package twilio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms"
)

// DefaultBaseURL is Twilio's REST API host.
const DefaultBaseURL = "https://api.twilio.com"

// Credential field keys.
const (
	FieldAccountSID = "account_sid"
	FieldAuthToken  = "auth_token"
)

// Config holds the base URL and the HTTP client.
type Config struct {
	BaseURL    string
	HTTPClient *http.Client
}

// Adapter implements sms.Provider for Twilio.
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
func (a *Adapter) Code() string { return sms.ProviderTwilio }

// Fields implements sms.Provider. The sender is a From number (E.164), an
// alphanumeric sender id, or a Messaging Service SID ("MG…").
func (a *Adapter) Fields() []sms.Field {
	return []sms.Field{
		{Key: FieldAccountSID, Secret: false, Required: true},
		{Key: FieldAuthToken, Secret: true, Required: true},
	}
}

// IsMessagingServiceSID reports whether sender is a Messaging Service SID.
func IsMessagingServiceSID(sender string) bool {
	s := strings.TrimSpace(sender)
	return len(s) == 34 && strings.HasPrefix(s, "MG")
}

type apiError struct {
	Code     int    `json:"code"`
	Message  string `json:"message"`
	MoreInfo string `json:"more_info"`
	Status   int    `json:"status"`
}

type message struct {
	SID          string  `json:"sid"`
	Status       string  `json:"status"`
	ErrorCode    *int    `json:"error_code"`
	ErrorMessage *string `json:"error_message"`
}

type account struct {
	SID          string `json:"sid"`
	FriendlyName string `json:"friendly_name"`
	Status       string `json:"status"`
}

type balance struct {
	Balance  string `json:"balance"`
	Currency string `json:"currency"`
}

// Twilio error codes for invalid / unreachable recipients.
var invalidNumberCodes = map[int]bool{21211: true, 21214: true, 21612: true, 21614: true, 21408: true, 21610: true}

func (a *Adapter) accountPath(creds sms.Credentials, suffix string) (string, error) {
	sid := creds.Get(FieldAccountSID)
	if sid == "" {
		return "", fmt.Errorf("%w: %s", sms.ErrMissingField, FieldAccountSID)
	}
	return a.base + "/2010-04-01/Accounts/" + url.PathEscape(sid) + suffix, nil
}

func (a *Adapter) do(ctx context.Context, creds sms.Credentials, method, endpoint string, form url.Values, out any) error {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	req.SetBasicAuth(creds.Get(FieldAccountSID), creds.Get(FieldAuthToken))
	req.Header.Set("Accept", "application/json")
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	res, err := a.client.Do(req)
	if err != nil {
		return sms.TransportError(err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return &sms.Uncertain{Err: err}
	}
	if res.StatusCode >= 500 {
		return &sms.Uncertain{Err: fmt.Errorf("http %d", res.StatusCode)}
	}
	if res.StatusCode >= 400 {
		var e apiError
		_ = json.Unmarshal(raw, &e)
		code := strconv.Itoa(res.StatusCode)
		if e.Code != 0 {
			code = strconv.Itoa(e.Code)
		}
		msg := strings.TrimSpace(e.Message)
		if msg == "" {
			msg = "http " + strconv.Itoa(res.StatusCode)
		}
		return &sms.Rejected{
			Code: code, Message: msg,
			Retryable:     res.StatusCode == http.StatusTooManyRequests,
			Auth:          res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden || e.Code == 20003,
			InvalidNumber: invalidNumberCodes[e.Code],
		}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return &sms.Uncertain{Err: fmt.Errorf("unreadable answer: %w", err)}
	}
	return nil
}

// Check implements sms.Provider: reads the account (and its balance when
// the account may see it). Sends nothing.
func (a *Adapter) Check(ctx context.Context, creds sms.Credentials, _ string) (sms.CheckResult, error) {
	endpoint, err := a.accountPath(creds, ".json")
	if err != nil {
		return sms.CheckResult{}, err
	}
	var acc account
	if err := a.do(ctx, creds, http.MethodGet, endpoint, nil, &acc); err != nil {
		return sms.CheckResult{}, err
	}
	if acc.Status != "" && acc.Status != "active" {
		return sms.CheckResult{}, &sms.Rejected{Code: "account_" + acc.Status, Message: "twilio account is " + acc.Status, Auth: true}
	}
	res := sms.CheckResult{Detail: strings.TrimSpace(acc.FriendlyName)}
	if bEndpoint, err := a.accountPath(creds, "/Balance.json"); err == nil {
		var b balance
		if err := a.do(ctx, creds, http.MethodGet, bEndpoint, nil, &b); err == nil && b.Balance != "" {
			res.Balance = strings.TrimSpace(b.Balance + " " + b.Currency)
		}
	}
	return res, nil
}

// Send implements sms.Provider.
func (a *Adapter) Send(ctx context.Context, creds sms.Credentials, msg sms.Message) (sms.SendResult, error) {
	sender := strings.TrimSpace(msg.Sender)
	if sender == "" {
		return sms.SendResult{}, fmt.Errorf("%w: from", sms.ErrMissingField)
	}
	endpoint, err := a.accountPath(creds, "/Messages.json")
	if err != nil {
		return sms.SendResult{}, err
	}
	form := url.Values{}
	form.Set("To", msg.To)
	form.Set("Body", msg.Body)
	if IsMessagingServiceSID(sender) {
		form.Set("MessagingServiceSid", sender)
	} else {
		form.Set("From", sender)
	}
	var out message
	if err := a.do(ctx, creds, http.MethodPost, endpoint, form, &out); err != nil {
		return sms.SendResult{}, err
	}
	if out.Status == "failed" || out.Status == "undelivered" {
		code := ""
		if out.ErrorCode != nil {
			code = strconv.Itoa(*out.ErrorCode)
		}
		desc := "message " + out.Status
		if out.ErrorMessage != nil && *out.ErrorMessage != "" {
			desc = *out.ErrorMessage
		}
		return sms.SendResult{MessageID: out.SID, Status: out.Status}, &sms.Rejected{Code: code, Message: desc}
	}
	if strings.TrimSpace(out.SID) == "" {
		return sms.SendResult{}, &sms.Uncertain{Err: errors.New("accepted without a message sid")}
	}
	return sms.SendResult{MessageID: out.SID, Status: out.Status}, nil
}
