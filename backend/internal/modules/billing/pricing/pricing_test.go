package pricing

import (
	"testing"
	"time"
)

func testLabels() Labels {
	return Labels{
		Plan:      "%s (%s)",
		Proration: "Kıst iadesi (%s, %d gün)",
		Discount:  "İndirim kodu %s",
		Credit:    "Alacak bakiyesi",
	}
}

func mustIstanbul(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func TestQuoteFromTrial(t *testing.T) {
	loc := mustIstanbul(t)
	now := time.Date(2026, 9, 27, 10, 0, 0, 0, loc)

	q, err := Compute(Input{
		Now: now,
		Loc: loc,
		Current: &Current{
			PlanID:    1,
			PlanRank:  "0.00",
			Period:    "monthly",
			Status:    "trial",
			StartsAt:  now.AddDate(0, 0, -3),
			EndsAt:    now.AddDate(0, 0, 11),
			PricePaid: "0.00",
		},
		Target:  Target{PlanID: 2, PlanName: "Pro", PlanRank: "1000.00", Period: "monthly", ListPrice: "1000.00"},
		VATRate: 20,
		Labels:  testLabels(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if q.Kind != "new" || !q.StartsAt.Equal(now) || q.Total != "1000.00" || q.ProrationCredit != "0.00" {
		t.Fatalf("unexpected quote: %+v", q)
	}
}

func TestQuoteRenewStartsAtOldEnd(t *testing.T) {
	loc := mustIstanbul(t)
	now := time.Date(2026, 9, 27, 10, 0, 0, 0, loc)
	oldEnd := now.AddDate(0, 0, 10)

	q, err := Compute(Input{
		Now: now,
		Loc: loc,
		Current: &Current{
			PlanID:    2,
			PlanRank:  "1000.00",
			Period:    "monthly",
			Status:    "active",
			StartsAt:  now.AddDate(0, 0, -20),
			EndsAt:    oldEnd,
			PricePaid: "1000.00",
		},
		Target:  Target{PlanID: 2, PlanName: "Pro", PlanRank: "1000.00", Period: "monthly", ListPrice: "1000.00"},
		VATRate: 20,
		Labels:  testLabels(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if q.Kind != "renew" || !q.StartsAt.Equal(oldEnd) || q.ProrationCredit != "0.00" {
		t.Fatalf("unexpected quote: %+v", q)
	}
}

func TestQuoteUpgradeProration(t *testing.T) {
	loc := mustIstanbul(t)
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, loc)

	q, err := Compute(Input{
		Now: now,
		Loc: loc,
		Current: &Current{
			PlanID:    1,
			PlanRank:  "1000.00",
			Period:    "monthly",
			Status:    "active",
			StartsAt:  now.AddDate(0, 0, -15),
			EndsAt:    now.AddDate(0, 0, 15),
			PricePaid: "1000.00",
		},
		Target:  Target{PlanID: 2, PlanName: "Pro", PlanRank: "1200.00", Period: "yearly", ListPrice: "10800.00"},
		VATRate: 20,
		Labels:  testLabels(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if q.Kind != "upgrade" || q.ProrationCredit != "500.00" || q.Total != "10300.00" || q.VATAmount != "1716.67" {
		t.Fatalf("unexpected quote: %+v", q)
	}
}

func TestQuoteDowngradeSurplus(t *testing.T) {
	loc := mustIstanbul(t)
	now := time.Date(2026, 9, 27, 10, 0, 0, 0, loc)

	q, err := Compute(Input{
		Now: now,
		Loc: loc,
		Current: &Current{
			PlanID:    2,
			PlanRank:  "750.00",
			Period:    "yearly",
			Status:    "active",
			StartsAt:  now,
			EndsAt:    now.AddDate(1, 0, 0),
			PricePaid: "9000.00",
		},
		Target:  Target{PlanID: 1, PlanName: "Başlangıç", PlanRank: "500.00", Period: "monthly", ListPrice: "500.00"},
		VATRate: 20,
		Labels:  testLabels(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if q.Kind != "downgrade" || q.Total != "0.00" || q.CreditSurplus != "8500.00" {
		t.Fatalf("unexpected quote: %+v", q)
	}
	if len(q.Lines) != 2 || q.Lines[0].Amount != "500.00" || q.Lines[1].Amount != "-500.00" {
		t.Fatalf("unexpected lines: %+v", q.Lines)
	}
}

func TestQuoteDiscountPercentAfterProration(t *testing.T) {
	loc := mustIstanbul(t)
	q, err := Compute(Input{
		Now:      time.Date(2026, 9, 27, 10, 0, 0, 0, loc),
		Loc:      loc,
		Target:   Target{PlanID: 1, PlanName: "Pro", PlanRank: "1000.00", Period: "monthly", ListPrice: "1000.00"},
		Discount: &Discount{Code: "YAZ10", Kind: "percent", Value: "10.00"},
		VATRate:  20,
		Labels:   testLabels(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if q.DiscountAmount != "100.00" || q.Total != "900.00" {
		t.Fatalf("unexpected quote: %+v", q)
	}
}

func TestQuoteDiscountAmountCapped(t *testing.T) {
	loc := mustIstanbul(t)
	q, err := Compute(Input{
		Now:      time.Date(2026, 9, 27, 10, 0, 0, 0, loc),
		Loc:      loc,
		Target:   Target{PlanID: 1, PlanName: "Pro", PlanRank: "1000.00", Period: "monthly", ListPrice: "1000.00"},
		Discount: &Discount{Code: "BIG", Kind: "amount", Value: "5000.00"},
		VATRate:  20,
		Labels:   testLabels(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if q.DiscountAmount != "1000.00" || q.Total != "0.00" {
		t.Fatalf("unexpected quote: %+v", q)
	}
}

func TestQuoteCreditBalanceApplied(t *testing.T) {
	loc := mustIstanbul(t)
	q, err := Compute(Input{
		Now: time.Date(2026, 9, 27, 10, 0, 0, 0, loc),
		Loc: loc,
		Current: &Current{
			PlanID:        1,
			PlanRank:      "1000.00",
			Period:        "monthly",
			Status:        "active",
			CreditBalance: "300.00",
		},
		Target:  Target{PlanID: 2, PlanName: "Pro", PlanRank: "1200.00", Period: "monthly", ListPrice: "1000.00"},
		VATRate: 20,
		Labels:  testLabels(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if q.CreditApplied != "300.00" || q.Total != "700.00" || q.CreditSurplus != "0.00" {
		t.Fatalf("unexpected quote: %+v", q)
	}
}

func TestPeriodEndIstanbul(t *testing.T) {
	loc := mustIstanbul(t)

	monthly := PeriodEnd(time.Date(2026, 1, 31, 10, 0, 0, 0, loc), "monthly", loc)
	if want := time.Date(2026, 3, 3, 10, 0, 0, 0, loc); !monthly.Equal(want) {
		t.Fatalf("monthly end = %s, want %s", monthly, want)
	}

	yearly := PeriodEnd(time.Date(2028, 2, 29, 10, 0, 0, 0, loc), "yearly", loc)
	if want := time.Date(2029, 3, 1, 10, 0, 0, 0, loc); !yearly.Equal(want) {
		t.Fatalf("yearly end = %s, want %s", yearly, want)
	}
}

func TestVATRounding(t *testing.T) {
	got, err := Compute(Input{
		Now:     time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC),
		Target:  Target{PlanID: 1, PlanName: "Pro", PlanRank: "100.00", Period: "monthly", ListPrice: "100.00"},
		VATRate: 20,
		Labels:  testLabels(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.VATAmount != "16.67" {
		t.Fatalf("vat = %s, want 16.67", got.VATAmount)
	}
}

func TestValidateCustom(t *testing.T) {
	opts := []CustomOption{
		{Key: "jobs.daily", Label: "Günlük işlem", Unit: "adet", Min: 30, Max: 200, Step: 10, UnitPrice: "50.00"},
	}

	tests := []struct {
		name    string
		sel     map[string]int64
		want    map[string]int64
		wantErr bool
	}{
		{name: "fills missing with min", sel: nil, want: map[string]int64{"jobs.daily": 30}},
		{name: "rejects off step", sel: map[string]int64{"jobs.daily": 35}, wantErr: true},
		{name: "rejects max overflow", sel: map[string]int64{"jobs.daily": 210}, wantErr: true},
		{name: "rejects unknown key", sel: map[string]int64{"storage.gb": 10}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ValidateCustom(opts, tt.sel)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			for key, want := range tt.want {
				if got[key] != want {
					t.Fatalf("%s=%d, want %d", key, got[key], want)
				}
			}
		})
	}
}

func TestCustomMonthlyBaseValuesAreFree(t *testing.T) {
	got, err := CustomMonthly("2000.00", []CustomOption{
		{Key: "jobs.daily", Label: "Günlük işlem", Unit: "adet", Min: 30, Max: 200, Step: 10, UnitPrice: "50.00"},
		{Key: "staff.count", Label: "Personel", Unit: "kişi", Min: 5, Max: 50, Step: 5, UnitPrice: "100.00"},
	}, map[string]int64{"jobs.daily": 30, "staff.count": 5})
	if err != nil {
		t.Fatal(err)
	}
	if got != "2000.00" {
		t.Fatalf("monthly=%s, want 2000.00", got)
	}
}

func TestCustomYearlyDiscountPercent(t *testing.T) {
	got := CustomYearly(YearlyRule{Kind: "discount_percent", DiscountValue: "10.00"}, "600.00", "2000.00")
	if got != "28080.00" {
		t.Fatalf("yearly=%s, want 28080.00", got)
	}
}

func TestPlanLabelArity(t *testing.T) {
	if got := planLabel("%s (%s)", "Pro", "Yıllık"); got != "Pro (Yıllık)" {
		t.Fatalf("two verbs: %q", got)
	}
	if got := planLabel("%s", "Enterprise (Aylık) · Günlük işlem 120 adet", "Aylık"); got != "Enterprise (Aylık) · Günlük işlem 120 adet" {
		t.Fatalf("one verb: %q", got)
	}
	if got := planLabel("Sabit", "x", "y"); got != "Sabit" {
		t.Fatalf("no verb: %q", got)
	}
}
