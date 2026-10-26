package smschannel

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms/netgsm"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms/twilio"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	org      int64 = 7
	otherOrg int64 = 8
)

// memQ is an in-memory sms_provider_accounts table keyed by org + provider.
type memQ struct {
	mu   sync.Mutex
	rows map[string]db.SmsProviderAccount
}

func key(orgID int64, provider string) string { return string(rune(orgID)) + "|" + provider }

func (m *memQ) ListSMSProviderAccounts(_ context.Context, orgID int64) ([]db.SmsProviderAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []db.SmsProviderAccount
	for _, r := range m.rows {
		if r.OrganizationID == orgID {
			out = append(out, r)
		}
	}
	return out, nil
}

func (m *memQ) GetSMSProviderAccount(_ context.Context, arg db.GetSMSProviderAccountParams) (db.SmsProviderAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[key(arg.OrganizationID, arg.Provider)]
	if !ok {
		return db.SmsProviderAccount{}, pgx.ErrNoRows
	}
	return r, nil
}

func (m *memQ) GetActiveSMSProviderAccount(_ context.Context, orgID int64) (db.SmsProviderAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.rows {
		if r.OrganizationID == orgID && r.IsActive {
			return r, nil
		}
	}
	return db.SmsProviderAccount{}, pgx.ErrNoRows
}

func (m *memQ) UpsertSMSProviderAccount(_ context.Context, arg db.UpsertSMSProviderAccountParams) (db.SmsProviderAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(arg.OrganizationID, arg.Provider)
	r, ok := m.rows[k]
	if !ok {
		r = db.SmsProviderAccount{Uuid: uuid.New(), OrganizationID: arg.OrganizationID, Provider: arg.Provider}
	}
	r.Sender, r.CredentialsEnc, r.CredentialHints = arg.Sender, arg.CredentialsEnc, arg.CredentialHints
	r.Status, r.LastError = StatusUnchecked, ""
	m.rows[k] = r
	return r, nil
}

func (m *memQ) DeactivateSMSProviderAccounts(_ context.Context, arg db.DeactivateSMSProviderAccountsParams) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, r := range m.rows {
		if r.OrganizationID == arg.OrganizationID && r.Provider != arg.KeepProvider {
			r.IsActive = false
			m.rows[k] = r
		}
	}
	return nil
}

func (m *memQ) SetSMSProviderAccountActive(_ context.Context, arg db.SetSMSProviderAccountActiveParams) (db.SmsProviderAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(arg.OrganizationID, arg.Provider)
	r, ok := m.rows[k]
	if !ok {
		return db.SmsProviderAccount{}, pgx.ErrNoRows
	}
	if arg.IsActive {
		for _, o := range m.rows {
			if o.OrganizationID == arg.OrganizationID && o.IsActive && o.Provider != arg.Provider {
				return db.SmsProviderAccount{}, errors.New("unique violation: one active per org")
			}
		}
	}
	r.IsActive = arg.IsActive
	m.rows[k] = r
	return r, nil
}

func (m *memQ) SetSMSProviderAccountCheck(_ context.Context, arg db.SetSMSProviderAccountCheckParams) (db.SmsProviderAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(arg.OrganizationID, arg.Provider)
	r, ok := m.rows[k]
	if !ok {
		return db.SmsProviderAccount{}, pgx.ErrNoRows
	}
	r.Status, r.LastError = arg.Status, arg.LastError
	m.rows[k] = r
	return r, nil
}

func (m *memQ) DeleteSMSProviderAccount(_ context.Context, arg db.DeleteSMSProviderAccountParams) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(arg.OrganizationID, arg.Provider)
	if _, ok := m.rows[k]; !ok {
		return 0, nil
	}
	delete(m.rows, k)
	return 1, nil
}

type recAct struct{ actions []string }

func (r *recAct) Record(_ context.Context, _ *int64, action, _ string, _ *uuid.UUID, payload map[string]any, _ *http.Request) {
	raw, _ := json.Marshal(payload)
	r.actions = append(r.actions, action+" "+string(raw))
}

type recLog struct {
	phones []string
	errs   []error
	refs   []string
}

func (r *recLog) LogSMSTest(_ context.Context, _ int64, phone string, res model.SMSDelivery, err error) {
	r.phones = append(r.phones, phone)
	r.errs = append(r.errs, err)
	r.refs = append(r.refs, res.MessageID)
}

// providerFakes serves the Netgsm and Twilio HTTP APIs.
type providerFakes struct {
	mu          sync.Mutex
	netgsmSends []map[string]any
	twilioSends []string
	netgsmCode  string
}

func (f *providerFakes) netgsm(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	switch r.URL.Path {
	case netgsm.PathBalance:
		if !strings.Contains(string(raw), `"usercode":"8503001122"`) || !strings.Contains(string(raw), `"password":"ng-pass"`) {
			_, _ = w.Write([]byte(`{"code":"30"}`))
			return
		}
		if strings.Contains(string(raw), `"stip":2`) {
			_, _ = w.Write([]byte(`{"code":"00","balance":"99,90"}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":"00","balance":[{"amount":1000,"balance_name":"SMS"}]}`))
	case netgsm.PathSendXML:
		var mb struct {
			Header struct {
				Company struct {
					Dil string `xml:"dil,attr"`
				} `xml:"company"`
				UserCode  string `xml:"usercode"`
				Password  string `xml:"password"`
				MsgHeader string `xml:"msgheader"`
			} `xml:"header"`
			Body struct {
				Msg string `xml:"msg"`
				No  string `xml:"no"`
			} `xml:"body"`
		}
		_ = xml.Unmarshal(raw, &mb)
		if mb.Header.UserCode != "8503001122" || mb.Header.Password != "ng-pass" {
			_, _ = w.Write([]byte("30"))
			return
		}
		f.mu.Lock()
		f.netgsmSends = append(f.netgsmSends, map[string]any{
			"dil": mb.Header.Company.Dil, "msgheader": mb.Header.MsgHeader, "no": mb.Body.No, "msg": mb.Body.Msg,
		})
		code := f.netgsmCode
		f.mu.Unlock()
		if code != "" {
			_, _ = w.Write([]byte(code))
			return
		}
		_, _ = w.Write([]byte("00 NG-1"))
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func (f *providerFakes) twilio(w http.ResponseWriter, r *http.Request) {
	if u, p, _ := r.BasicAuth(); u != "AC123" || p != "tw-token" {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":20003,"message":"Authenticate"}`))
		return
	}
	switch {
	case strings.HasSuffix(r.URL.Path, "/Messages.json"):
		_ = r.ParseForm()
		f.mu.Lock()
		f.twilioSends = append(f.twilioSends, r.PostForm.Get("To")+" "+r.PostForm.Get("From"))
		f.mu.Unlock()
		_, _ = w.Write([]byte(`{"sid":"SM1","status":"queued"}`))
	case strings.HasSuffix(r.URL.Path, "/Balance.json"):
		_, _ = w.Write([]byte(`{"balance":"3.10","currency":"USD"}`))
	default:
		_, _ = w.Write([]byte(`{"sid":"AC123","friendly_name":"Garage","status":"active"}`))
	}
}

type rig struct {
	svc   *Service
	q     *memQ
	act   *recAct
	log   *recLog
	fakes *providerFakes
}

func newRig(t *testing.T) *rig {
	t.Helper()
	f := &providerFakes{}
	ng := httptest.NewServer(http.HandlerFunc(f.netgsm))
	tw := httptest.NewServer(http.HandlerFunc(f.twilio))
	t.Cleanup(ng.Close)
	t.Cleanup(tw.Close)
	box, err := crypto.NewSecretBox("0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	r := &rig{q: &memQ{rows: map[string]db.SmsProviderAccount{}}, act: &recAct{}, log: &recLog{}, fakes: f}
	r.svc = New(r.q, box, r.act, netgsm.New(netgsm.Config{BaseURL: ng.URL}), twilio.New(twilio.Config{BaseURL: tw.URL}))
	r.svc.SetTestLogger(r.log)
	return r
}

func str(s string) *string { return &s }
func boolp(b bool) *bool   { return &b }

func (r *rig) connectNetgsm(t *testing.T) Account {
	t.Helper()
	a, err := r.svc.Save(context.Background(), org, nil, sms.ProviderNetgsm, SaveInput{
		Credentials: map[string]string{netgsm.FieldUserCode: "8503001122", netgsm.FieldPassword: "ng-pass"},
		Sender:      str("OTOPOLY"),
	})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestSaveSealsAndMasks(t *testing.T) {
	r := newRig(t)
	a := r.connectNetgsm(t)
	if !a.IsActive {
		t.Fatal("first account should become the active SMS provider")
	}
	if a.CredentialHints[netgsm.FieldPassword] != "••••••ss" || strings.Contains(a.CredentialHints[netgsm.FieldUserCode], "3001") {
		t.Fatalf("hints leak: %+v", a.CredentialHints)
	}
	row := r.q.rows[key(org, sms.ProviderNetgsm)]
	if strings.Contains(row.CredentialsEnc, "ng-pass") || strings.Contains(row.CredentialsEnc, "8503001122") {
		t.Fatal("credentials stored in plain text")
	}
	raw, _ := json.Marshal(a)
	if strings.Contains(string(raw), "ng-pass") {
		t.Fatal("secret in API payload")
	}

	// Empty secret keeps the stored one; sender changes.
	if _, err := r.svc.Save(context.Background(), org, nil, sms.ProviderNetgsm, SaveInput{
		Credentials: map[string]string{netgsm.FieldPassword: ""}, Sender: str("OTOPOLY"),
	}); err != nil {
		t.Fatal(err)
	}
	if res, err := r.svc.Test(context.Background(), org, nil, sms.ProviderNetgsm); err != nil || !res.OK ||
		res.Balance != "99,90 TL" || res.SMSCredit == nil || *res.SMSCredit != 1000 {
		t.Fatalf("test after keep-secret update: %+v %v", res, err)
	}

	// Unknown field and missing sender are refused.
	if _, err := r.svc.Save(context.Background(), org, nil, sms.ProviderNetgsm, SaveInput{
		Credentials: map[string]string{"api_key": "x"},
	}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unknown field: %v", err)
	}
	if _, err := r.svc.Save(context.Background(), org, nil, sms.ProviderTwilio, SaveInput{
		Credentials: map[string]string{twilio.FieldAccountSID: "AC123", twilio.FieldAuthToken: "tw-token"},
	}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("missing sender: %v", err)
	}
	if _, err := r.svc.Save(context.Background(), org, nil, "clickatell", SaveInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown provider: %v", err)
	}
}

func TestOneActiveProvider(t *testing.T) {
	r := newRig(t)
	r.connectNetgsm(t)
	tw, err := r.svc.Save(context.Background(), org, nil, sms.ProviderTwilio, SaveInput{
		Credentials: map[string]string{twilio.FieldAccountSID: "AC123", twilio.FieldAuthToken: "tw-token"},
		Sender:      str("+15005550006"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if tw.IsActive {
		t.Fatal("second account must not take over without activate")
	}
	if _, err := r.svc.SetActive(context.Background(), org, nil, sms.ProviderTwilio, true); err != nil {
		t.Fatal(err)
	}
	ov, err := r.svc.Overview(context.Background(), org)
	if err != nil || ov.ActiveProvider != sms.ProviderTwilio || len(ov.Providers) != 2 {
		t.Fatalf("overview %+v %v", ov, err)
	}
	for _, p := range ov.Providers {
		if p.Provider == sms.ProviderNetgsm && (p.Account == nil || p.Account.IsActive) {
			t.Fatalf("netgsm should be connected and inactive: %+v", p.Account)
		}
	}
	d, err := r.svc.Deliver(context.Background(), org, "+1 415 555 0100", "Hello", sms.ClassTransactional)
	if err != nil || d.Provider != sms.ProviderTwilio || d.MessageID != "SM1" || d.Status != "queued" {
		t.Fatalf("deliver %+v %v", d, err)
	}
	if len(r.fakes.twilioSends) != 1 || r.fakes.twilioSends[0] != "+14155550100 +15005550006" {
		t.Fatalf("twilio sends %v", r.fakes.twilioSends)
	}

	// Disable: SMS is off for the org.
	if _, err := r.svc.SetActive(context.Background(), org, nil, sms.ProviderTwilio, false); err != nil {
		t.Fatal(err)
	}
	if ok, _ := r.svc.Available(context.Background(), org); ok {
		t.Fatal("no provider should be active")
	}
	_, err = r.svc.Deliver(context.Background(), org, "+14155550100", "Hello", sms.ClassTransactional)
	if model.ErrorCodeOf(err) != model.ErrCodeSMSNotConfigured || model.IsRetryable(err) {
		t.Fatalf("want sms_not_configured, got %v", err)
	}
}

func TestDeliverNetgsmAndClassification(t *testing.T) {
	r := newRig(t)
	r.connectNetgsm(t)
	d, err := r.svc.Deliver(context.Background(), org, "0532 123 45 67", "Aracınız hazır", sms.ClassTransactional)
	if err != nil || d.MessageID != "NG-1" || d.To != "+905321234567" {
		t.Fatalf("%+v %v", d, err)
	}
	sent := r.fakes.netgsmSends[0]
	if sent["dil"] != "TR" || sent["msgheader"] != "OTOPOLY" || sent["no"] != "905321234567" || sent["msg"] != "Aracınız hazır" {
		t.Fatalf("netgsm body %+v", sent)
	}

	_, err = r.svc.Deliver(context.Background(), org, "12", "x", sms.ClassTransactional)
	if model.ErrorCodeOf(err) != model.ErrCodeInvalidRecipient {
		t.Fatalf("invalid phone: %v", err)
	}

	r.fakes.netgsmCode = "80"
	_, err = r.svc.Deliver(context.Background(), org, "05321234567", "x", sms.ClassTransactional)
	if model.ErrorCodeOf(err) != model.ErrCodeSMSRejected || !model.IsRetryable(err) {
		t.Fatalf("limit: %v", err)
	}
	r.fakes.netgsmCode = "40"
	_, err = r.svc.Deliver(context.Background(), org, "05321234567", "x", sms.ClassTransactional)
	if model.ErrorCodeOf(err) != model.ErrCodeSMSRejected || model.IsRetryable(err) {
		t.Fatalf("header: %v", err)
	}

	// Another organization never reaches this account.
	if _, err := r.svc.Deliver(context.Background(), otherOrg, "05321234567", "x", sms.ClassTransactional); model.ErrorCodeOf(err) != model.ErrCodeSMSNotConfigured {
		t.Fatalf("other org: %v", err)
	}
	if _, err := r.svc.Test(context.Background(), otherOrg, nil, sms.ProviderNetgsm); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other org test: %v", err)
	}
}

func TestClassifyTransport(t *testing.T) {
	if c := Classify(&sms.Unavailable{Err: errors.New("dial")}); c.Code != model.ErrCodeSMSUnavailable || !c.Retryable {
		t.Fatalf("unavailable %+v", c)
	}
	if c := Classify(&sms.Uncertain{Err: errors.New("eof")}); c.Code != model.ErrCodeSMSOutcomeUnknown || c.Retryable {
		t.Fatalf("uncertain %+v", c)
	}
	if c := Classify(&sms.Rejected{Code: "30", Auth: true}); c.Code != model.ErrCodeSMSAuthFailed {
		t.Fatalf("auth %+v", c)
	}
}

func TestTestAndSendTest(t *testing.T) {
	r := newRig(t)
	if _, err := r.svc.Save(context.Background(), org, nil, sms.ProviderTwilio, SaveInput{
		Credentials: map[string]string{twilio.FieldAccountSID: "AC123", twilio.FieldAuthToken: "wrong"},
		Sender:      str("+15005550006"), Activate: boolp(true),
	}); err != nil {
		t.Fatal(err)
	}
	res, err := r.svc.Test(context.Background(), org, nil, sms.ProviderTwilio)
	if err != nil || res.OK || res.ErrorCode != model.ErrCodeSMSAuthFailed || res.Account.Status != StatusError {
		t.Fatalf("bad creds test: %+v %v", res, err)
	}
	if _, err := r.svc.Save(context.Background(), org, nil, sms.ProviderTwilio, SaveInput{
		Credentials: map[string]string{twilio.FieldAuthToken: "tw-token"},
	}); err != nil {
		t.Fatal(err)
	}
	res, err = r.svc.Test(context.Background(), org, nil, sms.ProviderTwilio)
	if err != nil || !res.OK || res.Balance != "3.10 USD" || res.Account.Status != StatusConnected {
		t.Fatalf("test: %+v %v", res, err)
	}

	out, err := r.svc.SendTest(context.Background(), org, nil, sms.ProviderTwilio, TestSMSInput{Phone: "+14155550100", Body: "Ping"})
	if err != nil || out.Status != model.OutboundStatusSent || out.ProviderMessageID != "SM1" || out.Segments.Segments != 1 {
		t.Fatalf("send test: %+v %v", out, err)
	}
	if out.Recipient == "+14155550100" {
		t.Fatal("recipient must be masked")
	}
	if len(r.log.phones) != 1 || r.log.refs[0] != "SM1" {
		t.Fatalf("outbound log %+v", r.log)
	}
	if _, err := r.svc.SendTest(context.Background(), org, nil, sms.ProviderTwilio, TestSMSInput{Phone: "abc"}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("bad phone: %v", err)
	}

	if err := r.svc.Disconnect(context.Background(), org, nil, sms.ProviderTwilio); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.Disconnect(context.Background(), org, nil, sms.ProviderTwilio); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second disconnect: %v", err)
	}
	joined := strings.Join(r.act.actions, "\n")
	for _, a := range []string{ActionConnected, ActionUpdated, ActionTested, ActionTestSent, ActionDisconnected} {
		if !strings.Contains(joined, a) {
			t.Errorf("activity %s missing in\n%s", a, joined)
		}
	}
	if strings.Contains(joined, "tw-token") || strings.Contains(joined, "+14155550100") {
		t.Fatal("activity payload leaks secrets or phone")
	}
}
