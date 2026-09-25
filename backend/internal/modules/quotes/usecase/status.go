package usecase

import "slices"

// Quote statuses.
const (
	StatusDraft     = "draft"
	StatusSent      = "sent"
	StatusViewed    = "viewed"
	StatusAccepted  = "accepted"
	StatusRejected  = "rejected"
	StatusExpired   = "expired"
	StatusCancelled = "cancelled"
)

// transitions is the server-side status machine. viewed and expired are
// system transitions (public link view, expiry sweep); the tenant UI may
// request the others.
//
//	draft    → sent | accepted | rejected | cancelled | expired
//	sent     → viewed | accepted | rejected | cancelled | expired
//	viewed   → accepted | rejected | cancelled | expired
//	accepted → cancelled (only while not converted to a job)
//	rejected, expired, cancelled → terminal
var transitions = map[string][]string{
	StatusDraft:     {StatusSent, StatusAccepted, StatusRejected, StatusCancelled, StatusExpired},
	StatusSent:      {StatusViewed, StatusAccepted, StatusRejected, StatusCancelled, StatusExpired},
	StatusViewed:    {StatusAccepted, StatusRejected, StatusCancelled, StatusExpired},
	StatusAccepted:  {StatusCancelled},
	StatusRejected:  {},
	StatusExpired:   {},
	StatusCancelled: {},
}

// systemOnly are statuses the tenant cannot request directly.
var systemOnly = []string{StatusViewed, StatusExpired}

// CanTransition reports whether from → to is allowed.
func CanTransition(from, to string) bool {
	return slices.Contains(transitions[from], to)
}

// IsKnownStatus reports whether s is a quote status.
func IsKnownStatus(s string) bool {
	_, ok := transitions[s]
	return ok
}

// manualTargets lists statuses the tenant UI may move to from `from`.
func manualTargets(from string, converted bool) []string {
	out := make([]string, 0, 4)
	for _, to := range transitions[from] {
		if slices.Contains(systemOnly, to) {
			continue
		}
		if from == StatusAccepted && to == StatusCancelled && converted {
			continue
		}
		out = append(out, to)
	}
	return out
}

// isTerminal: no reminders may fire for these.
func isTerminal(s string) bool {
	switch s {
	case StatusAccepted, StatusRejected, StatusExpired, StatusCancelled:
		return true
	}
	return false
}

func isEditable(s string) bool { return s == StatusDraft || s == StatusSent || s == StatusViewed }

func isSendable(s string) bool { return isEditable(s) }

func isConvertible(s string) bool {
	return s == StatusAccepted || s == StatusSent || s == StatusViewed
}
