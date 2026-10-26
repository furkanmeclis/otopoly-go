package usecase

import (
	"math/big"
	"testing"
)

func rat(s string) *big.Rat {
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		panic(s)
	}
	return r
}

func TestComputeFormula(t *testing.T) {
	cases := []struct {
		name      string
		in        FormulaInput
		suggested string
		packs     string
		urgency   string
		cover     string // "" = nil (no usage)
		velocity  string
	}{
		{
			name: "no consumption, stock above min",
			in:   FormulaInput{Stock: rat("10"), MinStock: rat("2"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			// need = 0 + 2 - 10 < 0
			suggested: "0", urgency: UrgencyNone, cover: "", velocity: "0",
		},
		{
			name:      "no consumption, below min tops up to min",
			in:        FormulaInput{Stock: rat("1"), MinStock: rat("5"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			suggested: "4", urgency: UrgencyBelowMin, cover: "", velocity: "0",
		},
		{
			name:      "no consumption, no min, zero stock is not urgent",
			in:        FormulaInput{Stock: rat("0"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			suggested: "0", urgency: UrgencyNone, cover: "", velocity: "0",
		},
		{
			name: "steady usage",
			// velocity = 30/30 = 1/day; need = 1×17 + 2 - 5 - 0 = 14
			in:        FormulaInput{Stock: rat("5"), MinStock: rat("2"), ConsumedQty: rat("20"), SoldQty: rat("10"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			suggested: "14", urgency: UrgencyLowCover, cover: "5", velocity: "1",
		},
		{
			name: "fractional need rounds up",
			// velocity = 10/30; need = 10/30 × 17 = 5.666… → 6
			in:        FormulaInput{Stock: rat("0.5"), ConsumedQty: rat("10"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			suggested: "6", urgency: UrgencyLowCover, cover: "1.5", velocity: "0.333",
		},
		{
			name: "negative stock is made up",
			// velocity 0, min 0: need = 0 - (-3) = 3
			in:        FormulaInput{Stock: rat("-3"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			suggested: "3", urgency: UrgencyOutOfStock, cover: "", velocity: "0",
		},
		{
			name: "negative stock with usage",
			// velocity 1; need = 17 + 0 + 2 = 19; cover 0
			in:        FormulaInput{Stock: rat("-2"), ConsumedQty: rat("30"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			suggested: "19", urgency: UrgencyOutOfStock, cover: "0", velocity: "1",
		},
		{
			name:      "on order covers the need",
			in:        FormulaInput{Stock: rat("0"), MinStock: rat("2"), ConsumedQty: rat("30"), OnOrder: rat("40"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			suggested: "0", urgency: UrgencyOutOfStock, cover: "0", velocity: "1",
		},
		{
			name: "pack rounding",
			// need = 14 → packs of 6 → 3 packs = 18
			in:        FormulaInput{Stock: rat("5"), MinStock: rat("2"), ConsumedQty: rat("30"), PackSize: rat("6"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			suggested: "18", packs: "3", urgency: UrgencyLowCover, cover: "5", velocity: "1",
		},
		{
			name: "pack rounding with fractional pack size",
			// need = 1 + 0 - 0 → 1 / 0.75 = 1.33 → 2 packs = 1.5
			in:        FormulaInput{Stock: rat("0"), MinStock: rat("1"), PackSize: rat("0.75"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			suggested: "1.5", packs: "2", urgency: UrgencyOutOfStock, cover: "", velocity: "0",
		},
		{
			name: "exact pack multiple",
			in:   FormulaInput{Stock: rat("0"), MinStock: rat("12"), PackSize: rat("6"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			// stock 0 with min → out of stock; need 12 → 2 packs
			suggested: "12", packs: "2", urgency: UrgencyOutOfStock, cover: "", velocity: "0",
		},
		{
			name:      "plenty of cover",
			in:        FormulaInput{Stock: rat("100"), ConsumedQty: rat("30"), VelocityDays: 30, LeadDays: 3, TargetDays: 14},
			suggested: "0", urgency: UrgencyNone, cover: "100", velocity: "1",
		},
		{
			name: "default velocity days",
			in:   FormulaInput{Stock: rat("0"), ConsumedQty: rat("60"), LeadDays: 0, TargetDays: 1},
			// days 0 → 30: velocity 2, need 2
			suggested: "2", urgency: UrgencyOutOfStock, cover: "0", velocity: "2",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Compute(tc.in)
			if s := decString(got.Suggested, 3); s != tc.suggested {
				t.Fatalf("suggested = %s, want %s (raw need %s)", s, tc.suggested, got.RawNeed.FloatString(3))
			}
			if got.Suggested.Sign() < 0 {
				t.Fatal("suggested must never be negative")
			}
			if tc.packs != "" {
				if got.Packs == nil || got.Packs.String() != tc.packs {
					t.Fatalf("packs = %v, want %s", got.Packs, tc.packs)
				}
			} else if got.Packs != nil {
				t.Fatalf("packs = %v, want nil", got.Packs)
			}
			if got.Urgency != tc.urgency {
				t.Fatalf("urgency = %s, want %s", got.Urgency, tc.urgency)
			}
			if tc.cover == "" {
				if got.DaysOfCover != nil {
					t.Fatalf("cover = %s, want nil", got.DaysOfCover.FloatString(2))
				}
			} else if got.DaysOfCover == nil || decString(got.DaysOfCover, 1) != tc.cover {
				t.Fatalf("cover = %v, want %s", got.DaysOfCover, tc.cover)
			}
			if v := decString(got.Velocity, 3); v != tc.velocity {
				t.Fatalf("velocity = %s, want %s", v, tc.velocity)
			}
		})
	}
}

func TestCeilRat(t *testing.T) {
	for in, want := range map[string]string{"0": "0", "1": "1", "1.001": "2", "-1.5": "-1", "5.999": "6"} {
		if got := ceilRat(rat(in)).String(); got != want {
			t.Fatalf("ceil(%s) = %s, want %s", in, got, want)
		}
	}
}

func TestDecString(t *testing.T) {
	for in, want := range map[string]string{"1.500": "1.5", "2.000": "2", "-0.0001": "0", "10": "10", "0.3333": "0.333"} {
		if got := decString(rat(in), 3); got != want {
			t.Fatalf("decString(%s) = %s, want %s", in, got, want)
		}
	}
}
