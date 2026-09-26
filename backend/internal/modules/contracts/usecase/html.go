package usecase

import (
	"fmt"
	"html"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
)

type signatureEmbed struct {
	Label       string
	DisplayName string
	Role        string
	PNGBase64   string
	SignedAt    time.Time
	// OTP consent evidence (zero when the signer did not verify an OTP).
	OTPChannel     string
	OTPPhoneMasked string
	OTPVerifiedAt  time.Time
}

// trTime is Türkiye time (UTC+3, no DST) for evidence timestamps in the PDF.
var trTime = time.FixedZone("UTC+3", 3*60*60)

func formatEvidenceTime(t time.Time) string {
	return t.In(trTime).Format("02.01.2006 15:04:05") + " (UTC+3)"
}

// contractPDFCSPMeta locks down subresource loading for Gotenberg rendering.
const contractPDFCSPMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">`

// activeHTMLTag matches elements that can navigate, load remote documents, or
// execute code even under a restrictive CSP (meta refresh, base, frames,
// objects, scripts). Template HTML is rich text; none of these are needed.
var (
	activeHTMLBlock = regexp.MustCompile(`(?is)<\s*script\b[^>]*>.*?<\s*/\s*script\s*>`)
	activeHTMLTag   = regexp.MustCompile(`(?is)<\s*/?\s*(?:meta|base|link|script|iframe|frame|frameset|object|embed|applet|portal)\b[^>]*>`)
)

// stripActiveHTML removes active/navigating elements from tenant template HTML.
func stripActiveHTML(s string) string {
	return activeHTMLTag.ReplaceAllString(activeHTMLBlock.ReplaceAllString(s, ""), "")
}

type mediaEmbed struct {
	Caption     string
	ContentType string
	DataBase64  string
	FileName    string
}

type contractPDFOptions struct {
	Title       string
	NumberLabel string
	ContentHTML string
	OrgName     string
	OrgAddress  string
	OrgPhone    string
	OrgEmail    string
	// OrgLogoBase64 / OrgLogoMIME replace the initial mark when the org has a logo.
	OrgLogoBase64 string
	OrgLogoMIME   string
	PrimaryColor  string
	Locale        i18n.Locale
	CreatedAt     time.Time
	Signatures    []signatureEmbed
	Media         []mediaEmbed
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

func brandInitial(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "O"
	}
	r := []rune(name)
	return strings.ToUpper(string(r[0]))
}

// tintHex blends color toward white by amount in [0,1].
func tintHex(hex string, amount float64) string {
	hex = strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(hex)), "#")
	if len(hex) == 3 {
		hex = string([]byte{hex[0], hex[0], hex[1], hex[1], hex[2], hex[2]})
	}
	if len(hex) != 6 {
		return "#F8EDE7"
	}
	parse := func(s string) int {
		v, _ := strconv.ParseInt(s, 16, 0)
		return int(v)
	}
	blend := func(c int) int {
		return int(float64(c)*(1-amount) + 255*amount)
	}
	r := blend(parse(hex[0:2]))
	g := blend(parse(hex[2:4]))
	b := blend(parse(hex[4:6]))
	return fmt.Sprintf("#%02X%02X%02X", r, g, b)
}

func buildContractHTML(opts contractPDFOptions) string {
	primary := normalizePrimaryColor(opts.PrimaryColor)
	primarySoft := tintHex(primary, 0.88)
	// Plain white paper and card surfaces with neutral ink: the brand colour is
	// kept for accents only (bar, mark, rules, bullets) so prints stay clean.
	primaryWash := "#FFFFFF"
	ink := "#111827"
	muted := "#4B5563"
	subtle := "#6B7280"
	line := "#E5E7EB"
	paper := "#FFFFFF"
	loc := i18n.Normalize(string(opts.Locale))
	t := func(key string) string { return i18n.Translate(loc, key) }
	initial := brandInitial(opts.OrgName)

	var b strings.Builder
	b.WriteString("<!DOCTYPE html><html><head><meta charset=\"utf-8\">")
	// Template HTML is tenant-authored and rendered by Chromium inside the
	// cluster network: forbid every remote/local subresource, frames and
	// scripts so a template cannot probe internal services (SSRF) or read
	// files into the PDF. Attachments and signatures are inlined as data: URIs.
	b.WriteString(contractPDFCSPMeta)
	b.WriteString("<title>")
	b.WriteString(html.EscapeString(opts.Title))
	b.WriteString("</title>")
	_, _ = fmt.Fprintf(&b, `<style>
@page{margin:14mm 14mm 16mm}
*{box-sizing:border-box}
body{
  font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Roboto,sans-serif;
  font-size:10.75pt;line-height:1.6;color:%s;margin:0;padding:0;background:%s;
}
.sheet{position:relative}
.accent-bar{
  height:6px;margin:0 0 22px;
  background:linear-gradient(90deg,%s 0%%,%s 55%%,%s 100%%);
  border-radius:999px;
}
.header{
  display:flex;justify-content:space-between;align-items:flex-start;gap:28px;
  margin-bottom:26px;
}
.brand{display:flex;gap:14px;align-items:flex-start;min-width:0;flex:1}
.mark{
  width:46px;height:46px;border-radius:14px;flex-shrink:0;
  background:linear-gradient(145deg,%s,%s);
  color:#fff;font-size:18pt;font-weight:700;letter-spacing:-0.04em;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 8px 18px %s33;
}
.logo{
  width:auto;height:52px;max-width:140px;flex-shrink:0;object-fit:contain;display:block;
}
.brand-copy{min-width:0;padding-top:1px}
.brand-name{
  font-size:15.5pt;font-weight:750;color:%s;margin:0 0 3px;
  letter-spacing:-0.03em;line-height:1.15;
}
.brand-meta{font-size:8.75pt;color:%s;line-height:1.45}
.meta-card{
  min-width:148px;text-align:right;padding:12px 14px;
  background:%s;border:1px solid %s;border-radius:14px;
}
.meta-card .label{
  display:block;font-size:7.5pt;text-transform:uppercase;
  letter-spacing:0.08em;color:%s;margin-bottom:2px;font-weight:650;
}
.meta-card .value{display:block;font-weight:700;color:%s;font-size:10.5pt;margin-bottom:10px}
.meta-card .value:last-child{margin-bottom:0}
.hero{
  position:relative;padding:18px 20px 16px;
  background:linear-gradient(180deg,%s 0%%,%s 100%%);
  border:1px solid %s;border-radius:18px;margin-bottom:22px;
  overflow:hidden;
}
.hero:before{
  content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:%s;
}
.eyebrow{
  display:inline-block;font-size:7.75pt;font-weight:700;letter-spacing:0.1em;
  text-transform:uppercase;color:%s;margin:0 0 8px;
  background:%s;padding:4px 9px;border-radius:999px;
}
h1{
  font-size:20pt;margin:0 0 4px;color:%s;letter-spacing:-0.035em;
  font-weight:780;line-height:1.2;
}
.hero-rule{
  width:56px;height:3px;background:%s;border-radius:999px;margin:12px 0 0;
}
.content{margin:0 0 8px;padding:0 2px}
.content p{margin:0 0 0.75em}
.content h2,.content h3{
  color:%s;margin:1.25em 0 0.4em;font-size:12.25pt;
  letter-spacing:-0.02em;font-weight:750;
}
.content ul,.content ol{padding-left:1.35em;margin:0 0 0.9em}
.content ul{list-style:none}
.content ul li{position:relative;padding-left:0.15em;margin:0.28em 0}
.content ul li:before{
  content:"";position:absolute;left:-1em;top:0.55em;
  width:0.42em;height:0.42em;border-radius:50%%;background:%s;
}
.content ol{list-style:none;counter-reset:contract-ol}
.content ol li{
  position:relative;padding-left:0.15em;margin:0.35em 0;
  counter-increment:contract-ol;
}
.content ol li:before{
  content:counter(contract-ol);
  position:absolute;left:-1.55em;top:0.05em;
  width:1.2em;height:1.2em;border-radius:50%%;
  background:%s;color:%s;font-size:8pt;font-weight:700;
  display:flex;align-items:center;justify-content:center;
}
.content strong{font-weight:700;color:%s}
.content a{color:%s}
.section{margin-top:28px;page-break-inside:avoid}
.section-head{
  display:flex;align-items:center;gap:10px;margin:0 0 14px;
}
.section-head h2{
  font-size:11.5pt;margin:0;color:%s;letter-spacing:-0.02em;font-weight:750;
}
.section-head .rule{
  flex:1;height:1px;background:linear-gradient(90deg,%s,%s 40%%,transparent);
}
.sig-grid{display:flex;flex-wrap:wrap;gap:16px}
.sig-card{
  width:236px;border:1px solid %s;border-radius:16px;padding:14px;
  background:#fff;box-shadow:0 1px 0 %s;
  position:relative;overflow:hidden;
}
.sig-card:before{
  content:"";position:absolute;left:0;right:0;top:0;height:4px;background:%s;
}
.sig-card img{max-width:100%%;max-height:70px;display:block;margin:8px 0 10px}
.sig-line{
  height:68px;margin:8px 0 10px;
  border-bottom:1.5px solid %s;
  background:repeating-linear-gradient(
    90deg,transparent,transparent 7px,%s22 7px,%s22 8px
  );
}
.sig-meta{font-size:9pt;color:%s}
.sig-meta strong{display:block;color:%s;margin-bottom:2px;font-size:10pt}
.sig-meta .role{color:%s;font-size:8.25pt}
.media-grid{display:flex;flex-wrap:wrap;gap:14px}
.media-card{
  width:calc(50%% - 7px);border:1px solid %s;border-radius:14px;overflow:hidden;
  background:#fff;page-break-inside:avoid;
}
.media-card img{width:100%%;height:230px;object-fit:cover;display:block}
.media-body{padding:9px 11px;background:%s}
.media-name{font-size:8.5pt;font-weight:650;color:%s;word-break:break-word}
.media-cap{font-size:8pt;color:%s;margin-top:2px}
.footer{
  margin-top:32px;padding:12px 14px;border-radius:12px;
  background:%s;border:1px solid %s;
  font-size:7.75pt;color:%s;display:flex;justify-content:space-between;gap:16px;
}
.footer .mark-mini{
  color:%s;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;
}
</style></head><body><div class="sheet"><div class="accent-bar"></div>`,
		ink, paper,
		primary, tintHex(primary, 0.25), tintHex(primary, 0.55),
		primary, tintHex(primary, 0.18), primary,
		ink, muted,
		primaryWash, line, subtle, ink,
		primaryWash, "#FFFFFF", line, primary,
		primary, primarySoft,
		ink, primary,
		primary, primary,
		primarySoft, primary,
		ink, primary,
		ink, primary, line,
		line, primaryWash, primary,
		ink, primary, primary,
		muted, ink, subtle,
		line, primaryWash, ink, muted,
		primaryWash, line, subtle, primary,
	)

	b.WriteString(`<div class="header"><div class="brand">`)
	if opts.OrgLogoBase64 != "" && strings.HasPrefix(opts.OrgLogoMIME, "image/") {
		_, _ = fmt.Fprintf(&b, `<img class="logo" alt="" src="data:%s;base64,%s">`,
			html.EscapeString(opts.OrgLogoMIME), opts.OrgLogoBase64)
	} else {
		b.WriteString(`<div class="mark">`)
		b.WriteString(html.EscapeString(initial))
		b.WriteString(`</div>`)
	}
	b.WriteString(`<div class="brand-copy"><p class="brand-name">`)
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
	b.WriteString(`</div></div></div><div class="meta-card">`)
	if opts.NumberLabel != "" {
		b.WriteString(`<span class="label">`)
		b.WriteString(html.EscapeString(t("contracts.pdf.number")))
		b.WriteString(`</span><span class="value">`)
		b.WriteString(html.EscapeString(opts.NumberLabel))
		b.WriteString(`</span>`)
	}
	b.WriteString(`<span class="label">`)
	b.WriteString(html.EscapeString(t("contracts.pdf.date")))
	b.WriteString(`</span><span class="value">`)
	b.WriteString(html.EscapeString(opts.CreatedAt.Format("02.01.2006")))
	b.WriteString(`</span></div></div>`)

	b.WriteString(`<div class="hero"><div class="eyebrow">`)
	b.WriteString(html.EscapeString(t("contracts.pdf.document")))
	b.WriteString(`</div><h1>`)
	b.WriteString(html.EscapeString(opts.Title))
	b.WriteString(`</h1><div class="hero-rule"></div></div>`)

	b.WriteString(`<div class="content">`)
	b.WriteString(stripActiveHTML(opts.ContentHTML))
	b.WriteString(`</div>`)

	if len(opts.Media) > 0 {
		b.WriteString(`<div class="section"><div class="section-head"><h2>`)
		b.WriteString(html.EscapeString(t("contracts.pdf.attachments")))
		b.WriteString(`</h2><div class="rule"></div></div><div class="media-grid">`)
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
			b.WriteString(`<div class="media-body"><div class="media-name">`)
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

	if len(opts.Signatures) > 0 {
		b.WriteString(`<div class="section"><div class="section-head"><h2>`)
		b.WriteString(html.EscapeString(t("contracts.pdf.signatures")))
		b.WriteString(`</h2><div class="rule"></div></div><div class="sig-grid">`)
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
				b.WriteString(`<br><span class="role">`)
				b.WriteString(html.EscapeString(sig.Role))
				b.WriteString(`</span>`)
			}
			if !sig.SignedAt.IsZero() {
				b.WriteString(`<br><span class="role">`)
				b.WriteString(html.EscapeString(t("contracts.pdf.signed_at") + ": " + formatEvidenceTime(sig.SignedAt)))
				b.WriteString(`</span>`)
			}
			if !sig.OTPVerifiedAt.IsZero() {
				b.WriteString(`<br><span class="role">`)
				b.WriteString(html.EscapeString(fmt.Sprintf("%s (%s %s): %s",
					t("contracts.pdf.otp_verified"), otpChannelLabel(sig.OTPChannel), sig.OTPPhoneMasked,
					formatEvidenceTime(sig.OTPVerifiedAt))))
				b.WriteString(`</span>`)
			}
			b.WriteString(`</div></div>`)
		}
		b.WriteString(`</div></div>`)
	}

	b.WriteString(`<div class="footer"><span>`)
	b.WriteString(html.EscapeString(t("contracts.pdf.footer")))
	b.WriteString(`</span><span class="mark-mini">`)
	b.WriteString(html.EscapeString(opts.OrgName))
	if opts.NumberLabel != "" {
		b.WriteString(" · ")
		b.WriteString(html.EscapeString(opts.NumberLabel))
	}
	b.WriteString(`</span></div></div></body></html>`)
	return b.String()
}

func otpChannelLabel(channel string) string {
	switch channel {
	case "whatsapp":
		return "WhatsApp"
	case "sms":
		return "SMS"
	default:
		return channel
	}
}
