package usecase

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
	"github.com/jackc/pgx/v5/pgtype"
)

type whatsappSettingsRepo struct {
	row     db.PlatformWhatsappSetting
	updates int
}

func newRepo() *whatsappSettingsRepo {
	return &whatsappSettingsRepo{row: db.PlatformWhatsappSetting{ID: 1, Provider: ProviderNone, ApiVersion: "v26.0", WmStatus: "disconnected"}}
}

func (r *whatsappSettingsRepo) GetPlatformWhatsAppSettings(_ context.Context) (db.PlatformWhatsappSetting, error) {
	return r.row, nil
}

// UpdatePlatformWhatsAppSettings mirrors the COALESCE semantics of the SQL.
func (r *whatsappSettingsRepo) UpdatePlatformWhatsAppSettings(_ context.Context, p db.UpdatePlatformWhatsAppSettingsParams) (db.PlatformWhatsappSetting, error) {
	r.updates++
	setText := func(dst *string, v pgtype.Text) {
		if v.Valid {
			*dst = v.String
		}
	}
	setText(&r.row.Provider, p.Provider)
	setText(&r.row.AppID, p.AppID)
	setText(&r.row.WabaID, p.WabaID)
	setText(&r.row.PhoneNumberID, p.PhoneNumberID)
	setText(&r.row.ApiVersion, p.ApiVersion)
	setText(&r.row.DisplayPhone, p.DisplayPhone)
	if p.AccessTokenEnc != nil {
		r.row.AccessTokenEnc = p.AccessTokenEnc
	}
	if p.AppSecretEnc != nil {
		r.row.AppSecretEnc = p.AppSecretEnc
	}
	if p.WebhookVerifyTokenEnc != nil {
		r.row.WebhookVerifyTokenEnc = p.WebhookVerifyTokenEnc
	}
	r.row.UpdatedBy = p.UpdatedBy
	return r.row, nil
}

func testBox(t *testing.T) *crypto.SecretBox {
	t.Helper()
	raw := make([]byte, 32)
	for i := range raw {
		raw[i] = byte(i + 23)
	}
	box, err := crypto.NewSecretBox(base64.StdEncoding.EncodeToString(raw))
	if err != nil {
		t.Fatalf("NewSecretBox: %v", err)
	}
	return box
}

func ptr(s string) *string { return &s }

func cloudPatch() PatchInput {
	return PatchInput{
		Provider:           ptr(ProviderCloud),
		AppID:              ptr("app-1"),
		WabaID:             ptr("waba-1"),
		PhoneNumberID:      ptr("phone-id-1"),
		AccessToken:        ptr("token-plain"),
		AppSecret:          ptr("secret-plain"),
		WebhookVerifyToken: ptr("verify-plain"),
	}
}

func TestPatchStoresSecretsEncrypted(t *testing.T) {
	repo := newRepo()
	box := testBox(t)
	svc := New(repo, box, "https://app.example.test")

	actor := int64(7)
	if _, err := svc.Patch(context.Background(), &actor, cloudPatch()); err != nil {
		t.Fatalf("Patch: %v", err)
	}
	for name, pair := range map[string]struct {
		enc   []byte
		plain string
	}{
		"access_token":         {repo.row.AccessTokenEnc, "token-plain"},
		"app_secret":           {repo.row.AppSecretEnc, "secret-plain"},
		"webhook_verify_token": {repo.row.WebhookVerifyTokenEnc, "verify-plain"},
	} {
		if len(pair.enc) == 0 {
			t.Fatalf("%s: not stored", name)
		}
		if bytes.Contains(pair.enc, []byte(pair.plain)) {
			t.Fatalf("%s: raw column contains plaintext", name)
		}
		got, err := box.Decrypt(string(pair.enc))
		if err != nil || got != pair.plain {
			t.Fatalf("%s: decrypt = %q, %v", name, got, err)
		}
	}
	if !repo.row.UpdatedBy.Valid || repo.row.UpdatedBy.Int64 != 7 {
		t.Fatalf("updated_by not recorded: %+v", repo.row.UpdatedBy)
	}
}

func TestGetMasksSecrets(t *testing.T) {
	repo := newRepo()
	svc := New(repo, testBox(t), "https://app.example.test/")
	if _, err := svc.Patch(context.Background(), nil, cloudPatch()); err != nil {
		t.Fatalf("Patch: %v", err)
	}

	got, err := svc.Get(context.Background())
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !got.AccessTokenConfigured || !got.AppSecretConfigured || !got.WebhookVerifyTokenConfigured {
		t.Fatalf("expected configured flags, got %+v", got)
	}
	if got.Provider != ProviderCloud || got.PhoneNumberID != "phone-id-1" || got.WabaID != "waba-1" {
		t.Fatalf("unexpected settings: %+v", got)
	}
	if got.WebhookURL != "https://app.example.test/api/v1/public/whatsapp/webhook" {
		t.Fatalf("webhook url = %q", got.WebhookURL)
	}
	raw, _ := json.Marshal(got)
	for _, plain := range []string{"token-plain", "secret-plain", "verify-plain"} {
		if strings.Contains(string(raw), plain) {
			t.Fatalf("response leaks %q: %s", plain, raw)
		}
	}
}

func TestPatchOmittedSecretKeepsValue(t *testing.T) {
	repo := newRepo()
	box := testBox(t)
	svc := New(repo, box, "https://app.example.test")
	if _, err := svc.Patch(context.Background(), nil, cloudPatch()); err != nil {
		t.Fatalf("Patch: %v", err)
	}
	before := append([]byte(nil), repo.row.AccessTokenEnc...)

	// Omitted and empty secret fields both keep the stored ciphertext.
	if _, err := svc.Patch(context.Background(), nil, PatchInput{DisplayPhone: ptr("+90 555"), AppSecret: ptr("  ")}); err != nil {
		t.Fatalf("Patch: %v", err)
	}
	if !bytes.Equal(before, repo.row.AccessTokenEnc) {
		t.Fatal("access token changed although omitted")
	}
	if s, _ := box.Decrypt(string(repo.row.AppSecretEnc)); s != "secret-plain" {
		t.Fatalf("app secret changed: %q", s)
	}
	if repo.row.DisplayPhone != "+90 555" || repo.row.Provider != ProviderCloud {
		t.Fatalf("unexpected row: %+v", repo.row)
	}
}

func TestPatchRejectsInvalidProvider(t *testing.T) {
	repo := newRepo()
	svc := New(repo, testBox(t), "")
	_, err := svc.Patch(context.Background(), nil, PatchInput{Provider: ptr("twilio")})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("expected ErrInvalidRequest, got %v", err)
	}
	if repo.updates != 0 {
		t.Fatal("store must not be updated on validation error")
	}
}

func TestPatchRejectsInvalidAPIVersion(t *testing.T) {
	svc := New(newRepo(), testBox(t), "")
	_, err := svc.Patch(context.Background(), nil, PatchInput{APIVersion: ptr("latest")})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("expected ErrInvalidRequest, got %v", err)
	}
}

func TestPatchCloudRequiresCredentials(t *testing.T) {
	svc := New(newRepo(), testBox(t), "")
	_, err := svc.Patch(context.Background(), nil, PatchInput{Provider: ptr(ProviderCloud), PhoneNumberID: ptr("phone-id-1")})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("expected ErrInvalidRequest without access token, got %v", err)
	}
}

func TestCloudConfigReaderDecrypts(t *testing.T) {
	repo := newRepo()
	svc := New(repo, testBox(t), "")
	in := cloudPatch()
	in.APIVersion = ptr("v25.0")
	if _, err := svc.Patch(context.Background(), nil, in); err != nil {
		t.Fatalf("Patch: %v", err)
	}

	conf, err := svc.CloudConfigReader().Read(context.Background())
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if conf.AccessToken != "token-plain" || conf.AppSecret != "secret-plain" {
		t.Fatalf("secrets not decrypted: %+v", conf)
	}
	if conf.PhoneNumberID != "phone-id-1" || conf.BusinessAccountID != "waba-1" || conf.AppID != "app-1" ||
		conf.APIVersion != "v25.0" || conf.BaseURL == "" {
		t.Fatalf("unexpected config: %+v", conf)
	}

	// Reads the row per call: a rotated token is picked up without restart.
	if _, err := svc.Patch(context.Background(), nil, PatchInput{AccessToken: ptr("token-rotated")}); err != nil {
		t.Fatalf("Patch: %v", err)
	}
	conf, err = svc.CloudConfigReader().Read(context.Background())
	if err != nil || conf.AccessToken != "token-rotated" {
		t.Fatalf("rotated token not read: %v %+v", err, conf)
	}
}

func TestCloudConfigReaderNotConfigured(t *testing.T) {
	svc := New(newRepo(), testBox(t), "")
	if _, err := svc.CloudConfigReader().Read(context.Background()); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
}
