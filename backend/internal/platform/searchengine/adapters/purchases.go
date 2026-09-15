package adapters

import (
	"context"
	"fmt"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	"github.com/jackc/pgx/v5"
)

const SpecPurchases = "tenant_purchases"

type PurchasesAdapter struct {
	q *db.Queries
}

func NewPurchases(q *db.Queries) *PurchasesAdapter {
	return &PurchasesAdapter{q: q}
}

func (a *PurchasesAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:           SpecPurchases,
		LabelKey:     "search.specs_tenant_purchases",
		Permission:   rbac.PermTenantPurchasesRead,
		Icon:         "shopping-cart",
		TenantScoped: true,
		Searchable:   []string{"title", "subtitle", "keywords", "supplier_name"},
		Filterable:   []string{"organization_slug", "status"},
	}
}

func (a *PurchasesAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListPurchasesForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, a.documentFromRow(row))
	}
	return out, nil
}

func (a *PurchasesAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	orgUUID, entityUUID, err := parseTenantDocID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetPurchaseForSearch(ctx, db.GetPurchaseForSearchParams{
		Uuid: entityUUID, Uuid_2: orgUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("purchases search: not found")
		}
		return searchengine.Document{}, err
	}
	return a.documentFromRow(db.ListPurchasesForSearchRow(row)), nil
}

func (a *PurchasesAdapter) documentFromRow(row db.ListPurchasesForSearchRow) searchengine.Document {
	amount := numericToDisplay(row.TotalAmount)
	return searchengine.Document{
		ID:               TenantDocID(row.OrganizationUuid, row.Uuid),
		Spec:             SpecPurchases,
		Title:            row.SupplierName,
		Subtitle:         fmt.Sprintf("%s · %s %s", row.Status, amount, row.Currency),
		Keywords:         []string{row.SupplierName, row.Status, row.Currency},
		Href:             fmt.Sprintf("/t/%s/purchases/%s", row.OrganizationSlug, row.Uuid.String()),
		Icon:             "shopping-cart",
		OrganizationSlug: row.OrganizationSlug,
	}
}

var _ searchengine.Adapter = (*PurchasesAdapter)(nil)
