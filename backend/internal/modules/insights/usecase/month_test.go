package usecase

import (
	"testing"
	"time"
)

// Months are business months (Europe/Istanbul), the same buckets SQL's
// date_trunc('month', ...) produces in the app's session time zone.
func TestMonthKeyIsIstanbulMonth(t *testing.T) {
	lateOct := time.Date(2026, 10, 31, 22, 30, 0, 0, time.UTC) // 01.11 01:30 in Türkiye
	if got := monthKey(lateOct); got != "2026-11" {
		t.Fatalf("monthKey = %s, want 2026-11", got)
	}
	// date_trunc('month') of that instant under session Europe/Istanbul.
	bucket := time.Date(2026, 10, 31, 21, 0, 0, 0, time.UTC)
	if got := monthKey(bucket); got != "2026-11" {
		t.Fatalf("bucket key = %s, want 2026-11", got)
	}
	if got := monthStart(lateOct); !got.Equal(bucket) {
		t.Fatalf("monthStart = %s, want %s", got.UTC(), bucket)
	}
	pts := fillMonths(monthStart(lateOct).AddDate(0, -1, 0), 2, map[string]MonthPoint{}, false)
	if pts[0].Month != "2026-10" || pts[1].Month != "2026-11" {
		t.Fatalf("fillMonths = %+v", pts)
	}
}
