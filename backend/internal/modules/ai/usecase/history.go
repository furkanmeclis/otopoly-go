package usecase

import (
	"encoding/json"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/provider"
)

const (
	// keepFullTurns user turns keep their tool results verbatim; older tool
	// results are replaced by a placeholder. The boundary moves in steps of
	// keepFullTurns so the cached prefix only changes every few turns.
	keepFullTurns = 6
	// maxHistoryTurns caps replayed user turns (dropped in steps of keepFullTurns).
	maxHistoryTurns   = 40
	clearedToolResult = "[older tool result cleared to save context; call the tool again if needed]"
	notExecutedResult = "Not executed: the previous turn ended before this tool call ran."
)

// decodeRowMessages returns the API messages stored in a row.
func decodeRowMessages(row db.AiMessage) []provider.Message {
	var msgs []provider.Message
	if len(row.Content) == 0 || json.Unmarshal(row.Content, &msgs) != nil {
		return nil
	}
	return msgs
}

// historyFromRows rebuilds replayable API messages from stored rows and
// indexes every tool result by tool_use_id (full, untrimmed content).
func historyFromRows(rows []db.AiMessage, currentModel string) ([]provider.Message, map[string]string) {
	var msgs []provider.Message
	results := map[string]string{}
	for _, row := range rows {
		for _, m := range decodeRowMessages(row) {
			// Thinking blocks are bound to the model that produced them.
			if m.Role == provider.RoleAssistant && row.Model != currentModel {
				m.Content = stripThinking(m.Content)
			}
			for _, b := range m.Content {
				if b.Type == provider.BlockToolResult && !b.IsError {
					results[b.ToolUseID] = b.Content
				}
			}
			msgs = append(msgs, m)
		}
	}
	return msgs, results
}

func stripThinking(blocks []provider.Block) []provider.Block {
	out := blocks[:0:0]
	for _, b := range blocks {
		if b.Type == provider.BlockThinking || b.Type == provider.BlockRedactedThinking {
			continue
		}
		out = append(out, b)
	}
	return out
}

func hasUserText(m provider.Message) bool {
	if m.Role != provider.RoleUser {
		return false
	}
	for _, b := range m.Content {
		if b.Type == provider.BlockText && b.Text != "" {
			return true
		}
	}
	return false
}

// orderUserBlocks puts tool_result blocks first (the API requires them to lead
// the user turn that follows a tool_use).
func orderUserBlocks(blocks []provider.Block) []provider.Block {
	out := make([]provider.Block, 0, len(blocks))
	for _, b := range blocks {
		if b.Type == provider.BlockToolResult {
			out = append(out, b)
		}
	}
	for _, b := range blocks {
		if b.Type != provider.BlockToolResult {
			out = append(out, b)
		}
	}
	return out
}

// sanitizeHistory makes stored history valid for the API: drops empty and
// leading assistant messages, merges consecutive same-role messages, adds a
// synthetic error result for every tool_use that never got one (interrupted
// turn, unconfirmed action) and drops orphan tool_results.
func sanitizeHistory(in []provider.Message) []provider.Message {
	var merged []provider.Message
	for _, m := range in {
		content := make([]provider.Block, 0, len(m.Content))
		for _, b := range m.Content {
			if b.Type == provider.BlockText && b.Text == "" {
				continue
			}
			content = append(content, b)
		}
		if len(content) == 0 {
			continue
		}
		if len(merged) == 0 && m.Role != provider.RoleUser {
			continue
		}
		if n := len(merged); n > 0 && merged[n-1].Role == m.Role {
			merged[n-1].Content = append(merged[n-1].Content, content...)
			continue
		}
		merged = append(merged, provider.Message{Role: m.Role, Content: content})
	}

	out := make([]provider.Message, 0, len(merged))
	for i := 0; i < len(merged); i++ {
		m := merged[i]
		if m.Role == provider.RoleUser {
			// Keep only tool_results answering the immediately preceding assistant.
			allowed := map[string]bool{}
			if len(out) > 0 && out[len(out)-1].Role == provider.RoleAssistant {
				for _, tu := range out[len(out)-1].ToolUses() {
					allowed[tu.ID] = true
				}
			}
			seen := map[string]bool{}
			blocks := make([]provider.Block, 0, len(m.Content))
			for _, b := range m.Content {
				if b.Type == provider.BlockToolResult {
					if !allowed[b.ToolUseID] || seen[b.ToolUseID] {
						continue
					}
					seen[b.ToolUseID] = true
				}
				blocks = append(blocks, b)
			}
			// Synthesize results for unanswered tool_use blocks.
			if len(out) > 0 && out[len(out)-1].Role == provider.RoleAssistant {
				for _, tu := range out[len(out)-1].ToolUses() {
					if !seen[tu.ID] {
						blocks = append(blocks, provider.ToolResultBlock(tu.ID, notExecutedResult, true))
					}
				}
			}
			blocks = orderUserBlocks(blocks)
			if len(blocks) == 0 {
				continue
			}
			out = append(out, provider.Message{Role: provider.RoleUser, Content: blocks})
			continue
		}
		// Assistant: if the next message is not a user turn, answer its tool uses.
		out = append(out, m)
		if tus := m.ToolUses(); len(tus) > 0 && (i+1 >= len(merged) || merged[i+1].Role != provider.RoleUser) {
			var blocks []provider.Block
			for _, tu := range tus {
				blocks = append(blocks, provider.ToolResultBlock(tu.ID, notExecutedResult, true))
			}
			out = append(out, provider.Message{Role: provider.RoleUser, Content: blocks})
		}
	}
	// A trailing synthetic user message for a final dangling assistant would be
	// merged with the next input by the caller; fine as-is.
	return out
}

// trimHistory drops the oldest turns beyond maxHistoryTurns and clears tool
// result payloads of old turns. Both boundaries move in steps so the prompt
// cache prefix stays stable for several turns at a time.
func trimHistory(msgs []provider.Message) []provider.Message {
	turnStarts := func(ms []provider.Message) []int {
		var idx []int
		for i, m := range ms {
			if hasUserText(m) {
				idx = append(idx, i)
			}
		}
		return idx
	}
	starts := turnStarts(msgs)
	if n := len(starts); n > maxHistoryTurns {
		drop := ((n - maxHistoryTurns + keepFullTurns - 1) / keepFullTurns) * keepFullTurns
		if drop < n {
			msgs = msgs[starts[drop]:]
			starts = turnStarts(msgs)
		}
	}
	if n := len(starts); n > keepFullTurns {
		boundaryTurn := ((n - keepFullTurns) / keepFullTurns) * keepFullTurns
		if boundaryTurn > 0 {
			limit := starts[boundaryTurn]
			out := make([]provider.Message, len(msgs))
			for i, m := range msgs {
				if i >= limit {
					out[i] = m
					continue
				}
				blocks := make([]provider.Block, len(m.Content))
				for j, b := range m.Content {
					if b.Type == provider.BlockToolResult && !b.IsError && len(b.Content) > len(clearedToolResult) {
						b.Content = clearedToolResult
					}
					blocks[j] = b
				}
				out[i] = provider.Message{Role: m.Role, Content: blocks}
			}
			msgs = out
		}
	}
	return msgs
}
