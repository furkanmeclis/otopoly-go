package entitlements

import (
	"testing"
	"time"
)

func TestDecide(t *testing.T) {
	hard := Feature{Key: "jobs.daily", Kind: KindLimit, Enforcement: "hard", Limit: 30, TolerancePct: 10, WarnPct: 80}
	soft := hard
	soft.Enforcement = "soft"
	undefined := Feature{Key: "jobs.daily", Kind: KindLimit, Limit: -1}
	zero := Feature{Key: "jobs.daily", Kind: KindLimit, Enforcement: "hard", Limit: 0}
	cases := []struct {
		name        string
		f           Feature
		used, delta int64
		allowed     bool
		soft        bool
	}{
		{"under limit", hard, 10, 1, true, false},
		{"exactly at limit", hard, 29, 1, true, false},
		{"inside tolerance", hard, 31, 1, true, true},
		{"tolerance edge", hard, 32, 1, true, true},
		{"over tolerance hard", hard, 33, 1, false, true},
		{"over tolerance soft", soft, 40, 1, true, true},
		{"undefined is unlimited", undefined, 1_000_000, 1, true, false},
		{"zero limit hard blocks first", zero, 0, 1, false, true},
		{"negative delta always allowed", hard, 40, -1, true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := Decide(c.f, c.used, c.delta)
			if d.Allowed != c.allowed || d.Soft != c.soft {
				t.Errorf("allowed=%v soft=%v want %v/%v (%+v)", d.Allowed, d.Soft, c.allowed, c.soft, d)
			}
		})
	}
	d := Decide(hard, 10, 1)
	if d.Tolerance != 33 || d.WarnAt != 24 || d.Limit != 30 {
		t.Errorf("derived numbers: %+v", d)
	}
}

func TestDecideToggle(t *testing.T) {
	on := Feature{Key: "ai.enabled", Kind: KindToggle, Enabled: true}
	off := on
	off.Enabled = false
	if !Decide(on, 0, 1).Allowed || Decide(off, 0, 1).Allowed {
		t.Fatal("toggle must follow Enabled")
	}
}

func TestPeriodKeyIstanbul(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Istanbul")
	at := time.Date(2026, 9, 26, 23, 30, 0, 0, time.UTC).In(loc)
	if got := PeriodKeyAt(PeriodDay, at); got != "2026-09-27" {
		t.Fatalf("day key %s", got)
	}
	if got := PeriodKeyAt(PeriodMonth, at); got != "2026-09" {
		t.Fatalf("month key %s", got)
	}
	if got := PeriodKeyAt(PeriodTotal, at); got != "total" {
		t.Fatalf("total key %s", got)
	}
}
