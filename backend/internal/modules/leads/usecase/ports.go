package usecase

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotConfigured is returned by the default TodoCreator.
var ErrNotConfigured = errors.New("not configured")

// TodoRequest asks the todo module to create a todo for a lead. The request
// context carries the tenant scope and the acting user.
type TodoRequest struct {
	OrganizationID int64
	LeadID         int64
	LeadUUID       uuid.UUID
	CustomerUUID   uuid.UUID
	Title          string
	Notes          string
	DueDate        *string // yyyy-MM-dd
	DueTime        *string // HH:mm
	AssigneeUUID   *uuid.UUID
}

// CreatedTodo identifies the created todo.
type CreatedTodo struct {
	UUID  uuid.UUID
	Title string
}

// TodoCreator creates a todo from a lead. The notification-center
// integration implements it (linking todos.lead_id); the default returns
// ErrNotConfigured.
type TodoCreator interface {
	CreateTodoForLead(ctx context.Context, req TodoRequest) (CreatedTodo, error)
}

// NoopTodoCreator is the default TodoCreator.
type NoopTodoCreator struct{}

// CreateTodoForLead implements TodoCreator.
func (NoopTodoCreator) CreateTodoForLead(context.Context, TodoRequest) (CreatedTodo, error) {
	return CreatedTodo{}, ErrNotConfigured
}
