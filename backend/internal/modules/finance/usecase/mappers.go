package usecase

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

var errInvalidDate = errors.New("invalid date")

func mapAccount(row db.FinanceAccount) Account {
	acc := Account{
		UUID:           row.Uuid,
		Name:           row.Name,
		Type:           row.Type,
		Currency:       row.Currency,
		OpeningBalance: numericToString(row.OpeningBalance),
		CurrentBalance: numericToString(row.CurrentBalance),
		IsDefault:      row.IsDefault,
		IsActive:       row.IsActive,
		Notes:          row.Notes,
		CreatedAt:      row.CreatedAt.Time,
		UpdatedAt:      row.UpdatedAt.Time,
	}
	if row.BankName.Valid {
		acc.BankName = &row.BankName.String
	}
	if row.Iban.Valid {
		acc.IBAN = &row.Iban.String
	}
	acc.NegativeBalance = numericSign(row.CurrentBalance) < 0
	return acc
}

func mapCategory(row db.FinanceCategory, parents map[int64]uuid.UUID) Category {
	cat := Category{
		UUID:      row.Uuid,
		Name:      row.Name,
		Kind:      row.Kind,
		SortOrder: row.SortOrder,
		IsActive:  row.IsActive,
		CreatedAt: row.CreatedAt.Time,
		UpdatedAt: row.UpdatedAt.Time,
	}
	if row.ParentID.Valid && parents != nil {
		if pid, ok := parents[row.ParentID.Int64]; ok {
			cat.ParentUUID = &pid
		}
	}
	return cat
}

func mapTransactionRow(row db.ListFinanceTransactionsRow) Transaction {
	tx := Transaction{
		UUID:            row.Uuid,
		Type:            row.Type,
		Status:          row.Status,
		AccountUUID:     row.AccountUuid,
		AccountName:     row.AccountName,
		Amount:          numericToString(row.Amount),
		Currency:        row.Currency,
		TransactionDate: formatDate(row.TransactionDate),
		Description:     row.Description,
		PaymentMethod:   row.PaymentMethod,
		CreatedAt:       row.CreatedAt.Time,
		UpdatedAt:       row.UpdatedAt.Time,
	}
	if row.CounterAccountUuid.Valid {
		id := uuid.UUID(row.CounterAccountUuid.Bytes)
		tx.CounterAccountUUID = &id
	}
	if row.CounterAccountName.Valid {
		tx.CounterAccountName = &row.CounterAccountName.String
	}
	if row.CategoryUuid.Valid {
		id := uuid.UUID(row.CategoryUuid.Bytes)
		tx.CategoryUUID = &id
	}
	if row.CategoryName.Valid {
		tx.CategoryName = &row.CategoryName.String
	}
	if row.ReferenceNo.Valid {
		tx.ReferenceNo = &row.ReferenceNo.String
	}
	if row.SourceType.Valid {
		tx.SourceType = &row.SourceType.String
	}
	if row.SourceUuid.Valid {
		id := uuid.UUID(row.SourceUuid.Bytes)
		tx.SourceUUID = &id
	}
	if row.VoidedAt.Valid {
		t := row.VoidedAt.Time
		tx.VoidedAt = &t
	}
	if len(row.Metadata) > 0 {
		var meta any
		if err := json.Unmarshal(row.Metadata, &meta); err == nil {
			tx.Metadata = meta
		}
	}
	return tx
}

func mapTransactionDetail(
	row db.FinanceTransaction,
	account db.FinanceAccount,
	counterUUID *uuid.UUID,
	counterName *string,
	categoryUUID *uuid.UUID,
	categoryName *string,
) Transaction {
	tx := Transaction{
		UUID:            row.Uuid,
		Type:            row.Type,
		Status:          row.Status,
		AccountUUID:     account.Uuid,
		AccountName:     account.Name,
		CounterAccountUUID: counterUUID,
		CounterAccountName: counterName,
		CategoryUUID:    categoryUUID,
		CategoryName:    categoryName,
		Amount:          numericToString(row.Amount),
		Currency:        row.Currency,
		TransactionDate: formatDate(row.TransactionDate),
		Description:     row.Description,
		PaymentMethod:   row.PaymentMethod,
		CreatedAt:       row.CreatedAt.Time,
		UpdatedAt:       row.UpdatedAt.Time,
	}
	if row.ReferenceNo.Valid {
		tx.ReferenceNo = &row.ReferenceNo.String
	}
	if row.SourceType.Valid {
		tx.SourceType = &row.SourceType.String
	}
	if row.SourceUuid.Valid {
		id := uuid.UUID(row.SourceUuid.Bytes)
		tx.SourceUUID = &id
	}
	if row.VoidedAt.Valid {
		t := row.VoidedAt.Time
		tx.VoidedAt = &t
	}
	if len(row.Metadata) > 0 {
		var meta any
		if err := json.Unmarshal(row.Metadata, &meta); err == nil {
			tx.Metadata = meta
		}
	}
	return tx
}

func mapRecentTransaction(row db.ListRecentFinanceTransactionsByAccountRow) Transaction {
	tx := Transaction{
		UUID:            row.Uuid,
		Type:            row.Type,
		Status:          row.Status,
		Amount:          numericToString(row.Amount),
		Currency:        row.Currency,
		TransactionDate: formatDate(row.TransactionDate),
		Description:     row.Description,
		PaymentMethod:   row.PaymentMethod,
		CreatedAt:       row.CreatedAt.Time,
		UpdatedAt:       row.UpdatedAt.Time,
	}
	if row.CategoryUuid.Valid {
		id := uuid.UUID(row.CategoryUuid.Bytes)
		tx.CategoryUUID = &id
	}
	if row.CategoryName.Valid {
		tx.CategoryName = &row.CategoryName.String
	}
	if row.ReferenceNo.Valid {
		tx.ReferenceNo = &row.ReferenceNo.String
	}
	if row.VoidedAt.Valid {
		t := row.VoidedAt.Time
		tx.VoidedAt = &t
	}
	return tx
}

func buildTransactionListParams(orgID int64, limit, offset int32, filters TransactionFilters) (db.ListFinanceTransactionsParams, db.CountFinanceTransactionsParams) {
	list := db.ListFinanceTransactionsParams{
		OrganizationID: orgID,
		LimitCount:   limit,
		OffsetCount:  offset,
	}
	count := db.CountFinanceTransactionsParams{OrganizationID: orgID}
	if filters.Type != "" {
		list.Type = pgtype.Text{String: filters.Type, Valid: true}
		count.Type = list.Type
	}
	if filters.Status != "" {
		list.Status = pgtype.Text{String: filters.Status, Valid: true}
		count.Status = list.Status
	}
	if filters.AccountUUID != nil {
		list.AccountUuid = pgtype.UUID{Bytes: *filters.AccountUUID, Valid: true}
		count.AccountUuid = list.AccountUuid
	}
	if filters.CategoryUUID != nil {
		list.CategoryUuid = pgtype.UUID{Bytes: *filters.CategoryUUID, Valid: true}
		count.CategoryUuid = list.CategoryUuid
	}
	if filters.Currency != "" {
		list.Currency = pgtype.Text{String: filters.Currency, Valid: true}
		count.Currency = list.Currency
	}
	if filters.Q != "" {
		list.Q = pgtype.Text{String: filters.Q, Valid: true}
		count.Q = list.Q
	}
	if d, err := parseDate(filters.DateFrom); err == nil {
		list.DateFrom = d
		count.DateFrom = d
	}
	if d, err := parseDate(filters.DateTo); err == nil {
		list.DateTo = d
		count.DateTo = d
	}
	return list, count
}

func parseDate(raw string) (pgtype.Date, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return pgtype.Date{}, errInvalidDate
	}
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return pgtype.Date{}, err
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}

func formatDate(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format("2006-01-02")
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
