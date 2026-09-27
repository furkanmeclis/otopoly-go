package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourcemeta"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
	ErrConflict       = errors.New("conflict")
)

type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
	act  *activity.Recorder
}

func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder) *Service {
	return &Service{pool: pool, q: q, act: act}
}

func (s *Service) requireOrgID(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, errors.New("organization context required")
	}
	return scope.InternalID, nil
}

func (s *Service) recordActivity(ctx context.Context, action, resource string, resourceUUID *uuid.UUID, payload map[string]any) {
	if s.act == nil {
		return
	}
	var actorID *int64
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		id := p.UserInternal
		actorID = &id
	}
	s.act.Record(ctx, actorID, action, resource, resourceUUID, payload, nil)
}

// ============================================================================
// Categories
// ============================================================================

func (s *Service) ListCategories(ctx context.Context, filters CategoryFilters) ([]Category, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, err
	}
	params := db.ListCatalogCategoriesParams{
		OrganizationID: orgID,
	}
	if filters.Kind != "" {
		params.Kind = pgtype.Text{String: filters.Kind, Valid: true}
	}
	if filters.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *filters.IsActive, Valid: true}
	}
	if filters.Q != "" {
		params.Q = pgtype.Text{String: filters.Q, Valid: true}
	}

	rows, err := s.q.ListCatalogCategories(ctx, params)
	if err != nil {
		return nil, err
	}

	out := make([]Category, 0, len(rows))
	for _, r := range rows {
		out = append(out, mapCategoryRow(r))
	}
	return out, nil
}

func (s *Service) GetCategory(ctx context.Context, id uuid.UUID) (Category, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Category{}, err
	}
	row, err := s.q.GetCatalogCategoryByUUID(ctx, db.GetCatalogCategoryByUUIDParams{
		Uuid:           id,
		OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Category{}, ErrNotFound
		}
		return Category{}, err
	}
	var parentUUID *uuid.UUID
	var parentName *string
	if row.ParentID.Valid {
		if pRow, pErr := s.q.GetCatalogCategoryByID(ctx, db.GetCatalogCategoryByIDParams{
			ID:             row.ParentID.Int64,
			OrganizationID: orgID,
		}); pErr == nil {
			parentUUID = &pRow.Uuid
			parentName = &pRow.Name
		}
	}
	return mapCategory(row, parentUUID, parentName), nil
}

func (s *Service) CreateCategory(ctx context.Context, in CreateCategoryInput) (Category, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Category{}, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Category{}, fmt.Errorf("%w: name is required", ErrInvalidRequest)
	}
	kind := strings.ToLower(strings.TrimSpace(in.Kind))
	if kind != "product" && kind != "service" {
		kind = "product"
	}

	var parentID pgtype.Int8
	var parentUUID *uuid.UUID
	var parentName *string
	if in.ParentUUID != nil {
		pRow, err := s.q.GetCatalogCategoryByUUID(ctx, db.GetCatalogCategoryByUUIDParams{
			Uuid:           *in.ParentUUID,
			OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Category{}, fmt.Errorf("%w: parent category not found", ErrInvalidRequest)
			}
			return Category{}, err
		}
		parentID = pgtype.Int8{Int64: pRow.ID, Valid: true}
		parentUUID = in.ParentUUID
		parentName = &pRow.Name
	}

	isActive := true
	if in.IsActive != nil {
		isActive = *in.IsActive
	}

	row, err := s.q.CreateCatalogCategory(ctx, db.CreateCatalogCategoryParams{
		OrganizationID: orgID,
		ParentID:       parentID,
		Name:           name,
		Kind:           kind,
		SortOrder:      in.SortOrder,
		IsActive:       isActive,
	})
	if err != nil {
		if strings.Contains(err.Error(), "uq_catalog_categories_org_name_kind_active") {
			return Category{}, fmt.Errorf("%w: category with this name and kind already exists", ErrConflict)
		}
		return Category{}, err
	}

	s.recordActivity(ctx, "tenant.catalog.category.create", "catalog_category", &row.Uuid, map[string]any{
		"name": row.Name,
		"kind": row.Kind,
	})

	return mapCategory(row, parentUUID, parentName), nil
}

func (s *Service) UpdateCategory(ctx context.Context, id uuid.UUID, in UpdateCategoryInput) (Category, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Category{}, err
	}
	params := db.UpdateCatalogCategoryParams{
		Uuid:           id,
		OrganizationID: orgID,
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return Category{}, fmt.Errorf("%w: name cannot be empty", ErrInvalidRequest)
		}
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	if in.Kind != nil {
		kind := strings.ToLower(strings.TrimSpace(*in.Kind))
		if kind == "product" || kind == "service" {
			params.Kind = pgtype.Text{String: kind, Valid: true}
		}
	}
	if in.SortOrder != nil {
		params.SortOrder = pgtype.Int4{Int32: *in.SortOrder, Valid: true}
	}
	if in.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *in.IsActive, Valid: true}
	}
	if in.SetParent {
		params.SetParent = pgtype.Bool{Bool: true, Valid: true}
		if in.ParentUUID != nil {
			pRow, err := s.q.GetCatalogCategoryByUUID(ctx, db.GetCatalogCategoryByUUIDParams{
				Uuid:           *in.ParentUUID,
				OrganizationID: orgID,
			})
			if err != nil {
				return Category{}, fmt.Errorf("%w: parent category not found", ErrInvalidRequest)
			}
			params.ParentID = pgtype.Int8{Int64: pRow.ID, Valid: true}
		} else {
			params.ParentID = pgtype.Int8{}
		}
	}

	row, err := s.q.UpdateCatalogCategory(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Category{}, ErrNotFound
		}
		if strings.Contains(err.Error(), "uq_catalog_categories_org_name_kind_active") {
			return Category{}, fmt.Errorf("%w: category with this name and kind already exists", ErrConflict)
		}
		return Category{}, err
	}

	s.recordActivity(ctx, "tenant.catalog.category.update", "catalog_category", &row.Uuid, nil)

	var parentUUID *uuid.UUID
	var parentName *string
	if row.ParentID.Valid {
		if pRow, pErr := s.q.GetCatalogCategoryByID(ctx, db.GetCatalogCategoryByIDParams{
			ID:             row.ParentID.Int64,
			OrganizationID: orgID,
		}); pErr == nil {
			parentUUID = &pRow.Uuid
			parentName = &pRow.Name
		}
	}

	return mapCategory(row, parentUUID, parentName), nil
}

func (s *Service) DeleteCategory(ctx context.Context, id uuid.UUID) error {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.SoftDeleteCatalogCategory(ctx, db.SoftDeleteCatalogCategoryParams{
		Uuid:           id,
		OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	s.recordActivity(ctx, "tenant.catalog.category.delete", "catalog_category", &row.Uuid, nil)
	return nil
}

// ============================================================================
// Products
// ============================================================================

func (s *Service) ListProducts(ctx context.Context, limit, offset int32, filters ProductFilters) ([]Product, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	listParams := db.ListProductsParams{
		OrganizationID: orgID,
		LimitCount:     limit,
		OffsetCount:    offset,
	}
	countParams := db.CountProductsParams{
		OrganizationID: orgID,
	}

	if filters.CategoryUUID != nil {
		listParams.CategoryUuid = pgtype.UUID{Bytes: *filters.CategoryUUID, Valid: true}
		countParams.CategoryUuid = listParams.CategoryUuid
	}
	if filters.IsActive != nil {
		listParams.IsActive = pgtype.Bool{Bool: *filters.IsActive, Valid: true}
		countParams.IsActive = listParams.IsActive
	}
	if filters.TrackStock != nil {
		listParams.TrackStock = pgtype.Bool{Bool: *filters.TrackStock, Valid: true}
		countParams.TrackStock = listParams.TrackStock
	}
	if filters.StockStatus != "" {
		listParams.StockStatus = pgtype.Text{String: filters.StockStatus, Valid: true}
		countParams.StockStatus = listParams.StockStatus
	}
	if filters.Unit != "" {
		listParams.Unit = pgtype.Text{String: filters.Unit, Valid: true}
		countParams.Unit = listParams.Unit
	}
	if filters.Q != "" {
		listParams.Q = pgtype.Text{String: filters.Q, Valid: true}
		countParams.Q = listParams.Q
	}
	if filters.SortBy != "" {
		listParams.SortBy = pgtype.Text{String: filters.SortBy, Valid: true}
	}

	rows, err := s.q.ListProducts(ctx, listParams)
	if err != nil {
		return nil, 0, err
	}

	total, err := s.q.CountProducts(ctx, countParams)
	if err != nil {
		return nil, 0, err
	}

	out := make([]Product, 0, len(rows))
	for _, r := range rows {
		out = append(out, mapProductRow(r))
	}
	return out, total, nil
}

func (s *Service) GetProduct(ctx context.Context, id uuid.UUID) (Product, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Product{}, err
	}
	row, err := s.q.GetProductByUUID(ctx, db.GetProductByUUIDParams{
		Uuid:           id,
		OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Product{}, ErrNotFound
		}
		return Product{}, err
	}
	return mapProduct(row), nil
}

func (s *Service) CreateProduct(ctx context.Context, in CreateProductInput) (Product, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Product{}, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Product{}, fmt.Errorf("%w: name is required", ErrInvalidRequest)
	}

	var categoryID pgtype.Int8
	if in.CategoryUUID != nil {
		cat, err := s.q.GetCatalogCategoryByUUID(ctx, db.GetCatalogCategoryByUUIDParams{
			Uuid:           *in.CategoryUUID,
			OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Product{}, fmt.Errorf("%w: category not found", ErrInvalidRequest)
			}
			return Product{}, err
		}
		categoryID = pgtype.Int8{Int64: cat.ID, Valid: true}
	}

	unit := strings.TrimSpace(in.Unit)
	if unit == "" {
		unit = "piece"
	}
	currency := strings.ToUpper(strings.TrimSpace(in.Currency))
	if currency == "" {
		currency = "TRY"
	}

	var costPrice pgtype.Numeric
	_ = costPrice.Scan(in.CostPrice)
	if !costPrice.Valid {
		_ = costPrice.Scan("0")
	}

	var salePrice pgtype.Numeric
	_ = salePrice.Scan(in.SalePrice)
	if !salePrice.Valid {
		_ = salePrice.Scan("0")
	}

	var vatRate pgtype.Numeric
	_ = vatRate.Scan(in.VATRate)
	if !vatRate.Valid {
		_ = vatRate.Scan("20")
	}

	var stockQty pgtype.Numeric
	_ = stockQty.Scan(in.StockQuantity)
	if !stockQty.Valid {
		_ = stockQty.Scan("0")
	}

	var minAlert pgtype.Numeric
	_ = minAlert.Scan(in.MinStockAlert)
	if !minAlert.Valid {
		_ = minAlert.Scan("0")
	}

	trackStock := true
	if in.TrackStock != nil {
		trackStock = *in.TrackStock
	}
	isActive := true
	if in.IsActive != nil {
		isActive = *in.IsActive
	}

	row, err := s.q.CreateProduct(ctx, db.CreateProductParams{
		OrganizationID: orgID,
		CategoryID:     categoryID,
		Name:           name,
		Sku:            optionalText(in.SKU),
		Barcode:        optionalText(in.Barcode),
		Unit:           unit,
		CostPrice:      costPrice,
		SalePrice:      salePrice,
		VatRate:        vatRate,
		Currency:       currency,
		StockQuantity:  stockQty,
		MinStockAlert:  minAlert,
		TrackStock:     trackStock,
		IsActive:       isActive,
		Description:    in.Description,
	})
	if err != nil {
		if strings.Contains(err.Error(), "uq_products_org_name_active") {
			return Product{}, fmt.Errorf("%w: product with this name already exists", ErrConflict)
		}
		if strings.Contains(err.Error(), "uq_products_org_sku_active") {
			return Product{}, fmt.Errorf("%w: product with this SKU already exists", ErrConflict)
		}
		if strings.Contains(err.Error(), "uq_products_org_barcode_active") {
			return Product{}, fmt.Errorf("%w: product with this barcode already exists", ErrConflict)
		}
		return Product{}, err
	}

	s.recordActivity(ctx, "tenant.catalog.product.create", "product", &row.Uuid, map[string]any{"name": row.Name})

	return s.GetProduct(ctx, row.Uuid)
}

func (s *Service) UpdateProduct(ctx context.Context, id uuid.UUID, in UpdateProductInput) (Product, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Product{}, err
	}
	params := db.UpdateProductParams{
		Uuid:           id,
		OrganizationID: orgID,
	}

	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return Product{}, fmt.Errorf("%w: name cannot be empty", ErrInvalidRequest)
		}
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	if in.SetCategory {
		params.SetCategory = pgtype.Bool{Bool: true, Valid: true}
		if in.CategoryUUID != nil {
			cat, err := s.q.GetCatalogCategoryByUUID(ctx, db.GetCatalogCategoryByUUIDParams{
				Uuid:           *in.CategoryUUID,
				OrganizationID: orgID,
			})
			if err != nil {
				return Product{}, fmt.Errorf("%w: category not found", ErrInvalidRequest)
			}
			params.CategoryID = pgtype.Int8{Int64: cat.ID, Valid: true}
		} else {
			params.CategoryID = pgtype.Int8{}
		}
	}
	if in.SetSKU {
		params.SetSku = pgtype.Bool{Bool: true, Valid: true}
		params.Sku = optionalText(in.SKU)
	}
	if in.SetBarcode {
		params.SetBarcode = pgtype.Bool{Bool: true, Valid: true}
		params.Barcode = optionalText(in.Barcode)
	}
	if in.Unit != nil {
		params.Unit = pgtype.Text{String: *in.Unit, Valid: true}
	}
	if in.CostPrice != nil {
		var n pgtype.Numeric
		if err := n.Scan(*in.CostPrice); err == nil {
			params.CostPrice = n
		}
	}
	if in.SalePrice != nil {
		var n pgtype.Numeric
		if err := n.Scan(*in.SalePrice); err == nil {
			params.SalePrice = n
		}
	}
	if in.VATRate != nil {
		var n pgtype.Numeric
		if err := n.Scan(*in.VATRate); err == nil {
			params.VatRate = n
		}
	}
	if in.Currency != nil {
		params.Currency = pgtype.Text{String: strings.ToUpper(*in.Currency), Valid: true}
	}
	if in.StockQuantity != nil {
		var n pgtype.Numeric
		if err := n.Scan(*in.StockQuantity); err == nil {
			params.StockQuantity = n
		}
	}
	if in.MinStockAlert != nil {
		var n pgtype.Numeric
		if err := n.Scan(*in.MinStockAlert); err == nil {
			params.MinStockAlert = n
		}
	}
	if in.TrackStock != nil {
		params.TrackStock = pgtype.Bool{Bool: *in.TrackStock, Valid: true}
	}
	if in.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *in.IsActive, Valid: true}
	}
	if in.Description != nil {
		params.Description = pgtype.Text{String: *in.Description, Valid: true}
	}

	row, err := s.q.UpdateProduct(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Product{}, ErrNotFound
		}
		if strings.Contains(err.Error(), "uq_products_org_name_active") {
			return Product{}, fmt.Errorf("%w: product with this name already exists", ErrConflict)
		}
		if strings.Contains(err.Error(), "uq_products_org_sku_active") {
			return Product{}, fmt.Errorf("%w: product with this SKU already exists", ErrConflict)
		}
		if strings.Contains(err.Error(), "uq_products_org_barcode_active") {
			return Product{}, fmt.Errorf("%w: product with this barcode already exists", ErrConflict)
		}
		return Product{}, err
	}

	s.recordActivity(ctx, "tenant.catalog.product.update", "product", &row.Uuid, nil)

	return s.GetProduct(ctx, row.Uuid)
}

func (s *Service) AdjustStock(ctx context.Context, id uuid.UUID, in AdjustStockInput) (Product, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Product{}, err
	}
	var delta pgtype.Numeric
	if err := delta.Scan(in.Delta); err != nil || !delta.Valid {
		return Product{}, fmt.Errorf("%w: invalid delta numeric value", ErrInvalidRequest)
	}

	row, err := s.q.AdjustProductStock(ctx, db.AdjustProductStockParams{
		Uuid:           id,
		OrganizationID: orgID,
		Delta:          delta,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Product{}, ErrNotFound
		}
		return Product{}, err
	}

	s.recordActivity(ctx, "tenant.catalog.product.adjust_stock", "product", &row.Uuid, map[string]any{
		"delta":       in.Delta,
		"reason":      in.Reason,
		"description": in.Description,
	})

	return s.GetProduct(ctx, row.Uuid)
}

func (s *Service) DeleteProduct(ctx context.Context, id uuid.UUID) error {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.SoftDeleteProduct(ctx, db.SoftDeleteProductParams{
		Uuid:           id,
		OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	s.recordActivity(ctx, "tenant.catalog.product.delete", "product", &row.Uuid, nil)
	return nil
}

// ============================================================================
// Services
// ============================================================================

func (s *Service) ListServices(ctx context.Context, limit, offset int32, filters ServiceFilters) ([]ServiceItem, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	listParams := db.ListServicesParams{
		OrganizationID: orgID,
		LimitCount:     limit,
		OffsetCount:    offset,
	}
	countParams := db.CountServicesParams{
		OrganizationID: orgID,
	}

	if filters.CategoryUUID != nil {
		listParams.CategoryUuid = pgtype.UUID{Bytes: *filters.CategoryUUID, Valid: true}
		countParams.CategoryUuid = listParams.CategoryUuid
	}
	if filters.IsActive != nil {
		listParams.IsActive = pgtype.Bool{Bool: *filters.IsActive, Valid: true}
		countParams.IsActive = listParams.IsActive
	}
	if filters.Q != "" {
		listParams.Q = pgtype.Text{String: filters.Q, Valid: true}
		countParams.Q = listParams.Q
	}
	if filters.SortBy != "" {
		listParams.SortBy = pgtype.Text{String: filters.SortBy, Valid: true}
	}

	rows, err := s.q.ListServices(ctx, listParams)
	if err != nil {
		return nil, 0, err
	}

	total, err := s.q.CountServices(ctx, countParams)
	if err != nil {
		return nil, 0, err
	}

	out := make([]ServiceItem, 0, len(rows))
	for _, r := range rows {
		out = append(out, mapServiceRow(r))
	}
	return out, total, nil
}

func (s *Service) GetService(ctx context.Context, id uuid.UUID) (ServiceItem, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return ServiceItem{}, err
	}
	row, err := s.q.GetServiceByUUID(ctx, db.GetServiceByUUIDParams{
		Uuid:           id,
		OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ServiceItem{}, ErrNotFound
		}
		return ServiceItem{}, err
	}
	return mapService(row), nil
}

func (s *Service) CreateService(ctx context.Context, in CreateServiceInput) (ServiceItem, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return ServiceItem{}, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return ServiceItem{}, fmt.Errorf("%w: name is required", ErrInvalidRequest)
	}

	var categoryID pgtype.Int8
	if in.CategoryUUID != nil {
		cat, err := s.q.GetCatalogCategoryByUUID(ctx, db.GetCatalogCategoryByUUIDParams{
			Uuid:           *in.CategoryUUID,
			OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ServiceItem{}, fmt.Errorf("%w: category not found", ErrInvalidRequest)
			}
			return ServiceItem{}, err
		}
		categoryID = pgtype.Int8{Int64: cat.ID, Valid: true}
	}

	dur := in.DurationMinutes
	if dur <= 0 {
		dur = 30
	}

	currency := strings.ToUpper(strings.TrimSpace(in.Currency))
	if currency == "" {
		currency = "TRY"
	}

	var price pgtype.Numeric
	_ = price.Scan(in.Price)
	if !price.Valid {
		_ = price.Scan("0")
	}

	var vatRate pgtype.Numeric
	_ = vatRate.Scan(in.VATRate)
	if !vatRate.Valid {
		_ = vatRate.Scan("20")
	}

	isActive := true
	if in.IsActive != nil {
		isActive = *in.IsActive
	}
	color, err := normalizeServiceColor(in.Color)
	if err != nil {
		return ServiceItem{}, err
	}

	row, err := s.q.CreateService(ctx, db.CreateServiceParams{
		OrganizationID:  orgID,
		CategoryID:      categoryID,
		Name:            name,
		Code:            optionalText(in.Code),
		DurationMinutes: dur,
		Price:           price,
		VatRate:         vatRate,
		Currency:        currency,
		IsActive:        isActive,
		Description:     in.Description,
		Color:           color,
	})
	if err != nil {
		if strings.Contains(err.Error(), "uq_services_org_name_active") {
			return ServiceItem{}, fmt.Errorf("%w: service with this name already exists", ErrConflict)
		}
		if strings.Contains(err.Error(), "uq_services_org_code_active") {
			return ServiceItem{}, fmt.Errorf("%w: service with this code already exists", ErrConflict)
		}
		return ServiceItem{}, err
	}

	s.recordActivity(ctx, "tenant.catalog.service.create", "service", &row.Uuid, map[string]any{"name": row.Name})

	return s.GetService(ctx, row.Uuid)
}

func (s *Service) UpdateService(ctx context.Context, id uuid.UUID, in UpdateServiceInput) (ServiceItem, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return ServiceItem{}, err
	}
	params := db.UpdateServiceParams{
		Uuid:           id,
		OrganizationID: orgID,
	}

	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return ServiceItem{}, fmt.Errorf("%w: name cannot be empty", ErrInvalidRequest)
		}
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	if in.SetCategory {
		params.SetCategory = pgtype.Bool{Bool: true, Valid: true}
		if in.CategoryUUID != nil {
			cat, err := s.q.GetCatalogCategoryByUUID(ctx, db.GetCatalogCategoryByUUIDParams{
				Uuid:           *in.CategoryUUID,
				OrganizationID: orgID,
			})
			if err != nil {
				return ServiceItem{}, fmt.Errorf("%w: category not found", ErrInvalidRequest)
			}
			params.CategoryID = pgtype.Int8{Int64: cat.ID, Valid: true}
		} else {
			params.CategoryID = pgtype.Int8{}
		}
	}
	if in.SetCode {
		params.SetCode = pgtype.Bool{Bool: true, Valid: true}
		params.Code = optionalText(in.Code)
	}
	if in.DurationMinutes != nil {
		params.DurationMinutes = pgtype.Int4{Int32: *in.DurationMinutes, Valid: true}
	}
	if in.Price != nil {
		var n pgtype.Numeric
		if err := n.Scan(*in.Price); err == nil {
			params.Price = n
		}
	}
	if in.VATRate != nil {
		var n pgtype.Numeric
		if err := n.Scan(*in.VATRate); err == nil {
			params.VatRate = n
		}
	}
	if in.Currency != nil {
		params.Currency = pgtype.Text{String: strings.ToUpper(*in.Currency), Valid: true}
	}
	if in.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *in.IsActive, Valid: true}
	}
	if in.Description != nil {
		params.Description = pgtype.Text{String: *in.Description, Valid: true}
	}
	if in.Color != nil {
		color, err := normalizeServiceColor(*in.Color)
		if err != nil {
			return ServiceItem{}, err
		}
		params.Color = pgtype.Text{String: color, Valid: true}
	}

	row, err := s.q.UpdateService(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ServiceItem{}, ErrNotFound
		}
		if strings.Contains(err.Error(), "uq_services_org_name_active") {
			return ServiceItem{}, fmt.Errorf("%w: service with this name already exists", ErrConflict)
		}
		if strings.Contains(err.Error(), "uq_services_org_code_active") {
			return ServiceItem{}, fmt.Errorf("%w: service with this code already exists", ErrConflict)
		}
		return ServiceItem{}, err
	}

	s.recordActivity(ctx, "tenant.catalog.service.update", "service", &row.Uuid, nil)

	return s.GetService(ctx, row.Uuid)
}

func (s *Service) DeleteService(ctx context.Context, id uuid.UUID) error {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.SoftDeleteService(ctx, db.SoftDeleteServiceParams{
		Uuid:           id,
		OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	s.recordActivity(ctx, "tenant.catalog.service.delete", "service", &row.Uuid, nil)
	return nil
}

// ============================================================================
// Summary / Stats
// ============================================================================

func (s *Service) GetSummary(ctx context.Context) (CatalogSummary, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return CatalogSummary{}, err
	}
	stats, err := s.q.GetCatalogStats(ctx, orgID)
	if err != nil {
		return CatalogSummary{}, err
	}
	return CatalogSummary{
		TotalProducts:       stats.TotalProducts,
		ActiveProducts:      stats.ActiveProducts,
		LowStockProducts:    stats.LowStockProducts,
		OutOfStockProducts:  stats.OutOfStockProducts,
		TotalStockCostValue: numericToMoneyString(stats.TotalStockCostValue),
		TotalStockSaleValue: numericToMoneyString(stats.TotalStockSaleValue),
		TotalServices:       stats.TotalServices,
		ActiveServices:      stats.ActiveServices,
		TotalCategories:     stats.TotalCategories,
	}, nil
}

// ============================================================================
// Resource Meta
// ============================================================================

func (s *Service) ProductsResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantCatalogProducts()
}

func (s *Service) ServicesResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantCatalogServices()
}

func (s *Service) CategoriesResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantCatalogCategories()
}

// normalizeServiceColor accepts a palette key or "" (auto).
func normalizeServiceColor(raw string) (string, error) {
	c := strings.ToLower(strings.TrimSpace(raw))
	if c == "" {
		return "", nil
	}
	for _, k := range ServiceColors {
		if k == c {
			return c, nil
		}
	}
	return "", fmt.Errorf("%w: unknown service color %q", ErrInvalidRequest, raw)
}
