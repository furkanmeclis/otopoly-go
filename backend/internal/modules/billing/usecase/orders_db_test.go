package usecase

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestOrdersDBTenantFlow(t *testing.T) {
	svc, q, pool, ctx := newOrdersDBFixture(t)
	plan := createBillingTestPlan(t, svc, "orders_flow", "500.00")
	org := createBillingTestOrg(t, q, pool)
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID, UUID: org.Uuid, Slug: org.Slug, Name: org.Name})

	preview, err := svc.PreviewOrder(octx, OrderInput{PlanUUID: plan.UUID, Period: "monthly"})
	if err != nil {
		t.Fatal(err)
	}
	if preview.Kind != "new" {
		t.Fatalf("preview kind=%s", preview.Kind)
	}

	order, err := svc.CreateOrder(octx, OrderInput{PlanUUID: plan.UUID, Period: "monthly"})
	if err != nil {
		t.Fatal(err)
	}
	if order.Status != "pending_payment" || !strings.HasPrefix(order.ReferenceCode, "OTO-") || order.Instructions == nil {
		t.Fatalf("order = %+v", order)
	}
	if _, err := svc.CreateOrder(octx, OrderInput{PlanUUID: plan.UUID, Period: "monthly"}); !errors.Is(err, ErrOrderOpen) {
		t.Fatalf("second create err=%v", err)
	}
	reported, err := svc.ReportPayment(octx, order.UUID, ReportInput{
		Filename: "receipt.pdf", ContentType: "application/pdf", Size: 7, Body: bytes.NewReader([]byte("receipt")),
	})
	if err != nil {
		t.Fatal(err)
	}
	if reported.Status != "payment_reported" || !reported.HasReceipt {
		t.Fatalf("reported = %+v", reported)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_orders SET status = 'pending_payment', expires_at = NOW() - INTERVAL '1 hour' WHERE uuid = $1`, order.UUID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReportPayment(octx, order.UUID, ReportInput{
		Filename: "late.pdf", ContentType: "application/pdf", Size: 4, Body: bytes.NewReader([]byte("late")),
	}); !errors.Is(err, ErrOrderState) {
		t.Fatalf("late report err=%v", err)
	}
	n, err := svc.ExpireDueOrders(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n < 1 {
		t.Fatalf("expired count=%d", n)
	}

	discount, err := svc.CreateDiscountCode(ctx, DiscountInput{
		Code: "FREE" + strings.ToUpper(uuid.NewString()[:6]),
		Kind: "amount", Value: "1000.00", PlanUUIDs: []uuid.UUID{plan.UUID},
		IsActive: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_discount_uses WHERE discount_code_id = (SELECT id FROM billing_discount_codes WHERE uuid = $1)`, discount.UUID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_discount_codes WHERE uuid = $1`, discount.UUID)
	})
	org2 := createBillingTestOrg(t, q, pool)
	octx2 := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org2.ID, UUID: org2.Uuid, Slug: org2.Slug, Name: org2.Name})
	free, err := svc.CreateOrder(octx2, OrderInput{PlanUUID: plan.UUID, Period: "monthly", DiscountCode: discount.Code})
	if err != nil {
		t.Fatal(err)
	}
	if free.Status != "approved" || free.Total != "0.00" {
		t.Fatalf("free order=%+v", free)
	}
}

func TestOrdersDBApprovalAndAdminSubscriptions(t *testing.T) {
	svc, q, pool, ctx := newOrdersDBFixture(t)
	plan := createBillingTestPlan(t, svc, "orders_approval", "500.00")
	org := createBillingTestOrg(t, q, pool)
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID, UUID: org.Uuid, Slug: org.Slug, Name: org.Name})

	order, err := svc.CreateOrder(octx, OrderInput{PlanUUID: plan.UUID, Period: "monthly"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReportPayment(octx, order.UUID, ReportInput{
		Filename: "receipt.pdf", ContentType: "application/pdf", Size: 7, Body: bytes.NewReader([]byte("receipt")),
	}); err != nil {
		t.Fatal(err)
	}
	approved, err := svc.ApproveOrder(ctx, order.UUID, "ok")
	if err != nil {
		t.Fatal(err)
	}
	if approved.Status != "approved" {
		t.Fatalf("approved=%+v", approved)
	}
	sub, err := q.GetLiveSubscription(ctx, org.ID)
	if err != nil || sub.Status != "active" || sub.EndsAt.Time.IsZero() {
		t.Fatalf("subscription=%+v err=%v", sub, err)
	}

	org2 := createBillingTestOrg(t, q, pool)
	manual, err := svc.CreateSubscriptionAdmin(ctx, AdminSubscriptionInput{
		OrganizationUUID: org2.Uuid, PlanUUID: plan.UUID, Period: "monthly",
		StartsAt: time.Now().UTC(), EndsAt: time.Now().UTC().AddDate(0, 1, 0), PricePaid: "0.00", Note: "manual",
	})
	if err != nil {
		t.Fatal(err)
	}
	extended, err := svc.UpdateSubscriptionAdmin(ctx, manual.UUID, AdminSubscriptionPatch{
		EndsAt: ptrTime(manual.EndsAt.AddDate(0, 1, 0)),
		Note:   "extended",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !extended.EndsAt.After(manual.EndsAt) {
		t.Fatalf("extended=%+v manual=%+v", extended, manual)
	}
	if _, err := svc.RejectOrder(ctx, order.UUID, ""); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("empty reject err=%v", err)
	}
}

func newOrdersDBFixture(t *testing.T) (*Service, *db.Queries, *pgxpool.Pool, context.Context) {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	svc := New(pool, q, nil, entitlements.New(entitlements.NewDBStore(q)))
	// Approvals issue invoices: keep them off the real series and settings.
	restoreBillingSettings(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE billing_settings SET invoice_series = 'TST' WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	svc.SetStorage(newReceiptStore())
	if _, err := svc.UpdatePaymentSettings(ctx, PaymentSettings{
		BankName: "Test Bank", AccountHolder: "Otobody Test", IBAN: "TR000000000000000000000000",
		OrderTTLDays: 3, GraceDays: 3, VATRate: 20,
	}); err != nil {
		t.Fatal(err)
	}
	return svc, q, pool, ctx
}

func createBillingTestPlan(t *testing.T, svc *Service, suffix, monthly string) Plan {
	t.Helper()
	plan, err := svc.CreatePlan(context.Background(), PlanInput{
		Code: "test_" + suffix + "_" + uuid.NewString()[:8],
		Name: "Billing Test " + suffix, PriceMonthly: monthly, YearlyPricing: "discount_percent",
		YearlyDiscountValue: "10.00", IsPublic: true, IsActive: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = svc.pool.Exec(context.Background(), `DELETE FROM billing_plans WHERE uuid = $1`, plan.UUID)
	})
	return plan
}

func createBillingTestOrg(t *testing.T, q *db.Queries, pool *pgxpool.Pool) db.Organization {
	t.Helper()
	now := time.Now().UTC()
	org, err := q.CreateOrganization(context.Background(), db.CreateOrganizationParams{
		Slug: "billing-order-test-" + uuid.NewString()[:8], Name: "Billing Order Test",
		Status: "active", PlanCode: pgtype.Text{String: "trial", Valid: true},
		AccessStartsAt: pgtype.Timestamptz{Time: now, Valid: true},
		AccessEndsAt:   pgtype.Timestamptz{Time: now.AddDate(0, 0, 14), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_discount_uses WHERE organization_id = $1`, org.ID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_orders WHERE organization_id = $1`, org.ID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_subscriptions WHERE organization_id = $1`, org.ID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, org.ID)
	})
	return org
}

func ptrTime(t time.Time) *time.Time { return &t }

type receiptStore struct {
	storage.Driver
	mu   sync.Mutex
	data map[string][]byte
}

func newReceiptStore() *receiptStore {
	return &receiptStore{data: map[string][]byte{}}
}

func (s *receiptStore) Upload(_ context.Context, file storage.File, path string) error {
	body, err := io.ReadAll(file.Body)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[path] = body
	return nil
}

func (s *receiptStore) Download(_ context.Context, path string) (io.ReadCloser, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body := s.data[path]
	return io.NopCloser(bytes.NewReader(body)), int64(len(body)), nil
}

func (s *receiptStore) Delete(_ context.Context, path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, path)
	return nil
}
