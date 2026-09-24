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
	day, err := parseDay("2026-09-24", loc)
	if err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2026, 9, 23, 21, 0, 0, 0, time.UTC); !day.Equal(want) {
		t.Fatalf("start = %s, want %s", day.UTC(), want)
	}
	if want := time.Date(2026, 9, 24, 21, 0, 0, 0, time.UTC); !nextDay(day).Equal(want) {
		t.Fatalf("end = %s, want %s", nextDay(day).UTC(), want)
	}
	if _, err := parseDay("24.09.2026", loc); err == nil {
		t.Fatal("invalid date must fail")
	}
	// DST-aware next day (Europe/Berlin springs forward on 29.03.2026).
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Fatal(err)
	}
	d, _ := parseDay("2026-03-29", berlin)
	if got := nextDay(d); got.Sub(d) != 23*time.Hour {
		t.Fatalf("DST day length = %s", got.Sub(d))
	}
	// nil location keeps the server-local default used by the HTTP API.
	local, _ := parseDay("2026-09-24", nil)
	if local.Location() != time.Local {
		t.Fatalf("nil loc = %v", local.Location())
	}
}
