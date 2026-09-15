package usecase

import (
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func numericPositive(raw string) (pgtype.Numeric, error) {
	raw = strings.TrimSpace(raw)
	var n pgtype.Numeric
	if err := n.Scan(raw); err != nil || !n.Valid {
		return pgtype.Numeric{}, fmt.Errorf("invalid amount")
	}
	if n.Int == nil || n.Int.Sign() <= 0 {
		return pgtype.Numeric{}, fmt.Errorf("amount must be positive")
	}
	return n, nil
}

func numericNonNeg(raw string) (pgtype.Numeric, error) {
	raw = strings.TrimSpace(raw)
	var n pgtype.Numeric
	if err := n.Scan(raw); err != nil || !n.Valid {
		return pgtype.Numeric{}, fmt.Errorf("invalid amount")
	}
	if n.Int != nil && n.Int.Sign() < 0 {
		return pgtype.Numeric{}, fmt.Errorf("amount must be non-negative")
	}
	return n, nil
}

func mulDecimalStrings(a, b string) (string, error) {
	ra, ok := new(big.Rat).SetString(strings.TrimSpace(a))
	if !ok {
		return "", fmt.Errorf("invalid price")
	}
	rb, ok := new(big.Rat).SetString(strings.TrimSpace(b))
	if !ok {
		return "", fmt.Errorf("invalid qty")
	}
	out := new(big.Rat).Mul(ra, rb)
	return out.FloatString(2), nil
}

func optionalUUID(u pgtype.UUID) *uuid.UUID {
	if !u.Valid {
		return nil
	}
	id := uuid.UUID(u.Bytes)
	return &id
}

func optionalTime(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func optionalTextPtr(s pgtype.Text) *string {
	if !s.Valid {
		return nil
	}
	v := s.String
	return &v
}

func mapPurchaseList(row db.ListPurchasesRow) Purchase {
	return Purchase{
		UUID:         row.Uuid,
		SupplierUUID: row.SupplierUuid,
		SupplierName: row.SupplierName,
		Status:       row.Status,
		Currency:     row.Currency,
		TotalAmount:  financeusecase.NumericToString(row.TotalAmount),
		Method:       row.Method,
		Notes:        row.Notes,
		PurchasedAt:  row.PurchasedAt.Time,
		CreatedAt:    row.CreatedAt.Time,
		VoidedAt:     optionalTime(row.VoidedAt),
	}
}

func mapPurchaseGet(row db.GetPurchaseByUUIDRow) Purchase {
	return Purchase{
		UUID:                   row.Uuid,
		SupplierUUID:           row.SupplierUuid,
		SupplierName:           row.SupplierName,
		Status:                 row.Status,
		Currency:               row.Currency,
		TotalAmount:            financeusecase.NumericToString(row.TotalAmount),
		Method:                 row.Method,
		FinanceAccountUUID:     optionalUUID(row.FinanceAccountUuid),
		FinanceAccountName:     optionalTextPtr(row.FinanceAccountName),
		FinanceTransactionUUID: optionalUUID(row.FinanceTransactionUuid),
		Notes:                  row.Notes,
		PurchasedAt:            row.PurchasedAt.Time,
		CreatedAt:              row.CreatedAt.Time,
		VoidedAt:               optionalTime(row.VoidedAt),
	}
}

func mapLine(row db.ListPurchaseLinesRow) Line {
	return Line{
		UUID:        row.Uuid,
		ProductUUID: row.ProductUuid,
		Name:        row.Name,
		UnitCost:    financeusecase.NumericToString(row.UnitCost),
		Qty:         financeusecase.NumericToString(row.Qty),
		LineTotal:   financeusecase.NumericToString(row.LineTotal),
		Currency:    row.Currency,
		SortOrder:   row.SortOrder,
	}
}
