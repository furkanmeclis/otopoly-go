package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/piusalfred/whatsapp/config"
)

const (
	testToken   = "test-token"
	testPhoneID = "PHONEID"
	testWABA    = "WABAID"
	testAppID   = "APPID"
)

// fakeGraph is an httptest Graph API recording requests.
type fakeGraph struct {
	t        *testing.T
	mu       sync.Mutex
	srv      *httptest.Server
	handlers map[string]http.HandlerFunc // "METHOD /path"
	bodies   map[string][]byte
	auth     map[string]string
}

func newFakeGraph(t *testing.T) *fakeGraph {
	f := &fakeGraph{t: t, handlers: map[string]http.HandlerFunc{}, bodies: map[string][]byte{}, auth: map[string]string{}}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.bodies[key] = body
		f.auth[key] = r.Header.Get("Authorization")
		h := f.handlers[key]
		f.mu.Unlock()
		if h == nil {
			t.Errorf("unexpected Graph call %s", key)
			http.Error(w, "{}", http.StatusNotFound)
			return
		}
		r.Body = io.NopCloser(strings.NewReader(string(body)))
		h(w, r)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeGraph) on(key string, h http.HandlerFunc) { f.handlers[key] = h }

func (f *fakeGraph) jsonBody(key string) map[string]any {
	f.t.Helper()
	var m map[string]any
	if err := json.Unmarshal(f.bodies[key], &m); err != nil {
		f.t.Fatalf("decode %s body: %v (%s)", key, err, f.bodies[key])
	}
	return m
}

func (f *fakeGraph) client() *Client {
	return New(config.ReaderFunc(func(context.Context) (*config.Config, error) {
		return &config.Config{
			BaseURL: f.srv.URL, APIVersion: "v26.0", AccessToken: testToken,
			PhoneNumberID: testPhoneID, BusinessAccountID: testWABA, AppID: testAppID,
		}, nil
	}), f.srv.Client())
}

func writeJSON(w http.ResponseWriter, status int, v string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, v)
}

const okSend = `{"messaging_product":"whatsapp","contacts":[{"input":"905321234567","wa_id":"905321234567"}],"messages":[{"id":"wamid.TEST1"}]}`

func components(t *testing.T, body map[string]any) []map[string]any {
	t.Helper()
	tpl, _ := body["template"].(map[string]any)
	raw, _ := tpl["components"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, c := range raw {
		out = append(out, c.(map[string]any))
	}
	return out
}

func TestSendTemplatePayloadAndWamid(t *testing.T) {
	g := newFakeGraph(t)
	g.on("POST /v26.0/PHONEID/messages", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, okSend) })

	wamid, err := g.client().SendTemplate(context.Background(), "0532 123 45 67", TemplateMessage{
		Name: "otopoly_job_ready", Language: "tr", BodyParams: []string{"Ahmet", "34 ABC 1", "Tech Oto", "J1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if wamid != "wamid.TEST1" {
		t.Fatalf("wamid = %q", wamid)
	}
	key := "POST /v26.0/PHONEID/messages"
	if g.auth[key] != "Bearer "+testToken {
		t.Fatalf("auth header = %q", g.auth[key])
	}
	body := g.jsonBody(key)
	if body["to"] != "905321234567" || body["type"] != "template" || body["messaging_product"] != "whatsapp" {
		t.Fatalf("envelope: %v", body)
	}
	tpl := body["template"].(map[string]any)
	if tpl["name"] != "otopoly_job_ready" || tpl["language"].(map[string]any)["code"] != "tr" {
		t.Fatalf("template: %v", tpl)
	}
	comps := components(t, body)
	if len(comps) != 1 || comps[0]["type"] != "body" {
		t.Fatalf("components: %v", comps)
	}
	params := comps[0]["parameters"].([]any)
	var got []string
	for _, p := range params {
		pm := p.(map[string]any)
		if pm["type"] != "text" {
			t.Fatalf("param type %v", pm["type"])
		}
		got = append(got, pm["text"].(string))
	}
	if strings.Join(got, "|") != "Ahmet|34 ABC 1|Tech Oto|J1" {
		t.Fatalf("positional params = %v", got)
	}
	// Library ≥ v0.1.13 omits unset parameter fields ("currency":null, …).
	raw := string(g.bodies[key])
	if strings.Contains(raw, "null") || strings.Contains(raw, `""`) {
		t.Fatalf("payload carries empty/null fields: %s", raw)
	}
}

func TestSendTemplateUploadsDocumentHeader(t *testing.T) {
	g := newFakeGraph(t)
	var uploaded string
	g.on("POST /v26.0/PHONEID/media", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("multipart: %v", err)
		}
		if r.FormValue("messaging_product") != "whatsapp" || r.FormValue("type") != "application/pdf" {
			t.Errorf("form fields: %v", r.MultipartForm.Value)
		}
		f, hdr, err := r.FormFile("file")
		if err == nil {
			b, _ := io.ReadAll(f)
			uploaded = hdr.Filename + ":" + string(b)
		}
		writeJSON(w, 200, `{"id":"MEDIA1"}`)
	})
	g.on("POST /v26.0/PHONEID/messages", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, okSend) })

	_, err := g.client().SendTemplate(context.Background(), "905321234567", TemplateMessage{
		Name: "otopoly_quote_sent", BodyParams: []string{"a", "b", "c", "d", "e"},
		Document: &Document{Data: []byte("%PDF-1.4 quote"), FileName: "teklif.pdf", MimeType: "application/pdf"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if uploaded != "teklif.pdf:%PDF-1.4 quote" {
		t.Fatalf("uploaded = %q", uploaded)
	}
	comps := components(t, g.jsonBody("POST /v26.0/PHONEID/messages"))
	if len(comps) != 2 || comps[0]["type"] != "header" || comps[1]["type"] != "body" {
		t.Fatalf("components: %v", comps)
	}
	p := comps[0]["parameters"].([]any)[0].(map[string]any)
	doc := p["document"].(map[string]any)
	if p["type"] != "document" || doc["id"] != "MEDIA1" || doc["filename"] != "teklif.pdf" {
		t.Fatalf("header param: %v", p)
	}
}

func TestSendTemplateOTPCopyCode(t *testing.T) {
	g := newFakeGraph(t)
	g.on("POST /v26.0/PHONEID/messages", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, okSend) })
	if _, err := g.client().SendTemplate(context.Background(), "905321234567", TemplateMessage{
		Name: "otopoly_contract_otp", OTPCode: "482913",
	}); err != nil {
		t.Fatal(err)
	}
	comps := components(t, g.jsonBody("POST /v26.0/PHONEID/messages"))
	if len(comps) != 2 || comps[0]["type"] != "body" || comps[1]["type"] != "button" {
		t.Fatalf("components: %v", comps)
	}
	if comps[0]["parameters"].([]any)[0].(map[string]any)["text"] != "482913" ||
		comps[1]["parameters"].([]any)[0].(map[string]any)["text"] != "482913" {
		t.Fatalf("otp params: %v", comps)
	}
}

func graphError(code int) string {
	return `{"error":{"message":"(#` + itoa(code) + `) test","type":"OAuthException","code":` + itoa(code) + `,"fbtrace_id":"x"}}`
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func TestSendTemplateErrorMapping(t *testing.T) {
	cases := []struct {
		name      string
		status    int
		body      string
		code      string
		retryable bool
	}{
		{"expired token", 401, graphError(190), model.ErrCodeCloudAuthFailed, false},
		{"permission", 403, graphError(200), model.ErrCodeCloudAuthFailed, false},
		{"marketing limit", 400, graphError(131049), model.ErrCodeMarketingLimit, false},
		{"undeliverable", 400, graphError(131026), model.ErrCodeUndeliverable, false},
		{"template missing", 404, graphError(132001), model.ErrCodeTemplateMissing, false},
		{"param mismatch", 400, graphError(132000), model.ErrCodeTemplateParamMismatch, false},
		{"rate limited", 429, graphError(130429), model.ErrCodeRateLimited, true},
		{"meta down", 500, graphError(131000), model.ErrCodeCloudUnavailable, true},
		{"bare 503", 503, ``, model.ErrCodeCloudUnavailable, true},
		{"unknown graph", 400, graphError(100), "graph_100", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := newFakeGraph(t)
			g.on("POST /v26.0/PHONEID/messages", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, tc.status, tc.body) })
			_, err := g.client().SendTemplate(context.Background(), "905321234567", TemplateMessage{Name: "x", BodyParams: []string{"a"}})
			var se *model.SendError
			if !errors.As(err, &se) {
				t.Fatalf("err = %v, want *SendError", err)
			}
			if se.Code != tc.code || se.Retryable != tc.retryable {
				t.Fatalf("got (%s,%v) want (%s,%v): %v", se.Code, se.Retryable, tc.code, tc.retryable, err)
			}
			if strings.Contains(err.Error(), testToken) {
				t.Fatalf("token leaked into error: %v", err)
			}
		})
	}
}

func TestSendTemplateNotConfigured(t *testing.T) {
	c := New(config.ReaderFunc(func(context.Context) (*config.Config, error) {
		return nil, errors.New("not configured")
	}), nil)
	_, err := c.SendTemplate(context.Background(), "905321234567", TemplateMessage{Name: "x"})
	if model.ErrorCodeOf(err) != model.ErrCodePlatformSenderNotConfigured || model.IsRetryable(err) {
		t.Fatalf("err = %v", err)
	}
}

func TestCreateTemplatePayloads(t *testing.T) {
	g := newFakeGraph(t)
	g.on("POST /v26.0/WABAID/message_templates", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, `{"id":"TPL1","status":"PENDING","category":"UTILITY"}`)
	})
	g.on("POST /v26.0/APPID/uploads", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("file_type") != "application/pdf" {
			t.Errorf("upload query: %v", r.URL.Query())
		}
		writeJSON(w, 200, `{"id":"upload:SESSION"}`)
	})
	g.on("POST /v26.0/upload:SESSION", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, `{"h":"HANDLE1"}`) })
	c := g.client()
	key := "POST /v26.0/WABAID/message_templates"

	// UTILITY with document header + body examples.
	out, err := c.CreateTemplate(context.Background(), TemplateDefinition{
		Name: "otopoly_quote_sent", Language: "tr", Category: "UTILITY",
		Body: "Sayın {{1}}, teklif {{2}} ektedir.", Examples: []string{"Ahmet", "TKL-1"}, HeaderDocument: true,
	})
	if err != nil || out.ID != "TPL1" || out.Status != "PENDING" {
		t.Fatalf("create: %+v %v", out, err)
	}
	if !strings.HasPrefix(string(g.bodies["POST /v26.0/upload:SESSION"]), "%PDF") {
		t.Fatalf("example pdf not uploaded")
	}
	body := g.jsonBody(key)
	if body["name"] != "otopoly_quote_sent" || body["language"] != "tr" || body["category"] != "UTILITY" {
		t.Fatalf("create body: %v", body)
	}
	comps := body["components"].([]any)
	header := comps[0].(map[string]any)
	if header["type"] != "HEADER" || header["format"] != "DOCUMENT" ||
		header["example"].(map[string]any)["header_handle"].([]any)[0] != "HANDLE1" {
		t.Fatalf("header: %v", header)
	}
	bodyComp := comps[1].(map[string]any)
	ex := bodyComp["example"].(map[string]any)["body_text"].([]any)[0].([]any)
	if bodyComp["type"] != "BODY" || bodyComp["text"] != "Sayın {{1}}, teklif {{2}} ektedir." || len(ex) != 2 || ex[0] != "Ahmet" {
		t.Fatalf("body component: %v", bodyComp)
	}

	// AUTHENTICATION with copy-code button.
	if _, err := c.CreateTemplate(context.Background(), TemplateDefinition{
		Name: "otopoly_contract_otp", Category: "AUTHENTICATION", CopyCode: true, CodeExpirationMinutes: 5,
	}); err != nil {
		t.Fatal(err)
	}
	comps = g.jsonBody(key)["components"].([]any)
	if len(comps) != 3 || comps[0].(map[string]any)["type"] != "BODY" ||
		comps[1].(map[string]any)["type"] != "FOOTER" ||
		comps[1].(map[string]any)["code_expiration_minutes"] != float64(5) {
		t.Fatalf("auth components: %v", comps)
	}
	// Owner decision: no "do not share this code" recommendation, because the
	// contract OTP notice asks the customer to share it with the business.
	if v, ok := comps[0].(map[string]any)["add_security_recommendation"]; ok && v != false {
		t.Fatalf("auth body must not add the security recommendation: %v", comps[0])
	}
	btn := comps[2].(map[string]any)["buttons"].([]any)[0].(map[string]any)
	if btn["type"] != "OTP" || btn["otp_type"] != "COPY_CODE" {
		t.Fatalf("auth button: %v", btn)
	}
}

func TestCreateTemplateGraphError(t *testing.T) {
	g := newFakeGraph(t)
	g.on("POST /v26.0/WABAID/message_templates", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 400, graphError(100)) })
	_, err := g.client().CreateTemplate(context.Background(), TemplateDefinition{Name: "x", Category: "UTILITY", Body: "a {{1}} b", Examples: []string{"1"}})
	if model.ErrorCodeOf(err) != "graph_100" {
		t.Fatalf("err = %v", err)
	}
}

func TestListTemplatesFollowsPaging(t *testing.T) {
	g := newFakeGraph(t)
	calls := 0
	g.on("GET /v26.0/WABAID/message_templates", func(w http.ResponseWriter, r *http.Request) {
		calls++
		if !strings.Contains(r.URL.Query().Get("fields"), "rejected_reason") {
			t.Errorf("fields = %q", r.URL.Query().Get("fields"))
		}
		if r.URL.Query().Get("after") == "" {
			writeJSON(w, 200, `{"data":[{"id":"1","name":"otopoly_job_ready","language":"tr","status":"APPROVED","category":"UTILITY"}],
				"paging":{"cursors":{"before":"a","after":"CUR"},"next":"https://graph/next"}}`)
			return
		}
		writeJSON(w, 200, `{"data":[{"id":"2","name":"otopoly_job_paid","language":"tr","status":"REJECTED","category":"UTILITY","rejected_reason":"INVALID_FORMAT"}],
			"paging":{"cursors":{"before":"b","after":"END"}}}`)
	})
	list, err := g.client().ListTemplates(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || len(list) != 2 || list[1].RejectedReason != "INVALID_FORMAT" {
		t.Fatalf("list = %+v (calls %d)", list, calls)
	}
}

func TestMapStatus(t *testing.T) {
	for in, want := range map[string]string{
		"APPROVED": "approved", "PENDING": "pending", "IN_APPEAL": "pending", "REJECTED": "rejected",
		"PAUSED": "paused", "DISABLED": "disabled", "DELETED": "not_submitted",
	} {
		if got := MapStatus(in); got != want {
			t.Errorf("MapStatus(%s) = %s want %s", in, got, want)
		}
	}
}
