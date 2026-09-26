package usecase

import (
	"context"
	"strings"

	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/google/uuid"
)

// TodosServiceCreator is a TodoCreator backed by the todos module: the todo
// is linked to the lead (todos.lead_id) and its customer, assigned to the
// requested (or lead) assignee, and — when a due time is set — gets a
// reminder at the due moment. The lead module records the todo_created
// timeline event itself.
type TodosServiceCreator struct {
	Todos *todosusecase.Service
}

// CreateTodoForLead implements TodoCreator.
func (c TodosServiceCreator) CreateTodoForLead(ctx context.Context, req TodoRequest) (CreatedTodo, error) {
	if c.Todos == nil {
		return CreatedTodo{}, ErrNotConfigured
	}
	in := todosusecase.CreateInput{
		Title: req.Title, Notes: req.Notes, DueDate: req.DueDate, DueTime: req.DueTime,
		AssigneeUUID: req.AssigneeUUID,
	}
	if customer := req.CustomerUUID; customer != uuid.Nil {
		in.CustomerUUID = &customer
	}
	if lead := req.LeadUUID; lead != uuid.Nil {
		in.LeadUUID = &lead
	}
	if req.DueTime != nil && strings.TrimSpace(*req.DueTime) != "" && req.DueDate != nil && strings.TrimSpace(*req.DueDate) != "" {
		in.ReminderOffsets = []int{0}
	}
	t, err := c.Todos.Create(ctx, in)
	if err != nil {
		return CreatedTodo{}, err
	}
	return CreatedTodo{UUID: t.UUID, Title: t.Title}, nil
}
