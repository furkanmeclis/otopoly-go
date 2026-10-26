package bizday

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	dailysummary "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/dailysummary/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	purchasesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases/usecase"
	reportsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reports/usecase"
	salesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/sales/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// lateNight is the owner's report: a record saved at 01:38 on 27.10.2026 in
// Türkiye (= 26.10.2026 22:38 UTC) landed on 26.10.
var lateNight = time.Date(2026, 10, 26, 22, 38, 0, 0, time.UTC)

const trDay = "2026-10-27"

func clock() time.Time { return lateNight }

func dsn(t *testing.T) string {
	t.Helper()
	for _, k := range []string{"TEST_DATABASE_URL", "DATABASE_URL"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	t.Skip("TEST_DATABASE_URL not set")
	return ""
}

func openPool(t *testing.T, url string) *pgxpool.Pool {
	t.Helper()
	pool, err := database.NewPoolFromDSN(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// The app pool runs every session in Europe/Istanbul, so SQL day arithmetic
// (::date, date_trunc, CURRENT_DATE, date -> timestamptz) follows Türkiye's
// calendar, and explicit AT TIME ZONE expressions keep their meaning.
func TestSessionTimeZoneIsIstanbul(t *testing.T) {
	ctx := context.Background()
	pool := openPool(t, dsn(t))
	var tz, castDay, atTZDay, utcDay, monthStart, dayStartUTC string
	err := pool.QueryRow(ctx, `SELECT current_setting('TimeZone'),
		($1::timestamptz)::date::text,
		(($1::timestamptz) AT TIME ZONE 'Europe/Istanbul')::date::text,
		(($1::timestamptz) AT TIME ZONE 'UTC')::date::text,
		(date_trunc('month', '2026-10-31T22:30:00Z'::timestamptz) AT TIME ZONE 'UTC')::text,
		(('2026-10-27'::date)::timestamptz AT TIME ZONE 'UTC')::text`, lateNight).
		Scan(&tz, &castDay, &atTZDay, &utcDay, &monthStart, &dayStartUTC)
	if err != nil {
		t.Fatal(err)
	}
	if tz != database.SessionTimeZone {
		t.Fatalf("session TimeZone = %q", tz)
	}
	if castDay != trDay || atTZDay != trDay {
		t.Fatalf("::date = %s, AT TIME ZONE Istanbul = %s, want %s", castDay, atTZDay, trDay)
	}
	if utcDay != "2026-10-26" {
		t.Fatalf("explicit UTC day = %s", utcDay)
	}
	// 31.10 22:30Z is 01.11 in Türkiye: the month bucket is November, whose
	// start is 31.10 21:00 UTC.
	if monthStart != "2026-10-31 21:00:00" {
		t.Fatalf("date_trunc month = %s", monthStart)
	}
	if dayStartUTC != "2026-10-26 21:00:00" {
		t.Fatalf("date -> timestamptz = %s", dayStartUTC)
	}
	// Timestamps stay instants: pgx returns the same moment.
	var back time.Time
	if err := pool.QueryRow(ctx, `SELECT $1::timestamptz`, lateNight).Scan(&back); err != nil || !back.Equal(lateNight) {
		t.Fatalf("round trip = %s %v", back, err)
	}
}

type env struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	q        *db.Queries
	fx       *dbtest.Fixtures
	org      dbtest.Row
	user     dbtest.Row
	customer dbtest.Row
	vehicle  dbtest.Row
	kasa     uuid.UUID
	finance  *financeusecase.Service
	cari     *cariusecase.Service
}

func setup(t *testing.T) *env {
	t.Helper()
	ctx := context.Background()
	pool := openPool(t, dsn(t))
	q := db.New(pool)
	fx := &dbtest.Fixtures{T: t, Pool: pool}
	e := &env{pool: pool, q: q, fx: fx, org: fx.Organization(), user: fx.User()}
	if err := financeusecase.SeedDefaults(ctx, q, e.org.ID); err != nil {
		t.Fatal(err)
	}
	e.customer = fx.Customer(e.org, "Gece Müşterisi")
	e.vehicle = fx.Vehicle(e.org, e.customer)
	e.ctx = authctx.WithPrincipal(
		orgctx.WithScope(ctx, orgctx.Scope{InternalID: e.org.ID, UUID: e.org.UUID}),
		authctx.Principal{UserInternal: e.user.ID},
	)
	e.finance = financeusecase.New(pool, q, nil)
	e.finance.SetClock(clock)
	e.cari = cariusecase.New(pool, q, nil, e.finance)
	accs, _, err := e.finance.ListAccounts(e.ctx, 10, 0, "", nil)
	if err != nil || len(accs) == 0 {
		t.Fatalf("accounts = %v %v", accs, err)
	}
	e.kasa = accs[0].UUID
	return e
}

func (e *env) financeDate(t *testing.T, sourceType string, sourceUUID uuid.UUID) string {
	t.Helper()
	var d string
	if err := e.pool.QueryRow(context.Background(), `SELECT transaction_date::text FROM finance_transactions
		WHERE organization_id = $1 AND source_type = $2 AND source_uuid = $3`, e.org.ID, sourceType, sourceUUID).Scan(&d); err != nil {
		t.Fatalf("finance tx of %s %s: %v", sourceType, sourceUUID, err)
	}
	return d
}

func (e *env) cariDate(t *testing.T, sourceType string, sourceUUID uuid.UUID) string {
	t.Helper()
	var d string
	if err := e.pool.QueryRow(context.Background(), `SELECT entry_date::text FROM cari_entries
		WHERE organization_id = $1 AND source_type = $2 AND source_uuid = $3`, e.org.ID, sourceType, sourceUUID).Scan(&d); err != nil {
		t.Fatalf("cari entry of %s %s: %v", sourceType, sourceUUID, err)
	}
	return d
}

// A job opened and closed at 01:38 Türkiye time is dated 27.10 (finance and
// cari), the 27.10 day filter lists it and "today" at that instant is 27.10.
func TestJobClosedAfterMidnightIsDatedIstanbulDay(t *testing.T) {
	e := setup(t)
	jobs := jobsusecase.New(e.pool, e.q, nil, e.finance, e.cari)
	jobs.SetClock(clock)

	closeJob := func(method string) uuid.UUID {
		t.Helper()
		j := e.fx.Job(e.org, e.customer, e.vehicle, e.user)
		e.fx.Exec(`UPDATE service_jobs SET total_amount = 150, started_at = $2 WHERE id = $1`, j.ID, lateNight)
		in := jobsusecase.CloseInput{Method: method}
		if method != "cari" {
			in.FinanceAccountUUID = &e.kasa
		}
		if _, err := jobs.Close(e.ctx, j.UUID, in); err != nil {
			t.Fatalf("close %s: %v", method, err)
		}
		return j.UUID
	}
	cashJob := closeJob("cash")
	cariJob := closeJob("cari")

	paymentOf := func(job uuid.UUID) uuid.UUID {
		var p uuid.UUID
		if err := e.pool.QueryRow(context.Background(), `SELECT p.uuid FROM service_job_payments p
			JOIN service_jobs j ON j.id = p.job_id WHERE j.uuid = $1`, job).Scan(&p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	if got := e.financeDate(t, financeusecase.SourceServiceJob, paymentOf(cashJob)); got != trDay {
		t.Fatalf("job finance transaction_date = %s, want %s", got, trDay)
	}
	if got := e.cariDate(t, financeusecase.SourceServiceJob, paymentOf(cariJob)); got != trDay {
		t.Fatalf("job cari entry_date = %s, want %s", got, trDay)
	}

	// The 27.10 day filter (HTTP default zone) includes both jobs.
	_, total, err := jobs.List(e.ctx, 50, 0, jobsusecase.ListFilters{DateFrom: trDay, DateTo: trDay})
	if err != nil || total != 2 {
		t.Fatalf("jobs on %s = %d %v", trDay, total, err)
	}
	if _, total, _ := jobs.List(e.ctx, 50, 0, jobsusecase.ListFilters{DateFrom: "2026-10-26", DateTo: "2026-10-26"}); total != 0 {
		t.Fatalf("jobs on 26.10 = %d, want 0", total)
	}
	// "Today" (no date) at 22:38Z is 27.10 and counts the paid jobs.
	sum, err := jobs.Summary(e.ctx, "")
	if err != nil || sum.Date != trDay || sum.JobCount != 2 {
		t.Fatalf("job summary = %+v %v", sum, err)
	}

	// Finance list filter for 27.10 finds the job income.
	_, n, err := e.finance.ListTransactions(e.ctx, 50, 0, financeusecase.TransactionFilters{DateFrom: trDay, DateTo: trDay})
	if err != nil || n != 1 {
		t.Fatalf("finance on %s = %d %v", trDay, n, err)
	}

	// Daily summary "today" at that instant is 27.10 and includes the jobs.
	ds := dailysummary.New(e.q, nil, nil)
	ds.SetClock(clock)
	prev, err := ds.Preview(e.ctx, e.org.ID)
	if err != nil || prev.Date != trDay {
		t.Fatalf("daily summary preview = %+v %v", prev, err)
	}
	loc, _ := time.LoadLocation("Europe/Istanbul")
	rep, err := ds.BuildReport(e.ctx, e.org.ID, time.Date(2026, 10, 27, 0, 0, 0, 0, loc))
	if err != nil || rep.JobCount != 2 || rep.PaidTotal != 300 {
		t.Fatalf("daily report = jobs %d paid %.2f %v", rep.JobCount, rep.PaidTotal, err)
	}

	// Reports: the default range ends today (27.10) and the timeseries
	// buckets the jobs on 27.10.
	reports := reportsusecase.New(e.q)
	reports.SetClock(clock)
	ov, err := reports.Overview(e.ctx, reportsusecase.Query{})
	if err != nil {
		t.Fatal(err)
	}
	if ov.Filters.DateFrom != "2026-10-01" || ov.Filters.DateTo != trDay {
		t.Fatalf("report range = %s – %s", ov.Filters.DateFrom, ov.Filters.DateTo)
	}
	if ov.KPIs.JobPaidCount != 2 || ov.KPIs.TotalIncome != "150.00" {
		t.Fatalf("report kpis = jobs %d income %s", ov.KPIs.JobPaidCount, ov.KPIs.TotalIncome)
	}
	ov, err = reports.Overview(e.ctx, reportsusecase.Query{DateFrom: trDay, DateTo: trDay})
	if err != nil || len(ov.Timeseries) != 1 || ov.Timeseries[0].Date != trDay || ov.Timeseries[0].JobCount != 2 {
		t.Fatalf("report timeseries = %+v %v", ov.Timeseries, err)
	}
	if ov.KPIs.JobPaidCount != 2 {
		t.Fatalf("report 27.10 jobs = %d", ov.KPIs.JobPaidCount)
	}

	// Finance summary default range: this month up to today (27.10).
	fs, err := e.finance.Summary(e.ctx, "", "", "")
	if err != nil || fs.DateFrom != "2026-10-01" || fs.DateTo != trDay || fs.TotalIncome != "150.00" {
		t.Fatalf("finance summary = %+v %v", fs, err)
	}
}

// A sale and a purchase recorded at 01:38 Türkiye time (server clock or a
// UTC "Z" timestamp from the client) are dated 27.10.
func TestSaleAndPurchaseAfterMidnightAreDatedIstanbulDay(t *testing.T) {
	e := setup(t)
	var product uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO products (organization_id, name, sale_price, cost_price, stock_quantity, vat_rate, unit)
		VALUES ($1, 'Gece Ürünü', 50, 20, 100, 20, 'adet') RETURNING uuid`, e.org.ID).Scan(&product); err != nil {
		t.Fatal(err)
	}
	sales := salesusecase.New(e.pool, e.q, nil, e.finance, e.cari)
	sales.SetClock(clock)
	one := "1"
	cashSale, err := sales.Create(e.ctx, salesusecase.CreateInput{
		Method: "cash", FinanceAccountUUID: &e.kasa, Lines: []salesusecase.CreateLineInput{{ProductUUID: product, Qty: &one}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := e.financeDate(t, financeusecase.SourceProductSale, cashSale.UUID); got != trDay {
		t.Fatalf("sale finance date = %s, want %s", got, trDay)
	}
	zulu := "2026-10-26T22:38:00Z"
	cariSale, err := sales.Create(e.ctx, salesusecase.CreateInput{
		Method: "cari", CustomerUUID: &e.customer.UUID, SoldAt: &zulu, Lines: []salesusecase.CreateLineInput{{ProductUUID: product, Qty: &one}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := e.cariDate(t, financeusecase.SourceProductSale, cariSale.UUID); got != trDay {
		t.Fatalf("sale cari date = %s, want %s", got, trDay)
	}
	if _, total, err := sales.List(e.ctx, 50, 0, salesusecase.ListFilters{DateFrom: trDay, DateTo: trDay}); err != nil || total != 2 {
		t.Fatalf("sales on %s = %d %v", trDay, total, err)
	}
	if sum, err := sales.Summary(e.ctx, ""); err != nil || sum.Date != trDay || sum.SaleCount != 2 {
		t.Fatalf("sales summary = %+v %v", sum, err)
	}

	supplier := e.fx.Supplier(e.org, "Gece Tedarik")
	purchases := purchasesusecase.New(e.pool, e.q, nil, e.finance)
	purchases.SetClock(clock)
	cost := "20"
	p, err := purchases.Create(e.ctx, purchasesusecase.CreateInput{
		SupplierUUID: supplier.UUID, Method: "cash", FinanceAccountUUID: e.kasa,
		Lines: []purchasesusecase.CreateLineInput{{ProductUUID: product, UnitCost: &cost, Qty: &one}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := e.financeDate(t, financeusecase.SourcePurchase, p.UUID); got != trDay {
		t.Fatalf("purchase finance date = %s, want %s", got, trDay)
	}
	if _, total, err := purchases.List(e.ctx, 50, 0, purchasesusecase.ListFilters{DateFrom: trDay, DateTo: trDay}); err != nil || total != 1 {
		t.Fatalf("purchases on %s = %d %v", trDay, total, err)
	}
}

// Migration 000097 re-dates only system-derived entries that the UTC bug put
// on the previous day; user-chosen dates stay as they are.
func TestBusinessDayRepairMigration(t *testing.T) {
	fx := dbtest.NewFixtures(t)
	ctx := context.Background()
	pool := fx.Pool
	org, user := fx.Organization(), fx.User()
	if err := financeusecase.SeedDefaults(ctx, db.New(pool), org.ID); err != nil {
		t.Fatal(err)
	}
	cust := fx.Customer(org, "Onarım")
	veh := fx.Vehicle(org, cust)
	job := fx.Job(org, cust, veh, user)
	var accountID int64
	if err := pool.QueryRow(ctx, `SELECT id FROM finance_accounts WHERE organization_id = $1 LIMIT 1`, org.ID).Scan(&accountID); err != nil {
		t.Fatal(err)
	}
	cariAcc := fx.CariEntry(org, cust, user) // creates the cari account
	var cariAccountID int64
	if err := pool.QueryRow(ctx, `SELECT account_id FROM cari_entries WHERE id = $1`, cariAcc.ID).Scan(&cariAccountID); err != nil {
		t.Fatal(err)
	}

	scanUUID := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var id uuid.UUID
		if err := pool.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	payment := scanUUID(`INSERT INTO service_job_payments (organization_id, job_id, method, amount, created_by, created_at)
		VALUES ($1, $2, 'cash', 10, $3, $4) RETURNING uuid`, org.ID, job.ID, user.ID, lateNight)
	sale := scanUUID(`INSERT INTO product_sales (organization_id, customer_id, method, total_amount, created_by, sold_at)
		VALUES ($1, $2, 'cari', 10, $3, $4) RETURNING uuid`, org.ID, cust.ID, user.ID, lateNight)
	daytimeSale := scanUUID(`INSERT INTO product_sales (organization_id, method, total_amount, created_by, sold_at)
		VALUES ($1, 'cash', 10, $2, '2026-10-26T10:00:00Z') RETURNING uuid`, org.ID, user.ID)
	supplier := fx.Supplier(org, "Onarım Tedarik")
	purchase := scanUUID(`INSERT INTO purchases (organization_id, supplier_id, method, total_amount, created_by, purchased_at)
		VALUES ($1, $2, 'cash', 10, $3, $4) RETURNING uuid`, org.ID, supplier.ID, user.ID, lateNight)

	ft := func(typ, source string, src *uuid.UUID, date string) uuid.UUID {
		return scanUUID(`INSERT INTO finance_transactions (organization_id, type, account_id, amount, currency, transaction_date, created_by, source_type, source_uuid)
			VALUES ($1, $2, $3, 10, 'TRY', $4::date, $5, NULLIF($6, ''), $7) RETURNING uuid`, org.ID, typ, accountID, date, user.ID, source, src)
	}
	ce := func(source string, src *uuid.UUID, date string) uuid.UUID {
		return scanUUID(`INSERT INTO cari_entries (organization_id, account_id, type, amount, balance_after, entry_date, created_by, source_type, source_uuid)
			VALUES ($1, $2, 'charge', 10, 10, $3::date, $4, NULLIF($5, ''), $6) RETURNING uuid`, org.ID, cariAccountID, date, user.ID, source, src)
	}
	wrongJob := ft("income", "service_job", &payment, "2026-10-26")
	wrongSale := ce("product_sale", &sale, "2026-10-26")
	wrongPurchase := ft("expense", "purchase", &purchase, "2026-10-26")
	okDaytime := ft("income", "product_sale", &daytimeSale, "2026-10-26")
	manual := ft("income", "", nil, "2026-10-26")
	cariPayment := ft("income", "cari_payment", &sale, "2026-10-26")
	manualCari := ce("", nil, "2026-10-26")

	upSQL, err := os.ReadFile(migrationPath(t, "000097_business_day_repair.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	// Twice: the repair is idempotent.
	for i := 0; i < 2; i++ {
		if _, err := pool.Exec(ctx, string(upSQL)); err != nil {
			t.Fatal(err)
		}
	}
	date := func(table, col string, id uuid.UUID) string {
		t.Helper()
		var d string
		if err := pool.QueryRow(ctx, `SELECT `+col+`::text FROM `+table+` WHERE uuid = $1`, id).Scan(&d); err != nil {
			t.Fatal(err)
		}
		return d
	}
	for name, c := range map[string]struct {
		got, want string
	}{
		"job payment finance":    {date("finance_transactions", "transaction_date", wrongJob), trDay},
		"sale cari":              {date("cari_entries", "entry_date", wrongSale), trDay},
		"purchase finance":       {date("finance_transactions", "transaction_date", wrongPurchase), trDay},
		"daytime sale untouched": {date("finance_transactions", "transaction_date", okDaytime), "2026-10-26"},
		"manual untouched":       {date("finance_transactions", "transaction_date", manual), "2026-10-26"},
		"cari payment untouched": {date("finance_transactions", "transaction_date", cariPayment), "2026-10-26"},
		"manual cari untouched":  {date("cari_entries", "entry_date", manualCari), "2026-10-26"},
	} {
		if c.got != c.want {
			t.Errorf("%s: date = %s, want %s", name, c.got, c.want)
		}
	}
}

func migrationPath(t *testing.T, name string) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate test file")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "migrations", name)
}
