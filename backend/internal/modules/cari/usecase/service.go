package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
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

type SearchIndexer interface {
	EnqueueUpsert(ctx context.Context, spec, id string)
	EnqueueDelete(ctx context.Context, spec, id string)
}

type Service struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	act     *activity.Recorder
	finance *financeusecase.Service
	search  SearchIndexer
	bus     events.Bus
}

func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder, finance *financeusecase.Service) *Service {
	return &Service{pool: pool, q: q, act: act, finance: finance}
}

func (s *Service) SetSearchIndexer(idx SearchIndexer) { s.search = idx }
func (s *Service) SetEventBus(bus events.Bus)         { s.bus = bus }

func (s *Service) ResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantCari()
}

func (s *Service) requireOrgID(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, errors.New("organization context required")
	}
	return scope.InternalID, nil
}

func (s *Service) actorID(ctx context.Context) (int64, error) {
	p, ok := authctx.PrincipalFrom(ctx)
	if !ok || p.UserInternal <= 0 {
		return 0, fmt.Errorf("%w: actor required", ErrInvalidRequest)
	}
	return p.UserInternal, nil
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

func (s *Service) publish(ctx context.Context, name string, payload map[string]any) {
	if s.bus == nil {
		return
	}
	_ = s.bus.Publish(ctx, events.New(name).WithPayload(payload))
}

func (s *Service) indexAccount(ctx context.Context, id uuid.UUID) {
	if s.search == nil || id == uuid.Nil {
		return
	}
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return
	}
	s.search.EnqueueUpsert(ctx, "tenant_cari_accounts", scope.UUID.String()+"_"+id.String())
}

func (s *Service) Summary(ctx context.Context) (Summary, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Summary{}, err
	}
	row, err := s.q.SumCariBalances(ctx, orgID)
	if err != nil {
		return Summary{}, err
	}
	return Summary{
		TotalReceivable: financeusecase.NumericToString(row.TotalReceivable),
		AccountCount:    row.AccountCount,
		WithBalanceCount: row.WithBalanceCount,
	}, nil
}

func (s *Service) List(ctx context.Context, limit, offset int32, filters ListFilters) ([]Account, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	sort := strings.TrimSpace(filters.Sort)
	if sort == "" {
		sort = "customer_name"
	}
	params := db.ListCariAccountsParams{
		OrganizationID: orgID,
		LimitCount:     limit,
		OffsetCount:    offset,
		Sort:           sort,
	}
	countParams := db.CountCariAccountsParams{OrganizationID: orgID}
	if filters.Q != "" {
		params.Q = pgtype.Text{String: filters.Q, Valid: true}
		countParams.Q = params.Q
	}
	if filters.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *filters.IsActive, Valid: true}
		countParams.IsActive = params.IsActive
	}
	if filters.HasBalance != nil {
		params.HasBalance = pgtype.Bool{Bool: *filters.HasBalance, Valid: true}
		countParams.HasBalance = params.HasBalance
	}
	rows, err := s.q.ListCariAccounts(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountCariAccounts(ctx, countParams)
	if err != nil {
		return nil, 0, err
	}
	out := make([]Account, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapListAccount(row))
	}
	return out, total, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (AccountDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return AccountDetail{}, err
	}
	row, err := s.q.GetCariAccountByUUID(ctx, db.GetCariAccountByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AccountDetail{}, ErrNotFound
		}
		return AccountDetail{}, err
	}
	return mapAccountDetail(row), nil
}

func (s *Service) ListEntries(ctx context.Context, accountUUID uuid.UUID, limit, offset int32, filters EntryFilters) ([]Entry, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	account, err := s.q.GetCariAccountByUUID(ctx, db.GetCariAccountByUUIDParams{
		Uuid: accountUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, 0, ErrNotFound
		}
		return nil, 0, err
	}
	listParams := db.ListCariEntriesParams{
		OrganizationID: orgID,
		AccountID:      account.ID,
		LimitCount:     limit,
		OffsetCount:    offset,
	}
	countParams := db.CountCariEntriesParams{
		OrganizationID: orgID,
		AccountID:      account.ID,
	}
	if filters.Type != "" {
		listParams.Type = pgtype.Text{String: filters.Type, Valid: true}
		countParams.Type = listParams.Type
	}
	if filters.Status != "" {
		listParams.Status = pgtype.Text{String: filters.Status, Valid: true}
		countParams.Status = listParams.Status
	}
	if filters.Q != "" {
		listParams.Q = pgtype.Text{String: filters.Q, Valid: true}
		countParams.Q = listParams.Q
	}
	if d, err := parseDate(filters.DateFrom); err == nil {
		listParams.DateFrom = d
		countParams.DateFrom = d
	}
	if d, err := parseDate(filters.DateTo); err == nil {
		listParams.DateTo = d
		countParams.DateTo = d
	}
	rows, err := s.q.ListCariEntries(ctx, listParams)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountCariEntries(ctx, countParams)
	if err != nil {
		return nil, 0, err
	}
	out := make([]Entry, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapListEntry(row))
	}
	return out, total, nil
}

func (s *Service) CreateCharge(ctx context.Context, accountUUID uuid.UUID, in ChargeInput) (Entry, error) {
	return s.postEntry(ctx, accountUUID, entryPost{
		Type:        "charge",
		Amount:      in.Amount,
		EntryDate:   in.EntryDate,
		Description: in.Description,
		ReferenceNo: in.ReferenceNo,
		Direction:   "increase",
	})
}

func (s *Service) CreateAdjustment(ctx context.Context, accountUUID uuid.UUID, in AdjustmentInput) (Entry, error) {
	dir := strings.TrimSpace(in.Direction)
	if dir != "increase" && dir != "decrease" {
		return Entry{}, fmt.Errorf("%w: direction must be increase or decrease", ErrInvalidRequest)
	}
	meta, _ := json.Marshal(map[string]any{"direction": dir})
	return s.postEntry(ctx, accountUUID, entryPost{
		Type:        "adjustment",
		Amount:      in.Amount,
		EntryDate:   in.EntryDate,
		Description: in.Description,
		ReferenceNo: in.ReferenceNo,
		Direction:   dir,
		Metadata:    meta,
	})
}

func (s *Service) CreatePayment(ctx context.Context, accountUUID uuid.UUID, in PaymentInput) (Entry, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Entry{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return Entry{}, err
	}
	amount, err := numericFromString(in.Amount)
	if err != nil {
		return Entry{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}
	date, err := parseDate(in.EntryDate)
	if err != nil {
		return Entry{}, fmt.Errorf("%w: invalid entry_date", ErrInvalidRequest)
	}
	paymentMethod := strings.TrimSpace(in.PaymentMethod)
	if paymentMethod == "" {
		paymentMethod = "cash"
	}
	if in.FinanceAccountUUID == uuid.Nil {
		return Entry{}, fmt.Errorf("%w: finance_account_uuid is required", ErrInvalidRequest)
	}

	account, err := s.q.GetCariAccountByUUID(ctx, db.GetCariAccountByUUIDParams{
		Uuid: accountUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Entry{}, ErrNotFound
		}
		return Entry{}, err
	}
	financeAccount, err := s.q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{
		Uuid: in.FinanceAccountUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Entry{}, fmt.Errorf("%w: finance account not found", ErrNotFound)
		}
		return Entry{}, err
	}
	if !strings.EqualFold(financeAccount.Currency, account.Currency) {
		return Entry{}, fmt.Errorf("%w: finance account currency must match cari currency", ErrInvalidRequest)
	}
	categoryID, err := s.finance.ResolveCategoryIDByName(ctx, s.q, financeusecase.CategoryCariPayment, "income")
	if err != nil {
		return Entry{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Entry{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	adjusted, err := qtx.AdjustCariAccountBalance(ctx, db.AdjustCariAccountBalanceParams{
		ID: account.ID, OrganizationID: orgID, Balance: numericNeg(amount),
	})
	if err != nil {
		return Entry{}, err
	}

	entryUUID := uuid.New()
	desc := strings.TrimSpace(in.Description)
	if desc == "" {
		desc = fmt.Sprintf("Cari tahsilat — %s", account.CustomerName)
	}
	entry, err := qtx.CreateCariEntry(ctx, db.CreateCariEntryParams{
		OrganizationID:       orgID,
		AccountID:            account.ID,
		Type:                 "payment",
		Amount:               amount,
		BalanceAfter:         adjusted.Balance,
		EntryDate:            date,
		Description:          desc,
		ReferenceNo:          optionalText(in.ReferenceNo),
		PaymentMethod:        pgtype.Text{String: paymentMethod, Valid: true},
		FinanceAccountID:     pgtype.Int8{Int64: financeAccount.ID, Valid: true},
		FinanceTransactionID: pgtype.Int8{},
		CreatedBy:            actorID,
		SourceType:           pgtype.Text{},
		SourceUuid:           pgtype.UUID{},
		Metadata:             []byte("{}"),
	})
	if err != nil {
		return Entry{}, err
	}
	// Override uuid is not supported by insert; use returned uuid as source.
	_ = entryUUID

	financeTx, err := s.finance.PostIncomeFromSourceTx(ctx, qtx, actorID, financeusecase.PostFromSourceInput{
		AccountID:       financeAccount.ID,
		CategoryID:      categoryID,
		Amount:          amount,
		Currency:        account.Currency,
		TransactionDate: date,
		Description:     desc,
		ReferenceNo:     in.ReferenceNo,
		PaymentMethod:   paymentMethod,
		SourceType:      financeusecase.SourceCariPayment,
		SourceUUID:      entry.Uuid,
		Metadata:        []byte(`{"module":"cari"}`),
	})
	if err != nil {
		return Entry{}, err
	}
	linked, err := qtx.LinkCariEntryFinanceTransaction(ctx, db.LinkCariEntryFinanceTransactionParams{
		ID:                   entry.ID,
		OrganizationID:       orgID,
		FinanceTransactionID: pgtype.Int8{Int64: financeTx.ID, Valid: true},
		FinanceAccountID:     pgtype.Int8{Int64: financeAccount.ID, Valid: true},
	})
	if err != nil {
		return Entry{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Entry{}, err
	}

	s.recordActivity(ctx, "cari.payment", "cari.entry", &linked.Uuid, map[string]any{
		"amount": financeusecase.NumericToString(amount),
	})
	s.publish(ctx, events.CariPaymentPosted, map[string]any{"entry_uuid": linked.Uuid.String()})
	s.indexAccount(ctx, account.Uuid)
	s.finance.NotifyIndexed(ctx, financeTx.Uuid, financeAccount.Uuid)

	detail, err := s.q.GetCariEntryByUUID(ctx, db.GetCariEntryByUUIDParams{
		Uuid: linked.Uuid, OrganizationID: orgID,
	})
	if err != nil {
		return mapCreatedEntry(linked, account.Uuid), nil
	}
	return mapGetEntry(detail), nil
}

type entryPost struct {
	Type        string
	Amount      string
	EntryDate   string
	Description string
	ReferenceNo *string
	Direction   string
	Metadata    []byte
}

func (s *Service) postEntry(ctx context.Context, accountUUID uuid.UUID, in entryPost) (Entry, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Entry{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return Entry{}, err
	}
	amount, err := numericFromString(in.Amount)
	if err != nil {
		return Entry{}, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}
	date, err := parseDate(in.EntryDate)
	if err != nil {
		return Entry{}, fmt.Errorf("%w: invalid entry_date", ErrInvalidRequest)
	}
	delta := amount
	if in.Direction == "decrease" {
		delta = numericNeg(amount)
	}
	meta := in.Metadata
	if len(meta) == 0 {
		meta = []byte("{}")
	}

	account, err := s.q.GetCariAccountByUUID(ctx, db.GetCariAccountByUUIDParams{
		Uuid: accountUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Entry{}, ErrNotFound
		}
		return Entry{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Entry{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	adjusted, err := qtx.AdjustCariAccountBalance(ctx, db.AdjustCariAccountBalanceParams{
		ID: account.ID, OrganizationID: orgID, Balance: delta,
	})
	if err != nil {
		return Entry{}, err
	}
	entry, err := qtx.CreateCariEntry(ctx, db.CreateCariEntryParams{
		OrganizationID:       orgID,
		AccountID:            account.ID,
		Type:                 in.Type,
		Amount:               amount,
		BalanceAfter:         adjusted.Balance,
		EntryDate:            date,
		Description:          strings.TrimSpace(in.Description),
		ReferenceNo:          optionalText(in.ReferenceNo),
		PaymentMethod:        pgtype.Text{},
		FinanceAccountID:     pgtype.Int8{},
		FinanceTransactionID: pgtype.Int8{},
		CreatedBy:            actorID,
		SourceType:           pgtype.Text{},
		SourceUuid:           pgtype.UUID{},
		Metadata:             meta,
	})
	if err != nil {
		return Entry{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Entry{}, err
	}

	action := "cari.charge"
	eventName := events.CariChargePosted
	if in.Type == "adjustment" {
		action = "cari.adjustment"
	}
	s.recordActivity(ctx, action, "cari.entry", &entry.Uuid, map[string]any{
		"type": in.Type, "amount": financeusecase.NumericToString(amount),
	})
	s.publish(ctx, eventName, map[string]any{"entry_uuid": entry.Uuid.String()})
	s.indexAccount(ctx, account.Uuid)
	return mapCreatedEntry(entry, account.Uuid), nil
}

func (s *Service) VoidEntry(ctx context.Context, entryUUID uuid.UUID) (Entry, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Entry{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return Entry{}, err
	}
	row, err := s.q.GetCariEntryByUUID(ctx, db.GetCariEntryByUUIDParams{
		Uuid: entryUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Entry{}, ErrNotFound
		}
		return Entry{}, err
	}
	if row.Status == "void" {
		return Entry{}, fmt.Errorf("%w: entry already void", ErrConflict)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Entry{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	voided, err := qtx.VoidCariEntry(ctx, db.VoidCariEntryParams{
		Uuid: entryUUID, OrganizationID: orgID, VoidedBy: pgtype.Int8{Int64: actorID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Entry{}, ErrNotFound
		}
		return Entry{}, err
	}

	// Reverse balance effect.
	delta := row.Amount
	switch row.Type {
	case "payment":
		// payment decreased balance; void restores it
		delta = row.Amount
	case "charge", "opening":
		delta = numericNeg(row.Amount)
	case "adjustment":
		dir := directionFromMetadata(row.Metadata)
		if dir == "decrease" {
			delta = row.Amount // restore
		} else {
			delta = numericNeg(row.Amount)
		}
	}
	if _, err := qtx.AdjustCariAccountBalance(ctx, db.AdjustCariAccountBalanceParams{
		ID: row.AccountID, OrganizationID: orgID, Balance: delta,
	}); err != nil {
		return Entry{}, err
	}

	var financeAccountUUID uuid.UUID
	var financeTxUUID uuid.UUID
	if row.Type == "payment" {
		ft, err := s.finance.VoidBySourceTx(ctx, qtx, actorID, financeusecase.SourceCariPayment, row.Uuid)
		if err != nil && !errors.Is(err, financeusecase.ErrNotFound) {
			return Entry{}, err
		}
		if err == nil {
			financeTxUUID = ft.Uuid
			acc, aerr := qtx.GetFinanceAccountByID(ctx, db.GetFinanceAccountByIDParams{
				ID: ft.AccountID, OrganizationID: orgID,
			})
			if aerr == nil {
				financeAccountUUID = acc.Uuid
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Entry{}, err
	}

	if financeTxUUID != uuid.Nil {
		s.finance.NotifyIndexed(ctx, financeTxUUID, financeAccountUUID)
	}

	account, _ := s.q.GetCariAccountByID(ctx, db.GetCariAccountByIDParams{
		ID: row.AccountID, OrganizationID: orgID,
	})
	s.recordActivity(ctx, "cari.entry_void", "cari.entry", &voided.Uuid, nil)
	s.publish(ctx, events.CariEntryVoided, map[string]any{"entry_uuid": voided.Uuid.String()})
	if account.Uuid != uuid.Nil {
		s.indexAccount(ctx, account.Uuid)
	}

	detail, err := s.q.GetCariEntryByUUID(ctx, db.GetCariEntryByUUIDParams{
		Uuid: voided.Uuid, OrganizationID: orgID,
	})
	if err != nil {
		return mapCreatedEntry(voided, account.Uuid), nil
	}
	return mapGetEntry(detail), nil
}

func directionFromMetadata(raw []byte) string {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return "increase"
	}
	if d, ok := m["direction"].(string); ok {
		return d
	}
	return "increase"
}

func parseDate(raw string) (pgtype.Date, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return pgtype.Date{}, errors.New("empty date")
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

func optionalTextPtr(v pgtype.Text) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

func numericFromString(raw string) (pgtype.Numeric, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return pgtype.Numeric{}, fmt.Errorf("amount is required")
	}
	var n pgtype.Numeric
	if err := n.Scan(raw); err != nil {
		return pgtype.Numeric{}, fmt.Errorf("invalid amount")
	}
	if !n.Valid || n.Int == nil || n.Int.Sign() <= 0 {
		return pgtype.Numeric{}, fmt.Errorf("amount must be positive")
	}
	return n, nil
}

func numericNeg(n pgtype.Numeric) pgtype.Numeric {
	if !n.Valid || n.Int == nil {
		return n
	}
	out := n
	out.Int = new(big.Int).Neg(n.Int)
	return out
}

func mapListAccount(row db.ListCariAccountsRow) Account {
	return Account{
		UUID:          row.Uuid,
		CustomerUUID:  row.CustomerUuid,
		CustomerName:  row.CustomerName,
		CustomerPhone: row.CustomerPhone,
		CustomerKind:  row.CustomerKind,
		Currency:      row.Currency,
		Balance:       financeusecase.NumericToString(row.Balance),
		IsActive:      row.IsActive,
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}
}

func mapAccountDetail(row db.GetCariAccountByUUIDRow) AccountDetail {
	return AccountDetail{
		Account: Account{
			UUID:          row.Uuid,
			CustomerUUID:  row.CustomerUuid,
			CustomerName:  row.CustomerName,
			CustomerPhone: row.CustomerPhone,
			CustomerKind:  row.CustomerKind,
			Currency:      row.Currency,
			Balance:       financeusecase.NumericToString(row.Balance),
			IsActive:      row.IsActive,
			CreatedAt:     row.CreatedAt.Time,
			UpdatedAt:     row.UpdatedAt.Time,
		},
		CustomerEmail:    row.CustomerEmail,
		CustomerIsActive: row.CustomerIsActive,
	}
}

func mapListEntry(row db.ListCariEntriesRow) Entry {
	e := Entry{
		UUID:         row.Uuid,
		AccountUUID:  row.AccountUuid,
		Type:         row.Type,
		Status:       row.Status,
		Amount:       financeusecase.NumericToString(row.Amount),
		BalanceAfter: financeusecase.NumericToString(row.BalanceAfter),
		EntryDate:    formatDate(row.EntryDate),
		Description:  row.Description,
		ReferenceNo:  optionalTextPtr(row.ReferenceNo),
		PaymentMethod: optionalTextPtr(row.PaymentMethod),
		CreatedAt:    row.CreatedAt.Time,
	}
	if row.FinanceAccountUuid.Valid {
		id := uuid.UUID(row.FinanceAccountUuid.Bytes)
		e.FinanceAccountUUID = &id
	}
	if row.FinanceAccountName.Valid {
		s := row.FinanceAccountName.String
		e.FinanceAccountName = &s
	}
	if row.FinanceTransactionUuid.Valid {
		id := uuid.UUID(row.FinanceTransactionUuid.Bytes)
		e.FinanceTransactionUUID = &id
	}
	if row.VoidedAt.Valid {
		t := row.VoidedAt.Time
		e.VoidedAt = &t
	}
	return e
}

func mapGetEntry(row db.GetCariEntryByUUIDRow) Entry {
	e := Entry{
		UUID:         row.Uuid,
		AccountUUID:  row.AccountUuid,
		Type:         row.Type,
		Status:       row.Status,
		Amount:       financeusecase.NumericToString(row.Amount),
		BalanceAfter: financeusecase.NumericToString(row.BalanceAfter),
		EntryDate:    formatDate(row.EntryDate),
		Description:  row.Description,
		ReferenceNo:  optionalTextPtr(row.ReferenceNo),
		PaymentMethod: optionalTextPtr(row.PaymentMethod),
		CreatedAt:    row.CreatedAt.Time,
	}
	if row.FinanceAccountUuid.Valid {
		id := uuid.UUID(row.FinanceAccountUuid.Bytes)
		e.FinanceAccountUUID = &id
	}
	if row.FinanceAccountName.Valid {
		s := row.FinanceAccountName.String
		e.FinanceAccountName = &s
	}
	if row.FinanceTransactionUuid.Valid {
		id := uuid.UUID(row.FinanceTransactionUuid.Bytes)
		e.FinanceTransactionUUID = &id
	}
	if row.VoidedAt.Valid {
		t := row.VoidedAt.Time
		e.VoidedAt = &t
	}
	return e
}

func mapCreatedEntry(row db.CariEntry, accountUUID uuid.UUID) Entry {
	e := Entry{
		UUID:         row.Uuid,
		AccountUUID:  accountUUID,
		Type:         row.Type,
		Status:       row.Status,
		Amount:       financeusecase.NumericToString(row.Amount),
		BalanceAfter: financeusecase.NumericToString(row.BalanceAfter),
		EntryDate:    formatDate(row.EntryDate),
		Description:  row.Description,
		ReferenceNo:  optionalTextPtr(row.ReferenceNo),
		PaymentMethod: optionalTextPtr(row.PaymentMethod),
		CreatedAt:    row.CreatedAt.Time,
	}
	if row.VoidedAt.Valid {
		t := row.VoidedAt.Time
		e.VoidedAt = &t
	}
	return e
}

// EnsureAccountForCustomer creates a TRY cari account for a customer (same tx via q).
func EnsureAccountForCustomer(ctx context.Context, q *db.Queries, orgID, customerID int64, active bool) error {
	var zero pgtype.Numeric
	_ = zero.Scan("0")
	_, err := q.CreateCariAccount(ctx, db.CreateCariAccountParams{
		OrganizationID: orgID,
		CustomerID:     customerID,
		Currency:       "TRY",
		Balance:        zero,
		IsActive:       active,
	})
	return err
}
