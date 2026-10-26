package bizclock

import (
	"testing"
	"time"
)

// 2026-10-26T22:38Z is 27.10.2026 01:38 in Türkiye: the owner's report (a
// record saved at 01:38 landed on the previous day).
var lateNight = time.Date(2026, 10, 26, 22, 38, 0, 0, time.UTC)

func TestDayOfLateNightIsIstanbulDay(t *testing.T) {
	if got := FormatDay(lateNight); got != "2026-10-27" {
		t.Fatalf("FormatDay = %s, want 2026-10-27", got)
	}
	d := DateOf(lateNight)
	if !d.Valid || d.Time.Format(DayLayout) != "2026-10-27" || d.Time.Location() != time.UTC {
		t.Fatalf("DateOf = %+v", d)
	}
	// Same result whatever zone the input carries.
	if got := FormatDay(lateNight.In(time.FixedZone("x", -7*3600))); got != "2026-10-27" {
		t.Fatalf("FormatDay(other zone) = %s", got)
	}
}

func TestParseDayRangeContainsLateNight(t *testing.T) {
	start, end, err := ParseDay("2026-10-27")
	if err != nil {
		t.Fatal(err)
	}
	if !start.Equal(time.Date(2026, 10, 26, 21, 0, 0, 0, time.UTC)) || !end.Equal(time.Date(2026, 10, 27, 21, 0, 0, 0, time.UTC)) {
		t.Fatalf("range = %s – %s", start.UTC(), end.UTC())
	}
	if lateNight.Before(start) || !lateNight.Before(end) {
		t.Fatal("27.10 range must include 26.10 22:38Z")
	}
	if _, _, err := ParseDay("27.10.2026"); err == nil {
		t.Fatal("want error for non-ISO day")
	}
}

func TestStartOfDayAndMonth(t *testing.T) {
	if got := StartOfDay(lateNight).UTC(); !got.Equal(time.Date(2026, 10, 26, 21, 0, 0, 0, time.UTC)) {
		t.Fatalf("StartOfDay = %s", got)
	}
	if got := NextDay(lateNight).UTC(); !got.Equal(time.Date(2026, 10, 27, 21, 0, 0, 0, time.UTC)) {
		t.Fatalf("NextDay = %s", got)
	}
	// 31.10 22:30Z is 01.11 in Türkiye: the business month is November.
	if got := MonthStart(time.Date(2026, 10, 31, 22, 30, 0, 0, time.UTC)); got.Format(DayLayout) != "2026-11-01" {
		t.Fatalf("MonthStart = %s", got)
	}
}

func TestParseFormatDate(t *testing.T) {
	d, err := ParseDate(" 2026-10-27 ")
	if err != nil || FormatDate(d) != "2026-10-27" {
		t.Fatalf("ParseDate = %+v %v", d, err)
	}
	if FormatDate(Today()) != TodayString() {
		t.Fatal("Today / TodayString disagree")
	}
}
