package usecase

import (
	"context"

	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
)

// TodosServiceCreator is a TodoCreator backed by the existing todos module.
// It links the todo to the lead's customer (todos have no lead_id yet); the
// notification-center integration can replace it with a lead-linked one.
type TodosServiceCreator struct {
	Todos *todosusecase.Service
}

// CreateTodoForLead implements TodoCreator.
func (c TodosServiceCreator) CreateTodoForLead(ctx context.Context, req TodoRequest) (CreatedTodo, error) {
	if c.Todos == nil {
		return CreatedTodo{}, ErrNotConfigured
	}
	customer := req.CustomerUUID
	t, err := c.Todos.Create(ctx, todosusecase.CreateInput{
		Title: req.Title, Notes: req.Notes, DueDate: req.DueDate, DueTime: req.DueTime,
		AssigneeUUID: req.AssigneeUUID, CustomerUUID: &customer,
	})
	if err != nil {
		return CreatedTodo{}, err
	}
	return CreatedTodo{UUID: t.UUID, Title: t.Title}, nil
}
