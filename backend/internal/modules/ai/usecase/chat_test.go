package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/provider"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

// countTool is a read tool that counts calls.
type countTool struct {
	name  string
	perm  string
	kind  tools.Kind
	conf  bool
	mu    sync.Mutex
	calls int
	out   string
}

func (c *countTool) Spec() tools.Spec {
	perms := []string{}
	if c.perm != "" {
		perms = append(perms, c.perm)
	}
	kind := c.kind
	if kind == "" {
		kind = tools.KindRead
	}
	feature := tools.FeatureChat
	if c.conf {
		feature = tools.FeatureActions
	}
	return tools.Spec{
		Name: c.name, Description: "test tool", Permissions: perms, Feature: feature, Kind: kind,
		RequiresConfirmation: c.conf,
		InputSchema: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{"q": map[string]any{"type": "string", "minLength": 1}},
			"required":             []string{"q"},
			"additionalProperties": false,
		},
	}
}

func (c *countTool) Run(_ context.Context, _ tools.Env, raw json.RawMessage) (tools.Result, error) {
	c.mu.Lock()
	c.calls++
	c.mu.Unlock()
	out := c.out
	if out == "" {
		out = `{"rows":[{"day":"2026-09-01","total":10},{"day":"2026-09-02","total":20}]}`
	}
	return tools.Result{Content: out, SummaryKey: "ai.tool_summary.customers_found", SummaryParams: map[string]any{"count": 2}}, nil
}

func (c *countTool) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

type harness struct {
	svc   *Service
	store *memStore
	fake  *provider.Fake
	ctx   context.Context
	conv  Conversation
}

type recorded struct {
	mu     sync.Mutex
	events []string
	data   []any
}

func (r *recorded) emit(ev string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, ev)
	r.data = append(r.data, data)
}

func (r *recorded) has(ev string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.events {
		if e == ev {
			return true
		}
	}
	return false
}

func newHarness(t *testing.T, perms []string, ts ...tools.Tool) *harness {
	t.Helper()
	store := newMemStore()
	reg := tools.NewRegistry(append([]tools.Tool{tools.RenderChart{}}, ts...)...)
	svc := New(store, fakeBox{}, reg, nil)
	fake := &provider.Fake{}
	svc.SetProviderFactory(func(cfg provider.Config) (provider.Provider, error) {
		if cfg.APIKey != "sk-test-key-1234" {
			t.Fatalf("provider built with unexpected key %q", cfg.APIKey)
		}
		return fake, nil
	})
	svc.SetClock(func() time.Time { return time.Date(2026, 9, 24, 11, 30, 0, 0, time.UTC) })
	ctx := authctx.WithPrincipal(context.Background(), authctx.Principal{
		UserID: uuid.New(), UserInternal: 42, Email: "ayse@example.test", Permissions: perms,
	})
	ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: 7, UUID: uuid.New(), Slug: "demo", Name: "Demo Oto Yıkama", MemberRole: "owner"})
	conv, err := svc.CreateConversation(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	return &harness{svc: svc, store: store, fake: fake, ctx: ctx, conv: conv}
}

func (h *harness) send(t *testing.T, text string) *recorded {
	t.Helper()
	turn, err := h.svc.PrepareMessage(h.ctx, h.conv.UUID, SendInput{Content: text})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	rec := &recorded{}
	if err := h.svc.RunTurn(h.ctx, turn, rec.emit); err != nil {
		t.Fatalf("run: %v", err)
	}
	return rec
}

func toolNames(req provider.Request) []string {
	var out []string
	for _, d := range req.Tools {
		out = append(out, d.Name)
	}
	return out
}

func TestRunTurnDispatchesToolAndFeedsResultBack(t *testing.T) {
	tool := &countTool{name: "search_customers", perm: "tenant.customers.read"}
	h := newHarness(t, []string{"tenant.customers.read"}, tool)
	h.fake.Responses = []provider.Response{
		provider.FakeToolCall("tu_1", "search_customers", map[string]any{"q": "hüseyin"}),
		provider.FakeText("Hüseyin Ülken bulundu."),
		provider.FakeText("Müşteri araması"), // title
	}
	rec := h.send(t, "Hüseyin'i bul")

	if tool.count() != 1 {
		t.Fatalf("tool calls = %d, want 1", tool.count())
	}
	if n := h.fake.RequestCount(); n != 3 {
		t.Fatalf("provider calls = %d, want 3 (2 chat + title)", n)
	}
	second := h.fake.Requests[1]
	last := second.Messages[len(second.Messages)-1]
	if last.Role != provider.RoleUser || last.Content[0].Type != provider.BlockToolResult || last.Content[0].ToolUseID != "tu_1" {
		t.Fatalf("second request must end with the tool_result, got %+v", last)
	}
	if !second.System[0].Cache || second.System[1].Cache {
		t.Fatalf("cache breakpoint must be on the stable system block only")
	}
	if !strings.Contains(second.System[1].Text, "Demo Oto Yıkama") || !strings.Contains(second.System[1].Text, "Ayşe Yılmaz") {
		t.Fatalf("session prompt missing org/user: %q", second.System[1].Text)
	}
	if strings.Contains(second.System[0].Text, "2026") {
		t.Fatalf("stable system block must not contain the date")
	}
	first := h.fake.Requests[0]
	if !strings.Contains(first.Messages[len(first.Messages)-1].Content[0].Text, "2026-09-24 14:30") {
		t.Fatalf("user turn must carry Istanbul time context, got %q", first.Messages[len(first.Messages)-1].Content[0].Text)
	}
	for _, ev := range []string{EventMessageStart, EventToolStart, EventToolResult, EventTextDelta, EventMessageDone, EventTitle} {
		if !rec.has(ev) {
			t.Fatalf("missing event %s in %v", ev, rec.events)
		}
	}
	// user row + assistant row
	if len(h.store.messages) != 2 {
		t.Fatalf("stored messages = %d, want 2", len(h.store.messages))
	}
	var ui []UIBlock
	_ = json.Unmarshal(h.store.messages[1].Ui, &ui)
	if len(ui) != 2 || ui[0].Type != UITool || ui[0].Status != "done" || ui[1].Type != UIText {
		t.Fatalf("unexpected ui blocks: %+v", ui)
	}
	// usage: 2 chat calls + 1 title
	if len(h.store.usage) != 3 || h.store.usage[2].Purpose != "title" {
		t.Fatalf("usage rows = %+v", h.store.usage)
	}
	if h.store.convs[0].Title != "Müşteri araması" {
		t.Fatalf("title = %q", h.store.convs[0].Title)
	}

	// Second turn replays the whole history including the tool loop.
	h.fake.Responses = []provider.Response{provider.FakeText("Rica ederim.")}
	h.send(t, "teşekkürler")
	replay := h.fake.Requests[3].Messages
	if len(replay) != 5 {
		t.Fatalf("replayed messages = %d, want 5 (user, assistant tool_use, tool_result, assistant, user)", len(replay))
	}
}

func TestToolsFilteredByPermissionAndSettings(t *testing.T) {
	allowed := &countTool{name: "list_jobs", perm: "tenant.jobs.read"}
	denied := &countTool{name: "get_finance_balances", perm: "tenant.finance.read"}
	disabled := &countTool{name: "search_products", perm: "tenant.catalog.read"}
	h := newHarness(t, []string{"tenant.jobs.read", "tenant.catalog.read"}, allowed, denied, disabled)
	h.store.settings.ToolSettings = []byte(`{"search_products": false}`)
	h.store.settings.ChartsEnabled = false

	// The model hallucinates a call to the forbidden tool.
	h.fake.Responses = []provider.Response{
		provider.FakeToolCall("tu_x", "get_finance_balances", map[string]any{"q": "x"}),
		provider.FakeText("Yetkiniz yok."),
		provider.FakeText("Başlık"),
	}
	h.send(t, "kasada ne kadar var?")

	got := toolNames(h.fake.Requests[0])
	if len(got) != 1 || got[0] != "list_jobs" {
		t.Fatalf("offered tools = %v, want [list_jobs]", got)
	}
	if denied.count() != 0 {
		t.Fatal("forbidden tool must not run")
	}
	res := h.fake.Requests[1].Messages[len(h.fake.Requests[1].Messages)-1].Content[0]
	if !res.IsError || !strings.Contains(res.Content, "not available") {
		t.Fatalf("expected not-available error result, got %+v", res)
	}
}

func TestInvalidToolInputIsRejectedBeforeRun(t *testing.T) {
	tool := &countTool{name: "search_customers", perm: "tenant.customers.read"}
	h := newHarness(t, []string{"tenant.customers.read"}, tool)
	h.fake.Responses = []provider.Response{
		provider.FakeToolCall("tu_1", "search_customers", map[string]any{"q": "", "extra": 1}),
		provider.FakeText("Tamam"),
		provider.FakeText("t"),
	}
	h.send(t, "ara")
	if tool.count() != 0 {
		t.Fatal("tool must not run with invalid input")
	}
	res := h.fake.Requests[1].Messages[len(h.fake.Requests[1].Messages)-1].Content[0]
	if !res.IsError || !strings.Contains(res.Content, "Invalid input") {
		t.Fatalf("expected validation error, got %+v", res)
	}
}

func TestIterationCap(t *testing.T) {
	tool := &countTool{name: "list_jobs", perm: "tenant.jobs.read"}
	h := newHarness(t, []string{"tenant.jobs.read"}, tool)
	h.svc.SetMaxIterations(3)
	loopCall := provider.FakeToolCall("tu_loop", "list_jobs", map[string]any{"q": "a"})
	h.fake.Fallback = &loopCall
	h.store.convs[0].Title = "already titled"
	h.conv.Title = "already titled"
	h.send(t, "sonsuz döngü")

	if n := h.fake.RequestCount(); n != 3 {
		t.Fatalf("provider calls = %d, want 3", n)
	}
	for i, req := range h.fake.Requests {
		if want := i == 2; req.ToolChoiceNone != want {
			t.Fatalf("request %d ToolChoiceNone = %v, want %v", i, req.ToolChoiceNone, want)
		}
	}
}

func TestQuotaEnforcement(t *testing.T) {
	tool := &countTool{name: "list_jobs", perm: "tenant.jobs.read"}
	h := newHarness(t, []string{"tenant.jobs.read"}, tool)

	h.store.usedExtra = 1_000_000
	if _, err := h.svc.PrepareMessage(h.ctx, h.conv.UUID, SendInput{Content: "merhaba"}); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("prepare err = %v, want ErrQuotaExceeded", err)
	}
	st, err := h.svc.Status(h.ctx)
	if err != nil || st.Available || st.Reason != "quota_exceeded" {
		t.Fatalf("status = %+v, %v", st, err)
	}

	// Org override: unlimited.
	zero := int64(0)
	if _, err := h.svc.PutOrgSettings(h.ctx, uuid.New(), PutOrgSettingsInput{Enabled: true, MonthlyTokenQuota: &zero}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.PrepareMessage(h.ctx, h.conv.UUID, SendInput{Content: "merhaba"}); err != nil {
		t.Fatalf("unlimited override must allow: %v", err)
	}

	// Mid-loop: the quota runs out after the first call.
	limit := int64(1_000_050)
	if _, err := h.svc.PutOrgSettings(h.ctx, uuid.New(), PutOrgSettingsInput{Enabled: true, MonthlyTokenQuota: &limit}); err != nil {
		t.Fatal(err)
	}
	h.fake.Responses = []provider.Response{
		provider.FakeToolCall("tu_1", "list_jobs", map[string]any{"q": "a"}), // 120 tokens → exceeds
		provider.FakeText("never"),
	}
	rec := h.send(t, "bugün kaç araç")
	if h.fake.RequestCount() != 1 {
		t.Fatalf("provider calls = %d, want 1 (stopped by quota)", h.fake.RequestCount())
	}
	found := false
	for i, ev := range rec.events {
		if ev == EventError {
			if m, ok := rec.data[i].(map[string]any); ok && m["code"] == "quota_exceeded" {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("expected quota_exceeded error event, got %v", rec.events)
	}

	// Organization disabled.
	if _, err := h.svc.PutOrgSettings(h.ctx, uuid.New(), PutOrgSettingsInput{Enabled: false}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.PrepareMessage(h.ctx, h.conv.UUID, SendInput{Content: "x"}); !errors.Is(err, ErrOrgDisabled) {
		t.Fatalf("err = %v, want ErrOrgDisabled", err)
	}
}

func TestDisabledAndUnconfigured(t *testing.T) {
	h := newHarness(t, nil)
	h.store.settings.ChatEnabled = false
	if _, err := h.svc.PrepareMessage(h.ctx, h.conv.UUID, SendInput{Content: "x"}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("err = %v, want ErrDisabled", err)
	}
	h.store.settings.ChatEnabled = true
	h.store.settings.ApiKeyEnc.Valid = false
	if _, err := h.svc.PrepareMessage(h.ctx, h.conv.UUID, SendInput{Content: "x"}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
	// Enabling chat without a key is rejected.
	on := true
	if _, err := h.svc.PatchSettings(h.ctx, nil, PatchSettingsInput{Features: &FeaturesPatch{Chat: &on}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("err = %v, want ErrInvalidRequest", err)
	}
}

func TestWriteToolGoesThroughConfirmationGate(t *testing.T) {
	write := &countTool{name: "record_payment", perm: "tenant.cari.write", kind: tools.KindWrite, conf: true}
	h := newHarness(t, []string{"tenant.cari.write"}, write)
	h.store.settings.ActionsEnabled = true
	h.fake.Responses = []provider.Response{
		provider.FakeToolCall("tu_w", "record_payment", map[string]any{"q": "20000"}),
		provider.FakeText("Bunu uygulamadan yapmanız gerekiyor."),
		provider.FakeText("t"),
	}
	h.send(t, "Hüseyin'den 20 bin aldım, işle")
	if write.count() != 0 {
		t.Fatal("write tool must never run without confirmation")
	}
	if !strings.Contains(h.fake.Requests[0].System[0].Text, "confirmation card") {
		t.Fatal("system prompt should describe the confirmation flow when write tools are offered")
	}
	res := h.fake.Requests[1].Messages[len(h.fake.Requests[1].Messages)-1].Content[0]
	if !res.IsError || !strings.Contains(res.Content, "not available yet") {
		t.Fatalf("expected disabled-gate result, got %+v", res)
	}
}

func TestRenderChartReferencesEarlierResult(t *testing.T) {
	tool := &countTool{name: "get_report_summary", perm: "tenant.reports.read"}
	h := newHarness(t, []string{"tenant.reports.read"}, tool)
	h.fake.Responses = []provider.Response{
		provider.FakeToolCall("tu_r", "get_report_summary", map[string]any{"q": "month"}),
		provider.FakeToolCall("tu_c", "render_chart", map[string]any{
			"type": "bar", "title": "Gelir", "x_key": "day",
			"series":             []map[string]any{{"key": "total", "label": "Toplam"}},
			"source_tool_use_id": "tu_r", "rows_path": "rows",
		}),
		provider.FakeText("Grafik hazır."),
		provider.FakeText("Gelir grafiği"),
	}
	rec := h.send(t, "bu ayın gelir grafiği")
	if !rec.has(EventChart) {
		t.Fatalf("expected chart event, got %v", rec.events)
	}
	res := h.fake.Requests[2].Messages[len(h.fake.Requests[2].Messages)-1].Content[0]
	if res.IsError || res.Content != "rendered" {
		t.Fatalf("chart result = %+v", res)
	}
	var ui []UIBlock
	_ = json.Unmarshal(h.store.messages[1].Ui, &ui)
	var chart *tools.Chart
	for _, b := range ui {
		if b.Type == UIChart {
			chart = b.Chart
		}
	}
	if chart == nil || len(chart.Rows) != 2 || chart.Rows[1]["total"] != float64(20) {
		t.Fatalf("chart block = %+v", chart)
	}
}

func TestProviderErrorIsReportedAndPersisted(t *testing.T) {
	h := newHarness(t, nil)
	h.fake.Err = &provider.Error{StatusCode: 401, Message: "invalid x-api-key"}
	rec := h.send(t, "merhaba")
	if !rec.has(EventError) || !rec.has(EventMessageDone) {
		t.Fatalf("events = %v", rec.events)
	}
	if h.store.messages[1].Status != "error" {
		t.Fatalf("assistant status = %q", h.store.messages[1].Status)
	}
	// Title falls back to the user text when the provider fails.
	if h.store.convs[0].Title != "merhaba" {
		t.Fatalf("title = %q", h.store.convs[0].Title)
	}
}

func TestConversationsAreScopedToUser(t *testing.T) {
	h := newHarness(t, nil)
	other := authctx.WithPrincipal(h.ctx, authctx.Principal{UserInternal: 99})
	if _, err := h.svc.GetConversation(other, h.conv.UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	if err := h.svc.DeleteConversation(h.ctx, h.conv.UUID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.GetConversation(h.ctx, h.conv.UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted conversation must be gone: %v", err)
	}
}

func TestSettingsNeverExposeKey(t *testing.T) {
	h := newHarness(t, nil)
	key := "sk-ant-api03-secret-value-9876"
	st, err := h.svc.PatchSettings(h.ctx, nil, PatchSettingsInput{APIKey: &key})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(st)
	if strings.Contains(string(raw), "secret-value") {
		t.Fatalf("settings payload leaks the key: %s", raw)
	}
	if !st.HasAPIKey || st.APIKeyHint != "…9876" {
		t.Fatalf("has_api_key/hint = %v %q", st.HasAPIKey, st.APIKeyHint)
	}
	if h.store.settings.ApiKeyEnc.String != "enc:"+key {
		t.Fatal("key must be stored encrypted")
	}
	st, err = h.svc.PatchSettings(h.ctx, nil, PatchSettingsInput{ClearAPIKey: true, Features: &FeaturesPatch{Chat: new(bool)}})
	if err != nil || st.HasAPIKey {
		t.Fatalf("clear key: %+v %v", st, err)
	}
	bad := "bogus"
	if _, err := h.svc.PatchSettings(h.ctx, nil, PatchSettingsInput{Tools: map[string]bool{bad: false}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unknown tool must be rejected: %v", err)
	}
}
