package usecase

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestRewardsAvailable(t *testing.T) {
	none := pgtype.Int4{}
	two := pgtype.Int4{Int32: 2, Valid: true}
	cases := []struct {
		balance  int64
		required int32
		limit    pgtype.Int4
		redeemed int64
		want     int64
		limited  bool
	}{
		{9, 10, none, 0, 0, false},
		{10, 10, none, 0, 1, false},
		{25, 10, none, 3, 2, false},
		{30, 10, two, 1, 1, false},
		{30, 10, two, 2, 0, true},
		{0, 10, two, 2, 0, true},
	}
	for _, c := range cases {
		got, limited := rewardsAvailable(c.balance, c.required, c.limit, c.redeemed)
		if got != c.want || limited != c.limited {
			t.Errorf("rewardsAvailable(%d,%d,%v,%d) = %d,%v want %d,%v", c.balance, c.required, c.limit, c.redeemed, got, limited, c.want, c.limited)
		}
	}
}

func TestPackageState(t *testing.T) {
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	past := pgtype.Timestamptz{Time: now.Add(-time.Hour), Valid: true}
	future := pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true}
	if s := packageState("cancelled", future, 10, 0, now); s != "cancelled" {
		t.Errorf("cancelled = %s", s)
	}
	if s := packageState("active", past, 10, 0, now); s != "expired" {
		t.Errorf("expired = %s", s)
	}
	if s := packageState("active", future, 10, 10, now); s != "used_up" {
		t.Errorf("used up = %s", s)
	}
	if s := packageState("active", pgtype.Timestamptz{}, 10, 3, now); s != "active" {
		t.Errorf("active = %s", s)
	}
}

func TestEligible(t *testing.T) {
	svc := pgtype.Int8{Int64: 5, Valid: true}
	cat := pgtype.Int8{Int64: 9, Valid: true}
	if !eligible([]int64{5}, nil, svc, pgtype.Int8{}) {
		t.Error("service match")
	}
	if !eligible(nil, []int64{9}, svc, cat) {
		t.Error("category match")
	}
	if eligible([]int64{6}, []int64{8}, svc, cat) {
		t.Error("no match")
	}
	if eligible([]int64{5}, nil, pgtype.Int8{}, cat) {
		t.Error("a line without a service is never eligible")
	}
}
