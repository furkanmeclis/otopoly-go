package usecase

import (
	"math/big"
	"strings"
	"testing"
)

func sumLines(t *testing.T, tot Totals, pick func(LineAmounts) string) string {
	t.Helper()
	s := new(big.Rat)
	for _, l := range tot.Lines {
		r, ok := new(big.Rat).SetString(pick(l))
		if !ok {
			t.Fatalf("bad amount %q", pick(l))
		}
		s.Add(s, r)
	}
	return s.FloatString(2)
}

func TestComputeTotalsVATInclusive(t *testing.T) {
	tot, err := ComputeTotals([]TotalsLine{
		{Quantity: "2", UnitPrice: "150", VATRate: "20"},
		{Quantity: "1", UnitPrice: "99.99", VATRate: "20", DiscountType: DiscountPercent, DiscountValue: "10"},
	}, DiscountNone, "", true)
	if err != nil {
		t.Fatal(err)
	}
	// 300 + 99.99; line discount 10% of 99.99 = 10.00 (9.999 → 10.00)
	if tot.Subtotal != "399.99" || tot.LineDiscount != "10.00" || tot.DiscountTotal != "10.00" {
		t.Fatalf("subtotal/discount: %+v", tot)
	}
	if tot.GrandTotal != "389.99" {
		t.Fatalf("grand=%s", tot.GrandTotal)
	}
	// inclusive VAT: 300*20/120 = 50.00; 89.99*20/120 = 14.998 → 15.00
	if tot.VATTotal != "65.00" || tot.Lines[1].VAT != "15.00" {
		t.Fatalf("vat=%s line=%s", tot.VATTotal, tot.Lines[1].VAT)
	}
}

func TestComputeTotalsVATExclusive(t *testing.T) {
	tot, err := ComputeTotals([]TotalsLine{
		{Quantity: "3", UnitPrice: "33.33", VATRate: "20"},
		{Quantity: "1.5", UnitPrice: "10", VATRate: "10"},
	}, DiscountNone, "0", false)
	if err != nil {
		t.Fatal(err)
	}
	// 99.99 + 15.00; VAT 20.00 (19.998) + 1.50; grand 136.49
	if tot.Subtotal != "114.99" || tot.VATTotal != "21.50" || tot.GrandTotal != "136.49" {
		t.Fatalf("%+v", tot)
	}
	if got := sumLines(t, tot, func(l LineAmounts) string { return l.Total }); got != tot.GrandTotal {
		t.Fatalf("line totals %s != grand %s", got, tot.GrandTotal)
	}
}

func TestComputeTotalsQuoteDiscountAllocation(t *testing.T) {
	// Three equal lines, 10.00 quote discount → 3.33 + 3.33 + 3.34.
	lines := []TotalsLine{
		{Quantity: "1", UnitPrice: "100", VATRate: "20"},
		{Quantity: "1", UnitPrice: "100", VATRate: "20"},
		{Quantity: "1", UnitPrice: "100", VATRate: "20"},
	}
	tot, err := ComputeTotals(lines, DiscountAmount, "10", true)
	if err != nil {
		t.Fatal(err)
	}
	if tot.QuoteDiscount != "10.00" || tot.GrandTotal != "290.00" {
		t.Fatalf("%+v", tot)
	}
	if got := sumLines(t, tot, func(l LineAmounts) string { return l.QuoteDiscountShare }); got != "10.00" {
		t.Fatalf("allocated %s", got)
	}
	if tot.Lines[2].QuoteDiscountShare != "3.34" {
		t.Fatalf("remainder should land on the last line: %+v", tot.Lines)
	}
	if got := sumLines(t, tot, func(l LineAmounts) string { return l.Total }); got != tot.GrandTotal {
		t.Fatalf("line totals %s != grand %s", got, tot.GrandTotal)
	}

	// Percent quote discount on top of a line discount.
	tot, err = ComputeTotals([]TotalsLine{
		{Quantity: "2", UnitPrice: "150", VATRate: "20", DiscountType: DiscountAmount, DiscountValue: "20"},
		{Quantity: "1", UnitPrice: "0", VATRate: "20"},
	}, DiscountPercent, "5", false)
	if err != nil {
		t.Fatal(err)
	}
	// 300-20=280; 5% = 14.00; net 266; vat 53.20; grand 319.20
	if tot.DiscountTotal != "34.00" || tot.VATTotal != "53.20" || tot.GrandTotal != "319.20" {
		t.Fatalf("%+v", tot)
	}
	if tot.Lines[1].QuoteDiscountShare != "0.00" {
		t.Fatalf("zero line must get no share: %+v", tot.Lines[1])
	}
}

func TestComputeTotalsDiscountCapsAndRounding(t *testing.T) {
	tot, err := ComputeTotals([]TotalsLine{
		{Quantity: "1", UnitPrice: "50", VATRate: "0", DiscountType: DiscountAmount, DiscountValue: "80"},
	}, DiscountAmount, "5", true)
	if err != nil {
		t.Fatal(err)
	}
	if tot.LineDiscount != "50.00" || tot.QuoteDiscount != "0.00" || tot.GrandTotal != "0.00" {
		t.Fatalf("discounts must be capped: %+v", tot)
	}
	// Half-up: 0.125 → 0.13 (qty 1 × 0.125 unit price rounds the price first).
	tot, err = ComputeTotals([]TotalsLine{{Quantity: "1", UnitPrice: "0.125", VATRate: "0"}}, DiscountNone, "", true)
	if err != nil || tot.GrandTotal != "0.13" {
		t.Fatalf("rounding: %+v %v", tot, err)
	}
	// Comma decimals are accepted.
	tot, err = ComputeTotals([]TotalsLine{{Quantity: "2,5", UnitPrice: "10,10", VATRate: "20"}}, DiscountNone, "", true)
	if err != nil || tot.Subtotal != "25.25" {
		t.Fatalf("comma: %+v %v", tot, err)
	}
}

func TestComputeTotalsValidation(t *testing.T) {
	cases := []struct {
		name  string
		lines []TotalsLine
		dt    string
		dv    string
		want  string
	}{
		{"zero qty", []TotalsLine{{Quantity: "0", UnitPrice: "1"}}, "", "", "quantity"},
		{"negative price", []TotalsLine{{Quantity: "1", UnitPrice: "-1"}}, "", "", "negative"},
		{"percent over 100", []TotalsLine{{Quantity: "1", UnitPrice: "1", DiscountType: DiscountPercent, DiscountValue: "101"}}, "", "", "between 0 and 100"},
		{"vat over 100", []TotalsLine{{Quantity: "1", UnitPrice: "1", VATRate: "120"}}, "", "", "vat_rate"},
		{"bad discount type", []TotalsLine{{Quantity: "1", UnitPrice: "1"}}, "free", "", "discount_type"},
		{"not a number", []TotalsLine{{Quantity: "x", UnitPrice: "1"}}, "", "", "not a number"},
	}
	for _, c := range cases {
		_, err := ComputeTotals(c.lines, c.dt, c.dv, true)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err=%v want %q", c.name, err, c.want)
		}
	}
}
