package providers

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
)

// WhatsAppClient is the interface we'll implement with whatsmeow later.
type WhatsAppClient interface {
	Send(ctx context.Context, phone, body string) (string, error)
	GenerateQR(ctx context.Context) (model.QRCodeResponse, error)
	Disconnect(ctx context.Context) error
	IsConnected() bool
}

// WhatsAppProvider delivers messages via WhatsApp.
type WhatsAppProvider struct {
	client WhatsAppClient
	log    *slog.Logger
}

func NewWhatsAppProvider(client WhatsAppClient, log *slog.Logger) *WhatsAppProvider {
	return &WhatsAppProvider{client: client, log: log}
}

// StubWhatsAppClient is a no-op client for development/testing.
type StubWhatsAppClient struct {
	Log *slog.Logger
}

func (c *StubWhatsAppClient) Send(_ context.Context, phone, body string) (string, error) {
	if c.Log != nil {
		c.Log.Info("whatsapp_stub_send", "phone", phone, "body_len", len(body))
	}
	return "stub-ref-" + fmt.Sprint(time.Now().UnixMilli()), nil
}

func (c *StubWhatsAppClient) GenerateQR(_ context.Context) (model.QRCodeResponse, error) {
	return model.QRCodeResponse{
		Code:      "stub-qr-code-scan-not-available",
		ExpiresAt: time.Now().Add(60 * time.Second),
	}, nil
}

func (c *StubWhatsAppClient) Disconnect(_ context.Context) error { return nil }
func (c *StubWhatsAppClient) IsConnected() bool                  { return false }

func (p *WhatsAppProvider) Channel() string { return model.ChannelWhatsApp }

func (p *WhatsAppProvider) Send(ctx context.Context, phone, body string) (ref string, err error) {
	if p.client == nil {
		return "", fmt.Errorf("whatsapp client not initialized")
	}
	return p.client.Send(ctx, phone, body)
}

func (p *WhatsAppProvider) GenerateQR(ctx context.Context) (model.QRCodeResponse, error) {
	if p.client == nil {
		return model.QRCodeResponse{}, fmt.Errorf("whatsapp client not initialized")
	}
	return p.client.GenerateQR(ctx)
}

func (p *WhatsAppProvider) Disconnect(ctx context.Context) error {
	if p.client == nil {
		return nil
	}
	return p.client.Disconnect(ctx)
}
