package usecase

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
)

// SetResourceEvents attaches the live publisher (optional). Calendar event
// changes are announced on tenant.calendar after the write succeeds;
// publishing is async and fail-soft.
func (s *Service) SetResourceEvents(pub resourceevents.Publisher) { s.liveEvents = pub }

// live publishes a tenant.calendar change for one event (nil-safe).
func (s *Service) live(ctx context.Context, action string, id uuid.UUID) {
	resourceevents.Emit(ctx, s.liveEvents, resourceevents.TenantCalendar, action, id.String())
}
