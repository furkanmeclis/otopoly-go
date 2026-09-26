package usecase

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// Report holds one organization's figures for a local calendar day.
type Report struct {
	OrgName  string
	Day      time.Time
	Currency string

	JobCount       int64
	OpenCount      int64
	DeliveredCount int64
	CancelledCount int64
	Services       []ServiceCount

	PaidTotal float64
	CashTotal float64
	CardTotal float64
	CariTotal float64

	UnpaidCount int64
	UnpaidTotal float64

	SaleCount int64
	SaleTotal float64

	PurchaseCount int64
	PurchaseTotal float64
	ExpenseCount  int64
	ExpenseTotal  float64

	Accounts []AccountBalance
}

type ServiceCount struct {
	Name     string `json:"name"`
	JobCount int64  `json:"job_count"`
}

type AccountBalance struct {
	Name    string  `json:"name"`
	Balance float64 `json:"balance"`
}

var trMonths = [...]string{
	"Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
	"Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
}

var trWeekdays = [...]string{
	"Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi",
}

// Message renders the WhatsApp text (WhatsApp *bold* / _italic_ markup).
func (r Report) Message() string {
	var b strings.Builder
	money := func(v float64) string { return formatTRY(v, r.Currency) }

	name := strings.TrimSpace(r.OrgName)
	if name == "" {
		name = "İşletme"
	}
	fmt.Fprintf(&b, "📊 *%s — Gün Sonu Özeti*\n", name)
	fmt.Fprintf(&b, "%d %s %d, %s\n\n",
		r.Day.Day(), trMonths[r.Day.Month()-1], r.Day.Year(), trWeekdays[r.Day.Weekday()])

	// Vehicles
	if r.JobCount == 0 {
		b.WriteString("🚗 *Araçlar:* Bugün araç kabul edilmedi.\n")
	} else {
		fmt.Fprintf(&b, "🚗 *Araçlar:* %d araca hizmet verildi\n", r.JobCount)
		for _, s := range r.Services {
			fmt.Fprintf(&b, "• %d × %s\n", s.JobCount, s.Name)
		}
		parts := []string{fmt.Sprintf("✅ Teslim: %d", r.DeliveredCount)}
		if r.OpenCount > 0 {
			parts = append(parts, fmt.Sprintf("⏳ Devam eden: %d", r.OpenCount))
		}
		if r.CancelledCount > 0 {
			parts = append(parts, fmt.Sprintf("❌ İptal: %d", r.CancelledCount))
		}
		b.WriteString(strings.Join(parts, " · "))
		b.WriteString("\n")
	}
	b.WriteString("\n")

	// Revenue (same basis as the İşlemler day summary: paid jobs)
	fmt.Fprintf(&b, "💰 *Hizmet cirosu:* %s\n", money(r.PaidTotal))
	fmt.Fprintf(&b, "• Nakit: %s\n", money(r.CashTotal))
	fmt.Fprintf(&b, "• Kart: %s\n", money(r.CardTotal))
	if r.CariTotal > 0 {
		fmt.Fprintf(&b, "• Cari: %s\n", money(r.CariTotal))
	}
	if r.UnpaidCount > 0 {
		fmt.Fprintf(&b, "⚠️ Tahsil edilmemiş: %s (%d iş)\n", money(r.UnpaidTotal), r.UnpaidCount)
	}
	if r.SaleCount > 0 {
		fmt.Fprintf(&b, "🛍️ Ürün satışı: %s (%d satış)\n", money(r.SaleTotal), r.SaleCount)
	}

	// Outgoing
	if r.ExpenseCount > 0 || r.PurchaseCount > 0 {
		b.WriteString("\n📉 *Çıkışlar*\n")
		if r.ExpenseCount > 0 {
			fmt.Fprintf(&b, "• Gider: %s (%d kayıt)\n", money(r.ExpenseTotal), r.ExpenseCount)
		}
		if r.PurchaseCount > 0 {
			fmt.Fprintf(&b, "• Stok alışı: %s (%d alış)\n", money(r.PurchaseTotal), r.PurchaseCount)
		}
	}

	// Cash / bank balances
	if len(r.Accounts) > 0 {
		b.WriteString("\n🏦 *Kasa bakiyeleri*\n")
		for _, a := range r.Accounts {
			fmt.Fprintf(&b, "• %s: %s\n", a.Name, money(a.Balance))
		}
	}

	b.WriteString("\n_Otopoly gün sonu raporu_")
	return b.String()
}

// formatTRY renders 1234.5 as "₺1.234,50" (Turkish grouping, 2 decimals).
func formatTRY(v float64, currency string) string {
	neg := v < 0
	if neg {
		v = -v
	}
	whole := int64(v)
	cents := int64(math.Round((v - float64(whole)) * 100))
	if cents == 100 {
		whole++
		cents = 0
	}
	digits := strconv.FormatInt(whole, 10)
	var b strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	symbol := "₺"
	if c := strings.ToUpper(strings.TrimSpace(currency)); c != "" && c != "TRY" {
		symbol = c + " "
	}
	out := fmt.Sprintf("%s%s,%02d", symbol, b.String(), cents)
	if neg {
		out = "-" + out
	}
	return out
}
