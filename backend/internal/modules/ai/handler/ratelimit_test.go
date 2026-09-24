package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

type denyLimiter struct {
	calls   []string
	allowed int
}

func (d *denyLimiter) Allow(_ context.Context, action, subject string, limit int, window time.Duration) (bool, time.Duration) {
	d.calls = append(d.calls, action+":"+subject)
	if len(d.calls) <= d.allowed {
		return true, 0
	}
	return false, 42 * time.Second
}

func TestModelTurnsAreRateLimitedPerUser(t *testing.T) {
	h, _, ctx := newVoiceHandler(t)
	lim := &denyLimiter{}
	h.SetRateLimiter(lim)

	for name, call := range map[string]func(*httptest.ResponseRecorder){
		"message": func(rec *httptest.ResponseRecorder) {
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"content":"merhaba"}`)).WithContext(ctx)
			req.SetPathValue("uuid", uuid.NewString())
			h.SendMessage(rec, req)
		},
		"confirm": func(rec *httptest.ResponseRecorder) {
			req := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx)
			req.SetPathValue("uuid", uuid.NewString())
			h.ConfirmAction(rec, req)
		},
		"speech": func(rec *httptest.ResponseRecorder) {
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"text":"merhaba"}`)).WithContext(ctx)
			h.Speech(rec, req)
		},
	} {
		rec := httptest.NewRecorder()
		call(rec)
		if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "43" || !strings.Contains(rec.Body.String(), "RATE_LIMITED") {
			t.Fatalf("%s: status = %d retry = %q body = %s", name, rec.Code, rec.Header().Get("Retry-After"), rec.Body)
		}
	}
	for _, c := range lim.calls {
		if c != "ai_msg:1" && c != "ai_voice:1" {
			t.Fatalf("limiter key = %q (must be per action and user)", c)
		}
	}
}
