package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/piusalfred/whatsapp"
	"github.com/piusalfred/whatsapp/config"
)

// Provider values for the platform sender.
const (
	ProviderNone      = "none"
	ProviderWhatsmeow = "whatsmeow"
	ProviderCloud     = "cloud"
)

// WebhookPath is the browser-facing (same-origin proxy) path Meta calls.
const WebhookPath = "/api/v1/public/whatsapp/webhook"

var (
	ErrInvalidRequest = errors.New("invalid request")
	ErrNotConfigured  = errors.New("whatsapp cloud api is not configured")
)

type settingsStore interface {
	GetPlatformWhatsAppSettings(ctx context.Context) (db.PlatformWhatsappSetting, error)
	UpdatePlatformWhatsAppSettings(ctx context.Context, arg db.UpdatePlatformWhatsAppSettingsParams) (db.PlatformWhatsappSetting, error)
}

// Service manages the platform_whatsapp_settings singleton.
type Service struct {
	q           settingsStore
	box         *crypto.SecretBox
	frontendURL string
}

// New creates the platform WhatsApp settings service. frontendURL is the
// public frontend origin used to build the webhook URL.
func New(q settingsStore, box *crypto.SecretBox, frontendURL string) *Service {
	return &Service{q: q, box: box, frontendURL: strings.TrimRight(strings.TrimSpace(frontendURL), "/")}
}

// Settings is the public admin payload (no secret values).
type Settings struct {
	Provider                     string `json:"provider"`
	AppID                        string `json:"app_id"`
	WabaID                       string `json:"waba_id"`
	PhoneNumberID                string `json:"phone_number_id"`
	APIVersion                   string `json:"api_version"`
	DisplayPhone                 string `json:"display_phone"`
	AccessTokenConfigured        bool   `json:"access_token_configured"`
	AppSecretConfigured          bool   `json:"app_secret_configured"`
	WebhookVerifyTokenConfigured bool   `json:"webhook_verify_token_configured"`
	WebhookURL                   string `json:"webhook_url"`
	WhatsmeowStatus              string `json:"whatsmeow_status"`
	WhatsmeowPhone               string `json:"whatsmeow_phone"`
	// WhatsmeowQRCode is the pairing QR while whatsmeow_status is
	// qr_pending (polled like the tenant session QR).
	WhatsmeowQRCode      string     `json:"whatsmeow_qr_code,omitempty"`
	WhatsmeowQRExpiresAt *time.Time `json:"whatsmeow_qr_expires_at,omitempty"`
	WhatsmeowError       string     `json:"whatsmeow_error,omitempty"`
	UpdatedAt            *time.Time `json:"updated_at"`
}

// PatchInput is a partial update; nil (or empty secret) keeps the stored value.
type PatchInput struct {
	Provider           *string `json:"provider"`
	AppID              *string `json:"app_id"`
	WabaID             *string `json:"waba_id"`
	PhoneNumberID      *string `json:"phone_number_id"`
	APIVersion         *string `json:"api_version"`
	DisplayPhone       *string `json:"display_phone"`
	AccessToken        *string `json:"access_token"`
	AppSecret          *string `json:"app_secret"`
	WebhookVerifyToken *string `json:"webhook_verify_token"`
}

func configured(enc []byte) bool { return len(enc) > 0 }

// WebhookURL returns the public URL Meta must call.
func (s *Service) WebhookURL() string { return s.frontendURL + WebhookPath }

func (s *Service) mapSettings(row db.PlatformWhatsappSetting) Settings {
	out := Settings{
		Provider:                     row.Provider,
		AppID:                        row.AppID,
		WabaID:                       row.WabaID,
		PhoneNumberID:                row.PhoneNumberID,
		APIVersion:                   row.ApiVersion,
		DisplayPhone:                 row.DisplayPhone,
		AccessTokenConfigured:        configured(row.AccessTokenEnc),
		AppSecretConfigured:          configured(row.AppSecretEnc),
		WebhookVerifyTokenConfigured: configured(row.WebhookVerifyTokenEnc),
		WebhookURL:                   s.WebhookURL(),
		WhatsmeowStatus:              row.WmStatus,
		WhatsmeowPhone:               row.WmPhone,
		WhatsmeowQRCode:              row.WmQrCode,
		WhatsmeowError:               row.WmError,
	}
	if row.WmQrExpiresAt.Valid {
		t := row.WmQrExpiresAt.Time
		out.WhatsmeowQRExpiresAt = &t
	}
	if row.UpdatedAt.Valid {
		t := row.UpdatedAt.Time
		out.UpdatedAt = &t
	}
	return out
}

// Get returns masked settings for super admins.
func (s *Service) Get(ctx context.Context) (Settings, error) {
	row, err := s.q.GetPlatformWhatsAppSettings(ctx)
	if err != nil {
		return Settings{}, err
	}
	return s.mapSettings(row), nil
}

func validProvider(p string) bool {
	switch p {
	case ProviderNone, ProviderWhatsmeow, ProviderCloud:
		return true
	default:
		return false
	}
}

func optText(v *string) pgtype.Text {
	if v == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: strings.TrimSpace(*v), Valid: true}
}

// encryptOpt returns ciphertext for a non-empty secret, nil (keep) otherwise.
func (s *Service) encryptOpt(v *string) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*v)
	if trimmed == "" {
		return nil, nil
	}
	enc, err := s.box.Encrypt(trimmed)
	if err != nil {
		return nil, err
	}
	return []byte(enc), nil
}

// Patch updates platform WhatsApp settings. actorID is the internal user id.
func (s *Service) Patch(ctx context.Context, actorID *int64, in PatchInput) (Settings, error) {
	current, err := s.q.GetPlatformWhatsAppSettings(ctx)
	if err != nil {
		return Settings{}, err
	}

	params := db.UpdatePlatformWhatsAppSettingsParams{
		Provider:      optText(in.Provider),
		AppID:         optText(in.AppID),
		WabaID:        optText(in.WabaID),
		PhoneNumberID: optText(in.PhoneNumberID),
		ApiVersion:    optText(in.APIVersion),
		DisplayPhone:  optText(in.DisplayPhone),
	}
	if actorID != nil {
		params.UpdatedBy = pgtype.Int8{Int64: *actorID, Valid: true}
	}
	if params.Provider.Valid && !validProvider(params.Provider.String) {
		return Settings{}, fmt.Errorf("%w: provider must be one of none, whatsmeow, cloud", ErrInvalidRequest)
	}
	if params.ApiVersion.Valid && !whatsapp.IsCorrectAPIVersion(params.ApiVersion.String) {
		return Settings{}, fmt.Errorf("%w: api_version must look like v26.0 (minimum %s)",
			ErrInvalidRequest, whatsapp.LowestSupportedAPIVersion)
	}
	if params.AccessTokenEnc, err = s.encryptOpt(in.AccessToken); err != nil {
		return Settings{}, err
	}
	if params.AppSecretEnc, err = s.encryptOpt(in.AppSecret); err != nil {
		return Settings{}, err
	}
	if params.WebhookVerifyTokenEnc, err = s.encryptOpt(in.WebhookVerifyToken); err != nil {
		return Settings{}, err
	}

	nextProvider := current.Provider
	if params.Provider.Valid {
		nextProvider = params.Provider.String
	}
	nextPhoneID := current.PhoneNumberID
	if params.PhoneNumberID.Valid {
		nextPhoneID = params.PhoneNumberID.String
	}
	hasToken := configured(current.AccessTokenEnc) || params.AccessTokenEnc != nil
	if nextProvider == ProviderCloud && (nextPhoneID == "" || !hasToken) {
		return Settings{}, fmt.Errorf("%w: phone_number_id and access_token are required for the cloud provider", ErrInvalidRequest)
	}

	row, err := s.q.UpdatePlatformWhatsAppSettings(ctx, params)
	if err != nil {
		return Settings{}, err
	}
	return s.mapSettings(row), nil
}

// CloudConfigReader returns a config.ReaderFunc that loads and decrypts the
// stored Cloud API credentials on every call, so panel edits apply without a
// restart.
func (s *Service) CloudConfigReader() config.ReaderFunc {
	return func(ctx context.Context) (*config.Config, error) {
		row, err := s.q.GetPlatformWhatsAppSettings(ctx)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(row.PhoneNumberID) == "" || !configured(row.AccessTokenEnc) {
			return nil, ErrNotConfigured
		}
		token, err := s.box.Decrypt(string(row.AccessTokenEnc))
		if err != nil {
			return nil, fmt.Errorf("decrypt access token: %w", err)
		}
		// The app secret is only needed for webhooks / appsecret_proof:
		// sending works without it, so an unset secret stays empty.
		appSecret := ""
		if configured(row.AppSecretEnc) {
			if appSecret, err = s.box.Decrypt(string(row.AppSecretEnc)); err != nil {
				return nil, fmt.Errorf("decrypt app secret: %w", err)
			}
		}
		return &config.Config{
			BaseURL:           whatsapp.BaseURL,
			APIVersion:        row.ApiVersion,
			AccessToken:       token,
			PhoneNumberID:     row.PhoneNumberID,
			BusinessAccountID: row.WabaID,
			AppSecret:         appSecret,
			AppID:             row.AppID,
		}, nil
	}
}
