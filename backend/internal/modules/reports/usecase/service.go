package usecase

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourcemeta"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var ErrInvalidRequest = errors.New("invalid request")

type Service struct {
	q *db.Queries
}

func New(q *db.Queries) *Service {
	return &Service{q: q}
}

func (s *Service) ResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantReports()
}

type Query struct {
	DateFrom      string
	DateTo        string
	Currency      string
	PaymentMethod string
	AccountUUID   string
	SourceType    string
	Granularity   string
}

func (s *Service) Overview(ctx context.Context, in Query) (Overview, error) {
	orgID, err := requireOrgID(ctx)
	if err != nil {
		return Overview{}, err
	}
	from, to, err := parseRange(in.DateFrom, in.DateTo)
	if err != nil {
		return Overview{}, err
	}
	granularity := normalizeGranularity(in.Granularity)
	currency := optionalText(strings.ToUpper(strings.TrimSpace(in.Currency)))
	paymentMethod, err := optionalPaymentMethod(in.PaymentMethod)
	if err != nil {
		return Overview{}, err
	}
	sourceType, err := optionalSourceType(in.SourceType)
	if err != nil {
		return Overview{}, err
	}
	var accountID pgtype.Int8
	var accountUUIDStr *string
	if raw := strings.TrimSpace(in.AccountUUID); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			return Overview{}, fmt.Errorf("%w: account_uuid is invalid", ErrInvalidRequest)
		}
		aid, err := s.q.GetFinanceAccountIDByUUIDForReport(ctx, db.GetFinanceAccountIDByUUIDForReportParams{
			Uuid: id, OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Overview{}, fmt.Errorf("%w: account not found", ErrInvalidRequest)
			}
			return Overview{}, err
		}
		accountID = pgtype.Int8{Int64: aid, Valid: true}
		s := id.String()
		accountUUIDStr = &s
	}

	tsFrom := pgtype.Timestamptz{Time: from.Time, Valid: true}
	tsTo := pgtype.Timestamptz{Time: to.Time.Add(24 * time.Hour), Valid: true}

	finParams := db.ReportFinanceTotalsParams{
		OrganizationID: orgID,
		DateFrom:       from,
		DateTo:         to,
		Currency:       currency,
		SourceType:     sourceType,
		AccountID:      accountID,
	}
	finance, err := s.q.ReportFinanceTotals(ctx, finParams)
	if err != nil {
		return Overview{}, err
	}

	jobs, err := s.q.ReportJobStats(ctx, db.ReportJobStatsParams{
		OrganizationID: orgID, TsFrom: tsFrom, TsTo: tsTo, Currency: currency,
	})
	if err != nil {
		return Overview{}, err
	}

	sales, err := s.q.ReportProductSaleStats(ctx, db.ReportProductSaleStatsParams{
		OrganizationID: orgID, TsFrom: tsFrom, TsTo: tsTo, Currency: currency, PaymentMethod: paymentMethod,
	})
	if err != nil {
		return Overview{}, err
	}

	purchases, err := s.q.ReportPurchaseStats(ctx, db.ReportPurchaseStatsParams{
		OrganizationID: orgID, TsFrom: tsFrom, TsTo: tsTo, Currency: currency, PaymentMethod: paymentMethod,
	})
	if err != nil {
		return Overview{}, err
	}

	cari, err := s.q.ReportCariPeriodTotals(ctx, db.ReportCariPeriodTotalsParams{
		OrganizationID: orgID, DateFrom: from, DateTo: to, Currency: currency,
	})
	if err != nil {
		return Overview{}, err
	}

	expenseCats, err := s.q.ReportExpensesByCategory(ctx, db.ReportExpensesByCategoryParams{
		OrganizationID: orgID, DateFrom: from, DateTo: to, Currency: currency, SourceType: sourceType, AccountID: accountID,
	})
	if err != nil {
		return Overview{}, err
	}
	incomeCats, err := s.q.ReportIncomeByCategory(ctx, db.ReportIncomeByCategoryParams{
		OrganizationID: orgID, DateFrom: from, DateTo: to, Currency: currency, SourceType: sourceType, AccountID: accountID,
	})
	if err != nil {
		return Overview{}, err
	}
	bySource, err := s.q.ReportFinanceBySource(ctx, db.ReportFinanceBySourceParams{
		OrganizationID: orgID, DateFrom: from, DateTo: to, Currency: currency, SourceType: sourceType, AccountID: accountID,
	})
	if err != nil {
		return Overview{}, err
	}
	services, err := s.q.ReportServicesDistribution(ctx, db.ReportServicesDistributionParams{
		OrganizationID: orgID, TsFrom: tsFrom, TsTo: tsTo, Currency: currency,
	})
	if err != nil {
		return Overview{}, err
	}
	products, err := s.q.ReportProductsDistribution(ctx, db.ReportProductsDistributionParams{
		OrganizationID: orgID, TsFrom: tsFrom, TsTo: tsTo, Currency: currency, PaymentMethod: paymentMethod,
	})
	if err != nil {
		return Overview{}, err
	}
	jobPay, err := s.q.ReportJobPaymentsByMethod(ctx, db.ReportJobPaymentsByMethodParams{
		OrganizationID: orgID, TsFrom: tsFrom, TsTo: tsTo, Currency: currency, PaymentMethod: paymentMethod,
	})
	if err != nil {
		return Overview{}, err
	}
	salePay, err := s.q.ReportProductSalesByMethod(ctx, db.ReportProductSalesByMethodParams{
		OrganizationID: orgID, TsFrom: tsFrom, TsTo: tsTo, Currency: currency, PaymentMethod: paymentMethod,
	})
	if err != nil {
		return Overview{}, err
	}
	receivables, err := s.q.ReportCariOutstanding(ctx, db.ReportCariOutstandingParams{
		OrganizationID: orgID, Currency: currency,
	})
	if err != nil {
		return Overview{}, err
	}
	topCustomers, err := s.q.ReportTopCustomers(ctx, db.ReportTopCustomersParams{
		OrganizationID: orgID, TsFrom: tsFrom, TsTo: tsTo, Currency: currency,
	})
	if err != nil {
		return Overview{}, err
	}
	finTS, err := s.q.ReportFinanceTimeseries(ctx, db.ReportFinanceTimeseriesParams{
		Granularity: granularity, OrganizationID: orgID, DateFrom: from, DateTo: to,
		Currency: currency, SourceType: sourceType, AccountID: accountID,
	})
	if err != nil {
		return Overview{}, err
	}
	jobTS, err := s.q.ReportJobsTimeseries(ctx, db.ReportJobsTimeseriesParams{
		Granularity: granularity, OrganizationID: orgID, TsFrom: tsFrom, TsTo: tsTo, Currency: currency,
	})
	if err != nil {
		return Overview{}, err
	}

	payments := mergePaymentMethods(jobPay, salePay)
	cash, card, cariPay := "0.00", "0.00", "0.00"
	for _, p := range payments {
		switch p.Key {
		case "cash":
			cash = p.Total
		case "card":
			card = p.Total
		case "cari":
			cariPay = p.Total
		}
	}

	outstanding := "0.00"
	receivableRows := make([]CariReceivable, 0, len(receivables))
	for _, row := range receivables {
		outstanding = addAmounts(outstanding, financeusecase.NumericToString(row.Balance))
		var last *string
		if row.LastEntryDate.Valid {
			s := row.LastEntryDate.Time.Format("2006-01-02")
			last = &s
		}
		receivableRows = append(receivableRows, CariReceivable{
			AccountUUID: row.AccountUuid, CustomerUUID: row.CustomerUuid,
			CustomerName: row.CustomerName, CustomerPhone: row.CustomerPhone,
			Currency: row.Currency, Balance: financeusecase.NumericToString(row.Balance),
			LastEntryDate: last,
		})
	}

	income := financeusecase.NumericToString(finance.TotalIncome)
	expense := financeusecase.NumericToString(finance.TotalExpense)

	var currencyPtr *string
	if currency.Valid {
		c := currency.String
		currencyPtr = &c
	}
	var methodPtr *string
	if paymentMethod.Valid {
		m := paymentMethod.String
		methodPtr = &m
	}
	var sourcePtr *string
	if sourceType.Valid {
		st := sourceType.String
		sourcePtr = &st
	}

	out := Overview{
		Filters: Filters{
			DateFrom: formatDate(from), DateTo: formatDate(to),
			Currency: currencyPtr, PaymentMethod: methodPtr,
			AccountUUID: accountUUIDStr, SourceType: sourcePtr,
			Granularity: granularity,
		},
		KPIs: KPIs{
			TotalIncome: income, TotalExpense: expense, NetProfit: subtractAmounts(income, expense),
			IncomeCount: finance.IncomeCount, ExpenseCount: finance.ExpenseCount,
			JobCount: jobs.JobCount, JobPaidCount: jobs.PaidCount, JobDoneCount: jobs.DoneCount,
			JobInProgress: jobs.InProgressCount, JobCancelled: jobs.CancelledCount,
			JobPaidTotal:   financeusecase.NumericToString(jobs.PaidTotal),
			AvgTicket:      financeusecase.NumericToString(jobs.AvgTicket),
			VehiclesServed: jobs.VehiclesServed,
			SaleCount:      sales.SaleCount, SaleTotal: financeusecase.NumericToString(sales.SaleTotal),
			PurchaseCount: purchases.PurchaseCount, PurchaseTotal: financeusecase.NumericToString(purchases.PurchaseTotal),
			CariCharged:     financeusecase.NumericToString(cari.Charged),
			CariCollected:   financeusecase.NumericToString(cari.Collected),
			CariOutstanding: outstanding,
			CariChargeCount: cari.ChargeCount, CariPaymentCount: cari.PaymentCount,
			CashTotal: cash, CardTotal: card, CariPaymentTotal: cariPay,
		},
		Timeseries:         mergeTimeseries(finTS, jobTS),
		Services:           mapNamedFromServices(services),
		Products:           mapNamedFromProducts(products),
		ExpensesByCategory: mapNamedFromCategories(expenseCats),
		IncomeByCategory:   mapNamedFromIncomeCategories(incomeCats),
		PaymentsByMethod:   payments,
		RevenueBySource:    mapSourceTotals(bySource),
		CariReceivables:    receivableRows,
		TopCustomers:       mapTopCustomers(topCustomers),
		GeneratedAt:        time.Now().UTC(),
	}
	return out, nil
}

func requireOrgID(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, errors.New("organization context required")
	}
	return scope.InternalID, nil
}

func parseRange(fromRaw, toRaw string) (pgtype.Date, pgtype.Date, error) {
	now := time.Now().UTC()
	from := pgtype.Date{Time: time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC), Valid: true}
	to := pgtype.Date{Time: time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC), Valid: true}
	if strings.TrimSpace(fromRaw) != "" {
		t, err := time.Parse("2006-01-02", strings.TrimSpace(fromRaw))
		if err != nil {
			return pgtype.Date{}, pgtype.Date{}, fmt.Errorf("%w: date_from is invalid", ErrInvalidRequest)
		}
		from = pgtype.Date{Time: t.UTC(), Valid: true}
	}
	if strings.TrimSpace(toRaw) != "" {
		t, err := time.Parse("2006-01-02", strings.TrimSpace(toRaw))
		if err != nil {
			return pgtype.Date{}, pgtype.Date{}, fmt.Errorf("%w: date_to is invalid", ErrInvalidRequest)
		}
		to = pgtype.Date{Time: t.UTC(), Valid: true}
	}
	if to.Time.Before(from.Time) {
		return pgtype.Date{}, pgtype.Date{}, fmt.Errorf("%w: date_to must be on or after date_from", ErrInvalidRequest)
	}
	// Cap range at 366 days to keep aggregates snappy.
	if to.Time.Sub(from.Time) > 366*24*time.Hour {
		return pgtype.Date{}, pgtype.Date{}, fmt.Errorf("%w: date range cannot exceed 366 days", ErrInvalidRequest)
	}
	return from, to, nil
}

func formatDate(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format("2006-01-02")
}

func normalizeGranularity(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "week":
		return "week"
	case "month":
		return "month"
	default:
		return "day"
	}
}

func optionalText(raw string) pgtype.Text {
	if raw == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: raw, Valid: true}
}

func optionalPaymentMethod(raw string) (pgtype.Text, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" || raw == "all" {
		return pgtype.Text{}, nil
	}
	switch raw {
	case "cash", "card", "cari":
		return pgtype.Text{String: raw, Valid: true}, nil
	default:
		return pgtype.Text{}, fmt.Errorf("%w: payment_method is invalid", ErrInvalidRequest)
	}
}

func optionalSourceType(raw string) (pgtype.Text, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" || raw == "all" {
		return pgtype.Text{}, nil
	}
	switch raw {
	case "manual", "cari_payment", "service_job", "product_sale", "purchase":
		return pgtype.Text{String: raw, Valid: true}, nil
	default:
		return pgtype.Text{}, fmt.Errorf("%w: source_type is invalid", ErrInvalidRequest)
	}
}

func mapNamedFromServices(rows []db.ReportServicesDistributionRow) []NamedTotal {
	out := make([]NamedTotal, 0, len(rows))
	for _, r := range rows {
		out = append(out, NamedTotal{
			Name: r.ServiceName, Total: financeusecase.NumericToString(r.Total),
			Count: r.LineCount, Qty: financeusecase.NumericToString(r.Qty),
		})
	}
	return out
}

func mapNamedFromProducts(rows []db.ReportProductsDistributionRow) []NamedTotal {
	out := make([]NamedTotal, 0, len(rows))
	for _, r := range rows {
		out = append(out, NamedTotal{
			Name: r.ProductName, Total: financeusecase.NumericToString(r.Total),
			Count: r.LineCount, Qty: financeusecase.NumericToString(r.Qty),
		})
	}
	return out
}

func mapNamedFromCategories(rows []db.ReportExpensesByCategoryRow) []NamedTotal {
	out := make([]NamedTotal, 0, len(rows))
	for _, r := range rows {
		out = append(out, NamedTotal{
			Key: r.CategoryUuid.String(), Name: r.CategoryName,
			Total: financeusecase.NumericToString(r.Total), Count: r.Count,
		})
	}
	return out
}

func mapNamedFromIncomeCategories(rows []db.ReportIncomeByCategoryRow) []NamedTotal {
	out := make([]NamedTotal, 0, len(rows))
	for _, r := range rows {
		out = append(out, NamedTotal{
			Key: r.CategoryUuid.String(), Name: r.CategoryName,
			Total: financeusecase.NumericToString(r.Total), Count: r.Count,
		})
	}
	return out
}

func mapSourceTotals(rows []db.ReportFinanceBySourceRow) []SourceTotal {
	out := make([]SourceTotal, 0, len(rows))
	for _, r := range rows {
		source := ""
		if r.SourceType.Valid {
			source = r.SourceType.String
		}
		out = append(out, SourceTotal{
			SourceType: source, Type: r.Type,
			Total: financeusecase.NumericToString(r.Total), Count: r.Count,
		})
	}
	return out
}

func mapTopCustomers(rows []db.ReportTopCustomersRow) []TopCustomer {
	out := make([]TopCustomer, 0, len(rows))
	for _, r := range rows {
		out = append(out, TopCustomer{
			CustomerUUID: r.CustomerUuid, CustomerName: r.CustomerName,
			JobTotal: financeusecase.NumericToString(r.JobTotal), JobCount: r.JobCount,
		})
	}
	return out
}

func mergePaymentMethods(jobs []db.ReportJobPaymentsByMethodRow, sales []db.ReportProductSalesByMethodRow) []NamedTotal {
	acc := map[string]*NamedTotal{}
	order := []string{"cash", "card", "cari"}
	for _, m := range order {
		acc[m] = &NamedTotal{Key: m, Name: m, Total: "0.00"}
	}
	add := func(method, total string, count int64) {
		row, ok := acc[method]
		if !ok {
			row = &NamedTotal{Key: method, Name: method, Total: "0.00"}
			acc[method] = row
			order = append(order, method)
		}
		row.Total = addAmounts(row.Total, total)
		row.Count += count
	}
	for _, r := range jobs {
		add(r.Method, financeusecase.NumericToString(r.Total), r.Count)
	}
	for _, r := range sales {
		add(r.Method, financeusecase.NumericToString(r.Total), r.Count)
	}
	out := make([]NamedTotal, 0, len(order))
	for _, m := range order {
		if row := acc[m]; row != nil && (row.Count > 0 || row.Total != "0.00") {
			out = append(out, *row)
		}
	}
	return out
}

func mergeTimeseries(fin []db.ReportFinanceTimeseriesRow, jobs []db.ReportJobsTimeseriesRow) []TimeseriesPoint {
	type bucket struct {
		income, expense, jobPaid string
		jobCount                 int64
	}
	m := map[string]*bucket{}
	order := make([]string, 0)
	ensure := func(d string) *bucket {
		if b, ok := m[d]; ok {
			return b
		}
		b := &bucket{income: "0.00", expense: "0.00", jobPaid: "0.00"}
		m[d] = b
		order = append(order, d)
		return b
	}
	for _, r := range fin {
		if !r.Bucket.Valid {
			continue
		}
		d := r.Bucket.Time.Format("2006-01-02")
		b := ensure(d)
		b.income = financeusecase.NumericToString(r.Income)
		b.expense = financeusecase.NumericToString(r.Expense)
	}
	for _, r := range jobs {
		if !r.Bucket.Valid {
			continue
		}
		d := r.Bucket.Time.Format("2006-01-02")
		b := ensure(d)
		b.jobPaid = financeusecase.NumericToString(r.PaidTotal)
		b.jobCount = r.PaidCount
	}
	out := make([]TimeseriesPoint, 0, len(order))
	for _, d := range order {
		b := m[d]
		out = append(out, TimeseriesPoint{
			Date: d, Income: b.income, Expense: b.expense,
			Net:     subtractAmounts(b.income, b.expense),
			JobPaid: b.jobPaid, JobCount: b.jobCount,
		})
	}
	return out
}

func addAmounts(a, b string) string {
	x, _ := new(big.Rat).SetString(a)
	y, _ := new(big.Rat).SetString(b)
	if x == nil {
		x = new(big.Rat)
	}
	if y == nil {
		y = new(big.Rat)
	}
	x.Add(x, y)
	f, _ := x.Float64()
	return fmt.Sprintf("%.2f", f)
}

func subtractAmounts(a, b string) string {
	x, _ := new(big.Rat).SetString(a)
	y, _ := new(big.Rat).SetString(b)
	if x == nil {
		x = new(big.Rat)
	}
	if y == nil {
		y = new(big.Rat)
	}
	x.Sub(x, y)
	f, _ := x.Float64()
	return fmt.Sprintf("%.2f", f)
}
