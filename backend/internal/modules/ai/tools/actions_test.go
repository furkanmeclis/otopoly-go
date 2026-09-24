package tools

import (
	"testing"

	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/google/uuid"
)

func TestParseAmount(t *testing.T) {
	ok := map[any]string{
		20000.0:     "20000.00",
		"20000":     "20000.00",
		"1.250,50":  "1250.50",
		"₺1.250,5":  "1250.50",
		"99.99":     "99.99",
		"20 000 TL": "20000.00",
	}
	for in, want := range ok {
		a, err := ParseAmount(in)
		if err != nil || a.String() != want {
			t.Errorf("ParseAmount(%v) = %q, %v; want %q", in, a.String(), err, want)
		}
	}
	for _, bad := range []any{0.0, -5.0, "abc", "1.005", nil, 2e9} {
		if _, err := ParseAmount(bad); err == nil {
			t.Errorf("ParseAmount(%v) should fail", bad)
		}
	}
}

func TestResolveAccount(t *testing.T) {
	kasa := financeusecase.Account{UUID: uuid.New(), Name: "Ana Kasa", Type: "cash", Currency: "TRY", IsDefault: true}
	bank := financeusecase.Account{UUID: uuid.New(), Name: "Garanti POS", Type: "bank", Currency: "TRY"}
	usd := financeusecase.Account{UUID: uuid.New(), Name: "Dolar Kasa", Type: "cash", Currency: "USD"}
	all := []financeusecase.Account{kasa, bank, usd}

	if a, err := resolveAccount(all, "", "TRY", "cash", "f"); err != nil || a.UUID != kasa.UUID {
		t.Fatalf("default cash = %v %v", a.Name, err)
	}
	if a, err := resolveAccount(all, "", "TRY", "bank", "f"); err != nil || a.UUID != bank.UUID {
		t.Fatalf("default bank = %v %v", a.Name, err)
	}
	if a, err := resolveAccount(all, "garanti", "", "", "f"); err != nil || a.UUID != bank.UUID {
		t.Fatalf("by name = %v %v", a.Name, err)
	}
	if a, err := resolveAccount(all, "ana kasa", "TRY", "", "f"); err != nil || a.UUID != kasa.UUID {
		t.Fatalf("folded name = %v %v", a.Name, err)
	}
	if _, err := resolveAccount(all, "Dolar Kasa", "TRY", "", "f"); err == nil {
		t.Fatal("currency mismatch must fail")
	}
	if _, err := resolveAccount(all, "yok", "", "", "f"); err == nil {
		t.Fatal("unknown account must fail")
	} else if ie, ok := AsInputError(err); !ok || ie.Msg == "" {
		t.Fatalf("want InputError, got %v", err)
	}
}
