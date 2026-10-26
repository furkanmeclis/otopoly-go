package usecase

import (
	"context"
	"sync"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
)

type recordedEvent struct {
	resource, action string
	uuids            []string
}

type recordingPublisher struct {
	mu     sync.Mutex
	events []recordedEvent
}

func (r *recordingPublisher) Publish(_ context.Context, resource, action string, uuids ...string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, recordedEvent{resource, action, uuids})
}

func TestRecordPublishesLiveTodoEvents(t *testing.T) {
	t.Parallel()
	pub := &recordingPublisher{}
	s := &Service{}
	s.SetResourceEvents(pub)
	id := uuid.New()
	for _, action := range []string{"todos.create", "todos.update", "todos.complete", "todos.delete"} {
		s.record(context.Background(), action, id, nil)
	}
	want := []string{
		resourceevents.ActionCreated, resourceevents.ActionUpdated,
		resourceevents.ActionUpdated, resourceevents.ActionDeleted,
	}
	if len(pub.events) != len(want) {
		t.Fatalf("events = %+v", pub.events)
	}
	for i, ev := range pub.events {
		if ev.resource != resourceevents.TenantTodos || ev.action != want[i] ||
			len(ev.uuids) != 1 || ev.uuids[0] != id.String() {
			t.Errorf("event %d = %+v", i, ev)
		}
	}
	// No publisher attached: record stays silent and must not panic.
	(&Service{}).record(context.Background(), "todos.create", id, nil)
}
