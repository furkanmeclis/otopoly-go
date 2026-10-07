package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/catalog"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/cloud"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const testOrg int64 = 42

// fakeQ implements the Querier subset used by the resolver and send paths.
type fakeQ struct {
	Querier
	session   *db.WhatsappSession
	platform  *db.PlatformWhatsappSetting
	templates map[string]db.WhatsappCloudTemplate
	senders   []db.SetOutboundMessageSenderParams
	inserted  []db.InsertOutboundMessageParams
	statuses  []db.UpdateOutboundMessageStatusParams
	queued    map[int64]db.OutboundMessage
	finished  []db.FinishOutboundMessageParams
	fallbacks []db.SetWhatsAppSessionFallbackParams
}

func (f *fakeQ) GetWhatsAppSession(context.Context, int64) (db.WhatsappSession, error) {
	if f.session == nil {
		return db.WhatsappSession{}, pgx.ErrNoRows
	}
	return *f.session, nil
}

func (f *fakeQ) GetPlatformWhatsAppSettings(context.Context) (db.PlatformWhatsappSetting, error) {
	if f.platform == nil {
		return db.PlatformWhatsappSetting{}, pgx.ErrNoRows
	}
	return *f.platform, nil
}

func (f *fakeQ) GetWhatsAppCloudTemplateByKey(_ context.Context, key string) (db.WhatsappCloudTemplate, error) {
	t, ok := f.templates[key]
	if !ok {
		return db.WhatsappCloudTemplate{}, pgx.ErrNoRows
	}
	return t, nil
}

func (f *fakeQ) SetOutboundMessageSender(_ context.Context, arg db.SetOutboundMessageSenderParams) error {
	f.senders = append(f.senders, arg)
	return nil
}

func (f *fakeQ) InsertOutboundMessage(_ context.Context, arg db.InsertOutboundMessageParams) (db.OutboundMessage, error) {
	f.inserted = append(f.inserted, arg)
	return db.OutboundMessage{ID: int64(len(f.inserted))}, nil
}

func (f *fakeQ) UpdateOutboundMessageStatus(_ context.Context, arg db.UpdateOutboundMessageStatusParams) (db.OutboundMessage, error) {
	f.statuses = append(f.statuses, arg)
	return db.OutboundMessage{ID: arg.ID}, nil
}

func (f *fakeQ) ClaimOutboundMessage(_ context.Context, id int64) (db.OutboundMessage, error) {
	row, ok := f.queued[id]
	if !ok {
		return db.OutboundMessage{}, pgx.ErrNoRows
	}
	return row, nil
}

func (f *fakeQ) FinishOutboundMessage(_ context.Context, arg db.FinishOutboundMessageParams) (db.OutboundMessage, error) {
	f.finished = append(f.finished, arg)
	return db.OutboundMessage{ID: arg.ID, Status: arg.Status}, nil
}

func (f *fakeQ) SetWhatsAppSessionFallback(_ context.Context, arg db.SetWhatsAppSessionFallbackParams) (db.WhatsappSession, error) {
	f.fallbacks = append(f.fallbacks, arg)
	if f.session == nil {
		f.session = &db.WhatsappSession{OrganizationID: arg.OrganizationID, Status: model.StatusDisconnected}
	}
	f.session.FallbackToPlatform = arg.FallbackToPlatform
	return *f.session, nil
}

// fakeWA records whatsmeow sends with the client key from the context.
type fakeWA struct {
	providers.StubWhatsAppClient
	sends []waSend
}

type waSend struct {
	key  int64
	text string
	doc  bool
}

func scopeKey(ctx context.Context) int64 {
	s, _ := orgctx.ScopeFrom(ctx)
	return s.InternalID
}

func (w *fakeWA) Send(ctx context.Context, _ string, body string) (string, error) {
	w.sends = append(w.sends, waSend{key: scopeKey(ctx), text: body})
	return "wm-ref", nil
}

func (w *fakeWA) SendDocument(ctx context.Context, _ string, d providers.Document) (string, error) {
	w.sends = append(w.sends, waSend{key: scopeKey(ctx), text: d.Caption, doc: true})
	return "wm-doc", nil
}

type fakeCloud struct {
	msgs []cloud.TemplateMessage
	err  error
}

func (c *fakeCloud) SendTemplate(_ context.Context, _ string, m cloud.TemplateMessage) (string, error) {
	c.msgs = append(c.msgs, m)
	if c.err != nil {
		return "", c.err
	}
	return "wamid.1", nil
}

type entStore struct{ ownNumber bool }

func (e entStore) Features(context.Context, int64) ([]entitlements.Feature, error) {
	return []entitlements.Feature{{Key: FeatureOwnNumber, Kind: entitlements.KindToggle, Enabled: e.ownNumber}}, nil
}
func (entStore) Usage(context.Context, int64, string, string) (int64, error) { return 0, nil }
func (entStore) Consume(context.Context, int64, string, string, int64) (int64, error) {
	return 0, nil
}

type rig struct {
	q     *fakeQ
	wa    *fakeWA
	cloud *fakeCloud
	svc   *Service
}

func newRig(entitled bool) *rig {
	r := &rig{q: &fakeQ{templates: map[string]db.WhatsappCloudTemplate{}, queued: map[int64]db.OutboundMessage{}}, wa: &fakeWA{}, cloud: &fakeCloud{}}
	r.svc = New(r.q, providers.NewWhatsAppProvider(r.wa, nil), &providers.NoopSMSProvider{})
	r.svc.SetEntitlements(entitlements.New(entStore{ownNumber: entitled}))
	r.svc.SetCloudSender(r.cloud)
	return r
}

func (r *rig) setSession(connected, fallback bool) {
	status := model.StatusDisconnected
	if connected {
		status = model.StatusConnected
	}
	r.q.session = &db.WhatsappSession{OrganizationID: testOrg, Status: status, Jid: "905@s.whatsapp.net", FallbackToPlatform: fallback}
}

func (r *rig) setProvider(provider string) {
	p := db.PlatformWhatsappSetting{Provider: "none"}
	switch provider {
	case "cloud":
		p = db.PlatformWhatsappSetting{Provider: "cloud", PhoneNumberID: "PN", AccessTokenEnc: []byte("enc")}
	case "cloud_unconfigured":
		p = db.PlatformWhatsappSetting{Provider: "cloud"}
	case "whatsmeow":
		p = db.PlatformWhatsappSetting{Provider: "whatsmeow", WmStatus: model.StatusConnected, WmJid: "90555@s.whatsapp.net"}
	case "whatsmeow_down":
		p = db.PlatformWhatsappSetting{Provider: "whatsmeow", WmStatus: model.StatusDisconnected}
	}
	r.q.platform = &p
}

func (r *rig) setTemplate(key, status string) {
	e, _ := catalog.Lookup(key)
	r.q.templates[e.Key] = db.WhatsappCloudTemplate{Key: e.Key, MetaName: e.MetaName, Language: "tr", Category: e.Category, Status: status}
}

var jobVars = map[string]string{"customer_name": "Ahmet", "plate": "34 ABC 1", "business_name": "Tech Oto", "job_id": "J1"}

// TestResolverMatrix covers entitled × connected × fallback × provider ×
// template status for one job.ready delivery.
func TestResolverMatrix(t *testing.T) {
	providersList := []string{"none", "whatsmeow", "whatsmeow_down", "cloud", "cloud_unconfigured"}
	for _, entitled := range []bool{true, false} {
		for _, connected := range []bool{true, false} {
			for _, fallback := range []bool{true, false} {
				for _, provider := range providersList {
					for _, tplStatus := range []string{"approved", "pending"} {
						name := fmt.Sprintf("ent=%v/conn=%v/fb=%v/%s/%s", entitled, connected, fallback, provider, tplStatus)
						t.Run(name, func(t *testing.T) {
							r := newRig(entitled)
							r.setSession(connected, fallback)
							r.setProvider(provider)
							r.setTemplate(model.EventJobReady, tplStatus)

							res, err := r.svc.deliverWhatsApp(context.Background(), outboundDelivery{
								OrgID: testOrg, EventType: model.EventJobReady, Phone: "905321112233",
								Body: "ORG BODY", Vars: jobVars,
							})

							wantKind, wantCode, wantRetry := expectRoute(entitled, connected, fallback, provider, tplStatus)
							if wantCode == "" {
								if err != nil {
									t.Fatalf("unexpected error %v", err)
								}
							} else {
								if model.ErrorCodeOf(err) != wantCode || model.IsRetryable(err) != wantRetry {
									t.Fatalf("err = %v (code %q retry %v), want %s retry %v",
										err, model.ErrorCodeOf(err), model.IsRetryable(err), wantCode, wantRetry)
								}
							}
							if wantKind != "" && res.SenderKind != wantKind {
								t.Fatalf("sender kind = %q want %q", res.SenderKind, wantKind)
							}
							checkSends(t, r, wantKind, wantCode)
						})
					}
				}
			}
		}
	}
}

// expectRoute is the spec table, written independently of Resolve.
func expectRoute(entitled, connected, fallback bool, provider, tplStatus string) (kind, code string, retry bool) {
	if entitled && connected {
		return model.SenderOrgOwn, "", false
	}
	if entitled && !fallback {
		return "", model.ErrCodeOwnSessionDisconnected, false
	}
	switch provider {
	case "whatsmeow":
		return model.SenderPlatformWhatsmeow, "", false
	case "whatsmeow_down":
		return "", model.ErrCodePlatformSenderUnavailable, true
	case "cloud":
		if tplStatus != "approved" {
			return model.SenderPlatformCloud, model.ErrCodeTemplateNotApproved, false
		}
		return model.SenderPlatformCloud, "", false
	default:
		return "", model.ErrCodePlatformSenderNotConfigured, false
	}
}

func checkSends(t *testing.T, r *rig, kind, code string) {
	t.Helper()
	if code != "" {
		if len(r.wa.sends) != 0 || len(r.cloud.msgs) != 0 {
			t.Fatalf("nothing must be sent on %s: wa=%v cloud=%v", code, r.wa.sends, r.cloud.msgs)
		}
		return
	}
	switch kind {
	case model.SenderOrgOwn:
		if len(r.wa.sends) != 1 || r.wa.sends[0].key != testOrg || r.wa.sends[0].text != "ORG BODY" || len(r.cloud.msgs) != 0 {
			t.Fatalf("org_own sends: %+v cloud=%v", r.wa.sends, r.cloud.msgs)
		}
	case model.SenderPlatformWhatsmeow:
		if len(r.wa.sends) != 1 || r.wa.sends[0].key != model.PlatformOrgKey || len(r.cloud.msgs) != 0 {
			t.Fatalf("platform_whatsmeow sends: %+v", r.wa.sends)
		}
		text := r.wa.sends[0].text
		if strings.Contains(text, "ORG BODY") || !strings.Contains(text, "Sayın Ahmet, 34 ABC 1 plakalı") {
			t.Fatalf("platform whatsmeow must send catalog text, got %q", text)
		}
	case model.SenderPlatformCloud:
		if len(r.cloud.msgs) != 1 || len(r.wa.sends) != 0 {
			t.Fatalf("platform_cloud sends: cloud=%v wa=%v", r.cloud.msgs, r.wa.sends)
		}
		m := r.cloud.msgs[0]
		if m.Name != "otopoly_job_ready" || m.Language != "tr" || strings.Join(m.BodyParams, "|") != "Ahmet|34 ABC 1|Tech Oto|J1" {
			t.Fatalf("cloud message: %+v", m)
		}
	}
}

func TestCloudUsesOverrideNameAndDocumentHeader(t *testing.T) {
	r := newRig(false)
	r.setProvider("cloud")
	r.q.templates[model.EventQuoteSent] = db.WhatsappCloudTemplate{
		Key: model.EventQuoteSent, MetaName: "otopoly_quote_sent", Language: "tr", Status: "approved",
		OverrideName: pgtype.Text{String: "manual_quote", Valid: true},
	}
	res, err := r.svc.deliverWhatsApp(context.Background(), outboundDelivery{
		OrgID: testOrg, EventType: model.EventQuoteSent, Phone: "905321112233",
		Vars: map[string]string{"customer_name": "A", "company_name": "Tech Oto", "quote_number": "Q1", "total_amount": "10 TRY", "valid_until": "01.01.2027"},
		Doc:  &providers.Document{Data: []byte("%PDF"), FileName: "q.pdf", MimeType: "application/pdf"},
	})
	if err != nil {
		t.Fatal(err)
	}
	m := r.cloud.msgs[0]
	if res.TemplateName != "manual_quote" || m.Name != "manual_quote" || m.Document == nil || m.Document.FileName != "q.pdf" {
		t.Fatalf("res=%+v msg=%+v", res, m)
	}
	if m.BodyParams[1] != "Tech Oto" {
		t.Fatalf("business name param from company_name alias: %v", m.BodyParams)
	}

	// The DOCUMENT header template cannot go out without the PDF.
	_, err = r.svc.deliverWhatsApp(context.Background(), outboundDelivery{OrgID: testOrg, EventType: model.EventQuoteSent, Phone: "905321112233"})
	if model.ErrorCodeOf(err) != model.ErrCodeTemplateParamMismatch || model.IsRetryable(err) {
		t.Fatalf("err = %v", err)
	}
}

func TestSendDirectOTPViaCloudDoesNotPersistCode(t *testing.T) {
	r := newRig(false)
	r.setProvider("cloud")
	r.setTemplate(model.EventContractOTP, "approved")
	ref, err := r.svc.SendDirect(context.Background(), SendDirectInput{
		OrgID: testOrg, EventType: model.EventContractOTP, RecipientPhone: "905321112233",
		Body: "Onay kodunuz: 482913", Vars: map[string]string{"code": "482913", "business_name": "Tech Oto"},
	})
	if err != nil || ref != "wamid.1" {
		t.Fatalf("ref=%q err=%v", ref, err)
	}
	if m := r.cloud.msgs[0]; m.OTPCode != "482913" || m.Name != "otopoly_contract_otp" || len(m.BodyParams) != 0 {
		t.Fatalf("otp message: %+v", m)
	}
	if string(r.q.inserted[0].Payload) != `{}` {
		t.Fatalf("OTP vars must not be persisted: %s", r.q.inserted[0].Payload)
	}
	if s := r.q.senders[0]; s.SenderKind.String != model.SenderPlatformCloud || s.TemplateName.String != "otopoly_contract_otp" || s.ErrorCode.Valid {
		t.Fatalf("sender record: %+v", s)
	}
	if r.q.statuses[0].ProviderReference != "wamid.1" {
		t.Fatalf("wamid not stored: %+v", r.q.statuses[0])
	}
}

func TestDispatchRecordsErrorCode(t *testing.T) {
	r := newRig(true)
	r.setSession(false, false)
	r.q.queued = nil
	// Dispatch with Force skips rule lookups; templates resolve from code defaults.
	r.q.Querier = defaultsOnly{}
	if err := r.svc.Dispatch(context.Background(), model.DispatchInput{
		OrgID: testOrg, EventType: model.EventJobReady, RecipientPhone: "905321112233", Vars: jobVars, Force: true,
	}); err != nil {
		t.Fatal(err)
	}
	var waStatus *db.UpdateOutboundMessageStatusParams
	for i, ins := range r.q.inserted {
		if ins.Channel == model.ChannelWhatsApp {
			waStatus = &r.q.statuses[i]
		}
	}
	if waStatus == nil || waStatus.Status != model.OutboundStatusFailed {
		t.Fatalf("whatsapp row not failed: %+v", r.q.statuses)
	}
	found := false
	for _, s := range r.q.senders {
		if s.ErrorCode.String == model.ErrCodeOwnSessionDisconnected {
			found = true
		}
	}
	if !found {
		t.Fatalf("error_code not recorded: %+v", r.q.senders)
	}
}

// defaultsOnly answers template lookups with "no override / no default" so
// the built-in code defaults apply.
type defaultsOnly struct{ Querier }

func (defaultsOnly) GetNotificationRule(context.Context, db.GetNotificationRuleParams) (db.NotificationRule, error) {
	return db.NotificationRule{}, pgx.ErrNoRows
}
func (defaultsOnly) GetMessageTemplateOverride(context.Context, db.GetMessageTemplateOverrideParams) (db.MessageTemplate, error) {
	return db.MessageTemplate{}, pgx.ErrNoRows
}
func (defaultsOnly) GetMessageTemplateDefault(context.Context, db.GetMessageTemplateDefaultParams) (db.MessageTemplateDefault, error) {
	return db.MessageTemplateDefault{}, pgx.ErrNoRows
}

func TestProcessOutboundSkipsRetryForNonRetryable(t *testing.T) {
	r := newRig(false)
	r.setProvider("cloud")
	r.setTemplate(model.EventJobReady, "pending")
	r.q.queued[7] = db.OutboundMessage{ID: 7, OrganizationID: testOrg, EventType: model.EventJobReady,
		Channel: model.ChannelWhatsApp, RecipientPhone: "905321112233", Payload: []byte(`{"customer_name":"A"}`)}

	err := r.svc.ProcessOutbound(context.Background(), 7, false)
	if !errors.Is(err, asynq.SkipRetry) || model.ErrorCodeOf(err) != model.ErrCodeTemplateNotApproved {
		t.Fatalf("err = %v, want SkipRetry + template_not_approved", err)
	}
	if f := r.q.finished[0]; f.Status != model.OutboundStatusFailed {
		t.Fatalf("non-retryable must fail the row on the first attempt: %+v", f)
	}
	if s := r.q.senders[0]; s.ErrorCode.String != model.ErrCodeTemplateNotApproved || s.SenderKind.String != model.SenderPlatformCloud {
		t.Fatalf("sender record: %+v", s)
	}
}

func TestProcessOutboundRetriesRetryable(t *testing.T) {
	r := newRig(false)
	r.setProvider("cloud")
	r.setTemplate(model.EventJobReady, "approved")
	r.cloud.err = model.NewSendError(model.ErrCodeRateLimited, true, errors.New("throttled"))
	r.q.queued[8] = db.OutboundMessage{ID: 8, OrganizationID: testOrg, EventType: model.EventJobReady,
		Channel: model.ChannelWhatsApp, RecipientPhone: "905321112233", Payload: []byte(`{}`)}

	err := r.svc.ProcessOutbound(context.Background(), 8, false)
	if err == nil || errors.Is(err, asynq.SkipRetry) {
		t.Fatalf("retryable error must be retried by asynq: %v", err)
	}
	if f := r.q.finished[0]; f.Status != model.OutboundStatusQueued {
		t.Fatalf("row must stay queued for retry: %+v", f)
	}
	// Last attempt marks it failed.
	r.q.finished = nil
	_ = r.svc.ProcessOutbound(context.Background(), 8, true)
	if r.q.finished[0].Status != model.OutboundStatusFailed {
		t.Fatalf("final attempt: %+v", r.q.finished[0])
	}
}

func TestQueuedPlatformSendUsesPayloadVarsAndStoresWamid(t *testing.T) {
	r := newRig(false)
	r.setProvider("cloud")
	r.setTemplate(model.EventDailySummary, "approved")
	r.q.queued[9] = db.OutboundMessage{ID: 9, OrganizationID: testOrg, EventType: model.EventDailySummary,
		Channel: model.ChannelWhatsApp, RecipientPhone: "905321112233", Body: "📊 long text",
		Payload: []byte(`{"business_name":"Tech Oto","summary_date":"07.10.2026","job_count":"3","paid_total":"₺1,00","unpaid_total":"₺0,00","expense_total":"₺0,00"}`)}
	if err := r.svc.ProcessOutbound(context.Background(), 9, false); err != nil {
		t.Fatal(err)
	}
	if f := r.q.finished[0]; f.Status != model.OutboundStatusSent || f.ProviderReference != "wamid.1" {
		t.Fatalf("finish: %+v", f)
	}
	if p := r.cloud.msgs[0].BodyParams; p[0] != "Tech Oto" || p[2] != "3" {
		t.Fatalf("params: %v", p)
	}
}

func TestTenantGatingWithoutEntitlement(t *testing.T) {
	r := newRig(false)
	r.setSession(true, true)
	r.setProvider("whatsmeow")
	ctx := context.Background()
	if _, err := r.svc.ConnectWhatsApp(ctx, testOrg); !errors.Is(err, ErrNotEntitled) {
		t.Fatalf("connect: %v", err)
	}
	if _, err := r.svc.SaveTemplate(ctx, testOrg, model.EventJobReady, model.ChannelWhatsApp, "tr", SaveTemplateInput{Body: "x"}); !errors.Is(err, ErrNotEntitled) {
		t.Fatalf("save template: %v", err)
	}
	if _, err := r.svc.ResetTemplate(ctx, testOrg, model.EventJobReady, model.ChannelWhatsApp, "tr"); !errors.Is(err, ErrNotEntitled) {
		t.Fatalf("reset template: %v", err)
	}
	if _, err := r.svc.UpsertTemplate(ctx, testOrg, model.UpsertTemplateInput{EventType: "job.ready", Channel: "whatsapp"}); !errors.Is(err, ErrNotEntitled) {
		t.Fatalf("upsert template: %v", err)
	}
	sess, err := r.svc.GetSession(ctx, testOrg)
	if err != nil {
		t.Fatal(err)
	}
	// Connected session is kept but not used; the platform number is.
	if sess.Status != model.StatusConnected || sess.OwnNumberEntitled || !sess.PlatformSenderAvailable || !sess.FallbackToPlatform {
		t.Fatalf("session = %+v", sess)
	}
	if kind, _ := r.svc.Resolve(ctx, testOrg); kind != model.SenderPlatformWhatsmeow {
		t.Fatalf("kind = %s", kind)
	}
}

func TestUpdateSessionSettings(t *testing.T) {
	r := newRig(true)
	r.setProvider("none")
	sess, err := r.svc.UpdateSessionSettings(context.Background(), testOrg, SessionSettingsInput{FallbackToPlatform: new(bool)})
	if err != nil {
		t.Fatal(err)
	}
	if sess.FallbackToPlatform || !sess.OwnNumberEntitled || sess.PlatformSenderAvailable || len(r.q.fallbacks) != 1 {
		t.Fatalf("session = %+v", sess)
	}
	if _, err := r.svc.UpdateSessionSettings(context.Background(), testOrg, SessionSettingsInput{}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("missing field: %v", err)
	}
}

func TestWhatsAppAvailable(t *testing.T) {
	r := newRig(true)
	r.setSession(false, true)
	r.setProvider("whatsmeow_down")
	if ok, err := r.svc.WhatsAppAvailable(context.Background(), testOrg); ok || err != nil {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	r.setProvider("cloud")
	if ok, err := r.svc.WhatsAppAvailable(context.Background(), testOrg); !ok || err != nil {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
}
