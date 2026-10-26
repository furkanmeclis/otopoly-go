package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// DefaultExpoPushURL is the Expo Push Service send endpoint.
const DefaultExpoPushURL = "https://exp.host/--/api/v2/push/send"

const expoBatch = 100

// ExpoMessage is a data-only Expo push: no title/body, so nothing is shown
// by the OS and the app's background notification task handles it.
type ExpoMessage struct {
	To   string         `json:"to"`
	Data map[string]any `json:"data"`
	// Priority: "high" wakes Android in Doze (FCM high priority); on iOS a
	// background push must use "normal" (APNs priority 5).
	Priority string `json:"priority,omitempty"`
	// ContentAvailable sets content-available on iOS (background push).
	ContentAvailable bool `json:"contentAvailable,omitempty"`
	// TTL in seconds: a stale snapshot is worthless.
	TTL int `json:"ttl,omitempty"`
}

// ExpoTicket is Expo's per-message answer.
type ExpoTicket struct {
	Status  string `json:"status"`
	ID      string `json:"id"`
	Message string `json:"message"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

// DeviceGone reports a token Expo will never deliver to again.
func (t ExpoTicket) DeviceGone() bool { return t.Details.Error == "DeviceNotRegistered" }

// ExpoSender sends Expo push messages (tests swap in a fake).
type ExpoSender interface {
	Send(ctx context.Context, msgs []ExpoMessage) ([]ExpoTicket, error)
}

// ExpoHTTP is the Expo Push Service client.
type ExpoHTTP struct {
	URL         string
	AccessToken string
	HTTP        *http.Client
}

// NewExpoHTTP returns a client for the public Expo endpoint.
func NewExpoHTTP(accessToken string) *ExpoHTTP {
	return &ExpoHTTP{URL: DefaultExpoPushURL, AccessToken: accessToken, HTTP: &http.Client{Timeout: 20 * time.Second}}
}

// Send posts messages in batches of 100; tickets come back in order.
func (c *ExpoHTTP) Send(ctx context.Context, msgs []ExpoMessage) ([]ExpoTicket, error) {
	out := make([]ExpoTicket, 0, len(msgs))
	for start := 0; start < len(msgs); start += expoBatch {
		end := min(start+expoBatch, len(msgs))
		tickets, err := c.send(ctx, msgs[start:end])
		if err != nil {
			return out, err
		}
		out = append(out, tickets...)
	}
	return out, nil
}

func (c *ExpoHTTP) send(ctx context.Context, msgs []ExpoMessage) ([]ExpoTicket, error) {
	buf, err := json.Marshal(msgs)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.AccessToken)
	}
	hc := c.HTTP
	if hc == nil {
		hc = http.DefaultClient
	}
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("expo: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("expo: http %d", resp.StatusCode)
	}
	var body struct {
		Data   []ExpoTicket `json:"data"`
		Errors []struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, fmt.Errorf("expo: decode: %w", err)
	}
	if len(body.Data) == 0 && len(body.Errors) > 0 {
		return nil, fmt.Errorf("expo: %s: %s", body.Errors[0].Code, body.Errors[0].Message)
	}
	return body.Data, nil
}
