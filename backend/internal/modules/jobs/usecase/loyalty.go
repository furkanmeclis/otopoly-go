package usecase

import (
	"context"
	"errors"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// LoyaltyHook lets the loyalty module (stamps, package credits,
// subscription uses) follow a job's lifecycle. Optional: nil skips it.
type LoyaltyHook interface {
	// JobSettled runs after a job became both delivered and paid. It earns
	// stamps once per job (idempotent) and never fails the job change.
	JobSettled(ctx context.Context, orgID, jobID int64)
	// JobReversedTx runs inside the cancel / void transaction: everything
	// loyalty covered on the job goes back (credits, uses, redeemed stamps)
	// and stamps the job earned are reversed. An error aborts the change.
	JobReversedTx(ctx context.Context, q *db.Queries, orgID, jobID, actorID int64) error
	// JobReversed runs after the cancel / void commit (live updates).
	JobReversed(ctx context.Context, orgID, jobID int64)
}

// SetLoyalty attaches the loyalty module.
func (s *Service) SetLoyalty(h LoyaltyHook) { s.loyalty = h }

func (s *Service) loyaltySettled(ctx context.Context, orgID, jobID int64) {
	if s.loyalty != nil {
		s.loyalty.JobSettled(ctx, orgID, jobID)
	}
}

func (s *Service) loyaltyReverseTx(ctx context.Context, q *db.Queries, orgID, jobID int64) error {
	if s.loyalty == nil {
		return nil
	}
	var actorID int64
	if p, ok := authctx.PrincipalFrom(ctx); ok {
		actorID = p.UserInternal
	}
	return s.loyalty.JobReversedTx(ctx, q, orgID, jobID, actorID)
}

func (s *Service) loyaltyReversed(ctx context.Context, orgID, jobID int64) {
	if s.loyalty != nil {
		s.loyalty.JobReversed(ctx, orgID, jobID)
	}
}

// coveredByLoyalty reports whether loyalty covered at least one line of a
// job whose total is zero (then it may close without a payment).
func (s *Service) coveredByLoyalty(ctx context.Context, orgID, jobID int64) (bool, error) {
	lines, err := s.q.ListServiceJobLines(ctx, db.ListServiceJobLinesParams{JobID: jobID, OrganizationID: orgID})
	if err != nil {
		return false, err
	}
	for _, l := range lines {
		if l.DiscountSource.Valid {
			return true, nil
		}
	}
	return false, nil
}

// closeCovered marks a fully covered job paid; no money moves.
func (s *Service) closeCovered(ctx context.Context, orgID int64, id uuid.UUID) (JobDetail, error) {
	paid, err := s.q.MarkServiceJobPaid(ctx, db.MarkServiceJobPaidParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobDetail{}, ErrConflict
		}
		return JobDetail{}, err
	}
	if paid.Status == "delivered" {
		s.loyaltySettled(ctx, orgID, paid.ID)
	}
	s.recordActivity(ctx, "jobs.close", "jobs.job", &paid.Uuid, map[string]any{"method": "loyalty", "amount": "0.00"})
	s.live(ctx, resourceevents.TenantJobs, resourceevents.ActionUpdated, paid.Uuid.String())
	s.publish(ctx, events.JobsClosed, map[string]any{"job_uuid": paid.Uuid.String(), "method": "loyalty"})
	s.indexJob(ctx, paid.Uuid)
	return s.Get(ctx, paid.Uuid)
}
