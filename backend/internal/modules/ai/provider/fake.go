package provider

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
)

// Fake is a scripted provider for tests. Each call pops the next scripted
// response (or a func producing one); requests are recorded for assertions.
type Fake struct {
	mu        sync.Mutex
	Responses []Response
	// Fallback is returned when the script is exhausted (zero value = error).
	Fallback *Response
	Err      error
	Requests []Request
}

// Kind implements Provider.
func (f *Fake) Kind() string { return "fake" }

// Complete implements Provider.
func (f *Fake) Complete(ctx context.Context, req Request) (Response, error) {
	return f.Stream(ctx, req, nil)
}

// Stream implements Provider: replays text as one delta and announces tool uses.
func (f *Fake) Stream(ctx context.Context, req Request, onEvent func(StreamEvent)) (Response, error) {
	f.mu.Lock()
	f.Requests = append(f.Requests, cloneRequest(req))
	if f.Err != nil {
		err := f.Err
		f.mu.Unlock()
		return Response{}, err
	}
	var resp Response
	switch {
	case len(f.Responses) > 0:
		resp = f.Responses[0]
		f.Responses = f.Responses[1:]
	case f.Fallback != nil:
		resp = *f.Fallback
	default:
		f.mu.Unlock()
		return Response{}, errors.New("fake provider: script exhausted")
	}
	f.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Response{}, err
	}
	if resp.Message.Role == "" {
		resp.Message.Role = RoleAssistant
	}
	if resp.StopReason == "" {
		if len(resp.Message.ToolUses()) > 0 {
			resp.StopReason = StopToolUse
		} else {
			resp.StopReason = StopEndTurn
		}
	}
	if onEvent != nil {
		for _, b := range resp.Message.Content {
			switch b.Type {
			case BlockText:
				onEvent(StreamEvent{Type: EventTextDelta, Text: b.Text})
			case BlockToolUse:
				onEvent(StreamEvent{Type: EventToolUseStart, ID: b.ID, Name: b.Name})
			}
		}
	}
	return resp, nil
}

// RequestCount returns how many calls were made.
func (f *Fake) RequestCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.Requests)
}

// FakeToolCall builds a scripted assistant response calling one tool.
func FakeToolCall(id, name string, input any) Response {
	raw, _ := json.Marshal(input)
	return Response{
		Message: Message{Role: RoleAssistant, Content: []Block{
			{Type: BlockToolUse, ID: id, Name: name, Input: raw},
		}},
		StopReason: StopToolUse,
		Usage:      Usage{InputTokens: 100, OutputTokens: 20},
	}
}

// FakeText builds a scripted final text response.
func FakeText(text string) Response {
	return Response{
		Message:    Message{Role: RoleAssistant, Content: []Block{TextBlock(text)}},
		StopReason: StopEndTurn,
		Usage:      Usage{InputTokens: 120, OutputTokens: 30},
	}
}

func cloneRequest(r Request) Request {
	out := r
	out.Messages = append([]Message(nil), r.Messages...)
	out.Tools = append([]ToolDef(nil), r.Tools...)
	out.System = append([]SystemBlock(nil), r.System...)
	return out
}
