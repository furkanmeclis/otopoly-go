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

// liveMoney tells finance and cari lists that a payment, charge or reversal
// may have touched them (exact rows are not tracked across modules).
func (s *Service) liveMoney(ctx context.Context) {
	s.live(ctx, resourceevents.TenantFinanceTransactions, resourceevents.ActionBulk)
	s.live(ctx, resourceevents.TenantFinanceAccounts, resourceevents.ActionBulk)
	s.live(ctx, resourceevents.TenantCari, resourceevents.ActionBulk)
	s.live(ctx, resourceevents.TenantCariEntries, resourceevents.ActionBulk)
	s.live(ctx, resourceevents.TenantCatalogProducts, resourceevents.ActionBulk)
}
