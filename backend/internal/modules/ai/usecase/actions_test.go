package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/provider"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/google/uuid"
)

// fakeAction is a confirmable write tool.
type fakeAction struct {
	mu        sync.Mutex
	runs      int
	lastInput map[string]any
	viaAI     bool
}

var fakeActionSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"amount": map[string]any{"type": "number"},
		"note":   map[string]any{"type": "string"},
	},
	"required":             []string{"amount"},
	"additionalProperties": false,
}

func (*fakeAction) Spec() tools.Spec {
	return tools.Spec{
		Name: "record_cari_payment", Description: "test", InputSchema: fakeActionSchema,
		Permissions: []string{"tenant.cari.write"}, OrgRoles: []string{"owner"},
		Feature: tools.FeatureActions, Kind: tools.KindWrite, RequiresConfirmation: true,
	}
}

func (*fakeAction) Propose(_ context.Context, _ tools.Env, raw json.RawMessage) (tools.Proposal, error) {
	var in struct {
		Amount float64 `json:"amount"`
		Note   string  `json:"note,omitempty"`
	}
	_ = json.Unmarshal(raw, &in)
	if in.Amount <= 0 {
		return tools.Proposal{}, &tools.InputError{Msg: "amount must be greater than zero"}
	}
	out, _ := json.Marshal(in)
	return tools.Proposal{Input: out, Preview: tools.Preview{
		Action: "record_cari_payment", Title: "Hüseyin Ülken",
		Fields: []tools.Field{{Key: "customer", Value: "Hüseyin Ülken"}},
		Edit:   []tools.EditField{{Key: "amount", Type: "money", Required: true}, {Key: "note", Type: "text"}},
	}}, nil
}

func (f *fakeAction) Run(ctx context.Context, _ tools.Env, raw json.RawMessage) (tools.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.runs++
	f.lastInput = map[string]any{}
	_ = json.Unmarshal(raw, &f.lastInput)
	if o, ok := activity.OriginFrom(ctx); ok && o.Via == "ai" {
		f.viaAI = true
	}
	return tools.JSONResult(map[string]any{"done": true, "new_balance": "₺0,00"}, "ai.tool_summary.payment_recorded", nil), nil
}

func (f *fakeAction) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.runs
}

type fakeActivity struct {
	mu      sync.Mutex
	actions []string
}

func (a *fakeActivity) Record(_ context.Context, _ *int64, action, _ string, _ *uuid.UUID, _ map[string]any, _ *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.actions = append(a.actions, action)
}

type actionHarness struct {
	*harness
	tool *fakeAction
	act  *fakeActivity
	now  time.Time
}

func newActionHarness(t *testing.T) *actionHarness {
	t.Helper()
	tool := &fakeAction{}
	h := newHarness(t, []string{"tenant.cari.write"}, tool)
	ah := &actionHarness{harness: h, tool: tool, act: &fakeActivity{}, now: time.Date(2026, 9, 24, 11, 30, 0, 0, time.UTC)}
	clock := func() time.Time { return ah.now }
	h.svc.SetClock(clock)
	h.store.clock = clock
	h.store.settings.ActionsEnabled = true
	h.svc.EnableActions()
	h.svc.SetActivityRecorder(ah.act)
	return ah
}

// propose runs a turn in which the model proposes a payment of amount.
func (h *actionHarness) propose(t *testing.T, id string, amount float64) (*recorded, uuid.UUID) {
	t.Helper()
	h.fake.Responses = append(h.fake.Responses,
		provider.FakeToolCall(id, "record_cari_payment", map[string]any{"amount": amount}),
		provider.FakeText("Tahsilat"), // title
	)
	rec := h.send(t, "Hüseyin Ülken'den nakit 20 bin aldım, işle")
	var actionID uuid.UUID
	for i, ev := range rec.events {
		if ev == EventConfirm {
			block := rec.data[i].(map[string]any)["block"].(UIBlock)
			actionID = uuid.MustParse(block.ID)
		}
	}
	if actionID == uuid.Nil {
		t.Fatalf("no confirm event in %v", rec.events)
	}
	return rec, actionID
}

func (h *actionHarness) action(id uuid.UUID) (status string, hasMessage bool) {
	h.store.mu.Lock()
	defer h.store.mu.Unlock()
	for _, a := range h.store.actions {
		if a.Uuid == id {
			return a.Status, a.MessageID.Valid
		}
	}
	return "", false
}

func TestProposalPausesLoopAndPersistsPendingAction(t *testing.T) {
	h := newActionHarness(t)
	_, id := h.propose(t, "tu_w", 20000)

	if h.tool.count() != 0 {
		t.Fatal("write tool must not run before confirmation")
	}
	// 1 chat call (paused, no follow-up) + 1 title call.
	if n := h.fake.RequestCount(); n != 2 {
		t.Fatalf("provider calls = %d, want 2", n)
	}
	status, attached := h.action(id)
	if status != ActionPending || !attached {
		t.Fatalf("action status=%q attached=%v", status, attached)
	}
	var ui []UIBlock
	_ = json.Unmarshal(h.store.messages[1].Ui, &ui)
	var sawConfirm, sawPendingTool bool
	for _, b := range ui {
		if b.Type == UIConfirm && b.ID == id.String() && b.Status == ActionPending {
			sawConfirm = true
		}
		if b.Type == UITool && b.Status == "pending" {
			sawPendingTool = true
		}
	}
	if !sawConfirm || !sawPendingTool {
		t.Fatalf("ui blocks = %+v", ui)
	}
}

func TestConfirmExecutesOnceAndResumesConversation(t *testing.T) {
	h := newActionHarness(t)
	_, id := h.propose(t, "tu_w", 20000)

	run, err := h.svc.PrepareConfirm(h.ctx, id, ConfirmInput{})
	if err != nil {
		t.Fatalf("prepare confirm: %v", err)
	}
	// A second confirm while the first is executing is rejected (idempotency lock).
	if _, err := h.svc.PrepareConfirm(h.ctx, id, ConfirmInput{}); !errors.Is(err, ErrActionResolved) {
		t.Fatalf("double confirm err = %v, want ErrActionResolved", err)
	}
	h.fake.Responses = []provider.Response{provider.FakeText("İşlendi, kalan bakiye ₺0,00.")}
	rec := &recorded{}
	if err := h.svc.RunConfirm(h.ctx, run, rec.emit); err != nil {
		t.Fatalf("run confirm: %v", err)
	}
	if h.tool.count() != 1 {
		t.Fatalf("runs = %d, want 1", h.tool.count())
	}
	if !h.tool.viaAI {
		t.Fatal("action must run with the AI activity origin")
	}
	for _, ev := range []string{EventAction, EventMessageStart, EventTextDelta, EventMessageDone} {
		if !rec.has(ev) {
			t.Fatalf("missing %s in %v", ev, rec.events)
		}
	}
	if status, _ := h.action(id); status != ActionConfirmed {
		t.Fatalf("status = %q", status)
	}
	// The continuation request ends with the real tool_result.
	last := h.fake.Requests[len(h.fake.Requests)-1]
	tail := last.Messages[len(last.Messages)-1]
	if tail.Role != provider.RoleUser || tail.Content[0].ToolUseID != "tu_w" || tail.Content[0].IsError ||
		!strings.Contains(tail.Content[0].Content, "new_balance") {
		t.Fatalf("continuation must end with the tool result, got %+v", tail)
	}
	if len(h.act.actions) != 1 || h.act.actions[0] != "ai.action.confirmed" {
		t.Fatalf("activity = %v", h.act.actions)
	}
	// Confirming again after completion is a no-op conflict.
	if _, err := h.svc.PrepareConfirm(h.ctx, id, ConfirmInput{}); !errors.Is(err, ErrActionResolved) {
		t.Fatalf("confirm after done err = %v", err)
	}
	if h.tool.count() != 1 {
		t.Fatal("action must execute exactly once")
	}
	// Next user turn replays the tool loop without synthetic "not executed" results.
	h.fake.Responses = []provider.Response{provider.FakeText("Rica ederim")}
	h.send(t, "teşekkürler")
	for _, m := range h.fake.Requests[len(h.fake.Requests)-1].Messages {
		for _, b := range m.Content {
			if b.Type == provider.BlockToolResult && strings.Contains(b.Content, "Not executed") {
				t.Fatalf("unexpected not-executed result in history: %+v", b)
			}
		}
	}
}

func TestConfirmRequiresAIPlan(t *testing.T) {
	h := newActionHarness(t)
	_, id := h.propose(t, "tu_w", 20000)
	h.setAIPlanEnabled(false)

	if _, err := h.svc.PrepareConfirm(h.ctx, id, ConfirmInput{}); !errors.Is(err, entitlements.ErrFeatureDisabled) {
		t.Fatalf("prepare confirm err = %v, want ErrFeatureDisabled", err)
	}
	if h.tool.count() != 0 {
		t.Fatalf("tool runs = %d, want 0", h.tool.count())
	}

	h.setAIPlanEnabled(true)
	if _, err := h.svc.PrepareConfirm(h.ctx, id, ConfirmInput{}); err != nil {
		t.Fatalf("plan on prepare confirm: %v", err)
	}
}

func TestConfirmWithEdits(t *testing.T) {
	h := newActionHarness(t)
	_, id := h.propose(t, "tu_w", 20000)
	if _, err := h.svc.PrepareConfirm(h.ctx, id, ConfirmInput{Edits: map[string]any{"customer": "x"}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("non-editable field err = %v", err)
	}
	if _, err := h.svc.PrepareConfirm(h.ctx, id, ConfirmInput{Edits: map[string]any{"amount": "0"}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("invalid amount err = %v", err)
	}
	run, err := h.svc.PrepareConfirm(h.ctx, id, ConfirmInput{Edits: map[string]any{"amount": "15.000,50", "note": "elden"}})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	h.fake.Responses = []provider.Response{provider.FakeText("Tamam")}
	if err := h.svc.RunConfirm(h.ctx, run, nil); err != nil {
		t.Fatal(err)
	}
	if h.tool.lastInput["amount"] != 15000.5 || h.tool.lastInput["note"] != "elden" {
		t.Fatalf("edited input = %v", h.tool.lastInput)
	}
}

func TestCancelAction(t *testing.T) {
	h := newActionHarness(t)
	_, id := h.propose(t, "tu_w", 20000)
	block, err := h.svc.CancelAction(h.ctx, id)
	if err != nil || block.Status != ActionCancelled {
		t.Fatalf("cancel: %+v %v", block, err)
	}
	if _, err := h.svc.PrepareConfirm(h.ctx, id, ConfirmInput{}); !errors.Is(err, ErrActionResolved) {
		t.Fatalf("confirm after cancel err = %v", err)
	}
	if h.tool.count() != 0 {
		t.Fatal("cancelled action must not run")
	}
	h.fake.Responses = []provider.Response{provider.FakeText("Tamam, işlemedim.")}
	h.send(t, "peki")
	found := false
	for _, m := range h.fake.Requests[len(h.fake.Requests)-1].Messages {
		for _, b := range m.Content {
			if b.Type == provider.BlockToolResult && b.ToolUseID == "tu_w" && strings.Contains(b.Content, "cancelled") {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("history must tell the model the user cancelled")
	}
}

func TestConfirmRequiresUnderlyingPermission(t *testing.T) {
	h := newActionHarness(t)
	_, id := h.propose(t, "tu_w", 20000)
	p, _ := authctx.PrincipalFrom(h.ctx)
	p.Permissions = nil // lost tenant.cari.write since the proposal
	ctx := authctx.WithPrincipal(h.ctx, p)
	if _, err := h.svc.PrepareConfirm(ctx, id, ConfirmInput{}); !errors.Is(err, ErrActionForbidden) {
		t.Fatalf("err = %v, want ErrActionForbidden", err)
	}
	// Another user cannot see the action at all.
	other := authctx.WithPrincipal(h.ctx, authctx.Principal{UserInternal: 99, Permissions: []string{"tenant.cari.write"}})
	if _, err := h.svc.PrepareConfirm(other, id, ConfirmInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user err = %v, want ErrNotFound", err)
	}
	if h.tool.count() != 0 {
		t.Fatal("must not run")
	}
}

func TestExpiredAndSupersededActions(t *testing.T) {
	h := newActionHarness(t)
	_, id := h.propose(t, "tu_w", 20000)
	h.now = h.now.Add(PendingActionTTL + time.Minute)
	if _, err := h.svc.PrepareConfirm(h.ctx, id, ConfirmInput{}); !errors.Is(err, ErrActionExpired) {
		t.Fatalf("err = %v, want ErrActionExpired", err)
	}
	if status, _ := h.action(id); status != ActionExpired {
		t.Fatalf("status = %q", status)
	}

	// A new message resolves an unanswered card as not executed.
	_, id2 := h.propose(t, "tu_w2", 500)
	h.fake.Responses = []provider.Response{provider.FakeText("Başka bir şey?")}
	h.send(t, "boşver")
	if status, _ := h.action(id2); status != ActionExpired {
		t.Fatalf("superseded status = %q", status)
	}
	if h.tool.count() != 0 {
		t.Fatal("expired actions must not run")
	}
}

func TestOneProposalPerResponse(t *testing.T) {
	h := newActionHarness(t)
	h.fake.Responses = []provider.Response{
		{Message: provider.Message{Role: provider.RoleAssistant, Content: []provider.Block{
			{Type: provider.BlockToolUse, ID: "a", Name: "record_cari_payment", Input: json.RawMessage(`{"amount":1}`)},
			{Type: provider.BlockToolUse, ID: "b", Name: "record_cari_payment", Input: json.RawMessage(`{"amount":2}`)},
		}}, StopReason: provider.StopToolUse},
		provider.FakeText("t"),
	}
	rec := h.send(t, "iki işlem")
	confirms := 0
	for _, ev := range rec.events {
		if ev == EventConfirm {
			confirms++
		}
	}
	if confirms != 1 {
		t.Fatalf("confirm cards = %d, want 1", confirms)
	}
	var msgs []provider.Message
	_ = json.Unmarshal(h.store.messages[1].Content, &msgs)
	if !strings.Contains(string(h.store.messages[1].Content), "one change") {
		t.Fatalf("second proposal must be rejected: %+v", msgs)
	}
}

func TestInvalidProposalIsReturnedToModel(t *testing.T) {
	h := newActionHarness(t)
	h.fake.Responses = []provider.Response{
		provider.FakeToolCall("tu_bad", "record_cari_payment", map[string]any{"amount": 0}),
		provider.FakeText("Tutar sıfır olamaz."),
		provider.FakeText("t"),
	}
	rec := h.send(t, "0 lira aldım")
	if rec.has(EventConfirm) {
		t.Fatal("invalid proposal must not produce a card")
	}
	res := h.fake.Requests[1].Messages[len(h.fake.Requests[1].Messages)-1].Content[0]
	if !res.IsError || !strings.Contains(res.Content, "greater than zero") {
		t.Fatalf("result = %+v", res)
	}
}

func TestPlanBlockIsReplacedInPlace(t *testing.T) {
	h := newHarness(t, nil, tools.UpdatePlan{})
	h.fake.Responses = []provider.Response{
		provider.FakeToolCall("p1", "update_plan", map[string]any{"items": []map[string]any{{"text": "Müşteriyi bul", "status": "in_progress"}, {"text": "Tahsilat", "status": "pending"}}}),
		provider.FakeToolCall("p2", "update_plan", map[string]any{"items": []map[string]any{{"text": "Müşteriyi bul", "status": "done"}, {"text": "Tahsilat", "status": "in_progress"}}}),
		provider.FakeText("Tamam"),
		provider.FakeText("t"),
	}
	rec := h.send(t, "iki adım")
	if !rec.has(EventPlan) {
		t.Fatal("missing plan event")
	}
	var ui []UIBlock
	_ = json.Unmarshal(h.store.messages[1].Ui, &ui)
	plans := 0
	for _, b := range ui {
		if b.Type == UITodoList {
			plans++
			if !strings.Contains(string(b.Data), `"done"`) {
				t.Fatalf("plan not updated: %s", b.Data)
			}
		}
	}
	if plans != 1 {
		t.Fatalf("plan blocks = %d, want 1", plans)
	}
}
