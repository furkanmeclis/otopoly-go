package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// subscriptionRow is the common shape of the subscription queries.
type subscriptionRow struct {
	sub           db.LoyaltySubscription
	customerUUID  uuid.UUID
	customerName  string
	customerPhone string
	planUUID      pgtype.UUID
	vehicleUUID   pgtype.UUID
	plate         pgtype.Text
}

func fromGetSub(r db.GetLoyaltySubscriptionRow) subscriptionRow {
	return subscriptionRow{
		sub: db.LoyaltySubscription{
			ID: r.ID, Uuid: r.Uuid, OrganizationID: r.OrganizationID, PlanID: r.PlanID, CustomerID: r.CustomerID,
			VehicleID: r.VehicleID, Name: r.Name, Price: r.Price, Currency: r.Currency, PeriodMonths: r.PeriodMonths,
			UsesPerPeriod: r.UsesPerPeriod, StartDate: r.StartDate, PaidThrough: r.PaidThrough, Status: r.Status,
			Notes: r.Notes, CreatedBy: r.CreatedBy, CancelledAt: r.CancelledAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		},
		customerUUID: r.CustomerUuid, customerName: r.CustomerName, customerPhone: r.CustomerPhone,
		planUUID: r.PlanUuid, vehicleUUID: r.VehicleUuid, plate: r.VehiclePlate,
	}
}

func fromListSub(r db.ListLoyaltySubscriptionsRow) subscriptionRow {
	return subscriptionRow{
		sub: db.LoyaltySubscription{
			ID: r.ID, Uuid: r.Uuid, OrganizationID: r.OrganizationID, PlanID: r.PlanID, CustomerID: r.CustomerID,
			VehicleID: r.VehicleID, Name: r.Name, Price: r.Price, Currency: r.Currency, PeriodMonths: r.PeriodMonths,
			UsesPerPeriod: r.UsesPerPeriod, StartDate: r.StartDate, PaidThrough: r.PaidThrough, Status: r.Status,
			Notes: r.Notes, CreatedBy: r.CreatedBy, CancelledAt: r.CancelledAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		},
		customerUUID: r.CustomerUuid, customerName: r.CustomerName, customerPhone: r.CustomerPhone,
		planUUID: r.PlanUuid, vehicleUUID: r.VehicleUuid, plate: r.VehiclePlate,
	}
}

// currentPeriod is the paid period containing today (nil when today is not
// paid or the subscription is cancelled).
func (s *Service) currentPeriod(ctx context.Context, q *db.Queries, sub db.LoyaltySubscription, today time.Time) (*Period, time.Time, error) {
	if sub.Status != "active" || !sub.PaidThrough.Time.After(today) || today.Before(sub.StartDate.Time) {
		return nil, time.Time{}, nil
	}
	k := periodIndex(sub.StartDate.Time, int(sub.PeriodMonths), today)
	from, to := periodBounds(sub.StartDate.Time, int(sub.PeriodMonths), k)
	used, err := q.CountLoyaltySubscriptionUses(ctx, db.CountLoyaltySubscriptionUsesParams{
		OrganizationID: sub.OrganizationID, SubscriptionID: pgtype.Int8{Int64: sub.ID, Valid: true},
		PeriodStart: pgtype.Date{Time: from, Valid: true},
	})
	if err != nil {
		return nil, time.Time{}, err
	}
	p := &Period{Start: from.Format("2006-01-02"), End: to.Format("2006-01-02"), Used: used, Limit: int4Ptr(sub.UsesPerPeriod)}
	if p.Limit != nil {
		left := int64(*p.Limit) - used
		if left < 0 {
			left = 0
		}
		p.Remaining = &left
	}
	return p, from, nil
}

func (s *Service) mapSubscription(ctx context.Context, r subscriptionRow, today time.Time) (Subscription, error) {
	sub := r.sub
	out := Subscription{
		UUID: sub.Uuid, CustomerUUID: r.customerUUID, CustomerName: r.customerName, CustomerPhone: r.customerPhone,
		Name: sub.Name, Price: numMoney(sub.Price), Currency: sub.Currency, PeriodMonths: sub.PeriodMonths,
		UsesPerPeriod: int4Ptr(sub.UsesPerPeriod), StartDate: sub.StartDate.Time.Format("2006-01-02"),
		RenewalDate:      sub.PaidThrough.Time.Format("2006-01-02"),
		DaysUntilRenewal: int(sub.PaidThrough.Time.Sub(today).Hours() / 24),
		State:            subscriptionState(sub.Status, sub.PaidThrough.Time, today),
		Notes:            sub.Notes, CreatedAt: sub.CreatedAt.Time,
	}
	if r.planUUID.Valid {
		id := uuid.UUID(r.planUUID.Bytes)
		out.PlanUUID = &id
	}
	if r.vehicleUUID.Valid {
		id := uuid.UUID(r.vehicleUUID.Bytes)
		out.VehicleUUID = &id
	}
	if r.plate.Valid {
		p := r.plate.String
		out.Plate = &p
	}
	if sub.CancelledAt.Valid {
		t := sub.CancelledAt.Time
		out.CancelledAt = &t
	}
	period, _, err := s.currentPeriod(ctx, s.q, sub, today)
	if err != nil {
		return Subscription{}, err
	}
	out.CurrentPeriod = period
	return out, nil
}

// ListSubscriptions lists subscriptions (filter by customer / state /
// renewal window).
func (s *Service) ListSubscriptions(ctx context.Context, f SubscriptionFilter) ([]Subscription, int64, error) {
	org, err := orgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	cust, err := s.customerID(ctx, s.q, org, f.CustomerUUID)
	if err != nil {
		return nil, 0, err
	}
	state := pgtype.Text{}
	switch f.State {
	case "":
	case "active", "past_due", "cancelled":
		state = pgtype.Text{String: f.State, Valid: true}
	default:
		return nil, 0, invalid("state must be active, past_due or cancelled")
	}
	today := s.today()
	due := pgtype.Date{}
	if f.DueWithinDays != nil {
		if *f.DueWithinDays < 0 || *f.DueWithinDays > 365 {
			return nil, 0, invalid("due_within_days must be between 0 and 365")
		}
		due = pgtype.Date{Time: today.AddDate(0, 0, *f.DueWithinDays+1), Valid: true}
	}
	todayArg := pgtype.Date{Time: today, Valid: true}
	rows, err := s.q.ListLoyaltySubscriptions(ctx, db.ListLoyaltySubscriptionsParams{
		OrganizationID: org, CustomerID: cust, Q: textFilter(f.Q), State: state, Today: todayArg, DueBefore: due,
		LimitCount: f.Limit, OffsetCount: f.Offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountLoyaltySubscriptions(ctx, db.CountLoyaltySubscriptionsParams{
		OrganizationID: org, CustomerID: cust, Q: textFilter(f.Q), State: state, Today: todayArg, DueBefore: due,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Subscription, 0, len(rows))
	for _, r := range rows {
		m, err := s.mapSubscription(ctx, fromListSub(r), today)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	return out, total, nil
}

// GetSubscription returns a subscription with payments, usage and the next
// period to pay.
func (s *Service) GetSubscription(ctx context.Context, id uuid.UUID) (SubscriptionDetail, error) {
	org, err := orgID(ctx)
	if err != nil {
		return SubscriptionDetail{}, err
	}
	row, err := s.q.GetLoyaltySubscription(ctx, db.GetLoyaltySubscriptionParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return SubscriptionDetail{}, notFound(err)
	}
	today := s.today()
	base, err := s.mapSubscription(ctx, fromGetSub(row), today)
	if err != nil {
		return SubscriptionDetail{}, err
	}
	from, to := nextPeriod(row.StartDate.Time, int(row.PeriodMonths), row.PaidThrough.Time)
	out := SubscriptionDetail{
		Subscription: base,
		NextPeriod:   Period{Start: from.Format("2006-01-02"), End: to.Format("2006-01-02"), Limit: int4Ptr(row.UsesPerPeriod)},
		Payments:     []SubscriptionPayment{},
	}
	pays, err := s.q.ListLoyaltySubscriptionPayments(ctx, db.ListLoyaltySubscriptionPaymentsParams{OrganizationID: org, SubscriptionID: row.ID})
	if err != nil {
		return SubscriptionDetail{}, err
	}
	for _, p := range pays {
		sp := SubscriptionPayment{
			UUID: p.Uuid, PeriodStart: p.PeriodStart.Time.Format("2006-01-02"), PeriodEnd: p.PeriodEnd.Time.Format("2006-01-02"),
			Amount: numMoney(p.Amount), Currency: p.Currency, Method: p.Method, CreatedAt: p.CreatedAt.Time,
		}
		if p.FinanceAccountName.Valid {
			sp.FinanceAccountName = p.FinanceAccountName.String
		}
		out.Payments = append(out.Payments, sp)
	}
	usage, err := s.q.ListLoyaltyApplicationsBySource(ctx, db.ListLoyaltyApplicationsBySourceParams{
		OrganizationID: org, SubscriptionID: pgtype.Int8{Int64: row.ID, Valid: true},
	})
	if err != nil {
		return SubscriptionDetail{}, err
	}
	out.Usage = mapUsage(usage)
	return out, nil
}

// StartSubscription starts a plan for a customer (optionally for one of
// their vehicles). With Payment the first period is collected right away;
// otherwise the subscription is past due until it is paid.
func (s *Service) StartSubscription(ctx context.Context, in StartSubscriptionInput) (SubscriptionDetail, error) {
	org, err := orgID(ctx)
	if err != nil {
		return SubscriptionDetail{}, err
	}
	if in.PlanUUID == uuid.Nil || in.CustomerUUID == uuid.Nil {
		return SubscriptionDetail{}, invalid("plan_uuid and customer_uuid are required")
	}
	plan, err := s.q.GetLoyaltySubscriptionPlan(ctx, db.GetLoyaltySubscriptionPlanParams{Uuid: in.PlanUUID, OrganizationID: org})
	if err != nil {
		return SubscriptionDetail{}, notFound(err)
	}
	if !plan.IsActive {
		return SubscriptionDetail{}, conflict("plan is not active")
	}
	cust, err := s.q.LoyaltyGetCustomer(ctx, db.LoyaltyGetCustomerParams{OrganizationID: org, Uuid: in.CustomerUUID})
	if err != nil {
		return SubscriptionDetail{}, notFound(err)
	}
	vehicle := pgtype.Int8{}
	if in.VehicleUUID != nil && *in.VehicleUUID != uuid.Nil {
		v, err := s.q.LoyaltyGetVehicle(ctx, db.LoyaltyGetVehicleParams{OrganizationID: org, Uuid: *in.VehicleUUID})
		if err != nil {
			return SubscriptionDetail{}, invalid("vehicle not found")
		}
		if v.CustomerID != cust.ID {
			return SubscriptionDetail{}, invalid("vehicle does not belong to customer")
		}
		vehicle = pgtype.Int8{Int64: v.ID, Valid: true}
	}
	if in.Payment != nil && in.Payment.Method != "" {
		// Check the payment before the subscription exists.
		if _, err := s.resolvePayment(ctx, s.q, org, in.Payment.Method, in.Payment.FinanceAccountUUID, plan.Currency); err != nil {
			return SubscriptionDetail{}, err
		}
	}
	start := s.today()
	if in.StartDate != nil && *in.StartDate != "" {
		d, err := parseDate(in.StartDate, "start_date")
		if err != nil {
			return SubscriptionDetail{}, err
		}
		if d.Time.Before(start.AddDate(0, 0, -62)) || d.Time.After(start.AddDate(0, 0, 62)) {
			return SubscriptionDetail{}, invalid("start_date must be within 62 days of today")
		}
		start = d.Time
	}
	var sub db.LoyaltySubscription
	err = s.inTx(ctx, func(q *db.Queries) error {
		var err error
		sub, err = q.CreateLoyaltySubscription(ctx, db.CreateLoyaltySubscriptionParams{
			OrganizationID: org, PlanID: pgtype.Int8{Int64: plan.ID, Valid: true}, CustomerID: cust.ID, VehicleID: vehicle,
			Name: plan.Name, Price: plan.Price, Currency: plan.Currency, PeriodMonths: plan.PeriodMonths,
			UsesPerPeriod: plan.UsesPerPeriod, StartDate: pgtype.Date{Time: start, Valid: true},
			Notes: trimText(in.Notes, 1000), CreatedBy: optActor(ctx),
		})
		return err
	})
	if err != nil {
		return SubscriptionDetail{}, err
	}
	s.record(ctx, "loyalty.subscription.start", "loyalty.subscription", sub.Uuid, map[string]any{
		"name": plan.Name, "customer": cust.Name, "start_date": start.Format("2006-01-02"),
	})
	s.emit(ctx, resourceevents.TenantLoyaltySubscriptions, resourceevents.ActionCreated, sub.Uuid.String())
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionUpdated, plan.Uuid.String())
	s.liveCustomer(ctx, cust.Uuid)
	if in.Payment != nil && in.Payment.Method != "" {
		return s.PaySubscription(ctx, sub.Uuid, *in.Payment)
	}
	s.scheduleReminder(ctx, org, sub)
	return s.GetSubscription(ctx, sub.Uuid)
}

// PaySubscription collects the next unpaid period (manual collection:
// cash / card into a finance account, or cari) and moves the renewal date.
func (s *Service) PaySubscription(ctx context.Context, id uuid.UUID, in PaymentInput) (SubscriptionDetail, error) {
	org, err := orgID(ctx)
	if err != nil {
		return SubscriptionDetail{}, err
	}
	actor := actorID(ctx)
	row, err := s.q.GetLoyaltySubscription(ctx, db.GetLoyaltySubscriptionParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return SubscriptionDetail{}, notFound(err)
	}
	if row.Status != "active" {
		return SubscriptionDetail{}, conflict("subscription is cancelled")
	}
	from, to := nextPeriod(row.StartDate.Time, int(row.PeriodMonths), row.PaidThrough.Time)
	if from.After(s.today().AddDate(0, 0, 366)) {
		return SubscriptionDetail{}, conflict("subscription is already paid a year ahead")
	}
	var pay payment
	var done posted
	var advanced db.LoyaltySubscription
	err = s.inTx(ctx, func(q *db.Queries) error {
		var err error
		if pay, err = s.resolvePayment(ctx, q, org, in.Method, in.FinanceAccountUUID, row.Currency); err != nil {
			return err
		}
		advanced, err = q.AdvanceLoyaltySubscription(ctx, db.AdvanceLoyaltySubscriptionParams{
			ID: row.ID, OrganizationID: org, ExpectedPaidThrough: row.PaidThrough, NewPaidThrough: pgtype.Date{Time: to, Valid: true},
		})
		if err != nil {
			if notFound(err) == ErrNotFound {
				return conflict("the subscription changed meanwhile; reload and try again")
			}
			return err
		}
		p, err := q.CreateLoyaltySubscriptionPayment(ctx, db.CreateLoyaltySubscriptionPaymentParams{
			OrganizationID: org, SubscriptionID: row.ID, PeriodStart: pgtype.Date{Time: from, Valid: true},
			PeriodEnd: pgtype.Date{Time: to, Valid: true}, Amount: row.Price, Currency: row.Currency, Method: pay.method,
			FinanceAccountID: pay.account, CreatedBy: optActor(ctx),
		})
		if err != nil {
			return err
		}
		done, err = s.post(ctx, q, actor, pay, postInput{
			customerID: row.CustomerID, amount: row.Price, currency: row.Currency, category: CategorySubscription,
			sourceType: SourceSubscriptionPayment, sourceUUID: p.Uuid, day: dayOf(s.now(), s.loc),
			desc: fmt.Sprintf("Abonelik — %s (%s) %s / %s", row.Name, row.CustomerName,
				from.Format("02.01.2006"), to.AddDate(0, 0, -1).Format("02.01.2006")),
			meta: map[string]any{"module": "loyalty", "subscription_uuid": row.Uuid.String(), "period_start": from.Format("2006-01-02")},
		})
		if err != nil {
			return err
		}
		return q.LinkLoyaltySubscriptionPayment(ctx, db.LinkLoyaltySubscriptionPaymentParams{
			ID: p.ID, OrganizationID: org, FinanceTransactionID: done.financeTx, CariEntryID: done.cariEntry,
		})
	})
	if err != nil {
		return SubscriptionDetail{}, err
	}
	s.notifyFinance(ctx, done.txUUID, pay.accountUUID)
	s.record(ctx, "loyalty.subscription.pay", "loyalty.subscription", row.Uuid, map[string]any{
		"name": row.Name, "customer": row.CustomerName, "amount": numMoney(row.Price), "method": pay.method,
		"period_start": from.Format("2006-01-02"), "period_end": to.Format("2006-01-02"),
	})
	s.emit(ctx, resourceevents.TenantLoyaltySubscriptions, resourceevents.ActionUpdated, row.Uuid.String())
	s.liveCustomer(ctx, row.CustomerUuid)
	s.liveMoney(ctx)
	s.scheduleReminder(ctx, org, advanced)
	return s.GetSubscription(ctx, row.Uuid)
}

// CancelSubscription ends a subscription; paid periods are not refunded and
// pending renewal reminders are cancelled.
func (s *Service) CancelSubscription(ctx context.Context, id uuid.UUID) (SubscriptionDetail, error) {
	org, err := orgID(ctx)
	if err != nil {
		return SubscriptionDetail{}, err
	}
	row, err := s.q.CancelLoyaltySubscription(ctx, db.CancelLoyaltySubscriptionParams{Uuid: id, OrganizationID: org})
	if err != nil {
		if notFound(err) == ErrNotFound {
			if _, gerr := s.q.GetLoyaltySubscription(ctx, db.GetLoyaltySubscriptionParams{Uuid: id, OrganizationID: org}); gerr == nil {
				return SubscriptionDetail{}, conflict("subscription is already cancelled")
			}
		}
		return SubscriptionDetail{}, notFound(err)
	}
	if s.rem != nil {
		s.rem.CancelRenewal(ctx, row.ID)
	}
	cust, _ := s.q.LoyaltyGetCustomerByID(ctx, db.LoyaltyGetCustomerByIDParams{OrganizationID: org, ID: row.CustomerID})
	s.record(ctx, "loyalty.subscription.cancel", "loyalty.subscription", row.Uuid, map[string]any{"name": row.Name, "customer": cust.Name})
	s.emit(ctx, resourceevents.TenantLoyaltySubscriptions, resourceevents.ActionUpdated, row.Uuid.String())
	s.liveCustomer(ctx, cust.Uuid)
	return s.GetSubscription(ctx, row.Uuid)
}

func (s *Service) scheduleReminder(ctx context.Context, org int64, sub db.LoyaltySubscription) {
	if s.rem != nil && sub.Status == "active" {
		s.rem.ScheduleRenewal(ctx, org, sub)
	}
}

// RenewalDue reports whether a subscription is still waiting for the
// renewal a reminder announces (notification center guard): active and the
// renewal date is not more than 3 days away.
func (s *Service) RenewalDue(ctx context.Context, org, subID int64) (bool, error) {
	sub, err := s.q.GetLoyaltySubscriptionByID(ctx, db.GetLoyaltySubscriptionByIDParams{ID: subID, OrganizationID: org})
	if err != nil {
		if notFound(err) == ErrNotFound {
			return false, nil
		}
		return false, err
	}
	if sub.Status != "active" {
		return false, nil
	}
	return !sub.PaidThrough.Time.After(s.today().AddDate(0, 0, 3)), nil
}
