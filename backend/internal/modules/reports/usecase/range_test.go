package usecase

import (
	"testing"
	"time"
)

// The default report range is this business month up to today: at
// 26.10 22:38Z (27.10 01:38 in Türkiye) that is 01.10 – 27.10, and the
// timestamp window of 27.10 starts at 26.10 21:00Z.
func TestParseRangeDefaultsToIstanbulDays(t *testing.T) {
	now := time.Date(2026, 10, 26, 22, 38, 0, 0, time.UTC)
	from, to, err := parseRange("", "", now)
	if err != nil {
		t.Fatal(err)
	}
	if formatDate(from) != "2026-10-01" || formatDate(to) != "2026-10-27" {
		t.Fatalf("range = %s – %s", formatDate(from), formatDate(to))
	}
	if got := dayStart(to).UTC(); !got.Equal(time.Date(2026, 10, 26, 21, 0, 0, 0, time.UTC)) {
		t.Fatalf("dayStart = %s", got)
	}
	from, to, err = parseRange("2026-10-27", "2026-10-27", now)
	if err != nil || formatDate(from) != "2026-10-27" || formatDate(to) != "2026-10-27" {
		t.Fatalf("explicit = %s – %s %v", formatDate(from), formatDate(to), err)
	}
}
