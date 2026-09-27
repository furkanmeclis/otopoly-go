package entitlements

import "time"

// periodKey is the counter bucket for a period, in Europe/Istanbul.
func (s *Service) periodKey(period string) string {
	return PeriodKeyAt(period, s.now().In(s.loc))
}

// PeriodKeyAt is exported for the recompute job and tests.
func PeriodKeyAt(period string, t time.Time) string {
	switch period {
	case PeriodDay:
		return t.Format("2006-01-02")
	case PeriodMonth:
		return t.Format("2006-01")
	default:
		return "total"
	}
}
