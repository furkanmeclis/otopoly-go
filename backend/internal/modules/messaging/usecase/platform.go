package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/catalog"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/cloud"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/jackc/pgx/v5/pgtype"
)

// The platform whatsmeow number reuses the org client manager under the
// reserved key model.PlatformOrgKey; its state lives in
// platform_whatsapp_settings (wm_*) instead of whatsapp_sessions.

func platformCtx(ctx context.Context) context.Context {
	return orgctx.WithScope(ctx, orgctx.Scope{InternalID: model.PlatformOrgKey})
}

// ConnectPlatformWhatsApp starts QR pairing of the platform number. The QR
// arrives through UpdatePlatformSessionQR and is polled from the settings.
func (s *Service) ConnectPlatformWhatsApp(ctx context.Context) error {
	if s.wp == nil {
		return fmt.Errorf("%w: whatsapp provider not configured", ErrInvalidRequest)
	}
	if _, err := s.q.UpdatePlatformWhatsAppSession(ctx, db.UpdatePlatformWhatsAppSessionParams{
		WmStatus: model.StatusQRPending,
	}); err != nil {
		return fmt.Errorf("ConnectPlatformWhatsApp: %w", err)
	}
	if _, err := s.wp.GenerateQR(platformCtx(ctx)); err != nil {
		_, _ = s.q.UpdatePlatformWhatsAppSession(ctx, db.UpdatePlatformWhatsAppSessionParams{
			WmStatus: model.StatusError, WmError: err.Error(),
		})
		return fmt.Errorf("ConnectPlatformWhatsApp: %w", err)
	}
	return nil
}

// DisconnectPlatformWhatsApp logs the platform number out.
func (s *Service) DisconnectPlatformWhatsApp(ctx context.Context) error {
	if s.wp != nil {
		_ = s.wp.Disconnect(platformCtx(ctx))
	}
	if _, err := s.q.UpdatePlatformWhatsAppSession(ctx, db.UpdatePlatformWhatsAppSessionParams{
		WmStatus: model.StatusDisconnected,
	}); err != nil {
		return fmt.Errorf("DisconnectPlatformWhatsApp: %w", err)
	}
	return nil
}

// UpdatePlatformSessionQR persists a pairing QR of the platform number.
func (s *Service) UpdatePlatformSessionQR(ctx context.Context, code string, expiresAt time.Time) error {
	_, err := s.q.UpdatePlatformWhatsAppQR(ctx, db.UpdatePlatformWhatsAppQRParams{
		WmQrCode:      code,
		WmQrExpiresAt: pgtype.Timestamptz{Time: expiresAt.UTC(), Valid: true},
	})
	return err
}

// UpdatePlatformSessionConnected records whatsmeow connect/logout events.
func (s *Service) UpdatePlatformSessionConnected(ctx context.Context, jid, phone string, connected bool) error {
	p := db.UpdatePlatformWhatsAppSessionParams{WmStatus: model.StatusDisconnected}
	if connected {
		p = db.UpdatePlatformWhatsAppSessionParams{WmStatus: model.StatusConnected, WmJid: jid, WmPhone: phone}
	}
	_, err := s.q.UpdatePlatformWhatsAppSession(ctx, p)
	return err
}

// ensurePlatformConnected restores the platform client from sqlstore when the
// DB says connected but this process has no live client.
func (s *Service) ensurePlatformConnected(ctx context.Context) error {
	if s.wp == nil {
		return errors.New("whatsapp provider not configured")
	}
	st, err := s.q.GetPlatformWhatsAppSettings(ctx)
	if err != nil {
		return err
	}
	if st.WmStatus != model.StatusConnected || strings.TrimSpace(st.WmJid) == "" {
		return errors.New("platform whatsapp number not connected")
	}
	return s.wp.RestoreSession(model.PlatformOrgKey, st.WmJid)
}

// RestorePlatformSession reconnects the platform number after process start.
func (s *Service) RestorePlatformSession(ctx context.Context) {
	if s.wp == nil {
		return
	}
	go func() { _ = s.ensurePlatformConnected(ctx) }()
}

// PlatformTestInput is a platform test send.
type PlatformTestInput struct {
	Phone string `json:"phone"`
	// TemplateKey is a catalog key; empty sends Meta's hello_world (Cloud)
	// or a plain test line (whatsmeow).
	TemplateKey string `json:"template_key"`
}

// PlatformTestResult is the outcome of a platform test send.
type PlatformTestResult struct {
	SenderKind        string `json:"sender_kind"`
	TemplateName      string `json:"template_name"`
	ProviderReference string `json:"provider_reference"`
}

// helloWorld is the sample template every new WABA has.
const helloWorld = "hello_world"

// SendPlatformTest sends a test message from the platform number using the
// configured provider (catalog examples as parameters).
func (s *Service) SendPlatformTest(ctx context.Context, in PlatformTestInput) (PlatformTestResult, error) {
	phone := strings.TrimSpace(in.Phone)
	if phone == "" {
		return PlatformTestResult{}, fmt.Errorf("%w: phone is required", ErrInvalidRequest)
	}
	var entry catalog.Entry
	if key := strings.TrimSpace(in.TemplateKey); key != "" {
		e, ok := catalog.Lookup(key)
		if !ok {
			return PlatformTestResult{}, fmt.Errorf("%w: unknown template_key", ErrInvalidRequest)
		}
		entry = e
	}
	kind, err := s.platformKind(ctx)
	if err != nil {
		return PlatformTestResult{}, err
	}
	out := PlatformTestResult{SenderKind: kind}
	examples := map[string]string{}
	for i, p := range entry.Params {
		examples[p] = entry.Examples[i]
	}
	if kind == model.SenderPlatformWhatsmeow {
		if s.wp == nil {
			return out, model.NewSendError(model.ErrCodePlatformSenderUnavailable, true, errors.New("whatsapp provider not configured"))
		}
		text := "Otopoly platform WhatsApp test mesajı."
		if entry.Key != "" {
			out.TemplateName = entry.MetaName
			examples["minutes"] = "5"
			text = entry.RenderText(examples)
		}
		pctx := platformCtx(ctx)
		_ = s.ensurePlatformConnected(pctx)
		out.ProviderReference, err = s.wp.Send(pctx, phone, text)
		return out, err
	}
	if s.cloud == nil {
		return out, model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, errors.New("cloud sender not configured"))
	}
	msg := cloud.TemplateMessage{Name: helloWorld, Language: "en_US"}
	if entry.Key != "" {
		msg = cloud.TemplateMessage{Name: entry.MetaName, Language: entry.Language}
		if row, err := s.q.GetWhatsAppCloudTemplateByKey(ctx, entry.Key); err == nil {
			msg.Name, msg.Language = EffectiveTemplateName(row), row.Language
		}
		if entry.CopyCodeButton {
			msg.OTPCode = entry.Examples[0]
		} else {
			msg.BodyParams = entry.ParamValues(examples)
		}
		if entry.HeaderDocument {
			msg.Document = &cloud.Document{Data: testPDF, FileName: "test.pdf", MimeType: "application/pdf"}
		}
	}
	out.TemplateName = msg.Name
	out.ProviderReference, err = s.cloud.SendTemplate(ctx, phone, msg)
	return out, err
}

var testPDF = []byte("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
	"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
	"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
	"trailer<</Root 1 0 R>>\n%%EOF\n")
