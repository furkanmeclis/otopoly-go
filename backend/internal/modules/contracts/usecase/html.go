package usecase

import (
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
)

type signatureEmbed struct {
	Label       string
	DisplayName string
	Role        string
	PNGBase64   string
}

type mediaEmbed struct {
	Caption     string
	ContentType string
	DataBase64  string
	FileName    string
}

type contractPDFOptions struct {
	Title        string
	NumberLabel  string
	ContentHTML  string
	OrgName      string
	OrgAddress   string
	OrgPhone     string
	OrgEmail     string
	PrimaryColor string
	Locale       i18n.Locale
	CreatedAt    time.Time
	Signatures   []signatureEmbed
	Media        []mediaEmbed
}

func replaceVariables(contentHTML string, vars map[string]string) string {
	out := contentHTML
	for key, value := range vars {
		token := "{{" + key + "}}"
		out = strings.ReplaceAll(out, token, html.EscapeString(value))
	}
	return out
}

func normalizePrimaryColor(color string) string {
	c := strings.TrimSpace(color)
	if c == "" {
		return "#EA6E43"
	}
	if !strings.HasPrefix(c, "#") {
		c = "#" + c
	}
	if len(c) != 4 && len(c) != 7 {
		return "#EA6E43"
	}
	return strings.ToUpper(c)
}

func formatContractNumber(n int32) string {
	if n <= 0 {
		return ""
	}
	return fmt.Sprintf("SZL-%04d", n)
}

func buildContractHTML(opts contractPDFOptions) string {
	primary := normalizePrimaryColor(opts.PrimaryColor)
	loc := i18n.Normalize(string(opts.Locale))
	t := func(key string) string { return i18n.Translate(loc, key) }

	var b strings.Builder
	b.WriteString("<!DOCTYPE html><html><head><meta charset=\"utf-8\">")
	b.WriteString("<title>")
	b.WriteString(html.EscapeString(opts.Title))
	b.WriteString("</title>")
	_, _ = fmt.Fprintf(&b, `<style>
@page{margin:18mm 16mm}
body{font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;font-size:11pt;line-height:1.55;color:#2a241f;margin:0;padding:0;background:#fff}
.header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:14px;border-bottom:3px solid %s;margin-bottom:22px}
.brand{min-width:0}
.brand-name{font-size:16pt;font-weight:700;color:%s;margin:0 0 4px;letter-spacing:-0.02em}
.brand-meta{font-size:9pt;color:#6b635c;line-height:1.4}
.meta{text-align:right;font-size:9.5pt;color:#4a433c;white-space:nowrap}
.meta .label{display:block;font-size:8pt;text-transform:uppercase;letter-spacing:0.06em;color:#8a8178;margin-bottom:2px}
.meta .value{font-weight:600;color:#2a241f}
h1{font-size:18pt;margin:0 0 6px;color:#2a241f;letter-spacing:-0.02em}
.subtitle{font-size:9.5pt;color:#6b635c;margin:0 0 18px}
.content{margin-bottom:8px}
.content p{margin:0 0 0.7em}
.content h2,.content h3{color:%s;margin:1.1em 0 0.45em;font-size:12.5pt}
.content ul{list-style:disc;padding-left:1.4em;margin:0 0 0.8em}
.content ol{list-style:decimal;padding-left:1.4em;margin:0 0 0.8em}
.content li{margin:0.2em 0}
.content strong{font-weight:650}
.section{margin-top:26px;page-break-inside:avoid}
.section h2{font-size:12pt;margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid %s;color:%s}
.sig-grid{display:flex;flex-wrap:wrap;gap:20px}
.sig-card{width:240px;border:1px solid #e8e0d8;border-radius:8px;padding:12px;background:#fbf8f5}
.sig-card img{max-width:100%%;max-height:72px;display:block;margin-bottom:8px}
.sig-line{height:72px;border-bottom:1px solid #2a241f;margin-bottom:8px}
.sig-meta{font-size:9.5pt;color:#4a433c}
.sig-meta strong{display:block;color:#2a241f;margin-bottom:2px}
.media-grid{display:flex;flex-wrap:wrap;gap:14px}
.media-card{width:220px;border:1px solid #e8e0d8;border-radius:8px;overflow:hidden;background:#fff}
.media-card img{width:100%%;max-height:150px;object-fit:cover;display:block}
.media-body{padding:8px 10px}
.media-cap{font-size:8.5pt;color:#6b635c}
.footer{margin-top:28px;padding-top:10px;border-top:1px solid #e8e0d8;font-size:8pt;color:#8a8178}
</style></head><body>`, primary, primary, primary, primary, primary)

	b.WriteString(`<div class="header"><div class="brand">`)
	b.WriteString(`<p class="brand-name">`)
	b.WriteString(html.EscapeString(opts.OrgName))
	b.WriteString(`</p><div class="brand-meta">`)
	if opts.OrgAddress != "" {
		b.WriteString(html.EscapeString(opts.OrgAddress))
		b.WriteString(`<br>`)
	}
	var contactParts []string
	if opts.OrgPhone != "" {
		contactParts = append(contactParts, opts.OrgPhone)
	}
	if opts.OrgEmail != "" {
		contactParts = append(contactParts, opts.OrgEmail)
	}
	if len(contactParts) > 0 {
		b.WriteString(html.EscapeString(strings.Join(contactParts, " · ")))
	}
	b.WriteString(`</div></div><div class="meta">`)
	if opts.NumberLabel != "" {
		b.WriteString(`<span class="label">`)
		b.WriteString(html.EscapeString(t("contracts.pdf.number")))
		b.WriteString(`</span><span class="value">`)
		b.WriteString(html.EscapeString(opts.NumberLabel))
		b.WriteString(`</span><br><br>`)
	}
	b.WriteString(`<span class="label">`)
	b.WriteString(html.EscapeString(t("contracts.pdf.date")))
	b.WriteString(`</span><span class="value">`)
	b.WriteString(html.EscapeString(opts.CreatedAt.Format("02.01.2006")))
	b.WriteString(`</span></div></div>`)

	b.WriteString(`<h1>`)
	b.WriteString(html.EscapeString(opts.Title))
	b.WriteString(`</h1><p class="subtitle">`)
	b.WriteString(html.EscapeString(t("contracts.pdf.document")))
	b.WriteString(`</p><div class="content">`)
	b.WriteString(opts.ContentHTML)
	b.WriteString(`</div>`)

	if len(opts.Signatures) > 0 {
		b.WriteString(`<div class="section"><h2>`)
		b.WriteString(html.EscapeString(t("contracts.pdf.signatures")))
		b.WriteString(`</h2><div class="sig-grid">`)
		for _, sig := range opts.Signatures {
			b.WriteString(`<div class="sig-card">`)
			if sig.PNGBase64 != "" {
				b.WriteString(`<img alt="signature" src="data:image/png;base64,`)
				b.WriteString(sig.PNGBase64)
				b.WriteString(`">`)
			} else {
				b.WriteString(`<div class="sig-line"></div>`)
			}
			b.WriteString(`<div class="sig-meta"><strong>`)
			b.WriteString(html.EscapeString(sig.Label))
			b.WriteString(`</strong>`)
			b.WriteString(html.EscapeString(sig.DisplayName))
			if sig.Role != "" {
				b.WriteString(`<br><span>`)
				b.WriteString(html.EscapeString(sig.Role))
				b.WriteString(`</span>`)
			}
			b.WriteString(`</div></div>`)
		}
		b.WriteString(`</div></div>`)
	}

	if len(opts.Media) > 0 {
		b.WriteString(`<div class="section"><h2>`)
		b.WriteString(html.EscapeString(t("contracts.pdf.attachments")))
		b.WriteString(`</h2><div class="media-grid">`)
		for _, m := range opts.Media {
			b.WriteString(`<div class="media-card">`)
			if m.DataBase64 != "" && strings.HasPrefix(m.ContentType, "image/") {
				ct := m.ContentType
				if ct == "" {
					ct = "image/jpeg"
				}
				_, _ = fmt.Fprintf(&b, `<img alt="%s" src="data:%s;base64,%s">`,
					html.EscapeString(m.FileName), html.EscapeString(ct), m.DataBase64)
			}
			b.WriteString(`<div class="media-body">`)
			b.WriteString(`<div class="sig-meta">`)
			b.WriteString(html.EscapeString(m.FileName))
			b.WriteString(`</div>`)
			if m.Caption != "" {
				b.WriteString(`<div class="media-cap">`)
				b.WriteString(html.EscapeString(m.Caption))
				b.WriteString(`</div>`)
			}
			b.WriteString(`</div></div>`)
		}
		b.WriteString(`</div></div>`)
	}

	b.WriteString(`<div class="footer">`)
	b.WriteString(html.EscapeString(t("contracts.pdf.footer")))
	b.WriteString(`</div></body></html>`)
	return b.String()
}
