package livepush

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/config"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/apns"
	"github.com/golang-jwt/jwt/v5"
)

func p8(t *testing.T) string {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

type dbKey struct {
	cfg apns.Config
	ok  bool
}

func (d *dbKey) APNsKey(context.Context) (apns.Config, bool, error) { return d.cfg, d.ok, nil }

// TestNewAPNsSources: env only, then an uploaded key wins over env.
func TestNewAPNsSources(t *testing.T) {
	var mu sync.Mutex
	var kids []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok, _, _ := jwt.NewParser().ParseUnverified(strings.TrimPrefix(r.Header.Get("authorization"), "bearer "), jwt.MapClaims{})
		mu.Lock()
		kids = append(kids, tok.Header["kid"].(string))
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	var cfg config.Config
	cfg.APNs = config.APNsConfig{KeyID: "ENVKEY0001", TeamID: "TEAM000001", PrivateKey: p8(t), BundleID: "com.otopoly.app", Environment: "production"}
	src := &dbKey{}
	keys := NewAPNs(cfg, src, nil)
	keys.SetBaseURL(srv.URL)
	ctx := context.Background()
	push := apns.LiveActivity{Token: "aabbccddeeff0011", Event: apns.EventUpdate, ContentState: map[string]any{}}

	if keys.Source(ctx) != apns.SourceEnv {
		t.Fatalf("env source: %s", keys.Source(ctx))
	}
	if res, err := keys.SendLiveActivity(ctx, push); err != nil || !res.OK() {
		t.Fatalf("env send %+v %v", res, err)
	}
	src.cfg, src.ok = apns.Config{KeyID: "DBKEY00001", PrivateKey: p8(t)}, true
	keys.Invalidate()
	if keys.Source(ctx) != apns.SourceDatabase {
		t.Fatalf("db source: %s", keys.Source(ctx))
	}
	if res, err := keys.SendLiveActivity(ctx, push); err != nil || !res.OK() {
		t.Fatalf("db send %+v %v", res, err)
	}
	if len(kids) != 2 || kids[0] != "ENVKEY0001" || kids[1] != "DBKEY00001" {
		t.Fatalf("kids %v", kids)
	}

	none := NewAPNs(config.Config{}, nil, nil)
	if none.Configured(ctx) {
		t.Fatal("no key anywhere must be off")
	}
}
