package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/catalog"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/cloud"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/piusalfred/whatsapp/config"
)

// memTemplates is an in-memory whatsapp_cloud_templates with the SQL
// semantics; rows are keyed by "<key>|<language>" (the unique constraint).
type memTemplates struct {
	rows map[string]db.WhatsappCloudTemplate
}

func rk(key, lang string) string { return key + "|" + lang }

// tr returns the Turkish row of a key.
func (m *memTemplates) tr(key string) db.WhatsappCloudTemplate { return m.rows[rk(key, "tr")] }

func (m *memTemplates) set(key, lang string, fn func(r *db.WhatsappCloudTemplate)) {
	r := m.rows[rk(key, lang)]
	fn(&r)
	m.rows[rk(key, lang)] = r
}

func newMemTemplates() *memTemplates {
	return &memTemplates{rows: map[string]db.WhatsappCloudTemplate{}}
}

func (m *memTemplates) ListWhatsAppCloudTemplates(context.Context) ([]db.WhatsappCloudTemplate, error) {
	out := make([]db.WhatsappCloudTemplate, 0, len(m.rows))
	for _, r := range m.rows {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Key != out[j].Key {
			return out[i].Key < out[j].Key
		}
		return out[i].Language < out[j].Language
	})
	return out, nil
}

func (m *memTemplates) EnsureWhatsAppCloudTemplate(_ context.Context, p db.EnsureWhatsAppCloudTemplateParams) (db.WhatsappCloudTemplate, error) {
	r, ok := m.rows[rk(p.Key, p.Language)]
	if !ok {
		r = db.WhatsappCloudTemplate{Key: p.Key, Language: p.Language, Status: TemplateStatusNotSubmitted}
	}
	r.MetaName, r.Category = p.MetaName, p.Category
	m.rows[rk(p.Key, p.Language)] = r
	return r, nil
}

func (m *memTemplates) SetWhatsAppCloudTemplateOverride(_ context.Context, p db.SetWhatsAppCloudTemplateOverrideParams) (db.WhatsappCloudTemplate, error) {
	r, ok := m.rows[rk(p.Key, p.Language)]
	if !ok {
		return r, pgx.ErrNoRows
	}
	r.OverrideName = p.OverrideName
	m.rows[rk(p.Key, p.Language)] = r
	return r, nil
}

func (m *memTemplates) UpdateWhatsAppCloudTemplateStatus(_ context.Context, p db.UpdateWhatsAppCloudTemplateStatusParams) (db.WhatsappCloudTemplate, error) {
	r, ok := m.rows[rk(p.Key, p.Language)]
	if !ok {
		return r, pgx.ErrNoRows
	}
	r.Status, r.MetaTemplateID, r.RejectedReason = p.Status, p.MetaTemplateID, p.RejectedReason
	r.LastSyncedAt = pgtype.Timestamptz{Valid: true}
	m.rows[rk(p.Key, p.Language)] = r
	return r, nil
}

// graph is a fake Graph API for template management.
type graph struct {
	srv     *httptest.Server
	mu      sync.Mutex
	created []map[string]any
	edited  map[string]map[string]any // meta template id → edit body
	remote  string                    // JSON list response
	failFor string                    // template name answered with a Graph error
	authErr bool
}

func newGraph(t *testing.T) *graph {
	g := &graph{remote: `{"data":[]}`, edited: map[string]map[string]any{}}
	g.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		defer g.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if g.authErr {
			w.WriteHeader(401)
			_, _ = io.WriteString(w, `{"error":{"message":"bad token","type":"OAuthException","code":190}}`)
			return
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v26.0/WABA/message_templates":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["name"] == g.failFor {
				w.WriteHeader(400)
				_, _ = io.WriteString(w, `{"error":{"message":"Invalid parameter","type":"OAuthException","code":100,"error_data":{"details":"header handle is invalid"}}}`)
				return
			}
			g.created = append(g.created, body)
			_, _ = io.WriteString(w, `{"id":"ID-`+body["name"].(string)+`-`+body["language"].(string)+`","status":"PENDING","category":"UTILITY"}`)
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v26.0/ID-"):
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			g.edited[strings.TrimPrefix(r.URL.Path, "/v26.0/")] = body
			_, _ = io.WriteString(w, `{"success":true}`)
		case r.Method == http.MethodGet && r.URL.Path == "/v26.0/WABA/message_templates":
			_, _ = io.WriteString(w, g.remote)
		case r.Method == http.MethodPost && r.URL.Path == "/v26.0/APP/uploads":
			_, _ = io.WriteString(w, `{"id":"upload:S1"}`)
		case r.Method == http.MethodPost && r.URL.Path == "/v26.0/upload:S1":
			_, _ = io.WriteString(w, `{"h":"HANDLE"}`)
		default:
			t.Errorf("unexpected call %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(g.srv.Close)
	return g
}

func (g *graph) client() *cloud.Client {
	return cloud.New(config.ReaderFunc(func(context.Context) (*config.Config, error) {
		return &config.Config{BaseURL: g.srv.URL, APIVersion: "v26.0", AccessToken: "tok",
			PhoneNumberID: "PN", BusinessAccountID: "WABA", AppID: "APP"}, nil
	}), g.srv.Client())
}

func seeded(t *testing.T) *memTemplates {
	t.Helper()
	m := newMemTemplates()
	if err := catalog.Seed(context.Background(), m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestSubmitAllCreatesNotSubmittedTemplates(t *testing.T) {
	store := seeded(t)
	// Already pending and overridden entries are left alone.
	store.set(model.EventJobPaid, "tr", func(r *db.WhatsappCloudTemplate) { r.Status = "pending" })
	store.set(model.EventJobCancelled, "tr", func(r *db.WhatsappCloudTemplate) {
		r.OverrideName = pgtype.Text{String: "manual_cancel", Valid: true}
	})

	g := newGraph(t)
	svc := NewTemplates(store, g.client())
	results, err := svc.Submit(context.Background(), SubmitInput{})
	if err != nil {
		t.Fatal(err)
	}
	want := len(catalog.AllVariants()) - 2
	if len(g.created) != want || len(results) != want {
		t.Fatalf("created %d results %d want %d", len(g.created), len(results), want)
	}
	byName := map[string]map[string]any{}
	for _, c := range g.created {
		byName[c["name"].(string)+"|"+c["language"].(string)] = c
	}
	if _, ok := byName["otopoly_job_paid|tr"]; ok {
		t.Fatalf("pending template resubmitted")
	}
	if _, ok := byName["otopoly_job_paid|en"]; !ok {
		t.Fatalf("english variant of a pending turkish template must still be created")
	}
	if _, ok := byName["otopoly_job_cancelled|tr"]; ok {
		t.Fatalf("overridden template submitted")
	}
	ready := byName["otopoly_job_ready|tr"]
	comps := ready["components"].([]any)
	body := comps[0].(map[string]any)
	ex := body["example"].(map[string]any)["body_text"].([]any)[0].([]any)
	if ready["category"] != "UTILITY" || ready["language"] != "tr" || body["type"] != "BODY" || len(ex) != 4 {
		t.Fatalf("job.ready create payload: %v", ready)
	}
	readyEN := byName["otopoly_job_ready|en"]
	bodyEN := readyEN["components"].([]any)[0].(map[string]any)
	if readyEN["language"] != "en" || !strings.HasPrefix(bodyEN["text"].(string), "Dear {{1}}") {
		t.Fatalf("job.ready en payload: %v", readyEN)
	}
	quote := byName["otopoly_quote_sent|tr"]["components"].([]any)[0].(map[string]any)
	if quote["format"] != "DOCUMENT" {
		t.Fatalf("quote header: %v", quote)
	}
	otp := byName["otopoly_contract_otp|en"]
	otpBtn := otp["components"].([]any)[2].(map[string]any)["buttons"].([]any)[0].(map[string]any)
	if otp["category"] != "AUTHENTICATION" || otpBtn["text"] != "Copy code" {
		t.Fatalf("otp: %v", otp)
	}
	if row := store.tr(model.EventJobReady); row.Status != "pending" || row.MetaTemplateID != "ID-otopoly_job_ready-tr" {
		t.Fatalf("stored row: %+v", row)
	}
	if row := store.rows[rk(model.EventJobReady, "en")]; row.Status != "pending" || row.MetaTemplateID != "ID-otopoly_job_ready-en" {
		t.Fatalf("stored en row: %+v", row)
	}
}

func TestSubmitGivenKeysReportsSkipsAndErrors(t *testing.T) {
	store := seeded(t)
	store.set(model.EventJobPaid, "tr", func(r *db.WhatsappCloudTemplate) { r.Status = "approved" })
	g := newGraph(t)
	g.failFor = "otopoly_sale_created"
	results, err := NewTemplates(store, g.client()).Submit(context.Background(), SubmitInput{
		Keys: []string{model.EventJobReady, model.EventJobPaid, model.EventSaleCreated}, Languages: []string{"tr"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]SubmitResult{}
	for _, res := range results {
		got[res.Key] = res
	}
	if len(results) != 3 || got[model.EventJobReady].Status != "pending" || got[model.EventJobPaid].Skipped != "already_submitted" ||
		got[model.EventSaleCreated].Error != "graph_100" || got[model.EventJobReady].Language != "tr" {
		t.Fatalf("results: %+v", results)
	}
	if msg := got[model.EventSaleCreated].Message; !strings.Contains(msg, "Invalid parameter") || !strings.Contains(msg, "header handle is invalid") {
		t.Fatalf("meta error message must be reported: %q", msg)
	}
	if _, err := NewTemplates(store, g.client()).Submit(context.Background(), SubmitInput{Keys: []string{"nope"}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unknown key: %v", err)
	}
	if _, err := NewTemplates(store, g.client()).Submit(context.Background(), SubmitInput{Languages: []string{"de"}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unknown language: %v", err)
	}
}

// TestSubmitEditsRejectedTemplateInPlace: a rejected template that still
// exists in Meta is edited (same id) instead of re-created; without a Meta id
// it is created again.
func TestSubmitEditsRejectedTemplateInPlace(t *testing.T) {
	store := seeded(t)
	store.set(model.EventContractOTPNotice, "tr", func(r *db.WhatsappCloudTemplate) {
		r.Status, r.MetaTemplateID, r.RejectedReason = "rejected", "ID-otopoly_contract_otp_notice-tr", "INCORRECT_CATEGORY"
	})
	store.set(model.EventJobReady, "tr", func(r *db.WhatsappCloudTemplate) { r.Status = "rejected" })
	g := newGraph(t)
	results, err := NewTemplates(store, g.client()).Submit(context.Background(), SubmitInput{
		Keys: []string{model.EventContractOTPNotice, model.EventJobReady}, Languages: []string{"tr"},
	})
	if err != nil {
		t.Fatal(err)
	}
	edit, ok := g.edited["ID-otopoly_contract_otp_notice-tr"]
	if !ok {
		t.Fatalf("rejected template with a meta id must be edited; created=%v", g.created)
	}
	if edit["category"] != "UTILITY" || edit["components"].([]any)[0].(map[string]any)["type"] != "BODY" {
		t.Fatalf("edit payload: %v", edit)
	}
	if len(g.created) != 1 || g.created[0]["name"] != "otopoly_job_ready" {
		t.Fatalf("rejected template without a meta id must be re-created: %v", g.created)
	}
	for _, res := range results {
		if res.Status != "pending" || res.Error != "" {
			t.Fatalf("result: %+v", res)
		}
	}
	row := store.tr(model.EventContractOTPNotice)
	if row.Status != "pending" || row.MetaTemplateID != "ID-otopoly_contract_otp_notice-tr" || row.RejectedReason != "" {
		t.Fatalf("edited row: %+v", row)
	}
}

func TestSubmitAbortsOnAuthError(t *testing.T) {
	g := newGraph(t)
	g.authErr = true
	_, err := NewTemplates(seeded(t), g.client()).Submit(context.Background(), SubmitInput{})
	if model.ErrorCodeOf(err) != model.ErrCodeCloudAuthFailed {
		t.Fatalf("err = %v", err)
	}
}

func TestSyncMapsMetaStatuses(t *testing.T) {
	store := seeded(t)
	store.set(model.EventJobDelivered, "tr", func(r *db.WhatsappCloudTemplate) { r.Status, r.MetaTemplateID = "pending", "OLD" }) // deleted in Meta → not_submitted
	store.set(model.EventJobCancelled, "tr", func(r *db.WhatsappCloudTemplate) {
		r.OverrideName = pgtype.Text{String: "manual_cancel", Valid: true}
	})

	g := newGraph(t)
	g.remote = `{"data":[
		{"id":"1","name":"otopoly_job_ready","language":"tr","status":"APPROVED","category":"UTILITY","rejected_reason":"NONE"},
		{"id":"2","name":"otopoly_job_paid","language":"tr","status":"REJECTED","category":"UTILITY","rejected_reason":"INVALID_FORMAT"},
		{"id":"3","name":"otopoly_job_created","language":"en","status":"APPROVED","category":"UTILITY"},
		{"id":"4","name":"manual_cancel","language":"tr","status":"PAUSED","category":"UTILITY"},
		{"id":"5","name":"otopoly_job_ready","language":"en_US","status":"APPROVED","category":"UTILITY"}
	]}`
	items, err := NewTemplates(store, g.client()).Sync(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]Template{}
	for _, it := range items {
		by[rk(it.Key, it.Language)] = it
	}
	check := func(key, lang, status, id, reason string) {
		t.Helper()
		it := by[rk(key, lang)]
		if it.Status != status || it.MetaTemplateID != id || it.RejectedReason != reason {
			t.Errorf("%s/%s = %s/%s/%s want %s/%s/%s", key, lang, it.Status, it.MetaTemplateID, it.RejectedReason, status, id, reason)
		}
	}
	check(model.EventJobReady, "tr", "approved", "1", "")
	check(model.EventJobReady, "en", "not_submitted", "", "") // en_US is not the catalog language
	check(model.EventJobPaid, "tr", "rejected", "2", "INVALID_FORMAT")
	check(model.EventJobCreated, "tr", "not_submitted", "", "")
	check(model.EventJobCreated, "en", "approved", "3", "")
	check(model.EventJobCancelled, "tr", "paused", "4", "") // matched by override name
	check(model.EventJobDelivered, "tr", "not_submitted", "", "")
	if by[rk(model.EventJobCancelled, "tr")].EffectiveName != "manual_cancel" {
		t.Fatalf("effective name: %+v", by[rk(model.EventJobCancelled, "tr")])
	}
}

func TestSetOverride(t *testing.T) {
	store := seeded(t)
	store.set(model.EventJobReady, "tr", func(r *db.WhatsappCloudTemplate) { r.Status, r.MetaTemplateID = "approved", "1" })
	svc := NewTemplates(store, nil)

	name := "my_job_ready"
	it, err := svc.SetOverride(context.Background(), model.EventJobReady, "tr", OverrideInput{OverrideName: &name})
	if err != nil {
		t.Fatal(err)
	}
	if it.EffectiveName != name || it.Status != "not_submitted" || it.MetaTemplateID != "" || it.Language != "tr" {
		t.Fatalf("override: %+v", it)
	}
	if en := store.rows[rk(model.EventJobReady, "en")]; en.OverrideName.Valid {
		t.Fatalf("override must not leak to the other language: %+v", en)
	}
	bad := "Bad Name!"
	if _, err := svc.SetOverride(context.Background(), model.EventJobReady, "tr", OverrideInput{OverrideName: &bad}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("invalid name: %v", err)
	}
	it, err = svc.SetOverride(context.Background(), model.EventJobReady, "tr", OverrideInput{})
	if err != nil || it.OverrideName != nil || it.EffectiveName != "otopoly_job_ready" {
		t.Fatalf("clear: %+v %v", it, err)
	}
	if it, err := svc.SetOverride(context.Background(), model.EventJobReady, "en", OverrideInput{OverrideName: &name}); err != nil || it.Language != "en" || it.EffectiveName != name {
		t.Fatalf("en override: %+v %v", it, err)
	}
	if _, err := svc.SetOverride(context.Background(), "job.completed", "tr", OverrideInput{}); !errors.Is(err, ErrTemplateNotFound) {
		t.Fatalf("alias key must not be addressable: %v", err)
	}
	if _, err := svc.SetOverride(context.Background(), model.EventJobReady, "de", OverrideInput{}); !errors.Is(err, ErrTemplateNotFound) {
		t.Fatalf("unknown language: %v", err)
	}
}

func TestListMergesCatalogAndState(t *testing.T) {
	store := newMemTemplates() // nothing seeded yet
	items, err := NewTemplates(store, nil).List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != len(catalog.AllVariants()) || len(items) != 2*len(catalog.All()) {
		t.Fatalf("items = %d", len(items))
	}
	for i, it := range items {
		if it.Status != TemplateStatusNotSubmitted || !strings.HasPrefix(it.EffectiveName, "otopoly_") || it.Body == "" {
			t.Fatalf("item: %+v", it)
		}
		if want := catalog.Languages[i%len(catalog.Languages)]; it.Language != want {
			t.Fatalf("item %d language = %s want %s (entry order, then language)", i, it.Language, want)
		}
	}
}
