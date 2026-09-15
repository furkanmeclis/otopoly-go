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

const ResourcePurchases = "tenant.purchases"

type PurchasesAdapter struct {
	q *db.Queries
}

func NewPurchases(q *db.Queries) *PurchasesAdapter {
	return &PurchasesAdapter{q: q}
}

func (a *PurchasesAdapter) Resource() string { return ResourcePurchases }

func (a *PurchasesAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "supplier_name", LabelKey: "purchases.supplier_name", Type: ioengine.ColumnTypeString},
		{Key: "method", LabelKey: "purchases.method", Type: ioengine.ColumnTypeString},
		{Key: "status", LabelKey: "purchases.status", Type: ioengine.ColumnTypeString},
		{Key: "total_amount", LabelKey: "purchases.total_amount", Type: ioengine.ColumnTypeString},
		{Key: "currency", LabelKey: "purchases.currency", Type: ioengine.ColumnTypeString},
		{Key: "purchased_at", LabelKey: "purchases.purchased_at", Type: ioengine.ColumnTypeDatetime},
		{Key: "notes", LabelKey: "purchases.notes", Type: ioengine.ColumnTypeString},
		{Key: "uuid", LabelKey: "purchases.uuid", Type: ioengine.ColumnTypeString},
	}
}

func (a *PurchasesAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	params := db.ListPurchasesForExportParams{OrganizationID: orgID}
	if q := strings.TrimSpace(query["q"]); q != "" {
		params.Q = pgtype.Text{String: q, Valid: true}
	}
	if v := strings.TrimSpace(query["status"]); v != "" {
		params.Status = pgtype.Text{String: v, Valid: true}
	}
	rows, err := a.q.ListPurchasesForExport(ctx, params)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, map[string]any{
			"supplier_name": row.SupplierName,
			"method":        row.Method,
			"status":        row.Status,
			"total_amount":  formatNumeric(row.TotalAmount),
			"currency":      row.Currency,
			"purchased_at":  row.PurchasedAt.Time,
			"notes":         row.Notes,
			"uuid":          row.Uuid.String(),
		})
	}
	return ioengine.Dataset{Resource: ResourcePurchases, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *PurchasesAdapter) ImportSchema() []ioengine.ImportField { return nil }

func (a *PurchasesAdapter) ApplyRow(_ context.Context, _ map[string]any, _ map[string]any) (ioengine.RowResult, error) {
	return ioengine.RowResult{}, fmt.Errorf("purchases import is not supported")
}

func (a *PurchasesAdapter) RevertRow(_ context.Context, _, _ string, _ map[string]any) error {
	return fmt.Errorf("purchases import is not supported")
}

var _ ioengine.ResourceAdapter = (*PurchasesAdapter)(nil)
