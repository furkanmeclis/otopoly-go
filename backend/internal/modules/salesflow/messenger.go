package salesflow

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
	"github.com/google/uuid"
)

var (
	_ quotesusecase.QuoteMessenger = (*Integration)(nil)
	_ quotesusecase.QuotePreviewer = (*Integration)(nil)
)

// sendChannels: WhatsApp always; e-mail as well when the organization rule
// for quote.sent enables it and the customer has an address.
func (x *Integration) sendChannels(ctx context.Context, m quotesusecase.QuoteMessage) []string {
	out := []string{centermodel.ChannelWhatsApp}
	if strings.TrimSpace(m.CustomerEmail) == "" || x.channels == nil {
		return out
	}
	rules, err := x.channels.RuleChannels(ctx, m.OrganizationID, KindQuoteSent)
	if err != nil {
		x.log.Warn("quote_send_rules_failed", "org_id", m.OrganizationID, "error", err)
		return out
	}
	if slices.Contains(rules, centermodel.ChannelEmail) {
		out = append(out, centermodel.ChannelEmail)
	}
	return out
}

func (x *Integration) whatsAppReady(ctx context.Context, orgID int64) error {
	if x.channels == nil {
		return ErrWhatsAppNotConnected
	}
	ok, err := x.channels.WhatsAppConnected(ctx, orgID)
	if err != nil {
		return fmt.Errorf("whatsapp status: %w", err)
	}
	if !ok {
		return ErrWhatsAppNotConnected
	}
	return nil
}

// SendQuote implements quotesusecase.QuoteMessenger: one Dispatch per
// delivery attempt (explicit dedupe key), PDF attached, no background retry
// (the quote UI retries a failed delivery explicitly). ProviderRef is the
// notification uuid, used to match a later asynchronous WhatsApp failure.
func (x *Integration) SendQuote(ctx context.Context, m quotesusecase.QuoteMessage) (quotesusecase.QuoteSendResult, error) {
	if strings.TrimSpace(m.CustomerPhone) == "" {
		return quotesusecase.QuoteSendResult{}, ErrCustomerNoPhone
	}
	ctx = withOrg(ctx, m.OrganizationID)
	if err := x.whatsAppReady(ctx, m.OrganizationID); err != nil {
		return quotesusecase.QuoteSendResult{}, err
	}
	n := x.sendNotification(ctx, m)
	res, err := x.center.Dispatch(ctx, n)
	if err != nil {
		return quotesusecase.QuoteSendResult{}, err
	}
	if !slices.Contains(res.Delivered, centermodel.ChannelWhatsApp) {
		reason := res.LastError
		if reason == "" {
			reason = "whatsapp message was not queued (" + res.Status + ")"
		}
		return quotesusecase.QuoteSendResult{}, errors.New(reason)
	}
	return quotesusecase.QuoteSendResult{Channel: centermodel.ChannelWhatsApp, ProviderRef: res.UUID.String()}, nil
}

func (x *Integration) sendNotification(ctx context.Context, m quotesusecase.QuoteMessage) centermodel.Notification {
	attempt := m.DeliveryUUID.String()
	if m.DeliveryUUID == uuid.Nil {
		attempt = uuid.NewString()
	}
	n := centermodel.Notification{
		OrgID: m.OrganizationID, Kind: KindQuoteSent,
		SubjectType: SubjectQuote, SubjectID: m.QuoteID,
		Recipient: centermodel.Recipient{CustomerID: m.CustomerID},
		Channels:  x.sendChannels(ctx, m),
		Vars:      quoteVars(m), Locale: localeOf(m.Locale),
		DedupeKey:   fmt.Sprintf("%s:%s:%s:%d", KindQuoteSent, m.QuoteUUID, attempt, m.Attempt),
		MaxAttempts: 1,
	}
	if m.CustomerID <= 0 {
		// Fallback (should not happen): address the phone directly.
		n.Recipient = centermodel.Recipient{Phone: m.CustomerPhone}
	}
	switch {
	case m.PDFObjectKey != "":
		n.Attachment = &centermodel.Attachment{ObjectKey: m.PDFObjectKey, FileName: m.PDFFileName, MimeType: "application/pdf"}
	case len(m.PDF) > 0:
		n.Attachment = &centermodel.Attachment{Data: m.PDF, FileName: m.PDFFileName, MimeType: "application/pdf"}
	}
	return n
}

// PreviewQuote renders the WhatsApp text of quote.sent for the send dialog.
func (x *Integration) PreviewQuote(ctx context.Context, m quotesusecase.QuoteMessage) (quotesusecase.QuotePreview, error) {
	ctx = withOrg(ctx, m.OrganizationID)
	locale := localeOf(m.Locale)
	out := quotesusecase.QuotePreview{
		Channel: centermodel.ChannelWhatsApp, CustomerPhone: m.CustomerPhone, AttachmentFileName: m.PDFFileName,
	}
	if x.channels == nil {
		return out, nil
	}
	ok, err := x.channels.WhatsAppConnected(ctx, m.OrganizationID)
	if err != nil {
		return out, err
	}
	out.ChannelConnected = ok
	tpl, found, err := x.channels.ResolveTemplate(ctx, m.OrganizationID, KindQuoteSent, centermodel.ChannelWhatsApp, locale)
	if err != nil {
		return out, err
	}
	if !found {
		return out, nil
	}
	out.TemplateActive = tpl.Active
	vars := quoteVars(m)
	if m.ValidUntil != nil {
		vars["valid_until"] = centerusecase.FormatDate(*m.ValidUntil, locale)
	}
	out.Message = msgtemplate.Render(tpl.Body, vars)
	return out, nil
}
