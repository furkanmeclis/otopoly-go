package usecase

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/apns"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
)

func testBox(t *testing.T) *crypto.SecretBox {
	t.Helper()
	raw := make([]byte, 32)
	_, _ = rand.Read(raw)
	box, err := crypto.NewSecretBox(base64.StdEncoding.EncodeToString(raw))
	if err != nil {
		t.Fatal(err)
	}
	return box
}

func pkcs8(t *testing.T, key any) string {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func p8(t *testing.T) string {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	return pkcs8(t, key)
}

func TestValidate(t *testing.T) {
	good := p8(t)
	rsaKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	p384, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	out, err := Validate(SaveInput{KeyID: " gs6q2fz3pt ", PrivateKey: good}, false)
	if err != nil || out.KeyID != "GS6Q2FZ3PT" || out.BundleID != apns.DefaultBundleID || out.Environment != "production" {
		t.Fatalf("defaults: %+v %v", out, err)
	}
	cases := map[string]struct {
		in     SaveInput
		stored bool
		field  string
	}{
		"key id":      {SaveInput{KeyID: "short", PrivateKey: good}, false, "key_id"},
		"team id":     {SaveInput{KeyID: "GS6Q2FZ3PT", TeamID: "x", PrivateKey: good}, false, "team_id"},
		"bundle":      {SaveInput{KeyID: "GS6Q2FZ3PT", BundleID: "nodots", PrivateKey: good}, false, "bundle_id"},
		"environment": {SaveInput{KeyID: "GS6Q2FZ3PT", Environment: "dev", PrivateKey: good}, false, "environment"},
		"missing key": {SaveInput{KeyID: "GS6Q2FZ3PT"}, false, "private_key"},
		"not pem":     {SaveInput{KeyID: "GS6Q2FZ3PT", PrivateKey: "hello"}, true, "private_key"},
		"rsa key":     {SaveInput{KeyID: "GS6Q2FZ3PT", PrivateKey: pkcs8(t, rsaKey)}, false, "private_key"},
		"p-384 key":   {SaveInput{KeyID: "GS6Q2FZ3PT", PrivateKey: pkcs8(t, p384)}, false, "private_key"},
		"huge key":    {SaveInput{KeyID: "GS6Q2FZ3PT", PrivateKey: strings.Repeat("a", maxKeyBytes+1)}, false, "private_key"},
	}
	for name, tc := range cases {
		_, err := Validate(tc.in, tc.stored)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != tc.field || !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if _, err := Validate(SaveInput{KeyID: "GS6Q2FZ3PT", Environment: "Sandbox"}, true); err != nil {
		t.Fatalf("stored key, fields only: %v", err)
	}
}

// TestServiceDB runs the real SQL: sealed storage, team fallback, resolver
// pick-up (database before env), test result, removal.
func TestServiceDB(t *testing.T) {
	fx := dbtest.NewFixtures(t)
	ctx := context.Background()
	q := db.New(fx.Pool)
	svc := New(q, testBox(t))

	status, reason := http.StatusBadRequest, "BadDeviceToken"
	var gotTopic, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTopic, gotPath = r.Header.Get("apns-topic"), r.URL.Path
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"reason":"` + reason + `"}`))
	}))
	defer srv.Close()
	envPEM := p8(t)
	keys := apns.NewResolver(svc, apns.Config{KeyID: "ENVKEY0001", TeamID: "ENVTEAM001", PrivateKey: envPEM}, nil, nil)
	keys.SetBaseURL(srv.URL)
	svc.SetKeys(keys)

	st, err := svc.Get(ctx)
	if err != nil || st.Stored || st.Source != apns.SourceEnv || !st.EnvConfigured || st.Active == nil || st.Active.KeyID != "ENVKEY0001" {
		t.Fatalf("initial %+v %v", st, err)
	}

	// Team id falls back to the Apple integration's.
	fx.Exec(`UPDATE oauth_provider_settings SET apple_team_id = 'APPLETEAM1' WHERE provider = 'apple'`)
	keyPEM := p8(t)
	res, err := svc.Save(ctx, nil, SaveInput{KeyID: "GS6Q2FZ3PT", PrivateKey: keyPEM, Environment: "sandbox"})
	if err != nil || !res.KeyUploaded {
		t.Fatalf("save %v", err)
	}
	st = res.Status
	if !st.Stored || st.Source != apns.SourceDatabase || st.EffectiveTeam != "APPLETEAM1" || st.TeamIDSource != TeamFromApple ||
		st.KeyFingerprint == "" || st.UploadedAt == nil || st.Active.Environment != "sandbox" || st.Active.KeyFingerprint != st.KeyFingerprint {
		t.Fatalf("saved %+v active %+v", st, st.Active)
	}
	var enc string
	if err := fx.Pool.QueryRow(ctx, `SELECT private_key_enc FROM platform_apns_settings WHERE id = 1`).Scan(&enc); err != nil {
		t.Fatal(err)
	}
	if enc == "" || strings.Contains(enc, "PRIVATE KEY") {
		t.Fatalf("key not sealed: %q", enc)
	}

	tr, err := svc.Test(ctx)
	if err != nil || !tr.OK || tr.Verdict != apns.VerdictAccepted || tr.Source != apns.SourceDatabase || tr.Environment != "sandbox" {
		t.Fatalf("test %+v %v", tr, err)
	}
	if gotTopic != apns.DefaultBundleID+".push-type.liveactivity" || !strings.HasPrefix(gotPath, "/3/device/") {
		t.Fatalf("probe topic %q path %q", gotTopic, gotPath)
	}
	st, _ = svc.Get(ctx)
	if st.LastTest == nil || !st.LastTest.OK || st.LastTest.Status == nil || *st.LastTest.Status != 400 || st.LastTest.Reason != "BadDeviceToken" {
		t.Fatalf("last test %+v", st.LastTest)
	}

	status, reason = http.StatusForbidden, "InvalidProviderToken"
	if tr, _ := svc.Test(ctx); tr.OK || tr.Verdict != apns.VerdictKeyRejected {
		t.Fatalf("rejected %+v", tr)
	}

	// Fields only: key kept, last test cleared, own team id wins.
	res, err = svc.Save(ctx, nil, SaveInput{KeyID: "GS6Q2FZ3PT", TeamID: "OWNTEAM001", BundleID: "com.example.app"})
	if err != nil || res.KeyUploaded || !res.Status.Stored || res.Status.LastTest != nil ||
		res.Status.EffectiveTeam != "OWNTEAM001" || res.Status.Active.BundleID != "com.example.app" || res.Status.Active.TeamID != "OWNTEAM001" {
		t.Fatalf("fields-only %+v %v", res.Status, err)
	}

	st, err = svc.Delete(ctx, nil)
	if err != nil || st.Stored || st.Source != apns.SourceEnv || st.KeyID != "" || st.BundleID != apns.DefaultBundleID {
		t.Fatalf("delete %+v %v", st, err)
	}
}
