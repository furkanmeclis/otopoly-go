package usecase

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// CustomerLoyalty is the customer 360 section: stamp cards, usable packages
// (active, with remaining credits) and running subscriptions (active and
// past due).
func (s *Service) CustomerLoyalty(ctx context.Context, customerUUID uuid.UUID) (CustomerLoyalty, error) {
	org, err := orgID(ctx)
	if err != nil {
		return CustomerLoyalty{}, err
	}
	cust, err := s.q.LoyaltyGetCustomer(ctx, db.LoyaltyGetCustomerParams{OrganizationID: org, Uuid: customerUUID})
	if err != nil {
		return CustomerLoyalty{}, notFound(err)
	}
	today := s.today()
	out := CustomerLoyalty{CustomerUUID: cust.Uuid}
	cards, err := s.stampCards(ctx, s.q, org, cust.ID, today)
	if err != nil {
		return CustomerLoyalty{}, err
	}
	out.Stamps = plainCards(cards)
	for _, c := range out.Stamps {
		out.RewardsAvailable += c.RewardsAvailable
	}
	pkgs, err := s.q.ListLoyaltyCustomerPackages(ctx, db.ListLoyaltyCustomerPackagesParams{
		OrganizationID: org, CustomerID: pgtype.Int8{Int64: cust.ID, Valid: true},
		State: pgtype.Text{String: "active", Valid: true}, LimitCount: 50,
	})
	if err != nil {
		return CustomerLoyalty{}, err
	}
	rows := make([]customerPackageRow, 0, len(pkgs))
	for _, p := range pkgs {
		rows = append(rows, fromListCP(p))
	}
	if out.Packages, err = s.mapCustomerPackages(ctx, org, rows); err != nil {
		return CustomerLoyalty{}, err
	}
	subs, err := s.q.ListLoyaltySubscriptions(ctx, db.ListLoyaltySubscriptionsParams{
		OrganizationID: org, CustomerID: pgtype.Int8{Int64: cust.ID, Valid: true},
		Today: pgtype.Date{Time: today, Valid: true}, LimitCount: 50,
	})
	if err != nil {
		return CustomerLoyalty{}, err
	}
	out.Subscriptions = []Subscription{}
	for _, r := range subs {
		if r.Status != "active" {
			continue
		}
		m, err := s.mapSubscription(ctx, fromListSub(r), today)
		if err != nil {
			return CustomerLoyalty{}, err
		}
		out.Subscriptions = append(out.Subscriptions, m)
	}
	return out, nil
}

// Overview returns the module counters and renewals due within horizon days
// (overdue first). horizon defaults to 7.
func (s *Service) Overview(ctx context.Context, horizon int) (Overview, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Overview{}, err
	}
	if horizon <= 0 || horizon > 60 {
		horizon = 7
	}
	today := s.today()
	active := true
	out := Overview{HorizonDays: horizon}
	if out.ActiveCampaigns, err = s.q.CountLoyaltyCampaigns(ctx, db.CountLoyaltyCampaignsParams{OrganizationID: org, IsActive: boolFilter(&active)}); err != nil {
		return Overview{}, err
	}
	if out.ActivePackages, err = s.q.CountLoyaltyPackages(ctx, db.CountLoyaltyPackagesParams{OrganizationID: org, IsActive: boolFilter(&active)}); err != nil {
		return Overview{}, err
	}
	if out.ActivePlans, err = s.q.CountLoyaltySubscriptionPlans(ctx, db.CountLoyaltySubscriptionPlansParams{OrganizationID: org, IsActive: boolFilter(&active)}); err != nil {
		return Overview{}, err
	}
	if out.CustomerPackagesActive, err = s.q.CountLoyaltyCustomerPackages(ctx, db.CountLoyaltyCustomerPackagesParams{
		OrganizationID: org, State: pgtype.Text{String: "active", Valid: true},
	}); err != nil {
		return Overview{}, err
	}
	counts, err := s.q.LoyaltyRenewalCounts(ctx, db.LoyaltyRenewalCountsParams{
		OrganizationID: org, Today: pgtype.Date{Time: today, Valid: true}, Horizon: pgtype.Date{Time: today.AddDate(0, 0, horizon), Valid: true},
	})
	if err != nil {
		return Overview{}, err
	}
	out.SubscriptionsActive, out.SubscriptionsPastDue, out.RenewalsUpcoming = counts.ActiveCount, counts.PastDueCount, counts.UpcomingCount
	out.Renewals, _, err = s.ListSubscriptions(ctx, SubscriptionFilter{DueWithinDays: &horizon, Limit: 10})
	if err != nil {
		return Overview{}, err
	}
	return out, nil
}

// CheckEnabled fails with entitlements.ErrFeatureDisabled when the
// organization's plan turns the module off (assistant / MCP tools; HTTP
// routes use RequireFeature).
func (s *Service) CheckEnabled(ctx context.Context) error {
	_, err := s.requireEnabled(ctx)
	return err
}

// CustomerRef returns the customer's uuid and name (another organization's
// customer is not found).
func (s *Service) CustomerRef(ctx context.Context, customerUUID uuid.UUID) (Ref, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Ref{}, err
	}
	c, err := s.q.LoyaltyGetCustomer(ctx, db.LoyaltyGetCustomerParams{OrganizationID: org, Uuid: customerUUID})
	if err != nil {
		return Ref{}, notFound(err)
	}
	return Ref{UUID: c.Uuid, Name: c.Name}, nil
}
