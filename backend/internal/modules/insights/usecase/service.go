// Package usecase builds the 360° summaries of the tenant detail pages
// (product, service, customer, supplier). Every read is organization scoped:
// the record is looked up with the orgctx organization id (another
// organization's record answers ErrNotFound) and the aggregates filter by the
// same id. Blocks that come from another module are only filled when the
// caller also holds that module's read permission.
package usecase

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bizclock"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/brandlogo"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrOrgRequired   = errors.New("organization context required")
	defaultListLimit = int32(50)
	maxListLimit     = int32(200)
	trendMonths      = 12
)

// Store is the subset of db.Querier the summaries read.
type Store interface {
	GetProductByUUID(ctx context.Context, arg db.GetProductByUUIDParams) (db.GetProductByUUIDRow, error)
	GetServiceByUUID(ctx context.Context, arg db.GetServiceByUUIDParams) (db.GetServiceByUUIDRow, error)
	GetCustomerByUUID(ctx context.Context, arg db.GetCustomerByUUIDParams) (db.Customer, error)
	GetSupplierByUUID(ctx context.Context, arg db.GetSupplierByUUIDParams) (db.Supplier, error)

	GetProductSalesStats(ctx context.Context, arg db.GetProductSalesStatsParams) (db.GetProductSalesStatsRow, error)
	GetProductPurchaseStats(ctx context.Context, arg db.GetProductPurchaseStatsParams) (db.GetProductPurchaseStatsRow, error)
	GetProductJobStats(ctx context.Context, arg db.GetProductJobStatsParams) (db.GetProductJobStatsRow, error)
	ListProductMonthlySales(ctx context.Context, arg db.ListProductMonthlySalesParams) ([]db.ListProductMonthlySalesRow, error)
	ListProductSaleMovements(ctx context.Context, arg db.ListProductSaleMovementsParams) ([]db.ListProductSaleMovementsRow, error)
	ListProductPurchaseMovements(ctx context.Context, arg db.ListProductPurchaseMovementsParams) ([]db.ListProductPurchaseMovementsRow, error)
	ListProductConsumptionMovements(ctx context.Context, arg db.ListProductConsumptionMovementsParams) ([]db.ListProductConsumptionMovementsRow, error)

	ListServiceProducts(ctx context.Context, arg db.ListServiceProductsParams) ([]db.ListServiceProductsRow, error)
	GetServiceUsageStats(ctx context.Context, arg db.GetServiceUsageStatsParams) (db.GetServiceUsageStatsRow, error)
	ListServiceMonthlyUsage(ctx context.Context, arg db.ListServiceMonthlyUsageParams) ([]db.ListServiceMonthlyUsageRow, error)
	ListServiceJobUsage(ctx context.Context, arg db.ListServiceJobUsageParams) ([]db.ListServiceJobUsageRow, error)

	GetCustomerJobStats(ctx context.Context, arg db.GetCustomerJobStatsParams) (db.GetCustomerJobStatsRow, error)
	GetCustomerSalesStats(ctx context.Context, arg db.GetCustomerSalesStatsParams) (db.GetCustomerSalesStatsRow, error)
	GetCustomerPipelineStats(ctx context.Context, arg db.GetCustomerPipelineStatsParams) (db.GetCustomerPipelineStatsRow, error)
	ListCustomerMonthlySpend(ctx context.Context, arg db.ListCustomerMonthlySpendParams) ([]db.ListCustomerMonthlySpendRow, error)
	ListCustomerTopServices(ctx context.Context, arg db.ListCustomerTopServicesParams) ([]db.ListCustomerTopServicesRow, error)
	ListCustomerVehicleStats(ctx context.Context, arg db.ListCustomerVehicleStatsParams) ([]db.ListCustomerVehicleStatsRow, error)
	ListCustomerSales(ctx context.Context, arg db.ListCustomerSalesParams) ([]db.ListCustomerSalesRow, error)

	GetSupplierPurchaseStats(ctx context.Context, arg db.GetSupplierPurchaseStatsParams) (db.GetSupplierPurchaseStatsRow, error)
	ListSupplierMonthlySpend(ctx context.Context, arg db.ListSupplierMonthlySpendParams) ([]db.ListSupplierMonthlySpendRow, error)
	ListSupplierTopProducts(ctx context.Context, arg db.ListSupplierTopProductsParams) ([]db.ListSupplierTopProductsRow, error)
	ListSupplierPurchases(ctx context.Context, arg db.ListSupplierPurchasesParams) ([]db.ListSupplierPurchasesRow, error)
}

type Service struct {
	q   Store
	now func() time.Time
}

func New(q Store) *Service {
	return &Service{q: q, now: time.Now}
}

func orgID(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, ErrOrgRequired
	}
	return scope.InternalID, nil
}

func can(ctx context.Context, slug string) bool {
	p, ok := authctx.PrincipalFrom(ctx)
	return ok && p.HasPermission(slug)
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// ClampLimit maps a requested list size to [1, 200], 0 meaning the default.
func ClampLimit(n int) int32 {
	if n <= 0 {
		return defaultListLimit
	}
	if int32(n) > maxListLimit {
		return maxListLimit
	}
	return int32(n)
}

// ============================================================================
// Product
// ============================================================================

func (s *Service) ProductSummary(ctx context.Context, id uuid.UUID) (ProductSummary, error) {
	org, err := orgID(ctx)
	if err != nil {
		return ProductSummary{}, err
	}
	p, err := s.q.GetProductByUUID(ctx, db.GetProductByUUIDParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return ProductSummary{}, notFound(err)
	}

	out := ProductSummary{ProductUUID: p.Uuid, Currency: p.Currency}
	qty, minAlert := ratOf(p.StockQuantity), ratOf(p.MinStockAlert)
	cost, price := ratOf(p.CostPrice), ratOf(p.SalePrice)
	out.Stock.Tracked = p.TrackStock
	out.Stock.Quantity = qtyString(qty)
	out.Stock.MinAlert = qtyString(minAlert)
	out.Stock.Status = stockStatus(p.TrackStock, qty, minAlert)
	out.Stock.CoverageQty = qtyString(new(big.Rat).Sub(qty, minAlert))
	stockQty := qty
	if stockQty.Sign() < 0 {
		stockQty = new(big.Rat)
	}
	out.Stock.CostValue = money(new(big.Rat).Mul(stockQty, cost))
	out.Stock.SaleValue = money(new(big.Rat).Mul(stockQty, price))
	out.Pricing.CostPrice = money(cost)
	out.Pricing.SalePrice = money(price)
	margin := new(big.Rat).Sub(price, cost)
	out.Pricing.UnitMargin = money(margin)
	out.Pricing.MarginPercent = percent(margin, price)

	scope := db.GetProductSalesStatsParams{OrganizationID: org, ProductID: p.ID}
	since := monthStart(s.now()).AddDate(0, -(trendMonths - 1), 0)

	if can(ctx, rbac.PermTenantSalesRead) {
		st, err := s.q.GetProductSalesStats(ctx, scope)
		if err != nil {
			return ProductSummary{}, err
		}
		block := &ProductSalesBlock{
			SaleCount:  st.SaleCount,
			SoldQty:    qtyString(ratOf(st.SoldQty)),
			Revenue:    money(ratOf(st.Revenue)),
			LastSoldAt: timePtr(st.LastSoldAt),
		}
		last, err := s.q.ListProductSaleMovements(ctx, db.ListProductSaleMovementsParams{OrganizationID: org, ProductID: p.ID, LimitCount: 20})
		if err != nil {
			return ProductSummary{}, err
		}
		for _, m := range last {
			if m.Status == "posted" {
				v := money(ratOf(m.UnitPrice))
				block.LastSalePrice = &v
				break
			}
		}
		months, err := s.q.ListProductMonthlySales(ctx, db.ListProductMonthlySalesParams{
			OrganizationID: org, ProductID: p.ID, Since: pgtype.Timestamptz{Time: since, Valid: true},
		})
		if err != nil {
			return ProductSummary{}, err
		}
		points := map[string]MonthPoint{}
		for _, m := range months {
			k := monthKey(m.Month.Time)
			points[k] = MonthPoint{Month: k, Qty: qtyString(ratOf(m.Qty)), Amount: money(ratOf(m.Revenue))}
		}
		block.Monthly = fillMonths(since, trendMonths, points, true)
		out.Sales = block
	}

	if can(ctx, rbac.PermTenantPurchasesRead) {
		st, err := s.q.GetProductPurchaseStats(ctx, db.GetProductPurchaseStatsParams(scope))
		if err != nil {
			return ProductSummary{}, err
		}
		purchased, spend := ratOf(st.PurchasedQty), ratOf(st.Spend)
		avg := new(big.Rat)
		if purchased.Sign() > 0 {
			avg.Quo(spend, purchased)
		}
		block := &ProductPurchaseBlock{
			PurchaseCount:   st.PurchaseCount,
			PurchasedQty:    qtyString(purchased),
			Spend:           money(spend),
			AvgUnitCost:     money(avg),
			LastPurchasedAt: timePtr(st.LastPurchasedAt),
		}
		last, err := s.q.ListProductPurchaseMovements(ctx, db.ListProductPurchaseMovementsParams{OrganizationID: org, ProductID: p.ID, LimitCount: 20})
		if err != nil {
			return ProductSummary{}, err
		}
		for _, m := range last {
			if m.Status == "posted" {
				v := money(ratOf(m.UnitCost))
				block.LastPurchaseCost = &v
				break
			}
		}
		out.Purchases = block
	}

	if can(ctx, rbac.PermTenantJobsRead) {
		st, err := s.q.GetProductJobStats(ctx, db.GetProductJobStatsParams(scope))
		if err != nil {
			return ProductSummary{}, err
		}
		out.Jobs = &ProductJobsBlock{
			LineJobCount:        st.LineJobCount,
			LineQty:             qtyString(ratOf(st.LineQty)),
			LineRevenue:         money(ratOf(st.LineRevenue)),
			ConsumptionJobCount: st.ConsumptionJobCount,
			ConsumedQty:         qtyString(ratOf(st.ConsumedQty)),
			LastConsumedAt:      timePtr(st.LastConsumedAt),
		}
	}
	return out, nil
}

// ProductMovements is the product's stock ledger, newest first: purchases
// (+), sales (-) and job consumptions (-), each kind limited to what the
// caller can read.
func (s *Service) ProductMovements(ctx context.Context, id uuid.UUID, limit int32) ([]ProductMovement, error) {
	org, err := orgID(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.q.GetProductByUUID(ctx, db.GetProductByUUIDParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return nil, notFound(err)
	}
	out := make([]ProductMovement, 0, limit)

	if can(ctx, rbac.PermTenantPurchasesRead) {
		rows, err := s.q.ListProductPurchaseMovements(ctx, db.ListProductPurchaseMovementsParams{OrganizationID: org, ProductID: p.ID, LimitCount: limit})
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			party := r.PartyUuid
			out = append(out, ProductMovement{
				Kind: "purchase", RefUUID: r.RefUuid, Status: r.Status, OccurredAt: r.OccurredAt.Time,
				PartyName: r.PartyName, PartyUUID: &party,
				Qty: qtyString(ratOf(r.Qty)), UnitPrice: money(ratOf(r.UnitCost)), Total: money(ratOf(r.LineTotal)),
				Currency: r.Currency, Effective: r.Status == "posted",
			})
		}
	}
	if can(ctx, rbac.PermTenantSalesRead) {
		rows, err := s.q.ListProductSaleMovements(ctx, db.ListProductSaleMovementsParams{OrganizationID: org, ProductID: p.ID, LimitCount: limit})
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			out = append(out, ProductMovement{
				Kind: "sale", RefUUID: r.RefUuid, Status: r.Status, OccurredAt: r.OccurredAt.Time,
				PartyName: r.PartyName, PartyUUID: uuidPtr(r.PartyUuid),
				Qty: qtyString(new(big.Rat).Neg(ratOf(r.Qty))), UnitPrice: money(ratOf(r.UnitPrice)), Total: money(ratOf(r.LineTotal)),
				Currency: r.Currency, Effective: r.Status == "posted",
			})
		}
	}
	if can(ctx, rbac.PermTenantJobsRead) {
		rows, err := s.q.ListProductConsumptionMovements(ctx, db.ListProductConsumptionMovementsParams{OrganizationID: org, ProductID: p.ID, LimitCount: limit})
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			q := ratOf(r.Qty)
			party := r.PartyUuid
			out = append(out, ProductMovement{
				Kind: "job", RefUUID: r.RefUuid, Status: r.Status, OccurredAt: r.OccurredAt.Time,
				PartyName: r.PartyName, PartyUUID: &party, Plate: r.Plate, ServiceName: r.ServiceName,
				Qty: qtyString(new(big.Rat).Neg(q)), UnitPrice: money(ratOf(r.UnitCost)),
				Total:    money(new(big.Rat).Mul(q, ratOf(r.UnitCost))),
				Currency: r.Currency, Effective: !r.RevertedAt.Valid,
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].OccurredAt.After(out[j].OccurredAt) })
	if int32(len(out)) > limit {
		out = out[:limit]
	}
	return out, nil
}

// ============================================================================
// Service
// ============================================================================

func (s *Service) ServiceSummary(ctx context.Context, id uuid.UUID) (ServiceSummary, error) {
	org, err := orgID(ctx)
	if err != nil {
		return ServiceSummary{}, err
	}
	sv, err := s.q.GetServiceByUUID(ctx, db.GetServiceByUUIDParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return ServiceSummary{}, notFound(err)
	}
	out := ServiceSummary{ServiceUUID: sv.Uuid, Currency: sv.Currency}
	recipe, err := s.q.ListServiceProducts(ctx, db.ListServiceProductsParams{OrganizationID: org, ServiceID: sv.ID})
	if err != nil {
		return ServiceSummary{}, err
	}
	cost := new(big.Rat)
	for _, r := range recipe {
		cost.Add(cost, new(big.Rat).Mul(ratOf(r.Qty), ratOf(r.CostPrice)))
	}
	price := ratOf(sv.Price)
	margin := new(big.Rat).Sub(price, cost)
	out.Pricing.Price = money(price)
	out.Pricing.RecipeCost = money(cost)
	out.Pricing.RecipeItemCount = len(recipe)
	out.Pricing.UnitMargin = money(margin)
	out.Pricing.MarginPercent = percent(margin, price)
	out.Pricing.DurationMinutes = sv.DurationMinutes

	if can(ctx, rbac.PermTenantJobsRead) {
		st, err := s.q.GetServiceUsageStats(ctx, db.GetServiceUsageStatsParams{OrganizationID: org, ServiceID: sv.ID})
		if err != nil {
			return ServiceSummary{}, err
		}
		avgMin, _ := ratOf(st.AvgJobMinutes).Float64()
		block := &ServiceUsageBlock{
			JobCount: st.JobCount, LineCount: st.LineCount, CustomerCount: st.CustomerCount,
			Qty: qtyString(ratOf(st.Qty)), Revenue: money(ratOf(st.Revenue)), AvgUnitPrice: money(ratOf(st.AvgUnitPrice)),
			AvgJobMinutes: avgMin, FirstUsedAt: timePtr(st.FirstUsedAt), LastUsedAt: timePtr(st.LastUsedAt),
		}
		since := monthStart(s.now()).AddDate(0, -(trendMonths - 1), 0)
		months, err := s.q.ListServiceMonthlyUsage(ctx, db.ListServiceMonthlyUsageParams{
			OrganizationID: org, ServiceID: sv.ID, Since: pgtype.Timestamptz{Time: since, Valid: true},
		})
		if err != nil {
			return ServiceSummary{}, err
		}
		points := map[string]MonthPoint{}
		for _, m := range months {
			k := monthKey(m.Month.Time)
			points[k] = MonthPoint{Month: k, Count: m.JobCount, Amount: money(ratOf(m.Revenue))}
		}
		block.Monthly = fillMonths(since, trendMonths, points, false)
		out.Usage = block
	}
	return out, nil
}

// ServiceJobs lists the jobs that have the service on a line (newest first).
// The route also requires the jobs read permission.
func (s *Service) ServiceJobs(ctx context.Context, id uuid.UUID, limit int32) ([]ServiceJob, error) {
	org, err := orgID(ctx)
	if err != nil {
		return nil, err
	}
	sv, err := s.q.GetServiceByUUID(ctx, db.GetServiceByUUIDParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return nil, notFound(err)
	}
	rows, err := s.q.ListServiceJobUsage(ctx, db.ListServiceJobUsageParams{OrganizationID: org, ServiceID: sv.ID, LimitCount: limit})
	if err != nil {
		return nil, err
	}
	out := make([]ServiceJob, 0, len(rows))
	for _, r := range rows {
		out = append(out, ServiceJob{
			UUID: r.Uuid, Status: r.Status, PaymentStatus: r.PaymentStatus,
			StartedAt: r.StartedAt.Time, CompletedAt: timePtr(r.CompletedAt),
			Plate: r.Plate, VehicleLabel: r.VehicleLabel, CustomerUUID: r.CustomerUuid, CustomerName: r.CustomerName,
			BrandUUID: r.BrandUuid, BrandName: r.BrandName, BrandLogoURL: BrandLogoURL(r.BrandUuid, r.BrandLogoObjectKey),
			Qty: qtyString(ratOf(r.Qty)), LineTotal: money(ratOf(r.LineTotal)), Currency: r.Currency,
		})
	}
	return out, nil
}

// ============================================================================
// Customer
// ============================================================================

func (s *Service) CustomerSummary(ctx context.Context, id uuid.UUID) (CustomerSummary, error) {
	org, err := orgID(ctx)
	if err != nil {
		return CustomerSummary{}, err
	}
	c, err := s.q.GetCustomerByUUID(ctx, db.GetCustomerByUUIDParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return CustomerSummary{}, notFound(err)
	}
	scope := db.GetCustomerJobStatsParams{OrganizationID: org, CustomerID: c.ID}
	out := CustomerSummary{
		CustomerUUID: c.Uuid,
		Monthly:      []MonthPoint{},
		TopServices:  []CustomerTopService{},
		Vehicles:     []CustomerVehicleStat{},
		RecentSales:  []CustomerSale{},
	}
	total := new(big.Rat)
	since := monthStart(s.now()).AddDate(0, -(trendMonths - 1), 0)
	canJobs, canSales := can(ctx, rbac.PermTenantJobsRead), can(ctx, rbac.PermTenantSalesRead)

	vehicles, err := s.q.ListCustomerVehicleStats(ctx, db.ListCustomerVehicleStatsParams(scope))
	if err != nil {
		return CustomerSummary{}, err
	}
	out.VehicleCount = len(vehicles)

	if canJobs {
		st, err := s.q.GetCustomerJobStats(ctx, scope)
		if err != nil {
			return CustomerSummary{}, err
		}
		spend := ratOf(st.Spend)
		total.Add(total, spend)
		out.Jobs = &CustomerJobsBlock{
			JobCount: st.JobCount, OpenJobCount: st.OpenJobCount, UnpaidJobCount: st.UnpaidJobCount,
			Spend: money(spend), UnpaidAmount: money(ratOf(st.UnpaidAmount)),
			FirstVisitAt: timePtr(st.FirstVisitAt), LastVisitAt: timePtr(st.LastVisitAt),
		}
		out.LastVisitAt = out.Jobs.LastVisitAt
		for _, v := range vehicles {
			out.Vehicles = append(out.Vehicles, CustomerVehicleStat{
				VehicleUUID: v.VehicleUuid, JobCount: v.JobCount, Spend: money(ratOf(v.Spend)), LastVisitAt: timePtr(v.LastVisitAt),
			})
		}
		top, err := s.q.ListCustomerTopServices(ctx, db.ListCustomerTopServicesParams{OrganizationID: org, CustomerID: c.ID, LimitCount: 5})
		if err != nil {
			return CustomerSummary{}, err
		}
		for _, t := range top {
			out.TopServices = append(out.TopServices, CustomerTopService{
				ServiceUUID: uuidPtr(t.ServiceUuid), Name: t.Name, JobCount: t.JobCount,
				Revenue: money(ratOf(t.Revenue)), LastUsedAt: timePtr(t.LastUsedAt),
			})
		}
	}

	if canSales {
		st, err := s.q.GetCustomerSalesStats(ctx, db.GetCustomerSalesStatsParams(scope))
		if err != nil {
			return CustomerSummary{}, err
		}
		spend := ratOf(st.Spend)
		total.Add(total, spend)
		out.Sales = &CustomerSalesBlock{SaleCount: st.SaleCount, Spend: money(spend), LastSoldAt: timePtr(st.LastSoldAt)}
		if last := out.Sales.LastSoldAt; last != nil && (out.LastVisitAt == nil || last.After(*out.LastVisitAt)) {
			out.LastVisitAt = last
		}
		recent, err := s.q.ListCustomerSales(ctx, db.ListCustomerSalesParams{OrganizationID: org, CustomerID: c.ID, LimitCount: 20})
		if err != nil {
			return CustomerSummary{}, err
		}
		for _, r := range recent {
			out.RecentSales = append(out.RecentSales, CustomerSale{
				UUID: r.Uuid, Status: r.Status, Method: r.Method, TotalAmount: money(ratOf(r.TotalAmount)),
				Currency: r.Currency, SoldAt: r.SoldAt.Time, LineCount: r.LineCount,
			})
		}
	}

	if canJobs || canSales {
		months, err := s.q.ListCustomerMonthlySpend(ctx, db.ListCustomerMonthlySpendParams{
			OrganizationID: org, CustomerID: c.ID, Since: pgtype.Timestamptz{Time: since, Valid: true},
		})
		if err != nil {
			return CustomerSummary{}, err
		}
		points := map[string]MonthPoint{}
		for _, m := range months {
			k := monthKey(m.Month.Time)
			jobs, sales := ratOf(m.JobAmount), ratOf(m.SaleAmount)
			if !canJobs {
				jobs = new(big.Rat)
			}
			if !canSales {
				sales = new(big.Rat)
			}
			points[k] = MonthPoint{Month: k, Amount: money(jobs), Amount2: money(sales)}
		}
		out.Monthly = fillMonths(since, trendMonths, points, false)
		for i := range out.Monthly {
			if out.Monthly[i].Amount2 == "" {
				out.Monthly[i].Amount2 = "0.00"
			}
		}
	}

	canQuotes, canLeads := can(ctx, rbac.PermTenantQuotesRead), can(ctx, rbac.PermTenantLeadsRead)
	if canQuotes || canLeads {
		st, err := s.q.GetCustomerPipelineStats(ctx, db.GetCustomerPipelineStatsParams(scope))
		if err != nil {
			return CustomerSummary{}, err
		}
		if canQuotes {
			out.Quotes = &CustomerQuotesBlock{QuoteCount: st.QuoteCount, OpenQuoteCount: st.OpenQuoteCount, AcceptedQuoteCount: st.AcceptedQuoteCount}
		}
		if canLeads {
			out.Leads = &CustomerLeadsBlock{LeadCount: st.LeadCount, OpenLeadCount: st.OpenLeadCount}
		}
	}
	out.TotalSpend = money(total)
	return out, nil
}

// ============================================================================
// Supplier
// ============================================================================

func (s *Service) SupplierSummary(ctx context.Context, id uuid.UUID) (SupplierSummary, error) {
	org, err := orgID(ctx)
	if err != nil {
		return SupplierSummary{}, err
	}
	sp, err := s.q.GetSupplierByUUID(ctx, db.GetSupplierByUUIDParams{Uuid: id, OrganizationID: org})
	if err != nil {
		return SupplierSummary{}, notFound(err)
	}
	out := SupplierSummary{SupplierUUID: sp.Uuid}
	if !can(ctx, rbac.PermTenantPurchasesRead) {
		return out, nil
	}
	st, err := s.q.GetSupplierPurchaseStats(ctx, db.GetSupplierPurchaseStatsParams{OrganizationID: org, SupplierID: sp.ID})
	if err != nil {
		return SupplierSummary{}, err
	}
	spend := ratOf(st.Spend)
	avg := new(big.Rat)
	if st.PurchaseCount > 0 {
		avg.Quo(spend, new(big.Rat).SetInt64(st.PurchaseCount))
	}
	block := &SupplierPurchaseBlock{
		PurchaseCount: st.PurchaseCount, Spend: money(spend), AvgPurchase: money(avg), ProductCount: st.ProductCount,
		FirstPurchasedAt: timePtr(st.FirstPurchasedAt), LastPurchasedAt: timePtr(st.LastPurchasedAt),
		TopProducts: []SupplierTopProduct{}, Recent: []SupplierPurchase{},
	}
	since := monthStart(s.now()).AddDate(0, -(trendMonths - 1), 0)
	months, err := s.q.ListSupplierMonthlySpend(ctx, db.ListSupplierMonthlySpendParams{
		OrganizationID: org, SupplierID: sp.ID, Since: pgtype.Timestamptz{Time: since, Valid: true},
	})
	if err != nil {
		return SupplierSummary{}, err
	}
	points := map[string]MonthPoint{}
	for _, m := range months {
		k := monthKey(m.Month.Time)
		points[k] = MonthPoint{Month: k, Count: m.PurchaseCount, Amount: money(ratOf(m.Spend))}
	}
	block.Monthly = fillMonths(since, trendMonths, points, false)

	top, err := s.q.ListSupplierTopProducts(ctx, db.ListSupplierTopProductsParams{OrganizationID: org, SupplierID: sp.ID, LimitCount: 10})
	if err != nil {
		return SupplierSummary{}, err
	}
	for _, t := range top {
		block.TopProducts = append(block.TopProducts, SupplierTopProduct{
			ProductUUID: t.ProductUuid, Name: t.Name, Unit: t.Unit, Qty: qtyString(ratOf(t.Qty)),
			Spend: money(ratOf(t.Spend)), LastPurchasedAt: timePtr(t.LastPurchasedAt),
		})
	}
	recent, err := s.q.ListSupplierPurchases(ctx, db.ListSupplierPurchasesParams{OrganizationID: org, SupplierID: sp.ID, LimitCount: 50})
	if err != nil {
		return SupplierSummary{}, err
	}
	for _, r := range recent {
		block.Recent = append(block.Recent, SupplierPurchase{
			UUID: r.Uuid, Status: r.Status, Method: r.Method, TotalAmount: money(ratOf(r.TotalAmount)),
			Currency: r.Currency, PurchasedAt: r.PurchasedAt.Time, LineCount: r.LineCount,
		})
	}
	out.Purchases = block
	return out, nil
}

// ============================================================================
// Helpers
// ============================================================================

// BrandLogoURL is the API-owned public logo stream of a vehicle brand, or nil
// when the brand has no logo (the UI then shows the initial monogram).
func BrandLogoURL(brandUUID uuid.UUID, key pgtype.Text) *string {
	return brandlogo.URL(brandUUID, key)
}

func ratOf(n pgtype.Numeric) *big.Rat {
	if !n.Valid || n.Int == nil {
		return new(big.Rat)
	}
	r := new(big.Rat).SetInt(n.Int)
	if n.Exp != 0 {
		p := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(abs32(n.Exp))), nil)
		if n.Exp > 0 {
			r.Mul(r, new(big.Rat).SetInt(p))
		} else {
			r.Quo(r, new(big.Rat).SetInt(p))
		}
	}
	return r
}

func abs32(v int32) int32 {
	if v < 0 {
		return -v
	}
	return v
}

// money renders a two-decimal amount ("12.50").
func money(r *big.Rat) string { return r.FloatString(2) }

// qtyString renders a quantity without trailing zeros ("1.5", "2", "-3").
func qtyString(r *big.Rat) string {
	out := r.FloatString(3)
	out = strings.TrimRight(strings.TrimRight(out, "0"), ".")
	if out == "" || out == "-" || out == "-0" {
		return "0"
	}
	return out
}

// percent is part / whole * 100 rounded to one decimal; 0 when whole is 0.
func percent(part, whole *big.Rat) float64 {
	if whole.Sign() == 0 {
		return 0
	}
	v, _ := new(big.Rat).Mul(new(big.Rat).Quo(part, whole), big.NewRat(100, 1)).Float64()
	return float64(int64(v*10+sign(v)*0.5)) / 10
}

func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}

func stockStatus(tracked bool, qty, minAlert *big.Rat) string {
	if !tracked {
		return "untracked"
	}
	if qty.Sign() <= 0 {
		return "out_of_stock"
	}
	if qty.Cmp(minAlert) <= 0 {
		return "low_stock"
	}
	return "in_stock"
}

func timePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func uuidPtr(u pgtype.UUID) *uuid.UUID {
	if !u.Valid {
		return nil
	}
	v := uuid.UUID(u.Bytes)
	return &v
}

// monthStart is midnight (Europe/Istanbul) of the business month of t. The
// SQL buckets with date_trunc('month', ...) in the session time zone, which
// is the same zone (database.SessionTimeZone).
func monthStart(t time.Time) time.Time { return bizclock.MonthStart(t) }

// monthKey is the business month (YYYY-MM, Europe/Istanbul) of instant t.
func monthKey(t time.Time) string {
	l := bizclock.In(t)
	return fmt.Sprintf("%04d-%02d", l.Year(), int(l.Month()))
}

// fillMonths returns n consecutive months from `from`, using points where
// present and zero rows elsewhere.
func fillMonths(from time.Time, n int, points map[string]MonthPoint, withQty bool) []MonthPoint {
	out := make([]MonthPoint, 0, n)
	for i := 0; i < n; i++ {
		k := monthKey(from.AddDate(0, i, 0))
		if p, ok := points[k]; ok {
			out = append(out, p)
			continue
		}
		p := MonthPoint{Month: k, Amount: "0.00"}
		if withQty {
			p.Qty = "0"
		}
		out = append(out, p)
	}
	return out
}
