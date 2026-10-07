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
		model.EventJobCompleted, // legacy alias
		model.EventContractOTP,  // SendDirect (contract signing)
		model.EventDailySummary, // dailysummary QueueSend
		model.EventVehicleAlert, // vehiclealerts QueueSend
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
	for _, e := range All() {
		t.Run(e.Key, func(t *testing.T) {
			if seenKey[e.Key] || seenName[e.MetaName] {
				t.Fatalf("duplicate key or meta name")
			}
			seenKey[e.Key], seenName[e.MetaName] = true, true
			if !metaNameRE.MatchString(e.MetaName) || len(e.MetaName) > 512 {
				t.Errorf("meta name %q must be lowercase snake_case with otopoly_ prefix", e.MetaName)
			}
			if e.Category != CategoryUtility && e.Category != CategoryAuthentication {
				t.Errorf("category %q not allowed (no MARKETING)", e.Category)
			}
			if e.Language != "tr" {
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
			for _, w := range []string{"indirim", "kampanya", "fırsat", "kaçırmayın", "hediye", "promosyon"} {
				if strings.Contains(low, w) {
					t.Errorf("promotional wording %q", w)
				}
			}
		})
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

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
