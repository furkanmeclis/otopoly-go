package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/provider"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// MaxMessageLength caps a user message (characters).
const MaxMessageLength = 8000

// maxToolResultChars caps what a single tool result feeds back to the model.
const maxToolResultChars = 16000

// SSE event names.
const (
	EventMessageStart = "message_start"
	EventTextDelta    = "text_delta"
	EventToolStart    = "tool_start"
	EventToolResult   = "tool_result"
	EventChart        = "chart"
	EventTitle        = "title"
	EventMessageDone  = "message_done"
	EventError        = "error"
	// EventConfirm carries a confirm card block (write action proposed).
	EventConfirm = "confirm"
	// EventPlan carries the plan checklist block (replaces the previous one).
	EventPlan = "plan"
	// EventAction reports a confirmed/failed action (confirm endpoint).
	EventAction = "action"
)

// Emitter delivers a server-sent event to the client.
type Emitter func(event string, data any)

// ------------------------------------------------------------------ confirmation gate

// PendingCall is a write-tool call awaiting user confirmation.
type PendingCall struct {
	ConversationUUID uuid.UUID
	ConversationID   int64
	ToolUseID        string
	Tool             tools.Tool
	Input            json.RawMessage
	Env              tools.Env
}

// ProposeResult is what the gate returns for a pending call.
type ProposeResult struct {
	// Result is fed back to the model as the tool_result (e.g. "Waiting for the
	// user to confirm; do not repeat the call"). Nil leaves the tool_use
	// unanswered: the turn ends and the confirm endpoint appends the real
	// result later (history sanitizing answers it if the user moves on).
	Result *tools.Result
	// UI is streamed and stored (e.g. a "confirm" card block).
	UI *UIBlock
	// Pause ends the agent loop after this iteration.
	Pause bool
}

// ConfirmationGate handles tools whose Spec.RequiresConfirmation is set.
type ConfirmationGate interface {
	Propose(ctx context.Context, call PendingCall) (ProposeResult, error)
}

type disabledConfirmationGate struct{}

func (disabledConfirmationGate) Propose(context.Context, PendingCall) (ProposeResult, error) {
	r := tools.ErrorResult("Actions that change data are not available yet. Tell the user to make this change in the app.")
	return ProposeResult{Result: &r}, nil
}

// ------------------------------------------------------------------ turn

// Turn is a validated, ready-to-run user message.
type Turn struct {
	conv      db.AiConversation
	settings  db.AiSetting
	prov      provider.Provider
	principal authctx.Principal
	scope     orgctx.Scope
	text      string
	locale    string
}

// ConversationUUID returns the conversation id.
func (t *Turn) ConversationUUID() uuid.UUID { return t.conv.Uuid }

// PrepareMessage validates a message and checks availability + quota before
// the SSE stream starts, so failures map to regular HTTP errors.
func (s *Service) PrepareMessage(ctx context.Context, convUUID uuid.UUID, in SendInput) (*Turn, error) {
	p, scope, err := principalScope(ctx)
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(in.Content)
	if text == "" {
		return nil, invalid("content is required")
	}
	if len([]rune(text)) > MaxMessageLength {
		return nil, invalid("content is too long (max %d characters)", MaxMessageLength)
	}
	conv, err := s.loadConversation(ctx, convUUID)
	if err != nil {
		return nil, err
	}
	if conv.MessageCount >= MaxMessagesPerConversation {
		return nil, fmt.Errorf("%w: this conversation is too long; start a new one", ErrConversationLimit)
	}
	settings, err := s.store.GetAISettings(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.availability(ctx, settings, scope.InternalID); err != nil {
		return nil, err
	}
	prov, err := s.providerFor(settings)
	if err != nil {
		return nil, err
	}
	locale := strings.ToLower(strings.TrimSpace(in.Locale))
	if locale != "en" {
		locale = "tr"
	}
	return &Turn{conv: conv, settings: settings, prov: prov, principal: p, scope: scope, text: text, locale: locale}, nil
}

type turnState struct {
	ui    []UIBlock
	emit  Emitter
	usage provider.Usage
	// proposed is set once a write action was proposed in this turn (one per turn).
	proposed bool
}

// upsertPlan replaces the turn's plan checklist block (or appends it).
func (ts *turnState) upsertPlan(plan *tools.Plan) UIBlock {
	raw, _ := json.Marshal(plan)
	block := UIBlock{Type: UITodoList, ID: "plan", Data: raw}
	for i := range ts.ui {
		if ts.ui[i].Type == UITodoList {
			ts.ui[i] = block
			return block
		}
	}
	ts.ui = append(ts.ui, block)
	return block
}

func (ts *turnState) appendText(text string) {
	if n := len(ts.ui); n > 0 && ts.ui[n-1].Type == UIText {
		ts.ui[n-1].Text += text
		return
	}
	ts.ui = append(ts.ui, UIBlock{Type: UIText, Text: text})
}

func (ts *turnState) toolBlock(id string) *UIBlock {
	for i := range ts.ui {
		if ts.ui[i].Type == UITool && ts.ui[i].ID == id {
			return &ts.ui[i]
		}
	}
	return nil
}

func (ts *turnState) fail(code, message string) {
	ts.ui = append(ts.ui, UIBlock{Type: UIError, Code: code, Message: message})
	ts.emit(EventError, map[string]any{"code": code, "message": message})
}

// RunTurn persists the user message, runs the agent loop streaming events
// through emit, persists the assistant turn and (for new conversations)
// generates a title. It returns only persistence errors; model/tool failures
// are reported to the client as error events.
func (s *Service) RunTurn(ctx context.Context, t *Turn, emit Emitter) error {
	if emit == nil {
		emit = func(string, any) {}
	}
	convID := t.conv.ID
	persistCtx := context.WithoutCancel(ctx)

	// A new message resolves any unanswered confirm cards as "not executed".
	s.expireActions(persistCtx, t.conv, true)
	s.recoverStaleActions(persistCtx, &convID)

	rows, err := s.store.ListAIMessages(ctx, convID)
	if err != nil {
		return err
	}
	history, results := historyFromRows(rows, t.settings.Model)

	now := s.now()
	userMsg := provider.Message{Role: provider.RoleUser, Content: []provider.Block{
		turnContext(now, s.loc), provider.TextBlock(t.text),
	}}
	userRow, err := s.insertMessage(persistCtx, t, provider.RoleUser, "complete", []provider.Message{userMsg},
		[]UIBlock{{Type: UIText, Text: t.text}}, "", provider.Usage{})
	if err != nil {
		return err
	}
	if err := s.store.TouchAIConversation(persistCtx, db.TouchAIConversationParams{ID: convID, Added: 1}); err != nil {
		s.log.Warn("ai_conversation_touch_failed", "error", err)
	}
	emit(EventMessageStart, map[string]any{
		"conversation_uuid": t.conv.Uuid, "user_message_uuid": userRow.Uuid,
	})
	return s.runAgent(ctx, t, emit, history, results, []provider.Message{userMsg})
}

// runAgent runs the tool loop after history + lead (the new user message, or
// nothing when resuming after a confirmed action), streams events, persists
// the assistant turn and titles new conversations.
func (s *Service) runAgent(ctx context.Context, t *Turn, emit Emitter, history []provider.Message, results map[string]string, lead []provider.Message) error {
	settings := t.settings
	orgID, userID, convID := t.scope.InternalID, t.principal.UserInternal, t.conv.ID
	persistCtx := context.WithoutCancel(ctx)
	now := s.now()

	gate := s.gate(settings)
	available := s.registry.Available(t.principal, t.scope, gate)
	byName := map[string]tools.Tool{}
	defs := make([]provider.ToolDef, 0, len(available))
	canWrite := false
	for _, tool := range available {
		spec := tool.Spec()
		byName[spec.Name] = tool
		defs = append(defs, provider.ToolDef{Name: spec.Name, Description: spec.Description, InputSchema: spec.InputSchema})
		if spec.RequiresConfirmation {
			canWrite = true
		}
	}

	userName := t.principal.Email
	if u, err := s.store.GetAIUserDisplay(ctx, userID); err == nil {
		if full := strings.TrimSpace(u.Name + " " + u.Surname); full != "" {
			userName = full
		}
	}
	system := []provider.SystemBlock{
		{Text: systemPrompt(settings.ExtraInstructions, canWrite), Cache: true},
		{Text: sessionPrompt(t.scope.Name, userName, t.scope.MemberRole, t.locale)},
	}

	env := tools.Env{
		Principal: t.principal, Scope: t.scope, Now: now, Location: s.loc,
		LookupResult: func(id string) (string, bool) { v, ok := results[id]; return v, ok },
	}

	ts := &turnState{emit: emit}
	var turnMsgs []provider.Message
	status := "complete"
	stopReason := ""
	model := settings.Model
	limit := s.maxIterations

loop:
	for i := 0; i < limit; i++ {
		if i > 0 {
			if q, err := s.quotaFor(ctx, settings, orgID, s.overrideQuota(ctx, orgID)); err == nil && q.exceeded() {
				ts.fail("quota_exceeded", "Monthly AI token quota exceeded.")
				status = "error"
				break
			}
		}
		msgs := sanitizeHistory(trimHistory(sanitizeHistory(append(append(append([]provider.Message{}, history...), lead...), turnMsgs...))))
		req := provider.Request{
			Model:          settings.Model,
			System:         system,
			Messages:       msgs,
			Tools:          defs,
			MaxTokens:      int(settings.MaxTokens),
			Effort:         settings.Effort,
			Thinking:       true,
			ToolChoiceNone: i == limit-1,
			CacheMessages:  true,
		}
		resp, err := t.prov.Stream(ctx, req, func(ev provider.StreamEvent) {
			switch ev.Type {
			case provider.EventTextDelta:
				ts.appendText(ev.Text)
				emit(EventTextDelta, map[string]any{"text": ev.Text})
			case provider.EventToolUseStart:
				if ts.toolBlock(ev.ID) == nil {
					ts.ui = append(ts.ui, UIBlock{Type: UITool, ID: ev.ID, Name: ev.Name, Status: "running"})
				}
				emit(EventToolStart, map[string]any{"id": ev.ID, "name": ev.Name})
			}
		})
		if err != nil {
			if ctx.Err() != nil {
				status = "cancelled"
				break
			}
			s.log.Warn("ai_provider_error", "error", err, "org_id", orgID)
			msg := "The AI provider returned an error."
			var pe *provider.Error
			if errors.As(err, &pe) {
				msg = pe.Error()
			}
			ts.fail("provider_error", msg)
			status = "error"
			break
		}
		if resp.Model != "" {
			model = resp.Model
		}
		ts.usage.Add(resp.Usage)
		s.recordUsage(persistCtx, &orgID, &userID, &convID, t.prov.Kind(), firstNonEmpty(resp.Model, settings.Model), "chat", resp.Usage)
		if len(resp.Message.Content) > 0 {
			turnMsgs = append(turnMsgs, resp.Message)
		}
		stopReason = resp.StopReason

		switch resp.StopReason {
		case provider.StopToolUse:
			tus := resp.Message.ToolUses()
			if len(tus) == 0 {
				break loop
			}
			var resultBlocks []provider.Block
			pause := false
			for _, tu := range tus {
				block, paused := s.execTool(ctx, t, env, byName, tu, ts)
				if block != nil {
					resultBlocks = append(resultBlocks, *block)
					if !block.IsError {
						results[tu.ID] = block.Content
					}
				}
				pause = pause || paused
			}
			if len(resultBlocks) > 0 {
				turnMsgs = append(turnMsgs, provider.Message{Role: provider.RoleUser, Content: resultBlocks})
			}
			if pause {
				break loop
			}
			if ctx.Err() != nil {
				status = "cancelled"
				break loop
			}
		case provider.StopRefusal:
			ts.fail("refusal", "The model declined to answer this request.")
			break loop
		case provider.StopMaxTokens:
			ts.fail("max_tokens", "The answer was cut off because it reached the maximum length.")
			break loop
		default:
			break loop
		}
	}

	if ctx.Err() != nil && status == "complete" {
		status = "cancelled"
	}
	assistantRow, err := s.insertMessage(persistCtx, t, provider.RoleAssistant, status, turnMsgs, ts.ui, model, ts.usage)
	if err != nil {
		return err
	}
	if ts.proposed {
		if err := s.store.AttachAIPendingActionsToMessage(persistCtx, db.AttachAIPendingActionsToMessageParams{
			ConversationID: convID, MessageID: pgtype.Int8{Int64: assistantRow.ID, Valid: true},
		}); err != nil {
			s.log.Warn("ai_actions_attach_failed", "error", err)
		}
	}
	if err := s.store.TouchAIConversation(persistCtx, db.TouchAIConversationParams{ID: convID, Added: 1}); err != nil {
		s.log.Warn("ai_conversation_touch_failed", "error", err)
	}
	emit(EventMessageDone, map[string]any{
		"message_uuid": assistantRow.Uuid,
		"status":       status,
		"stop_reason":  stopReason,
		"usage":        ts.usage,
	})

	if t.text != "" && strings.TrimSpace(t.conv.Title) == "" && ctx.Err() == nil {
		title := tools.Truncate(strings.SplitN(t.text, "\n", 2)[0], 60)
		if status == "complete" {
			title = s.generateTitle(ctx, t, lastAssistantText(turnMsgs))
		}
		if title != "" {
			if _, err := s.store.UpdateAIConversationTitle(persistCtx, db.UpdateAIConversationTitleParams{ID: convID, Title: title}); err == nil {
				emit(EventTitle, map[string]any{"conversation_uuid": t.conv.Uuid, "title": title})
			}
		}
	}
	return nil
}

func (s *Service) overrideQuota(ctx context.Context, orgID int64) *int64 {
	_, q, err := s.orgOverride(ctx, orgID)
	if err != nil {
		return nil
	}
	return q
}

func (s *Service) insertMessage(ctx context.Context, t *Turn, role, status string, msgs []provider.Message, ui []UIBlock, model string, u provider.Usage) (db.AiMessage, error) {
	if msgs == nil {
		msgs = []provider.Message{}
	}
	if ui == nil {
		ui = []UIBlock{}
	}
	content, err := json.Marshal(msgs)
	if err != nil {
		return db.AiMessage{}, err
	}
	uiRaw, err := json.Marshal(ui)
	if err != nil {
		return db.AiMessage{}, err
	}
	return s.store.InsertAIMessage(ctx, db.InsertAIMessageParams{
		ConversationID: t.conv.ID, OrganizationID: t.scope.InternalID, Role: role, Status: status,
		Content: content, Ui: uiRaw, Model: tools.Truncate(model, 128),
		InputTokens: u.InputTokens + u.CacheReadTokens + u.CacheWriteTokens, OutputTokens: u.OutputTokens,
	})
}

// execTool validates and runs one tool call. It returns the tool_result block
// (nil when a confirmation gate defers it) and whether the loop should pause.
func (s *Service) execTool(ctx context.Context, t *Turn, env tools.Env, byName map[string]tools.Tool, tu provider.Block, ts *turnState) (*provider.Block, bool) {
	if ts.toolBlock(tu.ID) == nil {
		ts.ui = append(ts.ui, UIBlock{Type: UITool, ID: tu.ID, Name: tu.Name, Status: "running"})
		ts.emit(EventToolStart, map[string]any{"id": tu.ID, "name": tu.Name})
	}
	id, name := tu.ID, tu.Name
	finish := func(res tools.Result) *provider.Block {
		content := boundToolResult(res.Content)
		if b := ts.toolBlock(id); b != nil {
			b.Status = "done"
			if res.IsError {
				b.Status = "error"
			}
			b.SummaryKey, b.SummaryParams = res.SummaryKey, res.SummaryParams
		}
		ts.emit(EventToolResult, map[string]any{
			"id": id, "name": name, "ok": !res.IsError,
			"summary_key": res.SummaryKey, "summary_params": res.SummaryParams,
		})
		if res.Chart != nil {
			ts.ui = append(ts.ui, UIBlock{Type: UIChart, ID: id, Chart: res.Chart})
			ts.emit(EventChart, map[string]any{"id": id, "chart": res.Chart})
		}
		if res.Plan != nil {
			ts.emit(EventPlan, map[string]any{"block": ts.upsertPlan(res.Plan)})
		}
		block := provider.ToolResultBlock(id, content, res.IsError)
		return &block
	}

	tool, ok := byName[name]
	if !ok {
		return finish(tools.ErrorResult("Tool " + name + " is not available to this user.")), false
	}
	spec := tool.Spec()
	// Re-check permissions at execution time (defense in depth).
	if !tools.Allowed(spec, t.principal, t.scope, s.gate(t.settings)) {
		return finish(tools.ErrorResult("Tool " + name + " is not available to this user.")), false
	}
	if err := tools.Validate(spec.InputSchema, tu.Input); err != nil {
		return finish(tools.ErrorResult("Invalid input: " + err.Error() + ". Fix the input and call the tool again.")), false
	}
	// Anything that can change data goes through the confirmation gate, even
	// if a tool forgot to set RequiresConfirmation (defense in depth).
	if requiresConfirmation(tool) {
		if ts.proposed {
			return finish(tools.ErrorResult(resultOnePerTurn)), false
		}
		pr, err := s.confirm.Propose(ctx, PendingCall{
			ConversationUUID: t.conv.Uuid, ConversationID: t.conv.ID, ToolUseID: id, Tool: tool, Input: tu.Input, Env: env,
		})
		if err != nil {
			s.log.Warn("ai_confirm_propose_failed", "tool", name, "error", err)
			return finish(tools.ErrorResult("Could not prepare the confirmation.")), false
		}
		if pr.UI != nil {
			ts.ui = append(ts.ui, *pr.UI)
			if pr.UI.Type == UIConfirm {
				ts.emit(EventConfirm, map[string]any{"block": *pr.UI})
			}
		}
		if pr.Result == nil {
			ts.proposed = true
			if b := ts.toolBlock(id); b != nil {
				b.Status = "pending"
			}
			return nil, pr.Pause
		}
		return finish(*pr.Result), pr.Pause
	}
	runCtx, cancel := context.WithTimeout(ctx, s.toolTimeout)
	defer cancel()
	res, err := tool.Run(runCtx, env, tu.Input)
	if err != nil {
		s.log.Warn("ai_tool_failed", "tool", name, "error", err)
		return finish(tools.ErrorResult("The tool failed with an internal error.")), false
	}
	return finish(res), false
}

// requiresConfirmation reports whether a tool call must go through the
// confirmation gate: write tools, action tools and anything flagged so.
func requiresConfirmation(tool tools.Tool) bool {
	spec := tool.Spec()
	if spec.RequiresConfirmation || spec.Kind == tools.KindWrite {
		return true
	}
	_, isAction := tool.(tools.ActionTool)
	return isAction
}

// boundToolResult caps what one tool result feeds back to the model. An
// oversized JSON result is replaced by a small JSON envelope that carries the
// clipped text as a string field, so free text from stored records stays
// delimited data and never spills into the prompt as loose prose.
func boundToolResult(content string) string {
	if content == "" {
		return "ok"
	}
	if len(content) <= maxToolResultChars {
		return content
	}
	clipped := content[:maxToolResultChars]
	for !utf8.ValidString(clipped) && len(clipped) > 0 {
		clipped = clipped[:len(clipped)-1]
	}
	raw, err := json.Marshal(map[string]any{
		"truncated": true,
		"note":      "Result too large and was cut off; narrow the query (dates, filters, limit) for complete data.",
		"partial":   clipped,
	})
	if err != nil {
		return `{"truncated":true}`
	}
	return string(raw)
}

func lastAssistantText(msgs []provider.Message) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == provider.RoleAssistant {
			if txt := strings.TrimSpace(msgs[i].Text()); txt != "" {
				return txt
			}
		}
	}
	return ""
}

var thinkTagRe = regexp.MustCompile(`(?s)<think>.*?</think>`)

// generateTitle asks a cheap model for a short title; falls back to the first
// words of the user message.
func (s *Service) generateTitle(ctx context.Context, t *Turn, assistantText string) string {
	fallback := tools.Truncate(strings.SplitN(t.text, "\n", 2)[0], 60)
	settings := t.settings
	model := settings.Model
	effort := "low"
	if settings.Provider == provider.KindAnthropic && strings.TrimSpace(settings.TitleModel) != "" {
		model = strings.TrimSpace(settings.TitleModel)
		effort = ""
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	prompt := "User: " + tools.Truncate(t.text, 500)
	if assistantText != "" {
		prompt += "\nAssistant: " + tools.Truncate(assistantText, 500)
	}
	resp, err := t.prov.Complete(ctx, provider.Request{
		Model:     model,
		MaxTokens: 300,
		Effort:    effort,
		System: []provider.SystemBlock{{Text: "Write a short title (2-6 words) for this conversation in the same language as the user's message. " +
			"Reply with the title only: no quotes, no trailing punctuation."}},
		Messages: []provider.Message{{Role: provider.RoleUser, Content: []provider.Block{provider.TextBlock(prompt)}}},
	})
	if err != nil {
		s.log.Info("ai_title_fallback", "error", err)
		return fallback
	}
	orgID, userID, convID := t.scope.InternalID, t.principal.UserInternal, t.conv.ID
	s.recordUsage(context.WithoutCancel(ctx), &orgID, &userID, &convID, t.prov.Kind(), firstNonEmpty(resp.Model, model), "title", resp.Usage)
	title := strings.TrimSpace(thinkTagRe.ReplaceAllString(resp.Message.Text(), ""))
	title = strings.Trim(strings.SplitN(title, "\n", 2)[0], " \"'`*#.")
	if title == "" {
		return fallback
	}
	return tools.Truncate(title, 80)
}
