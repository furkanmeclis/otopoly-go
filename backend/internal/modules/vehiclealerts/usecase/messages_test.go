package usecase

import (
	"strings"
	"testing"
)

func TestAlertTextAndLine(t *testing.T) {
	j := JobInfo{Plate: "34 ABC 123", CustomerName: "Hüseyin Ülken", Services: []string{"Yıkama", "Cila", "Yıkama"}, Amount: 450}
	title, detail := AlertText(EventCreated, j)
	if title != "34 ABC 123 — Araç kabul edildi" {
		t.Fatalf("title %q", title)
	}
	if detail != "Hüseyin Ülken · Yıkama, Cila" {
		t.Fatalf("detail %q", detail)
	}
	if got := WhatsAppLine(EventCreated, j); got != "🚗 *34 ABC 123* — Araç kabul edildi · Hüseyin Ülken · Yıkama, Cila" {
		t.Fatalf("line %q", got)
	}
	_, d := AlertText(EventDelivered, JobInfo{Plate: "X", PaymentStatus: "unpaid"})
	if d != "ödeme bekliyor" {
		t.Fatalf("delivered unpaid detail %q", d)
	}
}

func TestMessageSingleAndDigest(t *testing.T) {
	one := []PendingLine{{Line: "🚗 *34 ABC 123* — Araç kabul edildi · Ali", Amount: 450, Event: EventCreated}}
	if got := Message("Tek Oto", one, true); got != "*Tek Oto* · Araç bildirimi\n🚗 *34 ABC 123* — Araç kabul edildi · Ali · ₺450,00" {
		t.Fatalf("single owner %q", got)
	}
	if got := Message("Tek Oto", one, false); strings.Contains(got, "₺") {
		t.Fatalf("staff must not see amounts: %q", got)
	}
	many := append(one,
		PendingLine{Line: "❌ *06 X 1* — İptal edildi", Amount: 300, Event: EventCancelled},
		PendingLine{Line: "✅ *35 Y 2* — Teslim edildi · ödendi", Amount: 1200, Event: EventDelivered},
	)
	got := Message("Tek Oto", many, true)
	for _, want := range []string{"*Tek Oto* · Araç hareketleri (3)", "Ali · ₺450,00", "❌ *06 X 1* — İptal edildi\n", "ödendi · ₺1.200,00"} {
		if !strings.Contains(got, want) {
			t.Errorf("digest missing %q\n%s", want, got)
		}
	}
	if strings.Contains(got, "İptal edildi · ₺") {
		t.Errorf("cancelled line should not carry an amount\n%s", got)
	}
}
