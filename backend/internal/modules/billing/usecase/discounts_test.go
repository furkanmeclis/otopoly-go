package usecase

import (
	"bytes"
	"testing"
)

func TestNewReferenceCode(t *testing.T) {
	got := newReferenceCode(bytes.NewReader([]byte{0, 1, 24, 25, 26, 27}))
	if got != "OTO-AB2345" {
		t.Fatalf("newReferenceCode() = %q, want OTO-AB2345", got)
	}
}

func TestNormalizeIBAN(t *testing.T) {
	got, err := normalizeIBAN(" tr12 3456 7890 1234 5678 9012 34 ")
	if err != nil {
		t.Fatal(err)
	}
	if got != "TR123456789012345678901234" {
		t.Fatalf("normalizeIBAN() = %q", got)
	}
	if _, err := normalizeIBAN("TR123"); err == nil {
		t.Fatal("normalizeIBAN() expected error for invalid IBAN")
	}
	if got, err := normalizeIBAN(""); err != nil || got != "" {
		t.Fatalf("empty IBAN = %q, %v", got, err)
	}
}

func TestNormalizeDiscountCode(t *testing.T) {
	got, err := normalizeDiscountCode(" yaz_10 ")
	if err != nil {
		t.Fatal(err)
	}
	if got != "YAZ_10" {
		t.Fatalf("normalizeDiscountCode() = %q", got)
	}
	for _, raw := range []string{"AB", "YAZ 10", "çıkış", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"} {
		if _, err := normalizeDiscountCode(raw); err == nil {
			t.Fatalf("normalizeDiscountCode(%q) expected error", raw)
		}
	}
}
