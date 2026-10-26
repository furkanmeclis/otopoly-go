package usecase

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
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

// liveJobScope returns ctx carrying the organization of a tenant bulk job
// for the live event only (tenant handlers stamp organization_uuid into the
// target query). Without one the channel resolver drops the event.
func liveJobScope(ctx context.Context, target bulkengine.BulkTarget) context.Context {
	if _, ok := orgctx.ScopeFrom(ctx); ok {
		return ctx
	}
	id, err := uuid.Parse(target.Query["organization_uuid"])
	if err != nil || id == uuid.Nil {
		return ctx
	}
	return orgctx.WithScope(ctx, orgctx.Scope{UUID: id})
}
