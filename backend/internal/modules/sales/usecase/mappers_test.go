package usecase

import (
	"testing"
	"time"
)

// Day boundaries follow the given location, not the server's time zone:
// 24.09.2026 in Istanbul is [23.09 21:00Z, 24.09 21:00Z).
func TestParseDayInLocation(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		t.Fatal(err)
	}
	day, err := parseDay("2026-09-24", loc, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2026, 9, 23, 21, 0, 0, 0, time.UTC); !day.Equal(want) {
		t.Fatalf("start = %s, want %s", day.UTC(), want)
	}
	if want := time.Date(2026, 9, 24, 21, 0, 0, 0, time.UTC); !nextDay(day).Equal(want) {
		t.Fatalf("end = %s, want %s", nextDay(day).UTC(), want)
	}
	if _, err := parseDay("24.09.2026", loc, time.Now()); err == nil {
		t.Fatal("invalid date must fail")
	}
	// DST-aware next day (Europe/Berlin springs forward on 29.03.2026).
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Fatal(err)
	}
	d, _ := parseDay("2026-03-29", berlin, time.Now())
	if got := nextDay(d); got.Sub(d) != 23*time.Hour {
		t.Fatalf("DST day length = %s", got.Sub(d))
	}
	// nil location is the business time zone (Europe/Istanbul), whatever
	// zone the server runs in.
	local, _ := parseDay("2026-09-24", nil, time.Now())
	if want := time.Date(2026, 9, 23, 21, 0, 0, 0, time.UTC); !local.Equal(want) {
		t.Fatalf("nil loc start = %s, want %s", local.UTC(), want)
	}
	// Empty day = the business day of now: 26.10 22:38Z is 27.10 in Türkiye.
	today, _ := parseDay("", nil, time.Date(2026, 10, 26, 22, 38, 0, 0, time.UTC))
	if want := time.Date(2026, 10, 26, 21, 0, 0, 0, time.UTC); !today.Equal(want) {
		t.Fatalf("today start = %s, want %s", today.UTC(), want)
	}
}
