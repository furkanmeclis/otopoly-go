package entitlements

import (
	"context"
	"errors"
	"testing"
)

func TestCrossedThreshold(t *testing.T) {
	f := Feature{Key: "jobs.daily", Kind: KindLimit, Limit: 10, WarnPct: 80}
	cases := []struct {
		name       string
		f          Feature
		prev, next int64
		want       string
	}{
		{"below warn", f, 6, 7, ""},
		{"hits warn", f, 7, 8, ThresholdWarning},
		{"inside warn band", f, 8, 9, ""},
		{"hits full", f, 9, 10, ThresholdFull},
		{"jump over both reports full", f, 5, 12, ThresholdFull},
		{"already over", f, 10, 11, ""},
		{"decrease", f, 9, 7, ""},
		{"unlimited", Feature{Kind: KindLimit, Limit: -1}, 0, 100, ""},
		{"toggle", Feature{Kind: KindToggle}, 0, 1, ""},
		{"warn pct unset defaults to 80", Feature{Kind: KindLimit, Limit: 5}, 3, 4, ThresholdWarning},
		{"warn rounds up", Feature{Kind: KindLimit, Limit: 3, WarnPct: 80}, 2, 3, ThresholdFull},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := CrossedThreshold(c.f, c.prev, c.next); got != c.want {
				t.Fatalf("CrossedThreshold(%d→%d)=%q want %q", c.prev, c.next, got, c.want)
			}
		})
	}
}

type memStore struct {
	feats []Feature
	used  map[string]int64
}

func (m *memStore) Features(context.Context, int64) ([]Feature, error) { return m.feats, nil }

func (m *memStore) Usage(_ context.Context, _ int64, key, _ string) (int64, error) {
	return m.used[key], nil
}

func (m *memStore) Consume(_ context.Context, _ int64, key, _ string, delta int64) (int64, error) {
	m.used[key] = max(0, m.used[key]+delta)
	return m.used[key], nil
}

type recAlerter struct {
	alerts []Alert
	answer bool
}

func (r *recAlerter) LimitAlert(_ context.Context, a Alert) bool {
	r.alerts = append(r.alerts, a)
	return r.answer
}

func TestConsumeAndCheckReportAlerts(t *testing.T) {
	store := &memStore{
		feats: []Feature{{Key: "customers.count", Kind: KindLimit, Period: PeriodTotal, Enforcement: "hard", Limit: 5, WarnPct: 80}},
		used:  map[string]int64{"customers.count": 3},
	}
	svc := New(store)
	al := &recAlerter{answer: true}
	svc.SetAlerter(al)
	ctx := context.Background()

	if err := svc.Consume(ctx, 7, "customers.count", 1); err != nil { // 4/5 = 80%
		t.Fatal(err)
	}
	if len(al.alerts) != 1 || al.alerts[0].Threshold != ThresholdWarning || al.alerts[0].Used != 4 || al.alerts[0].OrgID != 7 {
		t.Fatalf("alerts=%+v", al.alerts)
	}
	if err := svc.Consume(ctx, 7, "customers.count", -1); err != nil { // give back: no alert
		t.Fatal(err)
	}
	if len(al.alerts) != 1 {
		t.Fatalf("negative delta must not alert: %+v", al.alerts)
	}
	store.used["customers.count"] = 5
	_, err := svc.Check(ctx, 7, "customers.count", 1)
	var le *LimitError
	if !errors.As(err, &le) {
		t.Fatalf("want LimitError, got %v", err)
	}
	if !le.OwnerNotified {
		t.Fatal("OwnerNotified should mirror the alerter answer")
	}
	last := al.alerts[len(al.alerts)-1]
	if last.Threshold != ThresholdReached || last.Used != 5 || last.Limit != 5 || last.PeriodKey != "total" {
		t.Fatalf("reached alert=%+v", last)
	}

	// Without an alerter the refusal still works and reports false.
	plain := New(store)
	_, err = plain.Check(ctx, 7, "customers.count", 1)
	if !errors.As(err, &le) || le.OwnerNotified {
		t.Fatalf("plain check err=%v", err)
	}
}
