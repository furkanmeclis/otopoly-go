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
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
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
	liveEvents resourceevents.Publisher
	pool       *pgxpool.Pool
	q          *db.Queries
	act        *activity.Recorder
	finance    *financeusecase.Service
	search     SearchIndexer
	bus        events.Bus
}

func New(
	pool *pgxpool.Pool,
	q *db.Queries,
	act *activity.Recorder,
	finance *financeusecase.Service,
) *Service {
	return &Service{pool: pool, q: q, act: act, finance: finance}
}

func (s *Service) SetSearchIndexer(idx SearchIndexer) { s.search = idx }
func (s *Service) SetEventBus(bus events.Bus)         { s.bus = bus }

func (s *Service) ResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantPurchases()
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

func (s *Service) indexPurchase(ctx context.Context, id uuid.UUID) {
	if s.search == nil || id == uuid.Nil {
		return
	}
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return
	}
	s.search.EnqueueUpsert(ctx, "tenant_purchases", scope.UUID.String()+"_"+id.String())
}

func (s *Service) List(ctx context.Context, limit, offset int32, filters ListFilters) ([]PurchaseDetail, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	params := db.ListPurchasesParams{
		OrganizationID: orgID,
		LimitCount:     limit,
		OffsetCount:    offset,
		Sort:           "-purchased_at",
	}
	if sort := strings.TrimSpace(filters.Sort); sort != "" {
		params.Sort = sort
	}
	if q := strings.TrimSpace(filters.Q); q != "" {
		params.Q = pgtype.Text{String: q, Valid: true}
	}
	if st := strings.TrimSpace(filters.Status); st != "" {
		params.Status = pgtype.Text{String: st, Valid: true}
	}
	if raw := strings.TrimSpace(filters.SupplierUUID); raw != "" {
		su, err := uuid.Parse(raw)
		if err != nil {
			return nil, 0, fmt.Errorf("%w: invalid supplier_uuid", ErrInvalidRequest)
		}
		params.SupplierUuid = pgtype.UUID{Bytes: su, Valid: true}
	}
	if from := strings.TrimSpace(filters.DateFrom); from != "" {
		t, err := time.ParseInLocation("2006-01-02", from, time.Local)
		if err != nil {
			return nil, 0, fmt.Errorf("%w: invalid date_from", ErrInvalidRequest)
		}
		params.DateFrom = pgtype.Timestamptz{Time: t, Valid: true}
	}
	if to := strings.TrimSpace(filters.DateTo); to != "" {
		t, err := time.ParseInLocation("2006-01-02", to, time.Local)
		if err != nil {
			return nil, 0, fmt.Errorf("%w: invalid date_to", ErrInvalidRequest)
		}
		params.DateTo = pgtype.Timestamptz{Time: t.Add(24 * time.Hour), Valid: true}
	}
	rows, err := s.q.ListPurchases(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountPurchases(ctx, db.CountPurchasesParams{
		OrganizationID: orgID,
		Q:              params.Q,
		Status:         params.Status,
		DateFrom:       params.DateFrom,
		DateTo:         params.DateTo,
		SupplierUuid:   params.SupplierUuid,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]PurchaseDetail, 0, len(rows))
	if len(rows) == 0 {
		return out, total, nil
	}
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	lineRows, err := s.q.ListPurchaseLinesByPurchaseIDs(ctx, db.ListPurchaseLinesByPurchaseIDsParams{
		OrganizationID: orgID, PurchaseIds: ids,
	})
	if err != nil {
		return nil, 0, err
	}
	linesByPurchase := make(map[int64][]Line, len(rows))
	for _, line := range lineRows {
		linesByPurchase[line.PurchaseID] = append(linesByPurchase[line.PurchaseID], mapLine(db.ListPurchaseLinesRow(line)))
	}
	for _, row := range rows {
		lines := linesByPurchase[row.ID]
		if lines == nil {
			lines = []Line{}
		}
		out = append(out, PurchaseDetail{Purchase: mapPurchaseList(row), Lines: lines})
	}
	return out, total, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (PurchaseDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	row, err := s.q.GetPurchaseByUUID(ctx, db.GetPurchaseByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PurchaseDetail{}, ErrNotFound
		}
		return PurchaseDetail{}, err
	}
	return s.loadDetail(ctx, orgID, row)
}

func (s *Service) loadDetail(ctx context.Context, orgID int64, row db.GetPurchaseByUUIDRow) (PurchaseDetail, error) {
	lines, err := s.q.ListPurchaseLines(ctx, db.ListPurchaseLinesParams{
		PurchaseID: row.ID, OrganizationID: orgID,
	})
	if err != nil {
		return PurchaseDetail{}, err
	}
	out := PurchaseDetail{Purchase: mapPurchaseGet(row), Lines: make([]Line, 0, len(lines))}
	for _, line := range lines {
		out.Lines = append(out.Lines, mapLine(line))
	}
	return out, nil
}

func (s *Service) Create(ctx context.Context, in CreateInput) (PurchaseDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	method, err := normalizeMethod(in.Method)
	if err != nil {
		return PurchaseDetail{}, err
	}
	if in.FinanceAccountUUID == uuid.Nil {
		return PurchaseDetail{}, fmt.Errorf("%w: finance_account_uuid is required", ErrInvalidRequest)
	}
	prep, err := s.prepare(ctx, s.q, orgID, in.SupplierUUID, in.Currency, in.Lines, false)
	if err != nil {
		return PurchaseDetail{}, err
	}
	purchasedAt, err := parsePurchasedAt(in.PurchasedAt)
	if err != nil {
		return PurchaseDetail{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	fa, err := s.financeAccount(ctx, qtx, orgID, in.FinanceAccountUUID, prep.currency)
	if err != nil {
		return PurchaseDetail{}, err
	}
	purchase, err := qtx.CreatePurchase(ctx, db.CreatePurchaseParams{
		OrganizationID:       orgID,
		SupplierID:           prep.supplier.ID,
		SupplierName:         prep.supplier.Name,
		Status:               "posted",
		Currency:             prep.currency,
		TotalAmount:          prep.totalNum,
		Method:               method,
		FinanceAccountID:     pgtype.Int8{Int64: fa.ID, Valid: true},
		FinanceTransactionID: pgtype.Int8{},
		Notes:                strings.TrimSpace(in.Notes),
		PurchasedAt:          pgtype.Timestamptz{Time: purchasedAt, Valid: true},
		CreatedBy:            actorID,
	})
	if err != nil {
		return PurchaseDetail{}, err
	}
	ft, err := s.postTx(ctx, qtx, orgID, actorID, purchase.ID, purchase.Uuid, prep, method, fa.ID, purchasedAt)
	if err != nil {
		return PurchaseDetail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PurchaseDetail{}, err
	}
	s.finance.NotifyIndexed(ctx, ft.Uuid, fa.Uuid)

	detail, err := s.Get(ctx, purchase.Uuid)
	if err != nil {
		return PurchaseDetail{}, err
	}
	s.recordActivity(ctx, "tenant.purchases.create", "purchase", &purchase.Uuid, map[string]any{
		"method": method, "total": financeusecase.NumericToString(prep.totalNum),
	})
	s.live(ctx, resourceevents.TenantPurchases, resourceevents.ActionCreated, purchase.Uuid.String())
	s.liveMoney(ctx)
	s.publish(ctx, events.PurchasesCreated, map[string]any{"uuid": purchase.Uuid.String()})
	s.indexPurchase(ctx, purchase.Uuid)
	return detail, nil
}

func normalizeMethod(raw string) (string, error) {
	method := strings.TrimSpace(raw)
	if method != "cash" && method != "card" {
		return "", fmt.Errorf("%w: method must be cash or card", ErrInvalidRequest)
	}
	return method, nil
}

func parsePurchasedAt(raw *string) (time.Time, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return time.Now(), nil
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(*raw))
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: invalid purchased_at", ErrInvalidRequest)
	}
	return t, nil
}

// preparedLine is a validated purchase line (product of the organization).
type preparedLine struct {
	productID  int64
	name       string
	unitCost   pgtype.Numeric
	qty        pgtype.Numeric
	lineTotal  pgtype.Numeric
	trackStock bool
}

// prepared is a validated purchase body: supplier, currency, lines, total.
type prepared struct {
	supplier db.Supplier
	currency string
	lines    []preparedLine
	totalNum pgtype.Numeric
}

// prepare validates the supplier and lines of a purchase. allowZero lets a
// draft keep a zero total (unknown cost); posting always needs a positive one.
func (s *Service) prepare(ctx context.Context, q *db.Queries, orgID int64, supplierUUID uuid.UUID, rawCurrency string, lines []CreateLineInput, allowZero bool) (prepared, error) {
	if supplierUUID == uuid.Nil {
		return prepared{}, fmt.Errorf("%w: supplier_uuid is required", ErrInvalidRequest)
	}
	if len(lines) == 0 {
		return prepared{}, fmt.Errorf("%w: at least one product line is required", ErrInvalidRequest)
	}
	if len(lines) > maxLines {
		return prepared{}, fmt.Errorf("%w: at most %d lines", ErrInvalidRequest, maxLines)
	}
	currency := strings.ToUpper(strings.TrimSpace(rawCurrency))
	if currency == "" {
		currency = "TRY"
	}
	supplier, err := q.GetSupplierByUUID(ctx, db.GetSupplierByUUIDParams{
		Uuid: supplierUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return prepared{}, fmt.Errorf("%w: supplier not found", ErrNotFound)
		}
		return prepared{}, err
	}
	if !supplier.IsActive {
		return prepared{}, fmt.Errorf("%w: supplier is inactive", ErrInvalidRequest)
	}

	out := prepared{supplier: supplier, currency: currency, lines: make([]preparedLine, 0, len(lines))}
	total := big.NewRat(0, 1)
	for i, line := range lines {
		prod, err := q.GetProductByUUID(ctx, db.GetProductByUUIDParams{
			Uuid: line.ProductUUID, OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return prepared{}, fmt.Errorf("%w: product not found", ErrNotFound)
			}
			return prepared{}, err
		}
		if !prod.IsActive {
			return prepared{}, fmt.Errorf("%w: product %q is inactive", ErrInvalidRequest, prod.Name)
		}
		costStr := financeusecase.NumericToString(prod.CostPrice)
		if line.UnitCost != nil && strings.TrimSpace(*line.UnitCost) != "" {
			costStr = strings.TrimSpace(*line.UnitCost)
		}
		qtyStr := "1"
		if line.Qty != nil && strings.TrimSpace(*line.Qty) != "" {
			qtyStr = strings.TrimSpace(*line.Qty)
		}
		lineTotalStr, err := mulDecimalStrings(costStr, qtyStr)
		if err != nil {
			return prepared{}, fmt.Errorf("%w: line %d: %v", ErrInvalidRequest, i+1, err)
		}
		unitCost, err := numericNonNeg(costStr)
		if err != nil {
			return prepared{}, fmt.Errorf("%w: line %d: %v", ErrInvalidRequest, i+1, err)
		}
		qty, err := numericPositive(qtyStr)
		if err != nil {
			return prepared{}, fmt.Errorf("%w: line %d: %v", ErrInvalidRequest, i+1, err)
		}
		lineTotal, err := numericNonNeg(lineTotalStr)
		if err != nil {
			return prepared{}, fmt.Errorf("%w: line %d: %v", ErrInvalidRequest, i+1, err)
		}
		rat, ok := new(big.Rat).SetString(lineTotalStr)
		if !ok {
			return prepared{}, fmt.Errorf("%w: line %d: invalid total", ErrInvalidRequest, i+1)
		}
		total.Add(total, rat)
		out.lines = append(out.lines, preparedLine{
			productID:  prod.ID,
			name:       prod.Name,
			unitCost:   unitCost,
			qty:        qty,
			lineTotal:  lineTotal,
			trackStock: prod.TrackStock,
		})
	}
	if total.Sign() < 0 || (!allowZero && total.Sign() == 0) {
		return prepared{}, fmt.Errorf("%w: total must be positive", ErrInvalidRequest)
	}
	totalNum, err := numericNonNeg(total.FloatString(2))
	if err != nil {
		return prepared{}, fmt.Errorf("%w: total: %v", ErrInvalidRequest, err)
	}
	out.totalNum = totalNum
	return out, nil
}

// financeAccount loads the paying account (currency must match).
func (s *Service) financeAccount(ctx context.Context, qtx *db.Queries, orgID int64, id uuid.UUID, currency string) (db.FinanceAccount, error) {
	fa, err := qtx.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fa, fmt.Errorf("%w: finance account not found", ErrNotFound)
		}
		return fa, err
	}
	if !strings.EqualFold(fa.Currency, currency) {
		return fa, fmt.Errorf("%w: finance account currency must match purchase currency", ErrInvalidRequest)
	}
	return fa, nil
}

// insertLines writes the purchase lines (no stock change).
func insertLines(ctx context.Context, qtx *db.Queries, orgID, purchaseID int64, prep prepared) error {
	for i, pl := range prep.lines {
		if _, err := qtx.CreatePurchaseLine(ctx, db.CreatePurchaseLineParams{
			OrganizationID: orgID,
			PurchaseID:     purchaseID,
			ProductID:      pl.productID,
			Name:           pl.name,
			UnitCost:       pl.unitCost,
			Qty:            pl.qty,
			LineTotal:      pl.lineTotal,
			Currency:       prep.currency,
			SortOrder:      int32(i),
		}); err != nil {
			return err
		}
	}
	return nil
}

// postTx is the posting step shared by Create and PostDraft: lines, stock
// for tracked products and the expense on the finance account.
func (s *Service) postTx(
	ctx context.Context, qtx *db.Queries, orgID, actorID, purchaseID int64, purchaseUUID uuid.UUID,
	prep prepared, method string, financeAccountID int64, purchasedAt time.Time,
) (db.FinanceTransaction, error) {
	if err := insertLines(ctx, qtx, orgID, purchaseID, prep); err != nil {
		return db.FinanceTransaction{}, err
	}
	for _, pl := range prep.lines {
		if !pl.trackStock {
			continue
		}
		prod, err := qtx.GetProductByID(ctx, db.GetProductByIDParams{
			ID: pl.productID, OrganizationID: orgID,
		})
		if err != nil {
			return db.FinanceTransaction{}, err
		}
		if _, err := qtx.AdjustProductStock(ctx, db.AdjustProductStockParams{
			Uuid:           prod.Uuid,
			OrganizationID: orgID,
			Delta:          pl.qty,
		}); err != nil {
			return db.FinanceTransaction{}, err
		}
	}

	entryDate := pgtype.Date{Time: purchasedAt, Valid: true}
	desc := "Stok alımı"
	if prep.supplier.Name != "" {
		desc = fmt.Sprintf("Stok alımı — %s", prep.supplier.Name)
	}
	meta, _ := json.Marshal(map[string]any{"module": "purchases", "purchase_uuid": purchaseUUID.String()})

	categoryID, err := s.finance.ResolveCategoryIDByName(ctx, qtx, financeusecase.CategoryStockPurchase, "expense")
	if err != nil {
		return db.FinanceTransaction{}, err
	}
	ft, err := s.finance.PostExpenseFromSourceTx(ctx, qtx, actorID, financeusecase.PostFromSourceInput{
		AccountID:       financeAccountID,
		CategoryID:      categoryID,
		Amount:          prep.totalNum,
		Currency:        prep.currency,
		TransactionDate: entryDate,
		Description:     desc,
		PaymentMethod:   method,
		SourceType:      financeusecase.SourcePurchase,
		SourceUUID:      purchaseUUID,
		Metadata:        meta,
	})
	if err != nil {
		return db.FinanceTransaction{}, err
	}
	if _, err := qtx.LinkPurchaseFinance(ctx, db.LinkPurchaseFinanceParams{
		ID:                   purchaseID,
		OrganizationID:       orgID,
		FinanceTransactionID: pgtype.Int8{Int64: ft.ID, Valid: true},
		FinanceAccountID:     pgtype.Int8{Int64: financeAccountID, Valid: true},
	}); err != nil {
		return db.FinanceTransaction{}, err
	}
	return ft, nil
}

func (s *Service) Void(ctx context.Context, id uuid.UUID) (PurchaseDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}

	row, err := s.q.GetPurchaseByUUID(ctx, db.GetPurchaseByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PurchaseDetail{}, ErrNotFound
		}
		return PurchaseDetail{}, err
	}
	if row.Status != "posted" {
		return PurchaseDetail{}, fmt.Errorf("%w: only posted purchases can be voided", ErrConflict)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	voided, err := qtx.VoidPurchase(ctx, db.VoidPurchaseParams{
		Uuid: id, OrganizationID: orgID, VoidedBy: pgtype.Int8{Int64: actorID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PurchaseDetail{}, ErrConflict
		}
		return PurchaseDetail{}, err
	}

	lines, err := qtx.ListPurchaseLines(ctx, db.ListPurchaseLinesParams{
		PurchaseID: voided.ID, OrganizationID: orgID,
	})
	if err != nil {
		return PurchaseDetail{}, err
	}
	for _, line := range lines {
		prod, err := qtx.GetProductByID(ctx, db.GetProductByIDParams{
			ID: line.ProductID, OrganizationID: orgID,
		})
		if err != nil {
			return PurchaseDetail{}, err
		}
		if prod.TrackStock {
			neg := line.Qty
			neg.Int = new(big.Int).Neg(line.Qty.Int)
			if _, err := qtx.AdjustProductStock(ctx, db.AdjustProductStockParams{
				Uuid:           prod.Uuid,
				OrganizationID: orgID,
				Delta:          neg,
			}); err != nil {
				return PurchaseDetail{}, err
			}
		}
	}

	var financeTxUUID, financeAccountUUID uuid.UUID
	ft, err := s.finance.VoidBySourceTx(ctx, qtx, actorID, financeusecase.SourcePurchase, voided.Uuid)
	if err != nil && !errors.Is(err, financeusecase.ErrNotFound) {
		return PurchaseDetail{}, err
	}
	if err == nil {
		financeTxUUID = ft.Uuid
		if row.FinanceAccountUuid.Valid {
			financeAccountUUID = uuid.UUID(row.FinanceAccountUuid.Bytes)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return PurchaseDetail{}, err
	}
	if financeTxUUID != uuid.Nil {
		s.finance.NotifyIndexed(ctx, financeTxUUID, financeAccountUUID)
	}

	detail, err := s.Get(ctx, id)
	if err != nil {
		return PurchaseDetail{}, err
	}
	s.recordActivity(ctx, "tenant.purchases.void", "purchase", &id, nil)
	s.live(ctx, resourceevents.TenantPurchases, resourceevents.ActionUpdated, id.String())
	s.liveMoney(ctx)
	s.publish(ctx, events.PurchasesVoided, map[string]any{"uuid": id.String()})
	s.indexPurchase(ctx, id)
	return detail, nil
}
