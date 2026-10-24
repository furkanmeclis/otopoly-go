// Package usecase keeps the legacy vehicle brand lookups that customer
// vehicles, quotes, jobs and the AI tools still use: the tenant picker
// search over vehicle_model_years and the public brand logo stream. Brands,
// models and years themselves are no longer edited here; the TSB vehicle
// catalog (modules/vehiclecatalog) projects onto these tables.
package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine/adapters"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const SearchSpecVehicleModelYears = "vehicle_model_years"

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
	ErrConflict       = errors.New("conflict")
)

type CatalogSearcher interface {
	Enabled() bool
	Search(ctx context.Context, specs []string, q string, limit int, filters map[string]string) ([]searchengine.Hit, error)
}

type Service struct {
	q        *db.Queries
	searcher CatalogSearcher
}

func New(q *db.Queries) *Service {
	return &Service{q: q}
}

func (s *Service) SetSearcher(searcher CatalogSearcher) {
	if s == nil {
		return
	}
	s.searcher = searcher
}

// ModelYearDocID / ParseModelYearDocID are the Meilisearch document id of
// one "model · year" pair; the format is owned by the search adapter.
func ModelYearDocID(modelUUID uuid.UUID, year int) string {
	return adapters.ModelYearDocID(modelUUID, year)
}

func ParseModelYearDocID(id string) (uuid.UUID, int, error) {
	return adapters.ParseModelYearDocID(id)
}

// LogoURL is the API-owned public logo path of a legacy brand, or nil when
// the brand has no uploaded logo.
func LogoURL(brandUUID uuid.UUID, key pgtype.Text) *string {
	if !key.Valid || strings.TrimSpace(key.String) == "" {
		return nil
	}
	u := fmt.Sprintf("/v1/public/vehicle-brands/logo/%s", brandUUID.String())
	return &u
}

func logoURL(brandUUID uuid.UUID, key pgtype.Text) *string { return LogoURL(brandUUID, key) }

// SearchOptions is the tenant vehicle picker: "brand model · year" triples.
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
