package adapters

import (
	"context"
	"fmt"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	"github.com/jackc/pgx/v5"
)

const SpecCariAccounts = "tenant_cari_accounts"

// CariAccountsAdapter indexes tenant cari (receivable) accounts.
type CariAccountsAdapter struct {
	q *db.Queries
}

func NewCariAccounts(q *db.Queries) *CariAccountsAdapter {
	return &CariAccountsAdapter{q: q}
}

func (a *CariAccountsAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:           SpecCariAccounts,
		LabelKey:     "search.specs_tenant_cari_accounts",
		Permission:   rbac.PermTenantCariRead,
		Icon:         "book-user",
		TenantScoped: true,
		Searchable:   []string{"title", "subtitle", "keywords", "customer_name", "phone"},
		Filterable:   []string{"organization_slug"},
	}
}

func (a *CariAccountsAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListCariAccountsForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, a.documentFromRow(row))
	}
	return out, nil
}

func (a *CariAccountsAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	orgUUID, entityUUID, err := parseTenantDocID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetCariAccountForSearch(ctx, db.GetCariAccountForSearchParams{
		Uuid: entityUUID, Uuid_2: orgUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("cari accounts search: not found")
		}
		return searchengine.Document{}, err
	}
	return a.documentFromRow(db.ListCariAccountsForSearchRow(row)), nil
}

func (a *CariAccountsAdapter) documentFromRow(row db.ListCariAccountsForSearchRow) searchengine.Document {
	return searchengine.Document{
		ID:               TenantDocID(row.OrganizationUuid, row.Uuid),
		Spec:             SpecCariAccounts,
		Title:            row.CustomerName,
		Subtitle:         formatBalanceSubtitle(numericToDisplay(row.Balance), row.Currency, "cari"),
		Keywords:         []string{row.CustomerPhone, row.Currency},
		Href:             fmt.Sprintf("/t/%s/cari/%s", row.OrganizationSlug, row.Uuid.String()),
		Icon:             "book-user",
		OrganizationSlug: row.OrganizationSlug,
	}
}

var _ searchengine.Adapter = (*CariAccountsAdapter)(nil)
