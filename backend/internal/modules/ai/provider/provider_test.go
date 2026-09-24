package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func sampleRequest() Request {
	return Request{
		Model: "claude-opus-5",
		System: []SystemBlock{
			{Text: "stable prompt", Cache: true},
			{Text: "<session>org</session>"},
		},
		Messages: []Message{
			{Role: RoleUser, Content: []Block{TextBlock("bugün kaç araç?")}},
			{Role: RoleAssistant, Content: []Block{
				{Type: BlockThinking, Signature: "sig-1"},
				{Type: BlockToolUse, ID: "toolu_0", Name: "list_jobs", Input: json.RawMessage(`{}`)},
			}},
			{Role: RoleUser, Content: []Block{ToolResultBlock("toolu_0", `{"total":3}`, false)}},
		},
		Tools: []ToolDef{{Name: "list_jobs", Description: "jobs", InputSchema: map[string]any{
			"type": "object", "properties": map[string]any{"status": map[string]any{"type": "string"}},
			"required": []string{}, "additionalProperties": false,
		}}},
		MaxTokens:     2000,
		Effort:        "medium",
		Thinking:      true,
		CacheMessages: true,
	}
}

func sse(w io.Writer, event string, data string) {
	_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
}

func TestAnthropicStreamRequestAndParse(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" || r.Header.Get("X-Api-Key") != "sk-test" {
			t.Errorf("unexpected request %s key=%q", r.URL.Path, r.Header.Get("X-Api-Key"))
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		w.Header().Set("Content-Type", "text/event-stream")
		sse(w, "message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":1,"cache_read_input_tokens":900,"cache_creation_input_tokens":40}}}`)
		sse(w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
		sse(w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Bakıyorum"}}`)
		sse(w, "content_block_stop", `{"type":"content_block_stop","index":0}`)
		sse(w, "content_block_start", `{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"list_jobs","input":{}}}`)
		sse(w, "content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"status\":"}}`)
		sse(w, "content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"ready\"}"}}`)
		sse(w, "content_block_stop", `{"type":"content_block_stop","index":1}`)
		sse(w, "message_delta", `{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":42}}`)
		sse(w, "message_stop", `{"type":"message_stop"}`)
	}))
	defer srv.Close()

	p := NewAnthropic(Config{APIKey: "sk-test", BaseURL: srv.URL})
	var events []StreamEvent
	resp, err := p.Stream(context.Background(), sampleRequest(), func(ev StreamEvent) { events = append(events, ev) })
	if err != nil {
		t.Fatal(err)
	}

	// Request shape.
	if body["stream"] != true {
		t.Fatal("stream must be true")
	}
	if tt, _ := body["thinking"].(map[string]any); tt["type"] != "adaptive" {
		t.Fatalf("thinking = %v", body["thinking"])
	}
	if oc, _ := body["output_config"].(map[string]any); oc["effort"] != "medium" {
		t.Fatalf("output_config = %v", body["output_config"])
	}
	if _, ok := body["cache_control"]; !ok {
		t.Fatal("top-level cache_control expected for message caching")
	}
	sys := body["system"].([]any)
	if _, ok := sys[0].(map[string]any)["cache_control"]; !ok {
		t.Fatal("stable system block must carry cache_control")
	}
	if _, ok := sys[1].(map[string]any)["cache_control"]; ok {
		t.Fatal("session block must be after the breakpoint")
	}
	tool := body["tools"].([]any)[0].(map[string]any)
	if tool["eager_input_streaming"] != true {
		t.Fatalf("eager_input_streaming = %v", tool["eager_input_streaming"])
	}
	if schema := tool["input_schema"].(map[string]any); schema["additionalProperties"] != false {
		t.Fatalf("input_schema = %v", schema)
	}
	msgs := body["messages"].([]any)
	asst := msgs[1].(map[string]any)["content"].([]any)
	if asst[0].(map[string]any)["type"] != "thinking" || asst[0].(map[string]any)["signature"] != "sig-1" {
		t.Fatalf("thinking block not replayed: %v", asst[0])
	}

	// Response parsing.
	if resp.StopReason != StopToolUse {
		t.Fatalf("stop = %q", resp.StopReason)
	}
	if resp.Usage != (Usage{InputTokens: 12, OutputTokens: 42, CacheReadTokens: 900, CacheWriteTokens: 40}) {
		t.Fatalf("usage = %+v", resp.Usage)
	}
	tus := resp.Message.ToolUses()
	if len(tus) != 1 || string(tus[0].Input) != `{"status":"ready"}` {
		t.Fatalf("tool uses = %+v", tus)
	}
	if len(events) != 2 || events[0].Text != "Bakıyorum" || events[1].Name != "list_jobs" {
		t.Fatalf("events = %+v", events)
	}
}

func TestAnthropicErrorIsWrapped(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
	}))
	defer srv.Close()
	p := NewAnthropic(Config{APIKey: "bad", BaseURL: srv.URL})
	_, err := p.Complete(context.Background(), Request{Model: "claude-haiku-4-5", MaxTokens: 10, Messages: []Message{{Role: RoleUser, Content: []Block{TextBlock("hi")}}}})
	var pe *Error
	if err == nil || !asError(err, &pe) || pe.StatusCode != 401 || pe.Message != "invalid x-api-key" {
		t.Fatalf("err = %v", err)
	}
}

func asError(err error, target **Error) bool {
	for err != nil {
		if e, ok := err.(*Error); ok {
			*target = e
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}

func TestOpenAICompatibleStream(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path = %s", r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		w.Header().Set("Content-Type", "text/event-stream")
		chunks := []string{
			`{"model":"qwen","choices":[{"index":0,"delta":{"role":"assistant","content":"Hmm "}}]}`,
			`{"model":"qwen","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"list_jobs","arguments":""}}]}}]}`,
			`{"model":"qwen","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"status\":\"ready\"}"}}]}}]}`,
			`{"model":"qwen","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
			`{"model":"qwen","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":60}}}`,
		}
		for _, c := range chunks {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", c)
		}
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	p := NewOpenAICompatible(Config{BaseURL: srv.URL + "/v1/"})
	req := sampleRequest()
	req.Model = "qwen"
	resp, err := p.Stream(context.Background(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	msgs := body["messages"].([]any)
	roles := []string{}
	for _, m := range msgs {
		roles = append(roles, m.(map[string]any)["role"].(string))
	}
	if strings.Join(roles, ",") != "system,user,assistant,tool" {
		t.Fatalf("roles = %v", roles)
	}
	if body["tools"].([]any)[0].(map[string]any)["type"] != "function" {
		t.Fatal("tools must be function tools")
	}
	if resp.StopReason != StopToolUse || len(resp.Message.ToolUses()) != 1 {
		t.Fatalf("resp = %+v", resp)
	}
	if string(resp.Message.ToolUses()[0].Input) != `{"status":"ready"}` || resp.Message.Text() != "Hmm " {
		t.Fatalf("message = %+v", resp.Message)
	}
	if resp.Usage != (Usage{InputTokens: 40, OutputTokens: 20, CacheReadTokens: 60}) {
		t.Fatalf("usage = %+v", resp.Usage)
	}
}

func TestSupportsAdaptiveThinking(t *testing.T) {
	yes := []string{"claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-opus-4-8", "claude-fable-5-1"}
	no := []string{"claude-haiku-4-5", "claude-opus-4-5", "claude-sonnet-4-5", "qwen2.5"}
	for _, m := range yes {
		if !SupportsAdaptiveThinking(m) {
			t.Errorf("%s should support adaptive thinking", m)
		}
	}
	for _, m := range no {
		if SupportsAdaptiveThinking(m) {
			t.Errorf("%s should not support adaptive thinking", m)
		}
	}
}
