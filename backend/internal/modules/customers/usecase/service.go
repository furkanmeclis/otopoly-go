package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
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

type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
	act  *activity.Recorder
}

func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder) *Service {
	return &Service{pool: pool, q: q, act: act}
}

func (s *Service) ResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.TenantCustomers()
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

func brandLogoURL(brandUUID uuid.UUID, key pgtype.Text) *string {
	if !key.Valid || strings.TrimSpace(key.String) == "" {
		return nil
	}
	u := fmt.Sprintf("/v1/public/vehicle-brands/logo/%s", brandUUID.String())
	return &u
}

func normalizePlate(raw string) (string, error) {
	var b strings.Builder
	for _, r := range strings.TrimSpace(raw) {
		if unicode.IsSpace(r) || r == '-' {
			continue
		}
		b.WriteRune(unicode.ToUpper(r))
	}
	plate := b.String()
	if plate == "" {
		return "", fmt.Errorf("%w: plate is required", ErrInvalidRequest)
	}
	if len(plate) > 16 {
		return "", fmt.Errorf("%w: plate is too long", ErrInvalidRequest)
	}
	return plate, nil
}

func normalizeKind(kind string) (string, error) {
	kind = strings.TrimSpace(kind)
	if kind == "" {
		return "individual", nil
	}
	if kind != "individual" && kind != "company" {
		return "", fmt.Errorf("%w: kind must be individual or company", ErrInvalidRequest)
	}
	return kind, nil
}

func (s *Service) List(ctx context.Context, limit, offset int32, filters Filters) ([]Customer, int64, error) {
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
	params := db.ListCustomersParams{
		OrganizationID: orgID,
		Sort:           sort,
		OffsetCount:    offset,
		LimitCount:     limit,
	}
	if filters.Q != "" {
		params.Q = pgtype.Text{String: filters.Q, Valid: true}
	}
	if filters.Kind != "" {
		params.Kind = pgtype.Text{String: filters.Kind, Valid: true}
	}
	if filters.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *filters.IsActive, Valid: true}
	}
	rows, err := s.q.ListCustomers(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountCustomers(ctx, db.CountCustomersParams{
		OrganizationID: orgID,
		Kind:           params.Kind,
		IsActive:       params.IsActive,
		Q:              params.Q,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Customer, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapCustomer(row.Uuid, row.Name, row.Phone, row.Email, row.Kind, row.Notes, row.IsActive, row.VehicleCount, row.CreatedAt, row.UpdatedAt))
	}
	return out, total, nil
}

func mapCustomer(id uuid.UUID, name, phone, email, kind, notes string, active bool, vehicles int64, created, updated pgtype.Timestamptz) Customer {
	return Customer{
		UUID: id, Name: name, Phone: phone, Email: email, Kind: kind, Notes: notes,
		IsActive: active, VehicleCount: vehicles,
		CreatedAt: created.Time, UpdatedAt: updated.Time,
	}
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (CustomerDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return CustomerDetail{}, err
	}
	row, err := s.q.GetCustomerByUUID(ctx, db.GetCustomerByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if err == pgx.ErrNoRows {
			return CustomerDetail{}, ErrNotFound
		}
		return CustomerDetail{}, err
	}
	vehicles, err := s.listVehicles(ctx, row.ID, orgID)
	if err != nil {
		return CustomerDetail{}, err
	}
	return CustomerDetail{
		Customer: mapCustomer(row.Uuid, row.Name, row.Phone, row.Email, row.Kind, row.Notes, row.IsActive, int64(len(vehicles)), row.CreatedAt, row.UpdatedAt),
		Vehicles: vehicles,
	}, nil
}

func (s *Service) listVehicles(ctx context.Context, customerID, orgID int64) ([]Vehicle, error) {
	rows, err := s.q.ListCustomerVehicles(ctx, db.ListCustomerVehiclesParams{
		CustomerID: customerID, OrganizationID: orgID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]Vehicle, 0, len(rows))
	for _, row := range rows {
		out = append(out, Vehicle{
			UUID:      row.Uuid,
			Plate:     row.Plate,
			BrandUUID: row.BrandUuid,
			BrandName: row.BrandName,
			LogoURL:   brandLogoURL(row.BrandUuid, row.LogoObjectKey),
			ModelUUID: row.ModelUuid,
			ModelName: row.ModelName,
			Year:      int(row.Year),
			CreatedAt: row.CreatedAt.Time,
		})
	}
	return out, nil
}

func (s *Service) Create(ctx context.Context, in CreateInput) (CustomerDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return CustomerDetail{}, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return CustomerDetail{}, fmt.Errorf("%w: name is required", ErrInvalidRequest)
	}
	kind, err := normalizeKind(in.Kind)
	if err != nil {
		return CustomerDetail{}, err
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	row, err := q.CreateCustomer(ctx, db.CreateCustomerParams{
		OrganizationID: orgID,
		Name:           name,
		Phone:          strings.TrimSpace(in.Phone),
		Email:          strings.TrimSpace(in.Email),
		Kind:           kind,
		Notes:          strings.TrimSpace(in.Notes),
		IsActive:       active,
	})
	if err != nil {
		return CustomerDetail{}, err
	}
	if in.Vehicle != nil {
		if err := s.insertVehicle(ctx, q, orgID, row.ID, *in.Vehicle); err != nil {
			return CustomerDetail{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return CustomerDetail{}, err
	}
	s.recordActivity(ctx, "tenant.customer.create", "customer", &row.Uuid, map[string]any{"name": row.Name})
	return s.Get(ctx, row.Uuid)
}

func (s *Service) Patch(ctx context.Context, id uuid.UUID, in PatchInput) (CustomerDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return CustomerDetail{}, err
	}
	params := db.UpdateCustomerParams{Uuid: id, OrganizationID: orgID}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return CustomerDetail{}, fmt.Errorf("%w: name is required", ErrInvalidRequest)
		}
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	if in.Phone != nil {
		params.Phone = pgtype.Text{String: strings.TrimSpace(*in.Phone), Valid: true}
	}
	if in.Email != nil {
		params.Email = pgtype.Text{String: strings.TrimSpace(*in.Email), Valid: true}
	}
	if in.Kind != nil {
		kind, err := normalizeKind(*in.Kind)
		if err != nil {
			return CustomerDetail{}, err
		}
		params.Kind = pgtype.Text{String: kind, Valid: true}
	}
	if in.Notes != nil {
		params.Notes = pgtype.Text{String: strings.TrimSpace(*in.Notes), Valid: true}
	}
	if in.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *in.IsActive, Valid: true}
	}
	row, err := s.q.UpdateCustomer(ctx, params)
	if err != nil {
		if err == pgx.ErrNoRows {
			return CustomerDetail{}, ErrNotFound
		}
		return CustomerDetail{}, err
	}
	s.recordActivity(ctx, "tenant.customer.update", "customer", &row.Uuid, map[string]any{"name": row.Name})
	return s.Get(ctx, row.Uuid)
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.GetCustomerByUUID(ctx, db.GetCustomerByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	if err := s.q.SoftDeleteCustomerVehiclesByCustomer(ctx, db.SoftDeleteCustomerVehiclesByCustomerParams{
		CustomerID: row.ID, OrganizationID: orgID,
	}); err != nil {
		return err
	}
	if _, err := s.q.SoftDeleteCustomer(ctx, db.SoftDeleteCustomerParams{Uuid: id, OrganizationID: orgID}); err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	s.recordActivity(ctx, "tenant.customer.delete", "customer", &id, map[string]any{"name": row.Name})
	return nil
}

func (s *Service) AddVehicle(ctx context.Context, customerUUID uuid.UUID, in CreateVehicleInput) (Vehicle, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return Vehicle{}, err
	}
	customer, err := s.q.GetCustomerByUUID(ctx, db.GetCustomerByUUIDParams{Uuid: customerUUID, OrganizationID: orgID})
	if err != nil {
		if err == pgx.ErrNoRows {
			return Vehicle{}, ErrNotFound
		}
		return Vehicle{}, err
	}
	if err := s.insertVehicle(ctx, s.q, orgID, customer.ID, in); err != nil {
		return Vehicle{}, err
	}
	vehicles, err := s.listVehicles(ctx, customer.ID, orgID)
	if err != nil {
		return Vehicle{}, err
	}
	plate, _ := normalizePlate(in.Plate)
	for _, v := range vehicles {
		if v.Plate == plate {
			s.recordActivity(ctx, "tenant.customer.vehicle_add", "customer_vehicle", &v.UUID, map[string]any{"plate": v.Plate})
			return v, nil
		}
	}
	return Vehicle{}, ErrNotFound
}

func (s *Service) insertVehicle(ctx context.Context, q *db.Queries, orgID, customerID int64, in CreateVehicleInput) error {
	plate, err := normalizePlate(in.Plate)
	if err != nil {
		return err
	}
	if in.ModelUUID == uuid.Nil {
		return fmt.Errorf("%w: model_uuid is required", ErrInvalidRequest)
	}
	if in.Year < 1900 || in.Year > 2100 {
		return fmt.Errorf("%w: year must be between 1900 and 2100", ErrInvalidRequest)
	}
	option, err := q.GetVehicleCatalogOption(ctx, db.GetVehicleCatalogOptionParams{
		Uuid: in.ModelUUID,
		Year: int16(in.Year),
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("%w: vehicle model year was not found", ErrInvalidRequest)
		}
		return err
	}
	_, err = q.CreateCustomerVehicle(ctx, db.CreateCustomerVehicleParams{
		OrganizationID: orgID,
		CustomerID:     customerID,
		Plate:          plate,
		ModelID:        option.ModelID,
		Year:           int16(in.Year),
	})
	if err != nil {
		if strings.Contains(err.Error(), "uq_customer_vehicles_org_plate_active") {
			return fmt.Errorf("%w: plate already exists", ErrConflict)
		}
		return err
	}
	return nil
}

func (s *Service) DeleteVehicle(ctx context.Context, vehicleUUID uuid.UUID) error {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.SoftDeleteCustomerVehicle(ctx, db.SoftDeleteCustomerVehicleParams{
		Uuid: vehicleUUID, OrganizationID: orgID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	s.recordActivity(ctx, "tenant.customer.vehicle_remove", "customer_vehicle", &row.Uuid, map[string]any{"plate": row.Plate})
	return nil
}
