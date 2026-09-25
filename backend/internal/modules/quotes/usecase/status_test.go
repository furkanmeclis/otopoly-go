package usecase

import (
	"slices"
	"testing"
)

func TestStatusTransitions(t *testing.T) {
	allowed := [][2]string{
		{StatusDraft, StatusSent}, {StatusDraft, StatusAccepted}, {StatusDraft, StatusCancelled}, {StatusDraft, StatusExpired},
		{StatusSent, StatusViewed}, {StatusSent, StatusAccepted}, {StatusSent, StatusRejected}, {StatusSent, StatusExpired},
		{StatusViewed, StatusAccepted}, {StatusViewed, StatusRejected}, {StatusViewed, StatusCancelled},
		{StatusAccepted, StatusCancelled},
	}
	for _, p := range allowed {
		if !CanTransition(p[0], p[1]) {
			t.Errorf("%s → %s should be allowed", p[0], p[1])
		}
	}
	denied := [][2]string{
		{StatusDraft, StatusViewed}, {StatusViewed, StatusSent}, {StatusAccepted, StatusRejected},
		{StatusAccepted, StatusExpired}, {StatusRejected, StatusAccepted}, {StatusExpired, StatusSent},
		{StatusCancelled, StatusDraft}, {StatusExpired, StatusAccepted}, {"bogus", StatusSent},
	}
	for _, p := range denied {
		if CanTransition(p[0], p[1]) {
			t.Errorf("%s → %s should be denied", p[0], p[1])
		}
	}
}

func TestManualTargets(t *testing.T) {
	got := manualTargets(StatusSent, false)
	if slices.Contains(got, StatusViewed) || slices.Contains(got, StatusExpired) {
		t.Fatalf("system statuses leaked: %v", got)
	}
	if len(manualTargets(StatusAccepted, true)) != 0 {
		t.Fatal("converted accepted quote must not be cancellable")
	}
	if !slices.Equal(manualTargets(StatusAccepted, false), []string{StatusCancelled}) {
		t.Fatal("accepted → cancelled expected")
	}
	for _, s := range []string{StatusAccepted, StatusRejected, StatusExpired, StatusCancelled} {
		if !isTerminal(s) || isEditable(s) || isSendable(s) {
			t.Errorf("%s must be terminal / read-only", s)
		}
	}
	if !isConvertible(StatusViewed) || isConvertible(StatusDraft) || isConvertible(StatusRejected) {
		t.Fatal("convertible set is wrong")
	}
}
