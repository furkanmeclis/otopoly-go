package usecase

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// organizationRecentLimit caps the invoice/order summaries on the platform
// organization detail; the full lists live on the billing screens.
const organizationRecentLimit = 5

// OrganizationBilling is the billing part of the platform organization
// overview: live subscription, plan, usage vs limits and recent documents.
type OrganizationBilling struct {
	Overview
	RecentInvoices []Invoice `json:"recent_invoices"`
	RecentOrders   []Order   `json:"recent_orders"`
}

// OrganizationBilling returns the billing summary for one organization.
func (s *Service) OrganizationBilling(ctx context.Context, orgID int64) (OrganizationBilling, error) {
	overview, err := s.OverviewForOrganization(ctx, orgID)
	if err != nil {
		return OrganizationBilling{}, err
	}
	out := OrganizationBilling{Overview: overview, RecentInvoices: []Invoice{}, RecentOrders: []Order{}}
	invoiceRows, err := s.q.ListInvoicesForOrgAdmin(ctx, orgID)
	if err != nil {
		return OrganizationBilling{}, err
	}
	for i, row := range invoiceRows {
		if i == organizationRecentLimit {
			break
		}
		out.RecentInvoices = append(out.RecentInvoices, invoiceFromOrgAdminRow(row))
	}
	orderRows, err := s.q.ListOrdersForOrgAdmin(ctx, orgID)
	if err != nil {
		return OrganizationBilling{}, err
	}
	for i, row := range orderRows {
		if i == organizationRecentLimit {
			break
		}
		order, err := s.orderFromOrgAdminRow(ctx, row)
		if err != nil {
			return OrganizationBilling{}, err
		}
		out.RecentOrders = append(out.RecentOrders, order)
	}
	return out, nil
}

// ExtendLiveSubscription pushes the organization's live subscription end
// (and the mirrored organization access window) forward by days, counted
// from max(now, current end). ok is false when there is no live
// subscription.
func (s *Service) ExtendLiveSubscription(ctx context.Context, orgID int64, days int, note string) (time.Time, bool, error) {
	if days <= 0 {
		return time.Time{}, false, fmt.Errorf("%w: days must be positive", ErrInvalidRequest)
	}
	sub, err := s.q.GetLiveSubscription(ctx, orgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, false, nil
		}
		return time.Time{}, false, err
	}
	base := timeNow().UTC()
	if sub.EndsAt.Valid && sub.EndsAt.Time.After(base) {
		base = sub.EndsAt.Time
	}
	endsAt := base.AddDate(0, 0, days)
	updated, err := s.UpdateSubscriptionAdmin(ctx, sub.Uuid, AdminSubscriptionPatch{EndsAt: &endsAt, Note: note})
	if err != nil {
		return time.Time{}, false, err
	}
	return updated.EndsAt, true, nil
}
