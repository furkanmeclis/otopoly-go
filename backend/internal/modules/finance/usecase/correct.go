package usecase

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// SystemCategory is a seeded finance category. AutoSource names the module
// that books into it on its own ("" when only people use it).
type SystemCategory struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	AutoSource string `json:"auto_source,omitempty"`
}

// SystemCategories lists the categories every organization is seeded with,
// in sort order, and which module posts into each automatically.
func SystemCategories() []SystemCategory {
	auto := map[string]string{
		CategoryServiceIncome: SourceServiceJob,
		CategoryProductSale:   SourceProductSale,
		CategoryCariPayment:   SourceCariPayment,
		CategoryStockPurchase: SourcePurchase,
	}
	out := make([]SystemCategory, 0, len(defaultCategories))
	for _, c := range defaultCategories {
		out = append(out, SystemCategory{Name: c.Name, Kind: c.Kind, AutoSource: auto[c.Name]})
	}
	return out
}

// IsManualSource reports whether a transaction's source type means it was
// entered by hand (and may be voided or corrected directly).
func IsManualSource(sourceType *string) bool {
	return sourceType == nil || *sourceType == "" || *sourceType == "manual"
}

// UpdateTransactionInput holds the fields to correct; nil keeps the value.
type UpdateTransactionInput struct {
	AccountUUID     *uuid.UUID
	CategoryUUID    *uuid.UUID
	Amount          *string
	TransactionDate *string
	Description     *string
}

// UpdateTransaction corrects a posted manual income or expense in place and
// moves the balance effect: the old amount comes off the old account and the
// new amount goes on the new one, in one database transaction. Rows owned by
// a source document (job payment, sale, purchase, cari collection) and
// transfers are refused; cancel or void the source instead.
func (s *Service) UpdateTransaction(ctx context.Context, actorID int64, id uuid.UUID, in UpdateTransactionInput, req *http.Request) (Transaction, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	row, err := s.q.GetFinanceTransactionByUUID(ctx, db.GetFinanceTransactionByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Transaction{}, ErrNotFound
		}
		return Transaction{}, err
	}
	if row.Status != "posted" {
		return Transaction{}, fmt.Errorf("%w: only posted transactions can be changed", ErrConflict)
	}
	if row.Type != "income" && row.Type != "expense" {
		return Transaction{}, fmt.Errorf("%w: only income and expense entries can be changed; void the transfer and create a new one", ErrInvalidRequest)
	}
	if row.SourceType.Valid && row.SourceType.String != "" && row.SourceType.String != "manual" {
		return Transaction{}, fmt.Errorf("%w: entry belongs to a %s; change or cancel that record instead", ErrConflict, row.SourceType.String)
	}

	oldAccount, err := s.q.GetFinanceAccountByID(ctx, db.GetFinanceAccountByIDParams{ID: row.AccountID, OrganizationID: orgID})
	if err != nil {
		return Transaction{}, err
	}
	newAccount := oldAccount
	if in.AccountUUID != nil && *in.AccountUUID != oldAccount.Uuid {
		newAccount, err = s.q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{Uuid: *in.AccountUUID, OrganizationID: orgID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Transaction{}, fmt.Errorf("%w: account not found", ErrNotFound)
			}
			return Transaction{}, err
		}
		if !strings.EqualFold(newAccount.Currency, oldAccount.Currency) {
			return Transaction{}, ErrCurrencyMismatch
		}
	}
	categoryID := row.CategoryID
	if in.CategoryUUID != nil {
		category, err := s.q.GetFinanceCategoryByUUID(ctx, db.GetFinanceCategoryByUUIDParams{Uuid: *in.CategoryUUID, OrganizationID: orgID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Transaction{}, fmt.Errorf("%w: category not found", ErrNotFound)
			}
			return Transaction{}, err
		}
		if category.Kind != row.Type {
			return Transaction{}, fmt.Errorf("%w: category kind mismatch", ErrInvalidRequest)
		}
		categoryID = pgtype.Int8{Int64: category.ID, Valid: true}
	}
	amount := row.Amount
	if in.Amount != nil {
		if amount, err = numericFromString(*in.Amount); err != nil {
			return Transaction{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
		}
	}
	date := row.TransactionDate
	if in.TransactionDate != nil {
		if date, err = parseDate(*in.TransactionDate); err != nil {
			return Transaction{}, fmt.Errorf("%w: invalid transaction_date", ErrInvalidRequest)
		}
	}
	desc := row.Description
	if in.Description != nil {
		desc = strings.TrimSpace(*in.Description)
	}

	signed := func(n pgtype.Numeric) pgtype.Numeric {
		if row.Type == "expense" {
			return numericNeg(n)
		}
		return n
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Transaction{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	if _, err := qtx.UpdateManualFinanceTransaction(ctx, db.UpdateManualFinanceTransactionParams{
		AccountID: newAccount.ID, CategoryID: categoryID, Amount: amount, Currency: newAccount.Currency,
		TransactionDate: date, Description: desc, Uuid: id, OrganizationID: orgID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Transaction{}, fmt.Errorf("%w: transaction changed meanwhile", ErrConflict)
		}
		return Transaction{}, err
	}
	if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
		ID: oldAccount.ID, OrganizationID: orgID, CurrentBalance: numericNeg(signed(row.Amount)),
	}); err != nil {
		return Transaction{}, err
	}
	if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
		ID: newAccount.ID, OrganizationID: orgID, CurrentBalance: signed(amount),
	}); err != nil {
		return Transaction{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Transaction{}, err
	}
	s.recordActivity(ctx, &actorID, "finance.transaction.update", "finance.transaction", &row.Uuid, map[string]any{
		"amount": numericToString(amount), "previous_amount": numericToString(row.Amount),
	}, req)
	s.live(ctx, resourceevents.TenantFinanceTransactions, resourceevents.ActionUpdated, row.Uuid.String())
	s.live(ctx, resourceevents.TenantFinanceAccounts, resourceevents.ActionBulk)
	s.indexTransaction(ctx, row.Uuid)
	s.indexAccounts(ctx, oldAccount.Uuid, newAccount.Uuid)
	return s.GetTransaction(ctx, id)
}
