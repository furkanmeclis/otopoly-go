// Package sms is the SMS provider layer used by the messaging module. Each
// organization connects its own provider account (Netgsm, Twilio); the
// credentials are sealed per organization by the caller and handed to the
// adapter per call, never read from env.
//
// Numbers are passed normalized (E.164, "+905321234567"); adapters render
// them in the provider's own format. Errors are classified so the caller can
// decide whether a retry is safe:
//
//   - *Rejected: the provider answered and refused the request (nothing sent);
//   - *Unavailable: the provider was not reached (nothing sent, retry safe);
//   - *Uncertain: transport error / 5xx / unreadable 2xx (outcome unknown);
//   - anything else: our own input or configuration error (nothing sent).
package sms

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
)

// Provider codes.
const (
	ProviderNetgsm = "netgsm"
	ProviderTwilio = "twilio"
)

// Send classes.
const (
	// ClassOTP is a one-time code (Netgsm OTP lane).
	ClassOTP = "otp"
	// ClassTransactional is a service notice (job ready, payment received…).
	ClassTransactional = "transactional"
)

// Credentials are the decrypted provider fields of one account.
type Credentials map[string]string

// Get returns the trimmed value of key.
func (c Credentials) Get(key string) string { return strings.TrimSpace(c[key]) }

// Field describes one credential field of a provider.
type Field struct {
	Key      string `json:"key"`
	Secret   bool   `json:"secret"`
	Required bool   `json:"required"`
}

// Message is one SMS to one number.
type Message struct {
	// To is the normalized E.164 number ("+905321234567").
	To   string
	Body string
	// Sender is the message header (Netgsm) or From number /
	// MessagingServiceSid (Twilio).
	Sender string
	Class  string
}

// SendResult is an accepted message.
type SendResult struct {
	// MessageID is the provider reference (Netgsm jobid, Twilio SID).
	MessageID string
	// Status is the provider's initial status (accepted, queued, sent…).
	Status string
}

// CheckResult is the outcome of a successful connection test.
type CheckResult struct {
	// Detail is a short human hint (account name, header list…).
	Detail string `json:"detail,omitempty"`
	// Balance is the account credit when the provider reports it.
	Balance string `json:"balance,omitempty"`
	// Senders are the sender names / numbers the account may use, when known.
	Senders []string `json:"senders,omitempty"`
}

// Provider sends SMS for one organization account.
type Provider interface {
	Code() string
	Fields() []Field
	// Check makes one cheap authenticated call; no message is sent.
	Check(ctx context.Context, creds Credentials, sender string) (CheckResult, error)
	// Send hands one message to the provider.
	Send(ctx context.Context, creds Credentials, msg Message) (SendResult, error)
}

// Rejected is a definitive provider refusal: nothing was queued.
type Rejected struct {
	Code      string
	Message   string
	Retryable bool
	// Auth marks credential failures.
	Auth bool
	// InvalidNumber marks a recipient the provider refused.
	InvalidNumber bool
}

func (e *Rejected) Error() string {
	return fmt.Sprintf("sms provider rejected the request (code %s): %s", e.Code, e.Message)
}

// Uncertain marks an unknown outcome: the request may have reached the provider.
type Uncertain struct{ Err error }

func (e *Uncertain) Error() string { return "sms provider: outcome unknown: " + e.Err.Error() }
func (e *Uncertain) Unwrap() error { return e.Err }

// Unavailable marks a call that never reached the provider (connection
// refused, DNS failure): nothing was sent, a retry is safe.
type Unavailable struct{ Err error }

func (e *Unavailable) Error() string { return "sms provider unreachable: " + e.Err.Error() }
func (e *Unavailable) Unwrap() error { return e.Err }

// IsUnavailable reports whether err is an *Unavailable.
func IsUnavailable(err error) bool {
	var u *Unavailable
	return errors.As(err, &u)
}

// TransportError classifies an HTTP client error: a failed dial is
// *Unavailable (nothing sent), anything later *Uncertain.
func TransportError(err error) error {
	var op *net.OpError
	if errors.As(err, &op) && op.Op == "dial" {
		return &Unavailable{Err: err}
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return &Unavailable{Err: err}
	}
	return &Uncertain{Err: err}
}

// IsUncertain reports whether err leaves the outcome of a call unknown.
func IsUncertain(err error) bool {
	var u *Uncertain
	return errors.As(err, &u)
}

// AsRejected returns the *Rejected in err's chain.
func AsRejected(err error) (*Rejected, bool) {
	var r *Rejected
	if errors.As(err, &r) {
		return r, true
	}
	return nil, false
}

// ErrMissingField is returned when a required credential is empty.
var ErrMissingField = errors.New("sms: required credential is missing")

// Validate checks the required fields of a provider.
func Validate(p Provider, creds Credentials, sender string) error {
	for _, f := range p.Fields() {
		if f.Required && creds.Get(f.Key) == "" {
			return fmt.Errorf("%w: %s", ErrMissingField, f.Key)
		}
	}
	if strings.TrimSpace(sender) == "" {
		return fmt.Errorf("%w: sender", ErrMissingField)
	}
	return nil
}

// Hint masks a credential value for API responses: secrets show at most the
// last two characters, other values the first and last two.
func Hint(value string, secret bool) string {
	v := strings.TrimSpace(value)
	if v == "" {
		return ""
	}
	r := []rune(v)
	if secret {
		if len(r) <= 6 {
			return "••••••"
		}
		return "••••••" + string(r[len(r)-2:])
	}
	if len(r) <= 6 {
		return string(r[:1]) + "••••"
	}
	return string(r[:2]) + "••••" + string(r[len(r)-2:])
}

// MaskPhone hides the middle digits of a number ("+90532•••4567").
func MaskPhone(phone string) string {
	r := []rune(strings.TrimSpace(phone))
	if len(r) <= 7 {
		return strings.Repeat("•", len(r))
	}
	return string(r[:len(r)-7]) + "•••" + string(r[len(r)-4:])
}
