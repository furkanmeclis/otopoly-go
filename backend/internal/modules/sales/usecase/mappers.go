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

func ratFromNumeric(n pgtype.Numeric) *big.Rat {
	if !n.Valid || n.Int == nil {
		return new(big.Rat)
	}
	rat := new(big.Rat).SetInt(n.Int)
	if n.Exp != 0 {
		ten := big.NewRat(10, 1)
		if n.Exp > 0 {
			for i := int32(0); i < n.Exp; i++ {
				rat.Mul(rat, ten)
			}
		} else {
			for i := int32(0); i > n.Exp; i-- {
				rat.Quo(rat, ten)
			}
		}
	}
	return rat
}

func parseDay(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		now := time.Now()
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()), nil
	}
	t, err := time.ParseInLocation("2006-01-02", raw, time.Local)
	if err != nil {
		return time.Time{}, err
	}
	return t, nil
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

func mapSaleList(row db.ListProductSalesRow) Sale {
	return Sale{
		UUID:          row.Uuid,
		CustomerUUID:  optionalUUID(row.CustomerUuid),
		CustomerName:  row.CustomerName,
		CustomerPhone: row.CustomerPhone,
		Status:        row.Status,
		Currency:      row.Currency,
		TotalAmount:   financeusecase.NumericToString(row.TotalAmount),
		Method:        row.Method,
		Notes:         row.Notes,
		SoldAt:        row.SoldAt.Time,
		CreatedAt:     row.CreatedAt.Time,
		VoidedAt:      optionalTime(row.VoidedAt),
	}
}

func mapSaleGet(row db.GetProductSaleByUUIDRow) Sale {
	return Sale{
		UUID:                   row.Uuid,
		CustomerUUID:           optionalUUID(row.CustomerUuid),
		CustomerName:           row.CustomerName,
		CustomerPhone:          row.CustomerPhone,
		Status:                 row.Status,
		Currency:               row.Currency,
		TotalAmount:            financeusecase.NumericToString(row.TotalAmount),
		Method:                 row.Method,
		FinanceAccountUUID:     optionalUUID(row.FinanceAccountUuid),
		FinanceAccountName:     optionalTextPtr(row.FinanceAccountName),
		FinanceTransactionUUID: optionalUUID(row.FinanceTransactionUuid),
		CariEntryUUID:          optionalUUID(row.CariEntryUuid),
		Notes:                  row.Notes,
		SoldAt:                 row.SoldAt.Time,
		CreatedAt:              row.CreatedAt.Time,
		VoidedAt:               optionalTime(row.VoidedAt),
	}
}

func mapLine(row db.ListProductSaleLinesRow) Line {
	return Line{
		UUID:        row.Uuid,
		ProductUUID: row.ProductUuid,
		Name:        row.Name,
		UnitPrice:   financeusecase.NumericToString(row.UnitPrice),
		Qty:         financeusecase.NumericToString(row.Qty),
		VatRate:     financeusecase.NumericToString(row.VatRate),
		LineTotal:   financeusecase.NumericToString(row.LineTotal),
		Currency:    row.Currency,
		SortOrder:   row.SortOrder,
	}
}
