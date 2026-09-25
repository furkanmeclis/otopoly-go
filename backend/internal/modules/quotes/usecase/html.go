package usecase

import (
	"fmt"
	"html"
	"math/big"
	"strings"
	"time"
)

// pdfLine is one printed line.
type pdfLine struct {
	Description string
	Quantity    string
	Unit        string
	UnitPrice   string
	Discount    string
	VATRate     string
	Total       string
}

// pdfDoc is the data printed on a quote PDF (all plain text; escaped here).
type pdfDoc struct {
	Number           string
	Status           string
	IssuedAt         time.Time
	ValidUntil       *time.Time
	OrgName          string
	OrgAddress       string
	OrgPhone         string
	OrgEmail         string
	OrgWebsite       string
	OrgTagline       string
	OrgFooter        string
	PrimaryColor     string
	LogoDataURI      string // data:image/...;base64,… (already safe) or ""
	CustomerName     string
	CustomerPhone    string
	CustomerEmail    string
	CustomerTaxID    string
	CustomerTaxOff   string
	VehiclePlate     string
	VehicleLabel     string
	Currency         string
	PricesIncludeVAT bool
	Lines            []pdfLine
	Subtotal         string
	DiscountTotal    string
	VATTotal         string
	GrandTotal       string
	Notes            string
	Terms            string
	ShareURL         string
}

var esc = html.EscapeString

// formatMoneyTR renders "1234.5" as "1.234,50 ₺" (tr-TR grouping).
func formatMoneyTR(amount, currency string) string {
	r, ok := new(big.Rat).SetString(strings.TrimSpace(amount))
	if !ok {
		r = new(big.Rat)
	}
	s := round2(r).FloatString(2)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	intPart, frac, _ := strings.Cut(s, ".")
	var b strings.Builder
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	out := b.String() + "," + frac
	if neg {
		out = "-" + out
	}
	sym := map[string]string{"TRY": "₺", "USD": "$", "EUR": "€", "GBP": "£"}[strings.ToUpper(currency)]
	if sym == "" {
		return out + " " + strings.ToUpper(currency)
	}
	return out + " " + sym
}

// formatQtyTR trims trailing zeros: "2.000" → "2", "1.500" → "1,5".
func formatQtyTR(q string) string {
	q = strings.TrimSpace(q)
	if strings.Contains(q, ".") {
		q = strings.TrimRight(strings.TrimRight(q, "0"), ".")
	}
	return strings.ReplaceAll(q, ".", ",")
}

func safeColor(c string) string {
	c = strings.TrimSpace(c)
	if !strings.HasPrefix(c, "#") {
		c = "#" + c
	}
	if len(c) != 4 && len(c) != 7 {
		return "#EA6E43"
	}
	for _, r := range c[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return "#EA6E43"
		}
	}
	return strings.ToUpper(c)
}

func nl2br(s string) string {
	return strings.ReplaceAll(esc(s), "\n", "<br>")
}

var statusLabelTR = map[string]string{
	StatusDraft: "Taslak", StatusSent: "Gönderildi", StatusViewed: "Görüntülendi",
	StatusAccepted: "Kabul edildi", StatusRejected: "Reddedildi", StatusExpired: "Süresi doldu",
	StatusCancelled: "İptal",
}

// buildQuoteHTML renders the printable quote (A4, Gotenberg Chromium).
// Every dynamic value is HTML-escaped; the logo is an embedded data URI.
func buildQuoteHTML(d pdfDoc) string {
	primary := safeColor(d.PrimaryColor)
	var b strings.Builder
	b.WriteString(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>`)
	b.WriteString(esc(d.Number))
	b.WriteString(`</title><style>
@page{size:A4;margin:14mm 14mm 16mm}
*{box-sizing:border-box}
body{font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Roboto,sans-serif;font-size:10pt;line-height:1.5;color:#2A241F;margin:0}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px solid `)
	b.WriteString(primary)
	b.WriteString(`;padding-bottom:12px;margin-bottom:16px}
.brand{display:flex;gap:12px;align-items:center}
.brand img{max-height:56px;max-width:160px;object-fit:contain}
.brand h1{font-size:15pt;margin:0}
.muted{color:#6B635C;font-size:9pt}
.doc{text-align:right}
.doc .title{font-size:18pt;font-weight:700;color:`)
	b.WriteString(primary)
	b.WriteString(`;letter-spacing:.5px}
.grid{display:flex;gap:16px;margin-bottom:16px}
.box{flex:1;border:1px solid #E8E0D8;border-radius:8px;padding:10px 12px}
.box h3{margin:0 0 4px;font-size:8.5pt;text-transform:uppercase;color:#8A8178;letter-spacing:.6px}
table{width:100%;border-collapse:collapse}
th{background:#F6F1EC;text-align:left;font-size:8.5pt;text-transform:uppercase;color:#6B635C;padding:7px 8px}
td{padding:7px 8px;border-bottom:1px solid #EFE8E1;vertical-align:top}
.num{text-align:right;white-space:nowrap}
.totals{margin-left:auto;margin-top:12px;width:280px}
.totals td{border:none;padding:4px 8px}
.totals .grand td{font-size:12pt;font-weight:700;border-top:2px solid `)
	b.WriteString(primary)
	b.WriteString(`}
.section{margin-top:18px}
.section h3{font-size:9pt;text-transform:uppercase;color:#8A8178;margin:0 0 4px}
.foot{margin-top:24px;border-top:1px solid #E8E0D8;padding-top:8px;font-size:8.5pt;color:#8A8178}
</style></head><body>`)

	// Header.
	b.WriteString(`<div class="head"><div class="brand">`)
	if strings.HasPrefix(d.LogoDataURI, "data:image/") {
		b.WriteString(`<img src="`)
		b.WriteString(esc(d.LogoDataURI))
		b.WriteString(`" alt="">`)
	}
	b.WriteString(`<div><h1>`)
	b.WriteString(esc(d.OrgName))
	b.WriteString(`</h1>`)
	if d.OrgTagline != "" {
		b.WriteString(`<div class="muted">` + esc(d.OrgTagline) + `</div>`)
	}
	contact := []string{}
	for _, v := range []string{d.OrgAddress, d.OrgPhone, d.OrgEmail, d.OrgWebsite} {
		if strings.TrimSpace(v) != "" {
			contact = append(contact, esc(v))
		}
	}
	if len(contact) > 0 {
		b.WriteString(`<div class="muted">` + strings.Join(contact, " · ") + `</div>`)
	}
	b.WriteString(`</div></div><div class="doc"><div class="title">TEKLİF</div><div><strong>`)
	b.WriteString(esc(d.Number))
	b.WriteString(`</strong></div><div class="muted">Tarih: `)
	b.WriteString(d.IssuedAt.Format("02.01.2006"))
	b.WriteString(`</div>`)
	if d.ValidUntil != nil {
		b.WriteString(`<div class="muted">Geçerlilik: ` + d.ValidUntil.Format("02.01.2006") + `</div>`)
	}
	if lbl := statusLabelTR[d.Status]; lbl != "" && d.Status != StatusDraft && d.Status != StatusSent && d.Status != StatusViewed {
		b.WriteString(`<div class="muted">Durum: ` + esc(lbl) + `</div>`)
	}
	b.WriteString(`</div></div>`)

	// Customer + vehicle.
	b.WriteString(`<div class="grid"><div class="box"><h3>Müşteri</h3><div><strong>`)
	b.WriteString(esc(d.CustomerName))
	b.WriteString(`</strong></div>`)
	for _, v := range []string{d.CustomerPhone, d.CustomerEmail} {
		if strings.TrimSpace(v) != "" {
			b.WriteString(`<div class="muted">` + esc(v) + `</div>`)
		}
	}
	if d.CustomerTaxID != "" {
		b.WriteString(`<div class="muted">VKN/TCKN: ` + esc(d.CustomerTaxID))
		if d.CustomerTaxOff != "" {
			b.WriteString(` · ` + esc(d.CustomerTaxOff))
		}
		b.WriteString(`</div>`)
	}
	b.WriteString(`</div>`)
	if d.VehiclePlate != "" || d.VehicleLabel != "" {
		b.WriteString(`<div class="box"><h3>Araç</h3>`)
		if d.VehiclePlate != "" {
			b.WriteString(`<div><strong>` + esc(d.VehiclePlate) + `</strong></div>`)
		}
		if d.VehicleLabel != "" {
			b.WriteString(`<div class="muted">` + esc(d.VehicleLabel) + `</div>`)
		}
		b.WriteString(`</div>`)
	}
	b.WriteString(`</div>`)

	// Lines.
	b.WriteString(`<table><thead><tr><th>#</th><th>Açıklama</th><th class="num">Miktar</th><th class="num">Birim fiyat</th><th class="num">İndirim</th><th class="num">KDV</th><th class="num">Tutar</th></tr></thead><tbody>`)
	for i, l := range d.Lines {
		qty := formatQtyTR(l.Quantity)
		if l.Unit != "" {
			qty += " " + l.Unit
		}
		disc := "—"
		if r, ok := new(big.Rat).SetString(l.Discount); ok && r.Sign() > 0 {
			disc = formatMoneyTR(l.Discount, d.Currency)
		}
		_, _ = fmt.Fprintf(&b, `<tr><td>%d</td><td>%s</td><td class="num">%s</td><td class="num">%s</td><td class="num">%s</td><td class="num">%%%s</td><td class="num">%s</td></tr>`,
			i+1, esc(l.Description), esc(qty), formatMoneyTR(l.UnitPrice, d.Currency), disc,
			esc(formatQtyTR(l.VATRate)), formatMoneyTR(l.Total, d.Currency))
	}
	b.WriteString(`</tbody></table>`)

	// Totals.
	vatLabel := "KDV"
	if d.PricesIncludeVAT {
		vatLabel = "KDV (dahil)"
	}
	b.WriteString(`<table class="totals"><tbody>`)
	_, _ = fmt.Fprintf(&b, `<tr><td>Ara toplam</td><td class="num">%s</td></tr>`, formatMoneyTR(d.Subtotal, d.Currency))
	if r, ok := new(big.Rat).SetString(d.DiscountTotal); ok && r.Sign() > 0 {
		_, _ = fmt.Fprintf(&b, `<tr><td>İndirim</td><td class="num">-%s</td></tr>`, formatMoneyTR(d.DiscountTotal, d.Currency))
	}
	_, _ = fmt.Fprintf(&b, `<tr><td>%s</td><td class="num">%s</td></tr>`, vatLabel, formatMoneyTR(d.VATTotal, d.Currency))
	_, _ = fmt.Fprintf(&b, `<tr class="grand"><td>Genel toplam</td><td class="num">%s</td></tr>`, formatMoneyTR(d.GrandTotal, d.Currency))
	b.WriteString(`</tbody></table>`)

	if strings.TrimSpace(d.Notes) != "" {
		b.WriteString(`<div class="section"><h3>Notlar</h3><div>` + nl2br(d.Notes) + `</div></div>`)
	}
	if strings.TrimSpace(d.Terms) != "" {
		b.WriteString(`<div class="section"><h3>Koşullar</h3><div>` + nl2br(d.Terms) + `</div></div>`)
	}
	b.WriteString(`<div class="foot">`)
	if d.OrgFooter != "" {
		b.WriteString(esc(d.OrgFooter) + `<br>`)
	}
	if d.ShareURL != "" {
		b.WriteString(`Teklifi çevrimiçi görüntüleyin: ` + esc(d.ShareURL))
	}
	b.WriteString(`</div></body></html>`)
	return b.String()
}
