// Package catalog is the platform WhatsApp template catalog: one entry per
// message kind the platform number can send. Cloud API sends use the entry as
// a Meta template (positional {{n}} body params); the platform whatsmeow
// number sends the same entry rendered as plain text.
//
// Texts are strictly transactional (no promotional wording) so Meta
// classifies them as UTILITY; the business name is always a parameter
// (AUTHENTICATION bodies are fixed by Meta and cannot carry it).
//
// Every entry exists in Turkish (the default) and English: Meta keeps one
// template name with one translation per language, so the same MetaName is
// submitted once per language and the sender picks the recipient locale.
package catalog

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
)

// Meta template categories.
const (
	CategoryUtility        = "UTILITY"
	CategoryAuthentication = "AUTHENTICATION"
)

// Language is the default (and fallback) catalog language.
const Language = "tr"

// Languages lists every language the catalog is submitted in (Meta language
// codes). The first one is the default.
var Languages = []string{Language, "en"}

// Translation is the text of one entry in a non-default language.
type Translation struct {
	// Body is the Meta body text with the same positional params as the
	// default Body (same order, same count).
	Body string
	// Examples are sample values for Params in that language.
	Examples []string
	// Text optionally overrides the plain-text rendering (see Entry.Text).
	Text string
}

// Derived variable: amount and currency in one parameter (Meta rejects
// adjacent variables such as "{{2}} {{3}}").
const varAmountText = "amount_text"

// MaxParamRunes caps one rendered parameter.
const MaxParamRunes = 400

// Entry is one platform template.
type Entry struct {
	// Key is the messaging event type (outbound_messages.event_type).
	Key string
	// MetaName is the default Meta template name (lowercase, otopoly_ prefix).
	MetaName string
	Category string
	Language string
	// Body is the Meta body text with positional {{1}}…{{n}} params.
	Body string
	// Params are the variable names behind {{1}}…{{n}}, in order.
	Params []string
	// Examples are sample values for Params (required by Meta on submit).
	Examples []string
	// HeaderDocument adds a DOCUMENT header (quote PDF).
	HeaderDocument bool
	// CopyCodeButton adds the OTP copy-code button (AUTHENTICATION).
	CopyCodeButton bool
	// CodeExpirationMinutes is the AUTHENTICATION footer value.
	CodeExpirationMinutes int
	// Text optionally overrides the plain-text rendering (named
	// {{var}} placeholders) used by the platform whatsmeow number.
	Text string
	// Translations holds the non-default languages (key: Meta language code).
	Translations map[string]Translation
}

var entries = []Entry{
	{
		Key: model.EventJobCreated, MetaName: "otopoly_job_created", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} plakalı aracınız {{3}} tarafından servis kaydına alındı. İş numaranız: {{4}}. İşlem durumu değiştiğinde bu numaradan bilgilendirileceksiniz.",
		Params:   []string{"customer_name", "plate", "business_name", "job_id"},
		Examples: []string{"Ahmet Yılmaz", "34 ABC 123", "Tech Oto", "JOB-0001"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, your vehicle with plate {{2}} has been checked in for service by {{3}}. Your job number is {{4}}. You will be notified from this number when the status changes.",
			Examples: []string{"John Smith", "34 ABC 123", "Tech Auto", "JOB-0001"},
		}},
	},
	{
		Key: model.EventContractSigned, MetaName: "otopoly_contract_signed", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} başlıklı sözleşmeniz {{3}} ile imzalandı. Plaka: {{4}}. Bu mesaj imza işleminizin kaydıdır.",
		Params:   []string{"customer_name", "contract_title", "business_name", "plate"},
		Examples: []string{"Ahmet Yılmaz", "Hizmet Sözleşmesi", "Tech Oto", "34 ABC 123"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, your contract titled {{2}} has been signed with {{3}}. Plate: {{4}}. This message is the record of your signature.",
			Examples: []string{"John Smith", "Service Agreement", "Tech Auto", "34 ABC 123"},
		}},
	},
	{
		Key: model.EventJobReady, MetaName: "otopoly_job_ready", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} plakalı aracınızın {{3}} tarafından yürütülen işlemi tamamlandı ve aracınız teslime hazır. İş numaranız: {{4}}. Teslim için işletmeyle iletişime geçebilirsiniz.",
		Params:   []string{"customer_name", "plate", "business_name", "job_id"},
		Examples: []string{"Ahmet Yılmaz", "34 ABC 123", "Tech Oto", "JOB-0001"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, the work on your vehicle with plate {{2}} carried out by {{3}} is complete and your vehicle is ready for pickup. Your job number is {{4}}. Please contact the business to arrange delivery.",
			Examples: []string{"John Smith", "34 ABC 123", "Tech Auto", "JOB-0001"},
		}},
	},
	{
		Key: model.EventJobDelivered, MetaName: "otopoly_job_delivered", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} plakalı aracınız {{3}} tarafından teslim edildi. İş numaranız: {{4}}. Bu mesaj teslim işleminizin kaydıdır.",
		Params:   []string{"customer_name", "plate", "business_name", "job_id"},
		Examples: []string{"Ahmet Yılmaz", "34 ABC 123", "Tech Oto", "JOB-0001"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, your vehicle with plate {{2}} has been delivered by {{3}}. Your job number is {{4}}. This message is the record of your delivery.",
			Examples: []string{"John Smith", "34 ABC 123", "Tech Auto", "JOB-0001"},
		}},
	},
	{
		Key: model.EventJobPaid, MetaName: "otopoly_job_paid", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} tutarındaki ödemeniz {{3}} tarafından alındı. Plaka: {{4}}. Bu mesaj ödeme kaydınızın onayıdır.",
		Params:   []string{"customer_name", varAmountText, "business_name", "plate"},
		Examples: []string{"Ahmet Yılmaz", "1.250,00 TRY", "Tech Oto", "34 ABC 123"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, your payment of {{2}} has been received by {{3}}. Plate: {{4}}. This message confirms your payment record.",
			Examples: []string{"John Smith", "1,250.00 TRY", "Tech Auto", "34 ABC 123"},
		}},
	},
	{
		Key: model.EventJobCancelled, MetaName: "otopoly_job_cancelled", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} plakalı aracınız için {{3}} nezdindeki işlem kaydı iptal edildi. İş numarası: {{4}}. Sorularınız için işletmeyle iletişime geçebilirsiniz.",
		Params:   []string{"customer_name", "plate", "business_name", "job_id"},
		Examples: []string{"Ahmet Yılmaz", "34 ABC 123", "Tech Oto", "JOB-0001"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, the service record for your vehicle with plate {{2}} at {{3}} has been cancelled. Job number: {{4}}. Please contact the business with any questions.",
			Examples: []string{"John Smith", "34 ABC 123", "Tech Auto", "JOB-0001"},
		}},
	},
	{
		Key: model.EventSaleCreated, MetaName: "otopoly_sale_created", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} üzerinden satış kaydınız oluşturuldu. Tutar: {{3}}. Bu mesaj satış işleminizin kaydıdır.",
		Params:   []string{"customer_name", "business_name", varAmountText},
		Examples: []string{"Ahmet Yılmaz", "Tech Oto", "1.250,00 TRY"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, your sales record at {{2}} has been created. Amount: {{3}}. This message is the record of your purchase.",
			Examples: []string{"John Smith", "Tech Auto", "1,250.00 TRY"},
		}},
	},
	{
		Key: model.EventQuoteCreated, MetaName: "otopoly_quote_created", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} tarafından {{3}} numaralı teklifiniz hazırlandı. Toplam: {{4}}. Geçerlilik tarihi: {{5}}. Ayrıntılar için işletmeyle iletişime geçebilirsiniz.",
		Params:   []string{"customer_name", "business_name", "quote_number", "total_amount", "valid_until"},
		Examples: []string{"Ahmet Yılmaz", "Tech Oto", "TKL-000042", "12.500,00 TRY", "30.09.2026"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, {{2}} has prepared your quote number {{3}}. Total: {{4}}. Valid until: {{5}}. Please contact the business for details.",
			Examples: []string{"John Smith", "Tech Auto", "QTE-000042", "12,500.00 TRY", "30.09.2026"},
		}},
	},
	{
		Key: model.EventQuoteSent, MetaName: "otopoly_quote_sent", Category: CategoryUtility,
		Body:           "Sayın {{1}}, {{2}} tarafından hazırlanan {{3}} numaralı teklifiniz ektedir. Toplam: {{4}}. Geçerlilik tarihi: {{5}}. Sorularınız için işletmeyle iletişime geçebilirsiniz.",
		Params:         []string{"customer_name", "business_name", "quote_number", "total_amount", "valid_until"},
		Examples:       []string{"Ahmet Yılmaz", "Tech Oto", "TKL-000042", "12.500,00 TRY", "30.09.2026"},
		HeaderDocument: true,
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, {{2}} has sent you quote number {{3}}, attached to this message. Total: {{4}}. Valid until: {{5}}. Please contact the business with any questions.",
			Examples: []string{"John Smith", "Tech Auto", "QTE-000042", "12,500.00 TRY", "30.09.2026"},
		}},
	},
	{
		Key: model.EventQuoteReminder, MetaName: "otopoly_quote_reminder", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} tarafından iletilen {{3}} numaralı teklifiniz yanıt bekliyor. Toplam: {{4}}. Geçerlilik tarihi: {{5}}. Yanıtınızı işletmeye iletebilirsiniz.",
		Params:   []string{"customer_name", "business_name", "quote_number", "total_amount", "valid_until"},
		Examples: []string{"Ahmet Yılmaz", "Tech Oto", "TKL-000042", "12.500,00 TRY", "30.09.2026"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, {{2}} is awaiting your response to quote number {{3}}. Total: {{4}}. Valid until: {{5}}. You can send your response to the business.",
			Examples: []string{"John Smith", "Tech Auto", "QTE-000042", "12,500.00 TRY", "30.09.2026"},
		}},
	},
	{
		// Pure status information about a quote the customer requested: no
		// call to action, no urgency, no "respond" / "renew" wording. Meta
		// classifies expiration nudges as MARKETING (see the categorization
		// guidelines); the first wording of this entry was re-categorized.
		Key: model.EventQuoteExpiring, MetaName: "otopoly_quote_expiring", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} işletmesinden talep ettiğiniz {{3}} numaralı teklifin durum bilgisi: teklifin geçerlilik süresi {{4}} tarihinde sona erecektir. Herhangi bir işlem yapmanız gerekmez; teklif kaydınız işletmede saklanmaktadır.",
		Params:   []string{"customer_name", "business_name", "quote_number", "valid_until"},
		Examples: []string{"Ahmet Yılmaz", "Tech Oto", "TKL-000042", "30.09.2026"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, this is a status update from {{2}} on quote number {{3}} that you requested: its validity period ends on {{4}}. No action is required; your quote record is kept on file at the business.",
			Examples: []string{"John Smith", "Tech Auto", "QTE-000042", "30.09.2026"},
		}},
	},
	{
		// Meta fixes AUTHENTICATION bodies ("<code> doğrulama kodunuzdur." /
		// "<code> is your verification code."). The template is created
		// WITHOUT Meta's security recommendation ("do not share this code"):
		// the follow-up contract.otp_notice asks the customer to share the
		// code with the business representative. Contract context, the KVKK
		// notice and the platform info follow in contract.otp_notice. The
		// platform whatsmeow number sends Text, which carries all of it in
		// one message.
		Key: model.EventContractOTP, MetaName: "otopoly_contract_otp", Category: CategoryAuthentication,
		Body:                  "{{1}} doğrulama kodunuzdur.",
		Params:                []string{"code"},
		Examples:              []string{"482913"},
		CopyCodeButton:        true,
		CodeExpirationMinutes: 5,
		Text: "*{{business_name}}* tarafından onayınıza sunulan sözleşme:\n" +
			"• Sözleşme: {{contract_title}}\n• No: {{contract_no}}\n• Plaka: {{plate}}\n\n" +
			"Onay kodunuz: *{{code}}*\n" +
			"Kod {{minutes}} dakika geçerlidir. Sözleşmeyi okuyup kabul ediyorsanız kodu yalnızca işletme yetkilisiyle paylaşınız.\n\n" +
			"_" + kvkkNotice("{{business_name}}") + "_\n\n" +
			"Bu mesaj {{business_name}} adına {{platform_name}} ({{platform_url}}) altyapısı üzerinden gönderilmiştir.",
		Translations: map[string]Translation{"en": {
			Body:     "{{1}} is your verification code.",
			Examples: []string{"482913"},
			Text: "Contract submitted for your approval by *{{business_name}}*:\n" +
				"• Contract: {{contract_title}}\n• No: {{contract_no}}\n• Plate: {{plate}}\n\n" +
				"Your approval code: *{{code}}*\n" +
				"The code is valid for {{minutes}} minutes. If you have read and accept the contract, share the code only with the business representative.\n\n" +
				"_" + kvkkNoticeEN("{{business_name}}") + "_\n\n" +
				"This message was sent on behalf of {{business_name}} via the {{platform_name}} ({{platform_url}}) infrastructure.",
		}},
	},
	{
		// Sent right after the platform Cloud OTP (UTILITY): contract context,
		// KVKK notice (data controller: the business) and the platform info.
		// The body must not mention a verification/one-time code: Meta then
		// classifies the template as AUTHENTICATION and rejects the UTILITY
		// submission with INCORRECT_CATEGORY. "Onay bilgisi" refers to the
		// code sent in the separate AUTHENTICATION message.
		Key: model.EventContractOTPNotice, MetaName: "otopoly_contract_otp_notice", Category: CategoryUtility,
		Body: "Sözleşme onay bilgilendirmesi: {{1}} tarafından onayınıza bir sözleşme sunuldu. " +
			"Sözleşme: {{2}}, No: {{3}}, Plaka: {{4}}. Sözleşmeyi okuyup kabul ediyorsanız size ayrıca iletilen onay bilgisini yalnızca işletme yetkilisiyle paylaşınız. " +
			kvkkNotice("bu işletme") + " " +
			"Bu mesaj, işletme adına {{5}} ({{6}}) altyapısı üzerinden gönderilmiştir.",
		Params:   []string{"business_name", "contract_title", "contract_no", "plate", "platform_name", "platform_url"},
		Examples: []string{"Tech Oto", "Seramik Kaplama Hizmet Sözleşmesi", "SZL-0042", "34 ABC 123", "Örnek Platform", "https://www.ornekplatform.com"},
		Translations: map[string]Translation{"en": {
			Body: "Contract approval notice: {{1}} has submitted a contract for your approval. " +
				"Contract: {{2}}, No: {{3}}, Plate: {{4}}. If you have read and accept the contract, share the approval information sent to you separately only with the business representative. " +
				kvkkNoticeEN("this business") + " " +
				"This message was sent on behalf of the business via the {{5}} ({{6}}) infrastructure.",
			Examples: []string{"Tech Auto", "Ceramic Coating Service Agreement", "CTR-0042", "34 ABC 123", "Example Platform", "https://www.exampleplatform.com"},
		}},
	},
	{
		Key: "todo.reminder", MetaName: "otopoly_todo_reminder", Category: CategoryUtility,
		Body:     "Sayın {{1}}, {{2}} görevinin son tarihi {{3}}. İşletme: {{4}}. Bu mesaj görev kaydınızla ilgili otomatik bilgilendirmedir.",
		Params:   []string{"assignee_name", "todo_title", "due_at", "business_name"},
		Examples: []string{"Ayşe Demir", "34 ABC 123 seramik kontrolü", "25.09.2026 14:30", "Tech Oto"},
		Translations: map[string]Translation{"en": {
			Body:     "Dear {{1}}, the task {{2}} is due on {{3}}. Business: {{4}}. This is an automated reminder about your task record.",
			Examples: []string{"Jane Doe", "34 ABC 123 ceramic inspection", "25.09.2026 14:30", "Tech Auto"},
		}},
	},
	{
		Key: model.EventDailySummary, MetaName: "otopoly_daily_summary", Category: CategoryUtility,
		Body:     "Gün sonu özeti, {{1}} işletmesi, {{2}}: {{3}} araca hizmet verildi, hizmet cirosu {{4}}, tahsil edilmemiş tutar {{5}}, giderler {{6}}. Ayrıntılı rapor yönetim panelinde yer alır.",
		Params:   []string{"business_name", "summary_date", "job_count", "paid_total", "unpaid_total", "expense_total"},
		Examples: []string{"Tech Oto", "07.10.2026", "12", "₺8.450,00", "₺1.200,00", "₺350,00"},
		Translations: map[string]Translation{"en": {
			Body:     "End-of-day summary for {{1}}, {{2}}: {{3}} vehicles served, service revenue {{4}}, outstanding amount {{5}}, expenses {{6}}. The detailed report is available in the management panel.",
			Examples: []string{"Tech Auto", "07.10.2026", "12", "₺8,450.00", "₺1,200.00", "₺350.00"},
		}},
	},
	{
		Key: model.EventVehicleAlert, MetaName: "otopoly_vehicle_alert", Category: CategoryUtility,
		Body:     "Araç hareketleri bildirimi, {{1}} ({{2}} kayıt): {{3}}. Bu mesaj işletme içi otomatik bilgilendirmedir.",
		Params:   []string{"business_name", "alert_count", "alert_lines"},
		Examples: []string{"Tech Oto", "1", "34 ABC 123 — Araç kabul edildi · Ahmet Yılmaz · Seramik kaplama"},
		Translations: map[string]Translation{"en": {
			Body:     "Vehicle activity notification, {{1}} ({{2}} records): {{3}}. This is an automated internal notification.",
			Examples: []string{"Tech Auto", "1", "34 ABC 123 — Vehicle checked in · John Smith · Ceramic coating"},
		}},
	},
}

// kvkkNotice is the KVKK (Law No. 6698) notice of contract OTP messages,
// adapted from the own-number OTP text; controller names the data controller.
func kvkkNotice(controller string) string {
	return "KVKK Aydınlatma: 6698 sayılı Kişisel Verilerin Korunması Kanunu uyarınca ad-soyad, telefon, araç ve imza bilgileriniz " +
		"veri sorumlusu " + controller + " tarafından sözleşmenin kurulması ve ifası ile hukuki yükümlülüklerin yerine getirilmesi amacıyla işlenir " +
		"ve yasal süre boyunca saklanır. KVKK m.11 kapsamındaki haklarınız için işletmeye başvurabilirsiniz."
}

// kvkkNoticeEN is the English rendering of kvkkNotice (the law is Turkish, so
// the law number and article stay as references).
func kvkkNoticeEN(controller string) string {
	return "Privacy notice (KVKK): under the Turkish Personal Data Protection Law No. 6698, your name, phone, vehicle and signature data " +
		"are processed by " + controller + " as data controller for the conclusion and performance of the contract and for legal obligations, " +
		"and retained for the statutory period. For your rights under Article 11 of the KVKK, please contact the business."
}

// aliases map legacy event types to their catalog entry.
var aliases = map[string]string{
	model.EventJobCompleted: model.EventJobReady,
}

var index = func() map[string]int {
	m := make(map[string]int, len(entries))
	for i, e := range entries {
		m[e.Key] = i
	}
	return m
}()

// All returns every catalog entry in the default language (Language filled).
func All() []Entry {
	out := make([]Entry, len(entries))
	for i, e := range entries {
		out[i] = e.withDefaults()
	}
	return out
}

// AllVariants returns every entry once per language in Languages order
// (entry order first): the full set of Meta templates to maintain.
func AllVariants() []Entry {
	out := make([]Entry, 0, len(entries)*len(Languages))
	for _, e := range All() {
		for _, lang := range Languages {
			if v, ok := e.Localize(lang); ok {
				out = append(out, v)
			}
		}
	}
	return out
}

// HasLanguage reports whether lang is a catalog language.
func HasLanguage(lang string) bool {
	for _, l := range Languages {
		if l == lang {
			return true
		}
	}
	return false
}

// Localize returns the entry in lang: the default entry for the default
// language, else a copy carrying that language's Body / Examples / Text.
// ok is false when the entry has no such translation.
func (e Entry) Localize(lang string) (Entry, bool) {
	e = e.withDefaults()
	lang = strings.ToLower(strings.TrimSpace(lang))
	if lang == "" || lang == e.Language {
		return e, true
	}
	tr, ok := e.Translations[lang]
	if !ok {
		return e, false
	}
	e.Language = lang
	e.Body, e.Examples, e.Text = tr.Body, tr.Examples, tr.Text
	return e, true
}

// Lookup returns the entry for an event type (aliases resolved).
func Lookup(key string) (Entry, bool) {
	if target, ok := aliases[key]; ok {
		key = target
	}
	i, ok := index[key]
	if !ok {
		return Entry{}, false
	}
	return entries[i].withDefaults(), true
}

func (e Entry) withDefaults() Entry {
	if e.Language == "" {
		e.Language = Language
	}
	return e
}

var placeholderRE = regexp.MustCompile(`\{\{(\d+)\}\}`)

// Positions returns the {{n}} numbers in order of appearance.
func Positions(body string) []int {
	var out []int
	for _, m := range placeholderRE.FindAllStringSubmatch(body, -1) {
		n, _ := strconv.Atoi(m[1])
		out = append(out, n)
	}
	return out
}

// EnrichVars adds aliases (business_name ⇄ company_name) and derived values.
func EnrichVars(vars map[string]string) map[string]string {
	out := make(map[string]string, len(vars)+3)
	for k, v := range vars {
		out[k] = v
	}
	if out["business_name"] == "" {
		out["business_name"] = out["company_name"]
	}
	if out["company_name"] == "" {
		out["company_name"] = out["business_name"]
	}
	if out[varAmountText] == "" {
		out[varAmountText] = strings.TrimSpace(strings.TrimSpace(out["amount"]) + " " + strings.TrimSpace(out["currency"]))
	}
	return out
}

var spacesRE = regexp.MustCompile(`[ \t\x{00a0}]{2,}`)

// SanitizeParam makes a value acceptable as a Meta body parameter: no line
// breaks or tabs, no long space runs, never empty, bounded length.
func SanitizeParam(v string) string {
	lines := strings.FieldsFunc(v, func(r rune) bool { return r == '\n' || r == '\r' })
	parts := make([]string, 0, len(lines))
	for _, l := range lines {
		if l = strings.TrimSpace(strings.ReplaceAll(l, "\t", " ")); l != "" {
			parts = append(parts, l)
		}
	}
	out := spacesRE.ReplaceAllString(strings.Join(parts, " | "), " ")
	if out == "" {
		return "-"
	}
	if r := []rune(out); len(r) > MaxParamRunes {
		out = string(r[:MaxParamRunes-1]) + "…"
	}
	return out
}

// ParamValues returns the sanitized positional parameters for vars.
func (e Entry) ParamValues(vars map[string]string) []string {
	v := EnrichVars(vars)
	out := make([]string, len(e.Params))
	for i, name := range e.Params {
		out[i] = SanitizeParam(v[name])
	}
	return out
}

// RenderText renders the plain-text message for the platform whatsmeow
// number (Text with named vars when set, else Body with positional params).
func (e Entry) RenderText(vars map[string]string) string {
	v := EnrichVars(vars)
	if e.Text != "" {
		// Like Cloud params: every placeholder gets a sanitized value ("-"
		// when missing, e.g. a contract without a plate).
		named := make(map[string]string)
		for _, k := range msgtemplate.Placeholders(e.Text) {
			named[k] = SanitizeParam(v[k])
		}
		return msgtemplate.Render(e.Text, named)
	}
	params := e.ParamValues(vars)
	return placeholderRE.ReplaceAllStringFunc(e.Body, func(m string) string {
		n, _ := strconv.Atoi(m[2 : len(m)-2])
		if n >= 1 && n <= len(params) {
			return params[n-1]
		}
		return m
	})
}
