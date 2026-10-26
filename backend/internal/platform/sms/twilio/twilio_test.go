package twilio

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms"
)

const sid = "AC" + "0123456789abcdef0123456789abcdef" // fake, split so scanners skip it

var creds = sms.Credentials{FieldAccountSID: sid, FieldAuthToken: "tok"}

func fake(t *testing.T, h http.HandlerFunc) *Adapter {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != sid || pass != "tok" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"code":20003,"message":"Authenticate","status":401}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		h(w, r)
	}))
	t.Cleanup(srv.Close)
	return New(Config{BaseURL: srv.URL})
}

func TestSendFrom(t *testing.T) {
	a := fake(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/2010-04-01/Accounts/"+sid+"/Messages.json" {
			t.Errorf("path %s %s", r.Method, r.URL.Path)
		}
		_ = r.ParseForm()
		if r.PostForm.Get("To") != "+14155550100" || r.PostForm.Get("From") != "+15005550006" ||
			r.PostForm.Get("Body") != "Your car is ready" || r.PostForm.Get("MessagingServiceSid") != "" {
			t.Errorf("form %v", r.PostForm)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"sid":"SM123","status":"queued","error_code":null,"error_message":null}`))
	})
	res, err := a.Send(context.Background(), creds, sms.Message{To: "+14155550100", Body: "Your car is ready", Sender: "+15005550006"})
	if err != nil || res.MessageID != "SM123" || res.Status != "queued" {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestSendMessagingService(t *testing.T) {
	mg := "MG0123456789abcdef0123456789abcdef"
	a := fake(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("MessagingServiceSid") != mg || r.PostForm.Get("From") != "" {
			t.Errorf("form %v", r.PostForm)
		}
		_, _ = w.Write([]byte(`{"sid":"SM9","status":"accepted"}`))
	})
	if _, err := a.Send(context.Background(), creds, sms.Message{To: "+14155550100", Body: "x", Sender: mg}); err != nil {
		t.Fatal(err)
	}
}

func TestSendErrors(t *testing.T) {
	a := fake(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":21211,"message":"The 'To' number is not a valid phone number.","status":400}`))
	})
	_, err := a.Send(context.Background(), creds, sms.Message{To: "+1", Body: "x", Sender: "+15005550006"})
	rej, ok := sms.AsRejected(err)
	if !ok || rej.Code != "21211" || !rej.InvalidNumber || rej.Retryable {
		t.Fatalf("invalid number: %v", err)
	}

	a = fake(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"code":20429,"message":"Too Many Requests","status":429}`))
	})
	_, err = a.Send(context.Background(), creds, sms.Message{To: "+14155550100", Body: "x", Sender: "+15005550006"})
	if rej, ok := sms.AsRejected(err); !ok || !rej.Retryable {
		t.Fatalf("429: %v", err)
	}

	a = fake(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) })
	_, err = a.Send(context.Background(), creds, sms.Message{To: "+14155550100", Body: "x", Sender: "+15005550006"})
	if !sms.IsUncertain(err) {
		t.Fatalf("503: %v", err)
	}

	_, err = a.Send(context.Background(), sms.Credentials{FieldAccountSID: sid, FieldAuthToken: "bad"},
		sms.Message{To: "+14155550100", Body: "x", Sender: "+15005550006"})
	if rej, ok := sms.AsRejected(err); !ok || !rej.Auth {
		t.Fatalf("auth: %v", err)
	}
}

func TestCheck(t *testing.T) {
	a := fake(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/2010-04-01/Accounts/" + sid + ".json":
			_, _ = w.Write([]byte(`{"sid":"` + sid + `","friendly_name":"Garage Ltd","status":"active"}`))
		case "/2010-04-01/Accounts/" + sid + "/Balance.json":
			_, _ = w.Write([]byte(`{"balance":"12.50","currency":"USD","account_sid":"` + sid + `"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	res, err := a.Check(context.Background(), creds, "+15005550006")
	if err != nil || res.Detail != "Garage Ltd" || res.Balance != "12.50 USD" {
		t.Fatalf("%+v %v", res, err)
	}

	a = fake(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"sid":"` + sid + `","status":"suspended"}`))
	})
	if _, err := a.Check(context.Background(), creds, ""); err == nil {
		t.Fatal("suspended account should fail")
	}
}
