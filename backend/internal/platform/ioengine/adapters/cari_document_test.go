package adapters

import (
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine"
)

func TestCariStatementHTML(t *testing.T) {
	st := &cariStatement{
		CustomerName: "Kem <Grup>", CustomerPhone: "0532", Currency: "TRY",
		Balance: 14000, TotalDebit: 60000, TotalCredit: 46000,
		Entries: []cariStatementEntry{
			{At: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), Date: "01.09.2026", Type: "charge", Description: "İş emri", Amount: 60000, Debit: true, Balance: 60000},
			{At: time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC), Date: "27.09.2026", Type: "payment", Description: "Nakit", Amount: 46000, Balance: 14000},
			{Date: "27.09.2026", Type: "payment", Amount: 500, Balance: 13500, Void: true},
		},
	}
	lh := &ioengine.Letterhead{CompanyName: "Tek Oto", PrimaryColor: "red;}</style>"}
	out := buildCariStatementHTML(st, i18n.LocaleTR, lh, "Cari hesap ekstresi", time.Date(2026, 9, 27, 7, 0, 0, 0, time.UTC))
	for _, want := range []string{
		"Kem &lt;Grup&gt;", "60.000,00 ₺", "46.000,00 ₺", "14.000,00 ₺",
		"Müşterinin borcu", `class="void"`, "01.09.2026 – 27.09.2026", "27.09.2026 10:00",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(out, "red;}</style>") {
		t.Error("letterhead colour must be sanitised")
	}
}
