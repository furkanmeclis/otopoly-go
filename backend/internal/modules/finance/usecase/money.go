package usecase

import (
	"fmt"
	"math/big"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

func numericFromString(raw string) (pgtype.Numeric, error) {
	return parseNumeric(raw, false)
}

func numericFromAmountString(raw string) (pgtype.Numeric, error) {
	return parseNumeric(raw, true)
}

func numericFromDecimalString(raw string) (pgtype.Numeric, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		var zero pgtype.Numeric
		_ = zero.Scan("0")
		return zero, nil
	}
	return parseNumeric(raw, true)
}

func parseNumeric(raw string, allowZero bool) (pgtype.Numeric, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return pgtype.Numeric{}, fmt.Errorf("amount is required")
	}
	var n pgtype.Numeric
	if err := n.Scan(raw); err != nil {
		return pgtype.Numeric{}, fmt.Errorf("invalid amount")
	}
	sign := numericSign(n)
	if sign < 0 {
		return pgtype.Numeric{}, fmt.Errorf("amount must be positive")
	}
	if !allowZero && sign == 0 {
		return pgtype.Numeric{}, fmt.Errorf("amount must be positive")
	}
	return n, nil
}

func numericToString(n pgtype.Numeric) string {
	if !n.Valid || n.Int == nil {
		return "0.00"
	}
	f, _ := ratFromNumeric(n).Float64()
	return fmt.Sprintf("%.2f", f)
}

func ratFromNumeric(n pgtype.Numeric) *big.Rat {
	if !n.Valid || n.Int == nil {
		return new(big.Rat)
	}
	rat := new(big.Rat).SetInt(n.Int)
	if n.Exp != 0 {
		ten := big.NewRat(10, 1)
		if n.Exp > 0 {
			for i := int32(0); i < n.Exp; i++ {
				rat.Mul(rat, ten)
			}
		} else {
			for i := int32(0); i > n.Exp; i-- {
				rat.Quo(rat, ten)
			}
		}
	}
	return rat
}

func numericSign(n pgtype.Numeric) int {
	if !n.Valid {
		return 0
	}
	if n.Int == nil {
		return 0
	}
	return n.Int.Sign()
}

func numericNeg(n pgtype.Numeric) pgtype.Numeric {
	if !n.Valid || n.Int == nil {
		return n
	}
	out := n
	out.Int = new(big.Int).Neg(n.Int)
	return out
}

func numericEqualCurrency(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}
