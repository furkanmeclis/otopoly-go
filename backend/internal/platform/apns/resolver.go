package apns

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/appleauth"
)

// Credential sources reported by Resolver.
const (
	SourceDatabase = "database"
	SourceEnv      = "env"
	SourceNone     = "none"
)

// DefaultBundleID is the iOS app bundle id used when none is set.
const DefaultBundleID = "com.otopoly.app"

// DefaultResolverTTL bounds how long resolved credentials are reused before
// the key source is read again. Invalidate drops them at once in this
// process; the TTL lets other processes (API replicas, worker) pick up a
// newly uploaded key without a restart.
const DefaultResolverTTL = time.Minute

// KeySource returns the admin-uploaded APNs key (stored in the DB).
// ok=false means nothing is stored and the env fallback applies. TeamID may
// be empty (the env team id is used then).
type KeySource interface {
	APNsKey(ctx context.Context) (cfg Config, ok bool, err error)
}

// Info describes the active credentials (never the key itself).
type Info struct {
	Source      string
	KeyID       string
	TeamID      string
	BundleID    string
	Environment string
	Host        string
	// Fingerprint is a short SHA-256 of the public key (to tell keys apart).
	Fingerprint string
}

// Resolver picks the APNs credentials at send time: the DB key first, the
// APNS_* env key as fallback. The parsed key (and its provider token) is
// reused until the credentials change.
type Resolver struct {
	src     KeySource
	envCfg  Config
	env     *Client
	http    *http.Client
	ttl     time.Duration
	baseURL string
	now     func() time.Time
	log     *slog.Logger

	mu         sync.Mutex
	cached     *resolved
	loggedNone bool
	logged     string // last logged source+fingerprint
	badDBKey   string // fingerprint of a DB key that failed to parse (logged once)
}

type resolved struct {
	client   *Client
	info     Info
	fp       string
	loadedAt time.Time
}

// NewResolver builds a resolver. A malformed env key is logged and treated
// as missing (fail-soft: pushes stay off rather than the process failing).
func NewResolver(src KeySource, env Config, httpClient *http.Client, log *slog.Logger) *Resolver {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	if log == nil {
		log = slog.Default()
	}
	env = normalizeConfig(env, Config{})
	env.HTTP = httpClient
	r := &Resolver{src: src, envCfg: env, http: httpClient, ttl: DefaultResolverTTL, now: time.Now, log: log}
	client, err := New(env)
	if err != nil {
		log.Error("livepush_apns_key_invalid", "source", SourceEnv, "error", err)
		client, _ = New(Config{BundleID: env.BundleID, Environment: env.Environment, HTTP: httpClient})
	}
	r.env = client
	return r
}

// normalizeConfig trims fields and fills defaults (team id from fallback,
// bundle id, environment).
func normalizeConfig(cfg, fallback Config) Config {
	out := Config{
		KeyID:       strings.ToUpper(strings.TrimSpace(cfg.KeyID)),
		TeamID:      strings.ToUpper(strings.TrimSpace(cfg.TeamID)),
		PrivateKey:  cfg.PrivateKey,
		BundleID:    strings.TrimSpace(cfg.BundleID),
		Environment: NormalizeEnvironment(cfg.Environment),
		BaseURL:     cfg.BaseURL,
		HTTP:        cfg.HTTP,
	}
	if out.TeamID == "" {
		out.TeamID = strings.ToUpper(strings.TrimSpace(fallback.TeamID))
	}
	if out.BundleID == "" {
		out.BundleID = strings.TrimSpace(fallback.BundleID)
	}
	if out.BundleID == "" {
		out.BundleID = DefaultBundleID
	}
	return out
}

func fingerprint(cfg Config) string {
	h := sha256.Sum256([]byte(strings.Join([]string{cfg.KeyID, cfg.TeamID, cfg.BundleID, cfg.Environment, cfg.BaseURL, cfg.PrivateKey}, "\x00")))
	return hex.EncodeToString(h[:])
}

// KeyFingerprint returns a short SHA-256 hex of the key's public half, or ""
// when the PEM does not parse.
func KeyFingerprint(pemText string) string {
	key, err := appleauth.ParsePrivateKey(pemText)
	if err != nil {
		return ""
	}
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return ""
	}
	h := sha256.Sum256(der)
	return hex.EncodeToString(h[:8])
}

// SetTTL overrides the cache lifetime (tests).
func (r *Resolver) SetTTL(ttl time.Duration) { r.ttl = ttl }

// SetClock overrides time (tests).
func (r *Resolver) SetClock(now func() time.Time) {
	r.mu.Lock()
	r.now = now
	r.mu.Unlock()
}

// SetBaseURL overrides the APNs host of every resolved client (tests).
func (r *Resolver) SetBaseURL(u string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.baseURL = strings.TrimRight(u, "/")
	r.envCfg.BaseURL = r.baseURL
	if c, err := New(r.envCfg); err == nil {
		r.env = c
	}
	r.cached = nil
}

// Invalidate makes the next call re-read the source. Unchanged credentials
// still keep their client (and provider token).
func (r *Resolver) Invalidate() {
	r.mu.Lock()
	if r.cached != nil {
		stale := *r.cached
		stale.loadedAt = time.Time{}
		r.cached = &stale
	}
	r.mu.Unlock()
}

func infoFor(c *Client, source string) Info {
	if !c.Configured() {
		return Info{Source: SourceNone, BundleID: c.cfg.BundleID, Environment: c.Environment(), Host: c.Host()}
	}
	return Info{
		Source:      source,
		KeyID:       c.cfg.KeyID,
		TeamID:      c.cfg.TeamID,
		BundleID:    c.cfg.BundleID,
		Environment: c.Environment(),
		Host:        c.Host(),
		Fingerprint: KeyFingerprint(c.cfg.PrivateKey),
	}
}

func (r *Resolver) envResolved(now time.Time) *resolved {
	return &resolved{client: r.env, info: infoFor(r.env, SourceEnv), fp: "env", loadedAt: now}
}

func (r *Resolver) current(ctx context.Context) *resolved {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	if r.cached != nil && now.Sub(r.cached.loadedAt) < r.ttl {
		return r.cached
	}
	res := r.resolve(ctx, now)
	r.cached = res
	r.logTransition(res)
	return res
}

// resolve reads the source; callers hold r.mu.
func (r *Resolver) resolve(ctx context.Context, now time.Time) *resolved {
	if r.src == nil {
		return r.envResolved(now)
	}
	cfg, ok, err := r.src.APNsKey(ctx)
	if err != nil {
		// Transient read failure: keep what worked before (until the next
		// TTL), otherwise use env.
		r.log.Warn("livepush_apns_source_read_failed", "error", err)
		if r.cached != nil {
			keep := *r.cached
			keep.loadedAt = now
			return &keep
		}
		return r.envResolved(now)
	}
	if !ok || strings.TrimSpace(cfg.PrivateKey) == "" {
		return r.envResolved(now)
	}
	cfg = normalizeConfig(cfg, r.envCfg)
	cfg.HTTP = r.http
	if r.baseURL != "" {
		cfg.BaseURL = r.baseURL
	}
	fp := fingerprint(cfg)
	if r.cached != nil && r.cached.fp == fp {
		// Same credentials: keep the client and its provider token (APNs
		// rejects refreshing the token more than every 20 minutes).
		keep := *r.cached
		keep.loadedAt = now
		return &keep
	}
	client, err := New(cfg)
	if err != nil || !client.Configured() {
		if r.badDBKey != fp {
			r.badDBKey = fp
			r.log.Error("livepush_apns_key_invalid", "source", SourceDatabase, "key_id", cfg.KeyID, "team_id_set", cfg.TeamID != "", "error", err)
		}
		return r.envResolved(now)
	}
	return &resolved{client: client, info: infoFor(client, SourceDatabase), fp: fp, loadedAt: now}
}

// logTransition logs the source once per change; "disabled" once per process.
func (r *Resolver) logTransition(res *resolved) {
	if res.info.Source == SourceNone {
		if !r.loggedNone {
			r.loggedNone = true
			r.log.Info("livepush_apns_disabled", "hint", "no APNs key: upload one in Platform → Entegrasyonlar → Apple (Apple Push) or set APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY; iOS Live Activities update only while the app runs")
		}
		r.logged = ""
		return
	}
	mark := res.info.Source + ":" + res.fp
	if r.logged == mark {
		return
	}
	r.logged = mark
	r.log.Info("livepush_apns_source", "source", res.info.Source, "key_id", res.info.KeyID,
		"bundle_id", res.info.BundleID, "environment", res.info.Environment)
}

// Configured reports whether pushes can be sent.
func (r *Resolver) Configured(ctx context.Context) bool { return r.current(ctx).client.Configured() }

// Source reports where the active credentials come from: database, env or none.
func (r *Resolver) Source(ctx context.Context) string { return r.current(ctx).info.Source }

// Active describes the active credentials.
func (r *Resolver) Active(ctx context.Context) Info { return r.current(ctx).info }

// EnvInfo describes the APNS_* env credentials (Source none when unset).
func (r *Resolver) EnvInfo() Info {
	r.mu.Lock()
	defer r.mu.Unlock()
	return infoFor(r.env, SourceEnv)
}

// SendLiveActivity sends one push with the active credentials.
func (r *Resolver) SendLiveActivity(ctx context.Context, p LiveActivity) (Result, error) {
	return r.current(ctx).client.SendLiveActivity(ctx, p)
}

// Probe tests the active credentials (see Client.Probe).
func (r *Resolver) Probe(ctx context.Context) (Info, ProbeResult) {
	cur := r.current(ctx)
	return cur.info, cur.client.Probe(ctx)
}
