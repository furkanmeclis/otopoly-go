package entitlements

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDBStoreAndRecompute(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	q := db.New(pool)
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:10]
	var orgID int64
	if err := pool.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1, 'Ent Test') RETURNING id`, "ent-"+suffix).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID) })

	var userID int64
	if err := pool.QueryRow(ctx, `INSERT INTO users (email, password_hash, name, surname, status)
		VALUES ($1, 'hash', 'Ent', 'Tester', 'active') RETURNING id`, "ent-"+suffix+"@example.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, orgID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_subscriptions (organization_id, plan_id, status, ends_at)
		SELECT $1, id, 'trial', NOW() + INTERVAL '14 days' FROM billing_plans WHERE code = 'trial'`, orgID); err != nil {
		t.Fatal(err)
	}

	var cust int64
	if err := pool.QueryRow(ctx, `INSERT INTO customers (organization_id, name) VALUES ($1, 'C') RETURNING id`, orgID).Scan(&cust); err != nil {
		t.Fatal(err)
	}
	var veh int64
	if err := pool.QueryRow(ctx, `INSERT INTO customer_vehicles (organization_id, customer_id, plate, model_id, year)
		SELECT $1, $2, '34E1', model_id, year FROM vehicle_model_years LIMIT 1 RETURNING id`, orgID, cust).Scan(&veh); err != nil {
		t.Fatal(err)
	}
	for _, st := range []string{"in_progress", "cancelled"} {
		if _, err := pool.Exec(ctx, `INSERT INTO service_jobs (
			organization_id, customer_id, vehicle_id, customer_name, plate, vehicle_label,
			status, total_amount, started_at, created_by
		) VALUES ($1, $2, $3, 'C', '34E1', 'Test Vehicle', $4, 0, NOW(), $5)`, orgID, cust, veh, st, userID); err != nil {
			t.Fatal(err)
		}
	}

	store := NewDBStore(q)
	svc := New(store)
	feats, err := store.Features(ctx, orgID)
	if err != nil || len(feats) == 0 {
		t.Fatalf("features: %v %d", err, len(feats))
	}
	if err := NewRecomputer(q, svc).RecomputeUsage(ctx, orgID); err != nil {
		t.Fatal(err)
	}
	d, err := svc.Check(ctx, orgID, "jobs.daily", 1)
	if err != nil || d.Used != 1 || d.Limit != 10 {
		t.Fatalf("after recompute: %+v %v (cancelled job must not count)", d, err)
	}
	if v, _ := store.Consume(ctx, orgID, "storage.gb", "total", -5); v != 0 {
		t.Fatalf("negative consume clamped, got %d", v)
	}
	if _, err := svc.Check(ctx, orgID, "ai.enabled", 1); err != ErrFeatureDisabled {
		t.Fatalf("ai toggle: %v", err)
	}
	if on, _ := svc.Enabled(ctx, orgID, "module.contracts"); !on {
		t.Fatal("contracts must be enabled on trial")
	}
	if d, err := svc.Check(ctx, orgID, "jobs.monthly", 1); err != nil || d.Defined {
		t.Fatalf("undefined: %+v %v", d, err)
	}
}
