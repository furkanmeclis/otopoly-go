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
	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
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
	cari    *cariusecase.Service
	search  SearchIndexer
	bus     events.Bus
}

func New(
	pool *pgxpool.Pool,
	q *db.Queries,
	act *activity.Recorder,
	finance *financeusecase.Service,
	cari *cariusecase.Service,
) *Service {
	return &Service{pool: pool, q: q, act: act, finance: finance, cari: cari}
}

func (s *Service) SetSearchIndexer(idx SearchIndexer) { s.search = idx }
func (s *Service) SetEventBus(bus events.Bus)         { s.bus = bus }

func (s *Service) ResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantSales()
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

func (s *Service) indexSale(ctx context.Context, id uuid.UUID) {
	if s.search == nil || id == uuid.Nil {
		return
	}
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return
	}
	s.search.EnqueueUpsert(ctx, "tenant_sales", scope.UUID.String()+"_"+id.String())
}

func (s *Service) Summary(ctx context.Context, dateStr string) (Summary, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Summary{}, err
	}
	day, err := parseDay(dateStr)
	if err != nil {
		return Summary{}, fmt.Errorf("%w: invalid date", ErrInvalidRequest)
	}
	next := day.Add(24 * time.Hour)
	row, err := s.q.SumProductSalesDaily(ctx, db.SumProductSalesDailyParams{
		OrganizationID: orgID,
		SoldAt:         pgtype.Timestamptz{Time: day, Valid: true},
		SoldAt_2:       pgtype.Timestamptz{Time: next, Valid: true},
	})
	if err != nil {
		return Summary{}, err
	}
	return Summary{
		SaleCount: row.SaleCount,
		CardTotal: financeusecase.NumericToString(row.CardTotal),
		CariTotal: financeusecase.NumericToString(row.CariTotal),
		NetTotal:  financeusecase.NumericToString(row.NetTotal),
		PaidTotal: financeusecase.NumericToString(row.PaidTotal),
		Date:      day.Format("2006-01-02"),
	}, nil
}

func (s *Service) List(ctx context.Context, limit, offset int32, filters ListFilters) ([]Sale, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	params := db.ListProductSalesParams{
		OrganizationID: orgID,
		LimitCount:     limit,
		OffsetCount:    offset,
		Sort:           "-sold_at",
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
	rows, err := s.q.ListProductSales(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	countParams := db.CountProductSalesParams{
		OrganizationID: orgID,
		Q:              params.Q,
		Status:         params.Status,
		DateFrom:       params.DateFrom,
		DateTo:         params.DateTo,
	}
	total, err := s.q.CountProductSales(ctx, countParams)
	if err != nil {
		return nil, 0, err
	}
	out := make([]Sale, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapSaleList(row))
	}
	return out, total, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (SaleDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return SaleDetail{}, err
	}
	row, err := s.q.GetProductSaleByUUID(ctx, db.GetProductSaleByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SaleDetail{}, ErrNotFound
		}
		return SaleDetail{}, err
	}
	return s.loadDetail(ctx, orgID, row)
}

func (s *Service) loadDetail(ctx context.Context, orgID int64, row db.GetProductSaleByUUIDRow) (SaleDetail, error) {
	lines, err := s.q.ListProductSaleLines(ctx, db.ListProductSaleLinesParams{
		SaleID: row.ID, OrganizationID: orgID,
	})
	if err != nil {
		return SaleDetail{}, err
	}
	out := SaleDetail{Sale: mapSaleGet(row), Lines: make([]Line, 0, len(lines))}
	for _, line := range lines {
		out.Lines = append(out.Lines, mapLine(line))
	}
	return out, nil
}

func (s *Service) Create(ctx context.Context, in CreateInput) (SaleDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return SaleDetail{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return SaleDetail{}, err
	}
	method := strings.TrimSpace(in.Method)
	if method != "cash" && method != "card" && method != "cari" {
		return SaleDetail{}, fmt.Errorf("%w: method must be cash, card, or cari", ErrInvalidRequest)
	}
	if len(in.Lines) == 0 {
		return SaleDetail{}, fmt.Errorf("%w: at least one product line is required", ErrInvalidRequest)
	}
	if method == "cari" && (in.CustomerUUID == nil || *in.CustomerUUID == uuid.Nil) {
		return SaleDetail{}, fmt.Errorf("%w: customer_uuid is required for cari payment", ErrInvalidRequest)
	}

	currency := strings.ToUpper(strings.TrimSpace(in.Currency))
	if currency == "" {
		currency = "TRY"
	}

	var customerID pgtype.Int8
	customerName := ""
	customerPhone := ""
	if in.CustomerUUID != nil && *in.CustomerUUID != uuid.Nil {
		cust, err := s.q.GetCustomerByUUID(ctx, db.GetCustomerByUUIDParams{
			Uuid: *in.CustomerUUID, OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return SaleDetail{}, fmt.Errorf("%w: customer not found", ErrNotFound)
			}
			return SaleDetail{}, err
		}
		customerID = pgtype.Int8{Int64: cust.ID, Valid: true}
		customerName = cust.Name
		customerPhone = cust.Phone
	}

	type preparedLine struct {
		productID  int64
		name       string
		unitPrice  pgtype.Numeric
		qty        pgtype.Numeric
		vatRate    pgtype.Numeric
		lineTotal  pgtype.Numeric
		trackStock bool
		stock      pgtype.Numeric
	}
	prepared := make([]preparedLine, 0, len(in.Lines))
	total := big.NewRat(0, 1)
	for i, line := range in.Lines {
		prod, err := s.q.GetProductByUUID(ctx, db.GetProductByUUIDParams{
			Uuid: line.ProductUUID, OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return SaleDetail{}, fmt.Errorf("%w: product not found", ErrNotFound)
			}
			return SaleDetail{}, err
		}
		if !prod.IsActive {
			return SaleDetail{}, fmt.Errorf("%w: product %q is inactive", ErrInvalidRequest, prod.Name)
		}
		priceStr := financeusecase.NumericToString(prod.SalePrice)
		if line.UnitPrice != nil && strings.TrimSpace(*line.UnitPrice) != "" {
			priceStr = strings.TrimSpace(*line.UnitPrice)
		}
		qtyStr := "1"
		if line.Qty != nil && strings.TrimSpace(*line.Qty) != "" {
			qtyStr = strings.TrimSpace(*line.Qty)
		}
		lineTotalStr, err := mulDecimalStrings(priceStr, qtyStr)
		if err != nil {
			return SaleDetail{}, fmt.Errorf("%w: line %d: %v", ErrInvalidRequest, i+1, err)
		}
		unitPrice, err := numericNonNeg(priceStr)
		if err != nil {
			return SaleDetail{}, fmt.Errorf("%w: line %d: %v", ErrInvalidRequest, i+1, err)
		}
		qty, err := numericPositive(qtyStr)
		if err != nil {
			return SaleDetail{}, fmt.Errorf("%w: line %d: %v", ErrInvalidRequest, i+1, err)
		}
		lineTotal, err := numericNonNeg(lineTotalStr)
		if err != nil {
			return SaleDetail{}, fmt.Errorf("%w: line %d: %v", ErrInvalidRequest, i+1, err)
		}
		if prod.TrackStock {
			stockRat := ratFromNumeric(prod.StockQuantity)
			qtyRat := ratFromNumeric(qty)
			if stockRat.Cmp(qtyRat) < 0 {
				return SaleDetail{}, fmt.Errorf("%w: insufficient stock for %q", ErrConflict, prod.Name)
			}
		}
		rat, ok := new(big.Rat).SetString(lineTotalStr)
		if !ok {
			return SaleDetail{}, fmt.Errorf("%w: line %d: invalid total", ErrInvalidRequest, i+1)
		}
		total.Add(total, rat)
		prepared = append(prepared, preparedLine{
			productID:  prod.ID,
			name:       prod.Name,
			unitPrice:  unitPrice,
			qty:        qty,
			vatRate:    prod.VatRate,
			lineTotal:  lineTotal,
			trackStock: prod.TrackStock,
			stock:      prod.StockQuantity,
		})
	}
	if total.Sign() <= 0 {
		return SaleDetail{}, fmt.Errorf("%w: total must be positive", ErrInvalidRequest)
	}
	totalNum, err := numericPositive(total.FloatString(2))
	if err != nil {
		return SaleDetail{}, fmt.Errorf("%w: total: %v", ErrInvalidRequest, err)
	}

	soldAt := time.Now()
	if in.SoldAt != nil && strings.TrimSpace(*in.SoldAt) != "" {
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(*in.SoldAt))
		if err != nil {
			return SaleDetail{}, fmt.Errorf("%w: invalid sold_at", ErrInvalidRequest)
		}
		soldAt = t
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SaleDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	var financeAccountID pgtype.Int8
	var financeAccountUUID uuid.UUID
	if method == "cash" || method == "card" {
		if in.FinanceAccountUUID == nil || *in.FinanceAccountUUID == uuid.Nil {
			return SaleDetail{}, fmt.Errorf("%w: finance_account_uuid is required", ErrInvalidRequest)
		}
		fa, err := qtx.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{
			Uuid: *in.FinanceAccountUUID, OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return SaleDetail{}, fmt.Errorf("%w: finance account not found", ErrNotFound)
			}
			return SaleDetail{}, err
		}
		if !strings.EqualFold(fa.Currency, currency) {
			return SaleDetail{}, fmt.Errorf("%w: finance account currency must match sale currency", ErrInvalidRequest)
		}
		financeAccountID = pgtype.Int8{Int64: fa.ID, Valid: true}
		financeAccountUUID = fa.Uuid
	}

	sale, err := qtx.CreateProductSale(ctx, db.CreateProductSaleParams{
		OrganizationID:       orgID,
		CustomerID:           customerID,
		CustomerName:         customerName,
		CustomerPhone:        customerPhone,
		Status:               "posted",
		Currency:             currency,
		TotalAmount:          totalNum,
		Method:               method,
		FinanceAccountID:     financeAccountID,
		FinanceTransactionID: pgtype.Int8{},
		CariEntryID:          pgtype.Int8{},
		Notes:                strings.TrimSpace(in.Notes),
		SoldAt:               pgtype.Timestamptz{Time: soldAt, Valid: true},
		CreatedBy:            actorID,
	})
	if err != nil {
		return SaleDetail{}, err
	}

	for i, pl := range prepared {
		if _, err := qtx.CreateProductSaleLine(ctx, db.CreateProductSaleLineParams{
			OrganizationID: orgID,
			SaleID:         sale.ID,
			ProductID:      pl.productID,
			Name:           pl.name,
			UnitPrice:      pl.unitPrice,
			Qty:            pl.qty,
			VatRate:        pl.vatRate,
			LineTotal:      pl.lineTotal,
			Currency:       currency,
			SortOrder:      int32(i),
		}); err != nil {
			return SaleDetail{}, err
		}
		if pl.trackStock {
			neg := pl.qty
			neg.Int = new(big.Int).Neg(pl.qty.Int)
			prod, err := qtx.GetProductByID(ctx, db.GetProductByIDParams{
				ID: pl.productID, OrganizationID: orgID,
			})
			if err != nil {
				return SaleDetail{}, err
			}
			if _, err := qtx.AdjustProductStock(ctx, db.AdjustProductStockParams{
				Uuid:           prod.Uuid,
				OrganizationID: orgID,
				Delta:          neg,
			}); err != nil {
				return SaleDetail{}, err
			}
		}
	}

	entryDate := pgtype.Date{Time: soldAt, Valid: true}
	desc := "Ürün satışı"
	if customerName != "" {
		desc = fmt.Sprintf("Ürün satışı — %s", customerName)
	}
	meta, _ := json.Marshal(map[string]any{"module": "sales", "sale_uuid": sale.Uuid.String()})

	var financeTxUUID uuid.UUID
	if method == "cash" || method == "card" {
		categoryID, err := s.finance.ResolveCategoryIDByName(ctx, qtx, financeusecase.CategoryProductSale, "income")
		if err != nil {
			return SaleDetail{}, err
		}
		ft, err := s.finance.PostIncomeFromSourceTx(ctx, qtx, actorID, financeusecase.PostFromSourceInput{
			AccountID:       financeAccountID.Int64,
			CategoryID:      categoryID,
			Amount:          totalNum,
			Currency:        currency,
			TransactionDate: entryDate,
			Description:     desc,
			PaymentMethod:   method,
			SourceType:      financeusecase.SourceProductSale,
			SourceUUID:      sale.Uuid,
			Metadata:        meta,
		})
		if err != nil {
			return SaleDetail{}, err
		}
		financeTxUUID = ft.Uuid
		if _, err := qtx.LinkProductSaleFinance(ctx, db.LinkProductSaleFinanceParams{
			ID:                   sale.ID,
			OrganizationID:       orgID,
			FinanceTransactionID: pgtype.Int8{Int64: ft.ID, Valid: true},
			FinanceAccountID:     financeAccountID,
		}); err != nil {
			return SaleDetail{}, err
		}
	} else {
		entry, err := s.cari.ChargeFromSourceTx(ctx, qtx, actorID, cariusecase.ChargeFromSourceInput{
			CustomerID:  customerID.Int64,
			Amount:      totalNum,
			Currency:    currency,
			EntryDate:   entryDate,
			Description: desc,
			SourceType:  financeusecase.SourceProductSale,
			SourceUUID:  sale.Uuid,
			Metadata:    meta,
		})
		if err != nil {
			return SaleDetail{}, err
		}
		if _, err := qtx.LinkProductSaleCari(ctx, db.LinkProductSaleCariParams{
			ID:             sale.ID,
			OrganizationID: orgID,
			CariEntryID:    pgtype.Int8{Int64: entry.ID, Valid: true},
		}); err != nil {
			return SaleDetail{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return SaleDetail{}, err
	}

	if method == "cash" || method == "card" {
		s.finance.NotifyIndexed(ctx, financeTxUUID, financeAccountUUID)
	}

	detail, err := s.Get(ctx, sale.Uuid)
	if err != nil {
		return SaleDetail{}, err
	}
	s.recordActivity(ctx, "tenant.sales.create", "sale", &sale.Uuid, map[string]any{
		"method": method, "total": financeusecase.NumericToString(totalNum),
	})
	s.publish(ctx, events.SalesCreated, map[string]any{"uuid": sale.Uuid.String()})
	s.indexSale(ctx, sale.Uuid)
	return detail, nil
}

func (s *Service) Void(ctx context.Context, id uuid.UUID) (SaleDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return SaleDetail{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return SaleDetail{}, err
	}

	row, err := s.q.GetProductSaleByUUID(ctx, db.GetProductSaleByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SaleDetail{}, ErrNotFound
		}
		return SaleDetail{}, err
	}
	if row.Status != "posted" {
		return SaleDetail{}, fmt.Errorf("%w: only posted sales can be voided", ErrConflict)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SaleDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	voided, err := qtx.VoidProductSale(ctx, db.VoidProductSaleParams{
		Uuid: id, OrganizationID: orgID, VoidedBy: pgtype.Int8{Int64: actorID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SaleDetail{}, ErrConflict
		}
		return SaleDetail{}, err
	}

	lines, err := qtx.ListProductSaleLines(ctx, db.ListProductSaleLinesParams{
		SaleID: voided.ID, OrganizationID: orgID,
	})
	if err != nil {
		return SaleDetail{}, err
	}
	for _, line := range lines {
		prod, err := qtx.GetProductByID(ctx, db.GetProductByIDParams{
			ID: line.ProductID, OrganizationID: orgID,
		})
		if err != nil {
			return SaleDetail{}, err
		}
		if prod.TrackStock {
			if _, err := qtx.AdjustProductStock(ctx, db.AdjustProductStockParams{
				Uuid:           prod.Uuid,
				OrganizationID: orgID,
				Delta:          line.Qty,
			}); err != nil {
				return SaleDetail{}, err
			}
		}
	}

	var financeTxUUID, financeAccountUUID uuid.UUID
	if row.Method == "cash" || row.Method == "card" {
		ft, err := s.finance.VoidBySourceTx(ctx, qtx, actorID, financeusecase.SourceProductSale, voided.Uuid)
		if err != nil && !errors.Is(err, financeusecase.ErrNotFound) {
			return SaleDetail{}, err
		}
		if err == nil {
			financeTxUUID = ft.Uuid
			if row.FinanceAccountUuid.Valid {
				financeAccountUUID = uuid.UUID(row.FinanceAccountUuid.Bytes)
			}
		}
	} else {
		if _, err := s.cari.VoidBySourceTx(ctx, qtx, actorID, financeusecase.SourceProductSale, voided.Uuid); err != nil &&
			!errors.Is(err, cariusecase.ErrNotFound) {
			return SaleDetail{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return SaleDetail{}, err
	}
	if financeTxUUID != uuid.Nil {
		s.finance.NotifyIndexed(ctx, financeTxUUID, financeAccountUUID)
	}

	detail, err := s.Get(ctx, id)
	if err != nil {
		return SaleDetail{}, err
	}
	s.recordActivity(ctx, "tenant.sales.void", "sale", &id, nil)
	s.publish(ctx, events.SalesVoided, map[string]any{"uuid": id.String()})
	s.indexSale(ctx, id)
	return detail, nil
}
