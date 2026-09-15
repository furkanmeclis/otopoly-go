package adapters

import (
	"context"
	"fmt"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	"github.com/jackc/pgx/v5"
)

const SpecSales = "tenant_sales"

type SalesAdapter struct {
	q *db.Queries
}

func NewSales(q *db.Queries) *SalesAdapter {
	return &SalesAdapter{q: q}
}

func (a *SalesAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:           SpecSales,
		LabelKey:     "search.specs_tenant_sales",
		Permission:   rbac.PermTenantSalesRead,
		Icon:         "shopping-bag",
		TenantScoped: true,
		Searchable:   []string{"title", "subtitle", "keywords", "customer_name"},
		Filterable:   []string{"organization_slug", "status"},
	}
}

func (a *SalesAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListProductSalesForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, a.documentFromRow(row))
	}
	return out, nil
}

func (a *SalesAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	orgUUID, entityUUID, err := parseTenantDocID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetProductSaleForSearch(ctx, db.GetProductSaleForSearchParams{
		Uuid: entityUUID, Uuid_2: orgUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("sales search: not found")
		}
		return searchengine.Document{}, err
	}
	return a.documentFromRow(db.ListProductSalesForSearchRow(row)), nil
}

func (a *SalesAdapter) documentFromRow(row db.ListProductSalesForSearchRow) searchengine.Document {
	title := row.CustomerName
	if title == "" {
		title = "Walk-in sale"
	}
	return searchengine.Document{
		ID:               TenantDocID(row.OrganizationUuid, row.Uuid),
		Spec:             SpecSales,
		Title:            title,
		Subtitle:         fmt.Sprintf("%s · %s", row.Status, row.Currency),
		Keywords:         []string{row.CustomerName, row.CustomerPhone, row.Status},
		Href:             fmt.Sprintf("/t/%s/sales/%s", row.OrganizationSlug, row.Uuid.String()),
		Icon:             "shopping-bag",
		OrganizationSlug: row.OrganizationSlug,
	}
}

var _ searchengine.Adapter = (*SalesAdapter)(nil)
