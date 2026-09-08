package adapters

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const SpecVehicleModelYears = "vehicle_model_years"

type VehicleModelYearsAdapter struct {
	q *db.Queries
}

func NewVehicleModelYears(q *db.Queries) *VehicleModelYearsAdapter {
	return &VehicleModelYearsAdapter{q: q}
}

func (a *VehicleModelYearsAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:         SpecVehicleModelYears,
		LabelKey:   "search.specs_vehicle_model_years",
		Permission: rbac.PermPlatformVehicleBrandsRead,
		Icon:       "car",
		Searchable: []string{"title", "subtitle", "keywords", "brand_name", "model_name", "year"},
	}
}

func (a *VehicleModelYearsAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListVehicleModelYearsForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, documentFromYear(row.BrandName, row.ModelName, row.BrandUuid, row.ModelUuid, row.Year))
	}
	return out, nil
}

func (a *VehicleModelYearsAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	modelUUID, year, err := parseModelYearID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetVehicleModelYearForSearch(ctx, db.GetVehicleModelYearForSearchParams{
		Uuid: modelUUID,
		Year: int16(year),
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("vehicle catalog search: not found")
		}
		return searchengine.Document{}, err
	}
	return documentFromYear(row.BrandName, row.ModelName, row.BrandUuid, row.ModelUuid, row.Year), nil
}

func documentFromYear(brandName, modelName string, brandUUID, modelUUID uuid.UUID, year int16) searchengine.Document {
	title := strings.TrimSpace(brandName + " " + modelName)
	yearText := strconv.Itoa(int(year))
	return searchengine.Document{
		ID:       fmt.Sprintf("%s:%d", modelUUID.String(), year),
		Spec:     SpecVehicleModelYears,
		Title:    title,
		Subtitle: yearText,
		Keywords: []string{brandName, modelName, yearText},
		Href:     "/platform/vehicle-brands/" + brandUUID.String(),
		Icon:     "car",
	}
}

func parseModelYearID(id string) (uuid.UUID, int, error) {
	parts := strings.Split(strings.TrimSpace(id), ":")
	if len(parts) != 2 {
		return uuid.Nil, 0, fmt.Errorf("vehicle catalog search: invalid id")
	}
	modelUUID, err := uuid.Parse(parts[0])
	if err != nil {
		return uuid.Nil, 0, err
	}
	year, err := strconv.Atoi(parts[1])
	if err != nil {
		return uuid.Nil, 0, err
	}
	return modelUUID, year, nil
}
