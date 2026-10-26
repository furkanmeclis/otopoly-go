// Package bizclock is the business clock of Otopoly. Every business date
// ("which day did this happen", default dates, "today", day buckets, day-range
// filters, daily sweeps) is a calendar day in Europe/Istanbul, whatever zone
// the server or container runs in (production containers run in UTC, so
// time.Now().Format("2006-01-02") between 00:00 and 03:00 Türkiye time is the
// previous day). Timestamps stay instants; only their calendar day is taken
// here.
//
// Do not set time.Local globally; call this package where a day is meant.
package bizclock

import (
	"fmt"
	"strings"
	"time"
	_ "time/tzdata" // Europe/Istanbul without relying on the host zoneinfo.

	"github.com/jackc/pgx/v5/pgtype"
)

// TimeZone is the IANA name of the business time zone. The database pool
// sets the same name as the session time zone (database.NewPostgresPool).
const TimeZone = "Europe/Istanbul"

// DayLayout is the wire format of a business day (YYYY-MM-DD).
const DayLayout = "2006-01-02"

var loc = mustLoad()

func mustLoad() *time.Location {
	l, err := time.LoadLocation(TimeZone)
	if err != nil {
		// tzdata is embedded; fall back to the fixed offset Türkiye uses
		// (UTC+3, no DST since 2016) rather than failing at start-up.
		return time.FixedZone("+03", 3*60*60)
	}
	return l
}

// Location returns the business time zone.
func Location() *time.Location { return loc }

// Now is the current instant in the business time zone.
func Now() time.Time { return time.Now().In(loc) }

// In returns t in the business time zone (same instant).
func In(t time.Time) time.Time { return t.In(loc) }

// StartOfDay returns midnight (business zone) of the business day of t.
func StartOfDay(t time.Time) time.Time {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, loc)
}

// NextDay returns midnight (business zone) of the business day after t.
func NextDay(t time.Time) time.Time {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d+1, 0, 0, 0, 0, loc)
}

// DayRange returns [start, end) of the business day of t.
func DayRange(t time.Time) (time.Time, time.Time) { return StartOfDay(t), NextDay(t) }

// MonthStart returns midnight (business zone) of the first day of the
// business month of t.
func MonthStart(t time.Time) time.Time {
	y, m, _ := t.In(loc).Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, loc)
}

// DayOf returns the business day of instant t as UTC midnight, the shape
// pgx returns for DATE columns (pgtype.Date encodes the wall-clock Y/M/D of
// its time, so it must never be built from a UTC instant directly).
func DayOf(t time.Time) time.Time {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// DateOf returns the business day of instant t as a DATE value.
func DateOf(t time.Time) pgtype.Date { return pgtype.Date{Time: DayOf(t), Valid: true} }

// Today returns the current business day as a DATE value.
func Today() pgtype.Date { return DateOf(time.Now()) }

// FormatDay returns the business day of t as YYYY-MM-DD.
func FormatDay(t time.Time) string { return t.In(loc).Format(DayLayout) }

// TodayString returns the current business day as YYYY-MM-DD.
func TodayString() string { return FormatDay(time.Now()) }

// ParseDay parses a YYYY-MM-DD business day and returns its [start, end)
// instants in the business zone (end is the next midnight).
func ParseDay(raw string) (time.Time, time.Time, error) {
	start, err := time.ParseInLocation(DayLayout, strings.TrimSpace(raw), loc)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("bizclock: invalid day %q (want YYYY-MM-DD): %w", raw, err)
	}
	return start, NextDay(start), nil
}

// ParseDate parses a YYYY-MM-DD business day into a DATE value.
func ParseDate(raw string) (pgtype.Date, error) {
	t, err := time.Parse(DayLayout, strings.TrimSpace(raw))
	if err != nil {
		return pgtype.Date{}, fmt.Errorf("bizclock: invalid day %q (want YYYY-MM-DD): %w", raw, err)
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}

// FormatDate returns a DATE value as YYYY-MM-DD ("" when NULL). DATE values
// carry no zone, so no conversion happens.
func FormatDate(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format(DayLayout)
}
