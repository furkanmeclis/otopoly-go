// Package pushtext holds the lock-screen-safe texts of mobile push
// notifications. In-app titles/bodies may carry amounts, customer names or
// phone numbers; a push is visible on a locked screen, so it only ever uses
// the fixed texts below plus a small whitelist of harmless variables.
package pushtext

import (
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
)

// SafeVars are the only template variables a push text may contain. They are
// copied into the in-app notification payload under "push_vars".
var SafeVars = []string{"quote_number", "due_in", "feature_label", "days_left"}

// Text is one localized push.
type Text struct {
	Title string
	Body  string
}

type pair struct{ tr, en Text }

var catalog = map[string]pair{
	"quote.team_created": {
		tr: Text{"Yeni teklif {{quote_number}}", "Takip ettiğiniz bir müşteri için yeni teklif oluşturuldu."},
		en: Text{"New quote {{quote_number}}", "A new quote was created for a customer you follow."},
	},
	"quote.team_expiring": {
		tr: Text{"Teklif yarın sona eriyor", "{{quote_number}} numaralı teklifin geçerliliği yarın bitiyor."},
		en: Text{"Quote expires tomorrow", "Quote {{quote_number}} expires tomorrow."},
	},
	"quote.team_accepted": {
		tr: Text{"Teklif onaylandı", "{{quote_number}} numaralı teklif müşteri tarafından onaylandı."},
		en: Text{"Quote accepted", "The customer accepted quote {{quote_number}}."},
	},
	"quote.team_rejected": {
		tr: Text{"Teklif reddedildi", "{{quote_number}} numaralı teklif müşteri tarafından reddedildi."},
		en: Text{"Quote rejected", "The customer rejected quote {{quote_number}}."},
	},
	"todo.reminder": {
		tr: Text{"Görev hatırlatması", "Bir görevinizin zamanı yaklaşıyor ({{due_in}})."},
		en: Text{"Task reminder", "One of your tasks is due {{due_in}}."},
	},
	"billing.usage_warning": {
		tr: Text{"Kullanım uyarısı", "{{feature_label}} kullanımı plan limitine yaklaştı."},
		en: Text{"Usage notice", "{{feature_label}} usage is close to the plan limit."},
	},
	"billing.limit_full": {
		tr: Text{"Plan limiti doldu", "{{feature_label}} için plan limitine ulaşıldı."},
		en: Text{"Plan limit reached", "The plan limit for {{feature_label}} has been reached."},
	},
	"billing.limit_reached": {
		tr: Text{"Plan limiti doldu", "{{feature_label}} limiti nedeniyle bir işlem yapılamadı."},
		en: Text{"Plan limit reached", "An action was blocked by the {{feature_label}} limit."},
	},
	"billing.subscription_ending": {
		tr: Text{"Abonelik süresi doluyor", "Aboneliğinizin süresi {{days_left}} gün içinde doluyor."},
		en: Text{"Subscription ending", "Your subscription ends in {{days_left}} days."},
	},
}

var fallback = pair{
	tr: Text{"Otopoly", "Yeni bir bildiriminiz var."},
	en: Text{"Otopoly", "You have a new notification."},
}

// For renders the push for a notification kind (e.g. "quote.team_accepted")
// in locale ("tr" | "en"; anything else → "tr"). Unknown kinds get a generic
// text. Only SafeVars are substituted; a text whose variables are missing
// falls back to the kind-less generic body so no "{{…}}" or empty gap leaks.
func For(kind, locale string, vars map[string]string) Text {
	p, ok := catalog[kind]
	if !ok {
		p = fallback
	}
	t := p.tr
	fb := fallback.tr
	if strings.EqualFold(strings.TrimSpace(locale), "en") {
		t = p.en
		fb = fallback.en
	}
	safe := map[string]string{}
	for _, k := range SafeVars {
		if v := strings.TrimSpace(vars[k]); v != "" {
			safe[k] = v
		}
	}
	title := render(t.Title, safe)
	body := render(t.Body, safe)
	if title == "" {
		title = fb.Title
	}
	if body == "" {
		body = fb.Body
	}
	return Text{Title: title, Body: body}
}

// render substitutes vars; returns "" when any placeholder has no value.
func render(tpl string, vars map[string]string) string {
	for _, k := range msgtemplate.Placeholders(tpl) {
		if vars[k] == "" {
			return ""
		}
	}
	return strings.TrimSpace(msgtemplate.Render(tpl, vars))
}

// Known reports whether kind has a dedicated text.
func Known(kind string) bool {
	_, ok := catalog[kind]
	return ok
}
