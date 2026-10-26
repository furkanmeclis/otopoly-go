package usecase

import "time"

// addMonths adds n months to an anchor day, clamped to the last day of the
// target month (Jan 31 + 1 month = Feb 28/29).
func addMonths(anchor time.Time, n int) time.Time {
	y, m, d := anchor.Date()
	first := time.Date(y, m+time.Month(n), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1).Day()
	if d > last {
		d = last
	}
	return time.Date(first.Year(), first.Month(), d, 0, 0, 0, 0, time.UTC)
}

// periodIndex returns the index k of the period containing day:
// [start + k*months, start + (k+1)*months). Days before start give -1.
func periodIndex(start time.Time, months int, day time.Time) int {
	if day.Before(start) || months <= 0 {
		return -1
	}
	k := ((day.Year()-start.Year())*12 + int(day.Month()) - int(start.Month())) / months
	for k > 0 && addMonths(start, k*months).After(day) {
		k--
	}
	for !addMonths(start, (k+1)*months).After(day) {
		k++
	}
	return k
}

// periodBounds returns [start, end) of period k.
func periodBounds(start time.Time, months, k int) (time.Time, time.Time) {
	return addMonths(start, k*months), addMonths(start, (k+1)*months)
}

// nextPeriod returns the period that begins at paidThrough (the next one to
// pay). paidThrough is always a period boundary.
func nextPeriod(start time.Time, months int, paidThrough time.Time) (time.Time, time.Time) {
	k := periodIndex(start, months, paidThrough)
	if k < 0 {
		k = 0
	}
	return periodBounds(start, months, k)
}

// subscriptionState is active (today is paid), past_due (active but the
// current period is unpaid) or cancelled.
func subscriptionState(status string, paidThrough, today time.Time) string {
	if status == "cancelled" {
		return "cancelled"
	}
	if !paidThrough.After(today) {
		return "past_due"
	}
	return "active"
}
