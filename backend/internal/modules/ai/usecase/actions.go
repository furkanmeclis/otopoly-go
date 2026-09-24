package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/provider"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// PendingActionTTL is how long a confirm card stays actionable.
const PendingActionTTL = 30 * time.Minute

// actionTimeout bounds the execution of a confirmed action.
const actionTimeout = 60 * time.Second

// Pending action statuses.
const (
	ActionPending   = "pending"
	ActionExecuting = "executing"
	ActionConfirmed = "confirmed"
	ActionCancelled = "cancelled"
	ActionExpired   = "expired"
	ActionFailed    = "failed"
)

// Errors for the confirm/cancel endpoints.
var (
	ErrActionResolved  = errors.New("this action was already confirmed or cancelled")
	ErrActionExpired   = errors.New("this action expired and was not executed")
	ErrActionNotReady  = errors.New("the assistant is still answering; try again in a moment")
	ErrActionForbidden = errors.New("you are not allowed to perform this action")
)

// Tool results fed back to the model for actions that did not run.
const (
	resultCancelled   = "Not executed: the user cancelled this action on the confirmation card."
	resultExpired     = "Not executed: the confirmation card expired before the user approved it."
	resultMovedOn     = "Not executed: the user sent a new message instead of confirming this action."
	resultOnePerTurn  = "Only one change can be proposed at a time. Wait for the user's answer to the confirmation card, then propose the next change."
	resultInternalErr = "The action failed with an internal error; tell the user it may not have been applied and to check the record in the app."
)

// ActivityRecorder records audit events (satisfied by *activity.Recorder).
type ActivityRecorder interface {
	Record(ctx context.Context, actorID *int64, action, resource string, resourceUUID *uuid.UUID, payload map[string]any, r *http.Request)
}

// SetActivityRecorder installs the audit log recorder for confirmed actions.
func (s *Service) SetActivityRecorder(r ActivityRecorder) { s.activity = r }

// EnableActions installs the confirmation gate for write tools: proposals are
// persisted as pending actions and shown as confirm cards.
func (s *Service) EnableActions() { s.confirm = actionGate{s: s} }

// ActionResult is what a resolved action reports on its confirm card.
type ActionResult struct {
	OK            bool           `json:"ok"`
	SummaryKey    string         `json:"summary_key,omitempty"`
	SummaryParams map[string]any `json:"summary_params,omitempty"`
	Message       string         `json:"message,omitempty"`
	Link          *tools.Link    `json:"link,omitempty"`
}

// ConfirmCard is the data of a "confirm" UI block.
type ConfirmCard struct {
	Preview   tools.Preview `json:"preview"`
	ToolUseID string        `json:"tool_use_id"`
	ExpiresAt time.Time     `json:"expires_at"`
	Result    *ActionResult `json:"result,omitempty"`
}

func confirmBlock(row db.AiPendingAction, card ConfirmCard) UIBlock {
	raw, _ := json.Marshal(card)
	return UIBlock{Type: UIConfirm, ID: row.Uuid.String(), Name: row.ToolName, Status: row.Status, Data: raw}
}

// ------------------------------------------------------------------ gate

type actionGate struct{ s *Service }

// Propose validates the call, persists a pending action and returns a confirm
// card; the tool_use stays unanswered until the user decides.
func (g actionGate) Propose(ctx context.Context, call PendingCall) (ProposeResult, error) {
	s := g.s
	at, ok := call.Tool.(tools.ActionTool)
	if !ok {
		r := tools.ErrorResult("This action cannot be confirmed from the chat. Tell the user to make the change in the app.")
		return ProposeResult{Result: &r}, nil
	}
	prop, err := at.Propose(ctx, call.Env, call.Input)
	if ie, ok := tools.AsInputError(err); ok {
		r := tools.ErrorResult(ie.Msg + ". Fix the input (or ask the user) and call the tool again.")
		return ProposeResult{Result: &r}, nil
	}
	if err != nil {
		return ProposeResult{}, err
	}
	previewRaw, err := json.Marshal(prop.Preview)
	if err != nil {
		return ProposeResult{}, err
	}
	expires := s.now().Add(PendingActionTTL)
	row, err := s.store.InsertAIPendingAction(ctx, db.InsertAIPendingActionParams{
		OrganizationID: call.Env.Scope.InternalID,
		UserID:         call.Env.Principal.UserInternal,
		ConversationID: call.ConversationID,
		ToolUseID:      tools.Truncate(call.ToolUseID, 128),
		ToolName:       at.Spec().Name,
		Input:          prop.Input,
		Preview:        previewRaw,
		IdempotencyKey: call.ConversationUUID.String() + ":" + call.ToolUseID,
		ExpiresAt:      pgtype.Timestamptz{Time: expires, Valid: true},
	})
	if err != nil {
		return ProposeResult{}, err
	}
	block := confirmBlock(row, ConfirmCard{Preview: prop.Preview, ToolUseID: call.ToolUseID, ExpiresAt: expires})
	return ProposeResult{UI: &block, Pause: true}, nil
}

// ------------------------------------------------------------------ message patching

// patchActionMessage updates the assistant message that proposed an action:
// it appends the tool_result the model will see (if not answered yet) and
// updates the confirm card + tool indicator on the stored UI blocks.
func (s *Service) patchActionMessage(ctx context.Context, row db.AiPendingAction, toolResult *provider.Block, result *ActionResult) (UIBlock, error) {
	var card ConfirmCard
	_ = json.Unmarshal(row.Preview, &card.Preview)
	card.ToolUseID = row.ToolUseID
	card.ExpiresAt = row.ExpiresAt.Time
	card.Result = result
	block := confirmBlock(row, card)
	if !row.MessageID.Valid {
		return block, nil
	}
	msg, err := s.store.GetAIMessageByID(ctx, row.MessageID.Int64)
	if err != nil {
		return block, err
	}
	msgs := decodeRowMessages(msg)
	if toolResult != nil && !hasToolResult(msgs, row.ToolUseID) {
		msgs = append(msgs, provider.Message{Role: provider.RoleUser, Content: []provider.Block{*toolResult}})
	}
	var ui []UIBlock
	_ = json.Unmarshal(msg.Ui, &ui)
	toolStatus := "done"
	switch row.Status {
	case ActionFailed:
		toolStatus = "error"
	case ActionCancelled, ActionExpired:
		toolStatus = "cancelled"
	case ActionPending, ActionExecuting:
		toolStatus = "pending"
	}
	found := false
	for i := range ui {
		switch {
		case ui[i].Type == UIConfirm && ui[i].ID == block.ID:
			ui[i] = block
			found = true
		case ui[i].Type == UITool && ui[i].ID == row.ToolUseID:
			ui[i].Status = toolStatus
		}
	}
	if !found {
		ui = append(ui, block)
	}
	content, err := json.Marshal(msgs)
	if err != nil {
		return block, err
	}
	uiRaw, err := json.Marshal(ui)
	if err != nil {
		return block, err
	}
	return block, s.store.UpdateAIMessageContentUI(ctx, db.UpdateAIMessageContentUIParams{ID: msg.ID, Content: content, Ui: uiRaw})
}

func hasToolResult(msgs []provider.Message, toolUseID string) bool {
	for _, m := range msgs {
		for _, b := range m.Content {
			if b.Type == provider.BlockToolResult && b.ToolUseID == toolUseID {
				return true
			}
		}
	}
	return false
}

// expireActions resolves pending actions of a conversation as "not executed":
// all of them (the user moved on) or only those past their expiry.
func (s *Service) expireActions(ctx context.Context, conv db.AiConversation, all bool) {
	rows, err := s.store.ExpireAIPendingActions(ctx, db.ExpireAIPendingActionsParams{ConversationID: conv.ID, AllPending: all})
	if err != nil {
		s.log.Warn("ai_actions_expire_failed", "error", err)
		return
	}
	for _, row := range rows {
		text := resultExpired
		if all {
			text = resultMovedOn
		}
		block := provider.ToolResultBlock(row.ToolUseID, text, true)
		if _, err := s.patchActionMessage(ctx, row, &block, nil); err != nil {
			s.log.Warn("ai_action_patch_failed", "error", err)
		}
	}
}

// ------------------------------------------------------------------ confirm / cancel

// ConfirmInput confirms a pending action, optionally with edited fields.
type ConfirmInput struct {
	Edits  map[string]any `json:"edits"`
	Locale string         `json:"locale"`
}

// ActionRun is a claimed action ready to execute (and resume the chat).
type ActionRun struct {
	row  db.AiPendingAction
	conv db.AiConversation
	tool tools.ActionTool
	env  tools.Env
	// turn is nil when the conversation cannot continue (assistant disabled,
	// quota exhausted); the action still runs.
	turn *Turn
}

// ActionUUID returns the action id.
func (r *ActionRun) ActionUUID() uuid.UUID { return r.row.Uuid }

func (s *Service) loadAction(ctx context.Context, id uuid.UUID) (db.GetAIPendingActionForUserRow, db.AiConversation, error) {
	p, scope, err := principalScope(ctx)
	if err != nil {
		return db.GetAIPendingActionForUserRow{}, db.AiConversation{}, err
	}
	row, err := s.store.GetAIPendingActionForUser(ctx, db.GetAIPendingActionForUserParams{
		Uuid: id, OrganizationID: scope.InternalID, UserID: p.UserInternal,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, db.AiConversation{}, ErrNotFound
	}
	if err != nil {
		return row, db.AiConversation{}, err
	}
	conv, err := s.loadConversation(ctx, row.ConversationUuid)
	return row, conv, err
}

func pendingRow(r db.GetAIPendingActionForUserRow) db.AiPendingAction {
	return db.AiPendingAction{
		ID: r.ID, Uuid: r.Uuid, OrganizationID: r.OrganizationID, UserID: r.UserID, ConversationID: r.ConversationID,
		MessageID: r.MessageID, ToolUseID: r.ToolUseID, ToolName: r.ToolName, Input: r.Input, Preview: r.Preview,
		Status: r.Status, Result: r.Result, Error: r.Error, IdempotencyKey: r.IdempotencyKey, ExpiresAt: r.ExpiresAt,
		ResolvedAt: r.ResolvedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

// checkPending validates that an action can still be decided.
func (s *Service) checkPending(ctx context.Context, row db.AiPendingAction, conv db.AiConversation) error {
	if row.Status != ActionPending {
		return ErrActionResolved
	}
	if !row.ExpiresAt.Time.After(s.now()) {
		s.expireActions(ctx, conv, false)
		return ErrActionExpired
	}
	if !row.MessageID.Valid {
		return ErrActionNotReady
	}
	return nil
}

// applyEdits merges user edits into the stored input. Only fields listed on
// the card are editable; values are coerced to the input's types.
func applyEdits(input json.RawMessage, allowed []tools.EditField, edits map[string]any) (json.RawMessage, error) {
	m := map[string]any{}
	if err := json.Unmarshal(input, &m); err != nil {
		return nil, err
	}
	byKey := map[string]tools.EditField{}
	for _, f := range allowed {
		byKey[f.Key] = f
	}
	for key, raw := range edits {
		f, ok := byKey[key]
		if !ok {
			return nil, invalid("field %q cannot be edited", key)
		}
		var str string
		switch v := raw.(type) {
		case string:
			str = strings.TrimSpace(v)
		case float64:
			str = fmt.Sprint(v)
		case nil:
		default:
			return nil, invalid("field %q has an invalid value", key)
		}
		if str == "" {
			if f.Required {
				return nil, invalid("field %q is required", key)
			}
			delete(m, key)
			continue
		}
		switch f.Type {
		case "money":
			amount, err := tools.ParseAmount(str)
			if err != nil {
				return nil, invalid("%s", err.Error())
			}
			m[key] = amount.Float()
		case "select":
			valid := len(f.Options) == 0
			for _, o := range f.Options {
				if o.Value == str {
					valid = true
				}
			}
			if !valid {
				return nil, invalid("field %q has an invalid option", key)
			}
			m[key] = str
		case "date":
			if _, err := time.Parse("2006-01-02", str); err != nil {
				return nil, invalid("field %q must be YYYY-MM-DD", key)
			}
			m[key] = str
		case "time":
			if _, err := time.Parse("15:04", str); err != nil {
				return nil, invalid("field %q must be HH:MM", key)
			}
			m[key] = str
		default:
			if len([]rune(str)) > 2000 {
				return nil, invalid("field %q is too long", key)
			}
			m[key] = str
		}
	}
	return json.Marshal(m)
}

// PrepareConfirm validates a confirm request (ownership, status, expiry,
// permissions, edits), claims the action (pending → executing, the
// idempotency lock) and returns it ready to run. Errors are returned before
// any stream starts so they map to regular HTTP errors.
func (s *Service) PrepareConfirm(ctx context.Context, id uuid.UUID, in ConfirmInput) (*ActionRun, error) {
	p, scope, err := principalScope(ctx)
	if err != nil {
		return nil, err
	}
	full, conv, err := s.loadAction(ctx, id)
	if err != nil {
		return nil, err
	}
	row := pendingRow(full)
	if err := s.checkPending(ctx, row, conv); err != nil {
		return nil, err
	}
	settings, err := s.store.GetAISettings(ctx)
	if err != nil {
		return nil, err
	}
	registered, ok := s.registry.Get(row.ToolName)
	at, isAction := registered.(tools.ActionTool)
	if !ok || !isAction || !tools.Allowed(at.Spec(), p, scope, s.gate(settings)) {
		return nil, ErrActionForbidden
	}
	env := tools.Env{Principal: p, Scope: scope, Now: s.now(), Location: s.loc}
	input, preview := row.Input, row.Preview
	if len(in.Edits) > 0 {
		var current tools.Preview
		_ = json.Unmarshal(row.Preview, &current)
		merged, err := applyEdits(row.Input, current.Edit, in.Edits)
		if err != nil {
			return nil, err
		}
		if err := tools.Validate(at.Spec().InputSchema, merged); err != nil {
			return nil, invalid("%s", err.Error())
		}
		prop, err := at.Propose(ctx, env, merged)
		if ie, ok := tools.AsInputError(err); ok {
			return nil, invalid("%s", ie.Msg)
		}
		if err != nil {
			return nil, err
		}
		if preview, err = json.Marshal(prop.Preview); err != nil {
			return nil, err
		}
		input = prop.Input
	}
	claimed, err := s.store.ClaimAIPendingAction(ctx, db.ClaimAIPendingActionParams{ID: row.ID, Input: input, Preview: preview})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrActionResolved
	}
	if err != nil {
		return nil, err
	}
	run := &ActionRun{row: claimed, conv: conv, tool: at, env: env}
	if _, err := s.availability(ctx, settings, scope.InternalID); err == nil {
		if prov, err := s.providerFor(settings); err == nil {
			locale := strings.ToLower(strings.TrimSpace(in.Locale))
			if locale != "en" {
				locale = "tr"
			}
			run.turn = &Turn{conv: conv, settings: settings, prov: prov, principal: p, scope: scope, locale: locale}
		}
	}
	return run, nil
}

// RunConfirm executes a claimed action exactly once, records it in the audit
// log (marked via AI), updates the confirm card, feeds the tool_result back to
// the model and streams its continuation (same SSE events as a message).
func (s *Service) RunConfirm(ctx context.Context, run *ActionRun, emit Emitter) error {
	if emit == nil {
		emit = func(string, any) {}
	}
	persistCtx := context.WithoutCancel(ctx)
	row := run.row
	execCtx := activity.WithOrigin(persistCtx, activity.Origin{
		Via: "ai", ActionUUID: row.Uuid.String(), ConversationUUID: run.conv.Uuid.String(),
	})
	execCtx, cancel := context.WithTimeout(execCtx, actionTimeout)
	res, err := run.tool.Run(execCtx, run.env, row.Input)
	cancel()
	status := ActionConfirmed
	errText := ""
	if err != nil {
		s.log.Error("ai_action_failed", "tool", row.ToolName, "action", row.Uuid, "error", err)
		res = tools.ErrorResult(resultInternalErr)
		errText = tools.Truncate(err.Error(), 500)
	}
	if res.IsError {
		status = ActionFailed
		if errText == "" {
			errText = tools.Truncate(res.Content, 500)
		}
	}
	result := &ActionResult{OK: !res.IsError, SummaryKey: res.SummaryKey, SummaryParams: res.SummaryParams, Link: res.Link}
	if res.IsError {
		result.Message = strings.TrimPrefix(res.Content, "Not executed: ")
	}
	resultRaw, _ := json.Marshal(result)
	finished, err := s.store.FinishAIPendingAction(persistCtx, db.FinishAIPendingActionParams{
		ID: row.ID, Status: status, Result: resultRaw, Error: errText,
	})
	if err != nil {
		return err
	}
	content := res.Content
	if len(content) > maxToolResultChars {
		content = content[:maxToolResultChars]
	}
	if content == "" {
		content = "ok"
	}
	toolResult := provider.ToolResultBlock(row.ToolUseID, content, res.IsError)
	block, err := s.patchActionMessage(persistCtx, finished, &toolResult, result)
	if err != nil {
		return err
	}
	if s.activity != nil {
		actor := run.env.Principal.UserInternal
		action := "ai.action.confirmed"
		if status == ActionFailed {
			action = "ai.action.failed"
		}
		s.activity.Record(persistCtx, &actor, action, "ai.action", &row.Uuid, map[string]any{
			"tool": row.ToolName, "via": "ai", "conversation_uuid": run.conv.Uuid.String(),
		}, nil)
	}
	emit(EventAction, map[string]any{"action_uuid": row.Uuid, "status": status, "tool_use_id": row.ToolUseID, "block": block})

	if run.turn == nil || ctx.Err() != nil {
		return nil
	}
	rows, err := s.store.ListAIMessages(ctx, run.conv.ID)
	if err != nil {
		return err
	}
	history, results := historyFromRows(rows, run.turn.settings.Model)
	emit(EventMessageStart, map[string]any{"conversation_uuid": run.conv.Uuid, "resumed": true, "action_uuid": row.Uuid})
	return s.runAgent(ctx, run.turn, emit, history, results, nil)
}

// CancelAction resolves a pending action as cancelled (nothing runs) and
// returns the updated confirm card.
func (s *Service) CancelAction(ctx context.Context, id uuid.UUID) (UIBlock, error) {
	full, conv, err := s.loadAction(ctx, id)
	if err != nil {
		return UIBlock{}, err
	}
	row := pendingRow(full)
	if err := s.checkPending(ctx, row, conv); err != nil {
		return UIBlock{}, err
	}
	cancelled, err := s.store.CancelAIPendingAction(ctx, row.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return UIBlock{}, ErrActionResolved
	}
	if err != nil {
		return UIBlock{}, err
	}
	toolResult := provider.ToolResultBlock(row.ToolUseID, resultCancelled, true)
	return s.patchActionMessage(context.WithoutCancel(ctx), cancelled, &toolResult, nil)
}
