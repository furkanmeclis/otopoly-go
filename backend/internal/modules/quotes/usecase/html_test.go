package usecase

import (
	"strings"
	"testing"
	"time"
)

func TestBuildQuoteHTMLEscapesAndFormats(t *testing.T) {
	valid := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	out := buildQuoteHTML(pdfDoc{
		Number: "TKL-2026-0007", Status: StatusSent, IssuedAt: time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC),
		ValidUntil: &valid, OrgName: `Tech <Oto>`, PrimaryColor: `red;}</style><script>`,
		LogoDataURI:  `javascript:alert(1)`,
		CustomerName: `<script>alert("x")</script>`, VehiclePlate: "34ABC123", VehicleLabel: "BMW 3 Serisi 2020",
		Currency: "TRY", PricesIncludeVAT: true,
		Lines: []pdfLine{{Description: `Seramik & "Kaplama"`, Quantity: "2.000", Unit: "adet", UnitPrice: "1500", Discount: "150", VATRate: "20.00", Total: "2850"}},
		Subtotal: "3000", DiscountTotal: "150", VATTotal: "475", GrandTotal: "2850",
		Notes: "Satır 1\n<b>Satır 2</b>", ShareURL: "https://app.test/q/tok",
	})
	for _, bad := range []string{"<script>", "javascript:", `red;}</style>`, "<b>Satır 2</b>"} {
		if strings.Contains(out, bad) {
			t.Errorf("unescaped %q in output", bad)
		}
	}
	for _, want := range []string{
		"TKL-2026-0007", "Tech &lt;Oto&gt;", "&lt;script&gt;", "Seramik &amp; &#34;Kaplama&#34;",
		"2 adet", "1.500,00 ₺", "2.850,00 ₺", "KDV (dahil)", "%20", "01.10.2026", "Satır 1<br>&lt;b&gt;",
		"#EA6E43", "https://app.test/q/tok",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestFormatMoneyTR(t *testing.T) {
	cases := map[string]string{"0": "0,00 ₺", "1234567.891": "1.234.567,89 ₺", "999.995": "1.000,00 ₺", "-12.5": "-12,50 ₺"}
	for in, want := range cases {
		if got := formatMoneyTR(in, "TRY"); got != want {
			t.Errorf("formatMoneyTR(%s)=%s want %s", in, got, want)
		}
	}
	if got := formatMoneyTR("5", "CHF"); got != "5,00 CHF" {
		t.Errorf("CHF: %s", got)
	}
}

func TestShareTokenAndNumber(t *testing.T) {
	seen := map[string]bool{}
	for range 100 {
		tok, err := newShareToken()
		if err != nil {
			t.Fatal(err)
		}
		if !ValidShareToken(tok) || seen[tok] {
			t.Fatalf("bad or duplicate token %q", tok)
		}
		seen[tok] = true
	}
	for _, bad := range []string{"", "short", strings.Repeat("a", 42) + "!", "00000000-0000-0000-0000-000000000000"} {
		if ValidShareToken(bad) {
			t.Errorf("%q must be rejected", bad)
		}
	}
	if FormatNumber(2026, 1) != "TKL-2026-0001" || FormatNumber(2026, 12345) != "TKL-2026-12345" {
		t.Fatal("number format")
	}
}
