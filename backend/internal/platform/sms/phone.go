package sms

import (
	"errors"
	"strings"
)

// ErrInvalidPhone is returned for a number that cannot be normalized.
var ErrInvalidPhone = errors.New("sms: invalid phone number")

// DefaultCountryCode is used for national numbers without a country code.
const DefaultCountryCode = "90"

// Digits returns only the ASCII digits of s.
func Digits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// NormalizeE164 turns a user-entered number into E.164 ("+905321234567").
//
//	"+90 532 123 45 67", "0090 532…" → international as written
//	"0532 123 45 67", "532 123 45 67" → Turkish national (country 90)
//	"905321234567" → already with the Turkish country code
//	"+1 415 555 0100" → kept (any country)
//
// Numbers outside 8..15 digits (after the country code is added) are refused.
func NormalizeE164(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", ErrInvalidPhone
	}
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r == '+', r == ' ', r == '-', r == '(', r == ')', r == '.', r == '/':
		default:
			return "", ErrInvalidPhone
		}
	}
	plus := strings.HasPrefix(s, "+")
	d := Digits(s)
	switch {
	case plus:
		// International as written.
	case strings.HasPrefix(d, "00"):
		d = d[2:]
	case strings.HasPrefix(d, "0") && len(d) == 11:
		d = DefaultCountryCode + d[1:]
	case len(d) == 10 && strings.HasPrefix(d, "5"):
		d = DefaultCountryCode + d
	case len(d) == 12 && strings.HasPrefix(d, DefaultCountryCode):
		// Turkish number with country code, no plus.
	case strings.HasPrefix(d, "0"):
		return "", ErrInvalidPhone
	}
	if len(d) < 8 || len(d) > 15 || strings.HasPrefix(d, "0") {
		return "", ErrInvalidPhone
	}
	if strings.HasPrefix(d, DefaultCountryCode) && len(d) != 12 {
		// Turkish numbers have 10 national digits.
		return "", ErrInvalidPhone
	}
	return "+" + d, nil
}

// IsTurkish reports whether a normalized number is a Turkish one.
func IsTurkish(e164 string) bool {
	d := Digits(e164)
	return strings.HasPrefix(d, DefaultCountryCode) && len(d) == 12
}
