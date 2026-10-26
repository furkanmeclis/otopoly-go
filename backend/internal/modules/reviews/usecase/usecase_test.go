package usecase

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func istanbul(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		t.Skip("no tzdata")
	}
	return loc
}

func TestQuietUntil(t *testing.T) {
	loc := istanbul(t)
	at := func(day, h, m int) time.Time { return time.Date(2026, 10, day, h, m, 0, 0, loc) }
	cases := []struct {
		name       string
		in         time.Time
		start, end int
		want       time.Time
		deferred   bool
	}{
		{"afternoon passes", at(20, 16, 0), 21, 9, at(20, 16, 0), false},
		{"evening defers to tomorrow", at(20, 22, 30), 21, 9, at(21, 9, 0), true},
		{"exactly at start defers", at(20, 21, 0), 21, 9, at(21, 9, 0), true},
		{"early morning defers to today", at(21, 6, 15), 21, 9, at(21, 9, 0), true},
		{"exactly at end passes", at(21, 9, 0), 21, 9, at(21, 9, 0), false},
		{"same-day window", at(20, 13, 30), 13, 14, at(20, 14, 0), true},
		{"window off", at(20, 23, 0), 9, 9, at(20, 23, 0), false},
	}
	for _, c := range cases {
		got, deferred := QuietUntil(c.in, loc, c.start, c.end)
		if !got.Equal(c.want) || deferred != c.deferred {
			t.Errorf("%s: got %v %v, want %v %v", c.name, got, deferred, c.want, c.deferred)
		}
	}
	// A UTC input is evaluated in Istanbul (UTC+3): 19:00Z is 22:00 local.
	got, deferred := QuietUntil(time.Date(2026, 10, 20, 19, 0, 0, 0, time.UTC), loc, 21, 9)
	if !deferred || !got.Equal(at(21, 9, 0)) {
		t.Fatalf("utc input: %v %v", got, deferred)
	}
}

func TestRender(t *testing.T) {
	vars := Vars("Ayşe Kaya", "Tech Oto", "https://x.test/r/abc")
	cases := map[string]string{
		"Merhaba {{musteri_adi}}, {{isletme_adi}}: {{link}}": "Merhaba Ayşe Kaya, Tech Oto: https://x.test/r/abc",
		"Merhaba {musteri_adi}, {isletme_adi}: {link}":       "Merhaba Ayşe Kaya, Tech Oto: https://x.test/r/abc",
		"{musteri_adi}{link}":                                "Ayşe Kayahttps://x.test/r/abc",
		"{other} {{customer_name}}":                          "{other} Ayşe Kaya",
	}
	for in, want := range cases {
		if got := Render(in, vars); got != want {
			t.Errorf("Render(%q) = %q, want %q", in, got, want)
		}
	}
	for _, ch := range []string{ChannelSMS, ChannelWhatsApp} {
		for _, loc := range []string{"tr", "en"} {
			if got := Render(DefaultBody(ch, loc), vars); !strings.Contains(got, "https://x.test/r/abc") || !strings.Contains(got, "Tech Oto") {
				t.Errorf("default %s/%s = %q", ch, loc, got)
			}
		}
	}
}

func TestValidToken(t *testing.T) {
	tok, err := newToken()
	if err != nil || !ValidToken(tok) {
		t.Fatalf("new token %q invalid: %v", tok, err)
	}
	for _, bad := range []string{"", "short", tok + "x", "AbCdEfGhIjKlMnOpQrSt!v", "AbCdEfGhIjKlMnOpQrSt v"} {
		if ValidToken(bad) {
			t.Errorf("ValidToken(%q) = true", bad)
		}
	}
	other, _ := newToken()
	if other == tok {
		t.Fatal("tokens must be random")
	}
}

func TestValidateGoogleURL(t *testing.T) {
	ok := []string{"", "https://g.page/r/abc/review", "https://search.google.com/local/writereview?placeid=ChIJ123"}
	for _, u := range ok {
		if _, err := ValidateGoogleURL(u); err != nil {
			t.Errorf("%q: %v", u, err)
		}
	}
	bad := []string{"http://g.page/r/abc", "javascript:alert(1)", "g.page/r/abc", "https://", "https://a b.com"}
	for _, u := range bad {
		if _, err := ValidateGoogleURL(u); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("%q accepted", u)
		}
	}
}

func TestPickChannel(t *testing.T) {
	cases := []struct {
		pref     string
		wa, sms  bool
		expected string
	}{
		{ChannelAuto, true, true, ChannelWhatsApp},
		{ChannelAuto, false, true, ChannelSMS},
		{ChannelAuto, false, false, ""},
		{ChannelSMS, true, false, ""},
		{ChannelSMS, false, true, ChannelSMS},
		{ChannelWhatsApp, false, true, ""},
	}
	for _, c := range cases {
		if got := pickChannel(c.pref, c.wa, c.sms); got != c.expected {
			t.Errorf("pickChannel(%s, %v, %v) = %q", c.pref, c.wa, c.sms, got)
		}
	}
}

func TestFirstName(t *testing.T) {
	if FirstName("  Ayşe  Nur Kaya ") != "Ayşe" || FirstName("") != "" {
		t.Fatal("first name")
	}
}
