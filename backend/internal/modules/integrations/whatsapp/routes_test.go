package whatsapp

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	whatsapphandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/handler"
	whatsappusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/usecase"
	messagingcloud "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/cloud"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

type routeRepo struct{ row db.PlatformWhatsappSetting }

func (r *routeRepo) GetPlatformWhatsAppSettings(context.Context) (db.PlatformWhatsappSetting, error) {
	return r.row, nil
}

func (r *routeRepo) UpdatePlatformWhatsAppSettings(_ context.Context, p db.UpdatePlatformWhatsAppSettingsParams) (db.PlatformWhatsappSetting, error) {
	if p.Provider.Valid {
		r.row.Provider = p.Provider.String
	}
	return r.row, nil
}

// claimsLoader grants the read/write permissions to every caller; super admin
// comes from the token claims.
type claimsLoader struct{}

func (claimsLoader) LoadPrincipal(_ *http.Request, c jwt.Claims) (authctx.Principal, error) {
	return authctx.Principal{
		UserID:       uuid.MustParse(c.Subject),
		IsSuperAdmin: c.IsSuperAdmin,
		Permissions:  []string{rbac.PermPlatformIntegrationsWhatsAppRead, rbac.PermPlatformIntegrationsWhatsAppWrite},
	}, nil
}

func setup(t *testing.T) (*http.ServeMux, *jwt.Manager) {
	t.Helper()
	tokens, err := jwt.NewManager("test-access-secret-test-access-secret", time.Minute, time.Hour)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	box, err := crypto.NewSecretBox(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatalf("NewSecretBox: %v", err)
	}
	enc, _ := box.Encrypt("token-plain")
	repo := &routeRepo{row: db.PlatformWhatsappSetting{ID: 1, Provider: "cloud", PhoneNumberID: "p1", ApiVersion: "v26.0", AccessTokenEnc: []byte(enc)}}
	svc := whatsappusecase.New(repo, box, "https://app.example.test")
	mux := http.NewServeMux()
	RegisterRoutes(mux, whatsapphandler.New(svc, nil), tokens, claimsLoader{})
	return mux, tokens
}

func bearer(t *testing.T, tokens *jwt.Manager, superAdmin bool) string {
	t.Helper()
	tok, _, err := tokens.IssueAccess(jwt.AccessInput{UserID: uuid.New(), IsSuperAdmin: superAdmin, SessionID: uuid.New()})
	if err != nil {
		t.Fatalf("IssueAccess: %v", err)
	}
	return "Bearer " + tok
}

func TestWhatsAppRoutesAccess(t *testing.T) {
	mux, tokens := setup(t)
	cases := []struct {
		name, method, body string
		auth               string
		want               int
	}{
		{"get anonymous", http.MethodGet, "", "", http.StatusUnauthorized},
		{"get non super admin", http.MethodGet, "", bearer(t, tokens, false), http.StatusForbidden},
		{"get super admin", http.MethodGet, "", bearer(t, tokens, true), http.StatusOK},
		{"patch non super admin", http.MethodPatch, `{"provider":"none"}`, bearer(t, tokens, false), http.StatusForbidden},
		{"patch invalid provider", http.MethodPatch, `{"provider":"twilio"}`, bearer(t, tokens, true), http.StatusBadRequest},
		{"patch super admin", http.MethodPatch, `{"provider":"none"}`, bearer(t, tokens, true), http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/v1/platform/integrations/whatsapp", strings.NewReader(tc.body))
			if tc.auth != "" {
				req.Header.Set("Authorization", tc.auth)
			}
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d; body %s", rec.Code, tc.want, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "token-plain") {
				t.Fatalf("response leaks secret: %s", rec.Body.String())
			}
		})
	}
}

func TestWhatsAppGetReturnsWebhookURL(t *testing.T) {
	mux, tokens := setup(t)
	req := httptest.NewRequest(http.MethodGet, "/v1/platform/integrations/whatsapp", nil)
	req.Header.Set("Authorization", bearer(t, tokens, true))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, `"webhook_url":"https://app.example.test/api/v1/public/whatsapp/webhook"`) ||
		!strings.Contains(body, `"access_token_configured":true`) {
		t.Fatalf("unexpected body: %s", body)
	}
}

type routeTemplates struct {
	rows map[string]db.WhatsappCloudTemplate
}

func (r *routeTemplates) ListWhatsAppCloudTemplates(context.Context) ([]db.WhatsappCloudTemplate, error) {
	return nil, nil
}

func (r *routeTemplates) EnsureWhatsAppCloudTemplate(_ context.Context, p db.EnsureWhatsAppCloudTemplateParams) (db.WhatsappCloudTemplate, error) {
	row := db.WhatsappCloudTemplate{Key: p.Key, MetaName: p.MetaName, Language: p.Language, Category: p.Category, Status: "not_submitted"}
	r.rows[p.Key] = row
	return row, nil
}

func (r *routeTemplates) SetWhatsAppCloudTemplateOverride(_ context.Context, p db.SetWhatsAppCloudTemplateOverrideParams) (db.WhatsappCloudTemplate, error) {
	row := r.rows[p.Key]
	row.OverrideName = p.OverrideName
	r.rows[p.Key] = row
	return row, nil
}

func (r *routeTemplates) UpdateWhatsAppCloudTemplateStatus(_ context.Context, p db.UpdateWhatsAppCloudTemplateStatusParams) (db.WhatsappCloudTemplate, error) {
	row := r.rows[p.Key]
	row.Status = p.Status
	r.rows[p.Key] = row
	return row, nil
}

type routeAPI struct{}

func (routeAPI) CreateTemplate(context.Context, messagingcloud.TemplateDefinition) (messagingcloud.CreatedTemplate, error) {
	return messagingcloud.CreatedTemplate{ID: "1", Status: "PENDING"}, nil
}

func (routeAPI) ListTemplates(context.Context) ([]messagingcloud.RemoteTemplate, error) {
	return nil, nil
}

type routeSender struct{ testErr error }

func (routeSender) ConnectPlatformWhatsApp(context.Context) error    { return nil }
func (routeSender) DisconnectPlatformWhatsApp(context.Context) error { return nil }
func (s routeSender) SendPlatformTest(_ context.Context, in messagingusecase.PlatformTestInput) (messagingusecase.PlatformTestResult, error) {
	if s.testErr != nil {
		return messagingusecase.PlatformTestResult{}, s.testErr
	}
	return messagingusecase.PlatformTestResult{SenderKind: "platform_cloud", TemplateName: "hello_world", ProviderReference: "wamid.T"}, nil
}

func setupPlatform(t *testing.T, sender routeSender) (*http.ServeMux, *jwt.Manager) {
	t.Helper()
	tokens, err := jwt.NewManager("test-access-secret-test-access-secret", time.Minute, time.Hour)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	box, err := crypto.NewSecretBox(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatalf("NewSecretBox: %v", err)
	}
	svc := whatsappusecase.New(&routeRepo{row: db.PlatformWhatsappSetting{ID: 1, Provider: "whatsmeow", WmStatus: "qr_pending", WmQrCode: "QR-CODE"}}, box, "")
	h := whatsapphandler.New(svc, nil).WithPlatform(
		whatsappusecase.NewTemplates(&routeTemplates{rows: map[string]db.WhatsappCloudTemplate{}}, routeAPI{}), sender)
	mux := http.NewServeMux()
	RegisterRoutes(mux, h, tokens, claimsLoader{})
	return mux, tokens
}

func TestPlatformWhatsAppRoutesAccess(t *testing.T) {
	mux, tokens := setupPlatform(t, routeSender{})
	routes := []struct{ method, path, body string }{
		{http.MethodPost, "/v1/platform/integrations/whatsapp/test", `{"phone":"905321112233"}`},
		{http.MethodPost, "/v1/platform/integrations/whatsapp/session/connect", ``},
		{http.MethodDelete, "/v1/platform/integrations/whatsapp/session", ``},
		{http.MethodGet, "/v1/platform/integrations/whatsapp/templates", ``},
		{http.MethodPost, "/v1/platform/integrations/whatsapp/templates/submit", `{"keys":["job.ready"]}`},
		{http.MethodPost, "/v1/platform/integrations/whatsapp/templates/sync", ``},
		{http.MethodPatch, "/v1/platform/integrations/whatsapp/templates/job.ready", `{"override_name":"my_tpl"}`},
	}
	for _, rt := range routes {
		for _, c := range []struct {
			name string
			auth string
			want int
		}{
			{"anonymous", "", http.StatusUnauthorized},
			{"non super admin", bearer(t, tokens, false), http.StatusForbidden},
			{"super admin", bearer(t, tokens, true), http.StatusOK},
		} {
			t.Run(rt.method+" "+rt.path+" "+c.name, func(t *testing.T) {
				req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(rt.body))
				if c.auth != "" {
					req.Header.Set("Authorization", c.auth)
				}
				rec := httptest.NewRecorder()
				mux.ServeHTTP(rec, req)
				if rec.Code != c.want {
					t.Fatalf("status = %d want %d: %s", rec.Code, c.want, rec.Body.String())
				}
			})
		}
	}
}

func TestPlatformConnectReturnsPolledQR(t *testing.T) {
	mux, tokens := setupPlatform(t, routeSender{})
	req := httptest.NewRequest(http.MethodPost, "/v1/platform/integrations/whatsapp/session/connect", nil)
	req.Header.Set("Authorization", bearer(t, tokens, true))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `"whatsmeow_qr_code":"QR-CODE"`) {
		t.Fatalf("body: %s", rec.Body.String())
	}
}

func TestPlatformTestSendMapsSendError(t *testing.T) {
	mux, tokens := setupPlatform(t, routeSender{testErr: messagingmodel.NewSendError(messagingmodel.ErrCodeCloudAuthFailed, false, errors.New("bad token"))})
	req := httptest.NewRequest(http.MethodPost, "/v1/platform/integrations/whatsapp/test", strings.NewReader(`{"phone":"905321112233"}`))
	req.Header.Set("Authorization", bearer(t, tokens, true))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"code":"CLOUD_AUTH_FAILED"`) {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}
