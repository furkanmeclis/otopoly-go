package sms

import (
	"errors"
	"testing"
)

func TestNormalizeE164(t *testing.T) {
	cases := map[string]string{
		"+90 532 123 45 67": "+905321234567",
		"0532 123 45 67":    "+905321234567",
		"(0532) 123-45-67":  "+905321234567",
		"5321234567":        "+905321234567",
		"905321234567":      "+905321234567",
		"0090 532 1234567":  "+905321234567",
		"+1 415 555 0100":   "+14155550100",
		"+44 20 7946 0958":  "+442079460958",
	}
	for in, want := range cases {
		got, err := NormalizeE164(in)
		if err != nil || got != want {
			t.Errorf("NormalizeE164(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "abc", "123", "05321", "+90 532 12", "+0123456789", "0532 123 45 67 89", "+1234567890123456"} {
		if got, err := NormalizeE164(bad); !errors.Is(err, ErrInvalidPhone) {
			t.Errorf("NormalizeE164(%q) = %q, %v; want ErrInvalidPhone", bad, got, err)
		}
	}
	if !IsTurkish("+905321234567") || IsTurkish("+14155550100") {
		t.Fatal("IsTurkish")
	}
}

func TestEstimate(t *testing.T) {
	ascii := Estimate("Hello world", ProviderTwilio)
	if ascii.Encoding != EncodingGSM7 || ascii.Characters != 11 || ascii.Segments != 1 || ascii.Remaining != 149 {
		t.Fatalf("ascii: %+v", ascii)
	}
	ext := Estimate("a{b}€", ProviderTwilio)
	if ext.Encoding != EncodingGSM7 || ext.Characters != 8 {
		t.Fatalf("extended: %+v", ext)
	}
	tr := "Aracınız hazır, teşekkürler"
	if got := Estimate(tr, ProviderNetgsm); got.Encoding != EncodingTurkish || got.Characters != len([]rune(tr)) || got.Segments != 1 {
		t.Fatalf("netgsm turkish: %+v", got)
	}
	if got := Estimate(tr, ProviderTwilio); got.Encoding != EncodingUCS2 || got.PerSegment != 70 {
		t.Fatalf("twilio turkish: %+v", got)
	}
	long := make([]rune, 161)
	for i := range long {
		long[i] = 'a'
	}
	if got := Estimate(string(long), ProviderTwilio); got.Segments != 2 || got.PerSegment != 153 || got.Remaining != 145 {
		t.Fatalf("long: %+v", got)
	}
	trLong := make([]rune, 156)
	for i := range trLong {
		trLong[i] = 'ş'
	}
	if got := Estimate(string(trLong), ProviderNetgsm); got.Segments != 2 || got.PerSegment != 150 {
		t.Fatalf("netgsm long: %+v", got)
	}
	if got := Estimate("Hi 😀", ProviderNetgsm); got.Encoding != EncodingUCS2 || got.Characters != 5 {
		t.Fatalf("emoji: %+v", got)
	}
	if got := Estimate("", ProviderNetgsm); got.Segments != 0 {
		t.Fatalf("empty: %+v", got)
	}
}

func TestHintsAndMask(t *testing.T) {
	if got := Hint("supersecrettoken", true); got != "••••••en" {
		t.Fatalf("secret hint %q", got)
	}
	if got := Hint("abc", true); got != "••••••" {
		t.Fatalf("short secret hint %q", got)
	}
	if got := Hint("ACabcdef123456", false); got != "AC••••56" {
		t.Fatalf("plain hint %q", got)
	}
	if got := MaskPhone("+905321234567"); got != "+90532•••4567" {
		t.Fatalf("mask %q", got)
	}
}
