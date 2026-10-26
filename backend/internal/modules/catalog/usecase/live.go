package usecase

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
)

// SetResourceEvents attaches the live list publisher (optional). Events are
// published after a mutation succeeds; publishing is async and fail-soft.
func (s *Service) SetResourceEvents(pub resourceevents.Publisher) { s.liveEvents = pub }

// live publishes a resource-change event for open lists (nil-safe).
func (s *Service) live(ctx context.Context, resource, action string, uuids ...string) {
	resourceevents.Emit(ctx, s.liveEvents, resource, action, uuids...)
}
