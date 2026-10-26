package usecase_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	purchasesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/stockreorder/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

type env struct {
	fx        *dbtest.Fixtures
	q         *db.Queries
	purchases *purchasesusecase.Service
	svc       *usecase.Service
}

func newEnv(t *testing.T) env {
	fx := dbtest.NewFixtures(t)
	q := db.New(fx.Pool)
	fin := financeusecase.New(fx.Pool, q, nil)
	p := purchasesusecase.New(fx.Pool, q, nil, fin)
	return env{fx: fx, q: q, purchases: p, svc: usecase.New(q, p, nil, nil, nil)}
}

func orgCtx(org, user dbtest.Row) context.Context {
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: org.ID, UUID: org.UUID, Slug: "fx"})
	return authctx.WithPrincipal(ctx, authctx.Principal{UserInternal: user.ID})
}

func (e env) product(org dbtest.Row, name, stock, minStock string) dbtest.Row {
	var r dbtest.Row
	err := e.fx.Pool.QueryRow(context.Background(), `INSERT INTO products (organization_id, name, stock_quantity, min_stock_alert, cost_price)
		VALUES ($1, $2, $3, $4, 5) RETURNING id, uuid`, org.ID, name, stock, minStock).Scan(&r.ID, &r.UUID)
	if err != nil {
		e.fx.T.Fatal(err)
	}
	return r
}

// consume records a job consumption created `ago` before now.
func (e env) consume(org, job, product dbtest.Row, qty, ago string, reverted bool) {
	rev := "NULL"
	if reverted {
		rev = "NOW()"
	}
	e.fx.Exec(`INSERT INTO service_job_consumptions (organization_id, job_id, product_id, name, qty, stock_applied, created_at, reverted_at)
		VALUES ($1, $2, $3, 'x', $4, TRUE, NOW() - $5::interval, `+rev+`)`, org.ID, job.ID, product.ID, qty, ago)
}

func (e env) sell(org, user, product dbtest.Row, qty, ago, status string) {
	sale := e.fx.Sale(org, dbtest.Row{}, user)
	e.fx.Exec(`UPDATE product_sales SET sold_at = NOW() - $2::interval, status = $3 WHERE id = $1`, sale.ID, ago, status)
	e.fx.Exec(`INSERT INTO product_sale_lines (organization_id, sale_id, product_id, name, unit_price, qty, line_total)
		VALUES ($1, $2, $3, 'x', 1, $4, 1)`, org.ID, sale.ID, product.ID, qty)
}

func (e env) purchaseLine(org, purchase, product dbtest.Row, qty, cost string) {
	e.fx.Exec(`INSERT INTO purchase_lines (organization_id, purchase_id, product_id, name, unit_cost, qty, line_total)
		VALUES ($1, $2, $3, 'x', $4, $5, 0)`, org.ID, purchase.ID, product.ID, cost, qty)
}

func find(t *testing.T, items []usecase.Suggestion, id uuid.UUID) usecase.Suggestion {
	t.Helper()
	for _, it := range items {
		if it.ProductUUID == id {
			return it
		}
	}
	t.Fatalf("product %s not in suggestions", id)
	return usecase.Suggestion{}
}

// Velocity counts job consumptions (not reverted) and posted sales of the
// last N days only; drafts count as on order; the latest posted purchase
// gives the supplier and the unit cost.
func TestSuggestionsVelocityDB(t *testing.T) {
	e := newEnv(t)
	org, other, user := e.fx.Organization(), e.fx.Organization(), e.fx.User()
	cust := e.fx.Customer(org, "C")
	job := e.fx.Job(org, cust, e.fx.Vehicle(org, cust), user)

	oil := e.product(org, "Oil", "4", "2")
	e.consume(org, job, oil, "10", "1 day", false)
	e.consume(org, job, oil, "5", "2 days", false)
	e.consume(org, job, oil, "100", "1 day", true)    // reverted: ignored
	e.consume(org, job, oil, "100", "40 days", false) // outside 30 days
	e.sell(org, user, oil, "15", "3 days", "posted")
	e.sell(org, user, oil, "50", "3 days", "voided") // voided: ignored

	oldSup, newSup := e.fx.Supplier(org, "Old"), e.fx.Supplier(org, "New")
	p1 := e.fx.Purchase(org, oldSup, user)
	e.fx.Exec(`UPDATE purchases SET purchased_at = NOW() - interval '20 days' WHERE id = $1`, p1.ID)
	e.purchaseLine(org, p1, oil, "1", "7")
	p2 := e.fx.Purchase(org, newSup, user)
	e.fx.Exec(`UPDATE purchases SET purchased_at = NOW() - interval '2 days' WHERE id = $1`, p2.ID)
	e.purchaseLine(org, p2, oil, "1", "9.5")
	draft := e.fx.Purchase(org, newSup, user)
	e.fx.Exec(`UPDATE purchases SET status = 'draft' WHERE id = $1`, draft.ID)
	e.purchaseLine(org, draft, oil, "3", "9.5")

	idle := e.product(org, "Idle", "50", "0")
	// Another organization's movements never leak in.
	foreignProduct := e.product(other, "Oil", "0", "5")
	foreignCust := e.fx.Customer(other, "F")
	foreignJob := e.fx.Job(other, foreignCust, e.fx.Vehicle(other, foreignCust), user)
	e.consume(other, foreignJob, foreignProduct, "999", "1 day", false)

	ctx := orgCtx(org, user)
	res, err := e.svc.List(ctx, usecase.ListFilters{All: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 2 {
		t.Fatalf("total = %d, want 2 (own products only)", res.Total)
	}
	s := find(t, res.Items, oil.UUID)
	// used = 10 + 5 + 15 = 30 over 30 days → 1/day
	if s.VelocityPerDay != "1" || s.Inputs.ConsumedQty != "15" || s.Inputs.SoldQty != "15" {
		t.Fatalf("velocity inputs: %+v / %s", s.Inputs, s.VelocityPerDay)
	}
	if s.OnOrder != "3" {
		t.Fatalf("on order = %s, want 3", s.OnOrder)
	}
	// need = 1 × (3 + 14) + 2 − 4 − 3 = 12
	if s.SuggestedQty != "12" || s.Urgency != usecase.UrgencyLowCover {
		t.Fatalf("suggested %s urgency %s", s.SuggestedQty, s.Urgency)
	}
	if s.Supplier == nil || s.Supplier.UUID != newSup.UUID || s.Supplier.Source != "last_purchase" {
		t.Fatalf("supplier = %+v", s.Supplier)
	}
	if s.UnitCost != "9.50" || s.UnitCostSource != "last_purchase" || s.EstimatedTotal != "114.00" {
		t.Fatalf("cost = %s (%s) total %s", s.UnitCost, s.UnitCostSource, s.EstimatedTotal)
	}

	// Supplier lead time, then product overrides (supplier, pack size).
	if _, err := e.svc.UpdateSettings(ctx, usecase.SettingsInput{
		VelocityDays: 30, LeadDays: 3, TargetDays: 14, NotifyEnabled: true,
		SupplierLeads: []usecase.SupplierLead{{SupplierUUID: newSup.UUID, LeadDays: 6}},
	}); err != nil {
		t.Fatal(err)
	}
	res, _ = e.svc.List(ctx, usecase.ListFilters{})
	s = find(t, res.Items, oil.UUID)
	if s.Inputs.LeadDays != 6 || s.Inputs.LeadDaysSource != "supplier" || s.SuggestedQty != "15" {
		t.Fatalf("supplier lead: %+v suggested %s", s.Inputs, s.SuggestedQty)
	}
	pack := "4"
	if _, err := e.svc.SetProductOverride(ctx, oil.UUID, usecase.ProductOverrideInput{SupplierUUID: &oldSup.UUID, PackSize: &pack}); err != nil {
		t.Fatal(err)
	}
	res, _ = e.svc.List(ctx, usecase.ListFilters{SupplierUUID: oldSup.UUID.String()})
	if res.Total != 1 {
		t.Fatalf("supplier filter total = %d", res.Total)
	}
	s = res.Items[0]
	// Old supplier has no lead time → organization 3 days: need 12 → 3 packs of 4.
	if s.Supplier.Source != "product" || s.Inputs.LeadDays != 3 || s.SuggestedQty != "12" || s.Packs == nil || *s.Packs != 3 {
		t.Fatalf("override: %+v %+v %s %v", s.Supplier, s.Inputs, s.SuggestedQty, s.Packs)
	}
	if s.UnitCost != "9.50" {
		t.Fatalf("unit cost stays the last purchase cost: %s", s.UnitCost)
	}
	// Default list hides products that need nothing.
	res, _ = e.svc.List(ctx, usecase.ListFilters{})
	for _, it := range res.Items {
		if it.ProductUUID == idle.UUID {
			t.Fatal("idle product must be hidden without all=true")
		}
	}
	// Another organization's product cannot be overridden.
	if _, err := e.svc.SetProductOverride(ctx, foreignProduct.UUID, usecase.ProductOverrideInput{PackSize: &pack}); !errors.Is(err, usecase.ErrNotFound) {
		t.Fatalf("foreign override: %v", err)
	}
	if _, err := e.svc.List(ctx, usecase.ListFilters{Urgency: "nope"}); !errors.Is(err, usecase.ErrInvalidRequest) {
		t.Fatalf("bad urgency: %v", err)
	}
}

// Drafts from suggestions are grouped by supplier, change neither stock nor
// finance, count as on order, and posting runs the regular purchase flow.
func TestDraftToPostFlowDB(t *testing.T) {
	e := newEnv(t)
	org, other, user := e.fx.Organization(), e.fx.Organization(), e.fx.User()
	a, b := e.fx.Supplier(org, "A"), e.fx.Supplier(org, "B")
	p1, p2, p3 := e.product(org, "P1", "0", "5"), e.product(org, "P2", "1", "3"), e.product(org, "P3", "0", "2")
	ctx := orgCtx(org, user)

	if _, err := e.svc.CreateDrafts(ctx, usecase.CreateDraftsInput{Items: []usecase.DraftItem{{ProductUUID: p1.UUID, Qty: "5"}}}); !errors.Is(err, usecase.ErrInvalidRequest) {
		t.Fatalf("no supplier must be rejected: %v", err)
	}
	res, err := e.svc.CreateDrafts(ctx, usecase.CreateDraftsInput{Items: []usecase.DraftItem{
		{ProductUUID: p1.UUID, Qty: "5", SupplierUUID: &a.UUID},
		{ProductUUID: p2.UUID, Qty: "2", SupplierUUID: &b.UUID},
		{ProductUUID: p3.UUID, Qty: "2", SupplierUUID: &a.UUID},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Drafts) != 2 {
		t.Fatalf("drafts = %d, want 2 (one per supplier)", len(res.Drafts))
	}
	da := res.Drafts[0]
	if da.Status != "draft" || da.SupplierUUID != a.UUID || len(da.Lines) != 2 || da.TotalAmount != "35.00" {
		t.Fatalf("draft A = %+v", da)
	}
	var stock string
	_ = e.fx.Pool.QueryRow(context.Background(), `SELECT stock_quantity::text FROM products WHERE id = $1`, p1.ID).Scan(&stock)
	if stock != "0.000" {
		t.Fatalf("draft changed stock: %s", stock)
	}
	sum, _ := e.svc.Summary(ctx)
	if sum.Drafts != 2 || sum.OutOfStock != 2 || sum.BelowMin != 1 || sum.Urgent != 3 {
		t.Fatalf("summary = %+v", sum)
	}
	list, _ := e.svc.List(ctx, usecase.ListFilters{})
	if s := find(t, list.Items, p1.UUID); s.OnOrder != "5" || s.SuggestedQty != "0" {
		t.Fatalf("on order not counted: %+v", s)
	}
	// Default purchase list hides drafts; status=draft lists them.
	if _, total, _ := e.purchases.List(ctx, 20, 0, purchasesusecase.ListFilters{}); total != 0 {
		t.Fatalf("drafts leaked into the purchase list: %d", total)
	}
	if _, total, _ := e.purchases.List(ctx, 20, 0, purchasesusecase.ListFilters{Status: "draft"}); total != 2 {
		t.Fatalf("draft list total = %d", total)
	}

	// Another organization sees nothing.
	foreignCtx := orgCtx(other, user)
	if _, err := e.purchases.Get(foreignCtx, da.UUID); !errors.Is(err, purchasesusecase.ErrNotFound) {
		t.Fatalf("foreign get: %v", err)
	}
	if _, err := e.purchases.PostDraft(foreignCtx, da.UUID, purchasesusecase.PostDraftInput{Method: "cash", FinanceAccountUUID: uuid.New()}); !errors.Is(err, purchasesusecase.ErrNotFound) {
		t.Fatalf("foreign post: %v", err)
	}
	if err := e.purchases.DeleteDraft(foreignCtx, da.UUID); !errors.Is(err, purchasesusecase.ErrNotFound) {
		t.Fatalf("foreign delete: %v", err)
	}

	var fa dbtest.Row
	if err := e.fx.Pool.QueryRow(context.Background(), `INSERT INTO finance_accounts (organization_id, name, type, opening_balance, current_balance)
		VALUES ($1, 'Kasa', 'cash', 100, 100) RETURNING id, uuid`, org.ID).Scan(&fa.ID, &fa.UUID); err != nil {
		t.Fatal(err)
	}
	qty := "6"
	cost := "5"
	posted, err := e.purchases.PostDraft(ctx, da.UUID, purchasesusecase.PostDraftInput{
		Method: "card", FinanceAccountUUID: fa.UUID,
		Lines: []purchasesusecase.CreateLineInput{
			{ProductUUID: p1.UUID, Qty: &qty, UnitCost: &cost},
			{ProductUUID: p3.UUID, Qty: &qty, UnitCost: &cost},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if posted.Status != "posted" || posted.Method != "card" || posted.TotalAmount != "60.00" || posted.FinanceTransactionUUID == nil || len(posted.Lines) != 2 {
		t.Fatalf("posted = %+v", posted)
	}
	_ = e.fx.Pool.QueryRow(context.Background(), `SELECT stock_quantity::text FROM products WHERE id = $1`, p1.ID).Scan(&stock)
	if stock != "6.000" {
		t.Fatalf("stock after post = %s", stock)
	}
	var balance string
	_ = e.fx.Pool.QueryRow(context.Background(), `SELECT current_balance::text FROM finance_accounts WHERE id = $1`, fa.ID).Scan(&balance)
	if balance != "40.00" {
		t.Fatalf("balance after post = %s", balance)
	}
	if _, err := e.purchases.PostDraft(ctx, da.UUID, purchasesusecase.PostDraftInput{Method: "cash", FinanceAccountUUID: fa.UUID}); !errors.Is(err, purchasesusecase.ErrConflict) {
		t.Fatalf("second post: %v", err)
	}
	if err := e.purchases.DeleteDraft(ctx, da.UUID); !errors.Is(err, purchasesusecase.ErrConflict) {
		t.Fatalf("deleting a posted purchase: %v", err)
	}
	// The other draft is discarded.
	if err := e.purchases.DeleteDraft(ctx, res.Drafts[1].UUID); err != nil {
		t.Fatal(err)
	}
	if n, _ := e.purchases.CountDrafts(ctx); n != 0 {
		t.Fatalf("drafts left = %d", n)
	}
}

type fakeNotifier struct{ calls []int64 }

func (f *fakeNotifier) NotifyReorder(_ context.Context, _ int64, userID int64, _, _, _ string, _ int) error {
	f.calls = append(f.calls, userID)
	return nil
}

// The daily sweep notifies members with purchases write once per day, only
// when something is out of stock / below minimum and the setting is on.
func TestDailyNotificationDB(t *testing.T) {
	e := newEnv(t)
	org, quiet := e.fx.Organization(), e.fx.Organization()
	owner, staff := e.fx.User(), e.fx.User()
	e.fx.Exec(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'staff')`, org.ID, owner.ID, staff.ID)
	e.fx.Exec(`UPDATE users SET status = 'active' WHERE id IN ($1, $2)`, owner.ID, staff.ID)
	e.fx.Exec(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE slug = 'organization_owner'`, owner.ID)
	e.fx.Exec(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE slug = 'organization_user'`, staff.ID)
	e.product(org, "Empty", "0", "3")
	e.product(quiet, "Full", "10", "3")

	n := &fakeNotifier{}
	e.svc.SetNotifier(n)
	e.svc.SetClock(func() time.Time { return time.Date(2026, 10, 26, 7, 0, 0, 0, time.UTC) }) // 10:00 Istanbul
	sent, err := e.svc.SendDue(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if sent != 1 || len(n.calls) != 1 || n.calls[0] != owner.ID {
		t.Fatalf("sent %d calls %v (only the owner may purchase)", sent, n.calls)
	}
	if sent, _ := e.svc.SendDue(context.Background()); sent != 0 {
		t.Fatalf("second sweep the same day sent %d", sent)
	}
	// Next day, notification turned off.
	ctx := orgCtx(org, owner)
	if _, err := e.svc.UpdateSettings(ctx, usecase.SettingsInput{VelocityDays: 30, LeadDays: 3, TargetDays: 14, NotifyEnabled: false}); err != nil {
		t.Fatal(err)
	}
	e.svc.SetClock(func() time.Time { return time.Date(2026, 10, 27, 7, 0, 0, 0, time.UTC) })
	if sent, _ := e.svc.SendDue(context.Background()); sent != 0 {
		t.Fatalf("disabled notification sent %d", sent)
	}
	// Before 09:00 Istanbul nothing is sent.
	if _, err := e.svc.UpdateSettings(ctx, usecase.SettingsInput{VelocityDays: 30, LeadDays: 3, TargetDays: 14, NotifyEnabled: true}); err != nil {
		t.Fatal(err)
	}
	e.svc.SetClock(func() time.Time { return time.Date(2026, 10, 28, 5, 0, 0, 0, time.UTC) }) // 08:00
	if sent, _ := e.svc.SendDue(context.Background()); sent != 0 {
		t.Fatalf("early sweep sent %d", sent)
	}
}
