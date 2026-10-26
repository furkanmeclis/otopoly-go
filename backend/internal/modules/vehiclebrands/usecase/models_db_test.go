package usecase

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
)

// search_vehicle_models: one row per model with its years, and the TSB
// variants behind a projected model.
func TestSearchModelsAndVariants(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := database.NewPoolFromDSN(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	sfx := strings.ReplaceAll(uuid.NewString(), "-", "")[:10]
	brand := "Qz" + sfx
	var displayID, tsbBrandID, brandID, catModelID, clioID int64
	var clioUUID uuid.UUID
	scan := func(sql string, dst []any, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dst...); err != nil {
			t.Fatalf("%v\n%s", err, sql)
		}
	}
	scan(`INSERT INTO catalog_display_brands (name, slug) VALUES ($1, $2) RETURNING id`, []any{&displayID}, brand, "qz-"+sfx)
	scan(`INSERT INTO catalog_brands (tsb_code, tsb_name, display_name, display_brand_id) VALUES ($1, $2, $2, $3) RETURNING id`, []any{&tsbBrandID}, "QZ"+sfx, brand, displayID)
	scan(`INSERT INTO vehicle_brands (name, catalog_display_brand_id) VALUES ($1, $2) RETURNING id`, []any{&brandID}, brand, displayID)
	scan(`INSERT INTO catalog_models (brand_id, name) VALUES ($1, 'Clio') RETURNING id`, []any{&catModelID}, tsbBrandID)
	scan(`INSERT INTO vehicle_models (brand_id, name, catalog_group_key) VALUES ($1, 'Clio', 'clio') RETURNING id, uuid`, []any{&clioID, &clioUUID}, brandID)
	var symbolID int64
	scan(`INSERT INTO vehicle_models (brand_id, name) VALUES ($1, 'Clio Symbol') RETURNING id`, []any{&symbolID}, brandID)
	for _, y := range []int{2015, 2016, 2017} {
		if _, err := pool.Exec(ctx, `INSERT INTO vehicle_model_years (model_id, year) VALUES ($1, $2), ($3, $2)`, clioID, y, symbolID); err != nil {
			t.Fatal(err)
		}
	}
	for i, tp := range []struct {
		name  string
		years string
	}{{"CLIO 1.5 DCI TOUCH", "{2015,2016}"}, {"CLIO 1.2 JOY", "{2017}"}} {
		if _, err := pool.Exec(ctx, `INSERT INTO catalog_types (brand_id, model_id, tsb_type_code, raw_name, years, first_seen_period, last_seen_period)
			VALUES ($1, $2, $3, $4, $5::int[], '2026-01', '2026-10')`, tsbBrandID, catModelID, sfx+string(rune('a'+i)), tp.name, tp.years); err != nil {
			t.Fatal(err)
		}
	}

	t.Cleanup(func() {
		// Platform catalog rows are shared by every test package: remove ours.
		for _, stmt := range []string{
			`DELETE FROM vehicle_model_years WHERE model_id IN (SELECT id FROM vehicle_models WHERE brand_id = $1)`,
			`DELETE FROM vehicle_models WHERE brand_id = $1`,
			`DELETE FROM vehicle_brands WHERE id = $1`,
		} {
			_, _ = pool.Exec(context.Background(), stmt, brandID)
		}
		_, _ = pool.Exec(context.Background(), `DELETE FROM catalog_brands WHERE id = $1`, tsbBrandID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM catalog_display_brands WHERE id = $1`, displayID)
	})

	svc := New(db.New(pool))
	models, err := svc.SearchModels(ctx, strings.ToLower(brand)+" clio", 0, 10)
	if err != nil || len(models) != 2 || models[0].ModelName != "Clio" || len(models[0].Years) != 3 || models[0].Years[0] != 2015 {
		t.Fatalf("models = %+v %v", models, err)
	}
	if only, _ := svc.SearchModels(ctx, brand+" symbol", 2016, 10); len(only) != 1 || only[0].ModelName != "Clio Symbol" {
		t.Fatalf("symbol = %+v", only)
	}
	if none, _ := svc.SearchModels(ctx, brand, 1999, 10); len(none) != 0 {
		t.Fatalf("year filter = %+v", none)
	}
	m, err := svc.GetModel(ctx, clioUUID)
	if err != nil || m.BrandName != brand || len(m.Years) != 3 {
		t.Fatalf("model = %+v %v", m, err)
	}
	vs, err := svc.ModelVariants(ctx, clioUUID, 0, 10)
	if err != nil || len(vs) != 2 || vs[0].Name != "CLIO 1.2 JOY" {
		t.Fatalf("variants = %+v %v", vs, err)
	}
	if vs, _ := svc.ModelVariants(ctx, clioUUID, 2016, 10); len(vs) != 1 || vs[0].Name != "CLIO 1.5 DCI TOUCH" {
		t.Fatalf("variants 2016 = %+v", vs)
	}
}
