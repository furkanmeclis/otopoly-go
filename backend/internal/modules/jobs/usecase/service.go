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
	return resourcemeta.TenantJobs()
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

func (s *Service) indexJob(ctx context.Context, id uuid.UUID) {
	if s.search == nil || id == uuid.Nil {
		return
	}
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return
	}
	s.search.EnqueueUpsert(ctx, "tenant_jobs", scope.UUID.String()+"_"+id.String())
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
	row, err := s.q.SumServiceJobsDaily(ctx, db.SumServiceJobsDailyParams{
		OrganizationID: orgID,
		StartedAt:      pgtype.Timestamptz{Time: day, Valid: true},
		StartedAt_2:    pgtype.Timestamptz{Time: next, Valid: true},
	})
	if err != nil {
		return Summary{}, err
	}
	return Summary{
		JobCount:  row.JobCount,
		CardTotal: financeusecase.NumericToString(row.CardTotal),
		CariTotal: financeusecase.NumericToString(row.CariTotal),
		NetTotal:  financeusecase.NumericToString(row.NetTotal),
		PaidTotal: financeusecase.NumericToString(row.PaidTotal),
		Date:      day.Format("2006-01-02"),
	}, nil
}

func (s *Service) List(ctx context.Context, limit, offset int32, filters ListFilters) ([]Job, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	params := db.ListServiceJobsParams{
		OrganizationID: orgID,
		LimitCount:     limit,
		OffsetCount:    offset,
		Sort:           normalizeSort(filters.Sort),
	}
	countParams := db.CountServiceJobsParams{OrganizationID: orgID}
	if st := strings.TrimSpace(filters.Status); st != "" {
		params.Status = pgtype.Text{String: st, Valid: true}
		countParams.Status = params.Status
	}
	if q := strings.TrimSpace(filters.Q); q != "" {
		params.Q = pgtype.Text{String: q, Valid: true}
		countParams.Q = params.Q
	}
	if from, err := parseDay(filters.DateFrom); err == nil && filters.DateFrom != "" {
		params.DateFrom = pgtype.Timestamptz{Time: from, Valid: true}
		countParams.DateFrom = params.DateFrom
	}
	if to, err := parseDay(filters.DateTo); err == nil && filters.DateTo != "" {
		params.DateTo = pgtype.Timestamptz{Time: to.Add(24 * time.Hour), Valid: true}
		countParams.DateTo = params.DateTo
	}
	rows, err := s.q.ListServiceJobs(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountServiceJobs(ctx, countParams)
	if err != nil {
		return nil, 0, err
	}
	out := make([]Job, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapListJob(row))
	}
	return out, total, nil
}

func (s *Service) ListByCustomer(ctx context.Context, customerUUID uuid.UUID, limit, offset int32) ([]Job, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	customer, err := s.q.GetCustomerByUUID(ctx, db.GetCustomerByUUIDParams{
		Uuid: customerUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, 0, ErrNotFound
		}
		return nil, 0, err
	}
	rows, err := s.q.ListServiceJobsByCustomer(ctx, db.ListServiceJobsByCustomerParams{
		OrganizationID: orgID,
		CustomerID:     customer.ID,
		Limit:          limit,
		Offset:         offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountServiceJobsByCustomer(ctx, db.CountServiceJobsByCustomerParams{
		OrganizationID: orgID, CustomerID: customer.ID,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Job, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapCustomerJob(row))
	}
	return out, total, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	row, err := s.q.GetServiceJobByUUID(ctx, db.GetServiceJobByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrNotFound
		}
		return JobDetail{}, err
	}
	return s.loadDetail(ctx, orgID, row)
}

func (s *Service) Create(ctx context.Context, in CreateInput) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	if in.CustomerUUID == uuid.Nil || in.VehicleUUID == uuid.Nil {
		return JobDetail{}, fmt.Errorf("%w: customer_uuid and vehicle_uuid are required", ErrInvalidRequest)
	}
	if len(in.Lines) == 0 {
		return JobDetail{}, fmt.Errorf("%w: at least one service line is required", ErrInvalidRequest)
	}

	vehicle, err := s.q.GetCustomerVehicleDetailByUUID(ctx, db.GetCustomerVehicleDetailByUUIDParams{
		Uuid: in.VehicleUUID, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, fmt.Errorf("%w: vehicle not found", ErrNotFound)
		}
		return JobDetail{}, err
	}
	if vehicle.CustomerUuid != in.CustomerUUID {
		return JobDetail{}, fmt.Errorf("%w: vehicle does not belong to customer", ErrInvalidRequest)
	}

	currency := strings.ToUpper(strings.TrimSpace(in.Currency))
	if currency == "" {
		currency = "TRY"
	}

	type preparedLine struct {
		serviceID int64
		name      string
		unitPrice pgtype.Numeric
		qty       pgtype.Numeric
		vatRate   pgtype.Numeric
		lineTotal pgtype.Numeric
		currency  string
	}
	prepared := make([]preparedLine, 0, len(in.Lines))
	total := big.NewRat(0, 1)
	for i, line := range in.Lines {
		svc, err := s.q.GetServiceByUUID(ctx, db.GetServiceByUUIDParams{
			Uuid: line.ServiceUUID, OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return JobDetail{}, fmt.Errorf("%w: service not found", ErrNotFound)
			}
			return JobDetail{}, err
		}
		priceStr := financeusecase.NumericToString(svc.Price)
		if line.UnitPrice != nil && strings.TrimSpace(*line.UnitPrice) != "" {
			priceStr = strings.TrimSpace(*line.UnitPrice)
		}
		qtyStr := "1"
		if line.Qty != nil && strings.TrimSpace(*line.Qty) != "" {
			qtyStr = strings.TrimSpace(*line.Qty)
		}
		lineTotalStr, err := mulDecimalStrings(priceStr, qtyStr)
		if err != nil {
			return JobDetail{}, fmt.Errorf("%w: line %d: %v", ErrInvalidRequest, i+1, err)
		}
		unitPrice, err := numericNonNeg(priceStr)
		if err != nil {
			return JobDetail{}, fmt.Errorf("%w: line %d unit_price: %v", ErrInvalidRequest, i+1, err)
		}
		qty, err := numericPositive(qtyStr)
		if err != nil {
			return JobDetail{}, fmt.Errorf("%w: line %d qty: %v", ErrInvalidRequest, i+1, err)
		}
		lineTotal, err := numericNonNeg(lineTotalStr)
		if err != nil {
			return JobDetail{}, fmt.Errorf("%w: line %d total: %v", ErrInvalidRequest, i+1, err)
		}
		rat, ok := new(big.Rat).SetString(lineTotalStr)
		if !ok {
			return JobDetail{}, fmt.Errorf("%w: invalid line total", ErrInvalidRequest)
		}
		total.Add(total, rat)
		lineCurrency := currency
		if strings.TrimSpace(svc.Currency) != "" {
			lineCurrency = strings.ToUpper(svc.Currency)
		}
		prepared = append(prepared, preparedLine{
			serviceID: svc.ID,
			name:      svc.Name,
			unitPrice: unitPrice,
			qty:       qty,
			vatRate:   svc.VatRate,
			lineTotal: lineTotal,
			currency:  lineCurrency,
		})
	}
	totalAmount, err := numericNonNeg(total.FloatString(2))
	if err != nil {
		return JobDetail{}, fmt.Errorf("%w: total amount", ErrInvalidRequest)
	}

	startedAt := time.Now()
	if in.StartedAt != nil && strings.TrimSpace(*in.StartedAt) != "" {
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(*in.StartedAt))
		if err != nil {
			t2, err2 := time.Parse("2006-01-02T15:04", strings.TrimSpace(*in.StartedAt))
			if err2 != nil {
				return JobDetail{}, fmt.Errorf("%w: invalid started_at", ErrInvalidRequest)
			}
			t = t2
		}
		startedAt = t
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	var assignee pgtype.Int8
	if in.AssigneeUUID != nil && *in.AssigneeUUID != uuid.Nil {
		user, uerr := s.q.GetUserByUUID(ctx, *in.AssigneeUUID)
		if uerr != nil {
			return JobDetail{}, fmt.Errorf("%w: assignee not found", ErrInvalidRequest)
		}
		if _, merr := s.q.GetOrganizationMember(ctx, db.GetOrganizationMemberParams{
			OrganizationID: orgID, UserID: user.ID,
		}); merr != nil {
			return JobDetail{}, fmt.Errorf("%w: assignee is not a member", ErrInvalidRequest)
		}
		assignee = pgtype.Int8{Int64: user.ID, Valid: true}
	}

	job, err := qtx.CreateServiceJob(ctx, db.CreateServiceJobParams{
		OrganizationID: orgID,
		CustomerID:     vehicle.CustomerID,
		VehicleID:      vehicle.ID,
		CustomerName:   vehicle.CustomerName,
		CustomerPhone:  vehicle.CustomerPhone,
		Plate:          vehicle.Plate,
		VehicleLabel:   fmt.Sprintf("%s %s %d", vehicle.BrandName, vehicle.ModelName, vehicle.Year),
		Status:         "in_progress",
		Currency:       currency,
		Notes:          strings.TrimSpace(in.Notes),
		StartedAt:      pgtype.Timestamptz{Time: startedAt, Valid: true},
		TotalAmount:    totalAmount,
		CreatedBy:      actorID,
		AssigneeUserID: assignee,
	})
	if err != nil {
		return JobDetail{}, err
	}
	for i, pl := range prepared {
		if _, err := qtx.CreateServiceJobLine(ctx, db.CreateServiceJobLineParams{
			OrganizationID: orgID,
			JobID:          job.ID,
			LineType:       "service",
			ServiceID:      pgtype.Int8{Int64: pl.serviceID, Valid: true},
			Name:           pl.name,
			UnitPrice:      pl.unitPrice,
			Qty:            pl.qty,
			VatRate:        pl.vatRate,
			LineTotal:      pl.lineTotal,
			Currency:       pl.currency,
			SortOrder:      int32(i),
		}); err != nil {
			return JobDetail{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return JobDetail{}, err
	}

	s.recordActivity(ctx, "jobs.create", "jobs.job", &job.Uuid, map[string]any{
		"plate": job.Plate, "total": financeusecase.NumericToString(job.TotalAmount),
	})
	s.publish(ctx, events.JobsCreated, map[string]any{"job_uuid": job.Uuid.String()})
	s.indexJob(ctx, job.Uuid)

	detail, err := s.Get(ctx, job.Uuid)
	if err != nil {
		return JobDetail{}, err
	}
	return detail, nil
}

func (s *Service) Patch(ctx context.Context, id uuid.UUID, in PatchInput) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	if in.Notes == nil && in.AssigneeUUID == nil {
		return JobDetail{}, fmt.Errorf("%w: nothing to update", ErrInvalidRequest)
	}
	if in.Notes != nil {
		_, err := s.q.UpdateServiceJobNotes(ctx, db.UpdateServiceJobNotesParams{
			Uuid: id, OrganizationID: orgID, Notes: strings.TrimSpace(*in.Notes),
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return JobDetail{}, ErrConflict
			}
			return JobDetail{}, err
		}
	}
	if in.AssigneeUUID != nil {
		var assignee pgtype.Int8
		if *in.AssigneeUUID != uuid.Nil {
			user, uerr := s.q.GetUserByUUID(ctx, *in.AssigneeUUID)
			if uerr != nil {
				return JobDetail{}, fmt.Errorf("%w: assignee not found", ErrInvalidRequest)
			}
			if _, merr := s.q.GetOrganizationMember(ctx, db.GetOrganizationMemberParams{
				OrganizationID: orgID, UserID: user.ID,
			}); merr != nil {
				return JobDetail{}, fmt.Errorf("%w: assignee is not a member", ErrInvalidRequest)
			}
			assignee = pgtype.Int8{Int64: user.ID, Valid: true}
		}
		if _, err := s.q.UpdateServiceJobAssignee(ctx, db.UpdateServiceJobAssigneeParams{
			Uuid: id, OrganizationID: orgID, AssigneeUserID: assignee,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return JobDetail{}, ErrConflict
			}
			return JobDetail{}, err
		}
	}
	s.recordActivity(ctx, "jobs.update", "jobs.job", &id, nil)
	s.indexJob(ctx, id)
	return s.Get(ctx, id)
}

func (s *Service) MarkDone(ctx context.Context, id uuid.UUID) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	row, err := s.q.MarkServiceJobDone(ctx, db.MarkServiceJobDoneParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrConflict
		}
		return JobDetail{}, err
	}
	s.recordActivity(ctx, "jobs.update", "jobs.job", &row.Uuid, map[string]any{"status": "ready"})
	s.publish(ctx, events.JobsReady, map[string]any{"job_uuid": row.Uuid.String()})
	s.indexJob(ctx, row.Uuid)
	return s.Get(ctx, row.Uuid)
}

func (s *Service) MarkDelivered(ctx context.Context, id uuid.UUID) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	row, err := s.q.MarkServiceJobDelivered(ctx, db.MarkServiceJobDeliveredParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrConflict
		}
		return JobDetail{}, err
	}
	s.recordActivity(ctx, "jobs.update", "jobs.job", &row.Uuid, map[string]any{"status": "delivered"})
	s.publish(ctx, events.JobsDelivered, map[string]any{"job_uuid": row.Uuid.String()})
	s.indexJob(ctx, row.Uuid)
	return s.Get(ctx, row.Uuid)
}

func (s *Service) Cancel(ctx context.Context, id uuid.UUID) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	row, err := s.q.MarkServiceJobCancelled(ctx, db.MarkServiceJobCancelledParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrConflict
		}
		return JobDetail{}, err
	}
	s.recordActivity(ctx, "jobs.cancel", "jobs.job", &row.Uuid, nil)
	s.publish(ctx, events.JobsCancelled, map[string]any{"job_uuid": row.Uuid.String()})
	s.indexJob(ctx, row.Uuid)
	return s.Get(ctx, row.Uuid)
}

func (s *Service) Close(ctx context.Context, id uuid.UUID, in CloseInput) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	method := strings.TrimSpace(in.Method)
	if method != "cash" && method != "card" && method != "cari" {
		return JobDetail{}, fmt.Errorf("%w: method must be cash, card, or cari", ErrInvalidRequest)
	}

	job, err := s.q.GetServiceJobByUUID(ctx, db.GetServiceJobByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrNotFound
		}
		return JobDetail{}, err
	}
	if job.PaymentStatus == "paid" {
		return JobDetail{}, fmt.Errorf("%w: job already paid", ErrConflict)
	}
	if job.Status != "in_progress" && job.Status != "ready" && job.Status != "delivered" {
		return JobDetail{}, fmt.Errorf("%w: job cannot be closed", ErrConflict)
	}
	if !job.TotalAmount.Valid || job.TotalAmount.Int == nil || job.TotalAmount.Int.Sign() <= 0 {
		return JobDetail{}, fmt.Errorf("%w: job total must be positive", ErrInvalidRequest)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	paid, err := qtx.MarkServiceJobPaid(ctx, db.MarkServiceJobPaidParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrConflict
		}
		return JobDetail{}, err
	}

	var financeAccountID pgtype.Int8
	var financeAccountUUID uuid.UUID
	if method == "cash" || method == "card" {
		if in.FinanceAccountUUID == nil || *in.FinanceAccountUUID == uuid.Nil {
			return JobDetail{}, fmt.Errorf("%w: finance_account_uuid is required", ErrInvalidRequest)
		}
		fa, err := qtx.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{
			Uuid: *in.FinanceAccountUUID, OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return JobDetail{}, fmt.Errorf("%w: finance account not found", ErrNotFound)
			}
			return JobDetail{}, err
		}
		if !strings.EqualFold(fa.Currency, paid.Currency) {
			return JobDetail{}, fmt.Errorf("%w: finance account currency must match job currency", ErrInvalidRequest)
		}
		financeAccountID = pgtype.Int8{Int64: fa.ID, Valid: true}
		financeAccountUUID = fa.Uuid
	}

	payment, err := qtx.CreateServiceJobPayment(ctx, db.CreateServiceJobPaymentParams{
		OrganizationID:       orgID,
		JobID:                paid.ID,
		Method:               method,
		Amount:               paid.TotalAmount,
		Currency:             paid.Currency,
		Status:               "posted",
		FinanceAccountID:     financeAccountID,
		FinanceTransactionID: pgtype.Int8{},
		CariEntryID:          pgtype.Int8{},
		CreatedBy:            actorID,
	})
	if err != nil {
		return JobDetail{}, err
	}

	entryDate := pgtype.Date{Time: time.Now(), Valid: true}
	desc := fmt.Sprintf("İş emri — %s (%s)", paid.Plate, paid.CustomerName)
	meta, _ := json.Marshal(map[string]any{"module": "jobs", "job_uuid": paid.Uuid.String()})

	var financeTxUUID uuid.UUID
	if method == "cash" || method == "card" {
		categoryID, err := s.finance.ResolveCategoryIDByName(ctx, qtx, financeusecase.CategoryServiceIncome, "income")
		if err != nil {
			return JobDetail{}, err
		}
		pm := method
		ft, err := s.finance.PostIncomeFromSourceTx(ctx, qtx, actorID, financeusecase.PostFromSourceInput{
			AccountID:       financeAccountID.Int64,
			CategoryID:      categoryID,
			Amount:          paid.TotalAmount,
			Currency:        paid.Currency,
			TransactionDate: entryDate,
			Description:     desc,
			PaymentMethod:   pm,
			SourceType:      financeusecase.SourceServiceJob,
			SourceUUID:      payment.Uuid,
			Metadata:        meta,
		})
		if err != nil {
			return JobDetail{}, err
		}
		financeTxUUID = ft.Uuid
		if _, err := qtx.LinkServiceJobPaymentFinance(ctx, db.LinkServiceJobPaymentFinanceParams{
			ID:                   payment.ID,
			OrganizationID:       orgID,
			FinanceTransactionID: pgtype.Int8{Int64: ft.ID, Valid: true},
			FinanceAccountID:     financeAccountID,
		}); err != nil {
			return JobDetail{}, err
		}
	} else {
		ce, err := s.cari.ChargeFromSourceTx(ctx, qtx, actorID, cariusecase.ChargeFromSourceInput{
			CustomerID:  paid.CustomerID,
			Amount:      paid.TotalAmount,
			Currency:    paid.Currency,
			EntryDate:   entryDate,
			Description: desc,
			SourceType:  financeusecase.SourceServiceJob,
			SourceUUID:  payment.Uuid,
			Metadata:    meta,
		})
		if err != nil {
			return JobDetail{}, err
		}
		if _, err := qtx.LinkServiceJobPaymentCari(ctx, db.LinkServiceJobPaymentCariParams{
			ID: payment.ID, OrganizationID: orgID, CariEntryID: pgtype.Int8{Int64: ce.ID, Valid: true},
		}); err != nil {
			return JobDetail{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return JobDetail{}, err
	}

	if financeTxUUID != uuid.Nil {
		s.finance.NotifyIndexed(ctx, financeTxUUID, financeAccountUUID)
	}
	s.recordActivity(ctx, "jobs.close", "jobs.job", &paid.Uuid, map[string]any{
		"method": method, "amount": financeusecase.NumericToString(paid.TotalAmount),
	})
	s.publish(ctx, events.JobsClosed, map[string]any{"job_uuid": paid.Uuid.String(), "method": method})
	s.indexJob(ctx, paid.Uuid)

	return s.Get(ctx, paid.Uuid)
}

func (s *Service) Void(ctx context.Context, id uuid.UUID) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	job, err := s.q.GetServiceJobByUUID(ctx, db.GetServiceJobByUUIDParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrNotFound
		}
		return JobDetail{}, err
	}
	if job.PaymentStatus != "paid" {
		return JobDetail{}, fmt.Errorf("%w: only paid jobs can be voided", ErrConflict)
	}

	payments, err := s.q.ListServiceJobPayments(ctx, db.ListServiceJobPaymentsParams{
		JobID: job.ID, OrganizationID: orgID,
	})
	if err != nil {
		return JobDetail{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	voidedJob, err := qtx.MarkServiceJobVoided(ctx, db.MarkServiceJobVoidedParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrConflict
		}
		return JobDetail{}, err
	}

	var financeNotify [][2]uuid.UUID
	for _, p := range payments {
		if p.Status != "posted" {
			continue
		}
		if _, err := qtx.VoidServiceJobPayment(ctx, db.VoidServiceJobPaymentParams{
			Uuid: p.Uuid, OrganizationID: orgID, VoidedBy: pgtype.Int8{Int64: actorID, Valid: true},
		}); err != nil {
			return JobDetail{}, err
		}
		switch p.Method {
		case "cash", "card":
			ft, err := s.finance.VoidBySourceTx(ctx, qtx, actorID, financeusecase.SourceServiceJob, p.Uuid)
			if err != nil && !errors.Is(err, financeusecase.ErrNotFound) {
				return JobDetail{}, err
			}
			if err == nil {
				accUUID := uuid.Nil
				if p.FinanceAccountUuid.Valid {
					accUUID = uuid.UUID(p.FinanceAccountUuid.Bytes)
				}
				financeNotify = append(financeNotify, [2]uuid.UUID{ft.Uuid, accUUID})
			}
		case "cari":
			if _, err := s.cari.VoidBySourceTx(ctx, qtx, actorID, financeusecase.SourceServiceJob, p.Uuid); err != nil &&
				!errors.Is(err, cariusecase.ErrNotFound) {
				return JobDetail{}, err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return JobDetail{}, err
	}
	for _, pair := range financeNotify {
		s.finance.NotifyIndexed(ctx, pair[0], pair[1])
	}
	s.recordActivity(ctx, "jobs.void", "jobs.job", &voidedJob.Uuid, nil)
	s.publish(ctx, events.JobsVoided, map[string]any{"job_uuid": voidedJob.Uuid.String()})
	s.indexJob(ctx, voidedJob.Uuid)
	return s.Get(ctx, voidedJob.Uuid)
}

func (s *Service) loadDetail(ctx context.Context, orgID int64, row db.GetServiceJobByUUIDRow) (JobDetail, error) {
	lines, err := s.q.ListServiceJobLines(ctx, db.ListServiceJobLinesParams{
		JobID: row.ID, OrganizationID: orgID,
	})
	if err != nil {
		return JobDetail{}, err
	}
	payments, err := s.q.ListServiceJobPayments(ctx, db.ListServiceJobPaymentsParams{
		JobID: row.ID, OrganizationID: orgID,
	})
	if err != nil {
		return JobDetail{}, err
	}
	detail := JobDetail{Job: mapGetJob(row)}
	for _, line := range lines {
		detail.Lines = append(detail.Lines, mapLine(line))
	}
	for _, p := range payments {
		detail.Payments = append(detail.Payments, mapPayment(p))
	}
	if detail.Lines == nil {
		detail.Lines = []Line{}
	}
	if detail.Payments == nil {
		detail.Payments = []Payment{}
	}
	return detail, nil
}
