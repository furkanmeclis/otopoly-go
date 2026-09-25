package usecase

import "testing"

func TestStaffStatusMapsDisabledToInactive(t *testing.T) {
	if got := staffStatus("disabled"); got != "inactive" {
		t.Fatalf("disabled -> %q, want inactive", got)
	}
	if got := staffStatus("active"); got != "active" {
		t.Fatalf("active -> %q", got)
	}
}
