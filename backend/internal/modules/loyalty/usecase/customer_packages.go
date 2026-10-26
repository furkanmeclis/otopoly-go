package usecase

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// packageState derives active / expired / used_up / cancelled.
func packageState(status string, expires pgtype.Timestamptz, total, used int64, now time.Time) string {
	switch {
	case status == "cancelled":
		return "cancelled"
	case expires.Valid && !expires.Time.After(now):
		return "expired"
	case used >= total:
		return "used_up"
	default:
		return "active"
	}
}

type customerPackageRow struct {
	id, customerID int64
	uuid           uuid.UUID
	packageUUID    pgtype.UUID
	customerUUID   uuid.UUID
	customerName   string
	name, currency string
	price          pgtype.Numeric
	status, method string
	purchased      pgtype.Timestamptz
	expires        pgtype.Timestamptz
	cancelled      pgtype.Timestamptz
	notes          string
}

func fromGetCP(r db.GetLoyaltyCustomerPackageRow) customerPackageRow {
	return customerPackageRow{
		id: r.ID, customerID: r.CustomerID, uuid: r.Uuid, packageUUID: r.PackageUuid, customerUUID: r.CustomerUuid,
		customerName: r.CustomerName, name: r.Name, currency: r.Currency, price: r.Price, status: r.Status,
		method: r.PaymentMethod, purchased: r.PurchasedAt, expires: r.ExpiresAt, cancelled: r.CancelledAt, notes: r.Notes,
	}
}

func fromListCP(r db.ListLoyaltyCustomerPackagesRow) customerPackageRow {
	return customerPackageRow{
		id: r.ID, customerID: r.CustomerID, uuid: r.Uuid, packageUUID: r.PackageUuid, customerUUID: r.CustomerUuid,
		customerName: r.CustomerName, name: r.Name, currency: r.Currency, price: r.Price, status: r.Status,
		method: r.PaymentMethod, purchased: r.PurchasedAt, expires: r.ExpiresAt, cancelled: r.CancelledAt, notes: r.Notes,
	}
}

func (s *Service) mapCustomerPackages(ctx context.Context, org int64, rows []customerPackageRow) ([]CustomerPackage, error) {
	ids := make([]int64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.id)
	}
	credits := map[int64][]db.ListLoyaltyPackageCreditsRow{}
	if len(ids) > 0 {
		list, err := s.q.ListLoyaltyPackageCredits(ctx, db.ListLoyaltyPackageCreditsParams{OrganizationID: org, CustomerPackageIds: ids})
		if err != nil {
			return nil, err
		}
		for _, c := range list {
			credits[c.CustomerPackageID] = append(credits[c.CustomerPackageID], c)
		}
	}
	now := s.now()
	out := make([]CustomerPackage, 0, len(rows))
	for _, r := range rows {
		cp := CustomerPackage{
			UUID: r.uuid, CustomerUUID: r.customerUUID, CustomerName: r.customerName, Name: r.name,
			Price: numMoney(r.price), Currency: r.currency, PurchasedAt: r.purchased.Time, PaymentMethod: r.method,
			Credits: []Credit{}, Notes: r.notes,
		}
		if r.packageUUID.Valid {
			id := uuid.UUID(r.packageUUID.Bytes)
			cp.PackageUUID = &id
		}
		if r.expires.Valid {
			t := r.expires.Time
			cp.ExpiresAt = &t
		}
		if r.cancelled.Valid {
			t := r.cancelled.Time
			cp.CancelledAt = &t
		}
		for _, c := range credits[r.id] {
			cp.Credits = append(cp.Credits, Credit{
				ServiceUUID: c.ServiceUuid, ServiceName: c.ServiceName, Total: c.Total, Used: c.Used, Remaining: c.Total - c.Used,
			})
			cp.CreditsTotal += int64(c.Total)
			cp.CreditsUsed += int64(c.Used)
		}
		cp.State = packageState(r.status, r.expires, cp.CreditsTotal, cp.CreditsUsed, now)
		out = append(out, cp)
	}
	return out, nil
}

func (s *Service) customerID(ctx context.Context, q *db.Queries, org int64, id *uuid.UUID) (pgtype.Int8, error) {
	if id == nil || *id == uuid.Nil {
		return pgtype.Int8{}, nil
	}
	c, err := q.LoyaltyGetCustomer(ctx, db.LoyaltyGetCustomerParams{OrganizationID: org, Uuid: *id})
	if err != nil {
		return pgtype.Int8{}, notFound(err)
	}
	return pgtype.Int8{Int64: c.ID, Valid: true}, nil
}

// ListCustomerPackages lists packages sold (filter by customer / state).
func (s *Service) ListCustomerPackages(ctx context.Context, f CustomerPackageFilter) ([]CustomerPackage, int64, error) {
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
	case "active", "expired", "used_up", "cancelled":
		state = pgtype.Text{String: f.State, Valid: true}
	default:
		return nil, 0, invalid("state must be active, expired, used_up or cancelled")
	}
	rows, err := s.q.ListLoyaltyCustomerPackages(ctx, db.ListLoyaltyCustomerPackagesParams{
		OrganizationID: org, CustomerID: cust, Q: textFilter(f.Q), State: state, LimitCount: f.Limit, OffsetCount: f.Offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountLoyaltyCustomerPackages(ctx, db.CountLoyaltyCustomerPackagesParams{
		OrganizationID: org, CustomerID: cust, Q: textFilter(f.Q), State: state,
	})
	if err != nil {
		return nil, 0, err
	}
	in := make([]customerPackageRow, 0, len(rows))
	for _, r := range rows {
		in = append(in, fromListCP(r))
	}
	out, err := s.mapCustomerPackages(ctx, org, in)
	return out, total, err
}

func mapUsage(rows []db.ListLoyaltyApplicationsBySourceRow) []Usage {
	out := make([]Usage, 0, len(rows))
	for _, r := range rows {
		out = append(out, Usage{
			UUID: r.Uuid, JobUUID: r.JobUuid, Plate: r.Plate, LineName: r.LineName, Units: r.Units,
			DiscountAmount: numMoney(r.DiscountAmount), Status: r.Status, PeriodStart: dateString(r.PeriodStart),
			CreatedAt: r.CreatedAt.Time,
		})
	}
	return out
}

// GetCustomerPackage returns a package sold with its usage history.
func (s *Service) GetCustomerPackage(ctx context.Context, id uuid.UUID) (CustomerPackageDetail, error) {
	org, err := orgID(ctx)
	if err != nil {
		return CustomerPackageDetail{}, err
	}
	row, err := s.q.GetLoyaltyCustomerPackage(ctx, db.GetLoyaltyCustomerPackageParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return CustomerPackageDetail{}, notFound(err)
	}
	list, err := s.mapCustomerPackages(ctx, org, []customerPackageRow{fromGetCP(row)})
	if err != nil {
		return CustomerPackageDetail{}, err
	}
	usage, err := s.q.ListLoyaltyApplicationsBySource(ctx, db.ListLoyaltyApplicationsBySourceParams{
		OrganizationID: org, CustomerPackageID: pgtype.Int8{Int64: row.ID, Valid: true},
	})
	if err != nil {
		return CustomerPackageDetail{}, err
	}
	return CustomerPackageDetail{CustomerPackage: list[0], Usage: mapUsage(usage)}, nil
}

// SellPackage sells a package definition to a customer: the credits are
// created and the price is taken by cash / card (income "Paket Satışı") or
// charged to the customer's cari account.
func (s *Service) SellPackage(ctx context.Context, in SellPackageInput) (CustomerPackageDetail, error) {
	org, err := orgID(ctx)
	if err != nil {
		return CustomerPackageDetail{}, err
	}
	actor := actorID(ctx)
	if in.PackageUUID == uuid.Nil || in.CustomerUUID == uuid.Nil {
		return CustomerPackageDetail{}, invalid("package_uuid and customer_uuid are required")
	}
	pkg, err := s.q.GetLoyaltyPackage(ctx, db.GetLoyaltyPackageParams{Uuid: in.PackageUUID, OrganizationID: org})
	if err != nil {
		return CustomerPackageDetail{}, notFound(err)
	}
	if !pkg.IsActive {
		return CustomerPackageDetail{}, conflict("package is not active")
	}
	cust, err := s.q.LoyaltyGetCustomer(ctx, db.LoyaltyGetCustomerParams{OrganizationID: org, Uuid: in.CustomerUUID})
	if err != nil {
		return CustomerPackageDetail{}, notFound(err)
	}
	items, err := s.q.ListLoyaltyPackageItems(ctx, db.ListLoyaltyPackageItemsParams{OrganizationID: org, PackageIds: []int64{pkg.ID}})
	if err != nil {
		return CustomerPackageDetail{}, err
	}
	if len(items) == 0 {
		return CustomerPackageDetail{}, conflict("package has no services")
	}
	now := s.now()
	expires := pgtype.Timestamptz{}
	if pkg.ValidityDays.Valid {
		// Valid through the end of the last day (business time).
		end := dayOf(now, s.loc).AddDate(0, 0, int(pkg.ValidityDays.Int32)+1)
		expires = pgtype.Timestamptz{Time: time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, s.loc), Valid: true}
	}
	var row db.LoyaltyCustomerPackage
	var pay payment
	var done posted
	err = s.inTx(ctx, func(q *db.Queries) error {
		var err error
		if pay, err = s.resolvePayment(ctx, q, org, in.Method, in.FinanceAccountUUID, pkg.Currency); err != nil {
			return err
		}
		row, err = q.CreateLoyaltyCustomerPackage(ctx, db.CreateLoyaltyCustomerPackageParams{
			OrganizationID: org, PackageID: pgtype.Int8{Int64: pkg.ID, Valid: true}, CustomerID: cust.ID, Name: pkg.Name,
			Price: pkg.Price, Currency: pkg.Currency, PurchasedAt: pgtype.Timestamptz{Time: now, Valid: true}, ExpiresAt: expires,
			PaymentMethod: pay.method, FinanceAccountID: pay.account, Notes: trimText(in.Notes, 1000), CreatedBy: optActor(ctx),
		})
		if err != nil {
			return err
		}
		for _, it := range items {
			if err := q.CreateLoyaltyCustomerPackageCredit(ctx, db.CreateLoyaltyCustomerPackageCreditParams{
				OrganizationID: org, CustomerPackageID: row.ID, ServiceID: it.ServiceID, ServiceName: it.ServiceName, Total: it.Quantity,
			}); err != nil {
				return err
			}
		}
		done, err = s.post(ctx, q, actor, pay, postInput{
			customerID: cust.ID, amount: pkg.Price, currency: pkg.Currency, category: CategoryPackageSale,
			sourceType: SourcePackageSale, sourceUUID: row.Uuid, day: dayOf(now, s.loc),
			desc: fmt.Sprintf("Paket satışı — %s (%s)", pkg.Name, cust.Name),
			meta: map[string]any{"module": "loyalty", "customer_package_uuid": row.Uuid.String()},
		})
		if err != nil {
			return err
		}
		return q.LinkLoyaltyCustomerPackagePayment(ctx, db.LinkLoyaltyCustomerPackagePaymentParams{
			ID: row.ID, OrganizationID: org, FinanceTransactionID: done.financeTx, CariEntryID: done.cariEntry,
		})
	})
	if err != nil {
		return CustomerPackageDetail{}, err
	}
	s.notifyFinance(ctx, done.txUUID, pay.accountUUID)
	s.record(ctx, "loyalty.package.sell", "loyalty.customer_package", row.Uuid, map[string]any{
		"name": pkg.Name, "customer": cust.Name, "amount": numMoney(pkg.Price), "method": pay.method,
	})
	s.emit(ctx, resourceevents.TenantLoyaltyPackages, resourceevents.ActionCreated, row.Uuid.String())
	s.emit(ctx, resourceevents.TenantLoyaltyPrograms, resourceevents.ActionUpdated, pkg.Uuid.String())
	s.liveCustomer(ctx, cust.Uuid)
	s.liveMoney(ctx)
	return s.GetCustomerPackage(ctx, row.Uuid)
}

// CancelCustomerPackage cancels a package sold. With no credit used the
// payment is voided (refund); otherwise the remaining credits just lapse.
func (s *Service) CancelCustomerPackage(ctx context.Context, id uuid.UUID) (CancelResult, error) {
	org, err := orgID(ctx)
	if err != nil {
		return CancelResult{}, err
	}
	actor := actorID(ctx)
	cur, err := s.q.GetLoyaltyCustomerPackage(ctx, db.GetLoyaltyCustomerPackageParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return CancelResult{}, notFound(err)
	}
	refunded := false
	var voidedTx uuid.UUID
	err = s.inTx(ctx, func(q *db.Queries) error {
		if err := q.LoyaltyLockCustomer(ctx, db.LoyaltyLockCustomerParams{OrganizationID: org, CustomerID: cur.CustomerID}); err != nil {
			return err
		}
		uses, err := q.CountLoyaltyCustomerPackageUses(ctx, db.CountLoyaltyCustomerPackageUsesParams{
			OrganizationID: org, CustomerPackageID: pgtype.Int8{Int64: cur.ID, Valid: true},
		})
		if err != nil {
			return err
		}
		if uses > 0 {
			return conflict("credits of this package are applied on open jobs; revert them first")
		}
		if _, err := q.CancelLoyaltyCustomerPackage(ctx, db.CancelLoyaltyCustomerPackageParams{Uuid: id, OrganizationID: org}); err != nil {
			if notFound(err) == ErrNotFound {
				return conflict("package is already cancelled")
			}
			return err
		}
		credits, err := q.ListLoyaltyPackageCredits(ctx, db.ListLoyaltyPackageCreditsParams{OrganizationID: org, CustomerPackageIds: []int64{cur.ID}})
		if err != nil {
			return err
		}
		used := int32(0)
		for _, c := range credits {
			used += c.Used
		}
		if used == 0 {
			if voidedTx, err = s.unpost(ctx, q, actor, cur.PaymentMethod, SourcePackageSale, cur.Uuid); err != nil {
				return err
			}
			refunded = true
		}
		return nil
	})
	if err != nil {
		return CancelResult{}, err
	}
	if refunded {
		s.notifyFinance(ctx, voidedTx, uuid.Nil)
		s.liveMoney(ctx)
	}
	s.record(ctx, "loyalty.package.cancel", "loyalty.customer_package", cur.Uuid, map[string]any{
		"name": cur.Name, "customer": cur.CustomerName, "refunded": refunded,
	})
	s.emit(ctx, resourceevents.TenantLoyaltyPackages, resourceevents.ActionUpdated, cur.Uuid.String())
	s.liveCustomer(ctx, cur.CustomerUuid)
	detail, err := s.GetCustomerPackage(ctx, id)
	if err != nil {
		return CancelResult{}, err
	}
	return CancelResult{CustomerPackageDetail: detail, Refunded: refunded}, nil
}

func trimText(raw string, max int) string {
	r := []rune(strings.TrimSpace(raw))
	if len(r) > max {
		r = r[:max]
	}
	return string(r)
}
