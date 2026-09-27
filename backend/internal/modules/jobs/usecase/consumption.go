package usecase

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Consumption is a product used on a job (from a service recipe or added by
// staff). Tracked products are taken out of stock while the job is active.
type Consumption struct {
	UUID        uuid.UUID `json:"uuid"`
	ProductUUID uuid.UUID `json:"product_uuid"`
	Name        string    `json:"name"`
	Unit        string    `json:"unit"`
	Qty         string    `json:"qty"`
	UnitCost    string    `json:"unit_cost"`
	TotalCost   string    `json:"total_cost"`
	// ServiceName is the recipe the row came from ("" = added by hand).
	ServiceName  string `json:"service_name,omitempty"`
	StockApplied bool   `json:"stock_applied"`
	Reverted     bool   `json:"reverted"`
}

// ConsumptionInput adds or changes a product on a job.
type ConsumptionInput struct {
	ProductUUID uuid.UUID `json:"product_uuid"`
	Qty         string    `json:"qty"`
}

// recipeLine is a job service line for recipe expansion.
type recipeLine struct {
	serviceID int64
	qty       pgtype.Numeric
}

func ratOf(n pgtype.Numeric) *big.Rat {
	r, ok := new(big.Rat).SetString(financeusecase.NumericToString(n))
	if !ok {
		return new(big.Rat)
	}
	return r
}

// qtyString renders a quantity without trailing zeros ("1.5", "2").
func qtyString(n pgtype.Numeric) string {
	out := ratOf(n).FloatString(3)
	out = strings.TrimRight(strings.TrimRight(out, "0"), ".")
	if out == "" || out == "-" {
		return "0"
	}
	return out
}

func numericOfRat(r *big.Rat, prec int) pgtype.Numeric {
	var n pgtype.Numeric
	_ = n.Scan(r.FloatString(prec))
	return n
}

// applyRecipes records the products the job's services use and takes the
// tracked ones out of stock (qty = recipe qty × line qty, merged per product).
func (s *Service) applyRecipes(ctx context.Context, qtx *db.Queries, orgID, jobID, actorID int64, lines []recipeLine) error {
	if len(lines) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(lines))
	lineQty := map[int64]*big.Rat{}
	for _, l := range lines {
		if _, ok := lineQty[l.serviceID]; !ok {
			ids = append(ids, l.serviceID)
			lineQty[l.serviceID] = new(big.Rat)
		}
		lineQty[l.serviceID].Add(lineQty[l.serviceID], ratOf(l.qty))
	}
	recipes, err := qtx.ListRecipesForServices(ctx, db.ListRecipesForServicesParams{OrganizationID: orgID, ServiceIds: ids})
	if err != nil || len(recipes) == 0 {
		return err
	}
	type agg struct {
		row       db.ListRecipesForServicesRow
		qty       *big.Rat
		serviceID int64
		mixed     bool
	}
	byProduct := map[int64]*agg{}
	var order []int64
	for _, r := range recipes {
		q := new(big.Rat).Mul(ratOf(r.Qty), lineQty[r.ServiceID])
		if a, ok := byProduct[r.ProductID]; ok {
			a.qty.Add(a.qty, q)
			if a.serviceID != r.ServiceID {
				a.mixed = true
			}
			continue
		}
		byProduct[r.ProductID] = &agg{row: r, qty: q, serviceID: r.ServiceID}
		order = append(order, r.ProductID)
	}
	for _, pid := range order {
		a := byProduct[pid]
		if a.qty.Sign() <= 0 {
			continue
		}
		svc := pgtype.Int8{Int64: a.serviceID, Valid: !a.mixed}
		if err := s.addConsumptionTx(ctx, qtx, orgID, jobID, actorID, pid, a.row.Name, a.row.Unit, a.row.CostPrice, a.row.TrackStock, a.qty, svc); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) addConsumptionTx(
	ctx context.Context, qtx *db.Queries, orgID, jobID, actorID, productID int64,
	name, unit string, cost pgtype.Numeric, track bool, qty *big.Rat, serviceID pgtype.Int8,
) error {
	if _, err := qtx.CreateJobConsumption(ctx, db.CreateJobConsumptionParams{
		OrganizationID: orgID, JobID: jobID, ProductID: productID, ServiceID: serviceID,
		Name: name, Unit: unit, Qty: numericOfRat(qty, 3), UnitCost: cost, StockApplied: track,
		CreatedBy: pgtype.Int8{Int64: actorID, Valid: actorID > 0},
	}); err != nil {
		return err
	}
	if track {
		return qtx.AdjustProductStockByID(ctx, db.AdjustProductStockByIDParams{
			ID: productID, OrganizationID: orgID, Delta: numericOfRat(new(big.Rat).Neg(qty), 3),
		})
	}
	return nil
}

// revertConsumptions gives the job's products back to stock (cancel / void).
func (s *Service) revertConsumptions(ctx context.Context, qtx *db.Queries, orgID, jobID int64) error {
	rows, err := qtx.RevertJobConsumptions(ctx, db.RevertJobConsumptionsParams{OrganizationID: orgID, JobID: jobID})
	if err != nil {
		return err
	}
	for _, r := range rows {
		if !r.StockApplied {
			continue
		}
		if err := qtx.AdjustProductStockByID(ctx, db.AdjustProductStockByIDParams{
			ID: r.ProductID, OrganizationID: orgID, Delta: r.Qty,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) listConsumptions(ctx context.Context, orgID, jobID int64) ([]Consumption, string, error) {
	rows, err := s.q.ListJobConsumptions(ctx, db.ListJobConsumptionsParams{OrganizationID: orgID, JobID: jobID})
	if err != nil {
		return nil, "", err
	}
	out := make([]Consumption, 0, len(rows))
	total := new(big.Rat)
	for _, r := range rows {
		line := new(big.Rat).Mul(ratOf(r.Qty), ratOf(r.UnitCost))
		if !r.RevertedAt.Valid {
			total.Add(total, line)
		}
		c := Consumption{
			UUID: r.Uuid, ProductUUID: r.ProductUuid, Name: r.Name, Unit: r.Unit,
			Qty: qtyString(r.Qty), UnitCost: financeusecase.NumericToString(r.UnitCost),
			TotalCost: line.FloatString(2), StockApplied: r.StockApplied, Reverted: r.RevertedAt.Valid,
		}
		if r.ServiceName.Valid {
			c.ServiceName = r.ServiceName.String
		}
		out = append(out, c)
	}
	return out, total.FloatString(2), nil
}

// editableJob loads the job for consumption changes (not cancelled / voided).
func (s *Service) editableJob(ctx context.Context, qtx *db.Queries, orgID int64, jobUUID uuid.UUID) (db.GetServiceJobByUUIDRow, error) {
	job, err := qtx.GetServiceJobByUUID(ctx, db.GetServiceJobByUUIDParams{Uuid: jobUUID, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return job, ErrNotFound
		}
		return job, err
	}
	if job.Status == "cancelled" || job.Status == "voided" {
		return job, fmt.Errorf("%w: products cannot be changed on a cancelled job", ErrConflict)
	}
	return job, nil
}

func parseConsumptionQty(raw string) (*big.Rat, error) {
	q, ok := new(big.Rat).SetString(strings.TrimSpace(strings.ReplaceAll(raw, ",", ".")))
	if !ok || q.Sign() <= 0 {
		return nil, fmt.Errorf("%w: qty must be positive", ErrInvalidRequest)
	}
	return q, nil
}

// AddConsumption adds a product to the job (merged into an existing row of
// the same product) and takes it out of stock when tracked.
func (s *Service) AddConsumption(ctx context.Context, jobUUID uuid.UUID, in ConsumptionInput) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	qty, err := parseConsumptionQty(in.Qty)
	if err != nil {
		return JobDetail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	job, err := s.editableJob(ctx, qtx, orgID, jobUUID)
	if err != nil {
		return JobDetail{}, err
	}
	product, err := qtx.GetProductByUUID(ctx, db.GetProductByUUIDParams{Uuid: in.ProductUUID, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, fmt.Errorf("%w: product not found", ErrNotFound)
		}
		return JobDetail{}, err
	}
	existing, err := qtx.GetActiveJobConsumptionByProduct(ctx, db.GetActiveJobConsumptionByProductParams{
		OrganizationID: orgID, JobID: job.ID, ProductID: product.ID,
	})
	switch {
	case err == nil:
		newQty := new(big.Rat).Add(ratOf(existing.Qty), qty)
		if _, err := qtx.UpdateJobConsumptionQty(ctx, db.UpdateJobConsumptionQtyParams{
			ID: existing.ID, OrganizationID: orgID, Qty: numericOfRat(newQty, 3),
		}); err != nil {
			return JobDetail{}, err
		}
		if existing.StockApplied {
			if err := qtx.AdjustProductStockByID(ctx, db.AdjustProductStockByIDParams{
				ID: product.ID, OrganizationID: orgID, Delta: numericOfRat(new(big.Rat).Neg(qty), 3),
			}); err != nil {
				return JobDetail{}, err
			}
		}
	case errors.Is(err, pgx.ErrNoRows):
		if err := s.addConsumptionTx(ctx, qtx, orgID, job.ID, actorID, product.ID, product.Name, product.Unit,
			product.CostPrice, product.TrackStock, qty, pgtype.Int8{}); err != nil {
			return JobDetail{}, err
		}
	default:
		return JobDetail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return JobDetail{}, err
	}
	s.recordActivity(ctx, "jobs.consumption.add", "jobs.job", &job.Uuid, map[string]any{"product": product.Name, "qty": qty.FloatString(3)})
	return s.Get(ctx, jobUUID)
}

// UpdateConsumption changes a product's quantity; stock follows the difference.
func (s *Service) UpdateConsumption(ctx context.Context, jobUUID, id uuid.UUID, in ConsumptionInput) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	qty, err := parseConsumptionQty(in.Qty)
	if err != nil {
		return JobDetail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	job, err := s.editableJob(ctx, qtx, orgID, jobUUID)
	if err != nil {
		return JobDetail{}, err
	}
	row, err := qtx.GetJobConsumptionForUpdate(ctx, db.GetJobConsumptionForUpdateParams{OrganizationID: orgID, JobID: job.ID, Uuid: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrNotFound
		}
		return JobDetail{}, err
	}
	if row.RevertedAt.Valid {
		return JobDetail{}, fmt.Errorf("%w: this product was already given back", ErrConflict)
	}
	if _, err := qtx.UpdateJobConsumptionQty(ctx, db.UpdateJobConsumptionQtyParams{ID: row.ID, OrganizationID: orgID, Qty: numericOfRat(qty, 3)}); err != nil {
		return JobDetail{}, err
	}
	if row.StockApplied {
		// Using more takes more out of stock.
		delta := new(big.Rat).Sub(ratOf(row.Qty), qty)
		if delta.Sign() != 0 {
			if err := qtx.AdjustProductStockByID(ctx, db.AdjustProductStockByIDParams{ID: row.ProductID, OrganizationID: orgID, Delta: numericOfRat(delta, 3)}); err != nil {
				return JobDetail{}, err
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return JobDetail{}, err
	}
	s.recordActivity(ctx, "jobs.consumption.update", "jobs.job", &job.Uuid, map[string]any{"product": row.Name, "qty": qty.FloatString(3)})
	return s.Get(ctx, jobUUID)
}

// DeleteConsumption removes a product from the job and returns it to stock.
func (s *Service) DeleteConsumption(ctx context.Context, jobUUID, id uuid.UUID) (JobDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return JobDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	job, err := s.editableJob(ctx, qtx, orgID, jobUUID)
	if err != nil {
		return JobDetail{}, err
	}
	row, err := qtx.GetJobConsumptionForUpdate(ctx, db.GetJobConsumptionForUpdateParams{OrganizationID: orgID, JobID: job.ID, Uuid: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrNotFound
		}
		return JobDetail{}, err
	}
	if err := qtx.DeleteJobConsumption(ctx, db.DeleteJobConsumptionParams{ID: row.ID, OrganizationID: orgID}); err != nil {
		return JobDetail{}, err
	}
	if row.StockApplied && !row.RevertedAt.Valid {
		if err := qtx.AdjustProductStockByID(ctx, db.AdjustProductStockByIDParams{ID: row.ProductID, OrganizationID: orgID, Delta: row.Qty}); err != nil {
			return JobDetail{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return JobDetail{}, err
	}
	s.recordActivity(ctx, "jobs.consumption.delete", "jobs.job", &job.Uuid, map[string]any{"product": row.Name})
	return s.Get(ctx, jobUUID)
}
