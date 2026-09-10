package adapters

import (
	"context"
	"fmt"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	"github.com/jackc/pgx/v5"
)

const SpecJobs = "tenant_jobs"

// JobsAdapter indexes tenant service jobs for Cmd+K search.
type JobsAdapter struct {
	q *db.Queries
}

func NewJobs(q *db.Queries) *JobsAdapter {
	return &JobsAdapter{q: q}
}

func (a *JobsAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:           SpecJobs,
		LabelKey:     "search.specs_tenant_jobs",
		Permission:   rbac.PermTenantJobsRead,
		Icon:         "car",
		TenantScoped: true,
		Searchable:   []string{"title", "subtitle", "keywords", "plate", "customer_name"},
		Filterable:   []string{"organization_slug", "status"},
	}
}

func (a *JobsAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListServiceJobsForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, a.documentFromRow(row))
	}
	return out, nil
}

func (a *JobsAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	orgUUID, entityUUID, err := parseTenantDocID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetServiceJobForSearch(ctx, db.GetServiceJobForSearchParams{
		Uuid: entityUUID, Uuid_2: orgUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("jobs search: not found")
		}
		return searchengine.Document{}, err
	}
	return a.documentFromRow(db.ListServiceJobsForSearchRow(row)), nil
}

func (a *JobsAdapter) documentFromRow(row db.ListServiceJobsForSearchRow) searchengine.Document {
	return searchengine.Document{
		ID:               TenantDocID(row.OrganizationUuid, row.Uuid),
		Spec:             SpecJobs,
		Title:            row.Plate,
		Subtitle:         fmt.Sprintf("%s · %s", row.CustomerName, row.VehicleLabel),
		Keywords:         []string{row.CustomerName, row.Status, row.Currency},
		Href:             fmt.Sprintf("/t/%s/operations/%s", row.OrganizationSlug, row.Uuid.String()),
		Icon:             "car",
		OrganizationSlug: row.OrganizationSlug,
	}
}

var _ searchengine.Adapter = (*JobsAdapter)(nil)
