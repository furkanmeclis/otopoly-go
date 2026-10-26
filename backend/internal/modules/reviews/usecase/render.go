package usecase

import (
	"regexp"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
)

// Template variables of review.request. The Turkish names are the ones shown
// to the business; the English aliases feed the platform WhatsApp catalog
// entry (customer_name, business_name, review_link).
const (
	VarCustomer = "musteri_adi"
	VarBusiness = "isletme_adi"
	VarLink     = "link"
)

// singleBraceRE matches the short form {musteri_adi} (not part of {{…}}).
var singleBraceRE = regexp.MustCompile(`(^|[^{])\{(musteri_adi|isletme_adi|link)\}([^}]|$)`)

// Render fills the template. Both {{musteri_adi}} and the short
// {musteri_adi} form are accepted for the three review variables.
func Render(tpl string, vars map[string]string) string {
	for i := 0; i < 2; i++ { // twice: adjacent matches share a boundary rune
		tpl = singleBraceRE.ReplaceAllString(tpl, "$1{{$2}}$3")
	}
	return strings.TrimSpace(msgtemplate.Render(tpl, vars))
}

// Vars returns the template variables (plus catalog aliases).
func Vars(customer, business, link string) map[string]string {
	return map[string]string{
		VarCustomer: customer, VarBusiness: business, VarLink: link,
		"customer_name": customer, "business_name": business, "company_name": business, "review_link": link,
	}
}

// DefaultBody is the built-in text when no template row exists.
func DefaultBody(channel, locale string) string {
	if locale == "en" {
		if channel == ChannelSMS {
			return "Hi {{musteri_adi}}, how was your service at {{isletme_adi}}? Rate us: {{link}}"
		}
		return "Hi {{musteri_adi}},\n\nThank you for choosing {{isletme_adi}}. Could you take a minute to rate our service?\n{{link}}"
	}
	if channel == ChannelSMS {
		return "Merhaba {{musteri_adi}}, {{isletme_adi}} hizmetini değerlendirir misiniz? {{link}}"
	}
	return "Merhaba {{musteri_adi}},\n\n{{isletme_adi}} olarak bizi tercih ettiğiniz için teşekkür ederiz. Hizmetimizi 1 dakikada değerlendirir misiniz?\n{{link}}"
}

// FirstName is the greeting name on the public page (no surname).
func FirstName(full string) string {
	f := strings.Fields(full)
	if len(f) == 0 {
		return ""
	}
	return f[0]
}
