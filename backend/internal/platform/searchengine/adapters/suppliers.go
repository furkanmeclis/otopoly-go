package adapters

import (
	"context"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	"github.com/jackc/pgx/v5"
)

const SpecSuppliers = "tenant_suppliers"

type SuppliersAdapter struct {
	q *db.Queries
}

func NewSuppliers(q *db.Queries) *SuppliersAdapter {
	return &SuppliersAdapter{q: q}
}

func (a *SuppliersAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:           SpecSuppliers,
		LabelKey:     "search.specs_tenant_suppliers",
		Permission:   rbac.PermTenantSuppliersRead,
		Icon:         "truck",
		TenantScoped: true,
		Searchable:   []string{"title", "subtitle", "keywords", "name", "phone", "email", "tax_id"},
		Filterable:   []string{"organization_slug"},
	}
}

func (a *SuppliersAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListSuppliersForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, a.documentFromRow(row))
	}
	return out, nil
}

func (a *SuppliersAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	orgUUID, entityUUID, err := parseTenantDocID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetSupplierForSearch(ctx, db.GetSupplierForSearchParams{
		Uuid: entityUUID, Uuid_2: orgUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("suppliers search: not found")
		}
		return searchengine.Document{}, err
	}
	return a.documentFromRow(db.ListSuppliersForSearchRow(row)), nil
}

func (a *SuppliersAdapter) documentFromRow(row db.ListSuppliersForSearchRow) searchengine.Document {
	subtitleParts := make([]string, 0, 3)
	if phone := strings.TrimSpace(row.Phone); phone != "" {
		subtitleParts = append(subtitleParts, phone)
	}
	if email := strings.TrimSpace(row.Email); email != "" {
		subtitleParts = append(subtitleParts, email)
	}
	if taxID := strings.TrimSpace(row.TaxID); taxID != "" {
		subtitleParts = append(subtitleParts, taxID)
	}
	subtitle := strings.Join(subtitleParts, " · ")
	keywords := []string{row.Name, row.Phone, row.Email, row.TaxID}
	return searchengine.Document{
		ID:               TenantDocID(row.OrganizationUuid, row.Uuid),
		Spec:             SpecSuppliers,
		Title:            row.Name,
		Subtitle:         subtitle,
		Keywords:         keywords,
		Href:             fmt.Sprintf("/t/%s/suppliers/%s", row.OrganizationSlug, row.Uuid.String()),
		Icon:             "truck",
		OrganizationSlug: row.OrganizationSlug,
	}
}

var _ searchengine.Adapter = (*SuppliersAdapter)(nil)
