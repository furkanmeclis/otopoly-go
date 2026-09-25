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
	// SendDocument uploads a document and sends it with body as caption.
	SendDocument(ctx context.Context, phone string, doc Document) (string, error)
	GenerateQR(ctx context.Context) (model.QRCodeResponse, error)
	Disconnect(ctx context.Context) error
	IsConnected() bool
	// RestoreSession reconnects a previously paired device from sqlstore.
	RestoreSession(orgID int64, jid string) error
}

// Document is a file attachment for WhatsApp (e.g. a quote PDF).
type Document struct {
	Data     []byte
	FileName string
	MimeType string
	// Caption is the message text shown under the document.
	Caption string
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

func (c *StubWhatsAppClient) SendDocument(_ context.Context, phone string, doc Document) (string, error) {
	if c.Log != nil {
		c.Log.Info("whatsapp_stub_send_document", "phone", phone, "file", doc.FileName,
			"mime", doc.MimeType, "size", len(doc.Data), "caption_len", len(doc.Caption))
	}
	return "stub-doc-" + fmt.Sprint(time.Now().UnixMilli()), nil
}

func (c *StubWhatsAppClient) GenerateQR(_ context.Context) (model.QRCodeResponse, error) {
	return model.QRCodeResponse{
		Code:      "stub-qr-code-scan-not-available",
		ExpiresAt: time.Now().Add(60 * time.Second),
	}, nil
}

func (c *StubWhatsAppClient) Disconnect(_ context.Context) error { return nil }
func (c *StubWhatsAppClient) IsConnected() bool                  { return false }
func (c *StubWhatsAppClient) RestoreSession(_ int64, _ string) error {
	return nil
}

func (p *WhatsAppProvider) Channel() string { return model.ChannelWhatsApp }

func (p *WhatsAppProvider) Send(ctx context.Context, phone, body string) (ref string, err error) {
	if p.client == nil {
		return "", fmt.Errorf("whatsapp client not initialized")
	}
	return p.client.Send(ctx, phone, body)
}

// SendDocument sends a document message with an optional caption.
func (p *WhatsAppProvider) SendDocument(ctx context.Context, phone string, doc Document) (string, error) {
	if p.client == nil {
		return "", fmt.Errorf("whatsapp client not initialized")
	}
	if len(doc.Data) == 0 {
		return "", fmt.Errorf("whatsapp document is empty")
	}
	return p.client.SendDocument(ctx, phone, doc)
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

func (p *WhatsAppProvider) RestoreSession(orgID int64, jid string) error {
	if p.client == nil {
		return fmt.Errorf("whatsapp client not initialized")
	}
	return p.client.RestoreSession(orgID, jid)
}
