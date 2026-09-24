// Package provider abstracts LLM backends (Anthropic, OpenAI-compatible) behind a
// small provider-neutral message model. Messages use the Anthropic block shape
// (text / tool_use / tool_result / thinking) because it is the richest; other
// providers translate to and from it.
package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// Provider kinds stored in ai_settings.provider.
const (
	KindAnthropic        = "anthropic"
	KindOpenAICompatible = "openai_compatible"
)

// Roles.
const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
)

// Block types.
const (
	BlockText             = "text"
	BlockToolUse          = "tool_use"
	BlockToolResult       = "tool_result"
	BlockThinking         = "thinking"
	BlockRedactedThinking = "redacted_thinking"
)

// Normalized stop reasons.
const (
	StopEndTurn   = "end_turn"
	StopToolUse   = "tool_use"
	StopMaxTokens = "max_tokens"
	StopRefusal   = "refusal"
	StopOther     = "other"
)

// ErrNotConfigured is returned when the provider lacks credentials / base URL.
var ErrNotConfigured = errors.New("ai provider is not configured")

// Block is one content block of a message.
type Block struct {
	Type string `json:"type"`
	// text
	Text string `json:"text,omitempty"`
	// tool_use
	ID    string          `json:"id,omitempty"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
	// tool_result
	ToolUseID string `json:"tool_use_id,omitempty"`
	Content   string `json:"content,omitempty"`
	IsError   bool   `json:"is_error,omitempty"`
	// thinking / redacted_thinking (Anthropic only; must be replayed verbatim)
	Thinking  string `json:"thinking,omitempty"`
	Signature string `json:"signature,omitempty"`
	Data      string `json:"data,omitempty"`
}

// Message is a single API turn.
type Message struct {
	Role    string  `json:"role"`
	Content []Block `json:"content"`
}

// TextBlock builds a text block.
func TextBlock(text string) Block { return Block{Type: BlockText, Text: text} }

// ToolResultBlock builds a tool_result block.
func ToolResultBlock(toolUseID, content string, isError bool) Block {
	return Block{Type: BlockToolResult, ToolUseID: toolUseID, Content: content, IsError: isError}
}

// ToolUses returns the tool_use blocks of a message.
func (m Message) ToolUses() []Block {
	var out []Block
	for _, b := range m.Content {
		if b.Type == BlockToolUse {
			out = append(out, b)
		}
	}
	return out
}

// Text concatenates the text blocks of a message.
func (m Message) Text() string {
	var sb strings.Builder
	for _, b := range m.Content {
		if b.Type == BlockText {
			sb.WriteString(b.Text)
		}
	}
	return sb.String()
}

// SystemBlock is one system prompt segment. Cache marks the end of the stable,
// cacheable prefix (tools + system up to and including this block).
type SystemBlock struct {
	Text  string
	Cache bool
}

// ToolDef is a function tool offered to the model.
type ToolDef struct {
	Name        string
	Description string
	// InputSchema is a JSON Schema object: {"type":"object","properties":{...},"required":[...]}.
	InputSchema map[string]any
}

// Request is a provider-neutral model call.
type Request struct {
	Model     string
	System    []SystemBlock
	Messages  []Message
	Tools     []ToolDef
	MaxTokens int
	// Effort is low|medium|high|xhigh|max (Anthropic output_config.effort). Empty = omit.
	Effort string
	// Thinking enables adaptive thinking when the model supports it.
	Thinking bool
	// ToolChoiceNone forbids tool calls for this request (tools stay defined so
	// history containing tool_use blocks remains valid).
	ToolChoiceNone bool
	// CacheMessages places a cache breakpoint on the last message block.
	CacheMessages bool
}

// Usage is token accounting for one call.
type Usage struct {
	InputTokens      int64 `json:"input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
	CacheReadTokens  int64 `json:"cache_read_tokens"`
	CacheWriteTokens int64 `json:"cache_write_tokens"`
}

// Add accumulates another usage record.
func (u *Usage) Add(o Usage) {
	u.InputTokens += o.InputTokens
	u.OutputTokens += o.OutputTokens
	u.CacheReadTokens += o.CacheReadTokens
	u.CacheWriteTokens += o.CacheWriteTokens
}

// QuotaTokens is what counts against the monthly quota.
func (u Usage) QuotaTokens() int64 {
	return u.InputTokens + u.OutputTokens + u.CacheWriteTokens
}

// Response is a completed model call.
type Response struct {
	Message    Message
	StopReason string
	Usage      Usage
	Model      string
}

// StreamEventType enumerates incremental events.
type StreamEventType int

const (
	// EventTextDelta carries a text fragment.
	EventTextDelta StreamEventType = iota + 1
	// EventToolUseStart announces a tool call (ID + Name) before its input streams.
	EventToolUseStart
)

// StreamEvent is an incremental provider event.
type StreamEvent struct {
	Type StreamEventType
	Text string
	ID   string
	Name string
}

// Provider is an LLM backend.
type Provider interface {
	Kind() string
	// Stream runs a streaming call, invoking onEvent for incremental output, and
	// returns the assembled message.
	Stream(ctx context.Context, req Request, onEvent func(StreamEvent)) (Response, error)
	// Complete runs a non-streaming call.
	Complete(ctx context.Context, req Request) (Response, error)
}

// Config builds a provider.
type Config struct {
	Kind       string
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
}

// New creates a provider from config.
func New(cfg Config) (Provider, error) {
	switch cfg.Kind {
	case KindAnthropic, "":
		if strings.TrimSpace(cfg.APIKey) == "" {
			return nil, ErrNotConfigured
		}
		return NewAnthropic(cfg), nil
	case KindOpenAICompatible:
		if strings.TrimSpace(cfg.BaseURL) == "" {
			return nil, ErrNotConfigured
		}
		return NewOpenAICompatible(cfg), nil
	default:
		return nil, errors.New("unknown ai provider: " + cfg.Kind)
	}
}

func httpClient(c *http.Client) *http.Client {
	if c != nil {
		return c
	}
	// No overall timeout: streams are long-lived and bounded by the request context.
	return &http.Client{Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		ResponseHeaderTimeout: 90 * time.Second,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
	}}
}
