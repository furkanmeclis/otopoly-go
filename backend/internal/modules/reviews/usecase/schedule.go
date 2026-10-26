package usecase

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// QuietUntil returns when a send planned at t may go out: t itself outside
// the quiet window [start, end) (Europe/Istanbul hours), else the next end
// hour. start == end disables the window; start > end spans midnight.
func QuietUntil(t time.Time, loc *time.Location, start, end int) (time.Time, bool) {
	if start == end {
		return t, false
	}
	lt := t.In(loc)
	h := lt.Hour()
	day := func(offset int) time.Time {
		return time.Date(lt.Year(), lt.Month(), lt.Day()+offset, end, 0, 0, 0, loc)
	}
	if start > end { // e.g. 21 → 09
		switch {
		case h >= start:
			return day(1), true
		case h < end:
			return day(0), true
		}
		return t, false
	}
	if h >= start && h < end { // e.g. 13 → 14
		return day(0), true
	}
	return t, false
}

func (s *Service) sendTime(st db.ReviewSetting, planned time.Time) (time.Time, bool) {
	if !st.QuietHoursEnabled {
		return planned, false
	}
	return QuietUntil(planned, s.loc, int(st.QuietStartHour), int(st.QuietEndHour))
}

// HandleJobDelivered schedules the review request of a delivered job. It is
// idempotent: one request per job, later events insert nothing.
func (s *Service) HandleJobDelivered(ctx context.Context, jobUUID uuid.UUID) error {
	job, err := s.q.GetReviewJob(ctx, jobUUID)
	if isNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if sc, ok := orgctx.ScopeFrom(ctx); ok && sc.InternalID > 0 && sc.InternalID != job.OrganizationID {
		return nil
	}
	st, err := s.loadSettings(ctx, job.OrganizationID)
	if err != nil || !st.Enabled {
		return err
	}
	if s.ent != nil {
		if on, err := s.ent.Enabled(ctx, job.OrganizationID, FeatureEnabled); err != nil || !on {
			return err
		}
	}
	base := s.now()
	if job.DeliveredAt.Valid {
		base = job.DeliveredAt.Time
	}
	sendAt, deferred := s.sendTime(st, base.Add(time.Duration(st.DelayMinutes)*time.Minute))
	token, err := newToken()
	if err != nil {
		return err
	}
	row, err := s.q.CreateReviewRequest(ctx, db.CreateReviewRequestParams{
		OrganizationID: job.OrganizationID, Kind: kindJob,
		JobID:          pgtype.Int8{Int64: job.ID, Valid: true},
		CustomerID:     pgtype.Int8{Int64: job.CustomerID, Valid: job.CustomerID > 0},
		CustomerName:   truncate(strings.TrimSpace(job.CustomerName), 150),
		RecipientPhone: truncate(strings.TrimSpace(job.CustomerPhone), 32),
		Plate:          job.Plate, Token: token, Status: StatusScheduled, Locale: st.DefaultLocale,
		SendAt: ts(sendAt), Deferred: deferred,
	})
	if isNoRows(err) {
		return nil // already scheduled for this job
	}
	if err != nil {
		return err
	}
	s.live(orgctx.WithScope(ctx, orgctx.Scope{InternalID: job.OrganizationID}), resourceevents.ActionCreated, row.Uuid)
	return nil
}

// HandleJobCancelled cancels a job's request that was not sent yet.
func (s *Service) HandleJobCancelled(ctx context.Context, jobUUID uuid.UUID) error {
	job, err := s.q.GetReviewJob(ctx, jobUUID)
	if isNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	ids, err := s.q.CancelScheduledReviewRequestsForJob(ctx, db.CancelScheduledReviewRequestsForJobParams{
		Reason: ReasonJobCancelled, OrganizationID: job.OrganizationID, JobID: pgtype.Int8{Int64: job.ID, Valid: true},
	})
	if err != nil || len(ids) == 0 {
		return err
	}
	s.live(orgctx.WithScope(ctx, orgctx.Scope{InternalID: job.OrganizationID}), resourceevents.ActionUpdated, ids...)
	return nil
}

// ProcessDue is the minute sweep: expires old links and sends due requests.
// Returns how many requests were sent.
func (s *Service) ProcessDue(ctx context.Context) (int, error) {
	now := s.now()
	expired, err := s.q.ExpireReviewRequests(ctx, ts(now))
	if err != nil {
		return 0, err
	}
	for _, e := range expired {
		s.live(orgctx.WithScope(ctx, orgctx.Scope{InternalID: e.OrganizationID}), resourceevents.ActionUpdated, e.Uuid)
	}
	claimed, err := s.q.ClaimDueReviewRequests(ctx, db.ClaimDueReviewRequestsParams{Now: ts(now), LimitCount: sweepBatch})
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, r := range claimed {
		octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: r.OrganizationID})
		out, err := s.processClaimed(octx, r, now)
		if err != nil {
			s.log.Error("review_request_process_failed", "org_id", r.OrganizationID, "review", r.Uuid, "error", err)
			// Do not leave it stuck in "sending".
			out, _ = s.finish(octx, r, StatusFailed, ReasonSendFailed, err.Error(), "")
		}
		if out.Status == StatusSent {
			sent++
		}
		s.live(octx, resourceevents.ActionUpdated, r.Uuid)
	}
	return sent, nil
}

func (s *Service) finish(ctx context.Context, r db.ReviewRequest, status, reason, msg, channel string) (db.ReviewRequest, error) {
	return s.q.FinishReviewRequest(ctx, db.FinishReviewRequestParams{
		Status: status, SkipReason: reason, Error: truncate(msg, 1000), Channel: channel,
		ID: r.ID, OrganizationID: r.OrganizationID,
	})
}

// processClaimed applies every rule to a claimed job request, then sends it.
func (s *Service) processClaimed(ctx context.Context, r db.ReviewRequest, now time.Time) (db.ReviewRequest, error) {
	st, err := s.loadSettings(ctx, r.OrganizationID)
	if err != nil {
		return r, err
	}
	if r.Kind == kindJob {
		if !st.Enabled {
			return s.finish(ctx, r, StatusCancelled, ReasonDisabled, "", "")
		}
		if r.JobID.Valid {
			status, err := s.q.GetReviewJobStatus(ctx, db.GetReviewJobStatusParams{ID: r.JobID.Int64, OrganizationID: r.OrganizationID})
			if err != nil && !isNoRows(err) {
				return r, err
			}
			if isNoRows(err) || status == "cancelled" || status == "voided" {
				return s.finish(ctx, r, StatusCancelled, ReasonJobCancelled, "", "")
			}
		}
		// Quiet hours: a late sweep or a changed window defers to the morning.
		if at, deferred := s.sendTime(st, now); deferred {
			if err := s.q.RescheduleReviewRequest(ctx, db.RescheduleReviewRequestParams{
				SendAt: ts(at), Deferred: true, ID: r.ID, OrganizationID: r.OrganizationID,
			}); err != nil {
				return r, err
			}
			r.Status, r.SendAt, r.Deferred = StatusScheduled, ts(at), true
			return r, nil
		}
		if s.ent != nil {
			on, err := s.ent.Enabled(ctx, r.OrganizationID, FeatureEnabled)
			if err != nil {
				return r, err
			}
			if !on {
				return s.finish(ctx, r, StatusSkipped, ReasonPlanDisabled, "", "")
			}
		}
		if r.CustomerID.Valid && slices.Contains(st.ExcludedCustomerIds, r.CustomerID.Int64) {
			return s.finish(ctx, r, StatusSkipped, ReasonExcluded, "", "")
		}
		if strings.TrimSpace(r.RecipientPhone) == "" {
			return s.finish(ctx, r, StatusSkipped, ReasonNoPhone, "", "")
		}
		if st.MinDaysBetween > 0 {
			n, err := s.q.CountRecentReviewRequests(ctx, db.CountRecentReviewRequestsParams{
				OrganizationID: r.OrganizationID, ExcludeID: r.ID,
				Since:      ts(now.Add(-time.Duration(st.MinDaysBetween) * 24 * time.Hour)),
				CustomerID: r.CustomerID, Phone: r.RecipientPhone,
			})
			if err != nil {
				return r, err
			}
			if n > 0 {
				return s.finish(ctx, r, StatusSkipped, ReasonFrequencyCap, "", "")
			}
		}
		if s.ent != nil {
			if _, err := s.ent.Check(ctx, r.OrganizationID, FeatureMonthly, 1); err != nil {
				if errors.Is(err, entitlements.ErrLimitReached) {
					return s.finish(ctx, r, StatusSkipped, ReasonMonthlyLimit, err.Error(), "")
				}
				return r, err
			}
		}
	}
	return s.deliver(ctx, r, st, now)
}

// deliver resolves the channel and template and queues the message.
func (s *Service) deliver(ctx context.Context, r db.ReviewRequest, st db.ReviewSetting, now time.Time) (db.ReviewRequest, error) {
	channel := s.resolveChannel(ctx, r.OrganizationID, st.Channel)
	if channel == "" {
		return s.finish(ctx, r, StatusFailed, ReasonChannelUnavailable, ErrChannelUnavailable.Error(), "")
	}
	tpl := s.template(ctx, r.OrganizationID, channel, r.Locale)
	if !tpl.Active {
		return s.finish(ctx, r, StatusSkipped, ReasonTemplateInactive, "", channel)
	}
	org, err := s.q.GetReviewOrganization(ctx, r.OrganizationID)
	if err != nil {
		return r, err
	}
	vars := Vars(strings.TrimSpace(r.CustomerName), org.Name, s.PublicURL(r.Token))
	outID, err := s.msg.Queue(ctx, OutboundMessage{
		OrgID: r.OrganizationID, Channel: channel, Phone: r.RecipientPhone,
		Body: Render(tpl.Body, vars), SubjectUUID: r.Uuid, Vars: vars,
	})
	if err != nil {
		var le *entitlements.LimitError
		switch {
		case errors.Is(err, entitlements.ErrFeatureDisabled):
			return s.finish(ctx, r, StatusSkipped, ReasonChannelPlan, err.Error(), channel)
		case errors.As(err, &le):
			return s.finish(ctx, r, StatusSkipped, ReasonChannelQuota, err.Error(), channel)
		default:
			return s.finish(ctx, r, StatusFailed, ReasonSendFailed, err.Error(), channel)
		}
	}
	out, err := s.q.MarkReviewRequestSent(ctx, db.MarkReviewRequestSentParams{
		Channel: channel, ExpiresAt: ts(now.Add(linkValidity)),
		OutboundMessageUuid: pgtype.UUID{Bytes: outID, Valid: outID != uuid.Nil},
		ID:                  r.ID, OrganizationID: r.OrganizationID,
	})
	if err != nil {
		return r, err
	}
	if r.Kind == kindJob && s.ent != nil {
		if err := s.ent.Consume(ctx, r.OrganizationID, FeatureMonthly, 1); err != nil {
			s.log.Warn("review_quota_consume_failed", "org_id", r.OrganizationID, "error", err)
		}
	}
	return out, nil
}

// OutboundFailed records a queued message that failed for good (messaging
// observer; subject = review request uuid).
func (s *Service) OutboundFailed(ctx context.Context, orgID int64, subject uuid.UUID, reason string) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "delivery failed"
	}
	row, err := s.q.FailReviewRequestByOutbound(ctx, db.FailReviewRequestByOutboundParams{
		Error: truncate(reason, 1000), OrganizationID: orgID, Uuid: subject,
	})
	if err != nil {
		if !isNoRows(err) {
			s.log.Warn("review_outbound_fail_update_failed", "review", subject, "error", err)
		}
		return
	}
	s.live(orgctx.WithScope(ctx, orgctx.Scope{InternalID: orgID}), resourceevents.ActionUpdated, row.Uuid)
}

// SendTest sends a test request to the member's own phone right away
// (ignores quiet hours, frequency cap and the monthly review limit; the
// channel's own plan gates still apply).
func (s *Service) SendTest(ctx context.Context, in TestInput) (TestResult, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return TestResult{}, err
	}
	if err := s.requireFeature(ctx, scope.InternalID); err != nil {
		return TestResult{}, err
	}
	actor := actorID(ctx)
	phone := strings.TrimSpace(in.Phone)
	if phone == "" && actor != nil {
		if p, err := s.q.GetReviewMemberPhone(ctx, db.GetReviewMemberPhoneParams{OrganizationID: scope.InternalID, UserID: *actor}); err == nil {
			phone = strings.TrimSpace(p)
		}
	}
	if phone == "" {
		return TestResult{}, fmt.Errorf("%w: phone is required (save a notification phone in your profile or enter one)", ErrInvalidRequest)
	}
	if len(phone) > 32 || digits(phone) < 7 {
		return TestResult{}, fmt.Errorf("%w: phone is invalid", ErrInvalidRequest)
	}
	st, err := s.loadSettings(ctx, scope.InternalID)
	if err != nil {
		return TestResult{}, err
	}
	if s.resolveChannel(ctx, scope.InternalID, st.Channel) == "" {
		return TestResult{}, ErrChannelUnavailable
	}
	token, err := newToken()
	if err != nil {
		return TestResult{}, err
	}
	var createdBy pgtype.Int8
	if actor != nil {
		createdBy = pgtype.Int8{Int64: *actor, Valid: true}
	}
	name := "Test"
	if st.DefaultLocale == "tr" {
		name = "Test Müşteri"
	}
	now := s.now()
	row, err := s.q.CreateReviewRequest(ctx, db.CreateReviewRequestParams{
		OrganizationID: scope.InternalID, Kind: kindTest, CustomerName: name, RecipientPhone: phone,
		Token: token, Status: statusSending, Locale: st.DefaultLocale, SendAt: ts(now), CreatedBy: createdBy,
	})
	if err != nil {
		return TestResult{}, err
	}
	out, err := s.deliver(ctx, row, st, now)
	if err != nil {
		return TestResult{}, err
	}
	s.live(ctx, resourceevents.ActionCreated, out.Uuid)
	s.record(ctx, "tenant.review.test_send", &out.Uuid, map[string]any{"channel": out.Channel, "status": out.Status})
	detail, err := s.Get(ctx, out.Uuid)
	if err != nil {
		return TestResult{}, err
	}
	if out.Status != StatusSent {
		msg := out.SkipReason
		if out.Error != "" {
			msg = out.Error
		}
		return TestResult{}, fmt.Errorf("%w: test message was not sent (%s)", ErrConflict, msg)
	}
	return TestResult{Review: detail, Channel: out.Channel, Phone: phone, PublicURL: s.PublicURL(out.Token)}, nil
}

func digits(s string) int {
	n := 0
	for _, r := range s {
		if r >= '0' && r <= '9' {
			n++
		}
	}
	return n
}
