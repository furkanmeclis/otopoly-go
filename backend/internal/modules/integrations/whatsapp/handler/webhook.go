package handler

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	whatsappusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

// MaxWebhookBody caps one Meta webhook notification.
const MaxWebhookBody = 1 << 20

// Public webhook limits per client IP (Meta batches statuses; retries on 429).
const (
	webhookVerifyLimit = 30
	webhookNotifyLimit = 1200
	webhookWindow      = time.Minute
)

// RateLimiter is the fixed-window limiter used on public routes (nil = off).
type RateLimiter interface {
	Allow(ctx context.Context, action, subject string, limit int, window time.Duration) (bool, time.Duration)
}

// WebhookHandler serves the public Meta webhook.
type WebhookHandler struct {
	wh      *whatsappusecase.Webhook
	limiter RateLimiter
	log     *slog.Logger
}

// NewWebhookHandler builds the webhook handler (limiter / log may be nil).
func NewWebhookHandler(wh *whatsappusecase.Webhook, limiter RateLimiter, log *slog.Logger) *WebhookHandler {
	if log == nil {
		log = slog.Default()
	}
	return &WebhookHandler{wh: wh, limiter: limiter, log: log}
}

func (h *WebhookHandler) allow(w http.ResponseWriter, r *http.Request, action string, limit int) bool {
	if h.limiter == nil {
		return true
	}
	if ok, _ := h.limiter.Allow(r.Context(), action, clientIP(r), limit, webhookWindow); !ok {
		response.TooManyRequests(w, r, "too many requests")
		return false
	}
	return true
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return host
}

// Verify is Meta's subscription handshake (GET): echoes hub.challenge as
// text/plain when hub.mode=subscribe and hub.verify_token match, else 403.
func (h *WebhookHandler) Verify(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, "whatsapp_webhook_verify", webhookVerifyLimit) {
		return
	}
	q := r.URL.Query()
	challenge, err := h.wh.VerifySubscription(r.Context(), q.Get("hub.mode"), q.Get("hub.verify_token"), q.Get("hub.challenge"))
	if err != nil {
		response.Forbidden(w, r, "webhook verification failed")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, challenge)
}

// Notify receives notifications (POST). The signature over the raw body is
// checked first (401, nothing processed); after that the response is always
// 200 so Meta does not redeliver because of one bad entry.
func (h *WebhookHandler) Notify(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, "whatsapp_webhook_notify", webhookNotifyLimit) {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxWebhookBody))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			response.Error(w, r, http.StatusRequestEntityTooLarge, response.CodeValidationError, "payload too large")
			return
		}
		response.BadRequest(w, r, response.CodeValidationError, "invalid body")
		return
	}
	if err := h.wh.VerifySignature(r.Context(), r.Header, body); err != nil {
		response.Unauthorized(w, r, "invalid signature")
		return
	}
	res := h.wh.Process(r.Context(), body)
	h.log.Debug("whatsapp webhook processed",
		"statuses", res.Statuses, "templates", res.Templates, "ignored", res.Ignored, "failed", res.Failed)
	response.JSON(w, r, http.StatusOK, map[string]bool{"received": true})
}
