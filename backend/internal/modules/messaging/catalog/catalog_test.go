package catalog

import (
	"regexp"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
)

// sendPaths lists every event type that can reach WhatsApp today.
func sendPaths() []string {
	var out []string
	// Rule-driven Dispatch events (+ simulate, which uses the same list).
	for _, ev := range model.AllEvents() {
		out = append(out, ev.Type)
	}
	out = append(out, model.JobLifecycleEvents()...)
	out = append(out,
		model.EventJobCompleted,      // legacy alias
		model.EventContractOTP,       // SendDirect (contract signing)
		model.EventContractOTPNotice, // follows the platform Cloud OTP
		model.EventDailySummary,      // dailysummary QueueSend
		model.EventVehicleAlert,      // vehiclealerts QueueSend
	)
	// Notification-center kinds with a WhatsApp channel (quotes, todos, …).
	for _, spec := range msgtemplate.All() {
		if spec.HasChannel(msgtemplate.ChannelWhatsApp) {
			out = append(out, spec.Type)
		}
	}
	return out
}

func TestCatalogCoversEverySendPath(t *testing.T) {
	for _, key := range sendPaths() {
		if _, ok := Lookup(key); !ok {
			t.Errorf("no catalog entry for WhatsApp send path %q", key)
		}
	}
	if e, _ := Lookup(model.EventJobCompleted); e.Key != model.EventJobReady {
		t.Fatalf("job.completed must alias job.ready, got %q", e.Key)
	}
}

var metaNameRE = regexp.MustCompile(`^otopoly_[a-z0-9_]+$`)

func TestCatalogEntriesAreWellFormed(t *testing.T) {
	seenKey := map[string]bool{}
	seenName := map[string]bool{}
	for _, e := range AllVariants() {
		t.Run(e.Key+"/"+e.Language, func(t *testing.T) {
			if e.Language == Language {
				if seenKey[e.Key] || seenName[e.MetaName] {
					t.Fatalf("duplicate key or meta name")
				}
				seenKey[e.Key], seenName[e.MetaName] = true, true
			}
			if !metaNameRE.MatchString(e.MetaName) || len(e.MetaName) > 512 {
				t.Errorf("meta name %q must be lowercase snake_case with otopoly_ prefix", e.MetaName)
			}
			if e.Category != CategoryUtility && e.Category != CategoryAuthentication {
				t.Errorf("category %q not allowed (no MARKETING)", e.Category)
			}
			if !HasLanguage(e.Language) {
				t.Errorf("language = %q", e.Language)
			}
			pos := Positions(e.Body)
			if len(pos) != len(e.Params) {
				t.Fatalf("{{n}} count %d != params %d", len(pos), len(e.Params))
			}
			for i, n := range pos {
				if n != i+1 {
					t.Errorf("placeholders must be {{1}}..{{n}} in order, got %v", pos)
					break
				}
			}
			if len(e.Examples) != len(e.Params) {
				t.Fatalf("examples %d != params %d", len(e.Examples), len(e.Params))
			}
			for i, ex := range e.Examples {
				if strings.TrimSpace(ex) == "" || SanitizeParam(ex) != ex {
					t.Errorf("example %d (%q) empty or not a valid param", i, ex)
				}
			}
			body := strings.TrimSpace(e.Body)
			if strings.HasPrefix(body, "{{") && e.Category != CategoryAuthentication {
				t.Errorf("body must not start with a variable")
			}
			if regexp.MustCompile(`\{\{\d+\}\}[.!?]?$`).MatchString(body) {
				t.Errorf("body must not end with a variable")
			}
			if regexp.MustCompile(`\}\}\s*\{\{`).MatchString(body) {
				t.Errorf("adjacent variables are rejected by Meta")
			}
			if len([]rune(body)) > 1024 {
				t.Errorf("body too long")
			}
			if e.Category == CategoryUtility {
				if !contains(e.Params, "business_name") {
					t.Errorf("business name must be a parameter")
				}
				if e.CopyCodeButton {
					t.Errorf("copy-code button is for AUTHENTICATION only")
				}
			}
			if e.Category == CategoryAuthentication && (!e.CopyCodeButton || e.CodeExpirationMinutes <= 0) {
				t.Errorf("authentication entry needs copy-code button and expiry")
			}
			low := strings.ToLower(body)
			for _, w := range []string{"indirim", "kampanya", "fırsat", "kaçırmayın", "hediye", "promosyon",
				"discount", "campaign", "don't miss", "gift", "promotion"} {
				if strings.Contains(low, w) {
					t.Errorf("promotional wording %q", w)
				}
			}
			// Meta classifies any mention of a one-time / verification code as
			// AUTHENTICATION and rejects the UTILITY submission
			// (INCORRECT_CATEGORY), so UTILITY bodies never mention one.
			if e.Category == CategoryUtility {
				for _, w := range []string{"doğrulama kodu", "tek kullanımlık", "otp", "şifre", "verification code", "one-time", "passcode", "password"} {
					if strings.Contains(low, w) {
						t.Errorf("utility body mentions a code (%q): Meta rejects it as INCORRECT_CATEGORY", w)
					}
				}
			}
		})
	}
}

// TestCatalogEveryEntryHasEveryLanguage: each entry is submitted once per
// catalog language with the same parameter set, and the translation keeps
// the parameter order (Meta positional params are shared across languages).
func TestCatalogEveryEntryHasEveryLanguage(t *testing.T) {
	if strings.Join(Languages, ",") != "tr,en" {
		t.Fatalf("languages = %v", Languages)
	}
	for _, e := range All() {
		for _, lang := range Languages {
			v, ok := e.Localize(lang)
			if !ok {
				t.Errorf("%s has no %s translation", e.Key, lang)
				continue
			}
			if v.Language != lang || v.Key != e.Key || v.MetaName != e.MetaName || v.Category != e.Category ||
				v.HeaderDocument != e.HeaderDocument || v.CopyCodeButton != e.CopyCodeButton {
				t.Errorf("%s/%s: identity fields changed: %+v", e.Key, lang, v)
			}
			if lang != Language && v.Body == e.Body {
				t.Errorf("%s/%s: body not translated", e.Key, lang)
			}
			if len(Positions(v.Body)) != len(e.Params) {
				t.Errorf("%s/%s: %d placeholders for %d params", e.Key, lang, len(Positions(v.Body)), len(e.Params))
			}
		}
		if _, ok := e.Localize("de"); ok {
			t.Errorf("%s: unknown language must not localize", e.Key)
		}
		if v, ok := e.Localize(""); !ok || v.Language != Language {
			t.Errorf("%s: empty language must be the default", e.Key)
		}
	}
	if got := len(AllVariants()); got != len(All())*len(Languages) {
		t.Fatalf("variants = %d", got)
	}
	if !HasLanguage("en") || HasLanguage("de") || HasLanguage("") {
		t.Fatalf("HasLanguage")
	}
}

// TestEnglishRenderText: the platform whatsmeow number renders the English
// text (or body) for an English delivery.
func TestEnglishRenderText(t *testing.T) {
	ready, _ := Lookup(model.EventJobReady)
	en, _ := ready.Localize("en")
	got := en.RenderText(map[string]string{"customer_name": "John", "plate": "34 ABC 1", "company_name": "Tech Auto", "job_id": "J1"})
	if got != "Dear John, the work on your vehicle with plate 34 ABC 1 carried out by Tech Auto is complete and your vehicle is ready for pickup. Your job number is J1. Please contact the business to arrange delivery." {
		t.Fatalf("en text = %q", got)
	}
	otp, _ := Lookup(model.EventContractOTP)
	otpEN, _ := otp.Localize("en")
	txt := otpEN.RenderText(map[string]string{"code": "482913", "business_name": "Tech Auto", "minutes": "5",
		"contract_title": "Service Agreement", "contract_no": "CTR-1", "platform_name": "Brand", "platform_url": "https://brand.test"})
	for _, w := range []string{"*Tech Auto*", "• Contract: Service Agreement", "Your approval code: *482913*", "5 minutes",
		"Law No. 6698", "Tech Auto as data controller", "Article 11", "on behalf of Tech Auto via the Brand (https://brand.test)"} {
		if !strings.Contains(txt, w) {
			t.Errorf("en otp text lacks %q:\n%s", w, txt)
		}
	}
	if strings.Contains(txt, "{{") {
		t.Fatalf("unrendered placeholder: %s", txt)
	}
}

func TestCatalogOnlyQuoteSentHasDocumentHeader(t *testing.T) {
	for _, e := range All() {
		if e.HeaderDocument != (e.Key == model.EventQuoteSent) {
			t.Errorf("%s: HeaderDocument = %v", e.Key, e.HeaderDocument)
		}
	}
	otp, _ := Lookup(model.EventContractOTP)
	if otp.Category != CategoryAuthentication {
		t.Fatalf("contract.otp category = %s", otp.Category)
	}
}

func TestParamValuesSanitizeAndDerive(t *testing.T) {
	e, _ := Lookup(model.EventJobPaid)
	got := e.ParamValues(map[string]string{
		"customer_name": "Ali\nVeli", "amount": "1.250,00", "currency": "TRY", "company_name": "Tech   Oto",
	})
	want := []string{"Ali | Veli", "1.250,00 TRY", "Tech Oto", "-"}
	if strings.Join(got, "#") != strings.Join(want, "#") {
		t.Fatalf("got %q want %q", got, want)
	}
	long := SanitizeParam(strings.Repeat("a", MaxParamRunes+50))
	if len([]rune(long)) != MaxParamRunes {
		t.Fatalf("param not capped: %d", len([]rune(long)))
	}
}

func TestRenderText(t *testing.T) {
	e, _ := Lookup(model.EventJobReady)
	got := e.RenderText(map[string]string{"customer_name": "Ahmet", "plate": "34 ABC 1", "business_name": "Tech Oto", "job_id": "J1"})
	if strings.Contains(got, "{{") || !strings.Contains(got, "Sayın Ahmet, 34 ABC 1 plakalı") || !strings.Contains(got, "Tech Oto") {
		t.Fatalf("render: %q", got)
	}
	otp, _ := Lookup(model.EventContractOTP)
	txt := otp.RenderText(map[string]string{"code": "123456", "business_name": "Tech Oto", "minutes": "5"})
	if !strings.Contains(txt, "Tech Oto") || !strings.Contains(txt, "123456") || !strings.Contains(txt, "5 dakika") {
		t.Fatalf("otp render: %q", txt)
	}
}

func TestContractOTPNoticeEntry(t *testing.T) {
	e, ok := Lookup(model.EventContractOTPNotice)
	if !ok {
		t.Fatal("contract.otp_notice missing")
	}
	if e.MetaName != "otopoly_contract_otp_notice" || e.Category != CategoryUtility || e.CopyCodeButton || e.HeaderDocument {
		t.Fatalf("entry: %+v", e)
	}
	wantParams := []string{"business_name", "contract_title", "contract_no", "plate", "platform_name", "platform_url"}
	if strings.Join(e.Params, ",") != strings.Join(wantParams, ",") || len(Positions(e.Body)) != 6 || len(e.Examples) != 6 {
		t.Fatalf("params %v / positions %v / examples %v", e.Params, Positions(e.Body), e.Examples)
	}
	for _, w := range []string{"6698", "veri sorumlusu", "KVKK m.11", "Sözleşme: {{2}}", "No: {{3}}", "Plaka: {{4}}", "{{5}} ({{6}})",
		"onay bilgisini yalnızca işletme yetkilisiyle paylaşınız"} {
		if !strings.Contains(e.Body, w) {
			t.Errorf("notice body lacks %q", w)
		}
	}
	// Meta rejected the first wording ("doğrulama kodunuz ... iletildi") with
	// INCORRECT_CATEGORY: a UTILITY body must not talk about a code.
	for _, w := range []string{"kod", "doğrulama"} {
		if strings.Contains(strings.ToLower(e.Body), w) {
			t.Errorf("notice body mentions %q", w)
		}
	}
	en, ok := e.Localize("en")
	if !ok || strings.Contains(strings.ToLower(en.Body), "code") || !strings.Contains(en.Body, "Contract: {{2}}, No: {{3}}, Plate: {{4}}") {
		t.Errorf("en notice: %+v", en)
	}
	got := e.ParamValues(map[string]string{
		"company_name": "Tech Oto", "contract_title": "Hizmet Sözleşmesi", "contract_no": "SZL-0042",
		"platform_name": "Brand", "platform_url": "https://brand.test", "code": "123456",
	})
	if strings.Join(got, "|") != "Tech Oto|Hizmet Sözleşmesi|SZL-0042|-|Brand|https://brand.test" {
		t.Fatalf("params = %v", got)
	}
}

func TestPlatformWhatsmeowOTPTextCarriesKVKKAndPlatformInfo(t *testing.T) {
	otp, _ := Lookup(model.EventContractOTP)
	txt := otp.RenderText(map[string]string{
		"code": "482913", "business_name": "Tech Oto", "minutes": "5", "contract_title": "Hizmet Sözleşmesi",
		"contract_no": "SZL-0042", "platform_name": "Brand", "platform_url": "https://brand.test",
	})
	for _, w := range []string{
		"*Tech Oto* tarafından", "• Sözleşme: Hizmet Sözleşmesi", "• No: SZL-0042", "• Plaka: -",
		"Onay kodunuz: *482913*", "5 dakika", "6698 sayılı", "veri sorumlusu Tech Oto", "KVKK m.11",
		"Tech Oto adına Brand (https://brand.test) altyapısı",
	} {
		if !strings.Contains(txt, w) {
			t.Errorf("otp text lacks %q:\n%s", w, txt)
		}
	}
	if strings.Contains(txt, "{{") {
		t.Fatalf("unrendered placeholder: %s", txt)
	}
	// The code must be shared with the business representative, so neither
	// text may tell the customer to share it with nobody.
	for _, s := range []string{txt, otp.Body} {
		if strings.Contains(strings.ToLower(s), "kimseyle") {
			t.Errorf("otp text forbids sharing the code: %q", s)
		}
	}
	if !strings.Contains(txt, "yalnızca işletme yetkilisiyle paylaşınız") {
		t.Errorf("otp text lacks the share-with-business instruction:\n%s", txt)
	}
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
