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

// memTemplates is an in-memory whatsapp_cloud_templates with the SQL semantics.
type memTemplates struct {
	rows map[string]db.WhatsappCloudTemplate
}

func newMemTemplates() *memTemplates {
	return &memTemplates{rows: map[string]db.WhatsappCloudTemplate{}}
}

func (m *memTemplates) ListWhatsAppCloudTemplates(context.Context) ([]db.WhatsappCloudTemplate, error) {
	out := make([]db.WhatsappCloudTemplate, 0, len(m.rows))
	for _, r := range m.rows {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out, nil
}

func (m *memTemplates) EnsureWhatsAppCloudTemplate(_ context.Context, p db.EnsureWhatsAppCloudTemplateParams) (db.WhatsappCloudTemplate, error) {
	r, ok := m.rows[p.Key]
	if !ok {
		r = db.WhatsappCloudTemplate{Key: p.Key, Status: TemplateStatusNotSubmitted}
	}
	r.MetaName, r.Language, r.Category = p.MetaName, p.Language, p.Category
	m.rows[p.Key] = r
	return r, nil
}

func (m *memTemplates) SetWhatsAppCloudTemplateOverride(_ context.Context, p db.SetWhatsAppCloudTemplateOverrideParams) (db.WhatsappCloudTemplate, error) {
	r, ok := m.rows[p.Key]
	if !ok {
		return r, pgx.ErrNoRows
	}
	r.OverrideName = p.OverrideName
	m.rows[p.Key] = r
	return r, nil
}

func (m *memTemplates) UpdateWhatsAppCloudTemplateStatus(_ context.Context, p db.UpdateWhatsAppCloudTemplateStatusParams) (db.WhatsappCloudTemplate, error) {
	r, ok := m.rows[p.Key]
	if !ok {
		return r, pgx.ErrNoRows
	}
	r.Status, r.MetaTemplateID, r.RejectedReason = p.Status, p.MetaTemplateID, p.RejectedReason
	r.LastSyncedAt = pgtype.Timestamptz{Valid: true}
	m.rows[p.Key] = r
	return r, nil
}

// graph is a fake Graph API for template management.
type graph struct {
	srv     *httptest.Server
	mu      sync.Mutex
	created []map[string]any
	remote  string // JSON list response
	failFor string // template name answered with a Graph error
	authErr bool
}

func newGraph(t *testing.T) *graph {
	g := &graph{remote: `{"data":[]}`}
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
				_, _ = io.WriteString(w, `{"error":{"message":"invalid","type":"OAuthException","code":100}}`)
				return
			}
			g.created = append(g.created, body)
			_, _ = io.WriteString(w, `{"id":"ID-`+body["name"].(string)+`","status":"PENDING","category":"UTILITY"}`)
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
	r := store.rows[model.EventJobPaid]
	r.Status = "pending"
	store.rows[model.EventJobPaid] = r
	r = store.rows[model.EventJobCancelled]
	r.OverrideName = pgtype.Text{String: "manual_cancel", Valid: true}
	store.rows[model.EventJobCancelled] = r

	g := newGraph(t)
	svc := NewTemplates(store, g.client())
	results, err := svc.Submit(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	want := len(catalog.All()) - 2
	if len(g.created) != want || len(results) != want {
		t.Fatalf("created %d results %d want %d", len(g.created), len(results), want)
	}
	byName := map[string]map[string]any{}
	for _, c := range g.created {
		byName[c["name"].(string)] = c
	}
	if _, ok := byName["otopoly_job_paid"]; ok {
		t.Fatalf("pending template resubmitted")
	}
	if _, ok := byName["otopoly_job_cancelled"]; ok {
		t.Fatalf("overridden template submitted")
	}
	ready := byName["otopoly_job_ready"]
	comps := ready["components"].([]any)
	body := comps[0].(map[string]any)
	ex := body["example"].(map[string]any)["body_text"].([]any)[0].([]any)
	if ready["category"] != "UTILITY" || ready["language"] != "tr" || body["type"] != "BODY" || len(ex) != 4 {
		t.Fatalf("job.ready create payload: %v", ready)
	}
	quote := byName["otopoly_quote_sent"]["components"].([]any)[0].(map[string]any)
	if quote["format"] != "DOCUMENT" {
		t.Fatalf("quote header: %v", quote)
	}
	otp := byName["otopoly_contract_otp"]
	if otp["category"] != "AUTHENTICATION" {
		t.Fatalf("otp: %v", otp)
	}
	if row := store.rows[model.EventJobReady]; row.Status != "pending" || row.MetaTemplateID != "ID-otopoly_job_ready" {
		t.Fatalf("stored row: %+v", row)
	}
}

func TestSubmitGivenKeysReportsSkipsAndErrors(t *testing.T) {
	store := seeded(t)
	r := store.rows[model.EventJobPaid]
	r.Status = "approved"
	store.rows[model.EventJobPaid] = r
	g := newGraph(t)
	g.failFor = "otopoly_sale_created"
	results, err := NewTemplates(store, g.client()).Submit(context.Background(),
		[]string{model.EventJobReady, model.EventJobPaid, model.EventSaleCreated})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]SubmitResult{}
	for _, res := range results {
		got[res.Key] = res
	}
	if got[model.EventJobReady].Status != "pending" || got[model.EventJobPaid].Skipped != "already_submitted" ||
		got[model.EventSaleCreated].Error != "graph_100" {
		t.Fatalf("results: %+v", results)
	}
	if _, err := NewTemplates(store, g.client()).Submit(context.Background(), []string{"nope"}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unknown key: %v", err)
	}
}

func TestSubmitAbortsOnAuthError(t *testing.T) {
	g := newGraph(t)
	g.authErr = true
	_, err := NewTemplates(seeded(t), g.client()).Submit(context.Background(), nil)
	if model.ErrorCodeOf(err) != model.ErrCodeCloudAuthFailed {
		t.Fatalf("err = %v", err)
	}
}

func TestSyncMapsMetaStatuses(t *testing.T) {
	store := seeded(t)
	r := store.rows[model.EventJobDelivered]
	r.Status, r.MetaTemplateID = "pending", "OLD"
	store.rows[model.EventJobDelivered] = r // deleted in Meta → not_submitted
	r = store.rows[model.EventJobCancelled]
	r.OverrideName = pgtype.Text{String: "manual_cancel", Valid: true}
	store.rows[model.EventJobCancelled] = r

	g := newGraph(t)
	g.remote = `{"data":[
		{"id":"1","name":"otopoly_job_ready","language":"tr","status":"APPROVED","category":"UTILITY","rejected_reason":"NONE"},
		{"id":"2","name":"otopoly_job_paid","language":"tr","status":"REJECTED","category":"UTILITY","rejected_reason":"INVALID_FORMAT"},
		{"id":"3","name":"otopoly_job_created","language":"en_US","status":"APPROVED","category":"UTILITY"},
		{"id":"4","name":"manual_cancel","language":"tr","status":"PAUSED","category":"UTILITY"}
	]}`
	items, err := NewTemplates(store, g.client()).Sync(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]Template{}
	for _, it := range items {
		by[it.Key] = it
	}
	check := func(key, status, id, reason string) {
		t.Helper()
		it := by[key]
		if it.Status != status || it.MetaTemplateID != id || it.RejectedReason != reason {
			t.Errorf("%s = %s/%s/%s want %s/%s/%s", key, it.Status, it.MetaTemplateID, it.RejectedReason, status, id, reason)
		}
	}
	check(model.EventJobReady, "approved", "1", "")
	check(model.EventJobPaid, "rejected", "2", "INVALID_FORMAT")
	check(model.EventJobCreated, "not_submitted", "", "") // other language only
	check(model.EventJobCancelled, "paused", "4", "")     // matched by override name
	check(model.EventJobDelivered, "not_submitted", "", "")
	if by[model.EventJobCancelled].EffectiveName != "manual_cancel" {
		t.Fatalf("effective name: %+v", by[model.EventJobCancelled])
	}
}

func TestSetOverride(t *testing.T) {
	store := seeded(t)
	r := store.rows[model.EventJobReady]
	r.Status, r.MetaTemplateID = "approved", "1"
	store.rows[model.EventJobReady] = r
	svc := NewTemplates(store, nil)

	name := "my_job_ready"
	it, err := svc.SetOverride(context.Background(), model.EventJobReady, OverrideInput{OverrideName: &name})
	if err != nil {
		t.Fatal(err)
	}
	if it.EffectiveName != name || it.Status != "not_submitted" || it.MetaTemplateID != "" {
		t.Fatalf("override: %+v", it)
	}
	bad := "Bad Name!"
	if _, err := svc.SetOverride(context.Background(), model.EventJobReady, OverrideInput{OverrideName: &bad}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("invalid name: %v", err)
	}
	it, err = svc.SetOverride(context.Background(), model.EventJobReady, OverrideInput{})
	if err != nil || it.OverrideName != nil || it.EffectiveName != "otopoly_job_ready" {
		t.Fatalf("clear: %+v %v", it, err)
	}
	if _, err := svc.SetOverride(context.Background(), "job.completed", OverrideInput{}); !errors.Is(err, ErrTemplateNotFound) {
		t.Fatalf("alias key must not be addressable: %v", err)
	}
}

func TestListMergesCatalogAndState(t *testing.T) {
	store := newMemTemplates() // nothing seeded yet
	items, err := NewTemplates(store, nil).List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != len(catalog.All()) {
		t.Fatalf("items = %d", len(items))
	}
	for _, it := range items {
		if it.Status != TemplateStatusNotSubmitted || !strings.HasPrefix(it.EffectiveName, "otopoly_") || it.Body == "" {
			t.Fatalf("item: %+v", it)
		}
	}
}
