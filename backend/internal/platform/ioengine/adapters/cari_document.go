package adapters

import (
	"encoding/base64"
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine"
)

// cariStatement is the structured account statement behind the PDF document.
type cariStatement struct {
	CustomerName  string
	CustomerPhone string
	TaxID         string
	TaxOffice     string
	Currency      string
	Balance       float64
	TotalDebit    float64
	TotalCredit   float64
	Entries       []cariStatementEntry
}

type cariStatementEntry struct {
	At          time.Time
	Date        string
	Type        string
	Description string
	Amount      float64
	Debit       bool
	Balance     float64
	Void        bool
}

var cariDocTZ = func() *time.Location {
	if l, err := time.LoadLocation("Europe/Istanbul"); err == nil {
		return l
	}
	return time.FixedZone("TRT", 3*60*60)
}()

// DocumentHTML renders the statement as an A4 document (Gotenberg Chromium):
// letterhead, customer card, summary tiles and a coloured movement table.
func (a *CariEntriesAdapter) DocumentHTML(ds ioengine.Dataset, locale string, lh *ioengine.Letterhead, title string) (string, error) {
	st, ok := ds.Doc.(*cariStatement)
	if !ok || st == nil {
		return "", fmt.Errorf("cari statement data missing")
	}
	return buildCariStatementHTML(st, i18n.Normalize(locale), lh, title, time.Now()), nil
}

func buildCariStatementHTML(st *cariStatement, loc i18n.Locale, lh *ioengine.Letterhead, title string, now time.Time) string {
	esc := html.EscapeString
	tr := func(k string) string { return esc(i18n.Translate(loc, k)) }
	money := func(v float64) string { return esc(formatMoney(v, st.Currency, loc)) }
	accent := "#EA6E43"
	company := ""
	if lh != nil {
		accent = cariDocColor(lh.PrimaryColor)
		company = strings.TrimSpace(lh.CompanyName)
	}

	var b strings.Builder
	b.WriteString(`<!DOCTYPE html><html lang="` + string(loc) + `"><head><meta charset="utf-8"><title>` + esc(title) + `</title><style>
@page{size:A4;margin:14mm 13mm 16mm}
*{box-sizing:border-box}
body{font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Roboto,"DejaVu Sans",sans-serif;font-size:9.5pt;line-height:1.45;color:#2A241F;margin:0}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:14px;margin-bottom:16px;border-bottom:3px solid ` + accent + `}
.brand{display:flex;gap:12px;align-items:center}
.brand img{max-height:52px;max-width:150px;object-fit:contain}
.brand h1{font-size:14pt;margin:0}
.muted{color:#7A7169;font-size:8.5pt}
.doc{text-align:right}
.doc .title{font-size:17pt;font-weight:700;color:` + accent + `;letter-spacing:.3px}
.row{display:flex;gap:10px;margin-bottom:14px}
.card{flex:1;border:1px solid #EAE2DA;border-radius:10px;padding:10px 12px;background:#FFFCFA}
.card h3{margin:0 0 4px;font-size:7.5pt;text-transform:uppercase;color:#8A8178;letter-spacing:.7px;font-weight:600}
.card .name{font-size:11.5pt;font-weight:700}
.tile{flex:1;border-radius:10px;padding:10px 12px;border:1px solid transparent}
.tile .lbl{font-size:7.5pt;text-transform:uppercase;letter-spacing:.7px;font-weight:600}
.tile .val{font-size:14pt;font-weight:700;margin-top:2px;white-space:nowrap}
.t-debit{background:#FFF1F0;border-color:#FAD4D0;color:#B4332A}
.t-credit{background:#EEFAF3;border-color:#C9EBD7;color:#1D7A48}
.t-balance{background:` + accent + `;color:#fff}
.t-balance .lbl{opacity:.85}
.sub{font-size:7.5pt;opacity:.85;margin-top:1px}
table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #EAE2DA;border-radius:10px;overflow:hidden}
thead th{background:#F6F1EC;text-align:left;font-size:7.5pt;text-transform:uppercase;letter-spacing:.6px;color:#6B635C;padding:8px 9px;font-weight:600}
tbody td{padding:7px 9px;border-top:1px solid #F0E9E2;vertical-align:top}
tbody tr:nth-child(even) td{background:#FCFAF8}
tr{page-break-inside:avoid}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.date{white-space:nowrap;color:#5E5750}
.pill{display:inline-block;border-radius:999px;padding:1px 8px;font-size:7.5pt;font-weight:600;white-space:nowrap}
.p-charge{background:#FFF1F0;color:#B4332A}
.p-payment{background:#EEFAF3;color:#1D7A48}
.p-adjustment{background:#EEF3FF;color:#3151B5}
.p-opening{background:#F3F0EC;color:#6B635C}
.p-void{background:#EEE;color:#777;margin-left:4px}
.debit{color:#B4332A;font-weight:600}
.credit{color:#1D7A48;font-weight:600}
.bal{font-weight:600}
tr.void td{color:#A39B94}
tr.void td.amt{text-decoration:line-through}
tfoot td{background:#F6F1EC;font-weight:700;padding:9px;border-top:2px solid ` + accent + `}
.empty{padding:22px;text-align:center;color:#8A8178}
.foot{margin-top:18px;display:flex;justify-content:space-between;gap:12px;border-top:1px solid #EAE2DA;padding-top:8px;font-size:7.5pt;color:#8A8178}
</style></head><body>`)

	// Letterhead.
	b.WriteString(`<div class="head"><div class="brand">`)
	if lh != nil && len(lh.LogoBytes) > 0 && strings.HasPrefix(lh.LogoMIME, "image/") {
		b.WriteString(`<img alt="" src="data:` + esc(lh.LogoMIME) + `;base64,` + base64.StdEncoding.EncodeToString(lh.LogoBytes) + `">`)
	}
	b.WriteString(`<div>`)
	if company != "" {
		b.WriteString(`<h1>` + esc(company) + `</h1>`)
	}
	if lh != nil {
		if t := strings.TrimSpace(lh.Tagline); t != "" {
			b.WriteString(`<div class="muted">` + esc(t) + `</div>`)
		}
		var contact []string
		for _, v := range []string{lh.Address, lh.Phone, lh.Email, lh.Website} {
			if v = strings.TrimSpace(v); v != "" {
				contact = append(contact, esc(v))
			}
		}
		if len(contact) > 0 {
			b.WriteString(`<div class="muted">` + strings.Join(contact, " · ") + `</div>`)
		}
	}
	b.WriteString(`</div></div><div class="doc"><div class="title">` + esc(title) + `</div>`)
	b.WriteString(`<div class="muted">` + tr("cari.doc.generated") + `: ` + esc(cariDocDateTime(now, loc)) + `</div>`)
	if first, last, ok := cariStatementPeriod(st); ok {
		b.WriteString(`<div class="muted">` + tr("cari.doc.period") + `: ` + esc(first) + ` – ` + esc(last) + `</div>`)
	}
	b.WriteString(`</div></div>`)

	// Customer + summary tiles.
	b.WriteString(`<div class="row"><div class="card" style="flex:1.3"><h3>` + tr("cari.customer_name") + `</h3><div class="name">` + esc(st.CustomerName) + `</div>`)
	if st.CustomerPhone != "" {
		b.WriteString(`<div class="muted">` + esc(st.CustomerPhone) + `</div>`)
	}
	if st.TaxID != "" {
		tax := st.TaxID
		if st.TaxOffice != "" {
			tax = st.TaxOffice + " / " + st.TaxID
		}
		b.WriteString(`<div class="muted">` + tr("cari.customer_tax") + `: ` + esc(tax) + `</div>`)
	}
	b.WriteString(`</div>`)
	b.WriteString(`<div class="tile t-debit"><div class="lbl">` + tr("cari.doc.total_debit") + `</div><div class="val">` + money(st.TotalDebit) + `</div></div>`)
	b.WriteString(`<div class="tile t-credit"><div class="lbl">` + tr("cari.doc.total_credit") + `</div><div class="val">` + money(st.TotalCredit) + `</div></div>`)
	balanceNote := "cari.doc.balance_zero"
	switch {
	case st.Balance > 0.004:
		balanceNote = "cari.doc.balance_owed"
	case st.Balance < -0.004:
		balanceNote = "cari.doc.balance_credit"
	}
	b.WriteString(`<div class="tile t-balance"><div class="lbl">` + tr("cari.current_balance") + `</div><div class="val">` + money(st.Balance) + `</div><div class="sub">` + tr(balanceNote) + `</div></div></div>`)

	// Movements.
	b.WriteString(`<table><thead><tr><th>` + tr("cari.entry_date") + `</th><th>` + tr("cari.entry_type") + `</th><th style="width:38%">` + tr("cari.description") + `</th><th class="num">` + tr("cari.debit") + `</th><th class="num">` + tr("cari.credit") + `</th><th class="num">` + tr("cari.balance") + `</th></tr></thead><tbody>`)
	if len(st.Entries) == 0 {
		b.WriteString(`<tr><td colspan="6" class="empty">` + tr("cari.doc.empty") + `</td></tr>`)
	}
	for _, e := range st.Entries {
		cls := ""
		if e.Void {
			cls = ` class="void"`
		}
		b.WriteString(`<tr` + cls + `><td class="date">` + esc(e.Date) + `</td><td><span class="pill p-` + esc(cariPillKind(e.Type)) + `">` + tr("cari.entry_type."+e.Type) + `</span>`)
		if e.Void {
			b.WriteString(`<span class="pill p-void">` + tr("cari.entry_status.void") + `</span>`)
		}
		desc := e.Description
		if desc == "" {
			desc = "—"
		}
		b.WriteString(`</td><td>` + esc(desc) + `</td>`)
		if e.Debit {
			b.WriteString(`<td class="num amt debit">` + money(e.Amount) + `</td><td class="num"></td>`)
		} else {
			b.WriteString(`<td class="num"></td><td class="num amt credit">` + money(e.Amount) + `</td>`)
		}
		b.WriteString(`<td class="num bal">` + money(e.Balance) + `</td></tr>`)
	}
	b.WriteString(`</tbody><tfoot><tr><td colspan="3">` + tr("cari.totals") + `</td><td class="num">` + money(st.TotalDebit) + `</td><td class="num">` + money(st.TotalCredit) + `</td><td class="num">` + money(st.Balance) + `</td></tr></tfoot></table>`)

	// Footer.
	footer := ""
	if lh != nil {
		footer = strings.TrimSpace(lh.FooterText)
	}
	b.WriteString(`<div class="foot"><span>` + esc(footer) + `</span><span>` + tr("cari.doc.void_note") + `</span></div>`)
	b.WriteString(`</body></html>`)
	return b.String()
}

func cariPillKind(t string) string {
	switch t {
	case "charge", "payment", "adjustment", "opening":
		return t
	}
	return "opening"
}

func cariStatementPeriod(st *cariStatement) (string, string, bool) {
	var first, last time.Time
	for _, e := range st.Entries {
		if e.At.IsZero() {
			continue
		}
		if first.IsZero() || e.At.Before(first) {
			first = e.At
		}
		if e.At.After(last) {
			last = e.At
		}
	}
	if first.IsZero() {
		return "", "", false
	}
	return first.Format("02.01.2006"), last.Format("02.01.2006"), true
}

func cariDocDateTime(t time.Time, loc i18n.Locale) string {
	t = t.In(cariDocTZ)
	if loc == i18n.LocaleEN {
		return t.Format("2006-01-02 15:04")
	}
	return t.Format("02.01.2006 15:04")
}

// cariDocColor accepts #RGB / #RRGGBB (letterhead brand colour).
func cariDocColor(c string) string {
	c = strings.TrimSpace(c)
	if c == "" {
		return "#EA6E43"
	}
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
	return c
}
