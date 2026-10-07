package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/catalog"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/cloud"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// FeatureOwnNumber is the plan toggle that lets a business send from its own
// WhatsApp number.
const FeatureOwnNumber = "whatsapp.own_number"

// Plan gates of every WhatsApp send (platform-number sends are checked in
// deliverWhatsApp; QueueSend checks them for queued sends of any sender).
const (
	FeatureWhatsAppEnabled = "whatsapp.enabled"
	FeatureWhatsAppMonthly = "whatsapp.monthly"
)

// Platform provider values (platform_whatsapp_settings.provider).
const (
	PlatformProviderNone      = "none"
	PlatformProviderWhatsmeow = "whatsmeow"
	PlatformProviderCloud     = "cloud"
)

// Cloud template status that allows sending.
const templateStatusApproved = "approved"

// ErrNotEntitled is returned when the plan lacks whatsapp.own_number.
var ErrNotEntitled = errors.New("feature not entitled")

// CloudSender sends Meta templates from the platform Cloud API number.
type CloudSender interface {
	SendTemplate(ctx context.Context, phone string, m cloud.TemplateMessage) (string, error)
}

// ownNumberEntitled reports the whatsapp.own_number toggle.
func (s *Service) ownNumberEntitled(ctx context.Context, orgID int64) (bool, error) {
	return s.ent.Enabled(ctx, orgID, FeatureOwnNumber)
}

func (s *Service) requireOwnNumber(ctx context.Context, orgID int64) error {
	ok, err := s.ownNumberEntitled(ctx, orgID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotEntitled
	}
	return nil
}

// Resolve picks the sender for an organization (spec "SenderResolver"):
//  1. own number entitled and own session connected → org_own;
//  2. entitled but disconnected → platform when fallback_to_platform, else
//     own_session_disconnected;
//  3. platform provider: cloud → platform_cloud, whatsmeow (connected) →
//     platform_whatsmeow; otherwise not configured / unavailable.
//
// Sessions of organizations without the feature are kept but never used.
func (s *Service) Resolve(ctx context.Context, orgID int64) (string, error) {
	entitled, err := s.ownNumberEntitled(ctx, orgID)
	if err != nil {
		return "", err
	}
	if entitled {
		fallback := true
		sess, err := s.q.GetWhatsAppSession(ctx, orgID)
		switch {
		case err == nil:
			if sess.Status == model.StatusConnected {
				return model.SenderOrgOwn, nil
			}
			fallback = sess.FallbackToPlatform
		case errors.Is(err, pgx.ErrNoRows):
		default:
			return "", fmt.Errorf("resolve sender: %w", err)
		}
		if !fallback {
			return "", model.NewSendError(model.ErrCodeOwnSessionDisconnected, false,
				errors.New("whatsapp session is not connected and platform fallback is off"))
		}
	}
	return s.platformKind(ctx)
}

func (s *Service) platformKind(ctx context.Context) (string, error) {
	st, err := s.q.GetPlatformWhatsAppSettings(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, errors.New("platform sender is not configured"))
	}
	if err != nil {
		return "", fmt.Errorf("platform sender settings: %w", err)
	}
	switch st.Provider {
	case PlatformProviderCloud:
		if strings.TrimSpace(st.PhoneNumberID) == "" || len(st.AccessTokenEnc) == 0 {
			return "", model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, errors.New("cloud api credentials missing"))
		}
		return model.SenderPlatformCloud, nil
	case PlatformProviderWhatsmeow:
		if st.WmStatus != model.StatusConnected || strings.TrimSpace(st.WmJid) == "" {
			return "", model.NewSendError(model.ErrCodePlatformSenderUnavailable, true, errors.New("platform whatsapp number is not connected"))
		}
		return model.SenderPlatformWhatsmeow, nil
	default:
		return "", model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, errors.New("platform sender is not configured"))
	}
}

// WhatsAppAvailable reports whether WhatsApp messages of the organization
// can currently be sent (own number or platform fallback).
func (s *Service) WhatsAppAvailable(ctx context.Context, orgID int64) (bool, error) {
	_, err := s.Resolve(ctx, orgID)
	if err == nil {
		return true, nil
	}
	var se *model.SendError
	if errors.As(err, &se) {
		return false, nil
	}
	return false, err
}

// outboundDelivery is one WhatsApp message ready for the resolver.
type outboundDelivery struct {
	OrgID     int64
	EventType string
	Phone     string
	// Body is the org-rendered text (own number only).
	Body string
	// Vars feed the platform catalog entry.
	Vars map[string]string
	Doc  *providers.Document
	// QuotaReserved is set for queued rows: QueueSend already checked and
	// counted whatsapp.monthly, so only whatsapp.enabled is re-checked.
	QuotaReserved bool
}

// deliveryResult records how a message was (or would have been) sent.
type deliveryResult struct {
	Ref          string
	SenderKind   string
	TemplateName string
}

// deliverWhatsApp sends through the resolved sender. Every WhatsApp path
// (Dispatch, SendDirect, Simulate, queued sends) goes through here.
// Platform-number sends must pass whatsapp.enabled and whatsapp.monthly and
// count toward the monthly quota; own-number sends keep their existing gates.
func (s *Service) deliverWhatsApp(ctx context.Context, d outboundDelivery) (deliveryResult, error) {
	kind, err := s.Resolve(ctx, d.OrgID)
	if err != nil {
		return deliveryResult{}, err
	}
	platform := kind != model.SenderOrgOwn
	if platform {
		if err := s.checkPlatformPlan(ctx, d.OrgID, d.QuotaReserved); err != nil {
			return deliveryResult{SenderKind: kind}, err
		}
	}
	res, err := s.sendVia(ctx, kind, d)
	if err == nil && platform && !d.QuotaReserved {
		_ = s.ent.Consume(ctx, d.OrgID, FeatureWhatsAppMonthly, 1)
	}
	return res, err
}

// checkPlatformPlan gates a platform-number send on whatsapp.enabled and,
// unless already reserved by QueueSend, one more whatsapp.monthly unit.
func (s *Service) checkPlatformPlan(ctx context.Context, orgID int64, reserved bool) error {
	on, err := s.ent.Enabled(ctx, orgID, FeatureWhatsAppEnabled)
	if err != nil {
		return fmt.Errorf("whatsapp entitlement: %w", err)
	}
	if !on {
		return model.NewSendError(model.ErrCodeFeatureNotEntitled, false, entitlements.ErrFeatureDisabled)
	}
	if reserved {
		return nil
	}
	if _, err := s.ent.Check(ctx, orgID, FeatureWhatsAppMonthly, 1); err != nil {
		if errors.Is(err, entitlements.ErrLimitReached) {
			return model.NewSendError(model.ErrCodeQuotaExceeded, false, err)
		}
		return fmt.Errorf("whatsapp quota: %w", err)
	}
	return nil
}

// sendVia sends one message with an already resolved sender kind.
func (s *Service) sendVia(ctx context.Context, kind string, d outboundDelivery) (deliveryResult, error) {
	var err error
	res := deliveryResult{SenderKind: kind}
	if kind == model.SenderOrgOwn {
		if s.wp == nil {
			return res, fmt.Errorf("%w: whatsapp provider not configured", ErrChannelUnavailable)
		}
		if _, ok := orgctx.ScopeFrom(ctx); !ok {
			ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: d.OrgID})
		}
		_ = s.EnsureWhatsAppConnected(ctx, d.OrgID)
		res.Ref, err = s.sendWhatsmeow(ctx, d.Phone, d.Body, d.Doc)
		return res, err
	}

	d.Vars = s.withPlatformInfo(ctx, d.Vars)
	entry, ok := catalog.Lookup(d.EventType)
	if !ok {
		return res, model.NewSendError(model.ErrCodeTemplateMissing, false,
			fmt.Errorf("no platform catalog entry for %q", d.EventType))
	}
	if kind == model.SenderPlatformWhatsmeow {
		res.TemplateName = entry.MetaName
		if s.wp == nil {
			return res, model.NewSendError(model.ErrCodePlatformSenderUnavailable, true, errors.New("whatsapp provider not configured"))
		}
		pctx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: model.PlatformOrgKey})
		_ = s.ensurePlatformConnected(pctx)
		res.Ref, err = s.sendWhatsmeow(pctx, d.Phone, entry.RenderText(d.Vars), d.Doc)
		return res, err
	}

	// platform_cloud
	row, err := s.q.GetWhatsAppCloudTemplateByKey(ctx, entry.Key)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		res.TemplateName = entry.MetaName
		return res, model.NewSendError(model.ErrCodeTemplateNotApproved, false, fmt.Errorf("template %s not seeded", entry.Key))
	case err != nil:
		return res, fmt.Errorf("cloud template: %w", err)
	}
	res.TemplateName = EffectiveTemplateName(row)
	if row.Status != templateStatusApproved {
		return res, model.NewSendError(model.ErrCodeTemplateNotApproved, false,
			fmt.Errorf("template %s is %s", res.TemplateName, row.Status))
	}
	if s.cloud == nil {
		return res, model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, errors.New("cloud sender not configured"))
	}
	msg := cloud.TemplateMessage{Name: res.TemplateName, Language: row.Language}
	if entry.CopyCodeButton {
		msg.OTPCode = catalog.SanitizeParam(d.Vars["code"])
	} else {
		msg.BodyParams = entry.ParamValues(d.Vars)
	}
	if entry.HeaderDocument {
		if d.Doc == nil || len(d.Doc.Data) == 0 {
			return res, model.NewSendError(model.ErrCodeTemplateParamMismatch, false,
				fmt.Errorf("template %s needs a document", res.TemplateName))
		}
		msg.Document = &cloud.Document{Data: d.Doc.Data, FileName: d.Doc.FileName, MimeType: d.Doc.MimeType}
	}
	res.Ref, err = s.cloud.SendTemplate(ctx, d.Phone, msg)
	return res, err
}

// EffectiveTemplateName is the admin override or the catalog Meta name.
func EffectiveTemplateName(row db.WhatsappCloudTemplate) string {
	if row.OverrideName.Valid && strings.TrimSpace(row.OverrideName.String) != "" {
		return strings.TrimSpace(row.OverrideName.String)
	}
	return row.MetaName
}

func (s *Service) sendWhatsmeow(ctx context.Context, phone, text string, doc *providers.Document) (string, error) {
	if doc != nil && len(doc.Data) > 0 {
		d := *doc
		d.Caption = text
		return s.wp.SendDocument(ctx, phone, d)
	}
	return s.wp.Send(ctx, phone, text)
}

// recordSender persists sender_kind / template_name / error_code of a send.
func (s *Service) recordSender(ctx context.Context, id int64, res deliveryResult, sendErr error) {
	code := ""
	if sendErr != nil {
		code = model.ErrorCodeOf(sendErr)
		if code == "" {
			code = model.ErrCodeSendFailed
		}
	}
	if res.SenderKind == "" && code == "" {
		return
	}
	_ = s.q.SetOutboundMessageSender(ctx, db.SetOutboundMessageSenderParams{
		ID:           id,
		SenderKind:   optText(res.SenderKind),
		TemplateName: optText(res.TemplateName),
		ErrorCode:    optText(code),
	})
}

func optText(v string) pgtype.Text {
	if v == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: v, Valid: true}
}
