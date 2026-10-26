package usecase

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// fakeStore answers only for organization 7 / product id 11 / service id 21;
// every other organization gets pgx.ErrNoRows like the real org-scoped query.
type fakeStore struct {
	Store
	productUUID uuid.UUID
	serviceUUID uuid.UUID
	seenOrgs    []int64
}

const testOrg = int64(7)

func num(s string) pgtype.Numeric {
	var n pgtype.Numeric
	_ = n.Scan(s)
	return n
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func (f *fakeStore) GetProductByUUID(_ context.Context, arg db.GetProductByUUIDParams) (db.GetProductByUUIDRow, error) {
	f.seenOrgs = append(f.seenOrgs, arg.OrganizationID)
	if arg.OrganizationID != testOrg || arg.Uuid != f.productUUID {
		return db.GetProductByUUIDRow{}, pgx.ErrNoRows
	}
	return db.GetProductByUUIDRow{
		ID: 11, Uuid: f.productUUID, Currency: "TRY", TrackStock: true,
		StockQuantity: num("3"), MinStockAlert: num("5"), CostPrice: num("60"), SalePrice: num("100"),
	}, nil
}

func (f *fakeStore) GetProductSalesStats(_ context.Context, arg db.GetProductSalesStatsParams) (db.GetProductSalesStatsRow, error) {
	f.seenOrgs = append(f.seenOrgs, arg.OrganizationID)
	return db.GetProductSalesStatsRow{SaleCount: 2, SoldQty: num("4"), Revenue: num("400")}, nil
}

func (f *fakeStore) ListProductMonthlySales(_ context.Context, arg db.ListProductMonthlySalesParams) ([]db.ListProductMonthlySalesRow, error) {
	f.seenOrgs = append(f.seenOrgs, arg.OrganizationID)
	return []db.ListProductMonthlySalesRow{{Month: ts(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)), Qty: num("4"), Revenue: num("400")}}, nil
}

func (f *fakeStore) ListProductSaleMovements(_ context.Context, arg db.ListProductSaleMovementsParams) ([]db.ListProductSaleMovementsRow, error) {
	f.seenOrgs = append(f.seenOrgs, arg.OrganizationID)
	return []db.ListProductSaleMovementsRow{
		{RefUuid: uuid.New(), Status: "voided", OccurredAt: ts(time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)), Qty: num("1"), UnitPrice: num("90"), LineTotal: num("90"), Currency: "TRY"},
		{RefUuid: uuid.New(), Status: "posted", OccurredAt: ts(time.Date(2026, 10, 10, 0, 0, 0, 0, time.UTC)), Qty: num("2"), UnitPrice: num("100"), LineTotal: num("200"), Currency: "TRY"},
	}, nil
}

func (f *fakeStore) ListProductPurchaseMovements(_ context.Context, arg db.ListProductPurchaseMovementsParams) ([]db.ListProductPurchaseMovementsRow, error) {
	f.seenOrgs = append(f.seenOrgs, arg.OrganizationID)
	return []db.ListProductPurchaseMovementsRow{
		{RefUuid: uuid.New(), Status: "posted", OccurredAt: ts(time.Date(2026, 10, 15, 0, 0, 0, 0, time.UTC)), Qty: num("10"), UnitCost: num("60"), LineTotal: num("600"), Currency: "TRY"},
	}, nil
}

func (f *fakeStore) GetServiceByUUID(_ context.Context, arg db.GetServiceByUUIDParams) (db.GetServiceByUUIDRow, error) {
	f.seenOrgs = append(f.seenOrgs, arg.OrganizationID)
	if arg.OrganizationID != testOrg || arg.Uuid != f.serviceUUID {
		return db.GetServiceByUUIDRow{}, pgx.ErrNoRows
	}
	return db.GetServiceByUUIDRow{ID: 21, Uuid: f.serviceUUID, Currency: "TRY", Price: num("500"), DurationMinutes: 45}, nil
}

func (f *fakeStore) ListServiceProducts(_ context.Context, arg db.ListServiceProductsParams) ([]db.ListServiceProductsRow, error) {
	f.seenOrgs = append(f.seenOrgs, arg.OrganizationID)
	return []db.ListServiceProductsRow{{Qty: num("2"), CostPrice: num("50")}, {Qty: num("0.5"), CostPrice: num("100")}}, nil
}

func ctxWith(org int64, perms ...string) context.Context {
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: org})
	return authctx.WithPrincipal(ctx, authctx.Principal{Permissions: perms})
}

func newSvc() (*Service, *fakeStore) {
	f := &fakeStore{productUUID: uuid.New(), serviceUUID: uuid.New()}
	s := New(f)
	s.now = func() time.Time { return time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC) }
	return s, f
}

func TestProductSummaryOtherOrganizationIsNotFound(t *testing.T) {
	s, f := newSvc()
	_, err := s.ProductSummary(ctxWith(8, rbac.PermTenantSalesRead), f.productUUID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	_, err = s.ProductMovements(ctxWith(8, rbac.PermTenantSalesRead), f.productUUID, 10)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("movements: want ErrNotFound, got %v", err)
	}
}

func TestProductSummaryRequiresOrganization(t *testing.T) {
	s, f := newSvc()
	_, err := s.ProductSummary(context.Background(), f.productUUID)
	if !errors.Is(err, ErrOrgRequired) {
		t.Fatalf("want ErrOrgRequired, got %v", err)
	}
}

func TestProductSummaryBlocksFollowPermissions(t *testing.T) {
	s, f := newSvc()
	out, err := s.ProductSummary(ctxWith(testOrg, rbac.PermTenantSalesRead), f.productUUID)
	if err != nil {
		t.Fatal(err)
	}
	if out.Sales == nil || out.Purchases != nil || out.Jobs != nil {
		t.Fatalf("want only the sales block, got sales=%v purchases=%v jobs=%v", out.Sales != nil, out.Purchases != nil, out.Jobs != nil)
	}
	if out.Stock.Status != "low_stock" || out.Stock.CoverageQty != "-2" || out.Stock.CostValue != "180.00" {
		t.Fatalf("stock = %+v", out.Stock)
	}
	if out.Pricing.UnitMargin != "40.00" || out.Pricing.MarginPercent != 40 {
		t.Fatalf("pricing = %+v", out.Pricing)
	}
	if out.Sales.LastSalePrice == nil || *out.Sales.LastSalePrice != "100.00" {
		t.Fatalf("last sale price should skip the voided sale, got %v", out.Sales.LastSalePrice)
	}
	if len(out.Sales.Monthly) != 12 || out.Sales.Monthly[11].Month != "2026-10" || out.Sales.Monthly[11].Amount != "400.00" || out.Sales.Monthly[0].Month != "2025-11" {
		t.Fatalf("monthly = %+v", out.Sales.Monthly)
	}
	for _, org := range f.seenOrgs {
		if org != testOrg {
			t.Fatalf("query ran with organization %d", org)
		}
	}
}

func TestProductMovementsMergeAndSign(t *testing.T) {
	s, f := newSvc()
	items, err := s.ProductMovements(ctxWith(testOrg, rbac.PermTenantSalesRead, rbac.PermTenantPurchasesRead), f.productUUID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("limit not applied: %d", len(items))
	}
	if items[0].Kind != "sale" || items[0].Qty != "-1" || items[0].Effective {
		t.Fatalf("first = %+v", items[0])
	}
	if items[1].Kind != "purchase" || items[1].Qty != "10" || !items[1].Effective {
		t.Fatalf("second = %+v", items[1])
	}
}

func TestProductMovementsWithoutPermissionsIsEmpty(t *testing.T) {
	s, f := newSvc()
	items, err := s.ProductMovements(ctxWith(testOrg), f.productUUID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("want no rows without sales/purchases/jobs read, got %d", len(items))
	}
}

func TestServiceSummaryRecipeMargin(t *testing.T) {
	s, f := newSvc()
	out, err := s.ServiceSummary(ctxWith(testOrg), f.serviceUUID)
	if err != nil {
		t.Fatal(err)
	}
	if out.Usage != nil {
		t.Fatal("usage needs the jobs read permission")
	}
	if out.Pricing.RecipeCost != "150.00" || out.Pricing.UnitMargin != "350.00" || out.Pricing.MarginPercent != 70 || out.Pricing.RecipeItemCount != 2 {
		t.Fatalf("pricing = %+v", out.Pricing)
	}
	if _, err := s.ServiceSummary(ctxWith(9), f.serviceUUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other organization: want ErrNotFound, got %v", err)
	}
}

func TestHelpers(t *testing.T) {
	if got := ClampLimit(0); got != 50 {
		t.Fatalf("default limit %d", got)
	}
	if got := ClampLimit(1000); got != 200 {
		t.Fatalf("max limit %d", got)
	}
	if u := BrandLogoURL(uuid.Nil, pgtype.Text{}); u != nil {
		t.Fatal("no key → nil logo")
	}
	id := uuid.New()
	if u := BrandLogoURL(id, pgtype.Text{String: "k", Valid: true}); u == nil || *u != "/v1/public/vehicle-brands/logo/"+id.String() {
		t.Fatalf("logo url %v", u)
	}
	if got := qtyString(ratOf(num("2.500"))); got != "2.5" {
		t.Fatalf("qty %q", got)
	}
}
