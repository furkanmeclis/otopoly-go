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

const ResourceSuppliers = "tenant.suppliers"

type SuppliersAdapter struct {
	q *db.Queries
}

func NewSuppliers(q *db.Queries) *SuppliersAdapter {
	return &SuppliersAdapter{q: q}
}

func (a *SuppliersAdapter) Resource() string { return ResourceSuppliers }

func (a *SuppliersAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "name", LabelKey: "suppliers.name", Type: ioengine.ColumnTypeString},
		{Key: "phone", LabelKey: "suppliers.phone", Type: ioengine.ColumnTypeString},
		{Key: "email", LabelKey: "suppliers.email", Type: ioengine.ColumnTypeString},
		{Key: "tax_id", LabelKey: "suppliers.tax_id", Type: ioengine.ColumnTypeString},
		{Key: "is_active", LabelKey: "suppliers.is_active", Type: ioengine.ColumnTypeBoolean},
		{Key: "notes", LabelKey: "suppliers.notes", Type: ioengine.ColumnTypeString},
		{Key: "created_at", LabelKey: "suppliers.created_at", Type: ioengine.ColumnTypeDatetime},
		{Key: "uuid", LabelKey: "suppliers.uuid", Type: ioengine.ColumnTypeString},
	}
}

func (a *SuppliersAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	params := db.ListSuppliersForExportParams{OrganizationID: orgID}
	if q := strings.TrimSpace(query["q"]); q != "" {
		params.Q = pgtype.Text{String: q, Valid: true}
	}
	if v := strings.TrimSpace(query["is_active"]); v != "" {
		params.IsActive = pgtype.Bool{Bool: v == "true", Valid: true}
	}
	rows, err := a.q.ListSuppliersForExport(ctx, params)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, map[string]any{
			"name":       row.Name,
			"phone":      row.Phone,
			"email":      row.Email,
			"tax_id":     row.TaxID,
			"is_active":  row.IsActive,
			"notes":      row.Notes,
			"created_at": row.CreatedAt.Time,
			"uuid":       row.Uuid.String(),
		})
	}
	return ioengine.Dataset{Resource: ResourceSuppliers, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *SuppliersAdapter) ImportSchema() []ioengine.ImportField { return nil }

func (a *SuppliersAdapter) ApplyRow(_ context.Context, _ map[string]any, _ map[string]any) (ioengine.RowResult, error) {
	return ioengine.RowResult{}, fmt.Errorf("suppliers import is not supported")
}

func (a *SuppliersAdapter) RevertRow(_ context.Context, _, _ string, _ map[string]any) error {
	return fmt.Errorf("suppliers import is not supported")
}

var _ ioengine.ResourceAdapter = (*SuppliersAdapter)(nil)
