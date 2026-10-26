package usecase

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testDSN(t *testing.T) string {
	t.Helper()
	for _, k := range []string{"TEST_DATABASE_URL", "DATABASE_URL"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	t.Skip("TEST_DATABASE_URL not set")
	return ""
}

// Unpaid jobs (what get_customer_account shows next to the cari ledger) use
// the same rule as the customer summary's unpaid_amount, stay inside the
// organization and match plates without spaces.
func TestUnpaidJobsMatchCustomerSummary(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	fx := &dbtest.Fixtures{T: t, Pool: pool}
	org, other := fx.Organization(), fx.Organization()
	user := fx.User()
	cust := fx.Customer(org, "Unpaid Customer")
	veh := fx.Vehicle(org, cust)
	var plate string
	if err := pool.QueryRow(ctx, `SELECT plate FROM customer_vehicles WHERE id = $1`, veh.ID).Scan(&plate); err != nil {
		t.Fatal(err)
	}
	job := func(status, payment, total string) uuid.UUID {
		j := fx.Job(org, cust, veh, user)
		fx.Exec(`UPDATE service_jobs SET status = $2, payment_status = $3, total_amount = $4, plate = $5 WHERE id = $1`, j.ID, status, payment, total, plate)
		return j.UUID
	}
	j1 := job("in_progress", "unpaid", "100.00")
	job("ready", "unpaid", "200.00")
	job("delivered", "unpaid", "300.00")
	job("delivered", "paid", "400.00")
	job("cancelled", "unpaid", "500.00")
	job("voided", "paid", "600.00")

	svc := New(pool, q, nil, nil, nil)
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID})
	got, err := svc.UnpaidByCustomer(octx, cust.UUID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if got.Count != 3 || got.TotalAmount != "600.00" || len(got.Jobs) != 2 {
		t.Fatalf("unpaid = %+v", got)
	}
	stats, err := q.GetCustomerJobStats(ctx, db.GetCustomerJobStatsParams{OrganizationID: org.ID, CustomerID: cust.ID})
	if err != nil {
		t.Fatal(err)
	}
	if summary := financeusecase.NumericToString(stats.UnpaidAmount); summary != got.TotalAmount || stats.UnpaidJobCount != got.Count {
		t.Fatalf("customer summary %s/%d != tool %s/%d", summary, stats.UnpaidJobCount, got.TotalAmount, got.Count)
	}

	totals, err := svc.UnpaidTotalsByCustomers(octx, []uuid.UUID{cust.UUID, uuid.New()})
	if err != nil || len(totals) != 1 || totals[cust.UUID].TotalAmount != "600.00" {
		t.Fatalf("totals = %+v %v", totals, err)
	}

	// Another organization sees neither the customer nor its totals.
	octxOther := orgctx.WithScope(ctx, orgctx.Scope{InternalID: other.ID})
	if _, err := svc.UnpaidByCustomer(octxOther, cust.UUID, 5); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other org = %v", err)
	}
	if totals, err := svc.UnpaidTotalsByCustomers(octxOther, []uuid.UUID{cust.UUID}); err != nil || len(totals) != 0 {
		t.Fatalf("other org totals = %+v %v", totals, err)
	}

	// The jobs list finds the plate typed with spaces and in lower case.
	spaced := strings.ToLower(plate[:2] + " " + plate[2:4] + " " + plate[4:])
	rows, total, err := svc.List(octx, 50, 0, ListFilters{Q: spaced, Status: "in_progress"})
	if err != nil || total != 1 || rows[0].UUID != j1 {
		t.Fatalf("plate search %q = %d %v", spaced, total, err)
	}
	if _, total, _ := svc.List(octxOther, 50, 0, ListFilters{Q: spaced}); total != 0 {
		t.Fatalf("other org sees %d jobs", total)
	}
}
