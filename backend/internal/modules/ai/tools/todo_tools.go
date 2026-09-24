package tools

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// TodosService is the todos use case as seen by the assistant.
type TodosService interface {
	Create(ctx context.Context, in todosusecase.CreateInput) (todosusecase.Todo, error)
	Get(ctx context.Context, id uuid.UUID) (todosusecase.Todo, error)
	List(ctx context.Context, limit, offset int32, f todosusecase.ListFilters) ([]todosusecase.Todo, int64, error)
	SetStatus(ctx context.Context, id uuid.UUID, status string) (todosusecase.Todo, error)
	Assignees(ctx context.Context) ([]todosusecase.Assignee, error)
}

func dueLabel(date, tm *string) string {
	if date == nil {
		return ""
	}
	out := *date
	if tm != nil {
		out += " " + *tm
	}
	return out
}

// ---------------------------------------------------------------- create

// CreateTodo adds a todo (görev), optionally assigned and linked.
type CreateTodo struct {
	todos     TodosService
	customers CustomersWriter
}

var createTodoSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"title":         map[string]any{"type": "string", "minLength": 2, "maxLength": 200, "description": "Short task, e.g. \"34 ABC 123 seramik kontrolü\"."},
		"notes":         map[string]any{"type": "string", "maxLength": 1000},
		"due_date":      map[string]any{"type": "string", "format": "date", "description": "YYYY-MM-DD; resolve \"yarın\", \"cuma\" from the current date."},
		"due_time":      map[string]any{"type": "string", "maxLength": 5, "description": "HH:MM (24h), only with due_date."},
		"assignee":      map[string]any{"type": "string", "maxLength": 100, "description": "Staff member name, \"me\" or user uuid. Omit for unassigned."},
		"customer_uuid": map[string]any{"type": "string", "format": "uuid"},
		"job_uuid":      map[string]any{"type": "string", "format": "uuid"},
	},
	"required":             []string{"title"},
	"additionalProperties": false,
}

type createTodoInput struct {
	Title        string `json:"title"`
	Notes        string `json:"notes,omitempty"`
	DueDate      string `json:"due_date,omitempty"`
	DueTime      string `json:"due_time,omitempty"`
	Assignee     string `json:"assignee,omitempty"`
	CustomerUUID string `json:"customer_uuid,omitempty"`
	JobUUID      string `json:"job_uuid,omitempty"`
}

// Spec implements Tool.
func (CreateTodo) Spec() Spec {
	return Spec{
		Name:                 "create_todo",
		Description:          "Propose a todo/reminder (görev) with optional due date/time, assignee and related customer or job. Shows a confirmation card.",
		InputSchema:          createTodoSchema,
		Permissions:          []string{rbac.PermTenantTodosWrite},
		Feature:              FeatureTodos,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

func (t CreateTodo) resolveAssignee(ctx context.Context, env Env, ref string) (todosusecase.Assignee, []todosusecase.Assignee, error) {
	members, err := t.todos.Assignees(ctx)
	if err != nil {
		return todosusecase.Assignee{}, nil, err
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return todosusecase.Assignee{}, members, nil
	}
	if strings.EqualFold(ref, "me") || FoldTR(ref) == "ben" {
		for _, m := range members {
			if m.UUID == env.Principal.UserID {
				return m, members, nil
			}
		}
	}
	name := func(m todosusecase.Assignee) string { return m.Name }
	if id, err := uuid.Parse(ref); err == nil {
		for _, m := range members {
			if m.UUID == id {
				return m, members, nil
			}
		}
	}
	if m, _, ok := matchByName(ref, members, name); ok {
		return m, members, nil
	}
	// First-name match ("Ali" → "Ali Yılmaz").
	var hits []todosusecase.Assignee
	for _, m := range members {
		if first := strings.Fields(FoldTR(m.Name)); len(first) > 0 && first[0] == FoldTR(ref) {
			hits = append(hits, m)
		}
	}
	if len(hits) == 1 {
		return hits[0], members, nil
	}
	return todosusecase.Assignee{}, members, inputErr("assignee %q not found or ambiguous; staff: %s", ref, names(members, name, 20))
}

// Propose implements ActionTool.
func (t CreateTodo) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in createTodoInput
	if err := decodeInput(createTodoSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	in.Title, in.Notes = trimmed(in.Title, 200), trimmed(in.Notes, 1000)
	if in.Title == "" {
		return Proposal{}, inputErr("title is required")
	}
	if in.DueTime != "" {
		if in.DueDate == "" {
			return Proposal{}, inputErr("due_time requires due_date")
		}
		if _, err := time.Parse("15:04", in.DueTime); err != nil {
			return Proposal{}, inputErr("due_time must be HH:MM")
		}
	}
	a, members, err := t.resolveAssignee(ctx, env, in.Assignee)
	if err != nil {
		return Proposal{}, err
	}
	in.Assignee = ""
	if a.UUID != uuid.Nil {
		in.Assignee = a.UUID.String()
	}
	fields := []Field{}
	var date, tm *string
	if in.DueDate != "" {
		date = &in.DueDate
	}
	if in.DueTime != "" {
		tm = &in.DueTime
	}
	if d := dueLabel(date, tm); d != "" {
		fields = append(fields, Field{Key: "due", Value: d})
	}
	if a.Name != "" {
		fields = append(fields, Field{Key: "assignee", Value: a.Name})
	}
	if in.CustomerUUID != "" && t.customers != nil {
		cid, _ := uuid.Parse(in.CustomerUUID)
		c, err := t.customers.Get(ctx, cid)
		if err != nil {
			return Proposal{}, proposalError(err)
		}
		fields = append(fields, Field{Key: "customer", Value: c.Name})
	}
	if in.Notes != "" {
		fields = append(fields, Field{Key: "notes", Value: in.Notes})
	}
	opts := []Option{{Value: "", LabelKey: "ai.confirm.values.unassigned"}}
	for _, m := range members {
		opts = append(opts, Option{Value: m.UUID.String(), Label: m.Name})
	}
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "create_todo", Title: in.Title, Fields: fields,
			Edit: []EditField{
				{Key: "title", Type: "text", Value: in.Title, Required: true},
				{Key: "due_date", Type: "date", Value: in.DueDate},
				{Key: "due_time", Type: "time", Value: in.DueTime},
				{Key: "assignee", Type: "select", Value: in.Assignee, Options: opts},
				{Key: "notes", Type: "textarea", Value: in.Notes},
			},
		},
	}, nil
}

func optUUID(s string) *uuid.UUID {
	id, err := uuid.Parse(strings.TrimSpace(s))
	if err != nil {
		return nil
	}
	return &id
}

func optString(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

// Run implements Tool.
func (t CreateTodo) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in createTodoInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	todo, err := t.todos.Create(ctx, todosusecase.CreateInput{
		Title: in.Title, Notes: in.Notes, DueDate: optString(in.DueDate), DueTime: optString(in.DueTime),
		AssigneeUUID: optUUID(in.Assignee), CustomerUUID: optUUID(in.CustomerUUID), JobUUID: optUUID(in.JobUUID),
		ViaAI: true,
	})
	if err != nil {
		return execError(err)
	}
	res := JSONResult(map[string]any{"done": true, "todo_uuid": todo.UUID.String(), "title": DataText(todo.Title, maxTextChars), "due": dueLabel(todo.DueDate, todo.DueTime)},
		"ai.tool_summary.todo_created", map[string]any{"title": Truncate(todo.Title, 40)})
	res.Link = &Link{Kind: "todo", UUID: todo.UUID.String()}
	return res, nil
}

// ---------------------------------------------------------------- list

// ListTodos lists todos (read).
type ListTodos struct{ todos TodosService }

var listTodosSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"scope":    map[string]any{"type": "string", "enum": []string{"overdue", "today", "open_due", "upcoming", "no_date"}, "description": "open_due = overdue + today."},
		"status":   map[string]any{"type": "string", "enum": []string{"open", "done"}, "description": "Default open."},
		"assignee": map[string]any{"type": "string", "maxLength": 40, "description": "\"me\" or a user uuid."},
		"query":    map[string]any{"type": "string", "maxLength": 80},
		"limit":    map[string]any{"type": "integer", "minimum": 1, "maximum": 25, "description": "Default 15."},
	},
	"additionalProperties": false,
}

// Spec implements Tool.
func (ListTodos) Spec() Spec {
	return Spec{
		Name:        "list_todos",
		Description: "List the organization's todos (görevler) with uuid, title, due date/time, assignee and status.",
		InputSchema: listTodosSchema,
		Permissions: []string{rbac.PermTenantTodosRead},
		Feature:     FeatureTodos,
		Kind:        KindRead,
	}
}

// Run implements Tool.
func (t ListTodos) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Scope    string `json:"scope"`
		Status   string `json:"status"`
		Assignee string `json:"assignee"`
		Query    string `json:"query"`
		Limit    int    `json:"limit"`
	}
	if err := Decode(listTodosSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	if in.Status == "" {
		in.Status = "open"
	}
	rows, total, err := t.todos.List(ctx, int32(clampInt(in.Limit, 15, 1, 25)), 0, todosusecase.ListFilters{
		Status: in.Status, Scope: in.Scope, Assignee: in.Assignee, Q: in.Query,
	})
	if err != nil {
		return userError(err)
	}
	type item struct {
		UUID     string `json:"uuid"`
		Title    string `json:"title"`
		Due      string `json:"due,omitempty"`
		Overdue  bool   `json:"overdue,omitempty"`
		Assignee string `json:"assignee,omitempty"`
		Customer string `json:"customer,omitempty"`
		Status   string `json:"status"`
	}
	items := make([]item, 0, len(rows))
	for _, r := range rows {
		it := item{UUID: r.UUID.String(), Title: DataText(r.Title, maxTextChars), Due: dueLabel(r.DueDate, r.DueTime), Overdue: r.Overdue, Status: r.Status}
		if r.Assignee != nil {
			it.Assignee = DataText(r.Assignee.Label, maxNameChars)
		}
		if r.Customer != nil {
			it.Customer = DataText(r.Customer.Label, maxNameChars)
		}
		items = append(items, it)
	}
	return JSONResult(map[string]any{"total": total, "todos": items}, "ai.tool_summary.todos_found", map[string]any{"count": total}), nil
}

// ---------------------------------------------------------------- complete

// CompleteTodo marks a todo done.
type CompleteTodo struct{ todos TodosService }

var completeTodoSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"todo_uuid": map[string]any{"type": "string", "format": "uuid", "description": "uuid from list_todos."},
	},
	"required":             []string{"todo_uuid"},
	"additionalProperties": false,
}

// Spec implements Tool.
func (CompleteTodo) Spec() Spec {
	return Spec{
		Name:                 "complete_todo",
		Description:          "Propose marking a todo done. Shows a confirmation card.",
		InputSchema:          completeTodoSchema,
		Permissions:          []string{rbac.PermTenantTodosWrite},
		Feature:              FeatureTodos,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// Propose implements ActionTool.
func (t CompleteTodo) Propose(ctx context.Context, _ Env, raw json.RawMessage) (Proposal, error) {
	var in struct {
		TodoUUID string `json:"todo_uuid"`
	}
	if err := decodeInput(completeTodoSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	id, _ := uuid.Parse(in.TodoUUID)
	todo, err := t.todos.Get(ctx, id)
	if err != nil {
		return Proposal{}, proposalError(err)
	}
	if todo.Status == "done" {
		return Proposal{}, inputErr("todo %q is already done", DataText(todo.Title, 60))
	}
	fields := []Field{}
	if d := dueLabel(todo.DueDate, todo.DueTime); d != "" {
		fields = append(fields, Field{Key: "due", Value: d})
	}
	if todo.Assignee != nil {
		fields = append(fields, Field{Key: "assignee", Value: todo.Assignee.Label})
	}
	return Proposal{Input: mustJSON(in), Preview: Preview{Action: "complete_todo", Title: todo.Title, Fields: fields}}, nil
}

// Run implements Tool.
func (t CompleteTodo) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in struct {
		TodoUUID string `json:"todo_uuid"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	id, _ := uuid.Parse(in.TodoUUID)
	todo, err := t.todos.SetStatus(ctx, id, "done")
	if err != nil {
		return execError(err)
	}
	res := JSONResult(map[string]any{"done": true, "title": DataText(todo.Title, maxTextChars), "status": todo.Status},
		"ai.tool_summary.todo_completed", map[string]any{"title": Truncate(todo.Title, 40)})
	res.Link = &Link{Kind: "todo", UUID: todo.UUID.String()}
	return res, nil
}

// ---------------------------------------------------------------- plan (UI)

// UpdatePlan shows (or updates in place) a checklist of the assistant's plan.
type UpdatePlan struct{}

var planSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"title": map[string]any{"type": "string", "maxLength": 80},
		"items": map[string]any{
			"type": "array", "minItems": 1, "maxItems": 8,
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"text":   map[string]any{"type": "string", "minLength": 1, "maxLength": 120},
					"status": map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "done", "skipped"}},
				},
				"required":             []string{"text", "status"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []string{"items"},
	"additionalProperties": false,
}

// Spec implements Tool.
func (UpdatePlan) Spec() Spec {
	return Spec{
		Name:        "update_plan",
		Description: "Show the user a short checklist for a multi-step request (2+ changes); call again with the full list to update statuses. Not for single-step requests.",
		InputSchema: planSchema,
		Feature:     FeatureChat,
		Kind:        KindUI,
	}
}

// Run implements Tool.
func (UpdatePlan) Run(_ context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var plan Plan
	if err := Decode(planSchema, raw, &plan); err != nil {
		return ErrorResult(err.Error()), nil
	}
	done := 0
	for i := range plan.Items {
		plan.Items[i].Text = strings.TrimSpace(plan.Items[i].Text)
		if plan.Items[i].Status == "done" {
			done++
		}
	}
	return Result{Content: "shown", Plan: &plan, SummaryKey: "ai.tool_summary.plan_updated",
		SummaryParams: map[string]any{"done": done, "total": len(plan.Items)}}, nil
}
