package providers

import (
	"context"
	"log/slog"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
)

// SMSSender is the interface future SMS gateways (Twilio, Netgsm) will implement.
type SMSSender interface {
	Send(ctx context.Context, phone, body string) (string, error)
}

// NoopSMSProvider logs and does nothing — used until a real gateway is configured.
type NoopSMSProvider struct {
	Log *slog.Logger
}

func (p *NoopSMSProvider) Channel() string { return model.ChannelSMS }

func (p *NoopSMSProvider) Send(_ context.Context, phone, body string) (string, error) {
	if p.Log != nil {
		p.Log.Info("sms_noop_send", "phone", phone, "body_len", len(body))
	}
	return "noop", nil
}
