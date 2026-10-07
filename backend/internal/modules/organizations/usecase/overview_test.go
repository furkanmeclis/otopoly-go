package usecase_test

import (
	"testing"
	"time"

	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
)

func TestExtendedAccessEnd(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	if got := orgusecase.ExtendedAccessEnd(now.Add(-48*time.Hour), now, 30); !got.Equal(now.AddDate(0, 0, 30)) {
		t.Fatalf("past end: %v", got)
	}
	future := now.Add(72 * time.Hour)
	if got := orgusecase.ExtendedAccessEnd(future, now, 30); !got.Equal(future.AddDate(0, 0, 30)) {
		t.Fatalf("future end: %v", got)
	}
}

func TestPatchTouchesAccess(t *testing.T) {
	end := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	plan := "pro"
	current := orgusecase.Organization{Status: "active", PlanCode: &plan, AccessStartsAt: end.AddDate(0, -1, 0), AccessEndsAt: &end}
	str := func(s string) *string { return &s }
	other := end.Add(time.Hour)
	same := end
	cases := []struct {
		name string
		in   orgusecase.PatchInput
		want bool
	}{
		{"profile only", orgusecase.PatchInput{Name: str("x"), City: str("y")}, false},
		{"same status", orgusecase.PatchInput{Status: str("active")}, false},
		{"status change", orgusecase.PatchInput{Status: str("suspended")}, true},
		{"plan change", orgusecase.PatchInput{PlanCode: str("trial")}, true},
		{"same access end", orgusecase.PatchInput{AccessEndsAt: &same}, false},
		{"access end change", orgusecase.PatchInput{AccessEndsAt: &other}, true},
		{"clear access end", orgusecase.PatchInput{ClearAccessEnd: true}, true},
	}
	for _, tc := range cases {
		if got := orgusecase.PatchTouchesAccess(current, tc.in); got != tc.want {
			t.Fatalf("%s: got %v", tc.name, got)
		}
	}
	unlimited := current
	unlimited.AccessEndsAt = nil
	if orgusecase.PatchTouchesAccess(unlimited, orgusecase.PatchInput{ClearAccessEnd: true}) {
		t.Fatal("clearing an already unlimited end is not a change")
	}
}
