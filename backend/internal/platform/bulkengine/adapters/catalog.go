package adapters

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	ResourceCatalogProducts = "tenant.catalog.products"
	ResourceCatalogServices = "tenant.catalog.services"
)

// SearchIndexer enqueues search index updates after bulk mutations.
type SearchIndexer interface {
	EnqueueUpsert(ctx context.Context, spec, id string)
	EnqueueDelete(ctx context.Context, spec, id string)
}

const (
	searchSpecCatalogProducts = "tenant_catalog_products"
	searchSpecCatalogServices = "tenant_catalog_services"
)

// CatalogProductsAdapter bulk actions for tenant catalog products.
type CatalogProductsAdapter struct {
	q      *db.Queries
	search SearchIndexer
}

func NewCatalogProducts(q *db.Queries) *CatalogProductsAdapter {
	return &CatalogProductsAdapter{q: q}
}

func (a *CatalogProductsAdapter) SetSearchIndexer(idx SearchIndexer) {
	a.search = idx
}

func (a *CatalogProductsAdapter) Resource() string { return ResourceCatalogProducts }

func (a *CatalogProductsAdapter) BulkActions() []bulkengine.BulkActionDef {
	percent := []bulkengine.BulkActionParam{{
		Key: "percent", Kind: "percent", Required: true, LabelKey: "bulk.params.percent",
	}}
	delta := []bulkengine.BulkActionParam{{
		Key: "delta", Kind: "number", Required: true, LabelKey: "bulk.params.delta",
	}}
	return []bulkengine.BulkActionDef{
		{
			ID: "activate", LabelKey: "bulk.actions.catalog_products.activate",
			Permission: rbac.PermTenantCatalogProductsBulkActivate, Reversible: true,
		},
		{
			ID: "deactivate", LabelKey: "bulk.actions.catalog_products.deactivate",
			Permission: rbac.PermTenantCatalogProductsBulkDeactivate, Reversible: true,
			ConfirmKey: "bulk.confirm.catalog_products.deactivate",
		},
		{
			ID: "raise_sale_price", LabelKey: "bulk.actions.catalog_products.raise_sale_price",
			Permission: rbac.PermTenantCatalogProductsBulkRaiseSalePrice, Reversible: true,
			ConfirmKey: "bulk.confirm.catalog_products.raise_sale_price", Params: percent,
		},
		{
			ID: "raise_cost_price", LabelKey: "bulk.actions.catalog_products.raise_cost_price",
			Permission: rbac.PermTenantCatalogProductsBulkRaiseCostPrice, Reversible: true,
			ConfirmKey: "bulk.confirm.catalog_products.raise_cost_price", Params: percent,
		},
		{
			ID: "adjust_stock", LabelKey: "bulk.actions.catalog_products.adjust_stock",
			Permission: rbac.PermTenantCatalogProductsBulkAdjustStock, Reversible: true,
			ConfirmKey: "bulk.confirm.catalog_products.adjust_stock", Params: delta,
		},
		{
			ID: "delete", LabelKey: "bulk.actions.catalog_products.delete",
			Permission: rbac.PermTenantCatalogProductsBulkDelete, Destructive: true, Reversible: true,
			ConfirmKey: "bulk.confirm.catalog_products.delete",
		},
	}
}

func (a *CatalogProductsAdapter) ResolveTargets(ctx context.Context, _ string, target bulkengine.BulkTarget) ([]string, error) {
	orgID, err := resolveOrgID(ctx, a.q, target)
	if err != nil {
		return nil, err
	}
	if target.Scope == "ids" {
		return uniqueNonEmpty(target.IDs)
	}
	if target.Scope != "query" {
		return nil, fmt.Errorf("invalid target scope")
	}
	rows, err := a.q.ListProductUUIDsForBulk(ctx, db.ListProductUUIDsForBulkParams{
		OrganizationID: orgID,
		CategoryUuid:   uuidArg(target.Query["category_uuid"]),
		IsActive:       boolArg(target.Query["is_active"]),
		TrackStock:     boolArg(target.Query["track_stock"]),
		StockStatus:    textArg(target.Query["stock_status"]),
		Unit:           textArg(target.Query["unit"]),
		Q:              textArg(target.Query["q"]),
	})
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, id := range rows {
		out = append(out, id.String())
	}
	return out, nil
}

func (a *CatalogProductsAdapter) ApplyItem(ctx context.Context, action, entityUUID string) (bulkengine.BulkItemResult, error) {
	orgID, err := resolveOrgID(ctx, a.q, bulkengine.BulkTarget{})
	if err != nil {
		return bulkengine.BulkItemResult{}, err
	}
	id, err := uuid.Parse(entityUUID)
	if err != nil {
		return failItem(entityUUID, "invalid uuid"), nil
	}
	row, err := a.q.GetProductByUUID(ctx, db.GetProductByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return failItem(entityUUID, "not found"), nil
		}
		return bulkengine.BulkItemResult{}, err
	}
	previous := map[string]any{
		"is_active":      row.IsActive,
		"sale_price":     numericPlain(row.SalePrice),
		"cost_price":     numericPlain(row.CostPrice),
		"stock_quantity": numericPlain(row.StockQuantity),
		"track_stock":    row.TrackStock,
	}
	params := paramsFrom(ctx)
	switch action {
	case "activate":
		if row.IsActive {
			return okUpdate(entityUUID, "product", previous), nil
		}
		_, err = a.q.UpdateProduct(ctx, db.UpdateProductParams{
			Uuid: id, OrganizationID: orgID, IsActive: pgtype.Bool{Bool: true, Valid: true},
		})
	case "deactivate":
		if !row.IsActive {
			return okUpdate(entityUUID, "product", previous), nil
		}
		_, err = a.q.UpdateProduct(ctx, db.UpdateProductParams{
			Uuid: id, OrganizationID: orgID, IsActive: pgtype.Bool{Bool: false, Valid: true},
		})
	case "raise_sale_price":
		next, scaleErr := scaleNumeric(row.SalePrice, params["percent"], 2)
		if scaleErr != nil {
			return failItem(entityUUID, scaleErr.Error()), nil
		}
		_, err = a.q.UpdateProduct(ctx, db.UpdateProductParams{
			Uuid: id, OrganizationID: orgID, SalePrice: next,
		})
	case "raise_cost_price":
		next, scaleErr := scaleNumeric(row.CostPrice, params["percent"], 2)
		if scaleErr != nil {
			return failItem(entityUUID, scaleErr.Error()), nil
		}
		_, err = a.q.UpdateProduct(ctx, db.UpdateProductParams{
			Uuid: id, OrganizationID: orgID, CostPrice: next,
		})
	case "adjust_stock":
		if !row.TrackStock {
			return failItem(entityUUID, "stock not tracked"), nil
		}
		delta, parseErr := parseFloat(params["delta"])
		if parseErr != nil {
			return failItem(entityUUID, "invalid delta"), nil
		}
		var deltaNum pgtype.Numeric
		if scanErr := deltaNum.Scan(strconv.FormatFloat(delta, 'f', 3, 64)); scanErr != nil {
			return failItem(entityUUID, "invalid delta"), nil
		}
		_, err = a.q.AdjustProductStock(ctx, db.AdjustProductStockParams{
			Uuid: id, OrganizationID: orgID, Delta: deltaNum,
		})
	case "delete":
		_, err = a.q.SoftDeleteProduct(ctx, db.SoftDeleteProductParams{Uuid: id, OrganizationID: orgID})
		if err == nil && a.search != nil {
			a.search.EnqueueDelete(ctx, searchSpecCatalogProducts, entityUUID)
		}
	default:
		return failItem(entityUUID, "unknown action"), nil
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return failItem(entityUUID, "not found"), nil
		}
		return failItem(entityUUID, err.Error()), nil
	}
	if action != "delete" && a.search != nil {
		a.search.EnqueueUpsert(ctx, searchSpecCatalogProducts, entityUUID)
	}
	return okUpdate(entityUUID, "product", previous), nil
}

func (a *CatalogProductsAdapter) RevertItem(ctx context.Context, action, entityUUID string, previous map[string]any) error {
	orgID, err := resolveOrgID(ctx, a.q, bulkengine.BulkTarget{})
	if err != nil {
		return err
	}
	id, err := uuid.Parse(entityUUID)
	if err != nil {
		return err
	}
	switch action {
	case "delete":
		active, _ := previous["is_active"].(bool)
		if err := a.q.RestoreProduct(ctx, db.RestoreProductParams{
			Uuid: id, OrganizationID: orgID, IsActive: active,
		}); err != nil {
			return err
		}
	case "activate", "deactivate":
		active, _ := previous["is_active"].(bool)
		_, err = a.q.UpdateProduct(ctx, db.UpdateProductParams{
			Uuid: id, OrganizationID: orgID, IsActive: pgtype.Bool{Bool: active, Valid: true},
		})
	case "raise_sale_price":
		price, convErr := numericFromAny(previous["sale_price"])
		if convErr != nil {
			return convErr
		}
		_, err = a.q.UpdateProduct(ctx, db.UpdateProductParams{
			Uuid: id, OrganizationID: orgID, SalePrice: price,
		})
	case "raise_cost_price":
		next, convErr := numericFromAny(previous["cost_price"])
		if convErr != nil {
			return convErr
		}
		_, err = a.q.UpdateProduct(ctx, db.UpdateProductParams{
			Uuid: id, OrganizationID: orgID, CostPrice: next,
		})
	case "adjust_stock":
		qty, convErr := numericFromAny(previous["stock_quantity"])
		if convErr != nil {
			return convErr
		}
		_, err = a.q.UpdateProduct(ctx, db.UpdateProductParams{
			Uuid: id, OrganizationID: orgID, StockQuantity: qty,
		})
	default:
		return fmt.Errorf("unknown action")
	}
	if err != nil {
		return err
	}
	if a.search != nil {
		a.search.EnqueueUpsert(ctx, searchSpecCatalogProducts, entityUUID)
	}
	return nil
}

// CatalogServicesAdapter bulk actions for tenant catalog services.
type CatalogServicesAdapter struct {
	q      *db.Queries
	search SearchIndexer
}

func NewCatalogServices(q *db.Queries) *CatalogServicesAdapter {
	return &CatalogServicesAdapter{q: q}
}

func (a *CatalogServicesAdapter) SetSearchIndexer(idx SearchIndexer) {
	a.search = idx
}

func (a *CatalogServicesAdapter) Resource() string { return ResourceCatalogServices }

func (a *CatalogServicesAdapter) BulkActions() []bulkengine.BulkActionDef {
	percent := []bulkengine.BulkActionParam{{
		Key: "percent", Kind: "percent", Required: true, LabelKey: "bulk.params.percent",
	}}
	return []bulkengine.BulkActionDef{
		{
			ID: "activate", LabelKey: "bulk.actions.catalog_services.activate",
			Permission: rbac.PermTenantCatalogServicesBulkActivate, Reversible: true,
		},
		{
			ID: "deactivate", LabelKey: "bulk.actions.catalog_services.deactivate",
			Permission: rbac.PermTenantCatalogServicesBulkDeactivate, Reversible: true,
			ConfirmKey: "bulk.confirm.catalog_services.deactivate",
		},
		{
			ID: "raise_price", LabelKey: "bulk.actions.catalog_services.raise_price",
			Permission: rbac.PermTenantCatalogServicesBulkRaisePrice, Reversible: true,
			ConfirmKey: "bulk.confirm.catalog_services.raise_price", Params: percent,
		},
		{
			ID: "delete", LabelKey: "bulk.actions.catalog_services.delete",
			Permission: rbac.PermTenantCatalogServicesBulkDelete, Destructive: true, Reversible: true,
			ConfirmKey: "bulk.confirm.catalog_services.delete",
		},
	}
}

func (a *CatalogServicesAdapter) ResolveTargets(ctx context.Context, _ string, target bulkengine.BulkTarget) ([]string, error) {
	orgID, err := resolveOrgID(ctx, a.q, target)
	if err != nil {
		return nil, err
	}
	if target.Scope == "ids" {
		return uniqueNonEmpty(target.IDs)
	}
	if target.Scope != "query" {
		return nil, fmt.Errorf("invalid target scope")
	}
	rows, err := a.q.ListServiceUUIDsForBulk(ctx, db.ListServiceUUIDsForBulkParams{
		OrganizationID: orgID,
		CategoryUuid:   uuidArg(target.Query["category_uuid"]),
		IsActive:       boolArg(target.Query["is_active"]),
		Q:              textArg(target.Query["q"]),
	})
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, id := range rows {
		out = append(out, id.String())
	}
	return out, nil
}

func (a *CatalogServicesAdapter) ApplyItem(ctx context.Context, action, entityUUID string) (bulkengine.BulkItemResult, error) {
	orgID, err := resolveOrgID(ctx, a.q, bulkengine.BulkTarget{})
	if err != nil {
		return bulkengine.BulkItemResult{}, err
	}
	id, err := uuid.Parse(entityUUID)
	if err != nil {
		return failItem(entityUUID, "invalid uuid"), nil
	}
	row, err := a.q.GetServiceByUUID(ctx, db.GetServiceByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return failItem(entityUUID, "not found"), nil
		}
		return bulkengine.BulkItemResult{}, err
	}
	previous := map[string]any{
		"is_active": row.IsActive,
		"price":     numericPlain(row.Price),
	}
	params := paramsFrom(ctx)
	switch action {
	case "activate":
		if row.IsActive {
			return okUpdate(entityUUID, "service", previous), nil
		}
		_, err = a.q.UpdateService(ctx, db.UpdateServiceParams{
			Uuid: id, OrganizationID: orgID, IsActive: pgtype.Bool{Bool: true, Valid: true},
		})
	case "deactivate":
		if !row.IsActive {
			return okUpdate(entityUUID, "service", previous), nil
		}
		_, err = a.q.UpdateService(ctx, db.UpdateServiceParams{
			Uuid: id, OrganizationID: orgID, IsActive: pgtype.Bool{Bool: false, Valid: true},
		})
	case "raise_price":
		next, scaleErr := scaleNumeric(row.Price, params["percent"], 2)
		if scaleErr != nil {
			return failItem(entityUUID, scaleErr.Error()), nil
		}
		_, err = a.q.UpdateService(ctx, db.UpdateServiceParams{
			Uuid: id, OrganizationID: orgID, Price: next,
		})
	case "delete":
		_, err = a.q.SoftDeleteService(ctx, db.SoftDeleteServiceParams{Uuid: id, OrganizationID: orgID})
		if err == nil && a.search != nil {
			a.search.EnqueueDelete(ctx, searchSpecCatalogServices, entityUUID)
		}
	default:
		return failItem(entityUUID, "unknown action"), nil
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return failItem(entityUUID, "not found"), nil
		}
		return failItem(entityUUID, err.Error()), nil
	}
	if action != "delete" && a.search != nil {
		a.search.EnqueueUpsert(ctx, searchSpecCatalogServices, entityUUID)
	}
	return okUpdate(entityUUID, "service", previous), nil
}

func (a *CatalogServicesAdapter) RevertItem(ctx context.Context, action, entityUUID string, previous map[string]any) error {
	orgID, err := resolveOrgID(ctx, a.q, bulkengine.BulkTarget{})
	if err != nil {
		return err
	}
	id, err := uuid.Parse(entityUUID)
	if err != nil {
		return err
	}
	switch action {
	case "delete":
		active, _ := previous["is_active"].(bool)
		if err := a.q.RestoreService(ctx, db.RestoreServiceParams{
			Uuid: id, OrganizationID: orgID, IsActive: active,
		}); err != nil {
			return err
		}
	case "activate", "deactivate":
		active, _ := previous["is_active"].(bool)
		_, err = a.q.UpdateService(ctx, db.UpdateServiceParams{
			Uuid: id, OrganizationID: orgID, IsActive: pgtype.Bool{Bool: active, Valid: true},
		})
	case "raise_price":
		price, convErr := numericFromAny(previous["price"])
		if convErr != nil {
			return convErr
		}
		_, err = a.q.UpdateService(ctx, db.UpdateServiceParams{
			Uuid: id, OrganizationID: orgID, Price: price,
		})
	default:
		return fmt.Errorf("unknown action")
	}
	if err != nil {
		return err
	}
	if a.search != nil {
		a.search.EnqueueUpsert(ctx, searchSpecCatalogServices, entityUUID)
	}
	return nil
}

func resolveOrgID(ctx context.Context, q *db.Queries, target bulkengine.BulkTarget) (int64, error) {
	if scope, ok := orgctx.ScopeFrom(ctx); ok {
		return scope.InternalID, nil
	}
	raw := target.Query["organization_uuid"]
	if raw == "" {
		if run, ok := bulkengine.RunFrom(ctx); ok {
			raw = run.Query["organization_uuid"]
		}
	}
	if raw == "" || q == nil {
		return 0, fmt.Errorf("organization required")
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return 0, fmt.Errorf("organization required")
	}
	org, err := q.GetOrganizationByUUID(ctx, id)
	if err != nil {
		return 0, err
	}
	return org.ID, nil
}

func paramsFrom(ctx context.Context) map[string]string {
	if run, ok := bulkengine.RunFrom(ctx); ok && run.Params != nil {
		return run.Params
	}
	return map[string]string{}
}

func failItem(entityUUID, msg string) bulkengine.BulkItemResult {
	return bulkengine.BulkItemResult{EntityUUID: entityUUID, OK: false, Error: msg}
}

func okUpdate(entityUUID, entityType string, previous map[string]any) bulkengine.BulkItemResult {
	return bulkengine.BulkItemResult{
		EntityUUID: entityUUID, EntityType: entityType, OK: true, Op: "update", Previous: previous,
	}
}

func uuidArg(raw string) pgtype.UUID {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return pgtype.UUID{}
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: id, Valid: true}
}

func boolArg(raw string) pgtype.Bool {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "true", "1":
		return pgtype.Bool{Bool: true, Valid: true}
	case "false", "0":
		return pgtype.Bool{Bool: false, Valid: true}
	default:
		return pgtype.Bool{}
	}
}

func parseFloat(raw string) (float64, error) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, ",", "."))
	if raw == "" {
		return 0, fmt.Errorf("value is required")
	}
	return strconv.ParseFloat(raw, 64)
}

func scaleNumeric(n pgtype.Numeric, percentRaw string, places int) (pgtype.Numeric, error) {
	percent, err := parseFloat(percentRaw)
	if err != nil {
		return pgtype.Numeric{}, fmt.Errorf("invalid percent")
	}
	base := 0.0
	if n.Valid {
		if f, err := n.Float64Value(); err == nil && f.Valid {
			base = f.Float64
		}
	}
	next := base * (1 + percent/100)
	var out pgtype.Numeric
	if err := out.Scan(strconv.FormatFloat(next, 'f', places, 64)); err != nil {
		return pgtype.Numeric{}, err
	}
	return out, nil
}

func numericPlain(n pgtype.Numeric) string {
	if !n.Valid {
		return "0"
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return "0"
	}
	return strconv.FormatFloat(f.Float64, 'f', -1, 64)
}

func numericFromAny(v any) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	switch val := v.(type) {
	case string:
		if err := n.Scan(val); err != nil {
			return pgtype.Numeric{}, err
		}
	case float64:
		if err := n.Scan(strconv.FormatFloat(val, 'f', -1, 64)); err != nil {
			return pgtype.Numeric{}, err
		}
	default:
		return pgtype.Numeric{}, fmt.Errorf("invalid previous numeric")
	}
	return n, nil
}
