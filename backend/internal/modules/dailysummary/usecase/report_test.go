package usecase

import (
	"strings"
	"testing"
	"time"
)

func TestFormatTRY(t *testing.T) {
	cases := map[float64]string{
		0:         "₺0,00",
		18450:     "₺18.450,00",
		1234567.5: "₺1.234.567,50",
		-2115750:  "-₺2.115.750,00",
		99.999:    "₺100,00",
	}
	for in, want := range cases {
		if got := formatTRY(in, "TRY"); got != want {
			t.Errorf("formatTRY(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestReportMessage(t *testing.T) {
	r := Report{
		OrgName:        "Tek Oto Yıkama",
		Day:            time.Date(2026, 9, 26, 0, 0, 0, 0, time.UTC),
		Currency:       "TRY",
		JobCount:       14,
		OpenCount:      2,
		DeliveredCount: 11,
		CancelledCount: 1,
		Services:       []ServiceCount{{Name: "Yıkama", JobCount: 12}, {Name: "PPF Kaplama", JobCount: 1}},
		PaidTotal:      18450,
		CashTotal:      9200,
		CardTotal:      7050,
		CariTotal:      2200,
		UnpaidCount:    2,
		UnpaidTotal:    1300,
		ExpenseCount:   1,
		ExpenseTotal:   2500,
		Accounts:       []AccountBalance{{Name: "Nakit Kasa", Balance: 88520}},
	}
	msg := r.Message()
	for _, want := range []string{
		"*Tek Oto Yıkama — Gün Sonu Özeti*",
		"26 Eylül 2026, Cumartesi",
		"14 araca hizmet verildi",
		"• 12 × Yıkama",
		"• 1 × PPF Kaplama",
		"✅ Teslim: 11 · ⏳ Devam eden: 2 · ❌ İptal: 1",
		"*Hizmet cirosu:* ₺18.450,00",
		"• Nakit: ₺9.200,00",
		"• Cari: ₺2.200,00",
		"Tahsil edilmemiş: ₺1.300,00 (2 iş)",
		"• Gider: ₺2.500,00 (1 kayıt)",
		"• Nakit Kasa: ₺88.520,00",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("message missing %q\n---\n%s", want, msg)
		}
	}
	if strings.Contains(msg, "Stok alışı") || strings.Contains(msg, "Ürün satışı") {
		t.Errorf("empty sections should be omitted\n%s", msg)
	}
}

func TestReportMessageEmptyDay(t *testing.T) {
	msg := Report{OrgName: "X", Day: time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)}.Message()
	if !strings.Contains(msg, "Bugün araç kabul edilmedi") {
		t.Fatalf("expected empty-day line\n%s", msg)
	}
}

func TestDueAt(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, 9, 26, 20, 0, 30, 0, loc)
	if !isDue(now, 20*60, nil) {
		t.Fatal("20:00:30 should be due for a 20:00 schedule")
	}
	if isDue(now, 20*60+1, nil) {
		t.Fatal("20:00:30 is before 20:01")
	}
	sentToday := time.Date(2026, 9, 26, 0, 0, 0, 0, loc)
	if isDue(now, 20*60, &sentToday) {
		t.Fatal("already sent today")
	}
	sentYesterday := time.Date(2026, 9, 25, 0, 0, 0, 0, loc)
	if !isDue(now, 20*60, &sentYesterday) {
		t.Fatal("sent yesterday, due today")
	}
}
