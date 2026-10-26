// Package apns is a minimal Apple Push Notification service client for
// ActivityKit (Live Activity) pushes. Expo Push Service has no liveactivity
// push type, so Live Activity updates go to APNs directly with token-based
// (.p8) authentication over HTTP/2.
//
// The client is optional: without a key, team id and key id it reports
// Configured() == false and every Send returns ErrNotConfigured.
package apns

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/appleauth"
	"github.com/golang-jwt/jwt/v5"
)

// APNs hosts.
const (
	ProductionURL = "https://api.push.apple.com"
	SandboxURL    = "https://api.sandbox.push.apple.com"

	// Provider tokens are valid for an hour and must not be refreshed more
	// than once every 20 minutes; 40 minutes sits safely in between.
	providerTokenTTL = 40 * time.Minute
)

// ErrNotConfigured is returned when APNs credentials are missing.
var ErrNotConfigured = errors.New("apns: not configured")

// Config holds the token-based APNs credentials.
type Config struct {
	// KeyID is the 10-character id of the .p8 key (Apple Developer → Keys).
	KeyID string
	// TeamID is the Apple Developer team id.
	TeamID string
	// PrivateKey is the .p8 PEM; literal "\n" escapes are accepted.
	PrivateKey string
	// BundleID is the iOS app bundle id (topic prefix), e.g. com.otopoly.app.
	BundleID string
	// Environment is "production" (TestFlight / App Store) or "sandbox"
	// (development builds). Default production.
	Environment string
	// BaseURL overrides the host (tests).
	BaseURL string
	HTTP    *http.Client
}

// Client sends ActivityKit pushes.
type Client struct {
	cfg     Config
	key     *ecdsa.PrivateKey
	http    *http.Client
	baseURL string
	now     func() time.Time

	mu       sync.Mutex
	token    string
	issuedAt time.Time
}

// New builds a client. Missing credentials yield an unconfigured client; a
// malformed key is an error so a deploy mistake is visible at start-up.
func New(cfg Config) (*Client, error) {
	c := &Client{cfg: cfg, http: cfg.HTTP, now: time.Now}
	if c.http == nil {
		c.http = &http.Client{Timeout: 15 * time.Second}
	}
	c.baseURL = strings.TrimRight(cfg.BaseURL, "/")
	if c.baseURL == "" {
		c.baseURL = ProductionURL
		if strings.EqualFold(strings.TrimSpace(cfg.Environment), "sandbox") {
			c.baseURL = SandboxURL
		}
	}
	if strings.TrimSpace(cfg.PrivateKey) == "" || strings.TrimSpace(cfg.KeyID) == "" ||
		strings.TrimSpace(cfg.TeamID) == "" || strings.TrimSpace(cfg.BundleID) == "" {
		return c, nil
	}
	key, err := appleauth.ParsePrivateKey(cfg.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("apns: %w", err)
	}
	c.key = key
	return c, nil
}

// Configured reports whether pushes can be sent.
func (c *Client) Configured() bool { return c != nil && c.key != nil }

// SetClock overrides time (tests).
func (c *Client) SetClock(now func() time.Time) { c.now = now }

// LiveActivityEvent is the aps.event of an ActivityKit push.
type LiveActivityEvent string

// ActivityKit events.
const (
	EventUpdate LiveActivityEvent = "update"
	EventEnd    LiveActivityEvent = "end"
	EventStart  LiveActivityEvent = "start"
)

// Alert lights up the screen with a short banner (optional).
type Alert struct {
	Title string `json:"title,omitempty"`
	Body  string `json:"body,omitempty"`
	Sound string `json:"sound,omitempty"`
}

// LiveActivity is one ActivityKit push.
type LiveActivity struct {
	// Token is the per-activity push token (hex) or, for EventStart, the
	// push-to-start token.
	Token string
	Event LiveActivityEvent
	// ContentState must match the activity's Codable ContentState.
	ContentState any
	// Timestamp orders updates; zero means now.
	Timestamp time.Time
	// StaleDate / DismissalDate are optional (DismissalDate only for end;
	// a past date removes the activity right away).
	StaleDate     time.Time
	DismissalDate time.Time
	Alert         *Alert
	// AttributesType / Attributes are required for EventStart.
	AttributesType string
	Attributes     any
	// HighPriority sends apns-priority 10 (counts against the hourly
	// budget); otherwise 5.
	HighPriority bool
	// Expiration is how long APNs keeps trying (zero = 1 hour).
	Expiration time.Duration
}

// Result is the APNs answer for one push.
type Result struct {
	Status int
	Reason string
	ID     string
}

// TokenInvalid reports that the token will never work again (activity
// ended, app removed, wrong environment); the caller should forget it.
func (r Result) TokenInvalid() bool {
	switch {
	case r.Status == http.StatusGone:
		return true
	case r.Status == http.StatusBadRequest && (r.Reason == "BadDeviceToken" || r.Reason == "DeviceTokenNotForTopic"):
		return true
	}
	return false
}

// OK reports a 200 answer.
func (r Result) OK() bool { return r.Status == http.StatusOK }

// BuildPayload renders the aps dictionary of an ActivityKit push.
func BuildPayload(p LiveActivity, now time.Time) ([]byte, error) {
	ts := p.Timestamp
	if ts.IsZero() {
		ts = now
	}
	aps := map[string]any{
		"timestamp":     ts.Unix(),
		"event":         string(p.Event),
		"content-state": p.ContentState,
	}
	if !p.StaleDate.IsZero() {
		aps["stale-date"] = p.StaleDate.Unix()
	}
	if p.Event == EventEnd && !p.DismissalDate.IsZero() {
		aps["dismissal-date"] = p.DismissalDate.Unix()
	}
	if p.Alert != nil {
		aps["alert"] = p.Alert
	}
	if p.Event == EventStart {
		if p.AttributesType == "" {
			return nil, errors.New("apns: start needs attributes-type")
		}
		aps["attributes-type"] = p.AttributesType
		attrs := p.Attributes
		if attrs == nil {
			attrs = map[string]any{}
		}
		aps["attributes"] = attrs
		aps["input-push-token"] = 1
	}
	return json.Marshal(map[string]any{"aps": aps})
}

// SendLiveActivity posts one ActivityKit push. A non-nil error means the
// request did not get an APNs answer (network, credentials); APNs rejections
// come back in Result.
func (c *Client) SendLiveActivity(ctx context.Context, p LiveActivity) (Result, error) {
	if !c.Configured() {
		return Result{}, ErrNotConfigured
	}
	token := strings.TrimSpace(p.Token)
	if token == "" {
		return Result{}, errors.New("apns: empty token")
	}
	body, err := BuildPayload(p, c.now())
	if err != nil {
		return Result{}, err
	}
	auth, err := c.providerToken()
	if err != nil {
		return Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/3/device/"+token, bytes.NewReader(body))
	if err != nil {
		return Result{}, err
	}
	priority := "5"
	if p.HighPriority {
		priority = "10"
	}
	exp := p.Expiration
	if exp <= 0 {
		exp = time.Hour
	}
	req.Header.Set("authorization", "bearer "+auth)
	req.Header.Set("apns-push-type", "liveactivity")
	req.Header.Set("apns-topic", strings.TrimSpace(c.cfg.BundleID)+".push-type.liveactivity")
	req.Header.Set("apns-priority", priority)
	req.Header.Set("apns-expiration", strconv.FormatInt(c.now().Add(exp).Unix(), 10))
	req.Header.Set("content-type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("apns: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	res := Result{Status: resp.StatusCode, ID: resp.Header.Get("apns-id")}
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(raw, &e)
		res.Reason = e.Reason
		if resp.StatusCode == http.StatusForbidden && strings.HasSuffix(e.Reason, "ProviderToken") {
			c.resetToken()
		}
	}
	return res, nil
}

func (c *Client) providerToken() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if c.token != "" && now.Sub(c.issuedAt) < providerTokenTTL {
		return c.token, nil
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss": strings.TrimSpace(c.cfg.TeamID),
		"iat": now.Unix(),
	})
	tok.Header["kid"] = strings.TrimSpace(c.cfg.KeyID)
	signed, err := tok.SignedString(c.key)
	if err != nil {
		return "", fmt.Errorf("apns: sign provider token: %w", err)
	}
	c.token, c.issuedAt = signed, now
	return signed, nil
}

func (c *Client) resetToken() {
	c.mu.Lock()
	c.token = ""
	c.mu.Unlock()
}
