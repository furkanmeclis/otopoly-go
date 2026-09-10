package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// SourceCariPayment is the finance_transactions.source_type for cari collections.
const SourceCariPayment = "cari_payment"

// PostFromSourceInput posts an income row linked to an external module event.
type PostFromSourceInput struct {
	AccountID       int64
	CategoryID      int64
	Amount          pgtype.Numeric
	Currency        string
	TransactionDate pgtype.Date
	Description     string
	ReferenceNo     *string
	PaymentMethod   string
	SourceType      string
	SourceUUID      uuid.UUID
	Metadata        json.RawMessage
}

// PostIncomeFromSourceTx creates a posted income transaction inside an existing DB tx.
// Callers own the transaction and balance semantics after commit (indexing/activity).
func (s *Service) PostIncomeFromSourceTx(
	ctx context.Context,
	qtx *db.Queries,
	actorID int64,
	in PostFromSourceInput,
) (db.FinanceTransaction, error) {
	if qtx == nil {
		return db.FinanceTransaction{}, fmt.Errorf("%w: queries required", ErrInvalidRequest)
	}
	orgID := orgctx.MustScope(ctx).InternalID
	sourceType := strings.TrimSpace(in.SourceType)
	if sourceType == "" || in.SourceUUID == uuid.Nil {
		return db.FinanceTransaction{}, fmt.Errorf("%w: source_type and source_uuid are required", ErrInvalidRequest)
	}
	paymentMethod := strings.TrimSpace(in.PaymentMethod)
	if paymentMethod == "" {
		paymentMethod = "cash"
	}
	meta := in.Metadata
	if len(meta) == 0 {
		meta = []byte("{}")
	}
	row, err := qtx.CreateFinanceTransaction(ctx, db.CreateFinanceTransactionParams{
		OrganizationID:   orgID,
		Type:             "income",
		AccountID:        in.AccountID,
		CounterAccountID: pgtype.Int8{},
		CategoryID:       pgtype.Int8{Int64: in.CategoryID, Valid: true},
		Amount:           in.Amount,
		Currency:         in.Currency,
		TransactionDate:  in.TransactionDate,
		Description:      strings.TrimSpace(in.Description),
		ReferenceNo:      optionalText(in.ReferenceNo),
		PaymentMethod:    paymentMethod,
		CreatedBy:        actorID,
		SourceType:       pgtype.Text{String: sourceType, Valid: true},
		SourceUuid:       pgtype.UUID{Bytes: in.SourceUUID, Valid: true},
		Metadata:         meta,
	})
	if err != nil {
		return db.FinanceTransaction{}, err
	}
	if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
		ID:             in.AccountID,
		OrganizationID: orgID,
		CurrentBalance: in.Amount,
	}); err != nil {
		return db.FinanceTransaction{}, err
	}
	return row, nil
}

// VoidBySourceTx voids a posted finance transaction matched by source_type + source_uuid.
func (s *Service) VoidBySourceTx(
	ctx context.Context,
	qtx *db.Queries,
	actorID int64,
	sourceType string,
	sourceUUID uuid.UUID,
) (db.FinanceTransaction, error) {
	if qtx == nil {
		return db.FinanceTransaction{}, fmt.Errorf("%w: queries required", ErrInvalidRequest)
	}
	orgID := orgctx.MustScope(ctx).InternalID
	sourceType = strings.TrimSpace(sourceType)
	if sourceType == "" || sourceUUID == uuid.Nil {
		return db.FinanceTransaction{}, fmt.Errorf("%w: source_type and source_uuid are required", ErrInvalidRequest)
	}
	row, err := qtx.GetFinanceTransactionBySource(ctx, db.GetFinanceTransactionBySourceParams{
		OrganizationID: orgID,
		SourceType:     pgtype.Text{String: sourceType, Valid: true},
		SourceUuid:     pgtype.UUID{Bytes: sourceUUID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.FinanceTransaction{}, ErrNotFound
		}
		return db.FinanceTransaction{}, err
	}
	voided, err := qtx.VoidFinanceTransaction(ctx, db.VoidFinanceTransactionParams{
		Uuid:           row.Uuid,
		OrganizationID: orgID,
		VoidedBy:       pgtype.Int8{Int64: actorID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.FinanceTransaction{}, ErrNotFound
		}
		return db.FinanceTransaction{}, err
	}
	if row.Type == "income" {
		if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
			ID:             row.AccountID,
			OrganizationID: orgID,
			CurrentBalance: numericNeg(row.Amount),
		}); err != nil {
			return db.FinanceTransaction{}, err
		}
	}
	return voided, nil
}

// ResolveCategoryIDByName returns an active category id by name+kind for the current org.
func (s *Service) ResolveCategoryIDByName(ctx context.Context, q *db.Queries, name, kind string) (int64, error) {
	if q == nil {
		q = s.q
	}
	orgID := orgctx.MustScope(ctx).InternalID
	row, err := q.GetFinanceCategoryByName(ctx, db.GetFinanceCategoryByNameParams{
		OrganizationID: orgID,
		Name:           name,
		Kind:           kind,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, fmt.Errorf("%w: category %q not found", ErrNotFound, name)
		}
		return 0, err
	}
	return row.ID, nil
}

// NotifyIndexed after an external module commits a sourced finance change.
func (s *Service) NotifyIndexed(ctx context.Context, financeTxUUID, accountUUID uuid.UUID) {
	if financeTxUUID != uuid.Nil {
		s.indexTransaction(ctx, financeTxUUID)
	}
	if accountUUID != uuid.Nil {
		s.indexAccount(ctx, accountUUID)
	}
}
