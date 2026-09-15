package adapters

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	reportsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reports/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

const ResourceReports = "tenant.reports"

type ReportsAdapter struct {
	svc *reportsusecase.Service
}

func NewReports(q *db.Queries) *ReportsAdapter {
	return &ReportsAdapter{svc: reportsusecase.New(q)}
}

func (a *ReportsAdapter) Resource() string { return ResourceReports }

func (a *ReportsAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "section", LabelKey: "reports.section", Type: ioengine.ColumnTypeString},
		{Key: "label", LabelKey: "reports.label", Type: ioengine.ColumnTypeString},
		{Key: "metric", LabelKey: "reports.metric", Type: ioengine.ColumnTypeString},
		{Key: "count", LabelKey: "reports.count", Type: ioengine.ColumnTypeString},
		{Key: "amount", LabelKey: "reports.amount", Type: ioengine.ColumnTypeString},
		{Key: "date", LabelKey: "reports.date", Type: ioengine.ColumnTypeString},
		{Key: "extra", LabelKey: "reports.extra", Type: ioengine.ColumnTypeString},
	}
}

func (a *ReportsAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	ctx = orgctx.WithScope(ctx, orgctx.Scope{InternalID: orgID})
	overview, err := a.svc.Overview(ctx, reportsusecase.Query{
		DateFrom:      strings.TrimSpace(query["date_from"]),
		DateTo:        strings.TrimSpace(query["date_to"]),
		Currency:      strings.TrimSpace(query["currency"]),
		PaymentMethod: strings.TrimSpace(query["payment_method"]),
		AccountUUID:   strings.TrimSpace(query["account_uuid"]),
		SourceType:    strings.TrimSpace(query["source_type"]),
		Granularity:   strings.TrimSpace(query["granularity"]),
	})
	if err != nil {
		return ioengine.Dataset{}, err
	}
	section := strings.ToLower(strings.TrimSpace(query["section"]))
	rows := flattenOverview(overview, section)
	return ioengine.Dataset{Resource: ResourceReports, Columns: a.ExportColumns(), Rows: rows}, nil
}

func flattenOverview(o reportsusecase.Overview, section string) []map[string]any {
	include := func(name string) bool {
		return section == "" || section == "all" || section == name
	}
	out := make([]map[string]any, 0, 128)
	row := func(sec, label, metric string, count int64, amount, date, extra string) {
		out = append(out, map[string]any{
			"section": sec,
			"label":   label,
			"metric":  metric,
			"count":   strconv.FormatInt(count, 10),
			"amount":  amount,
			"date":    date,
			"extra":   extra,
		})
	}

	if include("kpis") {
		k := o.KPIs
		row("kpis", "total_income", "kpi", k.IncomeCount, k.TotalIncome, "", "")
		row("kpis", "total_expense", "kpi", k.ExpenseCount, k.TotalExpense, "", "")
		row("kpis", "net_profit", "kpi", 0, k.NetProfit, "", "")
		row("kpis", "job_paid_total", "kpi", k.JobPaidCount, k.JobPaidTotal, "", "")
		row("kpis", "avg_ticket", "kpi", 0, k.AvgTicket, "", "")
		row("kpis", "vehicles_served", "kpi", k.VehiclesServed, "0.00", "", "")
		row("kpis", "sale_total", "kpi", k.SaleCount, k.SaleTotal, "", "")
		row("kpis", "purchase_total", "kpi", k.PurchaseCount, k.PurchaseTotal, "", "")
		row("kpis", "cari_charged", "kpi", k.CariChargeCount, k.CariCharged, "", "")
		row("kpis", "cari_collected", "kpi", k.CariPaymentCount, k.CariCollected, "", "")
		row("kpis", "cari_outstanding", "kpi", 0, k.CariOutstanding, "", "")
		row("kpis", "cash_total", "kpi", 0, k.CashTotal, "", "")
		row("kpis", "card_total", "kpi", 0, k.CardTotal, "", "")
		row("kpis", "cari_payment_total", "kpi", 0, k.CariPaymentTotal, "", "")
	}
	if include("timeseries") {
		for _, p := range o.Timeseries {
			row("timeseries", "income", "series", 0, p.Income, p.Date, "")
			row("timeseries", "expense", "series", 0, p.Expense, p.Date, "")
			row("timeseries", "net", "series", 0, p.Net, p.Date, "")
			row("timeseries", "job_paid", "series", p.JobCount, p.JobPaid, p.Date, "")
		}
	}
	if include("services") {
		for _, s := range o.Services {
			row("services", s.Name, "service", s.Count, s.Total, "", s.Qty)
		}
	}
	if include("products") {
		for _, s := range o.Products {
			row("products", s.Name, "product", s.Count, s.Total, "", s.Qty)
		}
	}
	if include("expenses") {
		for _, s := range o.ExpensesByCategory {
			row("expenses", s.Name, "category", s.Count, s.Total, "", s.Key)
		}
	}
	if include("income") {
		for _, s := range o.IncomeByCategory {
			row("income", s.Name, "category", s.Count, s.Total, "", s.Key)
		}
	}
	if include("payments") {
		for _, s := range o.PaymentsByMethod {
			row("payments", s.Name, "method", s.Count, s.Total, "", s.Key)
		}
	}
	if include("sources") {
		for _, s := range o.RevenueBySource {
			row("sources", s.SourceType, s.Type, s.Count, s.Total, "", "")
		}
	}
	if include("cari") {
		for _, s := range o.CariReceivables {
			date := ""
			if s.LastEntryDate != nil {
				date = *s.LastEntryDate
			}
			row("cari", s.CustomerName, "receivable", 0, s.Balance, date, s.CustomerPhone)
		}
	}
	if include("customers") {
		for _, s := range o.TopCustomers {
			row("customers", s.CustomerName, "top_customer", s.JobCount, s.JobTotal, "", s.CustomerUUID.String())
		}
	}
	return out
}

func (a *ReportsAdapter) ImportSchema() []ioengine.ImportField { return nil }

func (a *ReportsAdapter) ApplyRow(_ context.Context, _ map[string]any, _ map[string]any) (ioengine.RowResult, error) {
	return ioengine.RowResult{}, fmt.Errorf("reports import is not supported")
}

func (a *ReportsAdapter) RevertRow(_ context.Context, _, _ string, _ map[string]any) error {
	return fmt.Errorf("reports import is not supported")
}

var _ ioengine.ResourceAdapter = (*ReportsAdapter)(nil)
