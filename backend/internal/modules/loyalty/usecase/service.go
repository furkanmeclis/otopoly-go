// Package usecase is the loyalty and packages module (Sadakat ve Paketler):
// stamp campaigns ("10 yıkama 1 bedava"), prepaid service packages and wash
// subscriptions, and what a job uses of them. Every read and write is scoped
// to the organization in orgctx; another organization's record is not found.
package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
	_ "time/tzdata" // Europe/Istanbul in minimal containers.

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FeatureKey is the plan toggle of the module (undefined = on).
const FeatureKey = "loyalty.enabled"

// Finance / cari source types and income categories of loyalty money.
const (
	SourcePackageSale         = "loyalty_package"
	SourceSubscriptionPayment = "loyalty_subscription"
	CategoryPackageSale       = "Paket Satışı"
	CategorySubscription      = "Abonelik Geliri"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
	ErrConflict       = errors.New("conflict")
	// ErrNotApplicable: the reward / credit / subscription does not cover
	// that job line (or nothing is left).
	ErrNotApplicable = errors.New("not applicable")
)

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidRequest, fmt.Sprintf(format, args...))
}

func conflict(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrConflict, fmt.Sprintf(format, args...))
}

func notApplicable(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrNotApplicable, fmt.Sprintf(format, args...))
}

// Reminders schedules subscription renewal reminders (notification center).
type Reminders interface {
	ScheduleRenewal(ctx context.Context, orgID int64, sub db.LoyaltySubscription)
	CancelRenewal(ctx context.Context, subID int64)
}

// Service is the loyalty use case.
type Service struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	act     *activity.Recorder
	finance *financeusecase.Service
	cari    *cariusecase.Service
	ent     *entitlements.Service
	rem     Reminders
	live    resourceevents.Publisher
	log     *slog.Logger
	loc     *time.Location
	now     func() time.Time
}

// New builds the service. finance / cari are needed to take payments; ent
// may be nil (the module counts as enabled).
func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder, finance *financeusecase.Service, cari *cariusecase.Service, ent *entitlements.Service) *Service {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Service{pool: pool, q: q, act: act, finance: finance, cari: cari, ent: ent, log: slog.Default(), loc: loc, now: time.Now}
}

// SetLogger sets the logger of fail-soft paths.
func (s *Service) SetLogger(l *slog.Logger) {
	if l != nil {
		s.log = l
	}
}

// SetReminders attaches renewal reminders (optional).
func (s *Service) SetReminders(r Reminders) { s.rem = r }

// SetResourceEvents attaches the live publisher (optional).
func (s *Service) SetResourceEvents(pub resourceevents.Publisher) { s.live = pub }

// SetClock overrides time.Now (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// Location is the business time zone.
func (s *Service) Location() *time.Location { return s.loc }

// today is the current business day (midnight in Europe/Istanbul as a UTC date).
func (s *Service) today() time.Time {
	return dayOf(s.now(), s.loc)
}

func dayOf(t time.Time, loc *time.Location) time.Time {
	l := t.In(loc)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC)
}

func orgID(ctx context.Context) (int64, error) {
	sc, ok := orgctx.ScopeFrom(ctx)
	if !ok || sc.InternalID <= 0 {
		return 0, errors.New("loyalty: organization scope missing")
	}
	return sc.InternalID, nil
}

func actorID(ctx context.Context) int64 {
	if p, ok := authctx.PrincipalFrom(ctx); ok {
		return p.UserInternal
	}
	return 0
}

// enabled reports the plan toggle for the organization.
func (s *Service) enabled(ctx context.Context, org int64) (bool, error) {
	if s.ent == nil {
		return true, nil
	}
	return s.ent.Enabled(ctx, org, FeatureKey)
}

// requireEnabled fails with entitlements.ErrFeatureDisabled when the plan
// turns the module off (AI / MCP tools; HTTP routes use RequireFeature).
func (s *Service) requireEnabled(ctx context.Context) (int64, error) {
	org, err := orgID(ctx)
	if err != nil {
		return 0, err
	}
	on, err := s.enabled(ctx, org)
	if err != nil {
		return 0, err
	}
	if !on {
		return 0, entitlements.ErrFeatureDisabled
	}
	return org, nil
}

func (s *Service) record(ctx context.Context, action, resource string, id uuid.UUID, payload map[string]any) {
	if s.act == nil {
		return
	}
	var actor *int64
	if a := actorID(ctx); a > 0 {
		actor = &a
	}
	s.act.Record(ctx, actor, action, resource, &id, payload, nil)
}

func (s *Service) emit(ctx context.Context, resource, action string, ids ...string) {
	resourceevents.Emit(ctx, s.live, resource, action, ids...)
}

// liveMoney tells finance and cari lists a payment may have touched them.
func (s *Service) liveMoney(ctx context.Context) {
	s.emit(ctx, resourceevents.TenantFinanceTransactions, resourceevents.ActionBulk)
	s.emit(ctx, resourceevents.TenantFinanceAccounts, resourceevents.ActionBulk)
	s.emit(ctx, resourceevents.TenantCari, resourceevents.ActionBulk)
	s.emit(ctx, resourceevents.TenantCariEntries, resourceevents.ActionBulk)
}

func (s *Service) liveCustomer(ctx context.Context, customer uuid.UUID) {
	if customer != uuid.Nil {
		s.emit(ctx, resourceevents.TenantLoyaltyCustomers, resourceevents.ActionUpdated, customer.String())
	}
}

// inTx runs fn in a transaction.
func (s *Service) inTx(ctx context.Context, fn func(q *db.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(s.q.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
