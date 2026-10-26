package dbtest

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Fixtures inserts minimal organization-owned rows with raw SQL for
// database tests (only the NOT NULL columns; everything else keeps its
// default). Every helper fails the test on error.
type Fixtures struct {
	T    testing.TB
	Pool *pgxpool.Pool

	seq     atomic.Int64
	modelID int64
}

// Row is an inserted row's internal id and public uuid.
type Row struct {
	ID   int64
	UUID uuid.UUID
}

func (f *Fixtures) next() int64 { return f.seq.Add(1) }

func (f *Fixtures) row(sql string, args ...any) Row {
	f.T.Helper()
	var r Row
	if err := f.Pool.QueryRow(context.Background(), sql, args...).Scan(&r.ID, &r.UUID); err != nil {
		f.T.Fatalf("dbtest fixture: %v\n%s", err, sql)
	}
	return r
}

// Exec runs a statement and fails the test on error.
func (f *Fixtures) Exec(sql string, args ...any) {
	f.T.Helper()
	if _, err := f.Pool.Exec(context.Background(), sql, args...); err != nil {
		f.T.Fatalf("dbtest fixture: %v\n%s", err, sql)
	}
}

// Organization creates an active organization.
func (f *Fixtures) Organization() Row {
	n := f.next()
	return f.row(`INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id, uuid`,
		fmt.Sprintf("fx-org-%d-%s", n, uuid.NewString()[:6]), fmt.Sprintf("Fixture Org %d", n))
}

// User creates a user.
func (f *Fixtures) User() Row {
	n := f.next()
	return f.row(`INSERT INTO users (email, password_hash, name, surname) VALUES ($1, 'x', 'Fx', 'User') RETURNING id, uuid`,
		fmt.Sprintf("fx-%d-%s@example.test", n, uuid.NewString()[:6]))
}

// Customer creates a customer in org.
func (f *Fixtures) Customer(org Row, name string) Row {
	return f.row(`INSERT INTO customers (organization_id, name) VALUES ($1, $2) RETURNING id, uuid`, org.ID, name)
}

// Vehicle adds a vehicle (one shared catalog model / year) to a customer.
func (f *Fixtures) Vehicle(org, customer Row) Row {
	f.T.Helper()
	if f.modelID == 0 {
		brand := f.row(`INSERT INTO vehicle_brands (name) VALUES ($1) RETURNING id, uuid`, "Fx Brand "+uuid.NewString()[:6])
		model := f.row(`INSERT INTO vehicle_models (brand_id, name) VALUES ($1, 'Fx Model') RETURNING id, uuid`, brand.ID)
		f.Exec(`INSERT INTO vehicle_model_years (model_id, year) VALUES ($1, 2020)`, model.ID)
		f.modelID = model.ID
	}
	return f.row(`INSERT INTO customer_vehicles (organization_id, customer_id, plate, model_id, year)
		VALUES ($1, $2, $3, $4, 2020) RETURNING id, uuid`, org.ID, customer.ID, fmt.Sprintf("34FX%04d", f.next()), f.modelID)
}

// Job opens a service job for a customer's vehicle.
func (f *Fixtures) Job(org, customer, vehicle, user Row) Row {
	return f.row(`INSERT INTO service_jobs (organization_id, customer_id, vehicle_id, created_by)
		VALUES ($1, $2, $3, $4) RETURNING id, uuid`, org.ID, customer.ID, vehicle.ID, user.ID)
}

// Sale records a cash product sale (customer may be the zero Row).
func (f *Fixtures) Sale(org, customer, user Row) Row {
	var cust any
	if customer.ID != 0 {
		cust = customer.ID
	}
	return f.row(`INSERT INTO product_sales (organization_id, customer_id, method, total_amount, created_by)
		VALUES ($1, $2, 'cash', 10, $3) RETURNING id, uuid`, org.ID, cust, user.ID)
}

// Supplier creates a supplier.
func (f *Fixtures) Supplier(org Row, name string) Row {
	return f.row(`INSERT INTO suppliers (organization_id, name) VALUES ($1, $2) RETURNING id, uuid`, org.ID, name)
}

// Purchase records a cash purchase from a supplier.
func (f *Fixtures) Purchase(org, supplier, user Row) Row {
	return f.row(`INSERT INTO purchases (organization_id, supplier_id, method, total_amount, created_by)
		VALUES ($1, $2, 'cash', 10, $3) RETURNING id, uuid`, org.ID, supplier.ID, user.ID)
}

// Quote creates a draft quote for a customer.
func (f *Fixtures) Quote(org, customer Row) Row {
	n := f.next()
	return f.row(`INSERT INTO quotes (organization_id, number, customer_id, share_token)
		VALUES ($1, $2, $3, $4) RETURNING id, uuid`, org.ID, fmt.Sprintf("FX-%d", n), customer.ID, uuid.NewString())
}

// Lead creates a lead for a customer.
func (f *Fixtures) Lead(org, customer Row) Row {
	return f.row(`INSERT INTO leads (organization_id, customer_id) VALUES ($1, $2) RETURNING id, uuid`, org.ID, customer.ID)
}

// Contract creates a draft contract instance on a service job.
func (f *Fixtures) Contract(org, job, user Row) Row {
	return f.row(`INSERT INTO contract_instances (organization_id, title, subject_type, subject_uuid, created_by, number)
		VALUES ($1, 'Fx', 'service_job', $2, $3, $4) RETURNING id, uuid`, org.ID, job.UUID, user.ID, f.next())
}

// CariEntry posts a charge on the customer's cari account (created on demand).
func (f *Fixtures) CariEntry(org, customer, user Row) Row {
	acc := f.row(`INSERT INTO cari_accounts (organization_id, customer_id) VALUES ($1, $2)
		ON CONFLICT (customer_id) DO UPDATE SET updated_at = cari_accounts.updated_at
		RETURNING id, uuid`, org.ID, customer.ID)
	return f.row(`INSERT INTO cari_entries (organization_id, account_id, type, amount, balance_after, entry_date, created_by)
		VALUES ($1, $2, 'charge', 10, 10, CURRENT_DATE, $3) RETURNING id, uuid`, org.ID, acc.ID, user.ID)
}

// Activity writes an audit event attributed to org (actor may be the zero Row).
func (f *Fixtures) Activity(org Row, actor Row, action, resource string, resourceUUID uuid.UUID) Row {
	var a any
	if actor.ID != 0 {
		a = actor.ID
	}
	return f.row(`INSERT INTO activity_events (organization_id, actor_user_id, action, resource, resource_uuid)
		VALUES ($1, $2, $3, $4, $5) RETURNING id, uuid`, org.ID, a, action, resource, resourceUUID)
}

// NewFixtures returns fixtures on a fresh, fully migrated database created
// on TEST_DATABASE_URL's server, or skips the test when it is not set.
func NewFixtures(t testing.TB) *Fixtures {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	dsn := FreshDatabase(t, base)
	pool, err := database.NewPoolFromDSN(context.Background(), dsn)
	if err != nil {
		t.Fatalf("dbtest: pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return &Fixtures{T: t, Pool: pool}
}
