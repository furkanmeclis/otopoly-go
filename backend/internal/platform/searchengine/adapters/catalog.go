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

const (
	SpecCatalogProducts = "tenant_catalog_products"
	SpecCatalogServices = "tenant_catalog_services"
)

// ============================================================================
// Products Search Adapter
// ============================================================================

type CatalogProductsAdapter struct {
	q *db.Queries
}

func NewCatalogProducts(q *db.Queries) *CatalogProductsAdapter {
	return &CatalogProductsAdapter{q: q}
}

func (a *CatalogProductsAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:           SpecCatalogProducts,
		LabelKey:     "search.specs_tenant_catalog_products",
		Permission:   rbac.PermTenantCatalogRead,
		Icon:         "package",
		TenantScoped: true,
		Searchable:   []string{"title", "subtitle", "keywords", "name", "sku", "barcode", "category_name"},
		Filterable:   []string{"organization_slug"},
	}
}

func (a *CatalogProductsAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListProductsForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, a.documentFromListRow(row))
	}
	return out, nil
}

func (a *CatalogProductsAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	orgUUID, entityUUID, err := parseTenantDocID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetProductForSearch(ctx, db.GetProductForSearchParams{
		Uuid:    entityUUID,
		OrgUuid: orgUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("catalog products search: not found")
		}
		return searchengine.Document{}, err
	}
	return a.documentFromGetRow(row), nil
}

func (a *CatalogProductsAdapter) documentFromListRow(row db.ListProductsForSearchRow) searchengine.Document {
	subtitleParts := []string{}
	if row.CategoryName.Valid && strings.TrimSpace(row.CategoryName.String) != "" {
		subtitleParts = append(subtitleParts, row.CategoryName.String)
	}
	priceStr := numericToDisplay(row.SalePrice)
	subtitleParts = append(subtitleParts, fmt.Sprintf("%s %s", priceStr, row.Currency))
	stockStr := numericToDisplay(row.StockQuantity)
	subtitleParts = append(subtitleParts, fmt.Sprintf("Stok: %s %s", stockStr, row.Unit))

	keywords := []string{row.Name}
	if row.Sku.Valid && row.Sku.String != "" {
		keywords = append(keywords, row.Sku.String)
	}
	if row.Barcode.Valid && row.Barcode.String != "" {
		keywords = append(keywords, row.Barcode.String)
	}

	docID := TenantDocID(row.OrganizationUuid, row.Uuid)
	href := fmt.Sprintf("/t/%s/catalog/products", row.OrganizationSlug)

	return searchengine.Document{
		ID:               docID,
		Spec:             SpecCatalogProducts,
		Title:            row.Name,
		Subtitle:         strings.Join(subtitleParts, " · "),
		Href:             href,
		Icon:             "package",
		Keywords:         keywords,
		OrganizationSlug: row.OrganizationSlug,
	}
}

func (a *CatalogProductsAdapter) documentFromGetRow(row db.GetProductForSearchRow) searchengine.Document {
	subtitleParts := []string{}
	if row.CategoryName.Valid && strings.TrimSpace(row.CategoryName.String) != "" {
		subtitleParts = append(subtitleParts, row.CategoryName.String)
	}
	priceStr := numericToDisplay(row.SalePrice)
	subtitleParts = append(subtitleParts, fmt.Sprintf("%s %s", priceStr, row.Currency))
	stockStr := numericToDisplay(row.StockQuantity)
	subtitleParts = append(subtitleParts, fmt.Sprintf("Stok: %s %s", stockStr, row.Unit))

	keywords := []string{row.Name}
	if row.Sku.Valid && row.Sku.String != "" {
		keywords = append(keywords, row.Sku.String)
	}
	if row.Barcode.Valid && row.Barcode.String != "" {
		keywords = append(keywords, row.Barcode.String)
	}

	docID := TenantDocID(row.OrganizationUuid, row.Uuid)
	href := fmt.Sprintf("/t/%s/catalog/products", row.OrganizationSlug)

	return searchengine.Document{
		ID:               docID,
		Spec:             SpecCatalogProducts,
		Title:            row.Name,
		Subtitle:         strings.Join(subtitleParts, " · "),
		Href:             href,
		Icon:             "package",
		Keywords:         keywords,
		OrganizationSlug: row.OrganizationSlug,
	}
}

// ============================================================================
// Services Search Adapter
// ============================================================================

type CatalogServicesAdapter struct {
	q *db.Queries
}

func NewCatalogServices(q *db.Queries) *CatalogServicesAdapter {
	return &CatalogServicesAdapter{q: q}
}

func (a *CatalogServicesAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:           SpecCatalogServices,
		LabelKey:     "search.specs_tenant_catalog_services",
		Permission:   rbac.PermTenantCatalogRead,
		Icon:         "wrench",
		TenantScoped: true,
		Searchable:   []string{"title", "subtitle", "keywords", "name", "code", "category_name"},
		Filterable:   []string{"organization_slug"},
	}
}

func (a *CatalogServicesAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListServicesForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, a.documentFromListRow(row))
	}
	return out, nil
}

func (a *CatalogServicesAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	orgUUID, entityUUID, err := parseTenantDocID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetServiceForSearch(ctx, db.GetServiceForSearchParams{
		Uuid:    entityUUID,
		OrgUuid: orgUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("catalog services search: not found")
		}
		return searchengine.Document{}, err
	}
	return a.documentFromGetRow(row), nil
}

func (a *CatalogServicesAdapter) documentFromListRow(row db.ListServicesForSearchRow) searchengine.Document {
	subtitleParts := []string{}
	if row.CategoryName.Valid && strings.TrimSpace(row.CategoryName.String) != "" {
		subtitleParts = append(subtitleParts, row.CategoryName.String)
	}
	priceStr := numericToDisplay(row.Price)
	subtitleParts = append(subtitleParts, fmt.Sprintf("%s %s", priceStr, row.Currency))
	subtitleParts = append(subtitleParts, fmt.Sprintf("%d dk", row.DurationMinutes))

	keywords := []string{row.Name}
	if row.Code.Valid && row.Code.String != "" {
		keywords = append(keywords, row.Code.String)
	}

	docID := TenantDocID(row.OrganizationUuid, row.Uuid)
	href := fmt.Sprintf("/t/%s/catalog/services", row.OrganizationSlug)

	return searchengine.Document{
		ID:               docID,
		Spec:             SpecCatalogServices,
		Title:            row.Name,
		Subtitle:         strings.Join(subtitleParts, " · "),
		Href:             href,
		Icon:             "wrench",
		Keywords:         keywords,
		OrganizationSlug: row.OrganizationSlug,
	}
}

func (a *CatalogServicesAdapter) documentFromGetRow(row db.GetServiceForSearchRow) searchengine.Document {
	subtitleParts := []string{}
	if row.CategoryName.Valid && strings.TrimSpace(row.CategoryName.String) != "" {
		subtitleParts = append(subtitleParts, row.CategoryName.String)
	}
	priceStr := numericToDisplay(row.Price)
	subtitleParts = append(subtitleParts, fmt.Sprintf("%s %s", priceStr, row.Currency))
	subtitleParts = append(subtitleParts, fmt.Sprintf("%d dk", row.DurationMinutes))

	keywords := []string{row.Name}
	if row.Code.Valid && row.Code.String != "" {
		keywords = append(keywords, row.Code.String)
	}

	docID := TenantDocID(row.OrganizationUuid, row.Uuid)
	href := fmt.Sprintf("/t/%s/catalog/services", row.OrganizationSlug)

	return searchengine.Document{
		ID:               docID,
		Spec:             SpecCatalogServices,
		Title:            row.Name,
		Subtitle:         strings.Join(subtitleParts, " · "),
		Href:             href,
		Icon:             "wrench",
		Keywords:         keywords,
		OrganizationSlug: row.OrganizationSlug,
	}
}

var (
	_ searchengine.Adapter = (*CatalogProductsAdapter)(nil)
	_ searchengine.Adapter = (*CatalogServicesAdapter)(nil)
)
