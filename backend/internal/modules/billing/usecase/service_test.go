package usecase

import "testing"

func TestYearlyPrice(t *testing.T) {
	cases := []struct {
		p    Plan
		want string
	}{
		{Plan{PriceMonthly: "100.00", YearlyPricing: "fixed", PriceYearly: "1000.00"}, "1000.00"},
		{Plan{PriceMonthly: "100.00", YearlyPricing: "discount_amount", YearlyDiscountValue: "150"}, "1050.00"},
		{Plan{PriceMonthly: "100.00", YearlyPricing: "discount_percent", YearlyDiscountValue: "10"}, "1080.00"},
		{Plan{PriceMonthly: "100.00", YearlyPricing: "discount_amount", YearlyDiscountValue: "5000"}, "0.00"},
	}
	for _, c := range cases {
		if got := YearlyPrice(c.p); got != c.want {
			t.Errorf("%+v: got %s want %s", c.p, got, c.want)
		}
	}
}
