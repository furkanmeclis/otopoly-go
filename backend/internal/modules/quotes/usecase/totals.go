package usecase

import (
	"fmt"
	"math/big"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

// Discount types for lines and the quote as a whole.
const (
	DiscountNone    = "none"
	DiscountPercent = "percent"
	DiscountAmount  = "amount"
)

// TotalsLine is one priced line fed into ComputeTotals (decimal strings).
type TotalsLine struct {
	Quantity      string
	UnitPrice     string
	DiscountType  string
	DiscountValue string
	VATRate       string
}

// LineAmounts are the computed amounts for one line (2-decimal strings).
type LineAmounts struct {
	Subtotal           string // qty × unit price
	LineDiscount       string // line-level discount
	QuoteDiscountShare string // allocated share of the quote-level discount
	Net                string // subtotal − discounts
	VAT                string
	Total              string // what the customer pays for the line
}

// Totals is the computed quote summary.
type Totals struct {
	Lines         []LineAmounts
	Subtotal      string
	LineDiscount  string
	QuoteDiscount string
	DiscountTotal string
	VATTotal      string
	GrandTotal    string
}

var (
	ratHundred = big.NewRat(100, 1)
)

// parseDecimal parses a non-negative decimal string ("12", "12.5", "12,50").
func parseDecimal(raw, field string) (*big.Rat, error) {
	s := strings.TrimSpace(strings.ReplaceAll(raw, ",", "."))
	if s == "" {
		return new(big.Rat), nil
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return nil, fmt.Errorf("%s is not a number", field)
	}
	if r.Sign() < 0 {
		return nil, fmt.Errorf("%s must not be negative", field)
	}
	return r, nil
}

// round2 rounds half away from zero to 2 decimals.
func round2(r *big.Rat) *big.Rat {
	scaled := new(big.Rat).Mul(r, ratHundred)
	num := new(big.Int).Set(scaled.Num())
	den := scaled.Denom()
	q, m := new(big.Int).QuoRem(num, den, new(big.Int))
	// |m|*2 >= den → round away from zero.
	m2 := new(big.Int).Mul(new(big.Int).Abs(m), big.NewInt(2))
	if m2.Cmp(den) >= 0 {
		if num.Sign() >= 0 {
			q.Add(q, big.NewInt(1))
		} else {
			q.Sub(q, big.NewInt(1))
		}
	}
	return new(big.Rat).SetFrac(q, big.NewInt(100))
}

func fmt2(r *big.Rat) string { return r.FloatString(2) }

func minRat(a, b *big.Rat) *big.Rat {
	if a.Cmp(b) <= 0 {
		return new(big.Rat).Set(a)
	}
	return new(big.Rat).Set(b)
}

func normalizeDiscountType(t string) (string, error) {
	switch strings.TrimSpace(t) {
	case "", DiscountNone:
		return DiscountNone, nil
	case DiscountPercent:
		return DiscountPercent, nil
	case DiscountAmount:
		return DiscountAmount, nil
	default:
		return "", fmt.Errorf("discount_type must be none, percent or amount")
	}
}

// discountOf returns the discount (rounded to 2 decimals, capped at base).
func discountOf(base *big.Rat, typ, value, field string) (*big.Rat, error) {
	typ, err := normalizeDiscountType(typ)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", field, err)
	}
	if typ == DiscountNone {
		return new(big.Rat), nil
	}
	v, err := parseDecimal(value, field+" discount_value")
	if err != nil {
		return nil, err
	}
	switch typ {
	case DiscountPercent:
		if v.Cmp(ratHundred) > 0 {
			return nil, fmt.Errorf("%s discount percent must be between 0 and 100", field)
		}
		return round2(new(big.Rat).Quo(new(big.Rat).Mul(base, v), ratHundred)), nil
	default: // amount
		return minRat(round2(v), base), nil
	}
}

// ComputeTotals computes line and quote totals with exact rational arithmetic
// and half-up rounding to 2 decimals at the line level.
//
//   - line subtotal = round(qty × unit price)
//   - line discount = percent of the subtotal, or a fixed amount (capped)
//   - quote discount applies to the sum after line discounts; it is
//     allocated to lines pro rata (the last non-zero line takes the rounding
//     remainder) so that line totals always add up to the grand total
//   - VAT: when pricesIncludeVAT the net amount already contains VAT and
//     vat = net × rate / (100 + rate); otherwise vat = net × rate / 100 and
//     the line total is net + vat.
func ComputeTotals(lines []TotalsLine, quoteDiscountType, quoteDiscountValue string, pricesIncludeVAT bool) (Totals, error) {
	type work struct {
		subtotal, lineDisc, after, share, net, vat, total, rate *big.Rat
	}
	ws := make([]work, len(lines))
	sumSubtotal := new(big.Rat)
	sumLineDisc := new(big.Rat)
	sumAfter := new(big.Rat)
	for i, l := range lines {
		field := fmt.Sprintf("line %d", i+1)
		qty, err := parseDecimal(l.Quantity, field+" quantity")
		if err != nil {
			return Totals{}, err
		}
		if qty.Sign() <= 0 {
			return Totals{}, fmt.Errorf("%s quantity must be greater than zero", field)
		}
		price, err := parseDecimal(l.UnitPrice, field+" unit_price")
		if err != nil {
			return Totals{}, err
		}
		rate, err := parseDecimal(l.VATRate, field+" vat_rate")
		if err != nil {
			return Totals{}, err
		}
		if rate.Cmp(ratHundred) > 0 {
			return Totals{}, fmt.Errorf("%s vat_rate must be between 0 and 100", field)
		}
		sub := round2(new(big.Rat).Mul(qty, round2(price)))
		disc, err := discountOf(sub, l.DiscountType, l.DiscountValue, field)
		if err != nil {
			return Totals{}, err
		}
		after := new(big.Rat).Sub(sub, disc)
		ws[i] = work{subtotal: sub, lineDisc: disc, after: after, rate: rate, share: new(big.Rat)}
		sumSubtotal.Add(sumSubtotal, sub)
		sumLineDisc.Add(sumLineDisc, disc)
		sumAfter.Add(sumAfter, after)
	}

	quoteDisc, err := discountOf(sumAfter, quoteDiscountType, quoteDiscountValue, "quote")
	if err != nil {
		return Totals{}, err
	}
	if quoteDisc.Sign() > 0 && sumAfter.Sign() > 0 {
		last := -1
		for i := range ws {
			if ws[i].after.Sign() > 0 {
				last = i
			}
		}
		allocated := new(big.Rat)
		for i := range ws {
			if ws[i].after.Sign() == 0 {
				continue
			}
			if i == last {
				ws[i].share = new(big.Rat).Sub(quoteDisc, allocated)
				break
			}
			share := round2(new(big.Rat).Quo(new(big.Rat).Mul(quoteDisc, ws[i].after), sumAfter))
			share = minRat(share, ws[i].after)
			ws[i].share = share
			allocated.Add(allocated, share)
		}
	}

	out := Totals{Lines: make([]LineAmounts, len(ws))}
	sumVAT := new(big.Rat)
	sumTotal := new(big.Rat)
	for i := range ws {
		w := &ws[i]
		w.net = new(big.Rat).Sub(w.after, w.share)
		if w.net.Sign() < 0 {
			w.net = new(big.Rat)
		}
		if pricesIncludeVAT {
			w.vat = round2(new(big.Rat).Quo(new(big.Rat).Mul(w.net, w.rate), new(big.Rat).Add(ratHundred, w.rate)))
			w.total = new(big.Rat).Set(w.net)
		} else {
			w.vat = round2(new(big.Rat).Quo(new(big.Rat).Mul(w.net, w.rate), ratHundred))
			w.total = new(big.Rat).Add(w.net, w.vat)
		}
		sumVAT.Add(sumVAT, w.vat)
		sumTotal.Add(sumTotal, w.total)
		out.Lines[i] = LineAmounts{
			Subtotal:           fmt2(w.subtotal),
			LineDiscount:       fmt2(w.lineDisc),
			QuoteDiscountShare: fmt2(w.share),
			Net:                fmt2(w.net),
			VAT:                fmt2(w.vat),
			Total:              fmt2(w.total),
		}
	}
	out.Subtotal = fmt2(sumSubtotal)
	out.LineDiscount = fmt2(sumLineDisc)
	out.QuoteDiscount = fmt2(quoteDisc)
	out.DiscountTotal = fmt2(new(big.Rat).Add(sumLineDisc, quoteDisc))
	out.VATTotal = fmt2(sumVAT)
	out.GrandTotal = fmt2(sumTotal)
	return out, nil
}

// ratFromNumeric converts a pgtype.Numeric to an exact rational.
func ratFromNumeric(n pgtype.Numeric) *big.Rat {
	if !n.Valid || n.Int == nil {
		return new(big.Rat)
	}
	r := new(big.Rat).SetInt(n.Int)
	if n.Exp > 0 {
		r.Mul(r, new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n.Exp)), nil)))
	} else if n.Exp < 0 {
		r.Quo(r, new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(-n.Exp)), nil)))
	}
	return r
}
