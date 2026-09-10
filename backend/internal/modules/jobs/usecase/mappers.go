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

func normalizeSort(sort string) string {
	sort = strings.TrimSpace(sort)
	switch sort {
	case "started_at", "-started_at", "total_amount", "-total_amount", "plate", "-plate":
		return sort
	default:
		return "-started_at"
	}
}

func parseDay(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		now := time.Now()
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()), nil
	}
	return time.ParseInLocation("2006-01-02", raw, time.Local)
}

func numericPositive(raw string) (pgtype.Numeric, error) {
	raw = strings.TrimSpace(raw)
	var n pgtype.Numeric
	if err := n.Scan(raw); err != nil {
		return pgtype.Numeric{}, fmt.Errorf("invalid amount")
	}
	if !n.Valid || n.Int == nil || n.Int.Sign() <= 0 {
		return pgtype.Numeric{}, fmt.Errorf("must be positive")
	}
	return n, nil
}

func numericNonNeg(raw string) (pgtype.Numeric, error) {
	raw = strings.TrimSpace(raw)
	var n pgtype.Numeric
	if err := n.Scan(raw); err != nil {
		return pgtype.Numeric{}, fmt.Errorf("invalid amount")
	}
	if !n.Valid || n.Int == nil || n.Int.Sign() < 0 {
		return pgtype.Numeric{}, fmt.Errorf("must be non-negative")
	}
	return n, nil
}

func mulDecimalStrings(a, b string) (string, error) {
	ra, ok := new(big.Rat).SetString(strings.TrimSpace(a))
	if !ok {
		return "", fmt.Errorf("invalid number %q", a)
	}
	rb, ok := new(big.Rat).SetString(strings.TrimSpace(b))
	if !ok {
		return "", fmt.Errorf("invalid number %q", b)
	}
	out := new(big.Rat).Mul(ra, rb)
	return out.FloatString(2), nil
}

func tsPtr(v pgtype.Timestamptz) *time.Time {
	if !v.Valid {
		return nil
	}
	t := v.Time
	return &t
}

func mapListJob(row db.ListServiceJobsRow) Job {
	return Job{
		UUID:          row.Uuid,
		CustomerUUID:  row.CustomerUuid,
		VehicleUUID:   row.VehicleUuid,
		CustomerName:  row.CustomerName,
		CustomerPhone: row.CustomerPhone,
		Plate:         row.Plate,
		VehicleLabel:  row.VehicleLabel,
		Status:        row.Status,
		Currency:      row.Currency,
		Notes:         row.Notes,
		TotalAmount:   financeusecase.NumericToString(row.TotalAmount),
		StartedAt:     row.StartedAt.Time,
		CompletedAt:   tsPtr(row.CompletedAt),
		PaidAt:        tsPtr(row.PaidAt),
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}
}

func mapCustomerJob(row db.ListServiceJobsByCustomerRow) Job {
	return Job{
		UUID:          row.Uuid,
		CustomerUUID:  row.CustomerUuid,
		VehicleUUID:   row.VehicleUuid,
		CustomerName:  row.CustomerName,
		CustomerPhone: row.CustomerPhone,
		Plate:         row.Plate,
		VehicleLabel:  row.VehicleLabel,
		Status:        row.Status,
		Currency:      row.Currency,
		Notes:         row.Notes,
		TotalAmount:   financeusecase.NumericToString(row.TotalAmount),
		StartedAt:     row.StartedAt.Time,
		CompletedAt:   tsPtr(row.CompletedAt),
		PaidAt:        tsPtr(row.PaidAt),
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}
}

func mapGetJob(row db.GetServiceJobByUUIDRow) Job {
	return Job{
		UUID:          row.Uuid,
		CustomerUUID:  row.CustomerUuid,
		VehicleUUID:   row.VehicleUuid,
		CustomerName:  row.CustomerName,
		CustomerPhone: row.CustomerPhone,
		Plate:         row.Plate,
		VehicleLabel:  row.VehicleLabel,
		Status:        row.Status,
		Currency:      row.Currency,
		Notes:         row.Notes,
		TotalAmount:   financeusecase.NumericToString(row.TotalAmount),
		StartedAt:     row.StartedAt.Time,
		CompletedAt:   tsPtr(row.CompletedAt),
		PaidAt:        tsPtr(row.PaidAt),
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}
}

func mapLine(row db.ListServiceJobLinesRow) Line {
	line := Line{
		UUID:      row.Uuid,
		LineType:  row.LineType,
		Name:      row.Name,
		UnitPrice: financeusecase.NumericToString(row.UnitPrice),
		Qty:       financeusecase.NumericToString(row.Qty),
		VatRate:   financeusecase.NumericToString(row.VatRate),
		LineTotal: financeusecase.NumericToString(row.LineTotal),
		Currency:  row.Currency,
		SortOrder: row.SortOrder,
	}
	if row.ServiceUuid.Valid {
		id := uuid.UUID(row.ServiceUuid.Bytes)
		line.ServiceUUID = &id
	}
	return line
}

func mapPayment(row db.ListServiceJobPaymentsRow) Payment {
	p := Payment{
		UUID:      row.Uuid,
		Method:    row.Method,
		Amount:    financeusecase.NumericToString(row.Amount),
		Currency:  row.Currency,
		Status:    row.Status,
		CreatedAt: row.CreatedAt.Time,
	}
	if row.FinanceAccountUuid.Valid {
		id := uuid.UUID(row.FinanceAccountUuid.Bytes)
		p.FinanceAccountUUID = &id
	}
	if row.FinanceAccountName.Valid {
		s := row.FinanceAccountName.String
		p.FinanceAccountName = &s
	}
	if row.FinanceTransactionUuid.Valid {
		id := uuid.UUID(row.FinanceTransactionUuid.Bytes)
		p.FinanceTransactionUUID = &id
	}
	if row.CariEntryUuid.Valid {
		id := uuid.UUID(row.CariEntryUuid.Bytes)
		p.CariEntryUUID = &id
	}
	if row.VoidedAt.Valid {
		t := row.VoidedAt.Time
		p.VoidedAt = &t
	}
	return p
}
