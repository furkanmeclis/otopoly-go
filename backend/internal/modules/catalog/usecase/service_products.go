package usecase

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ServiceProduct is one product a service uses (recipe line). Each job line
// of the service takes qty × line qty of it out of stock.
type ServiceProduct struct {
	ProductUUID   uuid.UUID `json:"product_uuid"`
	Name          string    `json:"name"`
	Unit          string    `json:"unit"`
	Qty           string    `json:"qty"`
	CostPrice     string    `json:"cost_price"`
	TrackStock    bool      `json:"track_stock"`
	StockQuantity string    `json:"stock_quantity"`
	IsActive      bool      `json:"is_active"`
}

// ServiceProductInput replaces a service's recipe.
type ServiceProductInput struct {
	ProductUUID uuid.UUID `json:"product_uuid"`
	Qty         string    `json:"qty"`
}

func (s *Service) serviceID(ctx context.Context, orgID int64, id uuid.UUID) (int64, error) {
	row, err := s.q.GetServiceByUUID(ctx, db.GetServiceByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return row.ID, nil
}

// ListServiceProducts returns the products a service uses.
func (s *Service) ListServiceProducts(ctx context.Context, id uuid.UUID) ([]ServiceProduct, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, err
	}
	sid, err := s.serviceID(ctx, orgID, id)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListServiceProducts(ctx, db.ListServiceProductsParams{OrganizationID: orgID, ServiceID: sid})
	if err != nil {
		return nil, err
	}
	out := make([]ServiceProduct, 0, len(rows))
	for _, r := range rows {
		out = append(out, ServiceProduct{
			ProductUUID: r.ProductUuid, Name: r.Name, Unit: r.Unit, Qty: numericToString(r.Qty),
			CostPrice: numericToString(r.CostPrice), TrackStock: r.TrackStock,
			StockQuantity: numericToString(r.StockQuantity), IsActive: r.IsActive,
		})
	}
	return out, nil
}

// SetServiceProducts replaces the recipe (duplicate products are merged).
func (s *Service) SetServiceProducts(ctx context.Context, id uuid.UUID, items []ServiceProductInput) ([]ServiceProduct, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, err
	}
	if len(items) > 50 {
		return nil, fmt.Errorf("%w: at most 50 products per service", ErrInvalidRequest)
	}
	sid, err := s.serviceID(ctx, orgID, id)
	if err != nil {
		return nil, err
	}
	type line struct {
		productID int64
		qty       *big.Rat
	}
	var lines []*line
	byProduct := map[int64]*line{}
	for i, it := range items {
		q, ok := new(big.Rat).SetString(strings.TrimSpace(strings.ReplaceAll(it.Qty, ",", ".")))
		if !ok || q.Sign() <= 0 {
			return nil, fmt.Errorf("%w: line %d qty must be positive", ErrInvalidRequest, i+1)
		}
		p, err := s.q.GetProductByUUID(ctx, db.GetProductByUUIDParams{Uuid: it.ProductUUID, OrganizationID: orgID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("%w: line %d product not found", ErrInvalidRequest, i+1)
			}
			return nil, err
		}
		if l, ok := byProduct[p.ID]; ok {
			l.qty.Add(l.qty, q)
			continue
		}
		l := &line{productID: p.ID, qty: q}
		byProduct[p.ID] = l
		lines = append(lines, l)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	if err := qtx.DeleteServiceProducts(ctx, db.DeleteServiceProductsParams{OrganizationID: orgID, ServiceID: sid}); err != nil {
		return nil, err
	}
	for i, l := range lines {
		var qty pgtype.Numeric
		_ = qty.Scan(l.qty.FloatString(3))
		if err := qtx.InsertServiceProduct(ctx, db.InsertServiceProductParams{
			OrganizationID: orgID, ServiceID: sid, ProductID: l.productID, Qty: qty, SortOrder: int32(i),
		}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.recordActivity(ctx, "tenant.catalog.service.products", "service", &id, map[string]any{"count": len(lines)})
	return s.ListServiceProducts(ctx, id)
}
