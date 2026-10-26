// Package smschannel manages the organization's own SMS provider accounts
// (Netgsm, Twilio) and delivers SMS through the active one. Credentials are
// sealed with the platform SecretBox; API payloads carry masked hints only.
package smschannel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Account statuses.
const (
	StatusUnchecked = "unchecked"
	StatusConnected = "connected"
	StatusError     = "error"
)

// Activity resource and actions.
const (
	ActivityResource       = "tenant.messaging.sms"
	ActionConnected        = "messaging.sms.connected"
	ActionUpdated          = "messaging.sms.updated"
	ActionEnabled          = "messaging.sms.enabled"
	ActionDisabled         = "messaging.sms.disabled"
	ActionDisconnected     = "messaging.sms.disconnected"
	ActionTested           = "messaging.sms.tested"
	ActionTestSent         = "messaging.sms.test_sent"
	maxBodyRunes           = 1000
	maxSenderLen           = 64
	checkTimeout           = 15 * time.Second
	sendTimeout            = 20 * time.Second
	defaultTestBodyTurkish = "Otopoly test mesajı: SMS kanalınız çalışıyor."
)

var (
	// ErrNotFound: the provider is unknown or not connected for the organization.
	ErrNotFound = errors.New("sms provider account not found")
	// ErrInvalidRequest wraps validation failures.
	ErrInvalidRequest = errors.New("invalid request")
)

// Querier is the persistence surface of the service.
type Querier interface {
	ListSMSProviderAccounts(ctx context.Context, organizationID int64) ([]db.SmsProviderAccount, error)
	GetSMSProviderAccount(ctx context.Context, arg db.GetSMSProviderAccountParams) (db.SmsProviderAccount, error)
	GetActiveSMSProviderAccount(ctx context.Context, organizationID int64) (db.SmsProviderAccount, error)
	UpsertSMSProviderAccount(ctx context.Context, arg db.UpsertSMSProviderAccountParams) (db.SmsProviderAccount, error)
	DeactivateSMSProviderAccounts(ctx context.Context, arg db.DeactivateSMSProviderAccountsParams) error
	SetSMSProviderAccountActive(ctx context.Context, arg db.SetSMSProviderAccountActiveParams) (db.SmsProviderAccount, error)
	SetSMSProviderAccountCheck(ctx context.Context, arg db.SetSMSProviderAccountCheckParams) (db.SmsProviderAccount, error)
	DeleteSMSProviderAccount(ctx context.Context, arg db.DeleteSMSProviderAccountParams) (int64, error)
}

// Sealer encrypts credentials at rest (platform/crypto.SecretBox).
type Sealer interface {
	Encrypt(plaintext string) (string, error)
	Decrypt(encoded string) (string, error)
}

// ActivityRecorder writes audit events (platform/activity.Recorder).
type ActivityRecorder interface {
	Record(ctx context.Context, actorID *int64, action, resource string, resourceUUID *uuid.UUID, payload map[string]any, r *http.Request)
}

// Plan features of the SMS channel (billing_features).
const (
	// FeatureSMSEnabled is the plan toggle for SMS sending.
	FeatureSMSEnabled = "sms.enabled"
	// FeatureSMSMonthly is the monthly quota in SMS parts (segments).
	FeatureSMSMonthly = "sms.monthly"
)

// Entitlements gates sends on the organization's plan (platform/entitlements).
type Entitlements interface {
	Enabled(ctx context.Context, orgID int64, key string) (bool, error)
	Check(ctx context.Context, orgID int64, key string, delta int64) (entitlements.Decision, error)
	Consume(ctx context.Context, orgID int64, key string, delta int64) error
}

// TestSender records a test SMS in the outbound log (messaging service).
type TestSender interface {
	LogSMSTest(ctx context.Context, orgID int64, phone string, res model.SMSDelivery, sendErr error)
}

// Service manages accounts and delivers SMS.
type Service struct {
	q         Querier
	box       Sealer
	act       ActivityRecorder
	providers map[string]sms.Provider
	order     []string
	log       TestSender
	ent       Entitlements
}

// SetEntitlements installs the plan gate (sms.enabled, sms.monthly). Without
// it every send is allowed and nothing is counted.
func (s *Service) SetEntitlements(e Entitlements) { s.ent = e }

// New builds the service with the registered providers (display order).
func New(q Querier, box Sealer, act ActivityRecorder, providers ...sms.Provider) *Service {
	s := &Service{q: q, box: box, act: act, providers: map[string]sms.Provider{}}
	for _, p := range providers {
		if p == nil {
			continue
		}
		s.providers[p.Code()] = p
		s.order = append(s.order, p.Code())
	}
	return s
}

// SetTestLogger installs the outbound log writer for test SMS.
func (s *Service) SetTestLogger(l TestSender) { s.log = l }

// Account is the public view of a connected provider account.
type Account struct {
	UUID     uuid.UUID `json:"uuid"`
	Provider string    `json:"provider"`
	Sender   string    `json:"sender"`
	// IsActive: this account is the organization's SMS channel.
	IsActive bool `json:"is_active"`
	// Status: unchecked | connected | error (last connection test).
	Status          string            `json:"status"`
	LastCheckedAt   *time.Time        `json:"last_checked_at,omitempty"`
	LastError       string            `json:"last_error,omitempty"`
	CredentialHints map[string]string `json:"credential_hints"`
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
}

// ProviderEntry is one supported provider and the organization's account.
type ProviderEntry struct {
	Provider string      `json:"provider"`
	Fields   []sms.Field `json:"fields"`
	// SenderKind: msgheader (Netgsm header) | from (Twilio number / MG SID).
	SenderKind string   `json:"sender_kind"`
	Account    *Account `json:"account"`
}

// Overview lists every provider; ActiveProvider is "" when SMS is off.
type Overview struct {
	ActiveProvider string          `json:"active_provider"`
	Providers      []ProviderEntry `json:"providers"`
}

// SaveInput connects or updates an account. Empty credential values keep
// the stored ones.
type SaveInput struct {
	Credentials map[string]string `json:"credentials"`
	Sender      *string           `json:"sender"`
	// Activate makes the account the SMS channel (default: true when the
	// organization has no active SMS provider yet).
	Activate *bool `json:"activate"`
}

// TestResult is a connection test outcome.
type TestResult struct {
	OK        bool     `json:"ok"`
	ErrorCode string   `json:"error_code,omitempty"`
	Message   string   `json:"message,omitempty"`
	Detail    string   `json:"detail,omitempty"`
	Balance   string   `json:"balance,omitempty"`
	SMSCredit *int64   `json:"sms_credit,omitempty"`
	Senders   []string `json:"senders,omitempty"`
	Account   Account  `json:"account"`
}

// TestSMSInput sends a test SMS.
type TestSMSInput struct {
	Phone string `json:"phone"`
	Body  string `json:"body"`
}

// TestSMSResult is the outcome of a test SMS.
type TestSMSResult struct {
	Status            string       `json:"status"`
	Provider          string       `json:"provider"`
	Recipient         string       `json:"recipient"`
	ProviderMessageID string       `json:"provider_message_id,omitempty"`
	ProviderStatus    string       `json:"provider_status,omitempty"`
	ErrorCode         string       `json:"error_code,omitempty"`
	ErrorMessage      string       `json:"error_message,omitempty"`
	Segments          sms.Segments `json:"segments"`
}

func (s *Service) provider(code string) (sms.Provider, error) {
	p, ok := s.providers[strings.TrimSpace(code)]
	if !ok {
		return nil, ErrNotFound
	}
	return p, nil
}

func senderKind(provider string) string {
	if provider == sms.ProviderTwilio {
		return "from"
	}
	return "msgheader"
}

// Overview lists providers with the organization's accounts.
func (s *Service) Overview(ctx context.Context, orgID int64) (Overview, error) {
	rows, err := s.q.ListSMSProviderAccounts(ctx, orgID)
	if err != nil {
		return Overview{}, fmt.Errorf("sms accounts: %w", err)
	}
	byProvider := make(map[string]db.SmsProviderAccount, len(rows))
	for _, r := range rows {
		byProvider[r.Provider] = r
	}
	out := Overview{Providers: make([]ProviderEntry, 0, len(s.order))}
	for _, code := range s.order {
		p := s.providers[code]
		e := ProviderEntry{Provider: code, Fields: p.Fields(), SenderKind: senderKind(code)}
		if r, ok := byProvider[code]; ok {
			a := mapAccount(r)
			e.Account = &a
			if r.IsActive {
				out.ActiveProvider = code
			}
		}
		out.Providers = append(out.Providers, e)
	}
	return out, nil
}

func (s *Service) load(ctx context.Context, orgID int64, provider string) (db.SmsProviderAccount, error) {
	row, err := s.q.GetSMSProviderAccount(ctx, db.GetSMSProviderAccountParams{OrganizationID: orgID, Provider: provider})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.SmsProviderAccount{}, ErrNotFound
	}
	return row, err
}

func (s *Service) open(row db.SmsProviderAccount) (sms.Credentials, error) {
	if s.box == nil {
		return nil, errors.New("sms credentials: encryption is not configured")
	}
	plain, err := s.box.Decrypt(row.CredentialsEnc)
	if err != nil {
		return nil, fmt.Errorf("sms credentials: %w", err)
	}
	creds := sms.Credentials{}
	if err := json.Unmarshal([]byte(plain), &creds); err != nil {
		return nil, fmt.Errorf("sms credentials: %w", err)
	}
	return creds, nil
}

// Save connects or updates the organization's account of a provider.
func (s *Service) Save(ctx context.Context, orgID int64, actorID *int64, provider string, in SaveInput) (Account, error) {
	p, err := s.provider(provider)
	if err != nil {
		return Account{}, err
	}
	existing, err := s.load(ctx, orgID, provider)
	isNew := errors.Is(err, ErrNotFound)
	if err != nil && !isNew {
		return Account{}, err
	}
	creds := sms.Credentials{}
	sender := ""
	if !isNew {
		if creds, err = s.open(existing); err != nil {
			return Account{}, err
		}
		sender = existing.Sender
	}
	allowed := map[string]bool{}
	for _, f := range p.Fields() {
		allowed[f.Key] = true
	}
	for k, v := range in.Credentials {
		if !allowed[k] {
			return Account{}, fmt.Errorf("%w: unknown credential %q", ErrInvalidRequest, k)
		}
		if v = strings.TrimSpace(v); v != "" {
			if len(v) > 256 {
				return Account{}, fmt.Errorf("%w: %s is too long", ErrInvalidRequest, k)
			}
			creds[k] = v
		}
	}
	if in.Sender != nil {
		sender = strings.TrimSpace(*in.Sender)
	}
	if err := validateSender(provider, sender); err != nil {
		return Account{}, err
	}
	if err := sms.Validate(p, creds, sender); err != nil {
		return Account{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}
	raw, err := json.Marshal(creds)
	if err != nil {
		return Account{}, err
	}
	if s.box == nil {
		return Account{}, errors.New("sms credentials: encryption is not configured")
	}
	enc, err := s.box.Encrypt(string(raw))
	if err != nil {
		return Account{}, fmt.Errorf("sms credentials: %w", err)
	}
	hints := map[string]string{}
	for _, f := range p.Fields() {
		if v := creds.Get(f.Key); v != "" {
			hints[f.Key] = sms.Hint(v, f.Secret)
		}
	}
	hintJSON, _ := json.Marshal(hints)
	row, err := s.q.UpsertSMSProviderAccount(ctx, db.UpsertSMSProviderAccountParams{
		OrganizationID: orgID, Provider: provider, Sender: sender,
		CredentialsEnc: enc, CredentialHints: hintJSON, ActorID: optInt8(actorID),
	})
	if err != nil {
		return Account{}, fmt.Errorf("sms account save: %w", err)
	}
	activate := false
	if in.Activate != nil {
		activate = *in.Activate
	} else if !row.IsActive {
		if _, err := s.q.GetActiveSMSProviderAccount(ctx, orgID); errors.Is(err, pgx.ErrNoRows) {
			activate = true
		}
	}
	if activate && !row.IsActive {
		if row, err = s.setActive(ctx, orgID, actorID, provider, true); err != nil {
			return Account{}, err
		}
	} else if in.Activate != nil && !*in.Activate && row.IsActive {
		if row, err = s.setActive(ctx, orgID, actorID, provider, false); err != nil {
			return Account{}, err
		}
	}
	action := ActionUpdated
	if isNew {
		action = ActionConnected
	}
	s.record(ctx, actorID, action, row, map[string]any{"provider": provider, "is_active": row.IsActive})
	return mapAccount(row), nil
}

func validateSender(provider, sender string) error {
	if sender == "" {
		return fmt.Errorf("%w: sender is required", ErrInvalidRequest)
	}
	if len(sender) > maxSenderLen {
		return fmt.Errorf("%w: sender is too long", ErrInvalidRequest)
	}
	if provider == sms.ProviderTwilio && strings.HasPrefix(sender, "+") {
		if _, err := sms.NormalizeE164(sender); err != nil {
			return fmt.Errorf("%w: sender must be an E.164 number, an alphanumeric id or a Messaging Service SID", ErrInvalidRequest)
		}
	}
	return nil
}

func (s *Service) setActive(ctx context.Context, orgID int64, actorID *int64, provider string, active bool) (db.SmsProviderAccount, error) {
	if active {
		if err := s.q.DeactivateSMSProviderAccounts(ctx, db.DeactivateSMSProviderAccountsParams{
			OrganizationID: orgID, KeepProvider: provider,
		}); err != nil {
			return db.SmsProviderAccount{}, fmt.Errorf("sms deactivate others: %w", err)
		}
	}
	row, err := s.q.SetSMSProviderAccountActive(ctx, db.SetSMSProviderAccountActiveParams{
		OrganizationID: orgID, Provider: provider, IsActive: active, ActorID: optInt8(actorID),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.SmsProviderAccount{}, ErrNotFound
	}
	if err != nil {
		return db.SmsProviderAccount{}, fmt.Errorf("sms set active: %w", err)
	}
	return row, nil
}

// SetActive enables (the SMS channel; others are disabled) or disables an account.
func (s *Service) SetActive(ctx context.Context, orgID int64, actorID *int64, provider string, active bool) (Account, error) {
	if _, err := s.provider(provider); err != nil {
		return Account{}, err
	}
	row, err := s.setActive(ctx, orgID, actorID, provider, active)
	if err != nil {
		return Account{}, err
	}
	action := ActionDisabled
	if active {
		action = ActionEnabled
	}
	s.record(ctx, actorID, action, row, map[string]any{"provider": provider})
	return mapAccount(row), nil
}

// Disconnect deletes the account and its credentials.
func (s *Service) Disconnect(ctx context.Context, orgID int64, actorID *int64, provider string) error {
	if _, err := s.provider(provider); err != nil {
		return err
	}
	row, err := s.load(ctx, orgID, provider)
	if err != nil {
		return err
	}
	n, err := s.q.DeleteSMSProviderAccount(ctx, db.DeleteSMSProviderAccountParams{OrganizationID: orgID, Provider: provider})
	if err != nil {
		return fmt.Errorf("sms disconnect: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	s.record(ctx, actorID, ActionDisconnected, row, map[string]any{"provider": provider})
	return nil
}

// Test runs the provider's connection check and stores the outcome.
func (s *Service) Test(ctx context.Context, orgID int64, actorID *int64, provider string) (TestResult, error) {
	p, err := s.provider(provider)
	if err != nil {
		return TestResult{}, err
	}
	row, err := s.load(ctx, orgID, provider)
	if err != nil {
		return TestResult{}, err
	}
	creds, err := s.open(row)
	if err != nil {
		return TestResult{}, err
	}
	cctx, cancel := context.WithTimeout(ctx, checkTimeout)
	check, checkErr := p.Check(cctx, creds, row.Sender)
	cancel()
	out := TestResult{OK: checkErr == nil, Detail: check.Detail, Balance: check.Balance, SMSCredit: check.SMSCredit, Senders: check.Senders}
	status, lastErr := StatusConnected, ""
	if checkErr != nil {
		se := Classify(checkErr)
		status, lastErr = StatusError, publicMessage(checkErr)
		out.ErrorCode, out.Message = se.Code, lastErr
	}
	updated, err := s.q.SetSMSProviderAccountCheck(ctx, db.SetSMSProviderAccountCheckParams{
		OrganizationID: orgID, Provider: provider, Status: status, LastError: lastErr,
	})
	if err != nil {
		return TestResult{}, fmt.Errorf("sms check save: %w", err)
	}
	out.Account = mapAccount(updated)
	s.record(ctx, actorID, ActionTested, updated, map[string]any{"provider": provider, "ok": out.OK, "error_code": out.ErrorCode})
	return out, nil
}

// SendTest sends a test SMS through a connected account (active or not) and
// logs it in the outbound messages.
func (s *Service) SendTest(ctx context.Context, orgID int64, actorID *int64, provider string, in TestSMSInput) (TestSMSResult, error) {
	p, err := s.provider(provider)
	if err != nil {
		return TestSMSResult{}, err
	}
	row, err := s.load(ctx, orgID, provider)
	if err != nil {
		return TestSMSResult{}, err
	}
	to, err := sms.NormalizeE164(in.Phone)
	if err != nil {
		return TestSMSResult{}, fmt.Errorf("%w: a valid phone number is required", ErrInvalidRequest)
	}
	body := strings.TrimSpace(in.Body)
	if body == "" {
		body = defaultTestBodyTurkish
	}
	if len([]rune(body)) > maxBodyRunes {
		return TestSMSResult{}, fmt.Errorf("%w: message is too long", ErrInvalidRequest)
	}
	res, sendErr := s.send(ctx, p, row, to, body, sms.ClassTransactional)
	out := TestSMSResult{
		Status: model.OutboundStatusSent, Provider: provider, Recipient: sms.MaskPhone(to),
		ProviderMessageID: res.MessageID, ProviderStatus: res.Status, Segments: sms.Estimate(body, provider),
	}
	if sendErr != nil {
		out.Status = model.OutboundStatusFailed
		out.ErrorCode = model.ErrorCodeOf(sendErr)
		out.ErrorMessage = publicMessage(sendErr)
	}
	if s.log != nil {
		s.log.LogSMSTest(ctx, orgID, to, res, sendErr)
	}
	s.record(ctx, actorID, ActionTestSent, row, map[string]any{
		"provider": provider, "phone": sms.MaskPhone(to), "status": out.Status, "error_code": out.ErrorCode,
	})
	return out, nil
}

// Available reports whether the organization has an active SMS provider.
func (s *Service) Available(ctx context.Context, orgID int64) (bool, error) {
	row, err := s.q.GetActiveSMSProviderAccount(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	_, ok := s.providers[row.Provider]
	return ok, nil
}

// Deliver sends one SMS through the organization's active provider.
// Errors are *model.SendError (classified, retryable only when nothing left).
func (s *Service) Deliver(ctx context.Context, orgID int64, phone, body, class string) (model.SMSDelivery, error) {
	row, err := s.q.GetActiveSMSProviderAccount(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.SMSDelivery{}, model.NewSendError(model.ErrCodeSMSNotConfigured, false, errors.New("no active sms provider"))
	}
	if err != nil {
		return model.SMSDelivery{}, fmt.Errorf("sms account: %w", err)
	}
	p, ok := s.providers[row.Provider]
	if !ok {
		return model.SMSDelivery{}, model.NewSendError(model.ErrCodeSMSNotConfigured, false, fmt.Errorf("sms provider %s unavailable", row.Provider))
	}
	to, err := sms.NormalizeE164(phone)
	if err != nil {
		return model.SMSDelivery{Provider: row.Provider}, model.NewSendError(model.ErrCodeInvalidRecipient, false, err)
	}
	if strings.TrimSpace(body) == "" {
		return model.SMSDelivery{Provider: row.Provider}, model.NewSendError(model.ErrCodeTemplateMissing, false, errors.New("empty sms body"))
	}
	return s.send(ctx, p, row, to, body, class)
}

func (s *Service) send(ctx context.Context, p sms.Provider, row db.SmsProviderAccount, to, body, class string) (model.SMSDelivery, error) {
	out := model.SMSDelivery{Provider: row.Provider, To: to, Segments: sms.Estimate(body, row.Provider).Segments}
	if out.Segments < 1 {
		out.Segments = 1
	}
	if err := s.gate(ctx, row.OrganizationID, int64(out.Segments)); err != nil {
		return out, err
	}
	creds, err := s.open(row)
	if err != nil {
		return out, model.NewSendError(model.ErrCodeSMSNotConfigured, false, err)
	}
	sctx, cancel := context.WithTimeout(ctx, sendTimeout)
	defer cancel()
	res, err := p.Send(sctx, creds, sms.Message{To: to, Body: body, Sender: row.Sender, Class: class})
	out.MessageID, out.Status = res.MessageID, res.Status
	if err != nil {
		return out, Classify(err)
	}
	if s.ent != nil {
		_ = s.ent.Consume(ctx, row.OrganizationID, FeatureSMSMonthly, int64(out.Segments))
	}
	return out, nil
}

// gate refuses a send the plan does not allow: sms.enabled off, or
// sms.monthly without room for the message's parts.
func (s *Service) gate(ctx context.Context, orgID, segments int64) error {
	if s.ent == nil {
		return nil
	}
	on, err := s.ent.Enabled(ctx, orgID, FeatureSMSEnabled)
	if err != nil {
		return fmt.Errorf("sms entitlement: %w", err)
	}
	if !on {
		return model.NewSendError(model.ErrCodeFeatureNotEntitled, false, entitlements.ErrFeatureDisabled)
	}
	if _, err := s.ent.Check(ctx, orgID, FeatureSMSMonthly, segments); err != nil {
		if errors.Is(err, entitlements.ErrLimitReached) {
			return model.NewSendError(model.ErrCodeQuotaExceeded, false, err)
		}
		return fmt.Errorf("sms quota: %w", err)
	}
	return nil
}

// Classify maps a provider error to a messaging send error.
func Classify(err error) *model.SendError {
	if err == nil {
		return nil
	}
	var se *model.SendError
	if errors.As(err, &se) {
		return se
	}
	if rej, ok := sms.AsRejected(err); ok {
		switch {
		case rej.Auth:
			return model.NewSendError(model.ErrCodeSMSAuthFailed, false, err)
		case rej.InvalidNumber:
			return model.NewSendError(model.ErrCodeInvalidRecipient, false, err)
		default:
			return model.NewSendError(model.ErrCodeSMSRejected, rej.Retryable, err)
		}
	}
	if sms.IsUnavailable(err) {
		return model.NewSendError(model.ErrCodeSMSUnavailable, true, err)
	}
	if sms.IsUncertain(err) {
		return model.NewSendError(model.ErrCodeSMSOutcomeUnknown, false, err)
	}
	if errors.Is(err, sms.ErrMissingField) {
		return model.NewSendError(model.ErrCodeSMSNotConfigured, false, err)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return model.NewSendError(model.ErrCodeSMSOutcomeUnknown, false, err)
	}
	return model.NewSendError(model.ErrCodeSendFailed, false, err)
}

// publicMessage is the provider's explanation without request details.
func publicMessage(err error) string {
	if rej, ok := sms.AsRejected(err); ok {
		return rej.Message
	}
	switch Classify(err).Code {
	case model.ErrCodeSMSUnavailable:
		return "provider unreachable"
	case model.ErrCodeSMSOutcomeUnknown:
		return "provider did not confirm the request"
	case model.ErrCodeSMSNotConfigured:
		return "sms provider is not configured"
	case model.ErrCodeFeatureNotEntitled:
		return "sms is not included in the plan"
	case model.ErrCodeQuotaExceeded:
		return "monthly sms quota reached"
	}
	return "send failed"
}

func (s *Service) record(ctx context.Context, actorID *int64, action string, row db.SmsProviderAccount, payload map[string]any) {
	if s.act == nil {
		return
	}
	id := row.Uuid
	s.act.Record(ctx, actorID, action, ActivityResource, &id, payload, nil)
}

func mapAccount(r db.SmsProviderAccount) Account {
	a := Account{
		UUID: r.Uuid, Provider: r.Provider, Sender: r.Sender, IsActive: r.IsActive,
		Status: r.Status, LastError: r.LastError, CredentialHints: map[string]string{},
	}
	_ = json.Unmarshal(r.CredentialHints, &a.CredentialHints)
	if r.LastCheckedAt.Valid {
		t := r.LastCheckedAt.Time
		a.LastCheckedAt = &t
	}
	if r.CreatedAt.Valid {
		a.CreatedAt = r.CreatedAt.Time
	}
	if r.UpdatedAt.Valid {
		a.UpdatedAt = r.UpdatedAt.Time
	}
	return a
}

func optInt8(id *int64) pgtype.Int8 {
	if id == nil {
		return pgtype.Int8{}
	}
	return pgtype.Int8{Int64: *id, Valid: true}
}
