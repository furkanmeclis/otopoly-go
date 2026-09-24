package usecase

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/provider"
)

func userText(s string) provider.Message {
	return provider.Message{Role: provider.RoleUser, Content: []provider.Block{provider.TextBlock(s)}}
}

func TestSanitizeAnswersDanglingToolUse(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, Content: []provider.Block{provider.TextBlock("leading assistant is dropped")}},
		userText("kaydet"),
		{Role: provider.RoleAssistant, Content: []provider.Block{{Type: provider.BlockToolUse, ID: "tu_1", Name: "record_payment", Input: json.RawMessage(`{}`)}}},
		// turn interrupted: no tool_result; the user moves on
		userText("boşver"),
		{Role: provider.RoleUser, Content: []provider.Block{provider.ToolResultBlock("orphan", "x", false)}},
	}
	out := sanitizeHistory(msgs)
	if len(out) != 3 {
		t.Fatalf("len = %d, want 3: %+v", len(out), out)
	}
	last := out[2]
	if last.Content[0].Type != provider.BlockToolResult || last.Content[0].ToolUseID != "tu_1" || !last.Content[0].IsError {
		t.Fatalf("expected synthetic result first, got %+v", last.Content)
	}
	for _, b := range last.Content {
		if b.ToolUseID == "orphan" {
			t.Fatal("orphan tool_result must be dropped")
		}
	}
	if last.Content[1].Text != "boşver" {
		t.Fatalf("user text must follow tool results: %+v", last.Content)
	}
}

func TestSanitizeTrailingAssistantToolUse(t *testing.T) {
	out := sanitizeHistory([]provider.Message{
		userText("a"),
		{Role: provider.RoleAssistant, Content: []provider.Block{{Type: provider.BlockToolUse, ID: "tu_9", Name: "x"}}},
	})
	if len(out) != 3 || out[2].Content[0].ToolUseID != "tu_9" {
		t.Fatalf("trailing tool_use must be answered: %+v", out)
	}
}

func TestTrimHistoryIsQuantized(t *testing.T) {
	build := func(turns int) []provider.Message {
		var msgs []provider.Message
		for i := 0; i < turns; i++ {
			id := fmt.Sprintf("tu_%d", i)
			msgs = append(msgs,
				userText(fmt.Sprintf("q%d", i)),
				provider.Message{Role: provider.RoleAssistant, Content: []provider.Block{{Type: provider.BlockToolUse, ID: id, Name: "t"}}},
				provider.Message{Role: provider.RoleUser, Content: []provider.Block{provider.ToolResultBlock(id, "a long tool result payload that should be cleared eventually because it is old", false)}},
				provider.Message{Role: provider.RoleAssistant, Content: []provider.Block{provider.TextBlock("ok")}},
			)
		}
		return msgs
	}
	cleared := func(msgs []provider.Message) int {
		n := 0
		for _, m := range msgs {
			for _, b := range m.Content {
				if b.Type == provider.BlockToolResult && b.Content == clearedToolResult {
					n++
				}
			}
		}
		return n
	}
	if got := cleared(trimHistory(build(keepFullTurns))); got != 0 {
		t.Fatalf("no clearing within keep window, got %d", got)
	}
	// 12 turns → boundary at turn 6; 13..17 turns keep the same boundary (stable cache prefix).
	for turns := 2 * keepFullTurns; turns < 3*keepFullTurns; turns++ {
		if got := cleared(trimHistory(build(turns))); got != keepFullTurns {
			t.Fatalf("turns=%d cleared=%d, want %d", turns, got, keepFullTurns)
		}
	}
	long := trimHistory(build(maxHistoryTurns + 3))
	if n := len(long) / 4; n > maxHistoryTurns {
		t.Fatalf("history not capped: %d turns", n)
	}
	if !hasUserText(long[0]) {
		t.Fatal("trimmed history must start at a user turn")
	}
}

func TestHistoryStripsThinkingFromOtherModels(t *testing.T) {
	content, _ := json.Marshal([]provider.Message{{Role: provider.RoleAssistant, Content: []provider.Block{
		{Type: provider.BlockThinking, Thinking: "", Signature: "sig"},
		provider.TextBlock("hi"),
	}}})
	rows := []db.AiMessage{{Role: "assistant", Model: "claude-opus-4-8", Content: content}}
	same, _ := historyFromRows(rows, "claude-opus-4-8")
	other, _ := historyFromRows(rows, "claude-opus-5")
	if len(same[0].Content) != 2 || len(other[0].Content) != 1 {
		t.Fatalf("same=%d other=%d", len(same[0].Content), len(other[0].Content))
	}
}

func TestEstimateCost(t *testing.T) {
	c, ok := EstimateCostUSD("claude-opus-5", provider.Usage{InputTokens: 1_000_000, OutputTokens: 100_000, CacheReadTokens: 1_000_000})
	if !ok || c != 5+2.5+0.5 {
		t.Fatalf("cost = %v %v", c, ok)
	}
	if c, ok := EstimateCostUSD("claude-opus-5-5", provider.Usage{OutputTokens: 1_000_000}); !ok || c != 20 {
		t.Fatalf("opus-5-5 cost = %v", c)
	}
	if _, ok := EstimateCostUSD("qwen2.5:14b", provider.Usage{InputTokens: 10}); ok {
		t.Fatal("open models have no price")
	}
}
