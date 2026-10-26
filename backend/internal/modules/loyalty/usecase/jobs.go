package usecase

import (
	"context"
	"errors"
	"math/big"
	"sort"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type jobRow struct {
	id, customerID, vehicleID int64
	uuid, customerUUID        uuid.UUID
	status, paymentStatus     string
	deliveredAt, paidAt       pgtype.Timestamptz
	plate                     string
}

func jobFromUUID(r db.LoyaltyGetJobRow) jobRow {
	return jobRow{id: r.ID, customerID: r.CustomerID, vehicleID: r.VehicleID, uuid: r.Uuid, customerUUID: r.CustomerUuid,
		status: r.Status, paymentStatus: r.PaymentStatus, deliveredAt: r.DeliveredAt, paidAt: r.PaidAt, plate: r.Plate}
}

func jobFromID(r db.LoyaltyGetJobByIDRow) jobRow {
	return jobRow{id: r.ID, customerID: r.CustomerID, vehicleID: r.VehicleID, uuid: r.Uuid, customerUUID: r.CustomerUuid,
		status: r.Status, paymentStatus: r.PaymentStatus, deliveredAt: r.DeliveredAt, paidAt: r.PaidAt, plate: r.Plate}
}

// editable: loyalty can change while the job is open and unpaid.
func (j jobRow) editable() bool {
	if j.paymentStatus != "unpaid" {
		return false
	}
	switch j.status {
	case "in_progress", "ready", "delivered":
		return true
	}
	return false
}

// lineGross is unit_price * qty rounded to cents.
func lineGross(l db.LoyaltyJobLinesRow) *big.Rat {
	return round2(new(big.Rat).Mul(ratOf(l.UnitPrice), ratOf(l.Qty)))
}

// coverable: a service line nothing covers yet, with money left on it.
func coverable(l db.LoyaltyJobLinesRow) bool {
	return l.LineType == "service" && l.ServiceID.Valid && !l.DiscountSource.Valid && ratOf(l.LineTotal).Sign() > 0
}

// options lists what loyalty can cover on the job's lines right now.
func (s *Service) options(ctx context.Context, q *db.Queries, org int64, job jobRow, lines []db.LoyaltyJobLinesRow, cards []card, today time.Time) ([]Option, error) {
	var out []Option
	open := make([]db.LoyaltyJobLinesRow, 0, len(lines))
	for _, l := range lines {
		if coverable(l) {
			open = append(open, l)
		}
	}
	if len(open) == 0 {
		return []Option{}, nil
	}
	// Stamp rewards.
	for _, c := range cards {
		if c.RewardsAvailable <= 0 || !c.Active {
			continue
		}
		for _, l := range open {
			gross := lineGross(l)
			var discount *big.Rat
			switch c.campaign.RewardType {
			case RewardFreeService:
				if !c.campaign.RewardServiceID.Valid || c.campaign.RewardServiceID.Int64 != l.ServiceID.Int64 {
					continue
				}
				discount = minRat(round2(ratOf(l.UnitPrice)), gross)
			case RewardPercent:
				if !eligible(c.campaign.ServiceIds, c.campaign.CategoryIds, l.ServiceID, l.CategoryID) {
					continue
				}
				discount = round2(new(big.Rat).Quo(new(big.Rat).Mul(gross, ratOf(c.campaign.RewardValue)), big.NewRat(100, 1)))
			case RewardFixed:
				if !eligible(c.campaign.ServiceIds, c.campaign.CategoryIds, l.ServiceID, l.CategoryID) {
					continue
				}
				discount = minRat(ratOf(c.campaign.RewardValue), gross)
			default:
				continue
			}
			if discount.Sign() <= 0 {
				continue
			}
			out = append(out, Option{
				Kind: KindReward, SourceUUID: c.campaign.Uuid, SourceName: c.campaign.Name, LineUUID: l.Uuid, LineName: l.Name,
				Units: 1, DiscountAmount: money(discount),
			})
		}
	}
	// Package credits.
	credits, err := q.ListUsableLoyaltyCredits(ctx, db.ListUsableLoyaltyCreditsParams{OrganizationID: org, CustomerID: job.customerID})
	if err != nil {
		return nil, err
	}
	for _, cr := range credits {
		for _, l := range open {
			if cr.ServiceID != l.ServiceID.Int64 {
				continue
			}
			units := wholeUnits(l.Qty)
			left := int64(cr.Total - cr.Used)
			if units > left {
				units = left
			}
			if units <= 0 {
				continue
			}
			discount := minRat(round2(new(big.Rat).Mul(ratOf(l.UnitPrice), big.NewRat(units, 1))), lineGross(l))
			remaining := left - units
			out = append(out, Option{
				Kind: KindPackage, SourceUUID: cr.CustomerPackageUuid, SourceName: cr.PackageName, LineUUID: l.Uuid, LineName: l.Name,
				Units: int32(units), DiscountAmount: money(discount), Remaining: &remaining,
			})
		}
	}
	// Subscription uses.
	subs, err := q.ListUsableLoyaltySubscriptions(ctx, db.ListUsableLoyaltySubscriptionsParams{
		OrganizationID: org, CustomerID: job.customerID, Today: pgtype.Date{Time: today, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	for _, sub := range subs {
		if sub.VehicleID.Valid && sub.VehicleID.Int64 != job.vehicleID {
			continue
		}
		if !sub.PlanID.Valid {
			continue
		}
		plan, err := q.GetLoyaltySubscriptionPlanByID(ctx, db.GetLoyaltySubscriptionPlanByIDParams{ID: sub.PlanID.Int64, OrganizationID: org})
		if err != nil {
			if notFound(err) == ErrNotFound {
				continue
			}
			return nil, err
		}
		period, _, err := s.currentPeriod(ctx, q, sub, today)
		if err != nil {
			return nil, err
		}
		if period == nil {
			continue
		}
		for _, l := range open {
			if !eligible(plan.ServiceIds, plan.CategoryIds, l.ServiceID, l.CategoryID) {
				continue
			}
			units := wholeUnits(l.Qty)
			var remaining *int64
			if period.Remaining != nil {
				if units > *period.Remaining {
					units = *period.Remaining
				}
				left := *period.Remaining - units
				remaining = &left
			}
			if units <= 0 {
				continue
			}
			discount := minRat(round2(new(big.Rat).Mul(ratOf(l.UnitPrice), big.NewRat(units, 1))), lineGross(l))
			out = append(out, Option{
				Kind: KindSubscription, SourceUUID: sub.Uuid, SourceName: sub.Name, LineUUID: l.Uuid, LineName: l.Name,
				Units: int32(units), DiscountAmount: money(discount), Remaining: remaining,
			})
		}
	}
	// Biggest saving first; subscriptions and packages before rewards on a tie.
	rank := map[string]int{KindSubscription: 0, KindPackage: 1, KindReward: 2}
	sort.SliceStable(out, func(i, j int) bool {
		a, _ := parseMoney(out[i].DiscountAmount)
		b, _ := parseMoney(out[j].DiscountAmount)
		if c := a.Cmp(b); c != 0 {
			return c > 0
		}
		return rank[out[i].Kind] < rank[out[j].Kind]
	})
	if out == nil {
		out = []Option{}
	}
	return out, nil
}

func mapApplications(rows []db.ListLoyaltyApplicationsByJobRow) []Application {
	out := make([]Application, 0, len(rows))
	for _, r := range rows {
		a := Application{
			UUID: r.Uuid, Kind: r.Kind, SourceName: r.SourceName, LineUUID: r.LineUuid, LineName: r.LineName, Units: r.Units,
			DiscountAmount: numMoney(r.DiscountAmount), Status: r.Status, CreatedAt: r.CreatedAt.Time,
		}
		var src pgtype.UUID
		switch r.Kind {
		case KindReward:
			src = r.CampaignUuid
		case KindPackage:
			src = r.CustomerPackageUuid
		case KindSubscription:
			src = r.SubscriptionUuid
		}
		if src.Valid {
			id := uuid.UUID(src.Bytes)
			a.SourceUUID = &id
		}
		out = append(out, a)
	}
	return out
}

func (s *Service) jobView(ctx context.Context, q *db.Queries, org int64, job jobRow) (JobLoyalty, error) {
	today := s.today()
	out := JobLoyalty{JobUUID: job.uuid, CustomerUUID: job.customerUUID, Editable: job.editable(), Options: []Option{}, StampsEarned: []Ref{}}
	apps, err := q.ListLoyaltyApplicationsByJob(ctx, db.ListLoyaltyApplicationsByJobParams{OrganizationID: org, JobID: job.id})
	if err != nil {
		return out, err
	}
	out.Applied = mapApplications(apps)
	cards, err := s.stampCards(ctx, q, org, job.customerID, today)
	if err != nil {
		return out, err
	}
	out.Stamps = plainCards(cards)
	if out.Editable {
		lines, err := q.LoyaltyJobLines(ctx, db.LoyaltyJobLinesParams{OrganizationID: org, JobID: job.id})
		if err != nil {
			return out, err
		}
		if out.Options, err = s.options(ctx, q, org, job, lines, cards, today); err != nil {
			return out, err
		}
	}
	events, err := q.ListLoyaltyStampEventsByJob(ctx, db.ListLoyaltyStampEventsByJobParams{OrganizationID: org, JobID: pgtype.Int8{Int64: job.id, Valid: true}})
	if err != nil {
		return out, err
	}
	net := map[int64]int32{}
	for _, e := range events {
		if e.Kind == "earn" || e.Kind == "reverse_earn" {
			net[e.CampaignID] += e.Stamps
		}
	}
	for id, n := range net {
		if n <= 0 {
			continue
		}
		if c, err := q.GetLoyaltyCampaignByID(ctx, db.GetLoyaltyCampaignByIDParams{ID: id, OrganizationID: org}); err == nil {
			out.StampsEarned = append(out.StampsEarned, Ref{UUID: c.Uuid, Name: c.Name})
		}
	}
	return out, nil
}

// JobLoyalty returns the job's loyalty section: what is applied, what can
// be applied and the customer's stamp cards.
func (s *Service) JobLoyalty(ctx context.Context, jobUUID uuid.UUID) (JobLoyalty, error) {
	org, err := orgID(ctx)
	if err != nil {
		return JobLoyalty{}, err
	}
	row, err := s.q.LoyaltyGetJob(ctx, db.LoyaltyGetJobParams{Uuid: jobUUID, OrganizationID: org})
	if err != nil {
		return JobLoyalty{}, notFound(err)
	}
	return s.jobView(ctx, s.q, org, jobFromUUID(row))
}

// Apply covers a job line with a stamp reward, package credits or a
// subscription use. The line keeps its price; the covered amount becomes
// its discount and the job total drops accordingly.
func (s *Service) Apply(ctx context.Context, jobUUID uuid.UUID, in ApplyInput) (JobLoyalty, error) {
	org, err := orgID(ctx)
	if err != nil {
		return JobLoyalty{}, err
	}
	switch in.Kind {
	case KindReward, KindPackage, KindSubscription:
	default:
		return JobLoyalty{}, invalid("kind must be reward, package or subscription")
	}
	if in.SourceUUID == uuid.Nil || in.LineUUID == uuid.Nil {
		return JobLoyalty{}, invalid("source_uuid and line_uuid are required")
	}
	row, err := s.q.LoyaltyGetJob(ctx, db.LoyaltyGetJobParams{Uuid: jobUUID, OrganizationID: org})
	if err != nil {
		return JobLoyalty{}, notFound(err)
	}
	job := jobFromUUID(row)
	var applied db.LoyaltyApplication
	err = s.inTx(ctx, func(q *db.Queries) error {
		if err := q.LoyaltyLockCustomer(ctx, db.LoyaltyLockCustomerParams{OrganizationID: org, CustomerID: job.customerID}); err != nil {
			return err
		}
		fresh, err := q.LoyaltyGetJobByID(ctx, db.LoyaltyGetJobByIDParams{ID: job.id, OrganizationID: org})
		if err != nil {
			return notFound(err)
		}
		job = jobFromID(fresh)
		if !job.editable() {
			return conflict("loyalty can only change on an open, unpaid job")
		}
		today := s.today()
		lines, err := q.LoyaltyJobLines(ctx, db.LoyaltyJobLinesParams{OrganizationID: org, JobID: job.id})
		if err != nil {
			return err
		}
		var line *db.LoyaltyJobLinesRow
		for i := range lines {
			if lines[i].Uuid == in.LineUUID {
				line = &lines[i]
			}
		}
		if line == nil {
			return invalid("line not found on this job")
		}
		if line.DiscountSource.Valid {
			return conflict("this line is already covered; revert it first")
		}
		cards, err := s.stampCards(ctx, q, org, job.customerID, today)
		if err != nil {
			return err
		}
		opts, err := s.options(ctx, q, org, job, lines, cards, today)
		if err != nil {
			return err
		}
		var opt *Option
		for i := range opts {
			o := opts[i]
			if o.Kind == in.Kind && o.SourceUUID == in.SourceUUID && o.LineUUID == in.LineUUID {
				opt = &o
				break
			}
		}
		if opt == nil {
			return notApplicable("this %s does not cover that line (or nothing is left)", in.Kind)
		}
		discount, _ := parseMoney(opt.DiscountAmount)
		params := db.CreateLoyaltyApplicationParams{
			OrganizationID: org, JobID: job.id, JobLineID: line.ID, CustomerID: job.customerID, Kind: in.Kind,
			SourceName: opt.SourceName, Units: opt.Units, DiscountAmount: numeric(discount), CreatedBy: optActor(ctx),
		}
		switch in.Kind {
		case KindReward:
			var c *card
			for i := range cards {
				if cards[i].campaign.Uuid == in.SourceUUID {
					c = &cards[i]
				}
			}
			if c == nil {
				return notApplicable("campaign not found")
			}
			params.CampaignID = pgtype.Int8{Int64: c.campaign.ID, Valid: true}
			params.Units = c.campaign.StampsRequired
			if _, err := q.InsertLoyaltyStampEvent(ctx, db.InsertLoyaltyStampEventParams{
				OrganizationID: org, CampaignID: c.campaign.ID, CustomerID: job.customerID,
				JobID: pgtype.Int8{Int64: job.id, Valid: true}, Kind: "redeem", Stamps: -c.campaign.StampsRequired, CreatedBy: optActor(ctx),
			}); err != nil {
				return err
			}
		case KindPackage:
			credits, err := q.ListUsableLoyaltyCredits(ctx, db.ListUsableLoyaltyCreditsParams{OrganizationID: org, CustomerID: job.customerID})
			if err != nil {
				return err
			}
			var credit *db.ListUsableLoyaltyCreditsRow
			for i := range credits {
				if credits[i].CustomerPackageUuid == in.SourceUUID && credits[i].ServiceID == line.ServiceID.Int64 {
					credit = &credits[i]
					break
				}
			}
			if credit == nil {
				return notApplicable("no credit left")
			}
			if _, err := q.UseLoyaltyCredit(ctx, db.UseLoyaltyCreditParams{ID: credit.CreditID, OrganizationID: org, Units: opt.Units}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return notApplicable("no credit left")
				}
				return err
			}
			params.CustomerPackageID = pgtype.Int8{Int64: credit.CustomerPackageID, Valid: true}
			params.CreditID = pgtype.Int8{Int64: credit.CreditID, Valid: true}
		case KindSubscription:
			sub, err := q.GetLoyaltySubscription(ctx, db.GetLoyaltySubscriptionParams{Uuid: in.SourceUUID, OrganizationID: org})
			if err != nil {
				return notFound(err)
			}
			k := periodIndex(sub.StartDate.Time, int(sub.PeriodMonths), today)
			from, _ := periodBounds(sub.StartDate.Time, int(sub.PeriodMonths), k)
			params.SubscriptionID = pgtype.Int8{Int64: sub.ID, Valid: true}
			params.PeriodStart = pgtype.Date{Time: from, Valid: true}
		}
		if applied, err = q.CreateLoyaltyApplication(ctx, params); err != nil {
			return err
		}
		if err := q.LoyaltySetLineDiscount(ctx, db.LoyaltySetLineDiscountParams{
			ID: line.ID, OrganizationID: org, DiscountAmount: numeric(discount), DiscountSource: pgtype.Text{String: in.Kind, Valid: true},
		}); err != nil {
			return err
		}
		_, err = q.LoyaltyRecalcJobTotal(ctx, db.LoyaltyRecalcJobTotalParams{ID: job.id, OrganizationID: org})
		return err
	})
	if err != nil {
		return JobLoyalty{}, err
	}
	s.record(ctx, "loyalty.apply", "jobs.job", job.uuid, map[string]any{
		"kind": applied.Kind, "source": applied.SourceName, "amount": numMoney(applied.DiscountAmount), "plate": job.plate,
	})
	s.afterJobChange(ctx, job, applied.Kind, in.SourceUUID)
	return s.jobView(ctx, s.q, org, job)
}

// Revert takes an application back: the line is charged again and the
// credits / use / stamps return to the customer.
func (s *Service) Revert(ctx context.Context, jobUUID, applicationUUID uuid.UUID) (JobLoyalty, error) {
	org, err := orgID(ctx)
	if err != nil {
		return JobLoyalty{}, err
	}
	row, err := s.q.LoyaltyGetJob(ctx, db.LoyaltyGetJobParams{Uuid: jobUUID, OrganizationID: org})
	if err != nil {
		return JobLoyalty{}, notFound(err)
	}
	job := jobFromUUID(row)
	app, err := s.q.GetLoyaltyApplication(ctx, db.GetLoyaltyApplicationParams{Uuid: applicationUUID, OrganizationID: org})
	if err != nil {
		return JobLoyalty{}, notFound(err)
	}
	if app.JobID != job.id {
		return JobLoyalty{}, ErrNotFound
	}
	if app.Status != "applied" {
		return JobLoyalty{}, conflict("already reverted")
	}
	var sourceUUID uuid.UUID
	err = s.inTx(ctx, func(q *db.Queries) error {
		if err := q.LoyaltyLockCustomer(ctx, db.LoyaltyLockCustomerParams{OrganizationID: org, CustomerID: job.customerID}); err != nil {
			return err
		}
		fresh, err := q.LoyaltyGetJobByID(ctx, db.LoyaltyGetJobByIDParams{ID: job.id, OrganizationID: org})
		if err != nil {
			return notFound(err)
		}
		job = jobFromID(fresh)
		if !job.editable() {
			return conflict("loyalty can only change on an open, unpaid job")
		}
		if sourceUUID, err = s.revertTx(ctx, q, org, app, true); err != nil {
			return err
		}
		_, err = q.LoyaltyRecalcJobTotal(ctx, db.LoyaltyRecalcJobTotalParams{ID: job.id, OrganizationID: org})
		return err
	})
	if err != nil {
		return JobLoyalty{}, err
	}
	s.record(ctx, "loyalty.revert", "jobs.job", job.uuid, map[string]any{
		"kind": app.Kind, "source": app.SourceName, "amount": numMoney(app.DiscountAmount), "plate": job.plate,
	})
	s.afterJobChange(ctx, job, app.Kind, sourceUUID)
	return s.jobView(ctx, s.q, org, job)
}

// revertTx reverts one application inside a transaction (the customer is
// locked by the caller). restoreLine clears the line discount. It returns
// the source uuid (campaign / customer package / subscription).
func (s *Service) revertTx(ctx context.Context, q *db.Queries, org int64, app db.LoyaltyApplication, restoreLine bool) (uuid.UUID, error) {
	if _, err := q.RevertLoyaltyApplication(ctx, db.RevertLoyaltyApplicationParams{ID: app.ID, OrganizationID: org, RevertedBy: optActor(ctx)}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, conflict("already reverted")
		}
		return uuid.Nil, err
	}
	var source uuid.UUID
	switch app.Kind {
	case KindReward:
		if app.CampaignID.Valid {
			if _, err := q.InsertLoyaltyStampEvent(ctx, db.InsertLoyaltyStampEventParams{
				OrganizationID: org, CampaignID: app.CampaignID.Int64, CustomerID: app.CustomerID,
				JobID: pgtype.Int8{Int64: app.JobID, Valid: true}, Kind: "unredeem", Stamps: app.Units, CreatedBy: optActor(ctx),
			}); err != nil {
				return uuid.Nil, err
			}
			if c, err := q.GetLoyaltyCampaignByID(ctx, db.GetLoyaltyCampaignByIDParams{ID: app.CampaignID.Int64, OrganizationID: org}); err == nil {
				source = c.Uuid
			}
		}
	case KindPackage:
		if app.CreditID.Valid {
			if err := q.ReturnLoyaltyCredit(ctx, db.ReturnLoyaltyCreditParams{ID: app.CreditID.Int64, OrganizationID: org, Units: app.Units}); err != nil {
				return uuid.Nil, err
			}
		}
	case KindSubscription:
		// Uses are counted from applied rows: nothing else to give back.
	}
	if restoreLine {
		if err := q.LoyaltySetLineDiscount(ctx, db.LoyaltySetLineDiscountParams{
			ID: app.JobLineID, OrganizationID: org, DiscountAmount: numeric(new(big.Rat)), DiscountSource: pgtype.Text{},
		}); err != nil {
			return uuid.Nil, err
		}
	}
	return source, nil
}

// afterJobChange publishes live updates of a job's loyalty change.
func (s *Service) afterJobChange(ctx context.Context, job jobRow, kind string, source uuid.UUID) {
	s.emit(ctx, resourceevents.TenantJobs, resourceevents.ActionUpdated, job.uuid.String())
	s.liveCustomer(ctx, job.customerUUID)
	switch kind {
	case KindPackage:
		s.emit(ctx, resourceevents.TenantLoyaltyPackages, resourceevents.ActionUpdated, source.String())
	case KindSubscription:
		s.emit(ctx, resourceevents.TenantLoyaltySubscriptions, resourceevents.ActionUpdated, source.String())
	}
}

// ------------------------------------------------------------ job hooks

// JobSettled earns stamps for a job that is delivered and paid: one stamp
// per running campaign with an eligible line that was charged (lines a
// reward / package / subscription fully covered do not count). Idempotent
// per (campaign, job); fail-soft.
func (s *Service) JobSettled(ctx context.Context, org, jobID int64) {
	if err := s.jobSettled(ctx, org, jobID); err != nil {
		s.log.Warn("loyalty_stamp_earn_failed", "org_id", org, "job_id", jobID, "error", err)
	}
}

func (s *Service) jobSettled(ctx context.Context, org, jobID int64) error {
	on, err := s.enabled(ctx, org)
	if err != nil || !on {
		return err
	}
	var job jobRow
	earned := 0
	err = s.inTx(ctx, func(q *db.Queries) error {
		row, err := q.LoyaltyGetJobByID(ctx, db.LoyaltyGetJobByIDParams{ID: jobID, OrganizationID: org})
		if err != nil {
			return notFound(err)
		}
		job = jobFromID(row)
		if job.status != "delivered" || job.paymentStatus != "paid" {
			return nil
		}
		if err := q.LoyaltyLockCustomer(ctx, db.LoyaltyLockCustomerParams{OrganizationID: org, CustomerID: job.customerID}); err != nil {
			return err
		}
		settled := job.paidAt.Time
		if job.deliveredAt.Valid && job.deliveredAt.Time.After(settled) {
			settled = job.deliveredAt.Time
		}
		day := dayOf(settled, s.loc)
		campaigns, err := q.ListActiveLoyaltyCampaigns(ctx, db.ListActiveLoyaltyCampaignsParams{OrganizationID: org, OnDay: pgtype.Date{Time: day, Valid: true}})
		if err != nil || len(campaigns) == 0 {
			return err
		}
		lines, err := q.LoyaltyJobLines(ctx, db.LoyaltyJobLinesParams{OrganizationID: org, JobID: job.id})
		if err != nil {
			return err
		}
		balances, err := q.LoyaltyStampBalances(ctx, db.LoyaltyStampBalancesParams{OrganizationID: org, CustomerID: job.customerID})
		if err != nil {
			return err
		}
		byCampaign := map[int64]db.LoyaltyStampBalancesRow{}
		for _, b := range balances {
			byCampaign[b.CampaignID] = b
		}
		for _, c := range campaigns {
			hit := false
			for _, l := range lines {
				if l.LineType == "service" && ratOf(l.LineTotal).Sign() > 0 && eligible(c.ServiceIds, c.CategoryIds, l.ServiceID, l.CategoryID) {
					hit = true
					break
				}
			}
			if !hit {
				continue
			}
			if c.PerCustomerLimit.Valid {
				b := byCampaign[c.ID]
				pending := int64(0)
				if c.StampsRequired > 0 && b.Balance > 0 {
					pending = b.Balance / int64(c.StampsRequired)
				}
				if b.Redeemed+pending >= int64(c.PerCustomerLimit.Int32) {
					continue // the customer already holds every reward the limit allows
				}
			}
			if _, err := q.InsertLoyaltyStampEvent(ctx, db.InsertLoyaltyStampEventParams{
				OrganizationID: org, CampaignID: c.ID, CustomerID: job.customerID, JobID: pgtype.Int8{Int64: job.id, Valid: true},
				Kind: "earn", Stamps: 1,
			}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					continue // already earned for this job
				}
				return err
			}
			earned++
		}
		return nil
	})
	if err != nil {
		return err
	}
	if earned > 0 {
		s.liveCustomer(ctx, job.customerUUID)
	}
	return nil
}

// JobReversedTx runs inside a job cancel / void: applications are reverted
// (credits, uses and redeemed stamps go back; line prices stay as they
// were on the cancelled document) and stamps the job earned are reversed.
func (s *Service) JobReversedTx(ctx context.Context, q *db.Queries, org, jobID, _ int64) error {
	row, err := q.LoyaltyGetJobByID(ctx, db.LoyaltyGetJobByIDParams{ID: jobID, OrganizationID: org})
	if err != nil {
		return notFound(err)
	}
	if err := q.LoyaltyLockCustomer(ctx, db.LoyaltyLockCustomerParams{OrganizationID: org, CustomerID: row.CustomerID}); err != nil {
		return err
	}
	apps, err := q.ListLoyaltyApplicationsByJob(ctx, db.ListLoyaltyApplicationsByJobParams{OrganizationID: org, JobID: jobID})
	if err != nil {
		return err
	}
	for _, a := range apps {
		if a.Status != "applied" {
			continue
		}
		if _, err := s.revertTx(ctx, q, org, db.LoyaltyApplication{
			ID: a.ID, JobID: a.JobID, JobLineID: a.JobLineID, CustomerID: a.CustomerID, Kind: a.Kind,
			CampaignID: a.CampaignID, CreditID: a.CreditID, Units: a.Units,
		}, false); err != nil {
			return err
		}
	}
	events, err := q.ListLoyaltyStampEventsByJob(ctx, db.ListLoyaltyStampEventsByJobParams{OrganizationID: org, JobID: pgtype.Int8{Int64: jobID, Valid: true}})
	if err != nil {
		return err
	}
	for _, e := range events {
		if e.Kind != "earn" {
			continue
		}
		if _, err := q.InsertLoyaltyStampEvent(ctx, db.InsertLoyaltyStampEventParams{
			OrganizationID: org, CampaignID: e.CampaignID, CustomerID: e.CustomerID, JobID: pgtype.Int8{Int64: jobID, Valid: true},
			Kind: "reverse_earn", Stamps: -e.Stamps, CreatedBy: optActor(ctx),
		}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	}
	return nil
}

// JobReversed publishes the customer's loyalty change after a cancel / void.
func (s *Service) JobReversed(ctx context.Context, org, jobID int64) {
	row, err := s.q.LoyaltyGetJobByID(ctx, db.LoyaltyGetJobByIDParams{ID: jobID, OrganizationID: org})
	if err != nil {
		return
	}
	s.liveCustomer(ctx, row.CustomerUuid)
	s.emit(ctx, resourceevents.TenantLoyaltyPackages, resourceevents.ActionBulk)
	s.emit(ctx, resourceevents.TenantLoyaltySubscriptions, resourceevents.ActionBulk)
}
