package usecase

import (
	"context"

	"github.com/google/uuid"
)

// Live list resources of the platform vehicle catalog screens. Otopoly has no
// realtime list channels yet; the publisher stays optional (nil = no-op) so
// the catalog service matches the Rentopia engine one to one.
const (
	LiveBrands  = "platform.vehicle_catalog.brands"
	LiveModels  = "platform.vehicle_catalog.models"
	LiveTypes   = "platform.vehicle_catalog.types"
	LiveImports = "platform.vehicle_catalog.imports"
)

// Live list actions.
const (
	ActionCreated = "created"
	ActionUpdated = "updated"
	ActionBulk    = "bulk"
	ActionDeleted = "deleted"
)

// Publisher receives list change events (optional).
type Publisher interface {
	Publish(ctx context.Context, resource, action string, uuids ...string)
}

// SetResourceEvents attaches the live list publisher (optional).
func (s *Service) SetResourceEvents(pub Publisher) {
	s.events = pub
}

func (s *Service) publish(ctx context.Context, resource, action string, ids ...uuid.UUID) {
	if s.events == nil {
		return
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, id.String())
	}
	s.events.Publish(ctx, resource, action, out...)
}

// publishCatalogApplied tells the brand / model / type lists that an import
// apply may have changed any of their rows.
func (s *Service) publishCatalogApplied(ctx context.Context) {
	for _, resource := range []string{LiveBrands, LiveModels, LiveTypes} {
		s.publish(ctx, resource, ActionBulk)
	}
}
