package usecase

import (
	"context"
	"log/slog"
)

// Legacy vehicle tables. Customer vehicles, quotes, jobs and the tenant
// vehicle picker (Meilisearch spec vehicle_model_years) point at
// vehicle_brands / vehicle_models / vehicle_model_years. After every applied
// import the catalog is projected onto them: one legacy brand per display
// brand, one legacy model per grouped catalog model, the union of the types'
// model years. Rows are linked by catalog_display_brand_id /
// catalog_group_key so a re-apply updates the same rows; nothing is deleted.

// SearchSpecVehicleModelYears is the Meilisearch spec of the legacy picker.
const SearchSpecVehicleModelYears = "vehicle_model_years"

// SearchReindexer queues a full reindex of a search spec (optional).
type SearchReindexer interface {
	EnqueueReindex(ctx context.Context, spec string)
}

// SetSearchReindexer attaches the search indexer that refreshes the legacy
// vehicle picker index after a projection.
func (s *Service) SetSearchReindexer(idx SearchReindexer) {
	s.reindex = idx
}

// ProjectionResult counts what the projection changed.
type ProjectionResult struct {
	BrandsLinked    int64 `json:"brands_linked"`
	BrandsCreated   int64 `json:"brands_created"`
	BrandsUpdated   int64 `json:"brands_updated"`
	ModelsLinked    int64 `json:"models_linked"`
	ModelsCreated   int64 `json:"models_created"`
	ModelYearsAdded int64 `json:"model_years_added"`
}

// ProjectLegacy refreshes the legacy vehicle tables from the catalog and
// queues a reindex of the picker when anything changed.
func (s *Service) ProjectLegacy(ctx context.Context) (ProjectionResult, error) {
	var res ProjectionResult
	q := s.q
	var err error
	if res.BrandsLinked, err = q.ProjectCatalogLinkBrandsByName(ctx); err != nil {
		return res, err
	}
	if res.BrandsCreated, err = q.ProjectCatalogInsertBrands(ctx); err != nil {
		return res, err
	}
	if res.BrandsUpdated, err = q.ProjectCatalogUpdateBrands(ctx); err != nil {
		return res, err
	}
	if res.ModelsLinked, err = q.ProjectCatalogLinkModelsByName(ctx); err != nil {
		return res, err
	}
	if res.ModelsCreated, err = q.ProjectCatalogInsertModels(ctx); err != nil {
		return res, err
	}
	if res.ModelYearsAdded, err = q.ProjectCatalogInsertModelYears(ctx); err != nil {
		return res, err
	}
	changed := res.BrandsCreated+res.BrandsUpdated+res.ModelsCreated+res.ModelYearsAdded > 0
	if changed && s.reindex != nil {
		s.reindex.EnqueueReindex(ctx, SearchSpecVehicleModelYears)
	}
	s.log.Info("vehicle_catalog_projected",
		slog.Int64("brands_created", res.BrandsCreated), slog.Int64("brands_updated", res.BrandsUpdated),
		slog.Int64("models_created", res.ModelsCreated), slog.Int64("model_years_added", res.ModelYearsAdded))
	return res, nil
}

func (s *Service) projectLegacy(ctx context.Context) error {
	_, err := s.ProjectLegacy(ctx)
	return err
}
