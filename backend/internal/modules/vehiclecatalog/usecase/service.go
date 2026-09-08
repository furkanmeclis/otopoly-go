package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourcemeta"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const SearchSpecVehicleModelYears = "vehicle_model_years"

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
	ErrConflict       = errors.New("conflict")
)

type SearchIndexer interface {
	EnqueueUpsert(ctx context.Context, spec, id string)
	EnqueueDelete(ctx context.Context, spec, id string)
	EnqueueReindex(ctx context.Context, spec string)
}

type CatalogSearcher interface {
	Enabled() bool
	Search(ctx context.Context, specs []string, q string, limit int, filters map[string]string) ([]searchengine.Hit, error)
}

type Service struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	act      *activity.Recorder
	search   SearchIndexer
	searcher CatalogSearcher
}

func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder) *Service {
	return &Service{pool: pool, q: q, act: act}
}

func (s *Service) SetSearchIndexer(indexer SearchIndexer) {
	if s == nil {
		return
	}
	s.search = indexer
}

func (s *Service) SetSearcher(searcher CatalogSearcher) {
	if s == nil {
		return
	}
	s.searcher = searcher
}

func (s *Service) BrandsResourceMeta() resourcemeta.ResourceMeta {
	return resourcemeta.PlatformVehicleBrands()
}

func ModelYearDocID(modelUUID uuid.UUID, year int) string {
	return fmt.Sprintf("%s:%d", modelUUID.String(), year)
}

func ParseModelYearDocID(id string) (uuid.UUID, int, error) {
	parts := strings.Split(strings.TrimSpace(id), ":")
	if len(parts) != 2 {
		return uuid.Nil, 0, fmt.Errorf("invalid vehicle catalog document id")
	}
	modelUUID, err := uuid.Parse(parts[0])
	if err != nil {
		return uuid.Nil, 0, err
	}
	var year int
	if _, err := fmt.Sscanf(parts[1], "%d", &year); err != nil {
		return uuid.Nil, 0, err
	}
	return modelUUID, year, nil
}

func logoURL(brandUUID uuid.UUID, key pgtype.Text) *string {
	if !key.Valid || strings.TrimSpace(key.String) == "" {
		return nil
	}
	u := fmt.Sprintf("/v1/public/vehicle-brands/logo/%s", brandUUID.String())
	return &u
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

func normalizeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("%w: name is required", ErrInvalidRequest)
	}
	if len(name) > 200 {
		return "", fmt.Errorf("%w: name is too long", ErrInvalidRequest)
	}
	return name, nil
}

func validYear(year int) error {
	if year < 1900 || year > 2100 {
		return fmt.Errorf("%w: year must be between 1900 and 2100", ErrInvalidRequest)
	}
	return nil
}

func (s *Service) ListBrands(ctx context.Context, limit, offset int32, filters BrandFilters) ([]Brand, int64, error) {
	sort := strings.TrimSpace(filters.Sort)
	if sort == "" {
		sort = "name"
	}
	switch sort {
	case "name", "-name", "created_at", "-created_at":
	default:
		return nil, 0, fmt.Errorf("%w: unsupported sort", ErrInvalidRequest)
	}
	params := db.ListVehicleBrandsParams{
		Sort:        sort,
		OffsetCount: offset,
		LimitCount:  limit,
	}
	if filters.Q != "" {
		params.Q = pgtype.Text{String: filters.Q, Valid: true}
	}
	if filters.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *filters.IsActive, Valid: true}
	}
	rows, err := s.q.ListVehicleBrands(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountVehicleBrands(ctx, db.CountVehicleBrandsParams{
		IsActive: params.IsActive,
		Q:        params.Q,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Brand, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapBrand(row.Uuid, row.Name, row.LogoObjectKey, row.IsActive, row.ModelCount, row.CreatedAt, row.UpdatedAt))
	}
	return out, total, nil
}

func mapBrand(id uuid.UUID, name string, logo pgtype.Text, active bool, modelCount int64, created, updated pgtype.Timestamptz) Brand {
	return Brand{
		UUID:       id,
		Name:       name,
		LogoURL:    logoURL(id, logo),
		IsActive:   active,
		ModelCount: modelCount,
		CreatedAt:  created.Time,
		UpdatedAt:  updated.Time,
	}
}

func (s *Service) GetBrand(ctx context.Context, id uuid.UUID) (BrandDetail, error) {
	row, err := s.q.GetVehicleBrandByUUID(ctx, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return BrandDetail{}, ErrNotFound
		}
		return BrandDetail{}, err
	}
	count, err := s.q.CountActiveVehicleModelsByBrand(ctx, row.ID)
	if err != nil {
		return BrandDetail{}, err
	}
	models, err := s.modelsForBrand(ctx, row.ID)
	if err != nil {
		return BrandDetail{}, err
	}
	return BrandDetail{
		Brand:  mapBrand(row.Uuid, row.Name, row.LogoObjectKey, row.IsActive, count, row.CreatedAt, row.UpdatedAt),
		Models: models,
	}, nil
}

func (s *Service) modelsForBrand(ctx context.Context, brandID int64) ([]Model, error) {
	rows, err := s.q.ListVehicleModelsByBrand(ctx, brandID)
	if err != nil {
		return nil, err
	}
	out := make([]Model, 0, len(rows))
	for _, row := range rows {
		years, err := s.q.ListVehicleModelYears(ctx, row.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, Model{
			UUID:      row.Uuid,
			Name:      row.Name,
			IsActive:  row.IsActive,
			Years:     yearsToInts(years),
			CreatedAt: row.CreatedAt.Time,
			UpdatedAt: row.UpdatedAt.Time,
		})
	}
	return out, nil
}

func yearsToInts(years []int16) []int {
	out := make([]int, 0, len(years))
	for _, y := range years {
		out = append(out, int(y))
	}
	return out
}

func (s *Service) CreateBrand(ctx context.Context, in CreateBrandInput) (Brand, error) {
	name, err := normalizeName(in.Name)
	if err != nil {
		return Brand{}, err
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	row, err := s.q.CreateVehicleBrand(ctx, db.CreateVehicleBrandParams{Name: name, IsActive: active})
	if err != nil {
		if strings.Contains(err.Error(), "uq_vehicle_brands_name_active") {
			return Brand{}, fmt.Errorf("%w: brand name already exists", ErrConflict)
		}
		return Brand{}, err
	}
	s.recordActivity(ctx, "platform.vehicle_brand.create", "vehicle_brand", &row.Uuid, map[string]any{"name": row.Name})
	return mapBrand(row.Uuid, row.Name, row.LogoObjectKey, row.IsActive, 0, row.CreatedAt, row.UpdatedAt), nil
}

func (s *Service) PatchBrand(ctx context.Context, id uuid.UUID, in PatchBrandInput) (BrandDetail, error) {
	params := db.UpdateVehicleBrandParams{Uuid: id}
	if in.Name != nil {
		name, err := normalizeName(*in.Name)
		if err != nil {
			return BrandDetail{}, err
		}
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	if in.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *in.IsActive, Valid: true}
	}
	row, err := s.q.UpdateVehicleBrand(ctx, params)
	if err != nil {
		if err == pgx.ErrNoRows {
			return BrandDetail{}, ErrNotFound
		}
		if strings.Contains(err.Error(), "uq_vehicle_brands_name_active") {
			return BrandDetail{}, fmt.Errorf("%w: brand name already exists", ErrConflict)
		}
		return BrandDetail{}, err
	}
	s.recordActivity(ctx, "platform.vehicle_brand.update", "vehicle_brand", &row.Uuid, map[string]any{"name": row.Name})
	s.reindexBrand(ctx, row.Uuid)
	return s.GetBrand(ctx, row.Uuid)
}

func (s *Service) SetLogo(ctx context.Context, id uuid.UUID, objectKey string) (BrandDetail, error) {
	row, err := s.q.UpdateVehicleBrand(ctx, db.UpdateVehicleBrandParams{
		SetLogo:       pgtype.Bool{Bool: true, Valid: true},
		LogoObjectKey: pgtype.Text{String: objectKey, Valid: objectKey != ""},
		Uuid:          id,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return BrandDetail{}, ErrNotFound
		}
		return BrandDetail{}, err
	}
	s.recordActivity(ctx, "platform.vehicle_brand.logo", "vehicle_brand", &row.Uuid, nil)
	return s.GetBrand(ctx, row.Uuid)
}

func (s *Service) LogoObjectKey(ctx context.Context, id uuid.UUID) (string, error) {
	row, err := s.q.GetVehicleBrandByUUID(ctx, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", ErrNotFound
		}
		return "", err
	}
	if !row.LogoObjectKey.Valid || strings.TrimSpace(row.LogoObjectKey.String) == "" {
		return "", ErrNotFound
	}
	return row.LogoObjectKey.String, nil
}

func (s *Service) DeleteBrand(ctx context.Context, id uuid.UUID) error {
	row, err := s.q.GetVehicleBrandByUUID(ctx, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	count, err := s.q.CountActiveVehicleModelsByBrand(ctx, row.ID)
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("%w: brand still has models", ErrConflict)
	}
	if _, err := s.q.SoftDeleteVehicleBrand(ctx, id); err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	s.recordActivity(ctx, "platform.vehicle_brand.delete", "vehicle_brand", &id, map[string]any{"name": row.Name})
	return nil
}

func (s *Service) CreateModel(ctx context.Context, brandUUID uuid.UUID, in CreateModelInput) (Model, error) {
	brand, err := s.q.GetVehicleBrandByUUID(ctx, brandUUID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return Model{}, ErrNotFound
		}
		return Model{}, err
	}
	name, err := normalizeName(in.Name)
	if err != nil {
		return Model{}, err
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	row, err := s.q.CreateVehicleModel(ctx, db.CreateVehicleModelParams{
		BrandID: brand.ID, Name: name, IsActive: active,
	})
	if err != nil {
		if strings.Contains(err.Error(), "uq_vehicle_models_brand_name_active") {
			return Model{}, fmt.Errorf("%w: model name already exists for this brand", ErrConflict)
		}
		return Model{}, err
	}
	years := make([]int, 0, len(in.Years))
	for _, year := range in.Years {
		if err := validYear(year); err != nil {
			return Model{}, err
		}
		if err := s.q.AddVehicleModelYear(ctx, db.AddVehicleModelYearParams{ModelID: row.ID, Year: int16(year)}); err != nil {
			return Model{}, err
		}
		s.indexModelYear(ctx, row.Uuid, year)
		years = append(years, year)
	}
	s.recordActivity(ctx, "platform.vehicle_model.create", "vehicle_model", &row.Uuid, map[string]any{"name": row.Name})
	return Model{
		UUID: row.Uuid, Name: row.Name, IsActive: row.IsActive, Years: years,
		CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	}, nil
}

func (s *Service) AddYear(ctx context.Context, modelUUID uuid.UUID, year int) error {
	if err := validYear(year); err != nil {
		return err
	}
	model, err := s.q.GetVehicleModelByUUID(ctx, modelUUID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	if err := s.q.AddVehicleModelYear(ctx, db.AddVehicleModelYearParams{ModelID: model.ID, Year: int16(year)}); err != nil {
		return err
	}
	s.indexModelYear(ctx, model.Uuid, year)
	s.recordActivity(ctx, "platform.vehicle_model.year_add", "vehicle_model", &model.Uuid, map[string]any{"year": year})
	return nil
}

func (s *Service) DeleteYear(ctx context.Context, modelUUID uuid.UUID, year int) error {
	model, err := s.q.GetVehicleModelByUUID(ctx, modelUUID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	if err := s.q.DeleteVehicleModelYear(ctx, db.DeleteVehicleModelYearParams{ModelID: model.ID, Year: int16(year)}); err != nil {
		if strings.Contains(err.Error(), "fk_customer_vehicles_model_year") {
			return fmt.Errorf("%w: year is used by a customer vehicle", ErrConflict)
		}
		return err
	}
	s.deleteModelYear(ctx, model.Uuid, year)
	s.recordActivity(ctx, "platform.vehicle_model.year_remove", "vehicle_model", &model.Uuid, map[string]any{"year": year})
	return nil
}

func (s *Service) DeleteModel(ctx context.Context, modelUUID uuid.UUID) error {
	model, err := s.q.GetVehicleModelByUUID(ctx, modelUUID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	used, err := s.q.CountCustomerVehiclesByModel(ctx, model.ID)
	if err != nil {
		return err
	}
	if used > 0 {
		return fmt.Errorf("%w: model is used by a customer vehicle", ErrConflict)
	}
	years, err := s.q.ListVehicleModelYears(ctx, model.ID)
	if err != nil {
		return err
	}
	if _, err := s.q.SoftDeleteVehicleModel(ctx, modelUUID); err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	for _, year := range years {
		s.deleteModelYear(ctx, model.Uuid, int(year))
	}
	s.recordActivity(ctx, "platform.vehicle_model.delete", "vehicle_model", &model.Uuid, map[string]any{"name": model.Name})
	return nil
}

func (s *Service) SearchOptions(ctx context.Context, q string, limit int) ([]CatalogOption, error) {
	q = strings.TrimSpace(q)
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	// Empty query is a browse list so the picker is not empty on open.
	// Meilisearch rejects blank queries; fall through to SQL for those.
	if q != "" && s.searcher != nil && s.searcher.Enabled() {
		hits, err := s.searcher.Search(ctx, []string{SearchSpecVehicleModelYears}, q, limit, nil)
		if err == nil && len(hits) > 0 {
			options, hydrateErr := s.hydrateHits(ctx, hits)
			if hydrateErr == nil && len(options) > 0 {
				return options, nil
			}
		}
	}
	rows, err := s.q.SearchVehicleCatalogOptions(ctx, db.SearchVehicleCatalogOptionsParams{
		Q:          pgtype.Text{String: q, Valid: true},
		LimitCount: int32(limit),
	})
	if err != nil {
		return nil, err
	}
	out := make([]CatalogOption, 0, len(rows))
	for _, row := range rows {
		out = append(out, CatalogOption{
			BrandUUID: row.BrandUuid,
			BrandName: row.BrandName,
			LogoURL:   logoURL(row.BrandUuid, row.LogoObjectKey),
			ModelUUID: row.ModelUuid,
			ModelName: row.ModelName,
			Year:      int(row.Year),
		})
	}
	return out, nil
}

func (s *Service) hydrateHits(ctx context.Context, hits []searchengine.Hit) ([]CatalogOption, error) {
	out := make([]CatalogOption, 0, len(hits))
	for _, hit := range hits {
		modelUUID, year, err := ParseModelYearDocID(hit.ID)
		if err != nil {
			continue
		}
		row, err := s.q.GetVehicleCatalogOption(ctx, db.GetVehicleCatalogOptionParams{
			Uuid: modelUUID,
			Year: int16(year),
		})
		if err != nil {
			continue
		}
		out = append(out, CatalogOption{
			BrandUUID: row.BrandUuid,
			BrandName: row.BrandName,
			LogoURL:   logoURL(row.BrandUuid, row.LogoObjectKey),
			ModelUUID: row.ModelUuid,
			ModelName: row.ModelName,
			Year:      int(row.Year),
		})
	}
	return out, nil
}

func (s *Service) Import(ctx context.Context, payload map[string]map[string][]string) (ImportResult, error) {
	if len(payload) == 0 {
		return ImportResult{}, fmt.Errorf("%w: import payload is empty", ErrInvalidRequest)
	}
	var result ImportResult
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ImportResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	for brandName, years := range payload {
		name, err := normalizeName(brandName)
		if err != nil {
			return ImportResult{}, err
		}
		brand, created, err := upsertBrand(ctx, q, name)
		if err != nil {
			return ImportResult{}, err
		}
		if created {
			result.BrandsCreated++
		} else {
			result.BrandsUpdated++
		}
		for yearText, models := range years {
			var year int
			if _, err := fmt.Sscanf(strings.TrimSpace(yearText), "%d", &year); err != nil {
				return ImportResult{}, fmt.Errorf("%w: invalid year %q", ErrInvalidRequest, yearText)
			}
			if err := validYear(year); err != nil {
				return ImportResult{}, err
			}
			for _, modelName := range models {
				modelLabel, err := normalizeName(modelName)
				if err != nil {
					return ImportResult{}, err
				}
				model, modelCreated, err := upsertModel(ctx, q, brand.ID, modelLabel)
				if err != nil {
					return ImportResult{}, err
				}
				if modelCreated {
					result.ModelsCreated++
				}
				if err := q.AddVehicleModelYear(ctx, db.AddVehicleModelYearParams{ModelID: model.ID, Year: int16(year)}); err != nil {
					return ImportResult{}, err
				}
				result.YearsAdded++
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return ImportResult{}, err
	}
	s.recordActivity(ctx, "platform.vehicle_brand.import", "vehicle_brand", nil, map[string]any{
		"brands_created": result.BrandsCreated,
		"models_created": result.ModelsCreated,
	})
	if s.search != nil {
		s.search.EnqueueReindex(ctx, SearchSpecVehicleModelYears)
	}
	return result, nil
}

func upsertBrand(ctx context.Context, q *db.Queries, name string) (db.VehicleBrand, bool, error) {
	existing, err := q.GetVehicleBrandByName(ctx, name)
	if err == nil {
		return existing, false, nil
	}
	if err != pgx.ErrNoRows {
		return db.VehicleBrand{}, false, err
	}
	row, err := q.CreateVehicleBrand(ctx, db.CreateVehicleBrandParams{Name: name, IsActive: true})
	if err != nil {
		return db.VehicleBrand{}, false, err
	}
	return row, true, nil
}

func upsertModel(ctx context.Context, q *db.Queries, brandID int64, name string) (db.VehicleModel, bool, error) {
	existing, err := q.GetVehicleModelByBrandAndName(ctx, db.GetVehicleModelByBrandAndNameParams{
		BrandID: brandID,
		Lower:   name,
	})
	if err == nil {
		return existing, false, nil
	}
	if err != pgx.ErrNoRows {
		return db.VehicleModel{}, false, err
	}
	row, err := q.CreateVehicleModel(ctx, db.CreateVehicleModelParams{BrandID: brandID, Name: name, IsActive: true})
	if err != nil {
		return db.VehicleModel{}, false, err
	}
	return row, true, nil
}

func (s *Service) indexModelYear(ctx context.Context, modelUUID uuid.UUID, year int) {
	if s.search == nil {
		return
	}
	s.search.EnqueueUpsert(ctx, SearchSpecVehicleModelYears, ModelYearDocID(modelUUID, year))
}

func (s *Service) deleteModelYear(ctx context.Context, modelUUID uuid.UUID, year int) {
	if s.search == nil {
		return
	}
	s.search.EnqueueDelete(ctx, SearchSpecVehicleModelYears, ModelYearDocID(modelUUID, year))
}

func (s *Service) reindexBrand(ctx context.Context, brandUUID uuid.UUID) {
	if s.search == nil {
		return
	}
	rows, err := s.q.ListVehicleModelYearIDsByBrand(ctx, brandUUID)
	if err != nil {
		s.search.EnqueueReindex(ctx, SearchSpecVehicleModelYears)
		return
	}
	for _, row := range rows {
		s.search.EnqueueUpsert(ctx, SearchSpecVehicleModelYears, ModelYearDocID(row.ModelUuid, int(row.Year)))
	}
}
