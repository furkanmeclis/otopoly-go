package usecase

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
)

type webhookFake struct {
	row       db.PlatformWhatsappSetting
	known     map[string]bool // wamids that exist
	applied   []db.ApplyOutboundDeliveryStatusParams
	byMetaID  []db.UpdateWhatsAppCloudTemplateStatusByMetaIDParams
	byName    []db.UpdateWhatsAppCloudTemplateStatusByNameParams
	metaIDs   map[string]bool
	names     map[string]bool // name|language
	failApply string          // wamid whose update errors
}

func (f *webhookFake) GetPlatformWhatsAppSettings(context.Context) (db.PlatformWhatsappSetting, error) {
	return f.row, nil
}

func (f *webhookFake) ApplyOutboundDeliveryStatus(_ context.Context, arg db.ApplyOutboundDeliveryStatusParams) (int64, error) {
	if arg.ProviderReference == f.failApply {
		return 0, errors.New("db down")
	}
	f.applied = append(f.applied, arg)
	if f.known[arg.ProviderReference] {
		return 1, nil
	}
	return 0, nil
}

func (f *webhookFake) UpdateWhatsAppCloudTemplateStatusByMetaID(_ context.Context, arg db.UpdateWhatsAppCloudTemplateStatusByMetaIDParams) (int64, error) {
	f.byMetaID = append(f.byMetaID, arg)
	if f.metaIDs[arg.MetaTemplateID] {
		return 1, nil
	}
	return 0, nil
}

func (f *webhookFake) UpdateWhatsAppCloudTemplateStatusByName(_ context.Context, arg db.UpdateWhatsAppCloudTemplateStatusByNameParams) (int64, error) {
	f.byName = append(f.byName, arg)
	if f.names[arg.Name+"|"+arg.Language] {
		return 1, nil
	}
	return 0, nil
}

const (
	testAppSecret   = "app-secret-test"
	testVerifyToken = "verify-token-test"
)

func newWebhookRig(t *testing.T, withSecrets bool) (*Webhook, *webhookFake) {
	t.Helper()
	box := testBox(t)
	f := &webhookFake{known: map[string]bool{}, metaIDs: map[string]bool{}, names: map[string]bool{}}
	if withSecrets {
		secret, _ := box.Encrypt(testAppSecret)
		verify, _ := box.Encrypt(testVerifyToken)
		f.row = db.PlatformWhatsappSetting{AppSecretEnc: []byte(secret), WebhookVerifyTokenEnc: []byte(verify)}
	}
	wh := NewWebhook(f, box, slog.New(slog.DiscardHandler))
	wh.now = func() time.Time { return time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC) }
	return wh, f
}

func sign(secret string, body []byte) http.Header {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	h := http.Header{}
	h.Set("X-Hub-Signature-256", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	return h
}

func TestWebhookHandshake(t *testing.T) {
	wh, _ := newWebhookRig(t, true)
	ctx := context.Background()
	if got, err := wh.VerifySubscription(ctx, "subscribe", testVerifyToken, "1158201444"); err != nil || got != "1158201444" {
		t.Fatalf("ok handshake: %q %v", got, err)
	}
	for name, in := range map[string][3]string{
		"wrong token":       {"subscribe", "nope", "c"},
		"wrong mode":        {"unsubscribe", testVerifyToken, "c"},
		"missing token":     {"subscribe", "", "c"},
		"missing challenge": {"subscribe", testVerifyToken, ""},
		"missing mode":      {"", testVerifyToken, "c"},
	} {
		if _, err := wh.VerifySubscription(ctx, in[0], in[1], in[2]); !errors.Is(err, ErrWebhookVerifyFailed) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	unconfigured, _ := newWebhookRig(t, false)
	if _, err := unconfigured.VerifySubscription(ctx, "subscribe", "", "c"); !errors.Is(err, ErrWebhookVerifyFailed) {
		t.Fatalf("unconfigured: %v", err)
	}
}

func TestWebhookSignature(t *testing.T) {
	wh, _ := newWebhookRig(t, true)
	ctx := context.Background()
	body := []byte(`{"object":"whatsapp_business_account","entry":[]}`)
	if err := wh.VerifySignature(ctx, sign(testAppSecret, body), body); err != nil {
		t.Fatalf("valid signature: %v", err)
	}
	if err := wh.VerifySignature(ctx, http.Header{}, body); !errors.Is(err, ErrWebhookSignature) {
		t.Fatalf("missing header: %v", err)
	}
	if err := wh.VerifySignature(ctx, sign("other-secret", body), body); !errors.Is(err, ErrWebhookSignature) {
		t.Fatalf("wrong secret: %v", err)
	}
	// Signed over different bytes (e.g. re-serialised JSON) → rejected.
	if err := wh.VerifySignature(ctx, sign(testAppSecret, body), bytes.ReplaceAll(body, []byte(`,`), []byte(`, `))); !errors.Is(err, ErrWebhookSignature) {
		t.Fatalf("modified body: %v", err)
	}
	bad := http.Header{}
	bad.Set("X-Hub-Signature-256", "sha256=zz")
	if err := wh.VerifySignature(ctx, bad, body); !errors.Is(err, ErrWebhookSignature) {
		t.Fatalf("malformed: %v", err)
	}
	noSecret, _ := newWebhookRig(t, false)
	if err := noSecret.VerifySignature(ctx, sign("", body), body); !errors.Is(err, ErrWebhookSignature) {
		t.Fatalf("missing app secret must fail closed: %v", err)
	}
}

const statusesPayload = `{"object":"whatsapp_business_account","entry":[{"id":"WABA","changes":[{"field":"messages","value":{
 "messaging_product":"whatsapp","metadata":{"display_phone_number":"15550000000","phone_number_id":"PN"},
 "statuses":[
  {"id":"wamid.A","status":"delivered","timestamp":"1791374400","recipient_id":"15551112233",
   "pricing":{"billable":true,"pricing_model":"PMP","category":"utility","type":"regular"},"conversation":{"id":"c1"}},
  {"id":"wamid.B","status":"failed","timestamp":"1791374401","recipient_id":"15551112233",
   "errors":[{"code":131026,"title":"Message undeliverable","error_data":{"details":"x"}}]},
  {"id":"wamid.C","status":"read","timestamp":"bogus"},
  {"id":"wamid.D","status":"deleted","timestamp":"1791374402"},
  {"id":"wamid.UNKNOWN","status":"sent","timestamp":"1791374403"}
 ],
 "brand_new_field":{"x":1}}}]}]}`

func TestWebhookStatuses(t *testing.T) {
	wh, f := newWebhookRig(t, true)
	f.known = map[string]bool{"wamid.A": true, "wamid.B": true, "wamid.C": true}
	res := wh.Process(context.Background(), []byte(statusesPayload))
	if res.Statuses != 3 || res.Failed != 0 {
		t.Fatalf("result = %+v", res)
	}
	if len(f.applied) != 4 { // deleted is ignored before the store
		t.Fatalf("applied = %+v", f.applied)
	}
	a := f.applied[0]
	if a.ProviderReference != "wamid.A" || a.DeliveryStatus != DeliveryDelivered ||
		!a.DeliveryStatusAt.Time.Equal(time.Unix(1791374400, 0)) ||
		a.PricingCategory.String != "utility" || !a.Billable.Valid || !a.Billable.Bool || a.ErrorCode.Valid {
		t.Fatalf("delivered: %+v", a)
	}
	b := f.applied[1]
	if b.DeliveryStatus != DeliveryFailed || b.ErrorCode.String != model.ErrCodeUndeliverable || b.PricingCategory.Valid {
		t.Fatalf("failed: %+v", b)
	}
	c := f.applied[2]
	if c.DeliveryStatus != DeliveryRead || !c.DeliveryStatusAt.Time.Equal(wh.now()) {
		t.Fatalf("read with bad timestamp falls back to now: %+v", c)
	}
	if f.applied[3].ProviderReference != "wamid.UNKNOWN" {
		t.Fatalf("unknown wamid: %+v", f.applied[3])
	}
}

func TestWebhookFailedWithoutErrorCodeAndUnknownGraphCode(t *testing.T) {
	wh, f := newWebhookRig(t, true)
	wh.Process(context.Background(), []byte(`{"entry":[{"changes":[{"field":"messages","value":{"statuses":[
		{"id":"w1","status":"failed","timestamp":"1"},
		{"id":"w2","status":"failed","timestamp":"1","errors":[{"code":987654}]}]}}]}]}`))
	if f.applied[0].ErrorCode.String != model.ErrCodeSendFailed || f.applied[1].ErrorCode.String != "graph_987654" {
		t.Fatalf("codes: %q %q", f.applied[0].ErrorCode.String, f.applied[1].ErrorCode.String)
	}
}

func TestWebhookDropsCustomerMessages(t *testing.T) {
	wh, f := newWebhookRig(t, true)
	res := wh.Process(context.Background(), []byte(`{"object":"whatsapp_business_account","entry":[{"changes":[
		{"field":"messages","value":{"messaging_product":"whatsapp","contacts":[{"wa_id":"15551112233","profile":{"name":"X"}}],
		 "messages":[{"from":"15551112233","id":"wamid.IN","timestamp":"1","type":"text","text":{"body":"merhaba"}}]}},
		{"field":"account_update","value":{"event":"VERIFIED_ACCOUNT"}},
		{"field":"some_future_field","value":[1,2,3]}]}]}`))
	if len(f.applied) != 0 || len(f.byMetaID) != 0 || len(f.byName) != 0 {
		t.Fatalf("customer messages / other fields must not touch storage: %+v %+v %+v", f.applied, f.byMetaID, f.byName)
	}
	if res.Ignored != 3 || res.Failed != 0 {
		t.Fatalf("result = %+v", res)
	}
}

func TestWebhookTemplateStatusUpdate(t *testing.T) {
	wh, f := newWebhookRig(t, true)
	f.metaIDs = map[string]bool{"1234567890": true}
	f.names = map[string]bool{"manual_quote|tr": true}
	res := wh.Process(context.Background(), []byte(`{"entry":[{"changes":[
		{"field":"message_template_status_update","value":{"event":"APPROVED","message_template_id":1234567890,
		 "message_template_name":"otopoly_job_ready","message_template_language":"tr","reason":"NONE"}},
		{"field":"message_template_status_update","value":{"event":"REJECTED","message_template_id":"555",
		 "message_template_name":"manual_quote","message_template_language":"tr","reason":"INCORRECT_CATEGORY"}},
		{"field":"message_template_status_update","value":{"event":"SOMETHING_NEW","message_template_id":1}}]}]}`))
	if res.Templates != 2 || res.Ignored != 1 || res.Failed != 0 {
		t.Fatalf("result = %+v", res)
	}
	if a := f.byMetaID[0]; a.MetaTemplateID != "1234567890" || a.Status != "approved" || a.RejectedReason != "" {
		t.Fatalf("by id: %+v", a)
	}
	// Unknown id "555" falls back to effective name + language and stores the id.
	if len(f.byName) != 1 {
		t.Fatalf("by name: %+v", f.byName)
	}
	if b := f.byName[0]; b.Name != "manual_quote" || b.Language != "tr" || b.Status != "rejected" ||
		b.RejectedReason != "INCORRECT_CATEGORY" || b.MetaTemplateID != "555" {
		t.Fatalf("by name: %+v", b)
	}
}

func TestWebhookOneFailingEntryDoesNotStopOthers(t *testing.T) {
	wh, f := newWebhookRig(t, true)
	f.known = map[string]bool{"w2": true}
	f.failApply = "w1"
	res := wh.Process(context.Background(), []byte(`{"entry":[
		{"changes":[{"field":"messages","value":{"statuses":"not-an-array"}}]},
		{"changes":[{"field":"messages","value":{"statuses":[{"id":"w1","status":"sent","timestamp":"1"},{"id":"w2","status":"sent","timestamp":"1"}]}}]}]}`))
	if res.Failed != 2 || res.Statuses != 1 {
		t.Fatalf("result = %+v", res)
	}
	if res := wh.Process(context.Background(), []byte(`not json`)); res.Failed != 1 {
		t.Fatalf("undecodable: %+v", res)
	}
}
