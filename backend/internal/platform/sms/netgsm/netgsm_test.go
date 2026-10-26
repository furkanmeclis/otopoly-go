package netgsm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms"
)

var creds = sms.Credentials{FieldUserCode: "8503001122", FieldPassword: "pw"}

func fake(t *testing.T, h func(w http.ResponseWriter, r *http.Request, body map[string]any)) *Adapter {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "8503001122" || pass != "pw" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body map[string]any
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		h(w, r, body)
	}))
	t.Cleanup(srv.Close)
	return New(Config{BaseURL: srv.URL})
}

func TestNumber(t *testing.T) {
	if got := Number("+905321234567"); got != "905321234567" {
		t.Fatalf("tr: %q", got)
	}
	if got := Number("+14155550100"); got != "0014155550100" {
		t.Fatalf("intl: %q", got)
	}
}

func TestSendTurkishEncoding(t *testing.T) {
	var got map[string]any
	a := fake(t, func(w http.ResponseWriter, r *http.Request, body map[string]any) {
		if r.URL.Path != PathSend || r.Method != http.MethodPost {
			t.Errorf("path %s %s", r.Method, r.URL.Path)
		}
		got = body
		_, _ = w.Write([]byte(`{"code":"00","jobid":"17377215342605050417149344","description":"queued"}`))
	})
	res, err := a.Send(context.Background(), creds, sms.Message{To: "+905321234567", Body: "Aracınız hazır", Sender: "FIRMA"})
	if err != nil {
		t.Fatal(err)
	}
	if res.MessageID != "17377215342605050417149344" || res.Status != "accepted" {
		t.Fatalf("result %+v", res)
	}
	if got["msgheader"] != "FIRMA" || got["encoding"] != "TR" || got["iysfilter"] != "0" {
		t.Fatalf("body %+v", got)
	}
	msgs := got["messages"].([]any)
	m := msgs[0].(map[string]any)
	if m["no"] != "905321234567" || m["msg"] != "Aracınız hazır" {
		t.Fatalf("message %+v", m)
	}
}

func TestSendPlainHasNoEncoding(t *testing.T) {
	var got map[string]any
	a := fake(t, func(w http.ResponseWriter, _ *http.Request, body map[string]any) {
		got = body
		_, _ = w.Write([]byte(`{"code":"00","jobid":"1"}`))
	})
	if _, err := a.Send(context.Background(), creds, sms.Message{To: "+905321234567", Body: "Hello", Sender: "FIRMA"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["encoding"]; ok {
		t.Fatalf("encoding set for plain text: %+v", got)
	}
}

func TestSendOTPLane(t *testing.T) {
	a := fake(t, func(w http.ResponseWriter, r *http.Request, body map[string]any) {
		if r.URL.Path != PathOTP || body["no"] != "905321234567" || body["msg"] != "Kod: 123456" {
			t.Errorf("otp %s %+v", r.URL.Path, body)
		}
		_, _ = w.Write([]byte(`{"code":"00","jobid":"otp-1"}`))
	})
	res, err := a.Send(context.Background(), creds, sms.Message{To: "+905321234567", Body: "Kod: 123456", Sender: "FIRMA", Class: sms.ClassOTP})
	if err != nil || res.MessageID != "otp-1" {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestSendRejectedAndUncertain(t *testing.T) {
	a := fake(t, func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
		_, _ = w.Write([]byte(`{"code":"40","description":"header"}`))
	})
	_, err := a.Send(context.Background(), creds, sms.Message{To: "+905321234567", Body: "x", Sender: "NOPE"})
	rej, ok := sms.AsRejected(err)
	if !ok || rej.Code != "40" || rej.Retryable {
		t.Fatalf("want rejected 40, got %v", err)
	}

	a = fake(t, func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
		w.WriteHeader(http.StatusBadGateway)
	})
	_, err = a.Send(context.Background(), creds, sms.Message{To: "+905321234567", Body: "x", Sender: "FIRMA"})
	if !sms.IsUncertain(err) {
		t.Fatalf("want uncertain, got %v", err)
	}

	a = fake(t, func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
		_, _ = w.Write([]byte(`not json`))
	})
	_, err = a.Send(context.Background(), creds, sms.Message{To: "+905321234567", Body: "x", Sender: "FIRMA"})
	if !sms.IsUncertain(err) {
		t.Fatalf("want uncertain on unreadable 2xx, got %v", err)
	}

	bad := sms.Credentials{FieldUserCode: "8503001122", FieldPassword: "wrong"}
	_, err = a.Send(context.Background(), bad, sms.Message{To: "+905321234567", Body: "x", Sender: "FIRMA"})
	if rej, ok := sms.AsRejected(err); !ok || !rej.Auth {
		t.Fatalf("want auth rejection, got %v", err)
	}
}

func TestCheck(t *testing.T) {
	a := fake(t, func(w http.ResponseWriter, r *http.Request, _ map[string]any) {
		if r.URL.Path != PathMsgHeader || r.Method != http.MethodGet {
			t.Errorf("path %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"code":"00","msgheaders":["FIRMA","OTOPOLY"]}`))
	})
	res, err := a.Check(context.Background(), creds, "otopoly")
	if err != nil || len(res.Senders) != 2 {
		t.Fatalf("%+v %v", res, err)
	}
	if _, err := a.Check(context.Background(), creds, "OTHER"); err == nil {
		t.Fatal("unknown header should be rejected")
	}
}
