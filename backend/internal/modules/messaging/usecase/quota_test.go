package usecase

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/hibiken/asynq"
)

// planStore is an entitlements store with the WhatsApp plan features.
type planStore struct {
	ownNumber bool
	enabled   bool
	monthly   int64 // -1 = unlimited
	used      int64
	consumed  int64
}

func (p *planStore) Features(context.Context, int64) ([]entitlements.Feature, error) {
	return []entitlements.Feature{
		{Key: FeatureOwnNumber, Kind: entitlements.KindToggle, Enabled: p.ownNumber},
		{Key: FeatureWhatsAppEnabled, Kind: entitlements.KindToggle, Enabled: p.enabled},
		{Key: FeatureWhatsAppMonthly, Kind: entitlements.KindLimit, Period: entitlements.PeriodMonth,
			Enforcement: "hard", Limit: p.monthly},
	}, nil
}

func (p *planStore) Usage(context.Context, int64, string, string) (int64, error) { return p.used, nil }

func (p *planStore) Consume(_ context.Context, _ int64, key, _ string, delta int64) (int64, error) {
	if key == FeatureWhatsAppMonthly {
		p.used += delta
		p.consumed += delta
	}
	return p.used, nil
}

func newPlanRig(plan *planStore) *rig {
	r := newRig(plan.ownNumber)
	r.svc.SetEntitlements(entitlements.New(plan))
	r.svc.SetPlatformInfo(func(context.Context) PlatformInfo {
		return PlatformInfo{Name: "Brand", URL: "https://brand.test"}
	})
	return r
}

// whatsappRow returns the status update and sender record of the n-th
// WhatsApp outbound row inserted inline.
func whatsappRows(r *rig) []int64 {
	var ids []int64
	for i, ins := range r.q.inserted {
		if ins.Channel == model.ChannelWhatsApp {
			ids = append(ids, int64(i+1))
		}
	}
	return ids
}

func statusOf(r *rig, id int64) db.UpdateOutboundMessageStatusParams {
	for _, s := range r.q.statuses {
		if s.ID == id {
			return s
		}
	}
	return db.UpdateOutboundMessageStatusParams{}
}

func senderOf(r *rig, id int64) db.SetOutboundMessageSenderParams {
	for _, s := range r.q.senders {
		if s.ID == id {
			return s
		}
	}
	return db.SetOutboundMessageSenderParams{}
}

func dispatchJobReady(t *testing.T, r *rig) {
	t.Helper()
	r.q.Querier = defaultsOnly{}
	if err := r.svc.Dispatch(context.Background(), model.DispatchInput{
		OrgID: testOrg, EventType: model.EventJobReady, RecipientPhone: "905321112233", Vars: jobVars, Force: true,
	}); err != nil {
		t.Fatal(err)
	}
}

func expectFailedRow(t *testing.T, r *rig, code string) {
	t.Helper()
	ids := whatsappRows(r)
	if len(ids) != 1 {
		t.Fatalf("whatsapp rows = %d", len(ids))
	}
	if st := statusOf(r, ids[0]); st.Status != model.OutboundStatusFailed {
		t.Fatalf("row status = %+v", st)
	}
	if s := senderOf(r, ids[0]); s.ErrorCode.String != code {
		t.Fatalf("error_code = %q want %q", s.ErrorCode.String, code)
	}
	if len(r.cloud.msgs) != 0 || len(r.wa.sends) != 0 {
		t.Fatalf("nothing may be sent: cloud=%v wa=%v", r.cloud.msgs, r.wa.sends)
	}
}

func TestDispatchPlatformSendNeedsWhatsAppEnabled(t *testing.T) {
	for _, provider := range []string{"cloud", "whatsmeow"} {
		t.Run(provider, func(t *testing.T) {
			r := newPlanRig(&planStore{enabled: false, monthly: -1})
			r.setProvider(provider)
			r.setTemplate(model.EventJobReady, "approved")
			dispatchJobReady(t, r)
			expectFailedRow(t, r, model.ErrCodeFeatureNotEntitled)
		})
	}
}

func TestDispatchPlatformSendQuota(t *testing.T) {
	r := newPlanRig(&planStore{enabled: true, monthly: 5, used: 5})
	r.setProvider("cloud")
	r.setTemplate(model.EventJobReady, "approved")
	dispatchJobReady(t, r)
	expectFailedRow(t, r, model.ErrCodeQuotaExceeded)

	plan := &planStore{enabled: true, monthly: 5, used: 4}
	r = newPlanRig(plan)
	r.setProvider("cloud")
	r.setTemplate(model.EventJobReady, "approved")
	dispatchJobReady(t, r)
	if len(r.cloud.msgs) != 1 || plan.consumed != 1 {
		t.Fatalf("sent=%d consumed=%d, want 1/1", len(r.cloud.msgs), plan.consumed)
	}
}

func TestDispatchOwnNumberKeepsExistingGates(t *testing.T) {
	// Own-number inline sends were never gated on whatsapp.* in Dispatch.
	plan := &planStore{ownNumber: true, enabled: false, monthly: 0}
	r := newPlanRig(plan)
	r.setSession(true, true)
	r.setProvider("cloud")
	dispatchJobReady(t, r)
	if len(r.wa.sends) != 1 || r.wa.sends[0].key != testOrg || plan.consumed != 0 {
		t.Fatalf("own sends=%+v consumed=%d", r.wa.sends, plan.consumed)
	}
}

func TestSimulatePlatformSendGated(t *testing.T) {
	for _, tc := range []struct {
		name string
		plan *planStore
		code string
	}{
		{"disabled", &planStore{enabled: false, monthly: -1}, model.ErrCodeFeatureNotEntitled},
		{"quota", &planStore{enabled: true, monthly: 3, used: 3}, model.ErrCodeQuotaExceeded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newPlanRig(tc.plan)
			r.setProvider("whatsmeow")
			r.q.Querier = defaultsOnly{}
			res, err := r.svc.Simulate(context.Background(), testOrg, model.SimulateInput{
				Phone: "905321112233", EventType: model.EventJobReady,
			})
			if err != nil {
				t.Fatal(err)
			}
			if it := res.Items[0]; it.Status != model.OutboundStatusFailed || it.ErrorCode != tc.code {
				t.Fatalf("item = %+v", it)
			}
			expectFailedRow(t, r, tc.code)
		})
	}
}

func TestSendDirectOTPQuotaExceeded(t *testing.T) {
	r := newPlanRig(&planStore{enabled: true, monthly: 10, used: 10})
	r.setProvider("cloud")
	r.setTemplate(model.EventContractOTP, "approved")
	r.setTemplate(model.EventContractOTPNotice, "approved")
	_, err := r.svc.SendDirect(context.Background(), SendDirectInput{
		OrgID: testOrg, EventType: model.EventContractOTP, RecipientPhone: "905321112233",
		Vars: map[string]string{"code": "482913", "business_name": "Tech Oto"},
	})
	if !errors.Is(err, ErrChannelUnavailable) || model.ErrorCodeOf(err) != model.ErrCodeQuotaExceeded {
		t.Fatalf("err = %v", err)
	}
	expectFailedRow(t, r, model.ErrCodeQuotaExceeded)
}

func TestProcessOutboundPlatformSendNeedsWhatsAppEnabled(t *testing.T) {
	plan := &planStore{enabled: false, monthly: -1}
	r := newPlanRig(plan)
	r.setProvider("cloud")
	r.setTemplate(model.EventJobReady, "approved")
	r.q.queued[11] = db.OutboundMessage{ID: 11, OrganizationID: testOrg, EventType: model.EventJobReady,
		Channel: model.ChannelWhatsApp, RecipientPhone: "905321112233", Payload: []byte(`{}`)}

	err := r.svc.ProcessOutbound(context.Background(), 11, false)
	if !errors.Is(err, asynq.SkipRetry) || model.ErrorCodeOf(err) != model.ErrCodeFeatureNotEntitled {
		t.Fatalf("err = %v", err)
	}
	if f := r.q.finished[0]; f.Status != model.OutboundStatusFailed {
		t.Fatalf("row must fail at once: %+v", f)
	}
	if s := senderOf(r, 11); s.ErrorCode.String != model.ErrCodeFeatureNotEntitled || s.SenderKind.String != model.SenderPlatformCloud {
		t.Fatalf("sender record: %+v", s)
	}
	if len(r.cloud.msgs) != 0 {
		t.Fatalf("sent: %v", r.cloud.msgs)
	}
}

func TestProcessOutboundUsesQuotaReservedByQueueSend(t *testing.T) {
	// QueueSend checked and counted the unit; the worker must neither refuse
	// the last allowed message nor count it twice.
	plan := &planStore{enabled: true, monthly: 5, used: 5}
	r := newPlanRig(plan)
	r.setProvider("cloud")
	r.setTemplate(model.EventJobReady, "approved")
	r.q.queued[12] = db.OutboundMessage{ID: 12, OrganizationID: testOrg, EventType: model.EventJobReady,
		Channel: model.ChannelWhatsApp, RecipientPhone: "905321112233", Payload: []byte(`{}`)}
	if err := r.svc.ProcessOutbound(context.Background(), 12, false); err != nil {
		t.Fatal(err)
	}
	if len(r.cloud.msgs) != 1 || plan.consumed != 0 {
		t.Fatalf("sent=%d consumed=%d", len(r.cloud.msgs), plan.consumed)
	}
}

func otpInput() SendDirectInput {
	return SendDirectInput{
		OrgID: testOrg, EventType: model.EventContractOTP, RecipientPhone: "905321112233",
		Body: "ORG OTP BODY 482913", SubjectType: "contract_instance",
		Vars: map[string]string{
			"code": "482913", "business_name": "Tech Oto", "minutes": "5", "customer_name": "Ahmet",
			"contract_title": "Hizmet Sözleşmesi", "contract_no": "SZL-0042", "plate": "34 ABC 123",
		},
	}
}

func TestContractOTPCloudSendsNoticeAfterOTP(t *testing.T) {
	plan := &planStore{enabled: true, monthly: 100}
	r := newPlanRig(plan)
	r.setProvider("cloud")
	r.setTemplate(model.EventContractOTP, "approved")
	r.setTemplate(model.EventContractOTPNotice, "approved")

	ref, err := r.svc.SendDirect(context.Background(), otpInput())
	if err != nil || ref != "wamid.1" {
		t.Fatalf("ref=%q err=%v", ref, err)
	}
	if len(r.cloud.msgs) != 2 {
		t.Fatalf("cloud msgs = %+v", r.cloud.msgs)
	}
	if otp := r.cloud.msgs[0]; otp.Name != "otopoly_contract_otp" || otp.OTPCode != "482913" {
		t.Fatalf("otp = %+v", otp)
	}
	notice := r.cloud.msgs[1]
	if notice.Name != "otopoly_contract_otp_notice" || notice.OTPCode != "" ||
		strings.Join(notice.BodyParams, "|") != "Tech Oto|Hizmet Sözleşmesi|SZL-0042|34 ABC 123|Brand|https://brand.test" {
		t.Fatalf("notice = %+v", notice)
	}
	if len(r.q.inserted) != 2 || r.q.inserted[0].EventType != model.EventContractOTP ||
		r.q.inserted[1].EventType != model.EventContractOTPNotice {
		t.Fatalf("rows = %+v", r.q.inserted)
	}
	for _, ins := range r.q.inserted {
		if string(ins.Payload) != `{}` || ins.SubjectType != "contract_instance" {
			t.Fatalf("row payload/subject: %+v", ins)
		}
	}
	if s := senderOf(r, 2); s.TemplateName.String != "otopoly_contract_otp_notice" || s.ErrorCode.Valid {
		t.Fatalf("notice sender: %+v", s)
	}
	if plan.consumed != 2 {
		t.Fatalf("OTP + notice must both count: consumed=%d", plan.consumed)
	}
}

func TestContractOTPNoticeFailureKeepsOTP(t *testing.T) {
	plan := &planStore{enabled: true, monthly: 100}
	r := newPlanRig(plan)
	r.setProvider("cloud")
	r.setTemplate(model.EventContractOTP, "approved")
	r.setTemplate(model.EventContractOTPNotice, "pending")

	ref, err := r.svc.SendDirect(context.Background(), otpInput())
	if err != nil || ref != "wamid.1" {
		t.Fatalf("OTP must still succeed: ref=%q err=%v", ref, err)
	}
	if st := statusOf(r, 1); st.Status != model.OutboundStatusSent || st.ProviderReference != "wamid.1" {
		t.Fatalf("otp row: %+v", st)
	}
	if st := statusOf(r, 2); st.Status != model.OutboundStatusFailed {
		t.Fatalf("notice row: %+v", st)
	}
	if s := senderOf(r, 2); s.ErrorCode.String != model.ErrCodeTemplateNotApproved {
		t.Fatalf("notice error: %+v", s)
	}
	if plan.consumed != 1 {
		t.Fatalf("only the OTP was sent: consumed=%d", plan.consumed)
	}

	// Quota runs out between the two messages: the notice row records it.
	plan = &planStore{enabled: true, monthly: 1}
	r = newPlanRig(plan)
	r.setProvider("cloud")
	r.setTemplate(model.EventContractOTP, "approved")
	r.setTemplate(model.EventContractOTPNotice, "approved")
	if _, err := r.svc.SendDirect(context.Background(), otpInput()); err != nil {
		t.Fatal(err)
	}
	if s := senderOf(r, 2); s.ErrorCode.String != model.ErrCodeQuotaExceeded || len(r.cloud.msgs) != 1 {
		t.Fatalf("notice sender=%+v msgs=%d", s, len(r.cloud.msgs))
	}
}

func TestContractOTPPlatformWhatsmeowSingleMessage(t *testing.T) {
	plan := &planStore{enabled: true, monthly: 100}
	r := newPlanRig(plan)
	r.setProvider("whatsmeow")
	if _, err := r.svc.SendDirect(context.Background(), otpInput()); err != nil {
		t.Fatal(err)
	}
	if len(r.wa.sends) != 1 || len(r.q.inserted) != 1 || plan.consumed != 1 {
		t.Fatalf("sends=%+v rows=%d consumed=%d", r.wa.sends, len(r.q.inserted), plan.consumed)
	}
	txt := r.wa.sends[0].text
	for _, w := range []string{"482913", "Hizmet Sözleşmesi", "SZL-0042", "34 ABC 123", "6698", "veri sorumlusu Tech Oto", "Brand (https://brand.test)"} {
		if !strings.Contains(txt, w) {
			t.Fatalf("text lacks %q: %s", w, txt)
		}
	}
}

func TestContractOTPOwnNumberUnchanged(t *testing.T) {
	plan := &planStore{ownNumber: true, enabled: true, monthly: 100}
	r := newPlanRig(plan)
	r.setSession(true, true)
	r.setProvider("cloud")
	if _, err := r.svc.SendDirect(context.Background(), otpInput()); err != nil {
		t.Fatal(err)
	}
	if len(r.wa.sends) != 1 || r.wa.sends[0].text != "ORG OTP BODY 482913" || len(r.cloud.msgs) != 0 || len(r.q.inserted) != 1 || plan.consumed != 0 {
		t.Fatalf("sends=%+v cloud=%v rows=%d consumed=%d", r.wa.sends, r.cloud.msgs, len(r.q.inserted), plan.consumed)
	}
}

func TestAppSettingsPlatformInfo(t *testing.T) {
	info := AppSettingsPlatformInfo(appSettingsStub{row: db.AppSetting{CompanyName: " Brand ", Website: "https://site.test"}},
		"https://app.brand.test/")(context.Background())
	if info.Name != "Brand" || info.URL != "https://app.brand.test" {
		t.Fatalf("info = %+v", info)
	}
	info = AppSettingsPlatformInfo(appSettingsStub{row: db.AppSetting{Website: "https://site.test/"}}, "")(context.Background())
	if info.Name != "site.test" || info.URL != "https://site.test" {
		t.Fatalf("fallback info = %+v", info)
	}
}

type appSettingsStub struct{ row db.AppSetting }

func (a appSettingsStub) GetAppSettings(context.Context) (db.AppSetting, error) { return a.row, nil }
