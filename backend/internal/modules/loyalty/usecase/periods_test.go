package usecase

import (
	"testing"
	"time"
)

func day(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestAddMonthsClampsToMonthEnd(t *testing.T) {
	cases := []struct {
		anchor string
		n      int
		want   string
	}{
		{"2026-01-31", 1, "2026-02-28"},
		{"2028-01-31", 1, "2028-02-29"},
		{"2026-01-31", 2, "2026-03-31"},
		{"2026-01-15", 12, "2027-01-15"},
		{"2026-11-30", 3, "2027-02-28"},
	}
	for _, c := range cases {
		if got := addMonths(day(c.anchor), c.n).Format("2006-01-02"); got != c.want {
			t.Errorf("addMonths(%s, %d) = %s, want %s", c.anchor, c.n, got, c.want)
		}
	}
}

func TestPeriodIndexAndBounds(t *testing.T) {
	start := day("2026-01-31")
	cases := []struct {
		day    string
		months int
		k      int
		from   string
		to     string
	}{
		{"2026-01-31", 1, 0, "2026-01-31", "2026-02-28"},
		{"2026-02-27", 1, 0, "2026-01-31", "2026-02-28"},
		{"2026-02-28", 1, 1, "2026-02-28", "2026-03-31"},
		{"2026-03-30", 1, 1, "2026-02-28", "2026-03-31"},
		{"2026-03-31", 1, 2, "2026-03-31", "2026-04-30"},
		{"2026-07-30", 3, 1, "2026-04-30", "2026-07-31"},
		{"2026-07-31", 3, 2, "2026-07-31", "2026-10-31"},
	}
	for _, c := range cases {
		k := periodIndex(start, c.months, day(c.day))
		if k != c.k {
			t.Errorf("periodIndex(%s, %d) = %d, want %d", c.day, c.months, k, c.k)
			continue
		}
		from, to := periodBounds(start, c.months, k)
		if from.Format("2006-01-02") != c.from || to.Format("2006-01-02") != c.to {
			t.Errorf("bounds(%s) = %s..%s, want %s..%s", c.day, from.Format("2006-01-02"), to.Format("2006-01-02"), c.from, c.to)
		}
	}
	if periodIndex(start, 1, day("2026-01-30")) != -1 {
		t.Error("a day before start must give -1")
	}
}

func TestNextPeriodAndState(t *testing.T) {
	start := day("2026-10-26")
	from, to := nextPeriod(start, 1, start)
	if from != start || to != day("2026-11-26") {
		t.Fatalf("first period = %s..%s", from, to)
	}
	from, to = nextPeriod(start, 1, day("2026-11-26"))
	if from != day("2026-11-26") || to != day("2026-12-26") {
		t.Fatalf("second period = %s..%s", from, to)
	}
	today := day("2026-11-10")
	if got := subscriptionState("active", day("2026-11-26"), today); got != "active" {
		t.Errorf("paid through the future = %s", got)
	}
	if got := subscriptionState("active", today, today); got != "past_due" {
		t.Errorf("renewal today unpaid = %s", got)
	}
	if got := subscriptionState("active", start, today); got != "past_due" {
		t.Errorf("never paid = %s", got)
	}
	if got := subscriptionState("cancelled", day("2027-01-01"), today); got != "cancelled" {
		t.Errorf("cancelled = %s", got)
	}
}
