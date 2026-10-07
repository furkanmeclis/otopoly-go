package whatsapp

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	whatsapphandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/handler"
	whatsappusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
)

const (
	hookSecret = "app-secret-routes"
	hookVerify = "verify-token-routes"
)

type hookStore struct {
	row     db.PlatformWhatsappSetting
	applied []db.ApplyOutboundDeliveryStatusParams
	fail    bool
}

func (h *hookStore) GetPlatformWhatsAppSettings(context.Context) (db.PlatformWhatsappSetting, error) {
	return h.row, nil
}

func (h *hookStore) ApplyOutboundDeliveryStatus(_ context.Context, arg db.ApplyOutboundDeliveryStatusParams) (int64, error) {
	h.applied = append(h.applied, arg)
	if h.fail {
		return 0, io.ErrUnexpectedEOF
	}
	return 1, nil
}

func (h *hookStore) UpdateWhatsAppCloudTemplateStatusByMetaID(context.Context, db.UpdateWhatsAppCloudTemplateStatusByMetaIDParams) (int64, error) {
	return 0, nil
}

func (h *hookStore) UpdateWhatsAppCloudTemplateStatusByName(context.Context, db.UpdateWhatsAppCloudTemplateStatusByNameParams) (int64, error) {
	return 0, nil
}

type denyLimiter struct{ calls int }

func (d *denyLimiter) Allow(context.Context, string, string, int, time.Duration) (bool, time.Duration) {
	d.calls++
	return false, time.Minute
}

func hookMux(t *testing.T, withAppSecret bool, limiter whatsapphandler.RateLimiter) (*http.ServeMux, *hookStore) {
	t.Helper()
	box, err := crypto.NewSecretBox(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	verify, _ := box.Encrypt(hookVerify)
	store := &hookStore{row: db.PlatformWhatsappSetting{WebhookVerifyTokenEnc: []byte(verify)}}
	if withAppSecret {
		secret, _ := box.Encrypt(hookSecret)
		store.row.AppSecretEnc = []byte(secret)
	}
	mux := http.NewServeMux()
	log := slog.New(slog.DiscardHandler)
	RegisterWebhookRoutes(mux, whatsapphandler.NewWebhookHandler(whatsappusecase.NewWebhook(store, box, log), limiter, log))
	return mux, store
}

func hookSign(body string) string {
	mac := hmac.New(sha256.New, []byte(hookSecret))
	mac.Write([]byte(body))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestWebhookGetHandshake(t *testing.T) {
	mux, _ := hookMux(t, true, nil)
	get := func(q url.Values) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/public/whatsapp/webhook?"+q.Encode(), nil))
		return rec
	}
	rec := get(url.Values{"hub.mode": {"subscribe"}, "hub.verify_token": {hookVerify}, "hub.challenge": {"1158201444"}})
	if rec.Code != http.StatusOK || rec.Body.String() != "1158201444" || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("ok: %d %q %q", rec.Code, rec.Body.String(), rec.Header().Get("Content-Type"))
	}
	for name, q := range map[string]url.Values{
		"wrong token":    {"hub.mode": {"subscribe"}, "hub.verify_token": {"nope"}, "hub.challenge": {"1"}},
		"missing params": {},
		"no challenge":   {"hub.mode": {"subscribe"}, "hub.verify_token": {hookVerify}},
	} {
		if rec := get(q); rec.Code != http.StatusForbidden || strings.Contains(rec.Body.String(), hookVerify) {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
}

const hookStatusBody = `{"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{"statuses":[{"id":"wamid.X","status":"read","timestamp":"1791374400"}]}}]}]}`

func postHook(mux *http.ServeMux, body, signature string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/public/whatsapp/webhook", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if signature != "" {
		req.Header.Set("X-Hub-Signature-256", signature)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestWebhookPostSignature(t *testing.T) {
	mux, store := hookMux(t, true, nil)
	if rec := postHook(mux, hookStatusBody, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing signature: %d", rec.Code)
	}
	if rec := postHook(mux, hookStatusBody, "sha256="+strings.Repeat("0", 64)); rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature: %d", rec.Code)
	}
	if len(store.applied) != 0 {
		t.Fatalf("nothing may be processed before the signature check: %+v", store.applied)
	}
	if rec := postHook(mux, hookStatusBody, hookSign(hookStatusBody)); rec.Code != http.StatusOK {
		t.Fatalf("valid: %d %s", rec.Code, rec.Body.String())
	}
	if len(store.applied) != 1 || store.applied[0].ProviderReference != "wamid.X" || store.applied[0].DeliveryStatus != "read" {
		t.Fatalf("applied: %+v", store.applied)
	}

	noSecret, store2 := hookMux(t, false, nil)
	if rec := postHook(noSecret, hookStatusBody, hookSign(hookStatusBody)); rec.Code != http.StatusUnauthorized || len(store2.applied) != 0 {
		t.Fatalf("missing app secret: %d %+v", rec.Code, store2.applied)
	}
}

func TestWebhookPostAlways200AfterValidSignature(t *testing.T) {
	mux, store := hookMux(t, true, nil)
	store.fail = true
	if rec := postHook(mux, hookStatusBody, hookSign(hookStatusBody)); rec.Code != http.StatusOK {
		t.Fatalf("store error must still ack: %d", rec.Code)
	}
	garbage := `{"entry":"x"}`
	if rec := postHook(mux, garbage, hookSign(garbage)); rec.Code != http.StatusOK {
		t.Fatalf("undecodable payload must still ack: %d", rec.Code)
	}
}

func TestWebhookPostBodyLimit(t *testing.T) {
	mux, store := hookMux(t, true, nil)
	big := `{"pad":"` + strings.Repeat("a", whatsapphandler.MaxWebhookBody) + `"}`
	if rec := postHook(mux, big, hookSign(big)); rec.Code != http.StatusRequestEntityTooLarge || len(store.applied) != 0 {
		t.Fatalf("oversized body: %d", rec.Code)
	}
}

func TestWebhookRateLimited(t *testing.T) {
	lim := &denyLimiter{}
	mux, store := hookMux(t, true, lim)
	if rec := postHook(mux, hookStatusBody, hookSign(hookStatusBody)); rec.Code != http.StatusTooManyRequests || len(store.applied) != 0 {
		t.Fatalf("post: %d", rec.Code)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/public/whatsapp/webhook?hub.mode=subscribe", nil))
	if rec.Code != http.StatusTooManyRequests || lim.calls != 2 {
		t.Fatalf("get: %d calls=%d", rec.Code, lim.calls)
	}
}
