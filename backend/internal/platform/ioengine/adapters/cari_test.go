package adapters

import (
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
)

func TestFormatMoney(t *testing.T) {
	cases := []struct {
		v    float64
		cur  string
		loc  i18n.Locale
		want string
	}{
		{2000, "TRY", i18n.LocaleTR, "2.000,00 ₺"},
		{1234567.5, "TRY", i18n.LocaleTR, "1.234.567,50 ₺"},
		{-45.678, "TRY", i18n.LocaleTR, "-45,68 ₺"},
		{0, "", i18n.LocaleTR, "0,00 ₺"},
		{1234.5, "USD", i18n.LocaleEN, "$1,234.50"},
		{99.999, "EUR", i18n.LocaleTR, "100,00 €"},
	}
	for _, c := range cases {
		if got := formatMoney(c.v, c.cur, c.loc); got != c.want {
			t.Errorf("formatMoney(%v, %q, %v) = %q, want %q", c.v, c.cur, c.loc, got, c.want)
		}
	}
}

func TestCariEntryIsDebit(t *testing.T) {
	cases := []struct {
		typ  string
		meta string
		want bool
	}{
		{"charge", "", true},
		{"opening", "", true},
		{"payment", "", false},
		{"adjustment", `{"direction":"increase"}`, true},
		{"adjustment", `{"direction":"decrease"}`, false},
		{"adjustment", `not-json`, true},
	}
	for _, c := range cases {
		if got := cariEntryIsDebit(c.typ, []byte(c.meta)); got != c.want {
			t.Errorf("cariEntryIsDebit(%q, %q) = %v, want %v", c.typ, c.meta, got, c.want)
		}
	}
}
