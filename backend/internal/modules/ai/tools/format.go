package tools

import (
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// FormatMoney renders a decimal string as Turkish-formatted money, e.g.
// ("12345.5", "TRY") → "₺12.345,50". Unknown input is returned trimmed.
func FormatMoney(amount, currency string) string {
	amount = strings.TrimSpace(amount)
	if amount == "" {
		amount = "0"
	}
	r, ok := new(big.Rat).SetString(amount)
	if !ok {
		return amount
	}
	neg := r.Sign() < 0
	if neg {
		r.Neg(r)
	}
	fixed := r.FloatString(2) // "12345.50"
	intPart, frac, _ := strings.Cut(fixed, ".")
	var sb strings.Builder
	for i, ch := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			sb.WriteByte('.')
		}
		sb.WriteRune(ch)
	}
	out := sb.String() + "," + frac
	cur := strings.ToUpper(strings.TrimSpace(currency))
	switch cur {
	case "TRY", "TL", "":
		out = "₺" + out
	case "USD":
		out = "$" + out
	case "EUR":
		out = "€" + out
	case "GBP":
		out = "£" + out
	default:
		out = out + " " + cur
	}
	if neg {
		out = "-" + out
	}
	return out
}

// Number parses a decimal string into a float rounded to 2 decimals (for chart rows).
func Number(amount string) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(amount), 64)
	if err != nil {
		return 0
	}
	return math.Round(f*100) / 100
}

var nonDigit = regexp.MustCompile(`\D`)

// FoldTR lowercases with Turkish rules and strips diacritics
// ("Hüseyin ÇELİK" → "huseyin celik"), mirroring frontend foldSearch.
func FoldTR(s string) string {
	s = strings.ReplaceAll(s, "İ", "i")
	s = strings.ReplaceAll(s, "I", "i")
	s = strings.ToLower(s)
	r := strings.NewReplacer(
		"ç", "c", "ğ", "g", "ı", "i", "ö", "o", "ş", "s", "ü", "u",
		"â", "a", "î", "i", "û", "u",
	)
	return strings.TrimSpace(r.Replace(s))
}

// DigitsOnly returns only the digits of s.
func DigitsOnly(s string) string { return nonDigit.ReplaceAllString(s, "") }

// PlateKey normalizes a plate for matching ("34 abc 123" → "34ABC123").
func PlateKey(s string) string {
	var sb strings.Builder
	for _, ch := range strings.ToUpper(FoldTR(s)) {
		if (ch >= 'A' && ch <= 'Z') || unicode.IsDigit(ch) {
			sb.WriteRune(ch)
		}
	}
	return sb.String()
}

// Truncate shortens s to n runes with an ellipsis.
func Truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return strings.TrimSpace(string(rs[:n])) + "…"
}

// Field length caps for free text that comes from stored records (typed by
// staff or customers) and is fed back to the model.
const (
	maxNameChars = 120
	maxTextChars = 160
)

// DataText prepares untrusted free text from stored records for a tool
// result: control characters and line breaks become spaces (so a note cannot
// fake message structure), whitespace is collapsed and the text is clipped to
// max runes. The value is then JSON-encoded as a field, never concatenated
// into prose.
func DataText(s string, max int) string {
	var sb strings.Builder
	sb.Grow(len(s))
	space := false
	for _, r := range s {
		if unicode.IsControl(r) || unicode.IsSpace(r) || r == ' ' || r == ' ' {
			if !space {
				sb.WriteByte(' ')
				space = true
			}
			continue
		}
		space = false
		sb.WriteRune(r)
	}
	return Truncate(sb.String(), max)
}
