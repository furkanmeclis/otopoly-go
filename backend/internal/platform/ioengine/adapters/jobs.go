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

const ResourceJobs = "tenant.jobs"

// JobsAdapter exports organization service jobs.
type JobsAdapter struct {
	q *db.Queries
}

func NewJobs(q *db.Queries) *JobsAdapter {
	return &JobsAdapter{q: q}
}

func (a *JobsAdapter) Resource() string { return ResourceJobs }

func (a *JobsAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "plate", LabelKey: "jobs.plate", Type: ioengine.ColumnTypeString},
		{Key: "customer_name", LabelKey: "jobs.customer_name", Type: ioengine.ColumnTypeString},
		{Key: "vehicle_label", LabelKey: "jobs.vehicle_label", Type: ioengine.ColumnTypeString},
		{Key: "status", LabelKey: "jobs.status", Type: ioengine.ColumnTypeString},
		{Key: "total_amount", LabelKey: "jobs.total_amount", Type: ioengine.ColumnTypeString},
		{Key: "currency", LabelKey: "jobs.currency", Type: ioengine.ColumnTypeString},
		{Key: "started_at", LabelKey: "jobs.started_at", Type: ioengine.ColumnTypeDatetime},
		{Key: "paid_at", LabelKey: "jobs.paid_at", Type: ioengine.ColumnTypeDatetime},
		{Key: "notes", LabelKey: "jobs.notes", Type: ioengine.ColumnTypeString},
		{Key: "uuid", LabelKey: "jobs.uuid", Type: ioengine.ColumnTypeString},
	}
}

func (a *JobsAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	params := db.ListServiceJobsForExportParams{OrganizationID: orgID}
	if q := strings.TrimSpace(query["q"]); q != "" {
		params.Q = pgtype.Text{String: q, Valid: true}
	}
	if v := strings.TrimSpace(query["status"]); v != "" {
		params.Status = pgtype.Text{String: v, Valid: true}
	}
	rows, err := a.q.ListServiceJobsForExport(ctx, params)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		item := map[string]any{
			"plate":         row.Plate,
			"customer_name": row.CustomerName,
			"vehicle_label": row.VehicleLabel,
			"status":        row.Status,
			"total_amount":  formatNumeric(row.TotalAmount),
			"currency":      row.Currency,
			"started_at":    row.StartedAt.Time,
			"notes":         row.Notes,
			"uuid":          row.Uuid.String(),
		}
		if row.PaidAt.Valid {
			item["paid_at"] = row.PaidAt.Time
		}
		out = append(out, item)
	}
	return ioengine.Dataset{Resource: ResourceJobs, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *JobsAdapter) ImportSchema() []ioengine.ImportField { return nil }

func (a *JobsAdapter) ApplyRow(_ context.Context, _ map[string]any, _ map[string]any) (ioengine.RowResult, error) {
	return ioengine.RowResult{}, fmt.Errorf("jobs import is not supported")
}

func (a *JobsAdapter) RevertRow(_ context.Context, _, _ string, _ map[string]any) error {
	return fmt.Errorf("jobs import is not supported")
}

var _ ioengine.ResourceAdapter = (*JobsAdapter)(nil)
