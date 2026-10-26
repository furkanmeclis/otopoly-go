// Package netgsm is the Netgsm SMS adapter (Turkey). The request formats
// follow an implementation that runs live in production (the owner's
// garanti-kulucka worker, apps/worker/src/providers/netgsm.ts):
//
//	POST {base}/sms/send/xml/  text/xml  <mainbody><header><company dil="TR">Netgsm</company>
//	                                     <usercode/><password/><type>1:n</type><msgheader/></header>
//	                                     <body><msg><![CDATA[…]]></msg><no>905…</no></body></mainbody>
//	    → plain text "00 <jobid>" (00 / 01 / 02 = accepted) or an error code ("30", "40" …)
//	POST {base}/balance        application/json {"usercode","password","stip":2}
//	    → {"code":"00","balance":"1.234,56"}             (TL credit)
//	                           {"usercode","password","stip":1}
//	    → {"code":"00","balance":[{"amount":1500,"balance_name":"SMS"}]}  (packages; "60" = none)
//
// Classification: an answered error code is a definitive *sms.Rejected; a
// transport error, an HTTP 5xx or an unreadable 2xx is *sms.Uncertain.
package netgsm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms"
)

// Default base URL and paths.
const (
	DefaultBaseURL = "https://api.netgsm.com.tr"

	PathSendXML = "/sms/send/xml/"
	PathBalance = "/balance"
)

// Credential field keys.
const (
	FieldUserCode = "usercode"
	FieldPassword = "password"
)

// Balance query types (stip).
const (
	stipPackages = 1
	stipCredit   = 2
)

// codeNoRecords is the balance answer of an account without packages.
const codeNoRecords = "60"

// successCodes are the accepted answers of the XML send endpoint.
var successCodes = map[string]bool{"00": true, "01": true, "02": true}

// rejections maps answered error codes to a description and whether sending
// again later may help.
var rejections = map[string]struct {
	msg       string
	retryable bool
}{
	"20":  {"message text is missing or too long", false},
	"30":  {"invalid usercode / password or no API access (check the IP restriction)", false},
	"40":  {"the message header (msgheader) is not defined for the account", false},
	"50":  {"insufficient credit, or İYS-controlled sending is not allowed for the account", false},
	"51":  {"the message header is not approved / no İYS brand code is defined", false},
	"60":  {"no record found", false},
	"70":  {"invalid XML or parameters", false},
	"80":  {"sending limit exceeded", true},
	"85":  {"duplicate message blocked (same text to the same number)", false},
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

var xmlEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;")

// cdata wraps text in CDATA, splitting a literal "]]>" so it cannot close it.
func cdata(s string) string {
	return "<![CDATA[" + strings.ReplaceAll(s, "]]>", "]]]]><![CDATA[>") + "]]>"
}

// SendXML builds the body of the XML send endpoint (one message, one number).
// dil="TR" is always set, like the production implementation: Turkish
// letters are delivered as Turkish characters.
func SendXML(usercode, password, header, body, no string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n<mainbody>\n  <header>\n")
	b.WriteString(`    <company dil="TR">Netgsm</company>` + "\n")
	b.WriteString("    <usercode>" + xmlEscaper.Replace(usercode) + "</usercode>\n")
	b.WriteString("    <password>" + xmlEscaper.Replace(password) + "</password>\n")
	b.WriteString("    <type>1:n</type>\n")
	b.WriteString("    <msgheader>" + xmlEscaper.Replace(header) + "</msgheader>\n")
	b.WriteString("  </header>\n  <body>\n")
	b.WriteString("    <msg>" + cdata(body) + "</msg>\n")
	b.WriteString("    <no>" + xmlEscaper.Replace(no) + "</no>\n")
	b.WriteString("  </body>\n</mainbody>")
	return b.String()
}

// ParseSendAnswer splits the plain-text answer "00 <jobid>" into code and job id.
func ParseSendAnswer(body string) (code, jobID string, ok bool) {
	parts := strings.Fields(strings.TrimSpace(body))
	if len(parts) == 0 {
		return "", "", false
	}
	code = parts[0]
	if len(parts) > 1 {
		jobID = parts[1]
	}
	return code, jobID, true
}

func (a *Adapter) post(ctx context.Context, path, contentType string, body []byte) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.base+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", contentType)
	res, err := a.client.Do(req)
	if err != nil {
		return 0, nil, sms.TransportError(err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return res.StatusCode, nil, &sms.Uncertain{Err: err}
	}
	if res.StatusCode >= 500 {
		return res.StatusCode, raw, &sms.Uncertain{Err: fmt.Errorf("http %d", res.StatusCode)}
	}
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return res.StatusCode, raw, &sms.Rejected{Code: "30", Message: rejections["30"].msg, Auth: true}
	}
	if res.StatusCode == http.StatusTooManyRequests {
		return res.StatusCode, raw, &sms.Rejected{Code: "429", Message: "rate limited", Retryable: true}
	}
	return res.StatusCode, raw, nil
}

func rejection(code, desc string) *sms.Rejected {
	r, ok := rejections[code]
	if !ok {
		msg := strings.TrimSpace(desc)
		if msg == "" {
			msg = "unknown Netgsm error code"
		}
		return &sms.Rejected{Code: code, Message: msg}
	}
	return &sms.Rejected{Code: code, Message: r.msg, Retryable: r.retryable, Auth: code == "30"}
}

// Send implements sms.Provider through the XML endpoint (all classes,
// including OTP codes).
func (a *Adapter) Send(ctx context.Context, creds sms.Credentials, msg sms.Message) (sms.SendResult, error) {
	header := strings.TrimSpace(msg.Sender)
	if header == "" {
		return sms.SendResult{}, fmt.Errorf("%w: msgheader", sms.ErrMissingField)
	}
	if creds.Get(FieldUserCode) == "" || creds.Get(FieldPassword) == "" {
		return sms.SendResult{}, fmt.Errorf("%w: usercode / password", sms.ErrMissingField)
	}
	payload := SendXML(creds.Get(FieldUserCode), creds.Get(FieldPassword), header, msg.Body, Number(msg.To))
	status, raw, err := a.post(ctx, PathSendXML, "text/xml; charset=utf-8", []byte(payload))
	if err != nil {
		return sms.SendResult{}, err
	}
	code, jobID, ok := ParseSendAnswer(string(raw))
	if status >= 400 {
		if ok && code != "" {
			return sms.SendResult{}, rejection(code, "")
		}
		return sms.SendResult{}, &sms.Rejected{Code: strconv.Itoa(status), Message: "http " + strconv.Itoa(status)}
	}
	if !ok {
		// A 2xx we cannot read: the provider may have accepted it.
		return sms.SendResult{}, &sms.Uncertain{Err: errors.New("empty answer")}
	}
	if !successCodes[code] {
		if !isCode(code) {
			return sms.SendResult{}, &sms.Uncertain{Err: fmt.Errorf("unreadable answer %q", truncate(code, 40))}
		}
		return sms.SendResult{}, rejection(code, "")
	}
	if jobID == "" {
		return sms.SendResult{}, &sms.Uncertain{Err: errors.New("accepted without a job id")}
	}
	return sms.SendResult{MessageID: jobID, Status: "accepted"}, nil
}

var codeRE = regexp.MustCompile(`^\d{2,3}$`)

func isCode(s string) bool { return codeRE.MatchString(s) }

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// Package is one balance package (SMS, voice minutes …).
type Package struct {
	Name   string  `json:"balance_name"`
	Amount float64 `json:"amount"`
}

// Balance is a parsed /balance answer.
type Balance struct {
	Code     string
	Raw      string
	Amount   *float64
	Packages []Package
}

// ParseAmount reads Netgsm's Turkish notation ("1.234,56"), plain
// "1234.56" and bare integers.
func ParseAmount(v any) *float64 {
	switch x := v.(type) {
	case float64:
		return &x
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return nil
		}
		return &f
	case string:
		t := strings.TrimSpace(strings.ReplaceAll(x, " ", ""))
		for _, suffix := range []string{"TL", "TRY", "₺", "tl"} {
			t = strings.TrimSuffix(t, suffix)
		}
		if t == "" {
			return nil
		}
		if strings.Contains(t, ",") && strings.Contains(t, ".") {
			t = strings.ReplaceAll(t, ".", "")
		}
		t = strings.Replace(t, ",", ".", 1)
		f, err := strconv.ParseFloat(t, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil
		}
		return &f
	}
	return nil
}

func packagesOf(v any) []Package {
	list, ok := v.([]any)
	if !ok {
		return nil
	}
	var out []Package
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := m["balance_name"].(string)
		if name == "" {
			name, _ = m["name"].(string)
		}
		amt := ParseAmount(m["amount"])
		if name == "" && amt == nil {
			continue
		}
		p := Package{Name: name}
		if amt != nil {
			p.Amount = *amt
		}
		out = append(out, p)
	}
	return out
}

// ParseBalance normalizes a /balance answer: JSON (`code` + `balance` string
// or array, `balances`) or a bare "00 123,45" / "30" text line.
func ParseBalance(body []byte) Balance {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return Balance{}
	}
	dec := json.NewDecoder(strings.NewReader(trimmed))
	dec.UseNumber()
	var v any
	if !json.Valid([]byte(trimmed)) || dec.Decode(&v) != nil {
		parts := strings.Fields(trimmed)
		out := Balance{Code: parts[0]}
		if len(parts) > 1 {
			out.Raw = strings.Join(parts[1:], " ")
			out.Amount = ParseAmount(out.Raw)
		}
		return out
	}
	switch x := v.(type) {
	case json.Number:
		return Balance{Code: x.String()}
	case string:
		return Balance{Code: strings.TrimSpace(x)}
	case []any:
		return Balance{Packages: packagesOf(x)}
	case map[string]any:
		out := Balance{}
		switch c := x["code"].(type) {
		case string:
			out.Code = strings.TrimSpace(c)
		case json.Number:
			out.Code = c.String()
		}
		out.Packages = append(out.Packages, packagesOf(x["balance"])...)
		out.Packages = append(out.Packages, packagesOf(x["balances"])...)
		out.Packages = append(out.Packages, packagesOf(x["balanceinfo"])...)
		switch b := x["balance"].(type) {
		case string:
			out.Raw = strings.TrimSpace(b)
			out.Amount = ParseAmount(b)
		case json.Number:
			out.Raw = b.String()
			out.Amount = ParseAmount(b)
		}
		return out
	}
	return Balance{}
}

// SMSCredit sums the SMS packages (balance_name containing "sms").
func SMSCredit(pkgs []Package) *int64 {
	var sum float64
	found := false
	for _, p := range pkgs {
		if strings.Contains(strings.ToLower(p.Name), "sms") {
			sum += p.Amount
			found = true
		}
	}
	if !found {
		return nil
	}
	v := int64(math.Round(sum))
	return &v
}

func (a *Adapter) balance(ctx context.Context, creds sms.Credentials, stip int) (Balance, error) {
	body, _ := json.Marshal(map[string]any{
		"usercode": creds.Get(FieldUserCode), "password": creds.Get(FieldPassword), "stip": stip,
	})
	status, raw, err := a.post(ctx, PathBalance, "application/json", body)
	if err != nil {
		return Balance{}, err
	}
	b := ParseBalance(raw)
	if status >= 400 {
		if b.Code != "" {
			return b, rejection(b.Code, "")
		}
		return b, &sms.Rejected{Code: strconv.Itoa(status), Message: "http " + strconv.Itoa(status)}
	}
	return b, nil
}

// Check implements sms.Provider: the TL credit (stip 2, authoritative: it
// proves the credentials) and the package list (stip 1, best effort; "60"
// = no packages). Sends nothing. The message header is verified by the
// test SMS (Netgsm answers 40 for an unknown header).
func (a *Adapter) Check(ctx context.Context, creds sms.Credentials, _ string) (sms.CheckResult, error) {
	credit, err := a.balance(ctx, creds, stipCredit)
	if err != nil {
		return sms.CheckResult{}, err
	}
	if credit.Code != "" && credit.Code != "00" {
		return sms.CheckResult{}, rejection(credit.Code, "")
	}
	if credit.Amount == nil {
		return sms.CheckResult{}, &sms.Uncertain{Err: errors.New("balance answer could not be read")}
	}
	res := sms.CheckResult{Balance: formatTL(*credit.Amount)}
	pkgs := credit.Packages
	if p, err := a.balance(ctx, creds, stipPackages); err == nil && (p.Code == "" || p.Code == "00" || p.Code == codeNoRecords) {
		pkgs = append(pkgs, p.Packages...)
	}
	res.SMSCredit = SMSCredit(pkgs)
	return res, nil
}

// formatTL prints an amount in Turkish notation ("1.234,56 TL").
func formatTL(v float64) string {
	s := strconv.FormatFloat(math.Abs(v), 'f', 2, 64)
	intPart, frac := s[:len(s)-3], s[len(s)-2:]
	var b strings.Builder
	for i, r := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	sign := ""
	if v < 0 {
		sign = "-"
	}
	return sign + b.String() + "," + frac + " TL"
}
