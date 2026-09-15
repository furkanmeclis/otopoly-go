package adapters

import (
	"context"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine"
	"github.com/jackc/pgx/v5/pgtype"
)

const ResourceSales = "tenant.sales"

type SalesAdapter struct {
	q *db.Queries
}

func NewSales(q *db.Queries) *SalesAdapter {
	return &SalesAdapter{q: q}
}

func (a *SalesAdapter) Resource() string { return ResourceSales }

func (a *SalesAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "customer_name", LabelKey: "sales.customer_name", Type: ioengine.ColumnTypeString},
		{Key: "customer_phone", LabelKey: "sales.customer_phone", Type: ioengine.ColumnTypeString},
		{Key: "method", LabelKey: "sales.method", Type: ioengine.ColumnTypeString},
		{Key: "status", LabelKey: "sales.status", Type: ioengine.ColumnTypeString},
		{Key: "total_amount", LabelKey: "sales.total_amount", Type: ioengine.ColumnTypeString},
		{Key: "currency", LabelKey: "sales.currency", Type: ioengine.ColumnTypeString},
		{Key: "sold_at", LabelKey: "sales.sold_at", Type: ioengine.ColumnTypeDatetime},
		{Key: "notes", LabelKey: "sales.notes", Type: ioengine.ColumnTypeString},
		{Key: "uuid", LabelKey: "sales.uuid", Type: ioengine.ColumnTypeString},
	}
}

func (a *SalesAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	params := db.ListProductSalesForExportParams{OrganizationID: orgID}
	if q := strings.TrimSpace(query["q"]); q != "" {
		params.Q = pgtype.Text{String: q, Valid: true}
	}
	if v := strings.TrimSpace(query["status"]); v != "" {
		params.Status = pgtype.Text{String: v, Valid: true}
	}
	rows, err := a.q.ListProductSalesForExport(ctx, params)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, map[string]any{
			"customer_name":  row.CustomerName,
			"customer_phone": row.CustomerPhone,
			"method":         row.Method,
			"status":         row.Status,
			"total_amount":   formatNumeric(row.TotalAmount),
			"currency":       row.Currency,
			"sold_at":        row.SoldAt.Time,
			"notes":          row.Notes,
			"uuid":           row.Uuid.String(),
		})
	}
	return ioengine.Dataset{Resource: ResourceSales, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *SalesAdapter) ImportSchema() []ioengine.ImportField { return nil }

func (a *SalesAdapter) ApplyRow(_ context.Context, _ map[string]any, _ map[string]any) (ioengine.RowResult, error) {
	return ioengine.RowResult{}, fmt.Errorf("sales import is not supported")
}

func (a *SalesAdapter) RevertRow(_ context.Context, _, _ string, _ map[string]any) error {
	return fmt.Errorf("sales import is not supported")
}

var _ ioengine.ResourceAdapter = (*SalesAdapter)(nil)
