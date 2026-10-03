package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Notifier interface {
	NotifyOrganization(ctx context.Context, orgID int64, title, body, link string)
	NotifyPlatform(ctx context.Context, title, body, link string)
}

func (s *Service) ListOrdersAdmin(ctx context.Context, status, q string, limit, offset int32) ([]Order, int64, error) {
	limit, offset = normalizeLimitOffset(limit, offset)
	status = normalizeOrderStatus(status)
	rows, err := s.q.ListOrders(ctx, db.ListOrdersParams{
		Status: status,
		Q:      strings.TrimSpace(q),
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountOrders(ctx, db.CountOrdersParams{Status: status, Q: strings.TrimSpace(q)})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Order, 0, len(rows))
	for _, row := range rows {
		item, err := s.orderFromAdminListRow(ctx, row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, item)
	}
	return out, total, nil
}

func (s *Service) OrdersSummary(ctx context.Context) (OrdersSummary, error) {
	row, err := s.q.OrderStatusSummary(ctx)
	if err != nil {
		return OrdersSummary{}, err
	}
	return OrdersSummary{PendingPayment: row.PendingPayment, PaymentReported: row.PaymentReported}, nil
}

func (s *Service) GetOrderAdmin(ctx context.Context, id uuid.UUID) (Order, error) {
	row, err := s.q.GetOrderByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Order{}, ErrNotFound
		}
		return Order{}, err
	}
	return s.orderFromAdminRow(ctx, row)
}

func (s *Service) CreateOrderAdmin(ctx context.Context, in AdminOrderInput) (Order, error) {
	if in.OrganizationUUID == uuid.Nil {
		return Order{}, fmt.Errorf("%w: organization_uuid is required", ErrInvalidRequest)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	org, err := organizationByUUID(ctx, tx, in.OrganizationUUID)
	if err != nil {
		return Order{}, err
	}
	if open, err := qtx.GetOpenOrderForOrg(ctx, org.ID); err == nil {
		return Order{}, OrderOpenError{OrderUUID: open.Uuid}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Order{}, err
	}
	qr, err := s.quoteFor(ctx, qtx, org.ID, OrderInput{
		PlanUUID: in.PlanUUID, Period: in.Period, DiscountCode: in.DiscountCode, CustomFeatures: in.CustomFeatures,
	}, in.ListPrice, true, false)
	if err != nil {
		return Order{}, err
	}
	settings, err := qtx.GetBillingSettings(ctx)
	if err != nil {
		return Order{}, err
	}
	ref, err := s.uniqueReferenceCode(ctx, qtx)
	if err != nil {
		return Order{}, err
	}
	now := time.Now()
	total, err := numericNonNegative(qr.Preview.Total)
	if err != nil {
		return Order{}, err
	}
	row, err := qtx.CreateOrder(ctx, db.CreateOrderParams{
		OrganizationID: org.ID, PlanID: qr.PlanID, Period: qr.Preview.Period, Kind: qr.Preview.Kind,
		Status: "pending_payment", Channel: "bank_transfer", ReferenceCode: ref,
		ListPrice: mustNumeric(qr.Preview.ListPrice), ProrationCredit: mustNumeric(qr.Preview.ProrationCredit),
		DiscountCodeID: qr.DiscountID, DiscountCode: qr.DiscountCode,
		DiscountAmount: mustNumeric(qr.Preview.DiscountAmount), CreditApplied: mustNumeric(qr.Preview.CreditApplied),
		CreditSurplus: mustNumeric(qr.Preview.CreditSurplus), Total: total,
		VatRate: qr.Preview.VATRate, VatAmount: mustNumeric(qr.Preview.VATAmount), Lines: qr.LinesJSON,
		StartsAt: pgTimeValue(qr.Preview.StartsAt), EndsAt: pgTimeValue(qr.Preview.EndsAt),
		CustomFeatures: qr.CustomFeaturesJSON, ExpiresAt: pgTimeValue(now.AddDate(0, 0, int(settings.OrderTtlDays))),
		CreatedBy: currentUserID(ctx),
	})
	if err != nil {
		return Order{}, err
	}
	if note := strings.TrimSpace(in.Note); note != "" {
		if _, err := tx.Exec(ctx, `UPDATE billing_orders SET report_note = $1 WHERE id = $2`, note, row.ID); err != nil {
			return Order{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Order{}, err
	}
	if s.notifier != nil {
		s.notifier.NotifyOrganization(ctx, org.ID, "Ödeme emri oluşturuldu", "Yeni ödeme emriniz hazır.", "/t/"+org.Slug+"/settings/billing")
	}
	s.recordActivity(ctx, "platform.billing.order.create", &row.Uuid, map[string]any{"reference_code": ref, "organization_uuid": org.UUID.String()})
	return s.GetOrderAdmin(ctx, row.Uuid)
}

func (s *Service) ApproveOrder(ctx context.Context, id uuid.UUID, note string) (Order, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	reviewer := currentUserID(ctx)
	row, err := s.approveTx(ctx, tx, qtx, id, reviewer, strings.TrimSpace(note))
	if err != nil {
		return Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Order{}, err
	}
	if _, err := s.IssueInvoice(ctx, row.ID); err != nil {
		// Invoice generation must not roll back an already approved order.
		fmt.Printf("billing invoice issue failed for order %s: %v\n", row.Uuid, err)
	}
	out, err := s.GetOrderAdmin(ctx, id)
	if err != nil {
		return Order{}, err
	}
	if s.notifier != nil {
		s.notifier.NotifyOrganization(ctx, row.OrganizationID, "Aboneliğiniz aktif", "Aboneliğiniz aktif edildi.", "/t/"+out.Organization.Slug+"/settings/billing")
	}
	s.recordActivity(ctx, "platform.billing.order.approve", &id, map[string]any{"reference_code": row.ReferenceCode})
	return out, nil
}

func (s *Service) RejectOrder(ctx context.Context, id uuid.UUID, reason string) (Order, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return Order{}, fmt.Errorf("%w: reason is required", ErrInvalidRequest)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	row, err := qtx.GetOrderForUpdate(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Order{}, ErrNotFound
		}
		return Order{}, err
	}
	if !isOpenOrder(row.Status) {
		return Order{}, ErrOrderState
	}
	if _, err := qtx.SetOrderStatus(ctx, db.SetOrderStatusParams{
		Status:       "rejected",
		ReviewedBy:   currentUserID(ctx),
		ReviewedAt:   pgTimeValue(time.Now()),
		RejectReason: reason,
		Uuid:         id,
	}); err != nil {
		return Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Order{}, err
	}
	out, err := s.GetOrderAdmin(ctx, id)
	if err != nil {
		return Order{}, err
	}
	if s.notifier != nil {
		s.notifier.NotifyOrganization(ctx, row.OrganizationID, "Ödemeniz reddedildi", reason, "/t/"+out.Organization.Slug+"/settings/billing")
	}
	return out, nil
}

func (s *Service) approveTx(ctx context.Context, tx pgx.Tx, qtx *db.Queries, id uuid.UUID, reviewer pgtype.Int8, note string) (db.BillingOrder, error) {
	order, err := qtx.GetOrderForUpdate(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.BillingOrder{}, ErrNotFound
		}
		return db.BillingOrder{}, err
	}
	if !isOpenOrder(order.Status) {
		return db.BillingOrder{}, ErrOrderState
	}
	planCode, ok, err := activePlanForOrder(ctx, tx, order.PlanID)
	if err != nil {
		return db.BillingOrder{}, err
	}
	if !ok {
		return db.BillingOrder{}, ErrPlanUnavailable
	}
	if strings.TrimSpace(order.DiscountCode) != "" {
		if d, err := s.validateDiscount(ctx, qtx, order.DiscountCode, order.OrganizationID, order.PlanID, order.Period, time.Now()); err != nil {
			return db.BillingOrder{}, err
		} else if err := qtx.InsertDiscountUse(ctx, db.InsertDiscountUseParams{
			DiscountCodeID: d.ID,
			OrganizationID: order.OrganizationID,
			OrderID:        order.ID,
			Amount:         order.DiscountAmount,
		}); err != nil {
			return db.BillingOrder{}, err
		}
	}
	if live, err := qtx.GetLiveSubscriptionForUpdate(ctx, order.OrganizationID); err == nil {
		if err := qtx.CloseSubscription(ctx, db.CloseSubscriptionParams{
			ID:   live.ID,
			Note: "replaced by order " + order.ReferenceCode,
		}); err != nil {
			return db.BillingOrder{}, err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return db.BillingOrder{}, err
	}
	sub, err := qtx.CreateSubscriptionWithCredit(ctx, db.CreateSubscriptionWithCreditParams{
		OrganizationID: order.OrganizationID,
		PlanID:         order.PlanID,
		Period:         order.Period,
		Status:         "active",
		StartsAt:       order.StartsAt,
		EndsAt:         order.EndsAt,
		PricePaid:      order.Total,
		CreditBalance:  order.CreditSurplus,
		Source:         "self_service",
		Note:           "approved order " + order.ReferenceCode,
		CreatedBy:      order.CreatedBy,
		CustomFeatures: order.CustomFeatures,
	})
	if err != nil {
		return db.BillingOrder{}, err
	}
	accessStart, err := continuousAccessStart(ctx, qtx, order.OrganizationID, order.StartsAt, time.Now())
	if err != nil {
		return db.BillingOrder{}, err
	}
	if err := qtx.SetOrganizationAccess(ctx, db.SetOrganizationAccessParams{
		PlanCode:       pgtype.Text{String: planCode, Valid: true},
		AccessStartsAt: accessStart,
		AccessEndsAt:   order.EndsAt,
		ID:             order.OrganizationID,
	}); err != nil {
		return db.BillingOrder{}, err
	}
	return qtx.SetOrderStatus(ctx, db.SetOrderStatusParams{
		Status:         "approved",
		ReviewedBy:     reviewer,
		ReviewedAt:     pgTimeValue(time.Now()),
		ReviewNote:     note,
		SubscriptionID: pgtype.Int8{Int64: sub.ID, Valid: true},
		Uuid:           id,
	})
}

func activePlanForOrder(ctx context.Context, tx pgx.Tx, planID int64) (string, bool, error) {
	var code string
	var active bool
	var deleted pgtype.Timestamptz
	err := tx.QueryRow(ctx, `SELECT code, is_active, deleted_at FROM billing_plans WHERE id = $1`, planID).Scan(&code, &active, &deleted)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return code, active && !deleted.Valid && code != "trial", nil
}
