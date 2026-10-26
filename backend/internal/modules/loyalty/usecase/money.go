package usecase

import (
	"math/big"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

// ratOf converts a numeric to an exact rational (invalid = 0).
func ratOf(n pgtype.Numeric) *big.Rat {
	if !n.Valid || n.Int == nil {
		return new(big.Rat)
	}
	r := new(big.Rat).SetInt(n.Int)
	ten := big.NewInt(10)
	if n.Exp > 0 {
		r.Mul(r, new(big.Rat).SetInt(new(big.Int).Exp(ten, big.NewInt(int64(n.Exp)), nil)))
	} else if n.Exp < 0 {
		r.Quo(r, new(big.Rat).SetInt(new(big.Int).Exp(ten, big.NewInt(int64(-n.Exp)), nil)))
	}
	return r
}

// money formats a rational as a two-decimal string (half away from zero).
func money(r *big.Rat) string {
	return round2(r).FloatString(2)
}

// round2 rounds to cents, half away from zero.
func round2(r *big.Rat) *big.Rat {
	scaled := new(big.Rat).Mul(r, big.NewRat(100, 1))
	num, den := scaled.Num(), scaled.Denom()
	q, m := new(big.Int).QuoRem(num, den, new(big.Int))
	twice := new(big.Int).Mul(new(big.Int).Abs(m), big.NewInt(2))
	if twice.Cmp(den) >= 0 {
		if num.Sign() < 0 {
			q.Sub(q, big.NewInt(1))
		} else {
			q.Add(q, big.NewInt(1))
		}
	}
	return new(big.Rat).SetFrac(q, big.NewInt(100))
}

func numMoney(n pgtype.Numeric) string { return money(ratOf(n)) }

// numeric converts a rational to a 2-decimal numeric.
func numeric(r *big.Rat) pgtype.Numeric {
	var n pgtype.Numeric
	_ = n.Scan(money(r))
	return n
}

// parseMoney parses a non-negative decimal amount ("1250", "1250.50", "1250,50").
func parseMoney(raw string) (*big.Rat, bool) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, ",", "."))
	if raw == "" {
		return nil, false
	}
	r, ok := new(big.Rat).SetString(raw)
	if !ok || r.Sign() < 0 {
		return nil, false
	}
	return round2(r), true
}

// wholeUnits is the whole part of a quantity (2.5 → 2).
func wholeUnits(qty pgtype.Numeric) int64 {
	r := ratOf(qty)
	if r.Sign() <= 0 {
		return 0
	}
	return new(big.Int).Quo(r.Num(), r.Denom()).Int64()
}

func minRat(a, b *big.Rat) *big.Rat {
	if a.Cmp(b) <= 0 {
		return a
	}
	return b
}
