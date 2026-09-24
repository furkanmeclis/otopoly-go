package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// Anthropic implements Provider with the official Go SDK.
type Anthropic struct {
	client anthropic.Client
}

// NewAnthropic creates an Anthropic provider.
func NewAnthropic(cfg Config) *Anthropic {
	opts := []option.RequestOption{
		option.WithAPIKey(strings.TrimSpace(cfg.APIKey)),
		option.WithHTTPClient(httpClient(cfg.HTTPClient)),
		option.WithMaxRetries(2),
	}
	if base := strings.TrimSpace(cfg.BaseURL); base != "" {
		opts = append(opts, option.WithBaseURL(base))
	}
	return &Anthropic{client: anthropic.NewClient(opts...)}
}

// Kind implements Provider.
func (a *Anthropic) Kind() string { return KindAnthropic }

// Complete implements Provider.
func (a *Anthropic) Complete(ctx context.Context, req Request) (Response, error) {
	params, err := a.buildParams(req)
	if err != nil {
		return Response{}, err
	}
	msg, err := a.client.Messages.New(ctx, params)
	if err != nil {
		return Response{}, wrapAnthropicErr(err)
	}
	return fromAnthropicMessage(msg, nil), nil
}

// Stream implements Provider.
func (a *Anthropic) Stream(ctx context.Context, req Request, onEvent func(StreamEvent)) (Response, error) {
	params, err := a.buildParams(req)
	if err != nil {
		return Response{}, err
	}
	stream := a.client.Messages.NewStreaming(ctx, params)
	defer func() { _ = stream.Close() }()

	msg := anthropic.Message{}
	// Raw tool input fragments per block index: with eager_input_streaming the
	// server no longer validates JSON, so we keep the raw text to detect
	// malformed input instead of trusting the accumulator's fallback to {}.
	rawInputs := map[int64]*strings.Builder{}
	for stream.Next() {
		ev := stream.Current()
		if err := msg.Accumulate(ev); err != nil {
			return Response{}, fmt.Errorf("anthropic: accumulate: %w", err)
		}
		switch ev.Type {
		case "content_block_start":
			if ev.ContentBlock.Type == "tool_use" && onEvent != nil {
				onEvent(StreamEvent{Type: EventToolUseStart, ID: ev.ContentBlock.ID, Name: ev.ContentBlock.Name})
			}
		case "content_block_delta":
			switch ev.Delta.Type {
			case "text_delta":
				if onEvent != nil && ev.Delta.Text != "" {
					onEvent(StreamEvent{Type: EventTextDelta, Text: ev.Delta.Text})
				}
			case "input_json_delta":
				sb := rawInputs[ev.Index]
				if sb == nil {
					sb = &strings.Builder{}
					rawInputs[ev.Index] = sb
				}
				sb.WriteString(ev.Delta.PartialJSON)
			}
		}
	}
	if err := stream.Err(); err != nil {
		return Response{}, wrapAnthropicErr(err)
	}
	return fromAnthropicMessage(&msg, rawInputs), nil
}

func (a *Anthropic) buildParams(req Request) (anthropic.MessageNewParams, error) {
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(req.Model),
		MaxTokens: int64(maxTokens),
	}
	for _, sb := range req.System {
		if strings.TrimSpace(sb.Text) == "" {
			continue
		}
		block := anthropic.TextBlockParam{Text: sb.Text}
		if sb.Cache {
			block.CacheControl = anthropic.NewCacheControlEphemeralParam()
		}
		params.System = append(params.System, block)
	}
	for _, t := range req.Tools {
		props, _ := t.InputSchema["properties"].(map[string]any)
		if props == nil {
			props = map[string]any{}
		}
		var required []string
		switch r := t.InputSchema["required"].(type) {
		case []string:
			required = r
		case []any:
			for _, v := range r {
				if s, ok := v.(string); ok {
					required = append(required, s)
				}
			}
		}
		extras := map[string]any{}
		if ap, ok := t.InputSchema["additionalProperties"]; ok {
			extras["additionalProperties"] = ap
		}
		tool := anthropic.ToolParam{
			Name:        t.Name,
			Description: anthropic.String(t.Description),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties:  props,
				Required:    required,
				ExtraFields: extras,
			},
			// Streaming request with client tools: stream tool input eagerly; we
			// validate every input against its schema before running the tool.
			EagerInputStreaming: anthropic.Bool(true),
		}
		params.Tools = append(params.Tools, anthropic.ToolUnionParam{OfTool: &tool})
	}
	if req.ToolChoiceNone && len(params.Tools) > 0 {
		params.ToolChoice = anthropic.ToolChoiceUnionParam{OfNone: &anthropic.ToolChoiceNoneParam{}}
	}
	if req.Thinking && SupportsAdaptiveThinking(req.Model) {
		adaptive := anthropic.ThinkingConfigAdaptiveParam{}
		params.Thinking = anthropic.ThinkingConfigParamUnion{OfAdaptive: &adaptive}
	}
	if req.Effort != "" && SupportsEffort(req.Model) {
		params.OutputConfig = anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffort(req.Effort)}
	}
	if req.CacheMessages {
		// Top-level cache_control auto-places the breakpoint on the last
		// cacheable block, so the whole prior conversation is read from cache
		// on the next turn.
		params.CacheControl = anthropic.NewCacheControlEphemeralParam()
	}
	msgs, err := toAnthropicMessages(req.Messages)
	if err != nil {
		return params, err
	}
	params.Messages = msgs
	return params, nil
}

func toAnthropicMessages(in []Message) ([]anthropic.MessageParam, error) {
	out := make([]anthropic.MessageParam, 0, len(in))
	for _, m := range in {
		blocks := make([]anthropic.ContentBlockParamUnion, 0, len(m.Content))
		for _, b := range m.Content {
			switch b.Type {
			case BlockText:
				if b.Text == "" {
					continue
				}
				blocks = append(blocks, anthropic.NewTextBlock(b.Text))
			case BlockToolUse:
				input := b.Input
				if len(input) == 0 || !json.Valid(input) {
					input = json.RawMessage(`{}`)
				}
				blocks = append(blocks, anthropic.NewToolUseBlock(b.ID, input, b.Name))
			case BlockToolResult:
				blocks = append(blocks, anthropic.NewToolResultBlock(b.ToolUseID, b.Content, b.IsError))
			case BlockThinking:
				blocks = append(blocks, anthropic.NewThinkingBlock(b.Signature, b.Thinking))
			case BlockRedactedThinking:
				blocks = append(blocks, anthropic.NewRedactedThinkingBlock(b.Data))
			}
		}
		if len(blocks) == 0 {
			continue
		}
		switch m.Role {
		case RoleUser:
			out = append(out, anthropic.NewUserMessage(blocks...))
		case RoleAssistant:
			out = append(out, anthropic.NewAssistantMessage(blocks...))
		default:
			return nil, fmt.Errorf("anthropic: unsupported role %q", m.Role)
		}
	}
	return out, nil
}

func fromAnthropicMessage(msg *anthropic.Message, rawInputs map[int64]*strings.Builder) Response {
	if msg == nil {
		return Response{}
	}
	out := Message{Role: RoleAssistant}
	for i, cb := range msg.Content {
		switch cb.Type {
		case "text":
			out.Content = append(out.Content, TextBlock(cb.Text))
		case "tool_use":
			input := json.RawMessage(cb.Input)
			if sb, ok := rawInputs[int64(i)]; ok {
				raw := strings.TrimSpace(sb.String())
				if raw == "" {
					raw = "{}"
				}
				// Keep malformed input as-is (as a JSON string) so validation
				// reports it back to the model instead of running with {}.
				if json.Valid([]byte(raw)) {
					input = json.RawMessage(raw)
				} else {
					quoted, _ := json.Marshal(raw)
					input = quoted
				}
			}
			if len(input) == 0 {
				input = json.RawMessage(`{}`)
			}
			out.Content = append(out.Content, Block{Type: BlockToolUse, ID: cb.ID, Name: cb.Name, Input: input})
		case "thinking":
			out.Content = append(out.Content, Block{Type: BlockThinking, Thinking: cb.Thinking, Signature: cb.Signature})
		case "redacted_thinking":
			out.Content = append(out.Content, Block{Type: BlockRedactedThinking, Data: cb.Data})
		}
	}
	stop := StopOther
	switch msg.StopReason {
	case anthropic.StopReasonEndTurn, anthropic.StopReasonStopSequence:
		stop = StopEndTurn
	case anthropic.StopReasonToolUse:
		stop = StopToolUse
	case anthropic.StopReasonMaxTokens:
		stop = StopMaxTokens
	case anthropic.StopReasonRefusal:
		stop = StopRefusal
	}
	return Response{
		Message:    out,
		StopReason: stop,
		Model:      string(msg.Model),
		Usage: Usage{
			InputTokens:      msg.Usage.InputTokens,
			OutputTokens:     msg.Usage.OutputTokens,
			CacheReadTokens:  msg.Usage.CacheReadInputTokens,
			CacheWriteTokens: msg.Usage.CacheCreationInputTokens,
		},
	}
}

// Error is a provider error safe to show to admins (no secrets).
type Error struct {
	StatusCode int
	Message    string
	Err        error
}

func (e *Error) Error() string {
	if e.StatusCode > 0 {
		return fmt.Sprintf("provider error (%d): %s", e.StatusCode, e.Message)
	}
	return "provider error: " + e.Message
}

func (e *Error) Unwrap() error { return e.Err }

func wrapAnthropicErr(err error) error {
	if err == nil {
		return nil
	}
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		msg := strings.TrimSpace(apiErr.RawJSON())
		var body struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(msg), &body) == nil && body.Error.Message != "" {
			msg = body.Error.Message
		}
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return &Error{StatusCode: apiErr.StatusCode, Message: msg, Err: err}
	}
	return err
}

// SupportsAdaptiveThinking reports whether the Anthropic model accepts
// thinking: {type: "adaptive"} (Claude 4.6+ generation).
func SupportsAdaptiveThinking(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	if !strings.HasPrefix(m, "claude-") {
		return false
	}
	for _, legacy := range []string{"claude-3", "haiku", "-4-0", "-4-1", "-4-5", "-4-20250514"} {
		if strings.Contains(m, legacy) {
			return false
		}
	}
	return true
}

// SupportsEffort reports whether the model accepts output_config.effort.
func SupportsEffort(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	if strings.Contains(m, "opus-4-5") {
		return true
	}
	return SupportsAdaptiveThinking(m)
}
