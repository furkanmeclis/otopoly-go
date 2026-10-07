package whatsapp

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	whatsapphandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/handler"
	whatsappusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/usecase"
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
