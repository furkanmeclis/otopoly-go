package usecase

import (
	"context"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bizclock"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// The day's collections ("tahsilat") are every posted income row of the
// Europe/Istanbul day — job cash/card closes, product sales, cari
// collections, package and subscription sales, manual income — and never
// transfers, voided rows, a job closed on cari, other days or other
// organizations.
func TestDayMoneySourcesAndExclusions_DB(t *testing.T) {
	fx := dbtest.NewFixtures(t)
	ctx := context.Background()
	q := db.New(fx.Pool)
	org, other := fx.Organization(), fx.Organization()
	user := fx.User()
	for _, o := range []dbtest.Row{org, other} {
		if err := SeedDefaults(ctx, q, o.ID); err != nil {
			t.Fatal(err)
		}
	}
	// 2026-10-27 21:30 UTC is 00:30 on 28 October in Türkiye: "today" is the 28th.
	now := time.Date(2026, 10, 27, 21, 30, 0, 0, time.UTC)
	svc := New(fx.Pool, q, nil)
	svc.SetClock(func() time.Time { return now })
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID, UUID: org.UUID})
	accs, _, err := svc.ListAccounts(octx, 10, 0, "", nil)
	if err != nil || len(accs) != 1 {
		t.Fatalf("accounts %v %v", accs, err)
	}
	kasa := accs[0]
	bank, err := svc.CreateAccount(octx, CreateAccountInput{Name: "Banka", Type: "bank", Currency: "TRY"})
	if err != nil {
		t.Fatal(err)
	}
	kasaRow, err := q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{Uuid: kasa.UUID, OrganizationID: org.ID})
	if err != nil {
		t.Fatal(err)
	}
	bankRow, err := q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{Uuid: bank.UUID, OrganizationID: org.ID})
	if err != nil {
		t.Fatal(err)
	}
	income, err := svc.ResolveCategoryIDByName(octx, q, CategoryServiceIncome, "income")
	if err != nil {
		t.Fatal(err)
	}
	today := bizclock.DateOf(now)
	yesterday := pgtype.Date{Time: today.Time.AddDate(0, 0, -1), Valid: true}
	if today.Time.Format(bizclock.DayLayout) != "2026-10-28" {
		t.Fatalf("business day %v", today.Time)
	}
	post := func(c context.Context, account int64, amount, method, source string, day pgtype.Date) {
		t.Helper()
		var n pgtype.Numeric
		if err := n.Scan(amount); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.PostIncomeFromSourceTx(c, q, user.ID, PostFromSourceInput{
			AccountID: account, CategoryID: income, Amount: n, Currency: "TRY", TransactionDate: day,
			PaymentMethod: method, SourceType: source, SourceUUID: uuid.New(),
		}); err != nil {
			t.Fatal(err)
		}
	}
	post(octx, kasaRow.ID, "100", "cash", SourceServiceJob, today)       // job paid cash
	post(octx, bankRow.ID, "250.50", "card", SourceServiceJob, today)    // job paid by card
	post(octx, kasaRow.ID, "40", "cash", SourceProductSale, today)       // product sale
	post(octx, bankRow.ID, "300", "transfer", SourceCariPayment, today)  // cari collection (havale)
	post(octx, kasaRow.ID, "500", "card", "loyalty_package", today)      // package sale
	post(octx, kasaRow.ID, "120", "cash", "loyalty_subscription", today) // subscription payment
	post(octx, kasaRow.ID, "999", "cash", SourceServiceJob, yesterday)   // 27 Oct: not today

	expCats, err := svc.ListCategories(octx, "expense", nil)
	if err != nil || len(expCats) == 0 {
		t.Fatalf("expense categories %v %v", expCats, err)
	}
	incCats, err := svc.ListCategories(octx, "income", nil)
	if err != nil || len(incCats) == 0 {
		t.Fatalf("income categories %v %v", incCats, err)
	}
	expCat, incCat := expCats[0].UUID, incCats[0].UUID
	// Manual income, a manual expense, a voided income and a transfer.
	if _, err := svc.CreateTransaction(octx, user.ID, CreateTransactionInput{Type: "income", AccountUUID: kasa.UUID, CategoryUUID: &incCat, Amount: "30", TransactionDate: "2026-10-28", PaymentMethod: "other"}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateTransaction(octx, user.ID, CreateTransactionInput{Type: "expense", AccountUUID: kasa.UUID, CategoryUUID: &expCat, Amount: "75", TransactionDate: "2026-10-28"}, nil); err != nil {
		t.Fatal(err)
	}
	voided, err := svc.CreateTransaction(octx, user.ID, CreateTransactionInput{Type: "income", AccountUUID: kasa.UUID, CategoryUUID: &incCat, Amount: "1000", TransactionDate: "2026-10-28"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VoidTransaction(octx, user.ID, voided.UUID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateTransfer(octx, user.ID, CreateTransferInput{FromAccountUUID: kasa.UUID, ToAccountUUID: bank.UUID, Amount: "200", TransactionDate: "2026-10-28"}, nil); err != nil {
		t.Fatal(err)
	}
	// A job closed on cari is a receivable: a cari charge, no income row.
	customer := fx.Customer(org, "Veresiye")
	fx.CariEntry(org, customer, user)
	// Another organization's money never leaks in.
	octher := orgctx.WithScope(ctx, orgctx.Scope{InternalID: other.ID, UUID: other.UUID})
	otherAccs, _, err := svc.ListAccounts(octher, 10, 0, "", nil)
	if err != nil || len(otherAccs) != 1 {
		t.Fatalf("other accounts %v %v", otherAccs, err)
	}
	otherKasa, err := q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{Uuid: otherAccs[0].UUID, OrganizationID: other.ID})
	if err != nil {
		t.Fatal(err)
	}
	post(octher, otherKasa.ID, "7777", "cash", SourceServiceJob, today)

	got, err := svc.Today(octx, "", "", 7)
	if err != nil {
		t.Fatal(err)
	}
	if got.Date != "2026-10-28" || got.Currency != "TRY" {
		t.Fatalf("day %s %s", got.Date, got.Currency)
	}
	// 100 + 250.50 + 40 + 300 + 500 + 120 + 30
	if got.CollectedTotal != "1340.50" || got.CollectedCount != 7 {
		t.Fatalf("collected %s (%d)", got.CollectedTotal, got.CollectedCount)
	}
	if got.ByMethod != (MethodTotals{Cash: "260.00", Card: "750.50", Transfer: "300.00", Other: "30.00"}) {
		t.Fatalf("by method %+v", got.ByMethod)
	}
	if got.BySource != (SourceTotals{Jobs: "350.50", Sales: "40.00", Cari: "300.00", Loyalty: "620.00", Manual: "30.00", Other: "0.00"}) {
		t.Fatalf("by source %+v", got.BySource)
	}
	if got.ExpenseTotal != "75.00" || got.Net != "1265.50" {
		t.Fatalf("expense %s net %s", got.ExpenseTotal, got.Net)
	}
	if len(got.Series) != 7 || got.Series[6].Date != "2026-10-28" || got.Series[6].Collected != "1340.50" ||
		got.Series[5].Date != "2026-10-27" || got.Series[5].Collected != "999.00" || got.Series[0].Collected != "0.00" {
		t.Fatalf("series %+v", got.Series)
	}
	if len(got.Accounts) != 2 {
		t.Fatalf("accounts %+v", got.Accounts)
	}

	// Same figure as the finance summary for that day (one definition).
	sum, err := svc.Summary(octx, "2026-10-28", "2026-10-28", "TRY")
	if err != nil {
		t.Fatal(err)
	}
	if sum.TotalIncome != got.CollectedTotal || sum.TotalExpense != got.ExpenseTotal {
		t.Fatalf("summary %s/%s vs today %s/%s", sum.TotalIncome, sum.TotalExpense, got.CollectedTotal, got.ExpenseTotal)
	}

	// One minute before the Istanbul midnight it is still the 27th.
	svc.SetClock(func() time.Time { return time.Date(2026, 10, 27, 20, 59, 0, 0, time.UTC) })
	prev, err := svc.Today(octx, "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if prev.Date != "2026-10-27" || prev.CollectedTotal != "999.00" || len(prev.Series) != 0 {
		t.Fatalf("previous day %+v", prev)
	}
	if _, err := svc.Today(octx, "28.10.2026", "", 7); err == nil {
		t.Fatal("bad date must be rejected")
	}
	if _, err := svc.Today(octx, "", "", 40); err == nil {
		t.Fatal("too many days must be rejected")
	}
}

func TestSourceBucket(t *testing.T) {
	cases := map[string]string{
		SourceServiceJob: BucketJobs, SourceProductSale: BucketSales, SourceCariPayment: BucketCari,
		"loyalty_package": BucketLoyalty, "loyalty_subscription": BucketLoyalty,
		"": BucketManual, "manual": BucketManual, "something_new": BucketOther,
	}
	for in, want := range cases {
		if got := SourceBucket(in); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
}
