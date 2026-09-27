package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
)

// OpenAICompatible talks to any /v1/chat/completions server (Ollama, vLLM,
// LM Studio, llama.cpp server, ...). BaseURL is the API root, e.g.
// http://ollama:11434/v1.
type OpenAICompatible struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// NewOpenAICompatible creates the provider.
func NewOpenAICompatible(cfg Config) *OpenAICompatible {
	return &OpenAICompatible{
		baseURL: strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		apiKey:  strings.TrimSpace(cfg.APIKey),
		http:    httpClient(cfg.HTTPClient),
	}
}

// Kind implements Provider.
func (o *OpenAICompatible) Kind() string { return KindOpenAICompatible }

type oaiMessage struct {
	Role       string        `json:"role"`
	Content    *string       `json:"content"`
	ToolCalls  []oaiToolCall `json:"tool_calls,omitempty"`
	ToolCallID string        `json:"tool_call_id,omitempty"`
}

type oaiToolCall struct {
	Index        *int            `json:"index,omitempty"`
	ID           string          `json:"id,omitempty"`
	Type         string          `json:"type,omitempty"`
	ExtraContent json.RawMessage `json:"extra_content,omitempty"`
	Function     struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type oaiTool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string         `json:"name"`
		Description string         `json:"description,omitempty"`
		Parameters  map[string]any `json:"parameters"`
	} `json:"function"`
}

type oaiRequest struct {
	Model         string          `json:"model"`
	Messages      []oaiMessage    `json:"messages"`
	Tools         []oaiTool       `json:"tools,omitempty"`
	ToolChoice    string          `json:"tool_choice,omitempty"`
	MaxTokens     int             `json:"max_tokens,omitempty"`
	Stream        bool            `json:"stream"`
	StreamOptions *map[string]any `json:"stream_options,omitempty"`
}

type oaiUsage struct {
	PromptTokens        int64 `json:"prompt_tokens"`
	CompletionTokens    int64 `json:"completion_tokens"`
	PromptTokensDetails *struct {
		CachedTokens int64 `json:"cached_tokens"`
	} `json:"prompt_tokens_details,omitempty"`
}

type oaiChoice struct {
	Index        int        `json:"index"`
	Message      oaiMessage `json:"message"`
	Delta        oaiMessage `json:"delta"`
	FinishReason *string    `json:"finish_reason"`
}

type oaiResponse struct {
	Model   string      `json:"model"`
	Choices []oaiChoice `json:"choices"`
	Usage   *oaiUsage   `json:"usage"`
	Error   *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func strPtr(s string) *string { return &s }

func (o *OpenAICompatible) buildRequest(req Request, stream bool) oaiRequest {
	out := oaiRequest{Model: req.Model, MaxTokens: req.MaxTokens, Stream: stream}
	var sys []string
	for _, s := range req.System {
		if strings.TrimSpace(s.Text) != "" {
			sys = append(sys, s.Text)
		}
	}
	if len(sys) > 0 {
		out.Messages = append(out.Messages, oaiMessage{Role: "system", Content: strPtr(strings.Join(sys, "\n\n"))})
	}
	for _, m := range req.Messages {
		switch m.Role {
		case RoleAssistant:
			msg := oaiMessage{Role: "assistant"}
			if text := m.Text(); text != "" {
				msg.Content = strPtr(text)
			}
			for _, tu := range m.ToolUses() {
				tc := oaiToolCall{ID: tu.ID, Type: "function"}
				tc.Function.Name = tu.Name
				args := string(tu.Input)
				if args == "" {
					args = "{}"
				}
				tc.Function.Arguments = args
				if len(tu.ProviderMeta) > 0 {
					tc.ExtraContent = tu.ProviderMeta
				}
				msg.ToolCalls = append(msg.ToolCalls, tc)
			}
			if msg.Content == nil && len(msg.ToolCalls) == 0 {
				continue
			}
			if msg.Content == nil {
				msg.Content = strPtr("")
			}
			out.Messages = append(out.Messages, msg)
		case RoleUser:
			var texts []string
			for _, b := range m.Content {
				switch b.Type {
				case BlockToolResult:
					content := b.Content
					if b.IsError {
						content = "ERROR: " + content
					}
					out.Messages = append(out.Messages, oaiMessage{Role: "tool", ToolCallID: b.ToolUseID, Content: strPtr(content)})
				case BlockText:
					texts = append(texts, b.Text)
				}
			}
			if len(texts) > 0 {
				out.Messages = append(out.Messages, oaiMessage{Role: "user", Content: strPtr(strings.Join(texts, "\n\n"))})
			}
		}
	}
	for _, t := range req.Tools {
		tool := oaiTool{Type: "function"}
		tool.Function.Name = t.Name
		tool.Function.Description = t.Description
		tool.Function.Parameters = t.InputSchema
		out.Tools = append(out.Tools, tool)
	}
	if req.ToolChoiceNone && len(out.Tools) > 0 {
		out.ToolChoice = "none"
	}
	if stream {
		opts := map[string]any{"include_usage": true}
		out.StreamOptions = &opts
	}
	return out
}

func (o *OpenAICompatible) do(ctx context.Context, body oaiRequest) (*http.Response, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if body.Stream {
		httpReq.Header.Set("Accept", "text/event-stream")
	}
	if o.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+o.apiKey)
	}
	resp, err := o.http.Do(httpReq)
	if err != nil {
		return nil, &Error{Message: err.Error(), Err: err}
	}
	if resp.StatusCode >= 400 {
		defer func() { _ = resp.Body.Close() }()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		msg := strings.TrimSpace(string(raw))
		var parsed oaiResponse
		if json.Unmarshal(raw, &parsed) == nil && parsed.Error != nil && parsed.Error.Message != "" {
			msg = parsed.Error.Message
		}
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return nil, &Error{StatusCode: resp.StatusCode, Message: msg}
	}
	return resp, nil
}

// Complete implements Provider.
func (o *OpenAICompatible) Complete(ctx context.Context, req Request) (Response, error) {
	resp, err := o.do(ctx, o.buildRequest(req, false))
	if err != nil {
		return Response{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	var parsed oaiResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return Response{}, fmt.Errorf("openai-compatible: decode: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return Response{}, &Error{Message: "empty response"}
	}
	ch := parsed.Choices[0]
	msg := Message{Role: RoleAssistant}
	if ch.Message.Content != nil && *ch.Message.Content != "" {
		msg.Content = append(msg.Content, TextBlock(*ch.Message.Content))
	}
	for _, tc := range ch.Message.ToolCalls {
		msg.Content = append(msg.Content, toolUseFromCall(tc.ID, tc.Function.Name, tc.Function.Arguments, tc.ExtraContent))
	}
	finish := ""
	if ch.FinishReason != nil {
		finish = *ch.FinishReason
	}
	return Response{
		Message:    msg,
		StopReason: normalizeOAIFinish(finish, len(ch.Message.ToolCalls) > 0),
		Usage:      usageFromOAI(parsed.Usage),
		Model:      parsed.Model,
	}, nil
}

type partialCall struct {
	id           string
	name         string
	providerMeta json.RawMessage
	args         strings.Builder
}

// Stream implements Provider.
func (o *OpenAICompatible) Stream(ctx context.Context, req Request, onEvent func(StreamEvent)) (Response, error) {
	resp, err := o.do(ctx, o.buildRequest(req, true))
	if err != nil {
		return Response{}, err
	}
	defer func() { _ = resp.Body.Close() }()

	var (
		text   strings.Builder
		calls  = map[int]*partialCall{}
		finish string
		usage  Usage
		model  string
	)
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var chunk oaiResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.Error != nil && chunk.Error.Message != "" {
			return Response{}, &Error{Message: chunk.Error.Message}
		}
		if chunk.Model != "" {
			model = chunk.Model
		}
		if chunk.Usage != nil {
			usage = usageFromOAI(chunk.Usage)
		}
		for _, ch := range chunk.Choices {
			if ch.Delta.Content != nil && *ch.Delta.Content != "" {
				text.WriteString(*ch.Delta.Content)
				if onEvent != nil {
					onEvent(StreamEvent{Type: EventTextDelta, Text: *ch.Delta.Content})
				}
			}
			for i, tc := range ch.Delta.ToolCalls {
				idx := i
				if tc.Index != nil {
					idx = *tc.Index
				}
				pc := calls[idx]
				if pc == nil {
					pc = &partialCall{}
					calls[idx] = pc
				}
				if tc.ID != "" {
					pc.id = tc.ID
				}
				if tc.Function.Name != "" && pc.name == "" {
					pc.name = tc.Function.Name
					if pc.id == "" {
						pc.id = fmt.Sprintf("call_%d", idx)
					}
					if onEvent != nil {
						onEvent(StreamEvent{Type: EventToolUseStart, ID: pc.id, Name: pc.name})
					}
				}
				if len(tc.ExtraContent) > 0 {
					pc.providerMeta = tc.ExtraContent
				}
				pc.args.WriteString(tc.Function.Arguments)
			}
			if ch.FinishReason != nil && *ch.FinishReason != "" {
				finish = *ch.FinishReason
			}
		}
	}
	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return Response{}, ctx.Err()
		}
		return Response{}, &Error{Message: err.Error(), Err: err}
	}

	msg := Message{Role: RoleAssistant}
	if text.Len() > 0 {
		msg.Content = append(msg.Content, TextBlock(text.String()))
	}
	idxs := make([]int, 0, len(calls))
	for idx := range calls {
		idxs = append(idxs, idx)
	}
	sort.Ints(idxs)
	for _, idx := range idxs {
		pc := calls[idx]
		if pc.name == "" {
			continue
		}
		msg.Content = append(msg.Content, toolUseFromCall(pc.id, pc.name, pc.args.String(), pc.providerMeta))
	}
	return Response{
		Message:    msg,
		StopReason: normalizeOAIFinish(finish, len(msg.ToolUses()) > 0),
		Usage:      usage,
		Model:      model,
	}, nil
}

func toolUseFromCall(id, name, args string, providerMeta json.RawMessage) Block {
	args = strings.TrimSpace(args)
	if args == "" {
		args = "{}"
	}
	input := json.RawMessage(args)
	if !json.Valid(input) {
		quoted, _ := json.Marshal(args)
		input = quoted
	}
	return Block{Type: BlockToolUse, ID: id, Name: name, Input: input, ProviderMeta: providerMeta}
}

func normalizeOAIFinish(reason string, hasTools bool) string {
	switch reason {
	case "tool_calls", "function_call":
		return StopToolUse
	case "length":
		return StopMaxTokens
	case "content_filter":
		return StopRefusal
	}
	if hasTools {
		return StopToolUse
	}
	return StopEndTurn
}

func usageFromOAI(u *oaiUsage) Usage {
	if u == nil {
		return Usage{}
	}
	out := Usage{InputTokens: u.PromptTokens, OutputTokens: u.CompletionTokens}
	if u.PromptTokensDetails != nil && u.PromptTokensDetails.CachedTokens > 0 {
		out.CacheReadTokens = u.PromptTokensDetails.CachedTokens
		out.InputTokens -= u.PromptTokensDetails.CachedTokens
		if out.InputTokens < 0 {
			out.InputTokens = 0
		}
	}
	return out
}
