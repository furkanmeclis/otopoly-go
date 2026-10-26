package usecase

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

// update_finance_entry corrects a manual entry in place and moves its balance
// effect between accounts; document entries are refused, other organizations
// get not found.
func TestUpdateTransactionMovesBalances(t *testing.T) {
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
	user := fx.User()
	if err := SeedDefaults(ctx, q, org.ID); err != nil {
		t.Fatal(err)
	}
	svc := New(pool, q, nil)
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID, UUID: org.UUID})
	accs, _, err := svc.ListAccounts(octx, 10, 0, "", nil)
	if err != nil || len(accs) != 1 {
		t.Fatalf("accounts = %v %v", accs, err)
	}
	kasa := accs[0]
	bank, err := svc.CreateAccount(octx, CreateAccountInput{Name: "Banka", Type: "bank", Currency: "TRY"})
	if err != nil {
		t.Fatal(err)
	}
	cats, err := svc.ListCategories(octx, "expense", nil)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]uuid.UUID{}
	for _, c := range cats {
		byName[c.Name] = c.UUID
	}
	kira, genel := byName["Kira"], byName["Genel Gider"]
	tx, err := svc.CreateTransaction(octx, user.ID, CreateTransactionInput{Type: "expense", AccountUUID: kasa.UUID, CategoryUUID: &kira, Amount: "100", TransactionDate: "2026-10-01"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	balance := func(id uuid.UUID) string {
		a, err := svc.GetAccount(octx, id)
		if err != nil {
			t.Fatal(err)
		}
		return a.CurrentBalance
	}
	if b := balance(kasa.UUID); b != "-100.00" {
		t.Fatalf("kasa after create = %s", b)
	}

	amount, date, desc := "150", "2026-10-02", "düzeltme"
	got, err := svc.UpdateTransaction(octx, user.ID, tx.UUID, UpdateTransactionInput{
		AccountUUID: &bank.UUID, CategoryUUID: &genel, Amount: &amount, TransactionDate: &date, Description: &desc,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.AccountUUID != bank.UUID || got.Amount != "150.00" || got.TransactionDate != date || got.CategoryName == nil || *got.CategoryName != "Genel Gider" {
		t.Fatalf("updated = %+v", got)
	}
	if k, b := balance(kasa.UUID), balance(bank.UUID); k != "0.00" || b != "-150.00" {
		t.Fatalf("balances kasa=%s bank=%s", k, b)
	}
	// An income category on an expense is refused.
	income, _ := svc.ListCategories(octx, "income", nil)
	if _, err := svc.UpdateTransaction(octx, user.ID, tx.UUID, UpdateTransactionInput{CategoryUUID: &income[0].UUID}, nil); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("kind mismatch = %v", err)
	}

	// Document entries are never edited here.
	fx.Exec(`UPDATE finance_transactions SET source_type = 'service_job' WHERE uuid = $1`, tx.UUID)
	if _, err := svc.UpdateTransaction(octx, user.ID, tx.UUID, UpdateTransactionInput{Amount: &amount}, nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("sourced entry = %v", err)
	}
	if b := balance(bank.UUID); b != "-150.00" {
		t.Fatalf("refused update moved money: %s", b)
	}

	octxOther := orgctx.WithScope(ctx, orgctx.Scope{InternalID: other.ID, UUID: other.UUID})
	if _, err := svc.UpdateTransaction(octxOther, user.ID, tx.UUID, UpdateTransactionInput{Description: &desc}, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other org = %v", err)
	}
}
