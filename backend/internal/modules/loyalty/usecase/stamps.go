package usecase

import (
	"context"
	"sort"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// card is a computed stamp card plus its campaign row.
type card struct {
	StampCard
	campaign db.LoyaltyCampaign
}

// rewardsAvailable is how many rewards a balance pays for, capped by the
// per-customer limit (net redemptions count against it).
func rewardsAvailable(balance int64, required int32, limit pgtype.Int4, redeemed int64) (int64, bool) {
	if required <= 0 || balance <= 0 {
		return 0, limit.Valid && redeemed >= int64(limit.Int32)
	}
	n := balance / int64(required)
	if limit.Valid {
		left := int64(limit.Int32) - redeemed
		if left <= 0 {
			return 0, true
		}
		if n > left {
			n = left
		}
	}
	return n, false
}

// stampCards computes a customer's cards: every campaign running today
// plus older campaigns where the customer still holds stamps.
func (s *Service) stampCards(ctx context.Context, q *db.Queries, org, customerID int64, today time.Time) ([]card, error) {
	active, err := q.ListActiveLoyaltyCampaigns(ctx, db.ListActiveLoyaltyCampaignsParams{OrganizationID: org, OnDay: pgtype.Date{Time: today, Valid: true}})
	if err != nil {
		return nil, err
	}
	balances, err := q.LoyaltyStampBalances(ctx, db.LoyaltyStampBalancesParams{OrganizationID: org, CustomerID: customerID})
	if err != nil {
		return nil, err
	}
	byCampaign := map[int64]db.LoyaltyStampBalancesRow{}
	for _, b := range balances {
		byCampaign[b.CampaignID] = b
	}
	rows := map[int64]db.LoyaltyCampaign{}
	running := map[int64]bool{}
	for _, c := range active {
		rows[c.ID] = c
		running[c.ID] = true
	}
	for id, b := range byCampaign {
		if _, ok := rows[id]; ok || b.Balance <= 0 {
			continue
		}
		c, err := q.GetLoyaltyCampaignByID(ctx, db.GetLoyaltyCampaignByIDParams{ID: id, OrganizationID: org})
		if err != nil {
			if notFound(err) == ErrNotFound {
				continue
			}
			return nil, err
		}
		if c.DeletedAt.Valid {
			continue
		}
		rows[id] = c
	}
	ids := make([]int64, 0, len(rows))
	list := make([]db.LoyaltyCampaign, 0, len(rows))
	for id, c := range rows {
		ids = append(ids, id)
		list = append(list, c)
	}
	sids, cids := campaignRefIDs(list)
	r, err := s.loadRefs(ctx, org, sids, cids)
	if err != nil {
		return nil, err
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	out := make([]card, 0, len(ids))
	for _, id := range ids {
		c := rows[id]
		b := byCampaign[id]
		avail, limited := rewardsAvailable(b.Balance, c.StampsRequired, c.PerCustomerLimit, b.Redeemed)
		if !running[id] {
			avail = 0
		}
		progress := int64(0)
		if c.StampsRequired > 0 && b.Balance > 0 {
			progress = b.Balance % int64(c.StampsRequired)
		}
		sc := StampCard{
			CampaignUUID: c.Uuid, CampaignName: c.Name, StampsRequired: c.StampsRequired, Stamps: progress, Balance: b.Balance,
			RewardsAvailable: avail, RewardsRedeemed: b.Redeemed, RewardType: c.RewardType, RewardValue: numMoney(c.RewardValue),
			Active: running[id], LimitReached: limited,
		}
		if c.RewardServiceID.Valid {
			if svc, ok := r.services[c.RewardServiceID.Int64]; ok {
				sc.RewardService = &Ref{UUID: svc.Uuid, Name: svc.Name}
			}
		}
		out = append(out, card{StampCard: sc, campaign: c})
	}
	return out, nil
}

func plainCards(cards []card) []StampCard {
	out := make([]StampCard, 0, len(cards))
	for _, c := range cards {
		out = append(out, c.StampCard)
	}
	return out
}
