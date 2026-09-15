package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
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
	pool   *pgxpool.Pool
	q      *db.Queries
	act    *activity.Recorder
	search SearchIndexer
	bus    events.Bus
}

func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder) *Service {
	return &Service{pool: pool, q: q, act: act}
}

func (s *Service) SetSearchIndexer(idx SearchIndexer) { s.search = idx }
func (s *Service) SetEventBus(bus events.Bus)         { s.bus = bus }

func (s *Service) ResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantSuppliers()
}

func (s *Service) requireOrgID(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, errors.New("organization context required")
	}
	return scope.InternalID, nil
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

func (s *Service) indexSupplier(ctx context.Context, id uuid.UUID) {
	if s.search == nil || id == uuid.Nil {
		return
	}
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return
	}
	s.search.EnqueueUpsert(ctx, "tenant_suppliers", scope.UUID.String()+"_"+id.String())
}

func (s *Service) deleteFromIndex(ctx context.Context, id uuid.UUID) {
	if s.search == nil || id == uuid.Nil {
		return
	}
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok {
		return
	}
	s.search.EnqueueDelete(ctx, "tenant_suppliers", scope.UUID.String()+"_"+id.String())
}

func mapSupplier(row db.Supplier) Supplier {
	return Supplier{
		UUID:      row.Uuid,
		Name:      row.Name,
		Phone:     row.Phone,
		Email:     row.Email,
		TaxID:     row.TaxID,
		Notes:     row.Notes,
		IsActive:  row.IsActive,
		CreatedAt: row.CreatedAt.Time,
		UpdatedAt: row.UpdatedAt.Time,
	}
}

func (s *Service) List(ctx context.Context, limit, offset int32, filters Filters) ([]Supplier, int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return nil, 0, err
	}
	sort := strings.TrimSpace(filters.Sort)
	if sort == "" {
		sort = "name"
	}
	switch sort {
	case "name", "-name", "created_at", "-created_at":
	default:
		return nil, 0, fmt.Errorf("%w: unsupported sort", ErrInvalidRequest)
	}
	params := db.ListSuppliersParams{
		OrganizationID: orgID,
		Sort:           sort,
		OffsetCount:    offset,
		LimitCount:     limit,
	}
	if filters.Q != "" {
		params.Q = pgtype.Text{String: filters.Q, Valid: true}
	}
	if filters.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *filters.IsActive, Valid: true}
	}
	rows, err := s.q.ListSuppliers(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountSuppliers(ctx, db.CountSuppliersParams{
		OrganizationID: orgID,
		IsActive:       params.IsActive,
		Q:              params.Q,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Supplier, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapSupplier(row))
	}
	return out, total, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Supplier, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Supplier{}, err
	}
	row, err := s.q.GetSupplierByUUID(ctx, db.GetSupplierByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Supplier{}, ErrNotFound
		}
		return Supplier{}, err
	}
	return mapSupplier(row), nil
}

func (s *Service) Create(ctx context.Context, in CreateInput) (Supplier, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Supplier{}, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Supplier{}, fmt.Errorf("%w: name is required", ErrInvalidRequest)
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	row, err := s.q.CreateSupplier(ctx, db.CreateSupplierParams{
		OrganizationID: orgID,
		Name:           name,
		Phone:          strings.TrimSpace(in.Phone),
		Email:          strings.TrimSpace(in.Email),
		TaxID:          strings.TrimSpace(in.TaxID),
		Notes:          strings.TrimSpace(in.Notes),
		IsActive:       active,
	})
	if err != nil {
		return Supplier{}, err
	}
	s.recordActivity(ctx, "tenant.supplier.create", "supplier", &row.Uuid, map[string]any{"name": row.Name})
	s.publish(ctx, events.SuppliersCreated, map[string]any{"uuid": row.Uuid.String()})
	s.indexSupplier(ctx, row.Uuid)
	return mapSupplier(row), nil
}

func (s *Service) Patch(ctx context.Context, id uuid.UUID, in PatchInput) (Supplier, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Supplier{}, err
	}
	params := db.UpdateSupplierParams{Uuid: id, OrganizationID: orgID}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return Supplier{}, fmt.Errorf("%w: name is required", ErrInvalidRequest)
		}
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	if in.Phone != nil {
		params.Phone = pgtype.Text{String: strings.TrimSpace(*in.Phone), Valid: true}
	}
	if in.Email != nil {
		params.Email = pgtype.Text{String: strings.TrimSpace(*in.Email), Valid: true}
	}
	if in.TaxID != nil {
		params.TaxID = pgtype.Text{String: strings.TrimSpace(*in.TaxID), Valid: true}
	}
	if in.Notes != nil {
		params.Notes = pgtype.Text{String: strings.TrimSpace(*in.Notes), Valid: true}
	}
	if in.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *in.IsActive, Valid: true}
	}
	row, err := s.q.UpdateSupplier(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Supplier{}, ErrNotFound
		}
		return Supplier{}, err
	}
	s.recordActivity(ctx, "tenant.supplier.update", "supplier", &row.Uuid, map[string]any{"name": row.Name})
	s.publish(ctx, events.SuppliersUpdated, map[string]any{"uuid": row.Uuid.String()})
	s.indexSupplier(ctx, row.Uuid)
	return mapSupplier(row), nil
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.GetSupplierByUUID(ctx, db.GetSupplierByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	count, err := s.q.CountPostedPurchasesBySupplier(ctx, db.CountPostedPurchasesBySupplierParams{
		SupplierID: row.ID, OrganizationID: orgID,
	})
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("%w: cannot delete supplier with posted purchases", ErrConflict)
	}
	if _, err := s.q.SoftDeleteSupplier(ctx, db.SoftDeleteSupplierParams{Uuid: id, OrganizationID: orgID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	s.recordActivity(ctx, "tenant.supplier.delete", "supplier", &id, map[string]any{"name": row.Name})
	s.publish(ctx, events.SuppliersDeleted, map[string]any{"uuid": id.String()})
	s.deleteFromIndex(ctx, id)
	return nil
}
