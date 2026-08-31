package usecase

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound         = errors.New("not found")
	ErrInvalidRequest   = errors.New("invalid request")
	ErrConflict         = errors.New("conflict")
	ErrCurrencyMismatch = errors.New("currency mismatch")
)

type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
	act  *activity.Recorder
}

// TODO(finance): Module backlog (inline TODOs in handler/, usecase/, queries/, resourcemeta):
//   - Period-scoped stats on account/category detail (date_from/date_to query params)
//   - created_by + actor display name on transaction detail/list
//   - io-engine + search-engine + bulk-engine platform adapters
//   - Recurring transactions, budgets, reconciliation (future ERP)
//   - Multi-currency org summary rules when accounts mix currencies

func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder) *Service {
	return &Service{pool: pool, q: q, act: act}
}

type Account struct {
	UUID            uuid.UUID `json:"uuid"`
	Name            string    `json:"name"`
	Type            string    `json:"type"`
	Currency        string    `json:"currency"`
	OpeningBalance  string    `json:"opening_balance"`
	CurrentBalance  string    `json:"current_balance"`
	IsDefault       bool      `json:"is_default"`
	IsActive        bool      `json:"is_active"`
	BankName        *string   `json:"bank_name,omitempty"`
	IBAN            *string   `json:"iban,omitempty"`
	Notes           string    `json:"notes"`
	NegativeBalance bool      `json:"negative_balance"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type Category struct {
	UUID       uuid.UUID  `json:"uuid"`
	Name       string     `json:"name"`
	Kind       string     `json:"kind"`
	ParentUUID *uuid.UUID `json:"parent_uuid,omitempty"`
	SortOrder  int32      `json:"sort_order"`
	IsActive   bool       `json:"is_active"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type Transaction struct {
	UUID               uuid.UUID  `json:"uuid"`
	Type               string     `json:"type"`
	Status             string     `json:"status"`
	AccountUUID        uuid.UUID  `json:"account_uuid"`
	AccountName        string     `json:"account_name"`
	CounterAccountUUID *uuid.UUID `json:"counter_account_uuid,omitempty"`
	CounterAccountName *string    `json:"counter_account_name,omitempty"`
	CategoryUUID       *uuid.UUID `json:"category_uuid,omitempty"`
	CategoryName       *string    `json:"category_name,omitempty"`
	Amount             string     `json:"amount"`
	Currency           string     `json:"currency"`
	TransactionDate    string     `json:"transaction_date"`
	Description        string     `json:"description"`
	ReferenceNo        *string    `json:"reference_no,omitempty"`
	PaymentMethod      string     `json:"payment_method"`
	SourceType         *string    `json:"source_type,omitempty"`
	SourceUUID         *uuid.UUID `json:"source_uuid,omitempty"`
	Metadata           any        `json:"metadata,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	VoidedAt           *time.Time `json:"voided_at,omitempty"`
}

type Summary struct {
	DateFrom          string          `json:"date_from"`
	DateTo            string          `json:"date_to"`
	Currency          *string         `json:"currency,omitempty"`
	TotalIncome       string          `json:"total_income"`
	TotalExpense      string          `json:"total_expense"`
	Net               string          `json:"net"`
	Accounts          []Account       `json:"accounts"`
	ExpenseByCategory []CategoryTotal `json:"expense_by_category"`
}

type CategoryTotal struct {
	CategoryUUID uuid.UUID `json:"category_uuid"`
	CategoryName string    `json:"category_name"`
	Total        string    `json:"total"`
}

type AccountStats struct {
	PostedCount  int64  `json:"posted_count"`
	VoidCount    int64  `json:"void_count"`
	TotalIncome  string `json:"total_income"`
	TotalExpense string `json:"total_expense"`
	TransferIn   string `json:"transfer_in"`
	TransferOut  string `json:"transfer_out"`
}

type CategoryStats struct {
	PostedCount int64  `json:"posted_count"`
	VoidCount   int64  `json:"void_count"`
	TotalAmount string `json:"total_amount"`
}

type AccountDetail struct {
	Account            Account       `json:"account"`
	Stats              AccountStats  `json:"stats"`
	RecentTransactions []Transaction `json:"recent_transactions"`
}

type CategoryDetail struct {
	Category           Category      `json:"category"`
	Stats              CategoryStats `json:"stats"`
	RecentTransactions []Transaction `json:"recent_transactions"`
}

type CreateAccountInput struct {
	Name           string
	Type           string
	Currency       string
	OpeningBalance string
	IsDefault      bool
	BankName       *string
	IBAN           *string
	Notes          string
}

type PatchAccountInput struct {
	Name      *string
	Type      *string
	IsDefault *bool
	IsActive  *bool
	BankName  *string
	IBAN      *string
	Notes     *string
}

type CreateCategoryInput struct {
	Name       string
	Kind       string
	ParentUUID *uuid.UUID
	SortOrder  int32
}

type PatchCategoryInput struct {
	Name       *string
	ParentUUID *uuid.UUID
	SortOrder  *int32
	IsActive   *bool
}

type CreateTransactionInput struct {
	Type            string
	AccountUUID     uuid.UUID
	CategoryUUID    *uuid.UUID
	Amount          string
	TransactionDate string
	Description     string
	ReferenceNo     *string
	PaymentMethod   string
}

type CreateTransferInput struct {
	FromAccountUUID uuid.UUID
	ToAccountUUID   uuid.UUID
	Amount          string
	TransactionDate string
	Description     string
	ReferenceNo     *string
}

type TransactionFilters struct {
	Type         string
	Status       string
	AccountUUID  *uuid.UUID
	CategoryUUID *uuid.UUID
	Currency     string
	DateFrom     string
	DateTo       string
	Q            string
}

func (s *Service) ListAccounts(ctx context.Context, limit, offset int32, q string, isActive *bool) ([]Account, int64, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	params := db.ListFinanceAccountsParams{OrganizationID: orgID, LimitCount: limit, OffsetCount: offset}
	if q != "" {
		params.Q = pgtype.Text{String: q, Valid: true}
	}
	if isActive != nil {
		params.IsActive = pgtype.Bool{Bool: *isActive, Valid: true}
	}
	rows, err := s.q.ListFinanceAccounts(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountFinanceAccounts(ctx, db.CountFinanceAccountsParams{
		OrganizationID: orgID, Q: params.Q, IsActive: params.IsActive,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Account, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapAccount(row))
	}
	return out, total, nil
}

func (s *Service) GetAccount(ctx context.Context, id uuid.UUID) (Account, error) {
	row, err := s.q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{
		Uuid: id, OrganizationID: orgctx.MustScope(ctx).InternalID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Account{}, ErrNotFound
		}
		return Account{}, err
	}
	return mapAccount(row), nil
}

func (s *Service) CreateAccount(ctx context.Context, in CreateAccountInput) (Account, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	in.Name = strings.TrimSpace(in.Name)
	in.Type = strings.TrimSpace(in.Type)
	in.Currency = strings.ToUpper(strings.TrimSpace(in.Currency))
	if in.Name == "" {
		return Account{}, fmt.Errorf("%w: name is required", ErrInvalidRequest)
	}
	if in.Type != "cash" && in.Type != "bank" {
		return Account{}, fmt.Errorf("%w: invalid account type", ErrInvalidRequest)
	}
	if len(in.Currency) != 3 {
		return Account{}, fmt.Errorf("%w: currency must be ISO 4217 code", ErrInvalidRequest)
	}
	opening, err := numericFromAmountString(defaultAmount(in.OpeningBalance, "0"))
	if err != nil {
		return Account{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Account{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	if in.IsDefault {
		if err := qtx.ClearFinanceAccountDefault(ctx, orgID); err != nil {
			return Account{}, err
		}
	}
	row, err := qtx.CreateFinanceAccount(ctx, db.CreateFinanceAccountParams{
		OrganizationID: orgID, Name: in.Name, Type: in.Type, Currency: in.Currency,
		OpeningBalance: opening, IsDefault: in.IsDefault, IsActive: true,
		BankName: optionalText(in.BankName), Iban: optionalText(in.IBAN),
		Notes: strings.TrimSpace(in.Notes),
	})
	if err != nil {
		if strings.Contains(err.Error(), "uq_finance_accounts_org_name_active") {
			return Account{}, ErrConflict
		}
		return Account{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Account{}, err
	}
	return mapAccount(row), nil
}

func (s *Service) PatchAccount(ctx context.Context, id uuid.UUID, in PatchAccountInput) (Account, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	params := db.UpdateFinanceAccountParams{Uuid: id, OrganizationID: orgID}
	if in.Name != nil {
		params.Name = pgtype.Text{String: strings.TrimSpace(*in.Name), Valid: true}
	}
	if in.Type != nil {
		params.Type = pgtype.Text{String: strings.TrimSpace(*in.Type), Valid: true}
	}
	if in.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *in.IsActive, Valid: true}
	}
	if in.IsDefault != nil {
		params.IsDefault = pgtype.Bool{Bool: *in.IsDefault, Valid: true}
	}
	if in.BankName != nil {
		params.BankName = optionalText(in.BankName)
	}
	if in.IBAN != nil {
		params.Iban = optionalText(in.IBAN)
	}
	if in.Notes != nil {
		params.Notes = pgtype.Text{String: strings.TrimSpace(*in.Notes), Valid: true}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Account{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	if in.IsDefault != nil && *in.IsDefault {
		if err := qtx.ClearFinanceAccountDefault(ctx, orgID); err != nil {
			return Account{}, err
		}
	}
	row, err := qtx.UpdateFinanceAccount(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Account{}, ErrNotFound
		}
		return Account{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Account{}, err
	}
	return mapAccount(row), nil
}

func (s *Service) DeleteAccount(ctx context.Context, id uuid.UUID) error {
	_, err := s.q.SoftDeleteFinanceAccount(ctx, db.SoftDeleteFinanceAccountParams{
		Uuid: id, OrganizationID: orgctx.MustScope(ctx).InternalID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func (s *Service) ListCategories(ctx context.Context, kind string, isActive *bool) ([]Category, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	params := db.ListFinanceCategoriesParams{OrganizationID: orgID}
	if kind != "" {
		params.Kind = pgtype.Text{String: kind, Valid: true}
	}
	if isActive != nil {
		params.IsActive = pgtype.Bool{Bool: *isActive, Valid: true}
	}
	rows, err := s.q.ListFinanceCategories(ctx, params)
	if err != nil {
		return nil, err
	}
	parents := map[int64]uuid.UUID{}
	for _, row := range rows {
		parents[row.ID] = row.Uuid
	}
	out := make([]Category, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapCategory(row, parents))
	}
	return out, nil
}

func (s *Service) CreateCategory(ctx context.Context, in CreateCategoryInput) (Category, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	in.Name = strings.TrimSpace(in.Name)
	in.Kind = strings.TrimSpace(in.Kind)
	if in.Name == "" {
		return Category{}, fmt.Errorf("%w: name is required", ErrInvalidRequest)
	}
	if in.Kind != "income" && in.Kind != "expense" {
		return Category{}, fmt.Errorf("%w: invalid category kind", ErrInvalidRequest)
	}
	var parentID pgtype.Int8
	if in.ParentUUID != nil {
		parent, err := s.q.GetFinanceCategoryByUUID(ctx, db.GetFinanceCategoryByUUIDParams{
			Uuid: *in.ParentUUID, OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Category{}, fmt.Errorf("%w: parent category not found", ErrNotFound)
			}
			return Category{}, err
		}
		parentID = pgtype.Int8{Int64: parent.ID, Valid: true}
	}
	row, err := s.q.CreateFinanceCategory(ctx, db.CreateFinanceCategoryParams{
		OrganizationID: orgID, ParentID: parentID, Name: in.Name, Kind: in.Kind,
		SortOrder: in.SortOrder, IsActive: true,
	})
	if err != nil {
		if strings.Contains(err.Error(), "uq_finance_categories_org_name_kind_active") {
			return Category{}, ErrConflict
		}
		return Category{}, err
	}
	return mapCategory(row, nil), nil
}

func (s *Service) PatchCategory(ctx context.Context, id uuid.UUID, in PatchCategoryInput) (Category, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	params := db.UpdateFinanceCategoryParams{Uuid: id, OrganizationID: orgID}
	if in.Name != nil {
		params.Name = pgtype.Text{String: strings.TrimSpace(*in.Name), Valid: true}
	}
	if in.SortOrder != nil {
		params.SortOrder = pgtype.Int4{Int32: *in.SortOrder, Valid: true}
	}
	if in.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *in.IsActive, Valid: true}
	}
	if in.ParentUUID != nil {
		if *in.ParentUUID == id {
			return Category{}, fmt.Errorf("%w: category cannot be its own parent", ErrInvalidRequest)
		}
		parent, err := s.q.GetFinanceCategoryByUUID(ctx, db.GetFinanceCategoryByUUIDParams{
			Uuid: *in.ParentUUID, OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Category{}, fmt.Errorf("%w: parent category not found", ErrNotFound)
			}
			return Category{}, err
		}
		params.ParentID = pgtype.Int8{Int64: parent.ID, Valid: true}
	}
	row, err := s.q.UpdateFinanceCategory(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Category{}, ErrNotFound
		}
		return Category{}, err
	}
	return mapCategory(row, nil), nil
}

func (s *Service) DeleteCategory(ctx context.Context, id uuid.UUID) error {
	_, err := s.q.SoftDeleteFinanceCategory(ctx, db.SoftDeleteFinanceCategoryParams{
		Uuid: id, OrganizationID: orgctx.MustScope(ctx).InternalID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func (s *Service) GetCategory(ctx context.Context, id uuid.UUID) (Category, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	row, err := s.q.GetFinanceCategoryByUUID(ctx, db.GetFinanceCategoryByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Category{}, ErrNotFound
		}
		return Category{}, err
	}
	parents := map[int64]uuid.UUID{}
	if row.ParentID.Valid {
		all, listErr := s.q.ListFinanceCategories(ctx, db.ListFinanceCategoriesParams{OrganizationID: orgID})
		if listErr == nil {
			for _, c := range all {
				parents[c.ID] = c.Uuid
			}
		}
	}
	return mapCategory(row, parents), nil
}

func (s *Service) CategoryDetail(ctx context.Context, id uuid.UUID, recentLimit int32) (CategoryDetail, error) {
	// TODO(finance): Accept date_from/date_to for category stats and recent transaction window.
	category, err := s.GetCategory(ctx, id)
	if err != nil {
		return CategoryDetail{}, err
	}
	orgID := orgctx.MustScope(ctx).InternalID
	row, err := s.q.GetFinanceCategoryByUUID(ctx, db.GetFinanceCategoryByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		return CategoryDetail{}, err
	}
	statsRow, err := s.q.GetFinanceCategoryStats(ctx, db.GetFinanceCategoryStatsParams{
		OrganizationID: orgID,
		CategoryID:     pgtype.Int8{Int64: row.ID, Valid: true},
	})
	if err != nil {
		return CategoryDetail{}, err
	}
	if recentLimit <= 0 {
		recentLimit = 10
	}
	recent, _, err := s.ListTransactions(ctx, recentLimit, 0, TransactionFilters{CategoryUUID: &id})
	if err != nil {
		return CategoryDetail{}, err
	}
	return CategoryDetail{
		Category: category,
		Stats: CategoryStats{
			PostedCount: statsRow.PostedCount,
			VoidCount:   statsRow.VoidCount,
			TotalAmount: numericToString(statsRow.TotalAmount),
		},
		RecentTransactions: recent,
	}, nil
}

func (s *Service) ListTransactions(ctx context.Context, limit, offset int32, filters TransactionFilters) ([]Transaction, int64, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	params, countParams := buildTransactionListParams(orgID, limit, offset, filters)
	rows, err := s.q.ListFinanceTransactions(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountFinanceTransactions(ctx, countParams)
	if err != nil {
		return nil, 0, err
	}
	out := make([]Transaction, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapTransactionRow(row))
	}
	return out, total, nil
}

func (s *Service) GetTransaction(ctx context.Context, id uuid.UUID) (Transaction, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	row, err := s.q.GetFinanceTransactionByUUID(ctx, db.GetFinanceTransactionByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Transaction{}, ErrNotFound
		}
		return Transaction{}, err
	}
	account, err := s.q.GetFinanceAccountByID(ctx, db.GetFinanceAccountByIDParams{
		ID: row.AccountID, OrganizationID: orgID,
	})
	if err != nil {
		return Transaction{}, err
	}
	var counterUUID *uuid.UUID
	var counterName *string
	if row.CounterAccountID.Valid {
		counter, err := s.q.GetFinanceAccountByID(ctx, db.GetFinanceAccountByIDParams{
			ID: row.CounterAccountID.Int64, OrganizationID: orgID,
		})
		if err == nil {
			counterUUID = &counter.Uuid
			counterName = &counter.Name
		}
	}
	var categoryUUID *uuid.UUID
	var categoryName *string
	if row.CategoryID.Valid {
		// TODO(finance): Replace full category list scan with GetFinanceCategoryByID sqlc query.
		categories, _ := s.q.ListFinanceCategories(ctx, db.ListFinanceCategoriesParams{OrganizationID: orgID})
		for _, c := range categories {
			if c.ID == row.CategoryID.Int64 {
				categoryUUID = &c.Uuid
				categoryName = &c.Name
				break
			}
		}
	}
	return mapTransactionDetail(row, account, counterUUID, counterName, categoryUUID, categoryName), nil
}

func (s *Service) CreateTransaction(ctx context.Context, actorID int64, in CreateTransactionInput, req *http.Request) (Transaction, error) {
	in.Type = strings.TrimSpace(in.Type)
	if in.Type != "income" && in.Type != "expense" {
		return Transaction{}, fmt.Errorf("%w: type must be income or expense", ErrInvalidRequest)
	}
	if in.Type == "expense" && in.CategoryUUID == nil {
		return Transaction{}, fmt.Errorf("%w: category is required for expense", ErrInvalidRequest)
	}
	amount, err := numericFromString(in.Amount)
	if err != nil {
		return Transaction{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}
	date, err := parseDate(in.TransactionDate)
	if err != nil {
		return Transaction{}, fmt.Errorf("%w: invalid transaction_date", ErrInvalidRequest)
	}
	paymentMethod := strings.TrimSpace(in.PaymentMethod)
	if paymentMethod == "" {
		paymentMethod = "cash"
	}
	// TODO(finance): Accept source_type/source_uuid/metadata on create for module integrations (ARCHITECTURE.md).
	orgID := orgctx.MustScope(ctx).InternalID
	account, err := s.q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{
		Uuid: in.AccountUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Transaction{}, fmt.Errorf("%w: account not found", ErrNotFound)
		}
		return Transaction{}, err
	}
	var categoryID pgtype.Int8
	var catUUID *uuid.UUID
	var catName *string
	if in.CategoryUUID != nil {
		category, err := s.q.GetFinanceCategoryByUUID(ctx, db.GetFinanceCategoryByUUIDParams{
			Uuid: *in.CategoryUUID, OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Transaction{}, fmt.Errorf("%w: category not found", ErrNotFound)
			}
			return Transaction{}, err
		}
		expectedKind := "income"
		if in.Type == "expense" {
			expectedKind = "expense"
		}
		if category.Kind != expectedKind {
			return Transaction{}, fmt.Errorf("%w: category kind mismatch", ErrInvalidRequest)
		}
		categoryID = pgtype.Int8{Int64: category.ID, Valid: true}
		catUUID = &category.Uuid
		catName = &category.Name
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Transaction{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	row, err := qtx.CreateFinanceTransaction(ctx, db.CreateFinanceTransactionParams{
		OrganizationID: orgID, Type: in.Type, AccountID: account.ID,
		CounterAccountID: pgtype.Int8{}, CategoryID: categoryID,
		Amount: amount, Currency: account.Currency, TransactionDate: date,
		Description: strings.TrimSpace(in.Description), ReferenceNo: optionalText(in.ReferenceNo),
		PaymentMethod: paymentMethod, CreatedBy: actorID,
		SourceType: pgtype.Text{String: "manual", Valid: true}, Metadata: []byte("{}"),
	})
	if err != nil {
		return Transaction{}, err
	}
	delta := amount
	if in.Type == "expense" {
		delta = numericNeg(amount)
	}
	if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
		ID: account.ID, OrganizationID: orgID, CurrentBalance: delta,
	}); err != nil {
		return Transaction{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Transaction{}, err
	}
	s.recordActivity(ctx, &actorID, "finance.transaction.create", "finance.transaction", &row.Uuid, map[string]any{
		"type": in.Type, "amount": numericToString(amount),
	}, req)
	return mapTransactionDetail(row, account, nil, nil, catUUID, catName), nil
}

func (s *Service) CreateTransfer(ctx context.Context, actorID int64, in CreateTransferInput, req *http.Request) (Transaction, error) {
	amount, err := numericFromString(in.Amount)
	if err != nil {
		return Transaction{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}
	date, err := parseDate(in.TransactionDate)
	if err != nil {
		return Transaction{}, fmt.Errorf("%w: invalid transaction_date", ErrInvalidRequest)
	}
	if in.FromAccountUUID == in.ToAccountUUID {
		return Transaction{}, fmt.Errorf("%w: accounts must differ", ErrInvalidRequest)
	}
	orgID := orgctx.MustScope(ctx).InternalID
	from, err := s.q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{
		Uuid: in.FromAccountUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Transaction{}, fmt.Errorf("%w: source account not found", ErrNotFound)
		}
		return Transaction{}, err
	}
	to, err := s.q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{
		Uuid: in.ToAccountUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Transaction{}, fmt.Errorf("%w: destination account not found", ErrNotFound)
		}
		return Transaction{}, err
	}
	if !numericEqualCurrency(from.Currency, to.Currency) {
		return Transaction{}, ErrCurrencyMismatch
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Transaction{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	row, err := qtx.CreateFinanceTransaction(ctx, db.CreateFinanceTransactionParams{
		OrganizationID: orgID, Type: "transfer", AccountID: from.ID,
		CounterAccountID: pgtype.Int8{Int64: to.ID, Valid: true}, CategoryID: pgtype.Int8{},
		Amount: amount, Currency: from.Currency, TransactionDate: date,
		Description: strings.TrimSpace(in.Description), ReferenceNo: optionalText(in.ReferenceNo),
		PaymentMethod: "transfer", CreatedBy: actorID,
		SourceType: pgtype.Text{String: "manual", Valid: true}, Metadata: []byte("{}"),
	})
	if err != nil {
		return Transaction{}, err
	}
	if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
		ID: from.ID, OrganizationID: orgID, CurrentBalance: numericNeg(amount),
	}); err != nil {
		return Transaction{}, err
	}
	if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
		ID: to.ID, OrganizationID: orgID, CurrentBalance: amount,
	}); err != nil {
		return Transaction{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Transaction{}, err
	}
	s.recordActivity(ctx, &actorID, "finance.transfer.create", "finance.transaction", &row.Uuid, map[string]any{
		"amount": numericToString(amount),
	}, req)
	toName := to.Name
	return mapTransactionDetail(row, from, &to.Uuid, &toName, nil, nil), nil
}

func (s *Service) VoidTransaction(ctx context.Context, actorID int64, id uuid.UUID, req *http.Request) (Transaction, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	row, err := s.q.GetFinanceTransactionByUUID(ctx, db.GetFinanceTransactionByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Transaction{}, ErrNotFound
		}
		return Transaction{}, err
	}
	if row.Status == "void" {
		return Transaction{}, fmt.Errorf("%w: transaction already void", ErrConflict)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Transaction{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	voided, err := qtx.VoidFinanceTransaction(ctx, db.VoidFinanceTransactionParams{
		Uuid: id, OrganizationID: orgID, VoidedBy: pgtype.Int8{Int64: actorID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Transaction{}, ErrNotFound
		}
		return Transaction{}, err
	}
	switch row.Type {
	case "income":
		if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
			ID: row.AccountID, OrganizationID: orgID, CurrentBalance: numericNeg(row.Amount),
		}); err != nil {
			return Transaction{}, err
		}
	case "expense":
		if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
			ID: row.AccountID, OrganizationID: orgID, CurrentBalance: row.Amount,
		}); err != nil {
			return Transaction{}, err
		}
	case "transfer":
		if !row.CounterAccountID.Valid {
			return Transaction{}, fmt.Errorf("%w: invalid transfer", ErrInvalidRequest)
		}
		if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
			ID: row.AccountID, OrganizationID: orgID, CurrentBalance: row.Amount,
		}); err != nil {
			return Transaction{}, err
		}
		if _, err := qtx.AdjustFinanceAccountBalance(ctx, db.AdjustFinanceAccountBalanceParams{
			ID: row.CounterAccountID.Int64, OrganizationID: orgID, CurrentBalance: numericNeg(row.Amount),
		}); err != nil {
			return Transaction{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Transaction{}, err
	}
	s.recordActivity(ctx, &actorID, "finance.transaction.void", "finance.transaction", &voided.Uuid, nil, req)
	account, _ := s.q.GetFinanceAccountByID(ctx, db.GetFinanceAccountByIDParams{
		ID: voided.AccountID, OrganizationID: orgID,
	})
	return mapTransactionDetail(voided, account, nil, nil, nil, nil), nil
}

func (s *Service) Summary(ctx context.Context, dateFrom, dateTo, currency string) (Summary, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	from, err := parseDate(dateFrom)
	if err != nil {
		from = pgtype.Date{Time: time.Now().UTC(), Valid: true}
	}
	to, err := parseDate(dateTo)
	if err != nil {
		to = from
	}
	var currencyArg pgtype.Text
	if currency != "" {
		currencyArg = pgtype.Text{String: strings.ToUpper(currency), Valid: true}
	}
	totals, err := s.q.SumFinanceTransactionsByType(ctx, db.SumFinanceTransactionsByTypeParams{
		OrganizationID: orgID, TransactionDate: from, TransactionDate_2: to, Currency: currencyArg,
	})
	if err != nil {
		return Summary{}, err
	}
	income, expense := "0.00", "0.00"
	for _, t := range totals {
		switch t.Type {
		case "income":
			income = numericToString(t.Total)
		case "expense":
			expense = numericToString(t.Total)
		}
	}
	net := subtractAmountStrings(income, expense)
	accounts, _, err := s.ListAccounts(ctx, 100, 0, "", boolPtr(true))
	if err != nil {
		return Summary{}, err
	}
	if currency != "" {
		filtered := accounts[:0]
		for _, a := range accounts {
			if strings.EqualFold(a.Currency, currency) {
				filtered = append(filtered, a)
			}
		}
		accounts = filtered
	}
	catRows, err := s.q.SumFinanceExpensesByCategory(ctx, db.SumFinanceExpensesByCategoryParams{
		OrganizationID: orgID, TransactionDate: from, TransactionDate_2: to,
	})
	if err != nil {
		return Summary{}, err
	}
	catTotals := make([]CategoryTotal, 0, len(catRows))
	for _, row := range catRows {
		catTotals = append(catTotals, CategoryTotal{
			CategoryUUID: row.CategoryUuid,
			CategoryName: row.CategoryName,
			Total:        numericToString(row.Total),
		})
	}
	var cur *string
	if currency != "" {
		c := strings.ToUpper(currency)
		cur = &c
	}
	return Summary{
		DateFrom: formatDate(from), DateTo: formatDate(to), Currency: cur,
		TotalIncome: income, TotalExpense: expense, Net: net,
		Accounts: accounts, ExpenseByCategory: catTotals,
	}, nil
}

func (s *Service) AccountDetail(ctx context.Context, id uuid.UUID, recentLimit int32) (AccountDetail, error) {
	// TODO(finance): Accept date_from/date_to and filter GetFinanceAccountStats + ledger totals by period.
	account, err := s.GetAccount(ctx, id)
	if err != nil {
		return AccountDetail{}, err
	}
	orgID := orgctx.MustScope(ctx).InternalID
	row, err := s.q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		return AccountDetail{}, err
	}
	statsRow, err := s.q.GetFinanceAccountStats(ctx, db.GetFinanceAccountStatsParams{
		OrganizationID: orgID, AccountID: row.ID,
	})
	if err != nil {
		return AccountDetail{}, err
	}
	if recentLimit <= 0 {
		recentLimit = 10
	}
	recentRows, err := s.q.ListRecentFinanceTransactionsByAccount(ctx, db.ListRecentFinanceTransactionsByAccountParams{
		OrganizationID: orgID, AccountID: row.ID, Limit: recentLimit,
	})
	if err != nil {
		return AccountDetail{}, err
	}
	recent := make([]Transaction, 0, len(recentRows))
	for _, r := range recentRows {
		tx := mapRecentTransaction(r)
		tx.AccountUUID = account.UUID
		tx.AccountName = account.Name
		recent = append(recent, tx)
	}
	return AccountDetail{
		Account: account,
		Stats: AccountStats{
			PostedCount:  statsRow.PostedCount,
			VoidCount:    statsRow.VoidCount,
			TotalIncome:  numericToString(statsRow.TotalIncome),
			TotalExpense: numericToString(statsRow.TotalExpense),
			TransferIn:   numericToString(statsRow.TransferIn),
			TransferOut:  numericToString(statsRow.TransferOut),
		},
		RecentTransactions: recent,
	}, nil
}

// AccountBalance returns account detail for backward-compatible balance endpoint.
func (s *Service) AccountBalance(ctx context.Context, id uuid.UUID, recentLimit int32) (Account, []Transaction, error) {
	detail, err := s.AccountDetail(ctx, id, recentLimit)
	if err != nil {
		return Account{}, nil, err
	}
	return detail.Account, detail.RecentTransactions, nil
}

func (s *Service) recordActivity(ctx context.Context, actorID *int64, action, resource string, resourceUUID *uuid.UUID, payload map[string]any, req *http.Request) {
	if s.act == nil {
		return
	}
	s.act.Record(ctx, actorID, action, resource, resourceUUID, payload, req)
}

func subtractAmountStrings(a, b string) string {
	an, _ := numericFromDecimalString(defaultAmount(a, "0"))
	bn, _ := numericFromDecimalString(defaultAmount(b, "0"))
	rat := new(big.Rat).Sub(ratFromNumeric(an), ratFromNumeric(bn))
	f, _ := rat.Float64()
	return fmt.Sprintf("%.2f", f)
}

func defaultAmount(raw, fallback string) string {
	if strings.TrimSpace(raw) == "" {
		return fallback
	}
	return raw
}

func boolPtr(v bool) *bool { return &v }
