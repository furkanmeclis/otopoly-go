package usecase

import (
	"context"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
)

// SetResourceEvents attaches the live list publisher (optional). Events are
// published after a mutation succeeds; publishing is async and fail-soft.
func (s *Service) SetResourceEvents(pub resourceevents.Publisher) { s.liveEvents = pub }

// live publishes a resource-change event for open lists (nil-safe).
func (s *Service) live(ctx context.Context, resource, action string, uuids ...string) {
	resourceevents.Emit(ctx, s.liveEvents, resource, action, uuids...)
}

// liveAction maps an activity action ("….create", "….delete", …) to the
// resource-change action of the live list event.
func liveAction(activityAction string) string {
	switch {
	case strings.HasSuffix(activityAction, ".create"):
		return resourceevents.ActionCreated
	case strings.HasSuffix(activityAction, ".delete"):
		return resourceevents.ActionDeleted
	default:
		return resourceevents.ActionUpdated
	}
}
