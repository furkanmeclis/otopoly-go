// Package entitlements answers "may this organization do X once more?" from
// its live subscription's feature values (spec §4). It never imports the
// billing module; it reads plan values and usage counters through Store.
package entitlements

import (
	"context"
	"errors"
	"fmt"
	"time"
)

const (
	KindLimit  = "limit"
	KindToggle = "toggle"

	PeriodDay   = "day"
	PeriodMonth = "month"
	PeriodTotal = "total"
)

var (
	ErrLimitReached    = errors.New("limit reached")
	ErrFeatureDisabled = errors.New("feature disabled")
)

// Feature is the effective value of one feature for an organization.
// Limit -1 means the plan defines nothing for it (= unlimited).
type Feature struct {
	Key          string
	Kind         string
	Period       string
	Enforcement  string // hard | soft
	Limit        int64
	Enabled      bool
	TolerancePct int
	WarnPct      int
}

// Decision is the outcome for one Check.
type Decision struct {
	Allowed   bool
	Soft      bool // limit exceeded but tolerated (or soft enforcement)
	Defined   bool // false when the plan has no value for the key
	Key       string
	Limit     int64
	Used      int64
	Tolerance int64 // limit x (1 + tolerance_pct)
	WarnAt    int64 // limit x warn_pct
}

// LimitError carries the decision to the HTTP layer (409 LIMIT_REACHED).
type LimitError struct{ Decision }

func (e *LimitError) Error() string {
	return fmt.Sprintf("limit reached: %s %d/%d", e.Key, e.Used, e.Limit)
}

func (e *LimitError) Is(target error) bool { return target == ErrLimitReached }

// Usage is one feature's counter for the UI snapshot.
type Usage struct {
	Key          string
	PeriodKey    string
	Limit        int64
	Used         int64
	WarnPct      int
	TolerancePct int
	Enforcement  string
}

// Snapshot is everything the tenant UI needs to draw meters.
type Snapshot struct {
	Features []Feature
	Usage    []Usage
}

// Store is the persistence boundary (DB-backed in store.go, fakes in tests).
type Store interface {
	Features(ctx context.Context, orgID int64) ([]Feature, error)
	Usage(ctx context.Context, orgID int64, key, periodKey string) (int64, error)
	Consume(ctx context.Context, orgID int64, key, periodKey string, delta int64) (int64, error)
}

// Service evaluates decisions; a nil *Service allows everything so modules
// keep working when billing is not wired (tests, worker).
type Service struct {
	store Store
	now   func() time.Time
	loc   *time.Location
}

func New(store Store) *Service {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Service{store: store, now: time.Now, loc: loc}
}

func (s *Service) SetClock(now func() time.Time) {
	if s == nil {
		return
	}
	s.now = now
}

// Decide applies the rule table (spec §4) without touching storage.
func Decide(f Feature, used, delta int64) Decision {
	d := Decision{Key: f.Key, Used: used, Limit: f.Limit, Defined: f.Limit >= 0 || f.Kind == KindToggle}
	if f.Kind == KindToggle {
		d.Allowed = f.Enabled
		return d
	}
	if f.Limit < 0 || delta <= 0 {
		d.Allowed = true
		return d
	}
	d.Tolerance = f.Limit + f.Limit*int64(f.TolerancePct)/100
	d.WarnAt = f.Limit * int64(f.WarnPct) / 100
	next := used + delta
	switch {
	case next <= f.Limit:
		d.Allowed = true
	case next <= d.Tolerance:
		d.Allowed, d.Soft = true, true
	default:
		d.Soft = true
		d.Allowed = f.Enforcement == "soft"
	}
	return d
}

func (s *Service) feature(ctx context.Context, orgID int64, key string) (Feature, error) {
	feats, err := s.store.Features(ctx, orgID)
	if err != nil {
		return Feature{}, err
	}
	for _, f := range feats {
		if f.Key == key {
			return f, nil
		}
	}
	return Feature{Key: key, Kind: KindLimit, Limit: -1}, nil
}

// Check evaluates key for delta more units. Callers treat a returned
// *LimitError as 409 and log Decision.Soft for warnings.
func (s *Service) Check(ctx context.Context, orgID int64, key string, delta int64) (Decision, error) {
	if s == nil || s.store == nil {
		return Decision{Allowed: true, Key: key, Limit: -1}, nil
	}
	f, err := s.feature(ctx, orgID, key)
	if err != nil {
		return Decision{}, err
	}
	var used int64
	if f.Kind == KindLimit && f.Limit >= 0 {
		if used, err = s.store.Usage(ctx, orgID, key, s.periodKey(f.Period)); err != nil {
			return Decision{}, err
		}
	}
	d := Decide(f, used, delta)
	if !d.Allowed {
		if f.Kind == KindToggle {
			return d, ErrFeatureDisabled
		}
		return d, &LimitError{d}
	}
	return d, nil
}

// Consume moves the counter after the action succeeded (negative = give back).
func (s *Service) Consume(ctx context.Context, orgID int64, key string, delta int64) error {
	if s == nil || s.store == nil {
		return nil
	}
	f, err := s.feature(ctx, orgID, key)
	if err != nil {
		return err
	}
	_, err = s.store.Consume(ctx, orgID, key, s.periodKey(f.Period), delta)
	return err
}

// Enabled reports a toggle; undefined toggles are on.
func (s *Service) Enabled(ctx context.Context, orgID int64, key string) (bool, error) {
	if s == nil || s.store == nil {
		return true, nil
	}
	feats, err := s.store.Features(ctx, orgID)
	if err != nil {
		return false, err
	}
	for _, f := range feats {
		if f.Key == key && f.Kind == KindToggle {
			return f.Enabled, nil
		}
	}
	return true, nil
}

// Snapshot returns all features with current usage for the tenant UI.
func (s *Service) Snapshot(ctx context.Context, orgID int64) (Snapshot, error) {
	if s == nil || s.store == nil {
		return Snapshot{}, nil
	}
	feats, err := s.store.Features(ctx, orgID)
	if err != nil {
		return Snapshot{}, err
	}
	out := Snapshot{Features: feats}
	for _, f := range feats {
		if f.Kind != KindLimit {
			continue
		}
		pk := s.periodKey(f.Period)
		used, err := s.store.Usage(ctx, orgID, f.Key, pk)
		if err != nil {
			return Snapshot{}, err
		}
		out.Usage = append(out.Usage, Usage{Key: f.Key, PeriodKey: pk, Limit: f.Limit, Used: used,
			WarnPct: f.WarnPct, TolerancePct: f.TolerancePct, Enforcement: f.Enforcement})
	}
	return out, nil
}
