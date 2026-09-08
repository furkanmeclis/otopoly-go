package adapters

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	ResourceCatalogProducts   = "tenant.catalog.products"
	ResourceCatalogServices   = "tenant.catalog.services"
	ResourceCatalogCategories = "tenant.catalog.categories"
)

// ============================================================================
// Products Adapter
// ============================================================================

type CatalogProductsAdapter struct {
	q *db.Queries
}

func NewCatalogProducts(q *db.Queries) *CatalogProductsAdapter {
	return &CatalogProductsAdapter{q: q}
}

func (a *CatalogProductsAdapter) Resource() string { return ResourceCatalogProducts }

func (a *CatalogProductsAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "name", LabelKey: "catalog.products.name", Type: ioengine.ColumnTypeString},
		{Key: "category", LabelKey: "catalog.products.category", Type: ioengine.ColumnTypeString},
		{Key: "sku", LabelKey: "catalog.products.sku", Type: ioengine.ColumnTypeString},
		{Key: "barcode", LabelKey: "catalog.products.barcode", Type: ioengine.ColumnTypeString},
		{Key: "unit", LabelKey: "catalog.products.unit", Type: ioengine.ColumnTypeString},
		{Key: "sale_price", LabelKey: "catalog.products.sale_price", Type: ioengine.ColumnTypeString},
		{Key: "cost_price", LabelKey: "catalog.products.cost_price", Type: ioengine.ColumnTypeString},
		{Key: "vat_rate", LabelKey: "catalog.products.vat_rate", Type: ioengine.ColumnTypeString},
		{Key: "currency", LabelKey: "catalog.products.currency", Type: ioengine.ColumnTypeString},
		{Key: "stock_quantity", LabelKey: "catalog.products.stock_quantity", Type: ioengine.ColumnTypeString},
		{Key: "min_stock_alert", LabelKey: "catalog.products.min_stock_alert", Type: ioengine.ColumnTypeString},
		{Key: "track_stock", LabelKey: "catalog.products.track_stock", Type: ioengine.ColumnTypeBoolean},
		{Key: "is_active", LabelKey: "catalog.products.is_active", Type: ioengine.ColumnTypeBoolean},
		{Key: "description", LabelKey: "catalog.products.description", Type: ioengine.ColumnTypeString},
	}
}

func (a *CatalogProductsAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	rows, err := a.q.ListProductsForExport(ctx, db.ListProductsForExportParams{
		OrganizationID: orgID,
		CategoryUuid:   uuidArg(query["category_uuid"]),
		IsActive:       boolArg(query["is_active"]),
		Q:              textArg(query["q"]),
	})
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		var cat any
		if row.CategoryName.Valid {
			cat = row.CategoryName.String
		}
		var sku any
		if row.Sku.Valid {
			sku = row.Sku.String
		}
		var barcode any
		if row.Barcode.Valid {
			barcode = row.Barcode.String
		}
		out = append(out, map[string]any{
			"name":            row.Name,
			"category":        cat,
			"sku":             sku,
			"barcode":         barcode,
			"unit":            row.Unit,
			"sale_price":      formatNumeric(row.SalePrice),
			"cost_price":      formatNumeric(row.CostPrice),
			"vat_rate":        formatNumeric(row.VatRate),
			"currency":        row.Currency,
			"stock_quantity":  formatNumeric(row.StockQuantity),
			"min_stock_alert": formatNumeric(row.MinStockAlert),
			"track_stock":     row.TrackStock,
			"is_active":       row.IsActive,
			"description":     row.Description,
		})
	}
	return ioengine.Dataset{Resource: ResourceCatalogProducts, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *CatalogProductsAdapter) ImportSchema() []ioengine.ImportField {
	return []ioengine.ImportField{
		{Key: "name", LabelKey: "catalog.products.name", Type: ioengine.ColumnTypeString, Required: true},
		{Key: "category", LabelKey: "catalog.products.category", Type: ioengine.ColumnTypeString},
		{Key: "sku", LabelKey: "catalog.products.sku", Type: ioengine.ColumnTypeString},
		{Key: "barcode", LabelKey: "catalog.products.barcode", Type: ioengine.ColumnTypeString},
		{Key: "unit", LabelKey: "catalog.products.unit", Type: ioengine.ColumnTypeString, DefaultHint: "piece"},
		{Key: "sale_price", LabelKey: "catalog.products.sale_price", Type: ioengine.ColumnTypeString, DefaultHint: "0"},
		{Key: "cost_price", LabelKey: "catalog.products.cost_price", Type: ioengine.ColumnTypeString, DefaultHint: "0"},
		{Key: "vat_rate", LabelKey: "catalog.products.vat_rate", Type: ioengine.ColumnTypeString, DefaultHint: "20"},
		{Key: "currency", LabelKey: "catalog.products.currency", Type: ioengine.ColumnTypeString, DefaultHint: "TRY"},
		{Key: "stock_quantity", LabelKey: "catalog.products.stock_quantity", Type: ioengine.ColumnTypeString, DefaultHint: "0"},
		{Key: "min_stock_alert", LabelKey: "catalog.products.min_stock_alert", Type: ioengine.ColumnTypeString, DefaultHint: "0"},
		{Key: "track_stock", LabelKey: "catalog.products.track_stock", Type: ioengine.ColumnTypeBoolean, DefaultHint: "true"},
		{Key: "is_active", LabelKey: "catalog.products.is_active", Type: ioengine.ColumnTypeBoolean, DefaultHint: "true"},
		{Key: "description", LabelKey: "catalog.products.description", Type: ioengine.ColumnTypeString},
	}
}

func (a *CatalogProductsAdapter) ApplyRow(ctx context.Context, row map[string]any, defaults map[string]any) (ioengine.RowResult, error) {
	orgID, err := organizationIDFromApply(ctx)
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	name := firstMapped(row, defaults, "name")
	if name == "" {
		return ioengine.RowResult{OK: false, Error: "name is required"}, nil
	}

	_, err = a.q.GetProductByName(ctx, db.GetProductByNameParams{
		OrganizationID: orgID,
		Lower:          strings.ToLower(name),
	})
	if err == nil {
		return ioengine.RowResult{OK: false, Error: "product with this name already exists"}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ioengine.RowResult{}, err
	}

	var categoryID pgtype.Int8
	catName := firstMapped(row, defaults, "category")
	if catName != "" {
		cat, err := a.q.GetCatalogCategoryByName(ctx, db.GetCatalogCategoryByNameParams{
			OrganizationID: orgID,
			Kind:           "product",
			Lower:          strings.ToLower(catName),
		})
		if err == nil {
			categoryID = pgtype.Int8{Int64: cat.ID, Valid: true}
		} else if errors.Is(err, pgx.ErrNoRows) {
			// Auto-create category
			createdCat, cErr := a.q.CreateCatalogCategory(ctx, db.CreateCatalogCategoryParams{
				OrganizationID: orgID,
				ParentID:       pgtype.Int8{},
				Name:           catName,
				Kind:           "product",
				SortOrder:      0,
				IsActive:       true,
			})
			if cErr == nil {
				categoryID = pgtype.Int8{Int64: createdCat.ID, Valid: true}
			}
		}
	}

	unit := firstMapped(row, defaults, "unit")
	if unit == "" {
		unit = "piece"
	}
	currency := strings.ToUpper(firstMapped(row, defaults, "currency"))
	if currency == "" {
		currency = "TRY"
	}

	costPrice, err := parseNumericString(firstMapped(row, defaults, "cost_price"), "0")
	if err != nil {
		return ioengine.RowResult{OK: false, Error: "invalid cost_price"}, nil
	}
	salePrice, err := parseNumericString(firstMapped(row, defaults, "sale_price"), "0")
	if err != nil {
		return ioengine.RowResult{OK: false, Error: "invalid sale_price"}, nil
	}
	vatRate, err := parseNumericString(firstMapped(row, defaults, "vat_rate"), "20")
	if err != nil {
		return ioengine.RowResult{OK: false, Error: "invalid vat_rate"}, nil
	}
	stockQty, err := parseNumericString(firstMapped(row, defaults, "stock_quantity"), "0")
	if err != nil {
		return ioengine.RowResult{OK: false, Error: "invalid stock_quantity"}, nil
	}
	minAlert, err := parseNumericString(firstMapped(row, defaults, "min_stock_alert"), "0")
	if err != nil {
		return ioengine.RowResult{OK: false, Error: "invalid min_stock_alert"}, nil
	}

	trackStock := parseBoolDefault(firstMapped(row, defaults, "track_stock"), true)
	isActive := parseBoolDefault(firstMapped(row, defaults, "is_active"), true)

	created, err := a.q.CreateProduct(ctx, db.CreateProductParams{
		OrganizationID: orgID,
		CategoryID:     categoryID,
		Name:           name,
		Sku:            optionalText(firstMapped(row, defaults, "sku")),
		Barcode:        optionalText(firstMapped(row, defaults, "barcode")),
		Unit:           unit,
		CostPrice:      costPrice,
		SalePrice:      salePrice,
		VatRate:        vatRate,
		Currency:       currency,
		StockQuantity:  stockQty,
		MinStockAlert:  minAlert,
		TrackStock:     trackStock,
		IsActive:       isActive,
		Description:    firstMapped(row, defaults, "description"),
	})
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	return ioengine.RowResult{
		OK: true, EntityType: "product", EntityUUID: created.Uuid.String(), Op: "create",
	}, nil
}

func (a *CatalogProductsAdapter) RevertRow(ctx context.Context, entityType, entityUUID string, _ map[string]any) error {
	if entityType != "product" {
		return fmt.Errorf("unsupported entity")
	}
	orgID, err := organizationIDFromApply(ctx)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(entityUUID)
	if err != nil {
		return err
	}
	_, err = a.q.SoftDeleteProduct(ctx, db.SoftDeleteProductParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}

// ============================================================================
// Services Adapter
// ============================================================================

type CatalogServicesAdapter struct {
	q *db.Queries
}

func NewCatalogServices(q *db.Queries) *CatalogServicesAdapter {
	return &CatalogServicesAdapter{q: q}
}

func (a *CatalogServicesAdapter) Resource() string { return ResourceCatalogServices }

func (a *CatalogServicesAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "name", LabelKey: "catalog.services.name", Type: ioengine.ColumnTypeString},
		{Key: "category", LabelKey: "catalog.services.category", Type: ioengine.ColumnTypeString},
		{Key: "code", LabelKey: "catalog.services.code", Type: ioengine.ColumnTypeString},
		{Key: "duration_minutes", LabelKey: "catalog.services.duration", Type: ioengine.ColumnTypeString},
		{Key: "price", LabelKey: "catalog.services.price", Type: ioengine.ColumnTypeString},
		{Key: "vat_rate", LabelKey: "catalog.services.vat_rate", Type: ioengine.ColumnTypeString},
		{Key: "currency", LabelKey: "catalog.services.currency", Type: ioengine.ColumnTypeString},
		{Key: "is_active", LabelKey: "catalog.services.is_active", Type: ioengine.ColumnTypeBoolean},
		{Key: "description", LabelKey: "catalog.services.description", Type: ioengine.ColumnTypeString},
	}
}

func (a *CatalogServicesAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	rows, err := a.q.ListServicesForExport(ctx, db.ListServicesForExportParams{
		OrganizationID: orgID,
		CategoryUuid:   uuidArg(query["category_uuid"]),
		IsActive:       boolArg(query["is_active"]),
		Q:              textArg(query["q"]),
	})
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		var cat any
		if row.CategoryName.Valid {
			cat = row.CategoryName.String
		}
		var code any
		if row.Code.Valid {
			code = row.Code.String
		}
		out = append(out, map[string]any{
			"name":             row.Name,
			"category":         cat,
			"code":             code,
			"duration_minutes": row.DurationMinutes,
			"price":            formatNumeric(row.Price),
			"vat_rate":         formatNumeric(row.VatRate),
			"currency":         row.Currency,
			"is_active":        row.IsActive,
			"description":      row.Description,
		})
	}
	return ioengine.Dataset{Resource: ResourceCatalogServices, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *CatalogServicesAdapter) ImportSchema() []ioengine.ImportField {
	return []ioengine.ImportField{
		{Key: "name", LabelKey: "catalog.services.name", Type: ioengine.ColumnTypeString, Required: true},
		{Key: "category", LabelKey: "catalog.services.category", Type: ioengine.ColumnTypeString},
		{Key: "code", LabelKey: "catalog.services.code", Type: ioengine.ColumnTypeString},
		{Key: "duration_minutes", LabelKey: "catalog.services.duration", Type: ioengine.ColumnTypeString, DefaultHint: "30"},
		{Key: "price", LabelKey: "catalog.services.price", Type: ioengine.ColumnTypeString, DefaultHint: "0"},
		{Key: "vat_rate", LabelKey: "catalog.services.vat_rate", Type: ioengine.ColumnTypeString, DefaultHint: "20"},
		{Key: "currency", LabelKey: "catalog.services.currency", Type: ioengine.ColumnTypeString, DefaultHint: "TRY"},
		{Key: "is_active", LabelKey: "catalog.services.is_active", Type: ioengine.ColumnTypeBoolean, DefaultHint: "true"},
		{Key: "description", LabelKey: "catalog.services.description", Type: ioengine.ColumnTypeString},
	}
}

func (a *CatalogServicesAdapter) ApplyRow(ctx context.Context, row map[string]any, defaults map[string]any) (ioengine.RowResult, error) {
	orgID, err := organizationIDFromApply(ctx)
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	name := firstMapped(row, defaults, "name")
	if name == "" {
		return ioengine.RowResult{OK: false, Error: "name is required"}, nil
	}

	_, err = a.q.GetServiceByName(ctx, db.GetServiceByNameParams{
		OrganizationID: orgID,
		Lower:          strings.ToLower(name),
	})
	if err == nil {
		return ioengine.RowResult{OK: false, Error: "service with this name already exists"}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ioengine.RowResult{}, err
	}

	var categoryID pgtype.Int8
	catName := firstMapped(row, defaults, "category")
	if catName != "" {
		cat, err := a.q.GetCatalogCategoryByName(ctx, db.GetCatalogCategoryByNameParams{
			OrganizationID: orgID,
			Kind:           "service",
			Lower:          strings.ToLower(catName),
		})
		if err == nil {
			categoryID = pgtype.Int8{Int64: cat.ID, Valid: true}
		} else if errors.Is(err, pgx.ErrNoRows) {
			createdCat, cErr := a.q.CreateCatalogCategory(ctx, db.CreateCatalogCategoryParams{
				OrganizationID: orgID,
				ParentID:       pgtype.Int8{},
				Name:           catName,
				Kind:           "service",
				SortOrder:      0,
				IsActive:       true,
			})
			if cErr == nil {
				categoryID = pgtype.Int8{Int64: createdCat.ID, Valid: true}
			}
		}
	}

	dur := parseInt32Default(firstMapped(row, defaults, "duration_minutes"), 30)
	price, err := parseNumericString(firstMapped(row, defaults, "price"), "0")
	if err != nil {
		return ioengine.RowResult{OK: false, Error: "invalid price"}, nil
	}
	vatRate, err := parseNumericString(firstMapped(row, defaults, "vat_rate"), "20")
	if err != nil {
		return ioengine.RowResult{OK: false, Error: "invalid vat_rate"}, nil
	}
	currency := strings.ToUpper(firstMapped(row, defaults, "currency"))
	if currency == "" {
		currency = "TRY"
	}
	isActive := parseBoolDefault(firstMapped(row, defaults, "is_active"), true)

	created, err := a.q.CreateService(ctx, db.CreateServiceParams{
		OrganizationID:  orgID,
		CategoryID:      categoryID,
		Name:            name,
		Code:            optionalText(firstMapped(row, defaults, "code")),
		DurationMinutes: dur,
		Price:           price,
		VatRate:         vatRate,
		Currency:        currency,
		IsActive:        isActive,
		Description:     firstMapped(row, defaults, "description"),
	})
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	return ioengine.RowResult{
		OK: true, EntityType: "service", EntityUUID: created.Uuid.String(), Op: "create",
	}, nil
}

func (a *CatalogServicesAdapter) RevertRow(ctx context.Context, entityType, entityUUID string, _ map[string]any) error {
	if entityType != "service" {
		return fmt.Errorf("unsupported entity")
	}
	orgID, err := organizationIDFromApply(ctx)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(entityUUID)
	if err != nil {
		return err
	}
	_, err = a.q.SoftDeleteService(ctx, db.SoftDeleteServiceParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}

// ============================================================================
// Categories Adapter
// ============================================================================

type CatalogCategoriesAdapter struct {
	q *db.Queries
}

func NewCatalogCategories(q *db.Queries) *CatalogCategoriesAdapter {
	return &CatalogCategoriesAdapter{q: q}
}

func (a *CatalogCategoriesAdapter) Resource() string { return ResourceCatalogCategories }

func (a *CatalogCategoriesAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "name", LabelKey: "catalog.categories.name", Type: ioengine.ColumnTypeString},
		{Key: "kind", LabelKey: "catalog.categories.kind", Type: ioengine.ColumnTypeEnum},
		{Key: "parent_name", LabelKey: "catalog.categories.parent", Type: ioengine.ColumnTypeString},
		{Key: "sort_order", LabelKey: "catalog.categories.sort_order", Type: ioengine.ColumnTypeString},
		{Key: "is_active", LabelKey: "catalog.categories.is_active", Type: ioengine.ColumnTypeBoolean},
	}
}

func (a *CatalogCategoriesAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	rows, err := a.q.ListCatalogCategories(ctx, db.ListCatalogCategoriesParams{
		OrganizationID: orgID,
		Kind:           textArg(query["kind"]),
		IsActive:       boolArg(query["is_active"]),
		Q:              textArg(query["q"]),
	})
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		var parent any
		if row.ParentName.Valid {
			parent = row.ParentName.String
		}
		out = append(out, map[string]any{
			"name":        row.Name,
			"kind":        row.Kind,
			"parent_name": parent,
			"sort_order":  row.SortOrder,
			"is_active":   row.IsActive,
		})
	}
	return ioengine.Dataset{Resource: ResourceCatalogCategories, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *CatalogCategoriesAdapter) ImportSchema() []ioengine.ImportField {
	return []ioengine.ImportField{
		{Key: "name", LabelKey: "catalog.categories.name", Type: ioengine.ColumnTypeString, Required: true},
		{Key: "kind", LabelKey: "catalog.categories.kind", Type: ioengine.ColumnTypeEnum, Required: true, DefaultHint: "product"},
		{Key: "sort_order", LabelKey: "catalog.categories.sort_order", Type: ioengine.ColumnTypeString, DefaultHint: "0"},
		{Key: "is_active", LabelKey: "catalog.categories.is_active", Type: ioengine.ColumnTypeBoolean, DefaultHint: "true"},
	}
}

func (a *CatalogCategoriesAdapter) ApplyRow(ctx context.Context, row map[string]any, defaults map[string]any) (ioengine.RowResult, error) {
	orgID, err := organizationIDFromApply(ctx)
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	name := firstMapped(row, defaults, "name")
	kind := strings.ToLower(firstMapped(row, defaults, "kind"))
	if name == "" || (kind != "product" && kind != "service") {
		return ioengine.RowResult{OK: false, Error: "name and kind (product|service) required"}, nil
	}
	_, err = a.q.GetCatalogCategoryByName(ctx, db.GetCatalogCategoryByNameParams{
		OrganizationID: orgID, Kind: kind, Lower: strings.ToLower(name),
	})
	if err == nil {
		return ioengine.RowResult{OK: false, Error: "category already exists"}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ioengine.RowResult{}, err
	}
	sortOrder := parseInt32Default(firstMapped(row, defaults, "sort_order"), 0)
	created, err := a.q.CreateCatalogCategory(ctx, db.CreateCatalogCategoryParams{
		OrganizationID: orgID,
		ParentID:       pgtype.Int8{},
		Name:           name,
		Kind:           kind,
		SortOrder:      sortOrder,
		IsActive:       parseBoolDefault(firstMapped(row, defaults, "is_active"), true),
	})
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	return ioengine.RowResult{
		OK: true, EntityType: "catalog_category", EntityUUID: created.Uuid.String(), Op: "create",
	}, nil
}

func (a *CatalogCategoriesAdapter) RevertRow(ctx context.Context, entityType, entityUUID string, _ map[string]any) error {
	if entityType != "catalog_category" {
		return fmt.Errorf("unsupported entity")
	}
	orgID, err := organizationIDFromApply(ctx)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(entityUUID)
	if err != nil {
		return err
	}
	_, err = a.q.SoftDeleteCatalogCategory(ctx, db.SoftDeleteCatalogCategoryParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}

func parseNumericString(raw, fallback string) (pgtype.Numeric, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = fallback
	}
	var n pgtype.Numeric
	if err := n.Scan(raw); err != nil {
		return pgtype.Numeric{}, fmt.Errorf("invalid numeric: %s", raw)
	}
	return n, nil
}

var (
	_ ioengine.ResourceAdapter = (*CatalogProductsAdapter)(nil)
	_ ioengine.ResourceAdapter = (*CatalogServicesAdapter)(nil)
	_ ioengine.ResourceAdapter = (*CatalogCategoriesAdapter)(nil)
)
