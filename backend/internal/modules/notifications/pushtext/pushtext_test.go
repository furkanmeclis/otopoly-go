package pushtext

import (
	"strings"
	"testing"
)

func TestForRendersSafeVarsOnly(t *testing.T) {
	got := For("quote.team_created", "tr", map[string]string{"quote_number": "TKL-1", "total_amount": "9.999 TRY"})
	if got.Title != "Yeni teklif TKL-1" || strings.Contains(got.Body, "9.999") {
		t.Fatalf("got %+v", got)
	}
	en := For("todo.reminder", "en", map[string]string{"due_in": "in 15 minutes"})
	if en.Title != "Task reminder" || en.Body != "One of your tasks is due in 15 minutes." {
		t.Fatalf("en %+v", en)
	}
}

func TestForFallsBackWhenVarMissing(t *testing.T) {
	got := For("quote.team_created", "tr", nil)
	if strings.Contains(got.Title+got.Body, "{{") || got.Title != "Otopoly" {
		t.Fatalf("missing var leaked: %+v", got)
	}
	unknown := For("exports.ready", "en", nil)
	if unknown.Title != "Otopoly" || unknown.Body != "You have a new notification." {
		t.Fatalf("unknown kind %+v", unknown)
	}
	if !Known("billing.limit_full") || Known("nope") {
		t.Fatal("Known mismatch")
	}
}
