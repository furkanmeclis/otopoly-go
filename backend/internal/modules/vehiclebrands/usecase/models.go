package usecase

import (
	"context"
	"errors"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ModelSummary is one catalog model with the years it can be picked in.
type ModelSummary struct {
	BrandUUID uuid.UUID `json:"brand_uuid"`
	BrandName string    `json:"brand_name"`
	ModelUUID uuid.UUID `json:"model_uuid"`
	ModelName string    `json:"model_name"`
	Years     []int     `json:"years"`
}

// ModelVariant is a TSB trim / engine / package name of a model. Customer
// vehicles store only model + year; variants help pick the right model.
type ModelVariant struct {
	Name         string `json:"name"`
	Years        []int  `json:"years"`
	Fuel         string `json:"fuel,omitempty"`
	Transmission string `json:"transmission,omitempty"`
}

func ints(in []int32) []int {
	out := make([]int, len(in))
	for i, v := range in {
		out[i] = int(v)
	}
	return out
}

// SearchModels returns one row per model whose "brand model" contains every
// word of q (case-insensitive), optionally only models available in year.
func (s *Service) SearchModels(ctx context.Context, q string, year, limit int) ([]ModelSummary, error) {
	words := strings.Fields(strings.NewReplacer("%", " ", "_", " ", "\\", " ").Replace(q))
	if words == nil {
		words = []string{}
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	params := db.SearchVehicleModelsGroupedParams{Words: words, LimitCount: int32(limit)}
	if year > 0 {
		params.Year = pgtype.Int4{Int32: int32(year), Valid: true}
	}
	rows, err := s.q.SearchVehicleModelsGrouped(ctx, params)
	if err != nil {
		return nil, err
	}
	out := make([]ModelSummary, 0, len(rows))
	for _, r := range rows {
		out = append(out, ModelSummary{BrandUUID: r.BrandUuid, BrandName: r.BrandName, ModelUUID: r.ModelUuid, ModelName: r.ModelName, Years: ints(r.Years)})
	}
	return out, nil
}

// GetModel returns one model by uuid.
func (s *Service) GetModel(ctx context.Context, id uuid.UUID) (ModelSummary, error) {
	r, err := s.q.GetVehicleModelSummary(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ModelSummary{}, ErrNotFound
		}
		return ModelSummary{}, err
	}
	return ModelSummary{BrandUUID: r.BrandUuid, BrandName: r.BrandName, ModelUUID: r.ModelUuid, ModelName: r.ModelName, Years: ints(r.Years)}, nil
}

// ModelVariants lists the TSB variants behind a model (empty for models that
// are not linked to the TSB catalog).
func (s *Service) ModelVariants(ctx context.Context, modelUUID uuid.UUID, year, limit int) ([]ModelVariant, error) {
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	params := db.ListVehicleModelVariantsParams{ModelUuid: modelUUID, LimitCount: int32(limit)}
	if year > 0 {
		params.Year = pgtype.Int4{Int32: int32(year), Valid: true}
	}
	rows, err := s.q.ListVehicleModelVariants(ctx, params)
	if err != nil {
		return nil, err
	}
	out := make([]ModelVariant, 0, len(rows))
	for _, r := range rows {
		v := ModelVariant{Name: r.RawName, Years: ints(r.Years)}
		if r.SuggestedFuel.Valid {
			v.Fuel = r.SuggestedFuel.String
		}
		if r.SuggestedTransmission.Valid {
			v.Transmission = r.SuggestedTransmission.String
		}
		out = append(out, v)
	}
	return out, nil
}
