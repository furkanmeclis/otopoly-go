package apns

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func testKey(t *testing.T) (string, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), key
}

func TestNewUnconfigured(t *testing.T) {
	c, err := New(Config{BundleID: "com.otopoly.app"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Configured() {
		t.Fatal("client without key must be unconfigured")
	}
	if _, err := c.SendLiveActivity(context.Background(), LiveActivity{Token: "ab"}); err != ErrNotConfigured {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
	if c.baseURL != ProductionURL {
		t.Fatalf("default host %s", c.baseURL)
	}
	sb, _ := New(Config{Environment: "sandbox"})
	if sb.baseURL != SandboxURL {
		t.Fatalf("sandbox host %s", sb.baseURL)
	}
}

func TestNewRejectsBadKey(t *testing.T) {
	if _, err := New(Config{KeyID: "K", TeamID: "T", BundleID: "b", PrivateKey: "nope"}); err == nil {
		t.Fatal("malformed key must fail")
	}
}

func TestSendLiveActivity(t *testing.T) {
	pemText, key := testKey(t)
	var calls atomic.Int32
	var gotHeaders http.Header
	var gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		gotHeaders = r.Header.Clone()
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.Header().Set("apns-id", "abc")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	now := time.Unix(1_800_000_000, 0)
	c, err := New(Config{
		KeyID: "KEY123", TeamID: "TEAM42", BundleID: "com.otopoly.app",
		PrivateKey: strings.ReplaceAll(pemText, "\n", `\n`), BaseURL: srv.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	c.SetClock(func() time.Time { return now })
	res, err := c.SendLiveActivity(context.Background(), LiveActivity{
		Token:         "a1b2c3d4e5f60718",
		Event:         EventEnd,
		ContentState:  map[string]string{"name": "JobActivity", "props": `{"v":1}`},
		DismissalDate: now.Add(15 * time.Minute),
		Alert:         &Alert{Title: "34 ABC 12", Body: "Car delivered"},
		HighPriority:  true,
	})
	if err != nil || !res.OK() || res.ID != "abc" {
		t.Fatalf("send: %+v %v", res, err)
	}
	if gotPath != "/3/device/a1b2c3d4e5f60718" {
		t.Fatalf("path %s", gotPath)
	}
	for k, want := range map[string]string{
		"apns-push-type": "liveactivity",
		"apns-topic":     "com.otopoly.app.push-type.liveactivity",
		"apns-priority":  "10",
	} {
		if got := gotHeaders.Get(k); got != want {
			t.Fatalf("%s = %q, want %q", k, got, want)
		}
	}
	auth := strings.TrimPrefix(gotHeaders.Get("authorization"), "bearer ")
	tok, err := jwt.Parse(auth, func(*jwt.Token) (any, error) { return &key.PublicKey, nil },
		jwt.WithValidMethods([]string{"ES256"}), jwt.WithoutClaimsValidation())
	if err != nil || !tok.Valid {
		t.Fatalf("provider token: %v", err)
	}
	if tok.Header["kid"] != "KEY123" {
		t.Fatalf("kid %v", tok.Header["kid"])
	}
	if iss, _ := tok.Claims.(jwt.MapClaims)["iss"].(string); iss != "TEAM42" {
		t.Fatalf("iss %v", iss)
	}
	aps := gotBody["aps"].(map[string]any)
	if aps["event"] != "end" || aps["timestamp"].(float64) != float64(now.Unix()) {
		t.Fatalf("aps %v", aps)
	}
	if aps["dismissal-date"].(float64) != float64(now.Add(15*time.Minute).Unix()) {
		t.Fatalf("dismissal %v", aps["dismissal-date"])
	}
	cs := aps["content-state"].(map[string]any)
	if cs["name"] != "JobActivity" || cs["props"] != `{"v":1}` {
		t.Fatalf("content-state %v", cs)
	}

	// Provider token is reused within its lifetime.
	_, _ = c.SendLiveActivity(context.Background(), LiveActivity{Token: "a1b2c3d4e5f60718", Event: EventUpdate, ContentState: map[string]string{}})
	if strings.TrimPrefix(gotHeaders.Get("authorization"), "bearer ") != auth {
		t.Fatal("provider token must be cached")
	}
	if gotHeaders.Get("apns-priority") != "5" {
		t.Fatal("low priority by default")
	}
	if calls.Load() != 2 {
		t.Fatalf("calls %d", calls.Load())
	}
}

func TestResultClassification(t *testing.T) {
	pemText, _ := testKey(t)
	status, reason := http.StatusGone, "Unregistered"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"reason":"` + reason + `"}`))
	}))
	defer srv.Close()
	c, err := New(Config{KeyID: "K", TeamID: "T", BundleID: "b", PrivateKey: pemText, BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	send := func() Result {
		res, err := c.SendLiveActivity(context.Background(), LiveActivity{Token: "abcdefabcdefabcd", Event: EventUpdate, ContentState: map[string]any{}})
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	if r := send(); !r.TokenInvalid() || r.Reason != "Unregistered" {
		t.Fatalf("410 must invalidate: %+v", r)
	}
	status, reason = http.StatusBadRequest, "BadDeviceToken"
	if r := send(); !r.TokenInvalid() {
		t.Fatalf("BadDeviceToken must invalidate: %+v", r)
	}
	status, reason = http.StatusTooManyRequests, "TooManyRequests"
	if r := send(); r.TokenInvalid() || r.OK() {
		t.Fatalf("429 is retryable: %+v", r)
	}
	status, reason = http.StatusForbidden, "ExpiredProviderToken"
	_ = send()
	if c.token != "" {
		t.Fatal("expired provider token must be dropped")
	}
}

func TestBuildPayloadStart(t *testing.T) {
	if _, err := BuildPayload(LiveActivity{Event: EventStart}, time.Now()); err == nil {
		t.Fatal("start without attributes-type must fail")
	}
	raw, err := BuildPayload(LiveActivity{Event: EventStart, AttributesType: "LiveActivityAttributes", ContentState: map[string]any{}}, time.Unix(10, 0))
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		APS map[string]any `json:"aps"`
	}
	_ = json.Unmarshal(raw, &body)
	if body.APS["attributes-type"] != "LiveActivityAttributes" || body.APS["input-push-token"].(float64) != 1 {
		t.Fatalf("start payload %v", body.APS)
	}
	if _, ok := body.APS["dismissal-date"]; ok {
		t.Fatal("dismissal-date only for end")
	}
}
