package usecase

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/cloud"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/piusalfred/whatsapp/webhooks"
)

// Webhook errors. Callers map them to 403 (subscription) / 401 (signature).
var (
	ErrWebhookVerifyFailed = errors.New("webhook verification failed")
	ErrWebhookSignature    = errors.New("webhook signature invalid")
)

// Delivery statuses stored on outbound_messages.delivery_status.
const (
	DeliverySent      = "sent"
	DeliveryDelivered = "delivered"
	DeliveryRead      = "read"
	DeliveryFailed    = "failed"
)

type webhookStore interface {
	GetPlatformWhatsAppSettings(ctx context.Context) (db.PlatformWhatsappSetting, error)
	ApplyOutboundDeliveryStatus(ctx context.Context, arg db.ApplyOutboundDeliveryStatusParams) (int64, error)
	UpdateWhatsAppCloudTemplateStatusByMetaID(ctx context.Context, arg db.UpdateWhatsAppCloudTemplateStatusByMetaIDParams) (int64, error)
	UpdateWhatsAppCloudTemplateStatusByName(ctx context.Context, arg db.UpdateWhatsAppCloudTemplateStatusByNameParams) (int64, error)
}

// Webhook handles the public Meta webhook: subscription handshake, payload
// signature, delivery statuses and template status updates. Customer
// messages are acknowledged and dropped (nothing is stored).
type Webhook struct {
	q   webhookStore
	box *crypto.SecretBox
	log *slog.Logger
	now func() time.Time
}

// NewWebhook builds the webhook processor (log may be nil).
func NewWebhook(q webhookStore, box *crypto.SecretBox, log *slog.Logger) *Webhook {
	if log == nil {
		log = slog.Default()
	}
	return &Webhook{q: q, box: box, log: log, now: time.Now}
}

func (w *Webhook) secret(ctx context.Context, pick func(db.PlatformWhatsappSetting) []byte) (string, error) {
	row, err := w.q.GetPlatformWhatsAppSettings(ctx)
	if err != nil {
		return "", err
	}
	enc := pick(row)
	if len(enc) == 0 {
		return "", ErrNotConfigured
	}
	plain, err := w.box.Decrypt(string(enc))
	if err != nil {
		return "", fmt.Errorf("decrypt webhook secret: %w", err)
	}
	if plain == "" {
		return "", ErrNotConfigured
	}
	return plain, nil
}

// VerifySubscription answers Meta's GET handshake: hub.mode=subscribe and
// the stored verify token (constant-time) → the challenge to echo.
func (w *Webhook) VerifySubscription(ctx context.Context, mode, token, challenge string) (string, error) {
	if mode != "subscribe" || token == "" || challenge == "" {
		return "", ErrWebhookVerifyFailed
	}
	want, err := w.secret(ctx, func(r db.PlatformWhatsappSetting) []byte { return r.WebhookVerifyTokenEnc })
	if err != nil {
		if !errors.Is(err, ErrNotConfigured) {
			w.log.Warn("whatsapp webhook verify token unavailable", "err", err)
		}
		return "", ErrWebhookVerifyFailed
	}
	if subtle.ConstantTimeCompare([]byte(token), []byte(want)) != 1 {
		return "", ErrWebhookVerifyFailed
	}
	return challenge, nil
}

// VerifySignature checks X-Hub-Signature-256 over the raw body with the
// stored app secret (library helper, HMAC-SHA256 with hmac.Equal). A missing
// app secret fails closed.
func (w *Webhook) VerifySignature(ctx context.Context, header http.Header, body []byte) error {
	secret, err := w.secret(ctx, func(r db.PlatformWhatsappSetting) []byte { return r.AppSecretEnc })
	if err != nil {
		if !errors.Is(err, ErrNotConfigured) {
			w.log.Warn("whatsapp webhook app secret unavailable", "err", err)
		}
		return ErrWebhookSignature
	}
	if err := webhooks.VerifyPayloadSignature(header, body, secret); err != nil {
		return ErrWebhookSignature
	}
	return nil
}

// WebhookResult counts what one notification changed (for logs and tests).
type WebhookResult struct {
	Statuses  int // delivery rows updated
	Templates int // template rows updated
	Ignored   int // changes / items acknowledged without effect
	Failed    int // changes that errored (logged, still acknowledged)
}

type webhookPayload struct {
	Object string `json:"object"`
	Entry  []struct {
		Changes []struct {
			Field string          `json:"field"`
			Value json.RawMessage `json:"value"`
		} `json:"changes"`
	} `json:"entry"`
}

type statusValue struct {
	// Messages (inbound customer messages) are deliberately not decoded.
	Statuses []struct {
		ID        string `json:"id"`
		Status    string `json:"status"`
		Timestamp string `json:"timestamp"`
		Pricing   *struct {
			Billable *bool  `json:"billable"`
			Category string `json:"category"`
		} `json:"pricing"`
		Errors []struct {
			Code int `json:"code"`
		} `json:"errors"`
	} `json:"statuses"`
}

type templateStatusValue struct {
	Event    string          `json:"event"`
	ID       json.RawMessage `json:"message_template_id"`
	Name     string          `json:"message_template_name"`
	Language string          `json:"message_template_language"`
	Reason   string          `json:"reason"`
}

// Process applies one verified notification. It never fails the request:
// bad entries are logged (without payload or phone numbers) and skipped.
func (w *Webhook) Process(ctx context.Context, body []byte) WebhookResult {
	var res WebhookResult
	var p webhookPayload
	if err := json.Unmarshal(body, &p); err != nil {
		w.log.Warn("whatsapp webhook: undecodable payload", "bytes", len(body))
		res.Failed++
		return res
	}
	for ei, entry := range p.Entry {
		for ci, ch := range entry.Changes {
			var err error
			switch ch.Field {
			case "messages":
				err = w.applyStatuses(ctx, ch.Value, &res)
			case "message_template_status_update":
				err = w.applyTemplateStatus(ctx, ch.Value, &res)
			default:
				res.Ignored++
			}
			if err != nil {
				res.Failed++
				w.log.Warn("whatsapp webhook change failed", "entry", ei, "change", ci, "field", ch.Field, "err", err)
			}
		}
	}
	return res
}

func (w *Webhook) applyStatuses(ctx context.Context, raw json.RawMessage, res *WebhookResult) error {
	var v statusValue
	if err := json.Unmarshal(raw, &v); err != nil {
		return fmt.Errorf("decode statuses: %w", err)
	}
	if len(v.Statuses) == 0 {
		res.Ignored++ // inbound messages etc.: acknowledged, not stored
		return nil
	}
	var errs []error
	for _, st := range v.Statuses {
		status := strings.ToLower(strings.TrimSpace(st.Status))
		if st.ID == "" || (status != DeliverySent && status != DeliveryDelivered && status != DeliveryRead && status != DeliveryFailed) {
			res.Ignored++
			continue
		}
		arg := db.ApplyOutboundDeliveryStatusParams{
			DeliveryStatus:    status,
			DeliveryStatusAt:  pgtype.Timestamptz{Time: w.statusTime(st.Timestamp), Valid: true},
			ProviderReference: st.ID,
		}
		if st.Pricing != nil {
			if c := strings.ToLower(strings.TrimSpace(st.Pricing.Category)); c != "" {
				arg.PricingCategory = pgtype.Text{String: c, Valid: true}
			}
			if st.Pricing.Billable != nil {
				arg.Billable = pgtype.Bool{Bool: *st.Pricing.Billable, Valid: true}
			}
		}
		if status == DeliveryFailed {
			code := model.ErrCodeSendFailed
			if len(st.Errors) > 0 {
				code = cloud.GraphErrorCode(st.Errors[0].Code)
			}
			arg.ErrorCode = pgtype.Text{String: code, Valid: true}
		}
		n, err := w.q.ApplyOutboundDeliveryStatus(ctx, arg)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if n == 0 {
			res.Ignored++ // unknown wamid (not ours / not stored)
			continue
		}
		res.Statuses++
	}
	return errors.Join(errs...)
}

func (w *Webhook) statusTime(ts string) time.Time {
	if sec, err := strconv.ParseInt(strings.TrimSpace(ts), 10, 64); err == nil && sec > 0 {
		return time.Unix(sec, 0).UTC()
	}
	return w.now().UTC()
}

// webhookTemplateStatus maps message_template_status_update events.
// Unknown events are ignored rather than guessed.
func webhookTemplateStatus(event string) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(event)) {
	case "APPROVED", "REINSTATED", "FLAGGED": // flagged templates still send
		return "approved", true
	case "PENDING", "IN_APPEAL":
		return "pending", true
	case "REJECTED":
		return "rejected", true
	case "PAUSED":
		return "paused", true
	case "DISABLED", "ARCHIVED", "LIMIT_EXCEEDED":
		return "disabled", true
	case "PENDING_DELETION", "DELETED":
		return "not_submitted", true
	}
	return "", false
}

func (w *Webhook) applyTemplateStatus(ctx context.Context, raw json.RawMessage, res *WebhookResult) error {
	var v templateStatusValue
	if err := json.Unmarshal(raw, &v); err != nil {
		return fmt.Errorf("decode template status: %w", err)
	}
	status, ok := webhookTemplateStatus(v.Event)
	if !ok {
		res.Ignored++
		return nil
	}
	reason := ""
	if status == "rejected" && !strings.EqualFold(strings.TrimSpace(v.Reason), "NONE") {
		reason = strings.TrimSpace(v.Reason)
	}
	metaID := strings.Trim(strings.TrimSpace(string(v.ID)), `"`)
	if metaID == "null" {
		metaID = ""
	}
	if metaID != "" {
		n, err := w.q.UpdateWhatsAppCloudTemplateStatusByMetaID(ctx, db.UpdateWhatsAppCloudTemplateStatusByMetaIDParams{
			Status: status, RejectedReason: reason, MetaTemplateID: metaID,
		})
		if err != nil {
			return err
		}
		if n > 0 {
			res.Templates += int(n)
			return nil
		}
	}
	name := strings.TrimSpace(v.Name)
	if name == "" {
		res.Ignored++
		return nil
	}
	lang := strings.TrimSpace(v.Language)
	if lang == "" {
		lang = "tr"
	}
	n, err := w.q.UpdateWhatsAppCloudTemplateStatusByName(ctx, db.UpdateWhatsAppCloudTemplateStatusByNameParams{
		Status: status, RejectedReason: reason, MetaTemplateID: metaID, Name: name, Language: lang,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		res.Ignored++ // not a catalog template
		return nil
	}
	res.Templates += int(n)
	return nil
}
