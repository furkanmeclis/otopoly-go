package usecase

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type entFixture struct {
	pool        *pgxpool.Pool
	q           *db.Queries
	svc         *Service
	ctx         context.Context
	orgID       int64
	planID      int64
	customer    uuid.UUID
	vehicle     uuid.UUID
	serviceUUID uuid.UUID
}

func setupEntitlementsDB(t *testing.T) *entFixture {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	f := &entFixture{pool: pool, q: q}
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]

	scan := func(sql string, dest []any, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dest...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}

	var orgUUID uuid.UUID
	var userID int64
	scan(`INSERT INTO organizations (slug, name) VALUES ($1, 'Ent Jobs') RETURNING id, uuid`,
		[]any{&f.orgID, &orgUUID}, "jobs-ent-"+suffix)
	scan(`INSERT INTO users (email, password_hash, name, surname, status)
		VALUES ($1, 'hash', 'Job', 'Owner', 'active') RETURNING id`,
		[]any{&userID}, "jobs-ent-"+suffix+"@example.test")
	if _, err := pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, f.orgID, userID); err != nil {
		t.Fatal(err)
	}

	var jobsDailyFeatureID int64
	scan(`SELECT id FROM billing_features WHERE key = 'jobs.daily'`, []any{&jobsDailyFeatureID})
	scan(`INSERT INTO billing_plans (code, name, description, is_public)
		VALUES ($1, $2, 'jobs entitlement test', false) RETURNING id`,
		[]any{&f.planID}, "jobs-ent-"+suffix, "Jobs Ent "+suffix)
	if _, err := pool.Exec(ctx, `INSERT INTO billing_plan_features (plan_id, feature_id, value_int, enforcement, tolerance_pct)
		VALUES ($1, $2, 1, 'hard', 0)`, f.planID, jobsDailyFeatureID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_subscriptions (organization_id, plan_id, status, ends_at)
		VALUES ($1, $2, 'active', NOW() + INTERVAL '14 days')`, f.orgID, f.planID); err != nil {
		t.Fatal(err)
	}

	var brandID, modelID, customerID int64
	scan(`INSERT INTO vehicle_brands (name) VALUES ($1) RETURNING id`, []any{&brandID}, "EntBrand"+suffix)
	scan(`INSERT INTO vehicle_models (brand_id, name) VALUES ($1, 'EntModel') RETURNING id`, []any{&modelID}, brandID)
	if _, err := pool.Exec(ctx, `INSERT INTO vehicle_model_years (model_id, year) VALUES ($1, 2022)`, modelID); err != nil {
		t.Fatal(err)
	}
	scan(`INSERT INTO customers (organization_id, name, phone) VALUES ($1, 'Limit Customer', '05550000000') RETURNING id, uuid`,
		[]any{&customerID, &f.customer}, f.orgID)
	scan(`INSERT INTO customer_vehicles (organization_id, customer_id, plate, model_id, year)
		VALUES ($1, $2, '34ENT1', $3, 2022) RETURNING uuid`,
		[]any{&f.vehicle}, f.orgID, customerID, modelID)
	scan(`INSERT INTO services (organization_id, name, price, vat_rate) VALUES ($1, 'Wash', 100, 20) RETURNING uuid`,
		[]any{&f.serviceUUID}, f.orgID)

	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM service_jobs WHERE organization_id = $1`, f.orgID)
		_, _ = pool.Exec(c, `DELETE FROM customers WHERE organization_id = $1`, f.orgID)
		_, _ = pool.Exec(c, `DELETE FROM organizations WHERE id = $1`, f.orgID)
		_, _ = pool.Exec(c, `DELETE FROM billing_plans WHERE id = $1`, f.planID)
	})

	ent := entitlements.New(entitlements.NewDBStore(q))
	f.svc = New(pool, q, nil, nil, nil)
	f.svc.SetEntitlements(ent)
	f.ctx = authctx.WithPrincipal(
		orgctx.WithScope(ctx, orgctx.Scope{InternalID: f.orgID, UUID: orgUUID}),
		authctx.Principal{UserInternal: userID},
	)
	return f
}

func (f *entFixture) createJob(t *testing.T) (JobDetail, error) {
	t.Helper()
	return f.svc.Create(f.ctx, CreateInput{
		CustomerUUID: f.customer,
		VehicleUUID:  f.vehicle,
		Lines:        []CreateLineInput{{ServiceUUID: f.serviceUUID}},
	})
}

func TestJobCreateEntitlementsLimitAndGiveBack_DB(t *testing.T) {
	f := setupEntitlementsDB(t)

	first, err := f.createJob(t)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	if _, err := f.createJob(t); !errors.Is(err, entitlements.ErrLimitReached) {
		t.Fatalf("second create must hit jobs.daily limit, got %v", err)
	}
	if _, err := f.svc.Cancel(f.ctx, first.UUID); err != nil {
		t.Fatalf("cancel first job: %v", err)
	}
	if _, err := f.createJob(t); err != nil {
		t.Fatalf("create after cancel must be allowed: %v", err)
	}
}

func TestJobCreateEntitlementsTolerance_DB(t *testing.T) {
	f := setupEntitlementsDB(t)

	if _, err := f.createJob(t); err != nil {
		t.Fatalf("first create: %v", err)
	}
	if _, err := f.pool.Exec(context.Background(), `UPDATE billing_plan_features SET tolerance_pct = 100 WHERE plan_id = $1`, f.planID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.createJob(t); err != nil {
		t.Fatalf("second create within tolerance must be allowed: %v", err)
	}
	if _, err := f.createJob(t); !errors.Is(err, entitlements.ErrLimitReached) {
		t.Fatalf("third create beyond tolerance must hit limit, got %v", err)
	}
}
