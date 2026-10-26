package apns

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type fakeSource struct {
	mu    sync.Mutex
	cfg   Config
	ok    bool
	err   error
	calls atomic.Int32
}

func (f *fakeSource) APNsKey(context.Context) (Config, bool, error) {
	f.calls.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cfg, f.ok, f.err
}

func (f *fakeSource) set(cfg Config, ok bool, err error) {
	f.mu.Lock()
	f.cfg, f.ok, f.err = cfg, ok, err
	f.mu.Unlock()
}

// apnsServer answers like APNs and records the provider token's kid / iss.
type apnsServer struct {
	*httptest.Server
	mu     sync.Mutex
	kids   []string
	topics []string
	status int
	reason string
}

func newAPNsServer(t *testing.T) *apnsServer {
	s := &apnsServer{status: http.StatusOK}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := strings.TrimPrefix(r.Header.Get("authorization"), "bearer ")
		tok, _, _ := jwt.NewParser().ParseUnverified(auth, jwt.MapClaims{})
		s.mu.Lock()
		defer s.mu.Unlock()
		if tok != nil {
			iss, _ := tok.Claims.(jwt.MapClaims)["iss"].(string)
			s.kids = append(s.kids, tok.Header["kid"].(string)+"/"+iss)
		}
		s.topics = append(s.topics, r.Header.Get("apns-topic"))
		w.WriteHeader(s.status)
		if s.reason != "" {
			_, _ = w.Write([]byte(`{"reason":"` + s.reason + `"}`))
		}
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *apnsServer) seen() ([]string, []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.kids...), append([]string(nil), s.topics...)
}

func send(t *testing.T, r *Resolver) Result {
	t.Helper()
	res, err := r.SendLiveActivity(context.Background(), LiveActivity{Token: "abcdef0123456789", Event: EventUpdate, ContentState: map[string]any{}})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	return res
}

func TestResolverNoneAndLogsOnce(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	r := NewResolver(&fakeSource{}, Config{}, nil, log)
	r.SetTTL(0)
	ctx := context.Background()
	for range 3 {
		if r.Configured(ctx) || r.Source(ctx) != SourceNone {
			t.Fatal("no key anywhere must be unconfigured")
		}
	}
	if _, err := r.SendLiveActivity(ctx, LiveActivity{Token: "ab"}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
	if n := strings.Count(buf.String(), "livepush_apns_disabled"); n != 1 {
		t.Fatalf("disabled logged %d times:\n%s", n, buf.String())
	}
}

func TestResolverEnvFallbackThenDatabase(t *testing.T) {
	srv := newAPNsServer(t)
	envPEM, _ := testKey(t)
	dbPEM, _ := testKey(t)
	var buf bytes.Buffer
	src := &fakeSource{}
	r := NewResolver(src, Config{KeyID: "ENVKEY0001", TeamID: "ENVTEAM001", PrivateKey: envPEM}, nil, slog.New(slog.NewTextHandler(&buf, nil)))
	r.SetBaseURL(srv.URL)
	now := time.Unix(1_800_000_000, 0)
	r.SetClock(func() time.Time { return now })
	ctx := context.Background()

	if r.Source(ctx) != SourceEnv {
		t.Fatalf("source %s", r.Source(ctx))
	}
	send(t, r)

	// An uploaded key (no team id → env team) is picked up after the TTL.
	src.set(Config{KeyID: "dbkey00001", PrivateKey: dbPEM, BundleID: "com.example.app", Environment: "sandbox"}, true, nil)
	if r.Source(ctx) != SourceEnv {
		t.Fatal("cache must hold until the TTL")
	}
	now = now.Add(DefaultResolverTTL)
	if r.Source(ctx) != SourceDatabase {
		t.Fatalf("after TTL source %s", r.Source(ctx))
	}
	info := r.Active(ctx)
	if info.KeyID != "DBKEY00001" || info.TeamID != "ENVTEAM001" || info.Environment != "sandbox" || info.Fingerprint == "" {
		t.Fatalf("info %+v", info)
	}
	send(t, r)
	kids, topics := srv.seen()
	if kids[0] != "ENVKEY0001/ENVTEAM001" || kids[1] != "DBKEY00001/ENVTEAM001" {
		t.Fatalf("kids %v", kids)
	}
	if topics[1] != "com.example.app.push-type.liveactivity" {
		t.Fatalf("topic %v", topics)
	}

	// Removal → env again; Invalidate applies at once.
	src.set(Config{}, false, nil)
	r.Invalidate()
	if r.Source(ctx) != SourceEnv {
		t.Fatal("removed DB key must fall back to env")
	}
	if n := strings.Count(buf.String(), "livepush_apns_source"); n != 3 {
		t.Fatalf("source transitions logged %d times:\n%s", n, buf.String())
	}
}

func TestResolverKeepsClientWhileUnchanged(t *testing.T) {
	pemText, _ := testKey(t)
	src := &fakeSource{cfg: Config{KeyID: "KEY0000001", TeamID: "TEAM000001", PrivateKey: pemText}, ok: true}
	r := NewResolver(src, Config{}, nil, nil)
	r.SetTTL(0)
	ctx := context.Background()
	first := r.current(ctx).client
	if r.current(ctx).client != first {
		t.Fatal("unchanged credentials must reuse the client (provider token)")
	}
	r.Invalidate()
	if r.current(ctx).client != first {
		t.Fatal("Invalidate with unchanged credentials must keep the client")
	}
	if src.calls.Load() < 2 {
		t.Fatal("source must be re-read after the TTL")
	}
	// Read failure keeps the working key.
	src.set(Config{}, false, errors.New("db down"))
	if r.current(ctx).client != first || r.Source(ctx) != SourceDatabase {
		t.Fatal("transient error must keep the cached key")
	}
}

func TestResolverInvalidDBKeyFallsBack(t *testing.T) {
	src := &fakeSource{cfg: Config{KeyID: "KEY0000001", TeamID: "TEAM000001", PrivateKey: "garbage"}, ok: true}
	envPEM, _ := testKey(t)
	r := NewResolver(src, Config{KeyID: "ENVKEY0001", TeamID: "ENVTEAM001", PrivateKey: envPEM}, nil, nil)
	if r.Source(context.Background()) != SourceEnv {
		t.Fatal("unparsable DB key must fall back to env")
	}
	// A malformed env key is fail-soft.
	bad := NewResolver(nil, Config{KeyID: "K", TeamID: "T", PrivateKey: "nope"}, nil, nil)
	if bad.Configured(context.Background()) {
		t.Fatal("malformed env key must leave pushes off")
	}
}

func TestProbeVerdicts(t *testing.T) {
	srv := newAPNsServer(t)
	pemText, _ := testKey(t)
	r := NewResolver(&fakeSource{cfg: Config{KeyID: "KEY0000001", TeamID: "TEAM000001", PrivateKey: pemText}, ok: true}, Config{}, nil, nil)
	r.SetBaseURL(srv.URL)
	cases := []struct {
		status  int
		reason  string
		verdict string
		ok      bool
	}{
		{400, "BadDeviceToken", VerdictAccepted, true},
		{403, "InvalidProviderToken", VerdictKeyRejected, false},
		{403, "ExpiredProviderToken", VerdictKeyRejected, false},
		{400, "TopicDisallowed", VerdictTopicRejected, false},
		{429, "TooManyProviderTokenUpdates", VerdictRateLimited, false},
		{500, "InternalServerError", VerdictRejected, false},
	}
	for _, tc := range cases {
		srv.mu.Lock()
		srv.status, srv.reason = tc.status, tc.reason
		srv.mu.Unlock()
		info, got := r.Probe(context.Background())
		if got.Verdict != tc.verdict || got.OK != tc.ok || got.Status != tc.status || got.Reason != tc.reason {
			t.Fatalf("%d %s: %+v", tc.status, tc.reason, got)
		}
		if info.Source != SourceDatabase {
			t.Fatalf("info %+v", info)
		}
	}
	srv.Close()
	r.Invalidate()
	if _, got := r.Probe(context.Background()); got.Verdict != VerdictUnreachable || got.Error == "" {
		t.Fatalf("closed server: %+v", got)
	}
	none := NewResolver(nil, Config{}, nil, nil)
	if _, got := none.Probe(context.Background()); got.Verdict != VerdictNotConfigured {
		t.Fatalf("none: %+v", got)
	}
}
