package usecase

import (
	"strconv"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func numericToString(n pgtype.Numeric) string {
	if !n.Valid || n.Int == nil {
		return "0"
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return n.Int.String()
	}
	return strconv.FormatFloat(f.Float64, 'f', -1, 64)
}

func numericToMoneyString(n pgtype.Numeric) string {
	if !n.Valid || n.Int == nil {
		return "0.00"
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return n.Int.String()
	}
	return strconv.FormatFloat(f.Float64, 'f', 2, 64)
}

func mapCategoryRow(row db.ListCatalogCategoriesRow) Category {
	cat := Category{
		UUID:      row.Uuid,
		Name:      row.Name,
		Kind:      row.Kind,
		SortOrder: row.SortOrder,
		IsActive:  row.IsActive,
		CreatedAt: row.CreatedAt.Time,
		UpdatedAt: row.UpdatedAt.Time,
	}
	if row.ParentName.Valid {
		cat.ParentName = &row.ParentName.String
	}
	return cat
}

func mapCategory(row db.CatalogCategory, parentUUID *uuid.UUID, parentName *string) Category {
	cat := Category{
		UUID:       row.Uuid,
		Name:       row.Name,
		Kind:       row.Kind,
		ParentUUID: parentUUID,
		ParentName: parentName,
		SortOrder:  row.SortOrder,
		IsActive:   row.IsActive,
		CreatedAt:  row.CreatedAt.Time,
		UpdatedAt:  row.UpdatedAt.Time,
	}
	return cat
}

func computeStockStatus(trackStock bool, quantity, minAlert pgtype.Numeric) string {
	if !trackStock {
		return "untracked"
	}
	qVal := 0.0
	mVal := 0.0
	if quantity.Valid {
		if f, err := quantity.Float64Value(); err == nil && f.Valid {
			qVal = f.Float64
		}
	}
	if minAlert.Valid {
		if f, err := minAlert.Float64Value(); err == nil && f.Valid {
			mVal = f.Float64
		}
	}
	if qVal <= 0 {
		return "out_of_stock"
	}
	if qVal <= mVal {
		return "low_stock"
	}
	return "in_stock"
}

func mapProductRow(row db.ListProductsRow) Product {
	p := Product{
		UUID:          row.Uuid,
		Name:          row.Name,
		Unit:          row.Unit,
		CostPrice:     numericToMoneyString(row.CostPrice),
		SalePrice:     numericToMoneyString(row.SalePrice),
		VATRate:       numericToString(row.VatRate),
		Currency:      row.Currency,
		StockQuantity: numericToString(row.StockQuantity),
		MinStockAlert: numericToString(row.MinStockAlert),
		TrackStock:    row.TrackStock,
		IsActive:      row.IsActive,
		Description:   row.Description,
		StockStatus:   computeStockStatus(row.TrackStock, row.StockQuantity, row.MinStockAlert),
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}
	if row.CategoryUuid.Valid {
		id := uuid.UUID(row.CategoryUuid.Bytes)
		p.CategoryUUID = &id
	}
	if row.CategoryName.Valid {
		p.CategoryName = &row.CategoryName.String
	}
	if row.Sku.Valid {
		p.SKU = &row.Sku.String
	}
	if row.Barcode.Valid {
		p.Barcode = &row.Barcode.String
	}
	return p
}

func mapProduct(row db.GetProductByUUIDRow) Product {
	p := Product{
		UUID:          row.Uuid,
		Name:          row.Name,
		Unit:          row.Unit,
		CostPrice:     numericToMoneyString(row.CostPrice),
		SalePrice:     numericToMoneyString(row.SalePrice),
		VATRate:       numericToString(row.VatRate),
		Currency:      row.Currency,
		StockQuantity: numericToString(row.StockQuantity),
		MinStockAlert: numericToString(row.MinStockAlert),
		TrackStock:    row.TrackStock,
		IsActive:      row.IsActive,
		Description:   row.Description,
		StockStatus:   computeStockStatus(row.TrackStock, row.StockQuantity, row.MinStockAlert),
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}
	if row.CategoryUuid.Valid {
		id := uuid.UUID(row.CategoryUuid.Bytes)
		p.CategoryUUID = &id
	}
	if row.CategoryName.Valid {
		p.CategoryName = &row.CategoryName.String
	}
	if row.Sku.Valid {
		p.SKU = &row.Sku.String
	}
	if row.Barcode.Valid {
		p.Barcode = &row.Barcode.String
	}
	return p
}

func mapServiceRow(row db.ListServicesRow) ServiceItem {
	s := ServiceItem{
		UUID:            row.Uuid,
		Name:            row.Name,
		DurationMinutes: row.DurationMinutes,
		Price:           numericToMoneyString(row.Price),
		VATRate:         numericToString(row.VatRate),
		Currency:        row.Currency,
		IsActive:        row.IsActive,
		Description:     row.Description,
		Color:           row.Color,
		CreatedAt:       row.CreatedAt.Time,
		UpdatedAt:       row.UpdatedAt.Time,
	}
	if row.CategoryUuid.Valid {
		id := uuid.UUID(row.CategoryUuid.Bytes)
		s.CategoryUUID = &id
	}
	if row.CategoryName.Valid {
		s.CategoryName = &row.CategoryName.String
	}
	if row.Code.Valid {
		s.Code = &row.Code.String
	}
	return s
}

func mapService(row db.GetServiceByUUIDRow) ServiceItem {
	s := ServiceItem{
		UUID:            row.Uuid,
		Name:            row.Name,
		DurationMinutes: row.DurationMinutes,
		Price:           numericToMoneyString(row.Price),
		VATRate:         numericToString(row.VatRate),
		Currency:        row.Currency,
		IsActive:        row.IsActive,
		Description:     row.Description,
		Color:           row.Color,
		CreatedAt:       row.CreatedAt.Time,
		UpdatedAt:       row.UpdatedAt.Time,
	}
	if row.CategoryUuid.Valid {
		id := uuid.UUID(row.CategoryUuid.Bytes)
		s.CategoryUUID = &id
	}
	if row.CategoryName.Valid {
		s.CategoryName = &row.CategoryName.String
	}
	if row.Code.Valid {
		s.Code = &row.Code.String
	}
	return s
}

func optionalText(v *string) pgtype.Text {
	if v == nil {
		return pgtype.Text{}
	}
	s := strings.TrimSpace(*v)
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}
