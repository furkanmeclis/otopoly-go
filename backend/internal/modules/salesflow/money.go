package salesflow

import (
	"strings"
	"time"

	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
)

// FormatMoney renders "12500.00" + "TRY" like the template samples:
// tr → "12.500,00 TRY", en → "TRY 12,500.00".
func FormatMoney(amount, currency, locale string) string {
	amount = strings.TrimSpace(amount)
	neg := strings.HasPrefix(amount, "-")
	amount = strings.TrimPrefix(amount, "-")
	intPart, frac, _ := strings.Cut(amount, ".")
	if intPart == "" {
		intPart = "0"
	}
	frac = (frac + "00")[:2]
	thousands, decimal := ".", ","
	if locale == "en" {
		thousands, decimal = ",", "."
	}
	var b strings.Builder
	for i, r := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteString(thousands)
		}
		b.WriteRune(r)
	}
	num := b.String() + decimal + frac
	if neg {
		num = "-" + num
	}
	currency = strings.TrimSpace(currency)
	switch {
	case currency == "":
		return num
	case locale == "en":
		return currency + " " + num
	default:
		return num + " " + currency
	}
}

func localeOf(v string) string {
	if v == "en" {
		return "en"
	}
	return "tr"
}

// quoteVars builds the customer template variables of quote.* types.
// valid_until_iso is localized by the center (valid_until).
func quoteVars(m quotesusecase.QuoteMessage) map[string]string {
	vars := map[string]string{
		"quote_number":  m.QuoteNumber,
		"total_amount":  FormatMoney(m.GrandTotal, m.Currency, localeOf(m.Locale)),
		"quote_link":    m.ShareURL,
		"plate":         m.VehiclePlate,
		"customer_name": m.CustomerName,
	}
	if m.OrganizationName != "" {
		vars["company_name"] = m.OrganizationName
	}
	if m.ValidUntil != nil {
		vars["valid_until_iso"] = m.ValidUntil.Format("2006-01-02")
	}
	return vars
}

func dateOnly(t time.Time) string { return t.Format("2006-01-02") }
