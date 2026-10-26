package usecase

import (
	"math/big"
	"strings"
)

// Urgency of a product's stock position.
const (
	// UrgencyOutOfStock: no stock left (or negative) while the product has
	// demand or a minimum.
	UrgencyOutOfStock = "out_of_stock"
	// UrgencyBelowMin: stock at or below the minimum stock alert.
	UrgencyBelowMin = "below_min"
	// UrgencyLowCover: at the current pace the stock lasts less than one
	// reorder cycle (lead time + target cover).
	UrgencyLowCover = "low_cover"
	// UrgencyNone: nothing urgent (a suggestion may still exist).
	UrgencyNone = "none"
)

// Urgencies lists the filterable urgency values (most urgent first).
var Urgencies = []string{UrgencyOutOfStock, UrgencyBelowMin, UrgencyLowCover}

// FormulaText is the human-readable formula returned with every suggestion.
const FormulaText = "max(0, ceil(velocity × (lead_days + target_days) + min_stock − stock − on_order)), rounded up to whole packs"

// FormulaInput holds every input of the reorder formula. Quantities are
// exact decimals; a nil PackSize (or <= 0) means "no pack rounding".
type FormulaInput struct {
	Stock        *big.Rat
	MinStock     *big.Rat
	ConsumedQty  *big.Rat
	SoldQty      *big.Rat
	OnOrder      *big.Rat
	PackSize     *big.Rat
	VelocityDays int
	LeadDays     int
	TargetDays   int
}

// FormulaResult is the outcome of the reorder formula.
type FormulaResult struct {
	// Velocity is the average daily usage: (consumed + sold) / velocity days.
	Velocity *big.Rat
	// DaysOfCover is stock / velocity; nil when there is no usage (infinite
	// cover). Zero when the stock is zero or negative.
	DaysOfCover *big.Rat
	// Demand is velocity × (lead + target).
	Demand *big.Rat
	// RawNeed is demand + min − stock − on_order before rounding (may be
	// negative).
	RawNeed *big.Rat
	// Suggested is the quantity to order (>= 0, whole units or packs).
	Suggested *big.Rat
	// Packs is the number of packs when a pack size applies.
	Packs   *big.Int
	Urgency string
}

func ratOr0(r *big.Rat) *big.Rat {
	if r == nil {
		return new(big.Rat)
	}
	return r
}

// ceilRat rounds r up to the next integer.
func ceilRat(r *big.Rat) *big.Int {
	num, den := r.Num(), r.Denom()
	q, m := new(big.Int).QuoRem(num, den, new(big.Int))
	// QuoRem truncates toward zero: positive remainders round up.
	if m.Sign() > 0 {
		q.Add(q, big.NewInt(1))
	}
	return q
}

// Compute runs the reorder formula:
//
//	velocity  = (consumed + sold) / velocity_days
//	need      = velocity × (lead_days + target_days) + min_stock − stock − on_order
//	suggested = max(0, ceil(need)), rounded up to whole packs when pack_size > 0
func Compute(in FormulaInput) FormulaResult {
	stock, minStock, onOrder := ratOr0(in.Stock), ratOr0(in.MinStock), ratOr0(in.OnOrder)
	days := in.VelocityDays
	if days <= 0 {
		days = DefaultVelocityDays
	}
	lead, target := max(in.LeadDays, 0), max(in.TargetDays, 0)

	used := new(big.Rat).Add(ratOr0(in.ConsumedQty), ratOr0(in.SoldQty))
	if used.Sign() < 0 {
		used.SetInt64(0)
	}
	out := FormulaResult{Velocity: new(big.Rat).Quo(used, new(big.Rat).SetInt64(int64(days)))}
	if out.Velocity.Sign() > 0 {
		if stock.Sign() <= 0 {
			out.DaysOfCover = new(big.Rat)
		} else {
			out.DaysOfCover = new(big.Rat).Quo(stock, out.Velocity)
		}
	}
	out.Demand = new(big.Rat).Mul(out.Velocity, new(big.Rat).SetInt64(int64(lead+target)))
	need := new(big.Rat).Add(out.Demand, minStock)
	need.Sub(need, stock)
	need.Sub(need, onOrder)
	out.RawNeed = need

	out.Suggested = new(big.Rat)
	if need.Sign() > 0 {
		if in.PackSize != nil && in.PackSize.Sign() > 0 {
			packs := ceilRat(new(big.Rat).Quo(need, in.PackSize))
			out.Packs = packs
			out.Suggested = new(big.Rat).Mul(new(big.Rat).SetInt(packs), in.PackSize)
		} else {
			out.Suggested = new(big.Rat).SetInt(ceilRat(need))
		}
	} else if in.PackSize != nil && in.PackSize.Sign() > 0 {
		out.Packs = new(big.Int)
	}

	out.Urgency = UrgencyNone
	hasDemand := out.Velocity.Sign() > 0 || minStock.Sign() > 0
	switch {
	case stock.Sign() < 0 || (stock.Sign() == 0 && hasDemand):
		out.Urgency = UrgencyOutOfStock
	case minStock.Sign() > 0 && stock.Cmp(minStock) <= 0:
		out.Urgency = UrgencyBelowMin
	case out.DaysOfCover != nil && out.DaysOfCover.Cmp(new(big.Rat).SetInt64(int64(lead+target))) < 0:
		out.Urgency = UrgencyLowCover
	}
	return out
}

// UrgencyRank orders urgencies (lower = more urgent).
func UrgencyRank(u string) int {
	switch u {
	case UrgencyOutOfStock:
		return 0
	case UrgencyBelowMin:
		return 1
	case UrgencyLowCover:
		return 2
	default:
		return 3
	}
}

// decString renders a decimal with up to prec fraction digits, without
// trailing zeros ("1.5", "2", "-3").
func decString(r *big.Rat, prec int) string {
	if r == nil {
		return "0"
	}
	s := r.FloatString(prec)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	if s == "" || s == "-0" || s == "-" {
		return "0"
	}
	return s
}
