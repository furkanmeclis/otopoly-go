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

// collectLive appends id for the job's live event, keeping one id past
// MaxUUIDs so the broadcaster marks the event truncated.
func collectLive(ids []string, id string) []string {
	if id == "" || len(ids) > resourceevents.MaxUUIDs {
		return ids
	}
	return append(ids, id)
}

// liveBulk publishes one "bulk" event for a finished job on a tenant
// resource. Platform resources have no live channels in Otopoly.
func (s *Service) liveBulk(ctx context.Context, resource string, ids []string) {
	if len(ids) == 0 || !resourceevents.IsTenantResource(resource) {
		return
	}
	s.live(ctx, resource, resourceevents.ActionBulk, ids...)
}
