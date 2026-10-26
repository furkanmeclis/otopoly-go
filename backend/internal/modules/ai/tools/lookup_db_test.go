package tools

import (
	"context"
	"os"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// The identity lookup behind create_customer duplicates and quick_job:
// phone by its last 10 digits, plate ignoring spaces and case, one
// organization only.
func TestFindCustomersByPhoneOrPlateDB(t *testing.T) {
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
	q := db.New(pool)
	fx := &dbtest.Fixtures{T: t, Pool: pool}
	org, other := fx.Organization(), fx.Organization()
	ali := fx.Customer(org, "Ali")
	fx.Exec(`UPDATE customers SET phone = '0532 111 22 33' WHERE id = $1`, ali.ID)
	veh := fx.Vehicle(org, ali)
	var plate string
	if err := pool.QueryRow(ctx, `SELECT plate FROM customer_vehicles WHERE id = $1`, veh.ID).Scan(&plate); err != nil {
		t.Fatal(err)
	}
	twin := fx.Customer(other, "Ali (other org)")
	fx.Exec(`UPDATE customers SET phone = '05321112233' WHERE id = $1`, twin.ID)

	find := func(orgID int64, phone, plate string) []db.AIFindCustomersByPhoneOrPlateRow {
		rows, err := q.AIFindCustomersByPhoneOrPlate(ctx, db.AIFindCustomersByPhoneOrPlateParams{
			OrganizationID: orgID, PhoneDigits: phoneKey(phone), Plate: PlateKey(plate), LimitCount: 5,
		})
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	if rows := find(org.ID, "+90 (532) 111-22-33", ""); len(rows) != 1 || rows[0].Uuid != ali.UUID || !rows[0].PhoneMatch || rows[0].PlateVehicleUuid != uuid.Nil {
		t.Fatalf("by phone = %+v", rows)
	}
	spaced := plate[:2] + " " + plate[2:4] + " " + plate[4:]
	if rows := find(org.ID, "", spaced); len(rows) != 1 || rows[0].PlateVehicleUuid != veh.UUID || rows[0].PhoneMatch {
		t.Fatalf("by plate %q = %+v", spaced, rows)
	}
	if rows := find(org.ID, "", plate[:4]); len(rows) != 0 {
		t.Fatalf("partial plate must not match: %+v", rows)
	}
	if rows := find(org.ID, "", ""); len(rows) != 0 {
		t.Fatalf("empty lookup matched: %+v", rows)
	}
	if rows := find(other.ID, "", spaced); len(rows) != 0 {
		t.Fatalf("plate leaked across organizations: %+v", rows)
	}
	if rows := find(other.ID, "0532 111 22 33", ""); len(rows) != 1 || rows[0].Uuid != twin.UUID {
		t.Fatalf("other org phone = %+v", rows)
	}

	// The customer list (search_customers) finds the plate typed with spaces.
	rows, err := q.ListCustomers(ctx, db.ListCustomersParams{OrganizationID: org.ID, Q: pgtype.Text{String: spaced, Valid: true}, Sort: "name", LimitCount: 5})
	if err != nil || len(rows) != 1 || rows[0].Uuid != ali.UUID {
		t.Fatalf("list by spaced plate = %+v %v", rows, err)
	}
}
