// Package bizday holds cross-module tests for business days: every record the
// API dates on its own (job close, sale, purchase, their finance / cari
// entries) and every "today" / day filter follows Europe/Istanbul, whatever
// zone the server runs in. See internal/platform/bizclock.
package bizday
