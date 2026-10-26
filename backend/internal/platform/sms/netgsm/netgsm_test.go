package netgsm

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms"
)

var creds = sms.Credentials{FieldUserCode: "8503001122", FieldPassword: "p&ss<w>"}

// mainbody mirrors the XML the production implementation sends.
type mainbody struct {
	Header struct {
		Company struct {
			Dil  string `xml:"dil,attr"`
			Name string `xml:",chardata"`
		} `xml:"company"`
		UserCode  string `xml:"usercode"`
		Password  string `xml:"password"`
		Type      string `xml:"type"`
		MsgHeader string `xml:"msgheader"`
	} `xml:"header"`
	Body struct {
		Msg string   `xml:"msg"`
		No  []string `xml:"no"`
	} `xml:"body"`
}

type fakeNetgsm struct {
	t        *testing.T
	sendBody string // plain-text answer of the XML endpoint
	sendCode int
	balance  map[int]string // stip → JSON answer
	sent     []mainbody
	ctype    string
}

func (f *fakeNetgsm) handler(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	switch r.URL.Path {
	case PathSendXML:
		f.ctype = r.Header.Get("Content-Type")
		var mb mainbody
		if err := xml.Unmarshal(raw, &mb); err != nil {
			f.t.Errorf("invalid xml: %v\n%s", err, raw)
		}
		f.sent = append(f.sent, mb)
		if f.sendCode != 0 {
			w.WriteHeader(f.sendCode)
		}
		_, _ = w.Write([]byte(f.sendBody))
	case PathBalance:
		var req struct {
			UserCode string `json:"usercode"`
			Password string `json:"password"`
			Stip     int    `json:"stip"`
		}
		_ = json.Unmarshal(raw, &req)
		if req.UserCode != "8503001122" || req.Password != "p&ss<w>" {
			_, _ = w.Write([]byte(`{"code":"30","description":"error"}`))
			return
		}
		_, _ = w.Write([]byte(f.balance[req.Stip]))
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func newFake(t *testing.T) (*fakeNetgsm, *Adapter) {
	t.Helper()
	f := &fakeNetgsm{t: t, sendBody: "00 1737721534", balance: map[int]string{
		2: `{"code":"00","balance":"1.234,56"}`,
		1: `{"code":"00","balance":[{"amount":1500,"balance_name":"SMS"},{"amount":300,"balance_name":"Ses Dakika"},{"amount":250,"balance_name":"SMS Paket 2"}]}`,
	}}
	srv := httptest.NewServer(http.HandlerFunc(f.handler))
	t.Cleanup(srv.Close)
	return f, New(Config{BaseURL: srv.URL})
}

func TestNumber(t *testing.T) {
	if got := Number("+905321234567"); got != "905321234567" {
		t.Fatalf("tr: %q", got)
	}
	if got := Number("+14155550100"); got != "0014155550100" {
		t.Fatalf("intl: %q", got)
	}
}

func TestSendXML(t *testing.T) {
	f, a := newFake(t)
	res, err := a.Send(context.Background(), creds, sms.Message{To: "+905321234567", Body: "Aracınız hazır ]]> <b>", Sender: "FİRMA&CO"})
	if err != nil {
		t.Fatal(err)
	}
	if res.MessageID != "1737721534" || res.Status != "accepted" {
		t.Fatalf("result %+v", res)
	}
	if !strings.HasPrefix(f.ctype, "text/xml") {
		t.Fatalf("content type %q", f.ctype)
	}
	mb := f.sent[0]
	if mb.Header.Company.Dil != "TR" || mb.Header.Company.Name != "Netgsm" || mb.Header.Type != "1:n" {
		t.Fatalf("header %+v", mb.Header)
	}
	if mb.Header.UserCode != "8503001122" || mb.Header.Password != "p&ss<w>" || mb.Header.MsgHeader != "FİRMA&CO" {
		t.Fatalf("credentials / header escaping %+v", mb.Header)
	}
	if mb.Body.Msg != "Aracınız hazır ]]> <b>" || len(mb.Body.No) != 1 || mb.Body.No[0] != "905321234567" {
		t.Fatalf("body %+v", mb.Body)
	}
}

func TestSendAnswerCodes(t *testing.T) {
	f, a := newFake(t)
	msg := sms.Message{To: "+905321234567", Body: "x", Sender: "FIRMA"}
	for _, ok := range []string{"01 55", "02 56\n"} {
		f.sendBody = ok
		if _, err := a.Send(context.Background(), creds, msg); err != nil {
			t.Fatalf("%q: %v", ok, err)
		}
	}
	cases := map[string]struct {
		retryable, auth bool
	}{
		"30": {auth: true}, "40": {}, "50": {}, "51": {}, "70": {}, "85": {}, "80": {retryable: true}, "100": {retryable: true},
	}
	for code, want := range cases {
		f.sendBody = code
		_, err := a.Send(context.Background(), creds, msg)
		rej, isRej := sms.AsRejected(err)
		if !isRej || rej.Code != code || rej.Retryable != want.retryable || rej.Auth != want.auth {
			t.Fatalf("code %s: %v (%+v)", code, err, rej)
		}
	}
	for _, uncertain := range []string{"", "00", "<html>gateway</html>"} {
		f.sendBody = uncertain
		if _, err := a.Send(context.Background(), creds, msg); !sms.IsUncertain(err) {
			t.Fatalf("%q should be uncertain, got %v", uncertain, err)
		}
	}
	f.sendBody, f.sendCode = "", http.StatusBadGateway
	if _, err := a.Send(context.Background(), creds, msg); !sms.IsUncertain(err) {
		t.Fatalf("502 should be uncertain, got %v", err)
	}
}

func TestSendUnreachable(t *testing.T) {
	a := New(Config{BaseURL: "http://127.0.0.1:1"})
	_, err := a.Send(context.Background(), creds, sms.Message{To: "+905321234567", Body: "x", Sender: "FIRMA"})
	if !sms.IsUnavailable(err) {
		t.Fatalf("want unavailable, got %v", err)
	}
}

func TestCheckBalance(t *testing.T) {
	f, a := newFake(t)
	res, err := a.Check(context.Background(), creds, "FIRMA")
	if err != nil {
		t.Fatal(err)
	}
	if res.Balance != "1.234,56 TL" || res.SMSCredit == nil || *res.SMSCredit != 1750 {
		t.Fatalf("check %+v", res)
	}

	// No packages ("60") is not a failure.
	f.balance[1] = `{"code":"60"}`
	res, err = a.Check(context.Background(), creds, "FIRMA")
	if err != nil || res.SMSCredit != nil {
		t.Fatalf("no packages: %+v %v", res, err)
	}

	bad := sms.Credentials{FieldUserCode: "8503001122", FieldPassword: "wrong"}
	if _, err := a.Check(context.Background(), bad, ""); err == nil {
		t.Fatal("bad credentials should fail")
	} else if rej, ok := sms.AsRejected(err); !ok || !rej.Auth {
		t.Fatalf("want auth rejection, got %v", err)
	}
}

func TestParseBalance(t *testing.T) {
	cases := []struct {
		in     string
		code   string
		amount float64
	}{
		{`{"code":"00","balance":"1.234,56"}`, "00", 1234.56},
		{`{"code":"00","balance":"12,5"}`, "00", 12.5},
		{`{"code":"00","balance":"1234.56"}`, "00", 1234.56},
		{`{"code":"00","balance":42}`, "00", 42},
		{"00 123,45", "00", 123.45},
	}
	for _, c := range cases {
		b := ParseBalance([]byte(c.in))
		if b.Code != c.code || b.Amount == nil || *b.Amount != c.amount {
			t.Errorf("%s → %+v", c.in, b)
		}
	}
	if b := ParseBalance([]byte("30")); b.Code != "30" || b.Amount != nil {
		t.Errorf("bare code %+v", b)
	}
	b := ParseBalance([]byte(`{"code":"00","balances":[{"amount":"1.500,00","balance_name":"sms"}]}`))
	if len(b.Packages) != 1 || b.Packages[0].Amount != 1500 {
		t.Errorf("balances %+v", b)
	}
}

func TestFormatTL(t *testing.T) {
	for in, want := range map[float64]string{0: "0,00 TL", 5.5: "5,50 TL", 1234.56: "1.234,56 TL", 1234567: "1.234.567,00 TL"} {
		if got := formatTL(in); got != want {
			t.Errorf("formatTL(%v) = %q, want %q", in, got, want)
		}
	}
}
