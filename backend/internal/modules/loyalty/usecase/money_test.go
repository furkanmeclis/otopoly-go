package usecase

import (
	"math/big"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestMoneyHelpers(t *testing.T) {
	var n pgtype.Numeric
	_ = n.Scan("123.456")
	if got := numMoney(n); got != "123.46" {
		t.Fatalf("numMoney = %s", got)
	}
	if r, ok := parseMoney("1250,5"); !ok || money(r) != "1250.50" {
		t.Fatalf("parseMoney comma = %v %v", r, ok)
	}
	if _, ok := parseMoney("-1"); ok {
		t.Fatal("negative must fail")
	}
	if _, ok := parseMoney("abc"); ok {
		t.Fatal("garbage must fail")
	}
	if got := money(big.NewRat(-5, 1000)); got != "-0.01" {
		t.Fatalf("round half away = %s", got)
	}
	var q pgtype.Numeric
	_ = q.Scan("2.500")
	if wholeUnits(q) != 2 {
		t.Fatalf("wholeUnits(2.5) = %d", wholeUnits(q))
	}
}
