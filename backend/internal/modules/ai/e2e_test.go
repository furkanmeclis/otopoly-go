package ai_test

// End-to-end test of the assistant over HTTP with the scripted fake provider
// and a real Postgres (skipped without DATABASE_URL): the real routes and
// auth/org middleware, the SSE stream, a confirmable write tool backed by the
// real cari/finance services, the confirm endpoint and the ledger rows.

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	aimodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai"
	aihandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/provider"
	aitools "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	aiusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/usecase"
	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testSettings keeps the shared ai_settings row untouched: the service reads
// these settings instead.
type testStore struct {
	*db.Queries
	settings db.AiSetting
}

func (s testStore) GetAISettings(context.Context) (db.AiSetting, error) { return s.settings, nil }

// loader resolves the JWT subject to a fixed set of users.
type loader map[uuid.UUID]authctx.Principal

func (l loader) LoadPrincipal(_ *http.Request, claims jwt.Claims) (authctx.Principal, error) {
	id, err := claims.UserUUID()
	if err != nil {
		return authctx.Principal{}, err
	}
	p, ok := l[id]
	if !ok {
		return authctx.Principal{}, io.EOF
	}
	return p, nil
}

type sseEvent struct {
	Name string
	Data map[string]any
}

func readSSE(t *testing.T, body io.Reader) []sseEvent {
	t.Helper()
	var out []sseEvent
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	var name string
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			ev := sseEvent{Name: name, Data: map[string]any{}}
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &ev.Data); err != nil {
				t.Fatalf("bad SSE data %q: %v", line, err)
			}
			out = append(out, ev)
			name = ""
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("read SSE: %v", err)
	}
	return out
}

func find(evs []sseEvent, name string) (sseEvent, bool) {
	for _, e := range evs {
		if e.Name == name {
			return e, true
		}
	}
	return sseEvent{}, false
}

func names(evs []sseEvent) []string {
	out := make([]string, 0, len(evs))
	for _, e := range evs {
		out = append(out, e.Name)
	}
	return out
}

func TestAssistantEndToEnd(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("database unavailable: %v", err)
	}
	q := db.New(pool)

	// ---- fixtures: org A (the user's) and org B (someone else's) ----
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	var orgIDs, userIDs []int64
	// Registered first so it runs last, in FK order.
	t.Cleanup(func() {
		bg := context.Background()
		for _, id := range orgIDs {
			for _, sql := range []string{
				`DELETE FROM ai_usage WHERE organization_id = $1`,
				`DELETE FROM ai_conversations WHERE organization_id = $1`,
				`DELETE FROM cari_entries WHERE organization_id = $1`,
				`DELETE FROM finance_transactions WHERE organization_id = $1`,
				`DELETE FROM organizations WHERE id = $1`,
			} {
				if _, err := pool.Exec(bg, sql, id); err != nil {
					t.Logf("cleanup %q: %v", sql, err)
				}
			}
		}
		for _, id := range userIDs {
			if _, err := pool.Exec(bg, `DELETE FROM users WHERE id = $1`, id); err != nil {
				t.Logf("cleanup user: %v", err)
			}
		}
	})
	mustScan := func(sql string, dest []any, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dest...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	type org struct {
		id          int64
		uuid        uuid.UUID
		customerID  int64
		cariID      int64
		cariUUID    uuid.UUID
		financeUUID uuid.UUID
	}
	newOrg := func(tag string) org {
		var o org
		mustScan(`INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id, uuid`,
			[]any{&o.id, &o.uuid}, "ai-e2e-"+tag+"-"+suffix, "AI E2E "+tag)
		orgIDs = append(orgIDs, o.id)
		mustScan(`INSERT INTO customers (organization_id, name, phone) VALUES ($1, 'Hüseyin Ülken', '0532 000 00 00') RETURNING id`,
			[]any{&o.customerID}, o.id)
		mustScan(`INSERT INTO cari_accounts (organization_id, customer_id, balance) VALUES ($1, $2, 30000) RETURNING id, uuid`,
			[]any{&o.cariID, &o.cariUUID}, o.id, o.customerID)
		mustScan(`INSERT INTO finance_accounts (organization_id, name, type, is_default) VALUES ($1, 'Ana Kasa', 'cash', true) RETURNING uuid`,
			[]any{&o.financeUUID}, o.id)
		return o
	}
	orgA, orgB := newOrg("a"), newOrg("b")

	newUser := func(tag string, o org) authctx.Principal {
		var id int64
		var uid uuid.UUID
		mustScan(`INSERT INTO users (email, password_hash, name, surname) VALUES ($1, 'x', 'Ayşe', 'Yılmaz') RETURNING id, uuid`,
			[]any{&id, &uid}, "ai-e2e-"+tag+"-"+suffix+"@example.test")
		userIDs = append(userIDs, id)
		if _, err := pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, o.id, id); err != nil {
			t.Fatal(err)
		}
		return authctx.Principal{UserID: uid, UserInternal: id, Email: tag + "@example.test", Permissions: []string{
			rbac.PermTenantAIUse, rbac.PermTenantCustomersRead, rbac.PermTenantCariRead, rbac.PermTenantCariWrite, rbac.PermTenantFinanceRead,
		}}
	}
	owner := newUser("owner", orgA)
	colleague := newUser("colleague", orgA) // same org, different user
	outsider := newUser("outsider", orgB)   // other org

	// ---- server: real routes + middleware, fake model ----
	financeSvc := financeusecase.New(pool, q, nil)
	cariSvc := cariusecase.New(pool, q, nil, financeSvc)
	customersSvc := customersusecase.New(pool, q, nil)
	reg := aitools.DefaultRegistry(aitools.Deps{
		Customers: customersSvc, CustomersSearch: q, Cari: cariSvc, Finance: financeSvc, CariWrite: cariSvc, FinanceWrite: financeSvc,
	})
	store := testStore{Queries: q, settings: db.AiSetting{
		ID: 1, Provider: provider.KindOpenAICompatible, BaseUrl: "http://fake.local/v1", Model: "fake-model",
		Effort: "low", MaxTokens: 2000, ChatEnabled: true, ActionsEnabled: true, ChartsEnabled: true,
		ToolSettings: []byte(`{}`), DefaultMonthlyTokenQuota: 0, VoiceLanguage: "tr",
	}}
	svc := aiusecase.New(store, nil, reg, nil)
	svc.EnableActions()
	fake := &provider.Fake{}
	svc.SetProviderFactory(func(provider.Config) (provider.Provider, error) { return fake, nil })

	tokens, err := jwt.NewManager("ai-e2e-test-secret", 15*time.Minute, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	aimodule.RegisterRoutes(mux, aihandler.New(svc, nil), tokens,
		loader{owner.UserID: owner, colleague.UserID: colleague, outsider.UserID: outsider}, q)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	bearer := func(p authctx.Principal, o org) string {
		tok, _, err := tokens.IssueAccess(jwt.AccessInput{UserID: p.UserID, OrganizationID: &o.uuid})
		if err != nil {
			t.Fatal(err)
		}
		return "Bearer " + tok
	}
	do := func(method, path, auth string, body string) *http.Response {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, srv.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", auth)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = res.Body.Close() })
		return res
	}
	ownerAuth := bearer(owner, orgA)

	// ---- 1. create a conversation ----
	res := do(http.MethodPost, "/v1/tenant/ai/conversations", ownerAuth, "")
	if res.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("create conversation: %d %s", res.StatusCode, b)
	}
	var created struct {
		Data aiusecase.Conversation `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	convPath := "/v1/tenant/ai/conversations/" + created.Data.UUID.String()

	// ---- 2. send a message: search → foreign uuids (rejected) → proposal ----
	fake.Responses = []provider.Response{
		provider.FakeToolCall("tu_search", "search_customers", map[string]any{"query": "Hüseyin"}),
		// A uuid from another organization must not resolve, for reads or writes.
		provider.FakeToolCall("tu_foreign_read", "get_customer_account", map[string]any{"cari_account_uuid": orgB.cariUUID.String()}),
		provider.FakeToolCall("tu_foreign_write", "record_cari_payment", map[string]any{"cari_account_uuid": orgB.cariUUID.String(), "amount": 20000}),
		provider.FakeToolCall("tu_pay", "record_cari_payment", map[string]any{"cari_account_uuid": orgA.cariUUID.String(), "amount": 20000, "payment_method": "cash"}),
		provider.FakeText("Tahsilat"), // title
	}
	res = do(http.MethodPost, convPath+"/messages", ownerAuth, `{"content":"Hüseyin Ülken'den nakit 20 bin aldım, işle"}`)
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("send: %d %s %s", res.StatusCode, res.Header.Get("Content-Type"), b)
	}
	evs := readSSE(t, res.Body)
	if len(evs) == 0 || evs[0].Name != aiusecase.EventMessageStart {
		t.Fatalf("stream must start with message_start: %v", names(evs))
	}
	results := map[string]map[string]any{}
	for _, e := range evs {
		if e.Name == aiusecase.EventToolResult {
			results[e.Data["id"].(string)] = e.Data
		}
	}
	if r := results["tu_search"]; r == nil || r["ok"] != true {
		t.Fatalf("search result = %v (events %v)", r, names(evs))
	}
	for _, id := range []string{"tu_foreign_read", "tu_foreign_write"} {
		if r := results[id]; r == nil || r["ok"] != false {
			t.Fatalf("%s must fail for a foreign uuid, got %v", id, r)
		}
	}
	confirmEv, ok := find(evs, aiusecase.EventConfirm)
	if !ok {
		t.Fatalf("no confirm event: %v", names(evs))
	}
	block := confirmEv.Data["block"].(map[string]any)
	actionID := block["id"].(string)
	preview := block["data"].(map[string]any)["preview"].(map[string]any)
	if preview["amount"] != "₺20.000,00" || !strings.Contains(mustJSON(t, preview), "₺10.000,00") {
		t.Fatalf("preview = %v", preview)
	}
	done, ok := find(evs, aiusecase.EventMessageDone)
	if !ok || done.Data["status"] != "complete" {
		t.Fatalf("message_done = %v (events %v)", done.Data, names(evs))
	}
	if _, ok := find(evs, aiusecase.EventTitle); !ok {
		t.Fatalf("no title event: %v", names(evs))
	}
	var entries int
	mustScan(`SELECT COUNT(*) FROM cari_entries WHERE account_id = $1`, []any{&entries}, orgA.cariID)
	if entries != 0 {
		t.Fatal("nothing may be written before the user confirms")
	}
	var foreignActions int
	mustScan(`SELECT COUNT(*) FROM ai_pending_actions WHERE organization_id = $1`, []any{&foreignActions}, orgB.id)
	if foreignActions != 0 {
		t.Fatal("a foreign uuid must not produce a pending action")
	}

	// ---- 3. only the owning user may confirm ----
	confirmPath := "/v1/tenant/ai/actions/" + actionID + "/confirm"
	if res := do(http.MethodPost, confirmPath, bearer(colleague, orgA), ""); res.StatusCode != http.StatusNotFound {
		t.Fatalf("colleague confirm = %d, want 404", res.StatusCode)
	}
	if res := do(http.MethodPost, confirmPath, bearer(outsider, orgB), ""); res.StatusCode != http.StatusNotFound {
		t.Fatalf("outsider confirm = %d, want 404", res.StatusCode)
	}
	if res := do(http.MethodPost, confirmPath, bearer(owner, orgB), ""); res.StatusCode != http.StatusForbidden {
		t.Fatalf("owner with a foreign org token = %d, want 403", res.StatusCode)
	}

	// ---- 4. confirm → action executes once and the chat resumes ----
	fake.Responses = []provider.Response{provider.FakeText("İşlendi, kalan bakiye ₺10.000,00.")}
	res = do(http.MethodPost, confirmPath, ownerAuth, `{"locale":"tr"}`)
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("confirm: %d %s", res.StatusCode, b)
	}
	evs = readSSE(t, res.Body)
	actionEv, ok := find(evs, aiusecase.EventAction)
	if !ok || actionEv.Data["status"] != aiusecase.ActionConfirmed {
		t.Fatalf("action event = %v (events %v)", actionEv.Data, names(evs))
	}
	start, ok := find(evs, aiusecase.EventMessageStart)
	if !ok || start.Data["resumed"] != true {
		t.Fatalf("resumed message_start = %v", start.Data)
	}
	if delta, ok := find(evs, aiusecase.EventTextDelta); !ok || !strings.Contains(delta.Data["text"].(string), "İşlendi") {
		t.Fatalf("continuation text missing: %v", names(evs))
	}
	// The model's continuation request ends with the real tool result.
	last := fake.Requests[len(fake.Requests)-1]
	tail := last.Messages[len(last.Messages)-1].Content[0]
	if tail.ToolUseID != "tu_pay" || tail.IsError || !strings.Contains(tail.Content, "new_balance") {
		t.Fatalf("continuation tail = %+v", tail)
	}

	// ---- 5. ledger rows ----
	var amount, balance string
	var method string
	mustScan(`SELECT amount::text, payment_method FROM cari_entries WHERE account_id = $1 AND type = 'payment'`,
		[]any{&amount, &method}, orgA.cariID)
	if amount != "20000.00" || method != "cash" {
		t.Fatalf("cari entry = %s %s", amount, method)
	}
	mustScan(`SELECT balance::text FROM cari_accounts WHERE id = $1`, []any{&balance}, orgA.cariID)
	if balance != "10000.00" {
		t.Fatalf("cari balance = %s", balance)
	}
	mustScan(`SELECT balance::text FROM cari_accounts WHERE id = $1`, []any{&balance}, orgB.cariID)
	if balance != "30000.00" {
		t.Fatalf("foreign cari balance changed: %s", balance)
	}
	var status string
	mustScan(`SELECT status FROM ai_pending_actions WHERE uuid = $1`, []any{&status}, uuid.MustParse(actionID))
	if status != aiusecase.ActionConfirmed {
		t.Fatalf("action status = %s", status)
	}
	var usageRows int
	mustScan(`SELECT COUNT(*) FROM ai_usage WHERE organization_id = $1 AND purpose IN ('chat', 'title')`, []any{&usageRows}, orgA.id)
	if usageRows != 6 { // 4 tool-loop calls + title + continuation
		t.Fatalf("usage rows = %d, want 6", usageRows)
	}

	// ---- 6. a second confirm is a conflict and nothing runs twice ----
	res = do(http.MethodPost, confirmPath, ownerAuth, "")
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("second confirm = %d, want 409", res.StatusCode)
	}
	mustScan(`SELECT COUNT(*) FROM cari_entries WHERE account_id = $1`, []any{&entries}, orgA.cariID)
	if entries != 1 {
		t.Fatalf("cari entries = %d, want 1", entries)
	}

	// ---- 7. the stored conversation shows the confirmed card ----
	res = do(http.MethodGet, convPath, ownerAuth, "")
	var detail struct {
		Data aiusecase.ConversationDetail `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&detail); err != nil {
		t.Fatal(err)
	}
	if len(detail.Data.Messages) != 3 || !strings.Contains(string(detail.Data.Messages[1].Blocks), `"status":"confirmed"`) {
		t.Fatalf("messages = %d, blocks = %s", len(detail.Data.Messages), detail.Data.Messages[1].Blocks)
	}
	if res := do(http.MethodGet, convPath, bearer(colleague, orgA), ""); res.StatusCode != http.StatusNotFound {
		t.Fatalf("colleague reading the conversation = %d, want 404", res.StatusCode)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
