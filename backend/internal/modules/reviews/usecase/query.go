package usecase

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourcemeta"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

var listStatuses = []string{StatusScheduled, StatusSent, StatusOpened, StatusAnswered, StatusExpired, StatusCancelled, StatusSkipped, StatusFailed}

var listSorts = map[string]bool{"": true, "-created_at": true, "created_at": true, "score": true, "-score": true, "answered_at": true, "-answered_at": true}

// ResourceMeta describes the list for the DataTable.
func (s *Service) ResourceMeta() resourcemeta.ResourceMeta { return resourcemeta.TenantReviews() }

func apiStatus(st string) string {
	if st == statusSending {
		return StatusScheduled
	}
	return st
}

func optText(v string) pgtype.Text {
	v = strings.TrimSpace(v)
	return pgtype.Text{String: v, Valid: v != ""}
}

func rating(isHigh pgtype.Bool) string {
	if !isHigh.Valid {
		return ""
	}
	if isHigh.Bool {
		return "high"
	}
	return "low"
}

func optScore(v pgtype.Int2) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int16)
	return &n
}

func mapListRow(r db.ListReviewRequestsRow) Review {
	return Review{
		UUID: r.Uuid, Kind: r.Kind, Status: apiStatus(r.Status), SkipReason: r.SkipReason, Error: r.Error,
		Channel: r.Channel, Locale: r.Locale, CustomerUUID: optUUID(r.CustomerUuid), CustomerName: r.CustomerName,
		CustomerPhone: r.RecipientPhone, JobUUID: optUUID(r.JobUuid), Plate: r.Plate, Score: optScore(r.Score),
		Comment: r.Comment, Rating: rating(r.IsHigh), GoogleRedirects: int(r.GoogleRedirects),
		FollowUpStatus: r.FollowUpStatus, FollowUpNote: r.FollowUpNote, FollowedUpAt: optTime(r.FollowedUpAt),
		FollowedUpByName: r.FollowedUpByName, SendAt: r.SendAt.Time, Deferred: r.Deferred,
		SentAt: optTime(r.SentAt), OpenedAt: optTime(r.OpenedAt), AnsweredAt: optTime(r.AnsweredAt),
		ExpiresAt: optTime(r.ExpiresAt), CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time,
	}
}

func (s *Service) mapDetail(r db.GetReviewRequestByUUIDRow) ReviewDetail {
	d := ReviewDetail{
		Review: Review{
			UUID: r.Uuid, Kind: r.Kind, Status: apiStatus(r.Status), SkipReason: r.SkipReason, Error: r.Error,
			Channel: r.Channel, Locale: r.Locale, CustomerUUID: optUUID(r.CustomerUuid), CustomerName: r.CustomerName,
			CustomerPhone: r.RecipientPhone, JobUUID: optUUID(r.JobUuid), Plate: r.Plate, Score: optScore(r.Score),
			Comment: r.Comment, Rating: rating(r.IsHigh), GoogleRedirects: int(r.GoogleRedirects),
			FollowUpStatus: r.FollowUpStatus, FollowUpNote: r.FollowUpNote, FollowedUpAt: optTime(r.FollowedUpAt),
			FollowedUpByName: r.FollowedUpByName, SendAt: r.SendAt.Time, Deferred: r.Deferred,
			SentAt: optTime(r.SentAt), OpenedAt: optTime(r.OpenedAt), AnsweredAt: optTime(r.AnsweredAt),
			ExpiresAt: optTime(r.ExpiresAt), CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time,
		},
		Consent: r.Consent, ViewCount: int(r.ViewCount), GoogleRedirectedAt: optTime(r.GoogleRedirectedAt),
		CancelledAt: optTime(r.CancelledAt),
	}
	if r.Kind == kindTest && r.Status != statusSending && r.Status != StatusScheduled {
		d.PublicURL = s.PublicURL(r.Token)
	}
	return d
}

// List returns the organization's review requests.
func (s *Service) List(ctx context.Context, limit, offset int32, f ListFilters) ([]Review, int64, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return nil, 0, err
	}
	if err := s.requireFeature(ctx, scope.InternalID); err != nil {
		return nil, 0, err
	}
	bad := func(msg string) ([]Review, int64, error) { return nil, 0, fmt.Errorf("%w: %s", ErrInvalidRequest, msg) }
	status := strings.TrimSpace(f.Status)
	if status != "" && !contains(listStatuses, status) {
		return bad("unknown status")
	}
	follow := strings.TrimSpace(f.FollowUp)
	if follow != "" && follow != followNone && follow != followNeeded && follow != followDone {
		return bad("follow_up must be none, required or done")
	}
	rate := strings.TrimSpace(f.Rating)
	if rate != "" && rate != "high" && rate != "low" {
		return bad("rating must be high or low")
	}
	ch := strings.TrimSpace(f.Channel)
	if ch != "" && ch != ChannelSMS && ch != ChannelWhatsApp {
		return bad("channel must be sms or whatsapp")
	}
	if f.Score < 0 || f.Score > 5 {
		return bad("score must be 1-5")
	}
	sort := strings.TrimSpace(f.Sort)
	if !listSorts[sort] {
		return bad("unknown sort")
	}
	if f.Days < 0 || f.Days > 3650 {
		return bad("days is out of range")
	}
	var customerID pgtype.Int8
	if f.CustomerUUID != nil {
		id, err := s.q.GetReviewCustomerID(ctx, db.GetReviewCustomerIDParams{OrganizationID: scope.InternalID, Uuid: *f.CustomerUUID})
		if isNoRows(err) {
			return []Review{}, 0, nil
		}
		if err != nil {
			return nil, 0, err
		}
		customerID = pgtype.Int8{Int64: id, Valid: true}
	}
	var since pgtype.Timestamptz
	if f.Days > 0 {
		since = ts(s.now().Add(-time.Duration(f.Days) * 24 * time.Hour))
	}
	var score pgtype.Int2
	if f.Score > 0 {
		score = pgtype.Int2{Int16: int16(f.Score), Valid: true}
	}
	p := db.ListReviewRequestsParams{
		OrganizationID: scope.InternalID, Status: optText(status), FollowUp: optText(follow), Rating: optText(rate),
		Score: score, Channel: optText(ch), CustomerID: customerID, Since: since, IncludeTests: f.IncludeTests,
		Q: optText(f.Q), Sort: sort, LimitCount: limit, OffsetCount: offset,
	}
	rows, err := s.q.ListReviewRequests(ctx, p)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountReviewRequests(ctx, db.CountReviewRequestsParams{
		OrganizationID: p.OrganizationID, Status: p.Status, FollowUp: p.FollowUp, Rating: p.Rating, Score: p.Score,
		Channel: p.Channel, CustomerID: p.CustomerID, Since: p.Since, IncludeTests: p.IncludeTests, Q: p.Q,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Review, 0, len(rows))
	for _, r := range rows {
		out = append(out, mapListRow(r))
	}
	return out, total, nil
}

// Get returns one review request of the organization (another
// organization's request is not found).
func (s *Service) Get(ctx context.Context, id uuid.UUID) (ReviewDetail, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return ReviewDetail{}, err
	}
	if err := s.requireFeature(ctx, scope.InternalID); err != nil {
		return ReviewDetail{}, err
	}
	row, err := s.q.GetReviewRequestByUUID(ctx, db.GetReviewRequestByUUIDParams{OrganizationID: scope.InternalID, Uuid: id})
	if isNoRows(err) {
		return ReviewDetail{}, ErrNotFound
	}
	if err != nil {
		return ReviewDetail{}, err
	}
	return s.mapDetail(row), nil
}

// MarkFollowedUp marks an answered review handled ("ele alındı") with a note.
func (s *Service) MarkFollowedUp(ctx context.Context, id uuid.UUID, in FollowUpInput) (ReviewDetail, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return ReviewDetail{}, err
	}
	if err := s.requireFeature(ctx, scope.InternalID); err != nil {
		return ReviewDetail{}, err
	}
	note := strings.TrimSpace(in.Note)
	if len([]rune(note)) > maxNote {
		return ReviewDetail{}, fmt.Errorf("%w: note is too long", ErrInvalidRequest)
	}
	cur, err := s.q.GetReviewRequestByUUID(ctx, db.GetReviewRequestByUUIDParams{OrganizationID: scope.InternalID, Uuid: id})
	if isNoRows(err) {
		return ReviewDetail{}, ErrNotFound
	}
	if err != nil {
		return ReviewDetail{}, err
	}
	if cur.Status != StatusAnswered {
		return ReviewDetail{}, fmt.Errorf("%w: only answered reviews can be followed up", ErrConflict)
	}
	var uid pgtype.Int8
	if a := actorID(ctx); a != nil {
		uid = pgtype.Int8{Int64: *a, Valid: true}
	}
	if _, err := s.q.MarkReviewFollowedUp(ctx, db.MarkReviewFollowedUpParams{
		Note: note, UserID: uid, OrganizationID: scope.InternalID, Uuid: id,
	}); err != nil {
		if isNoRows(err) {
			return ReviewDetail{}, ErrNotFound
		}
		return ReviewDetail{}, err
	}
	s.live(ctx, resourceevents.ActionUpdated, id)
	s.record(ctx, "tenant.review.follow_up", &id, map[string]any{"score": optScore(cur.Score), "customer": cur.CustomerName})
	return s.Get(ctx, id)
}

// Summary aggregates the last days (default 30) for the tiles and trend.
func (s *Service) Summary(ctx context.Context, days int) (Summary, error) {
	scope, err := s.requireOrg(ctx)
	if err != nil {
		return Summary{}, err
	}
	if err := s.requireFeature(ctx, scope.InternalID); err != nil {
		return Summary{}, err
	}
	if days == 0 {
		days = 30
	}
	if days < 1 || days > 730 {
		return Summary{}, fmt.Errorf("%w: days must be between 1 and 730", ErrInvalidRequest)
	}
	bucket := "week"
	if days > 120 {
		bucket = "month"
	}
	since := ts(s.now().Add(-time.Duration(days) * 24 * time.Hour))
	tot, err := s.q.ReviewSummaryTotals(ctx, db.ReviewSummaryTotalsParams{OrganizationID: scope.InternalID, Since: since})
	if err != nil {
		return Summary{}, err
	}
	dist, err := s.q.ReviewScoreDistribution(ctx, db.ReviewScoreDistributionParams{OrganizationID: scope.InternalID, Since: since})
	if err != nil {
		return Summary{}, err
	}
	trend, err := s.q.ReviewTrend(ctx, db.ReviewTrendParams{Bucket: bucket, OrganizationID: scope.InternalID, Since: since})
	if err != nil {
		return Summary{}, err
	}
	out := Summary{
		Days: days, Bucket: bucket, SentCount: tot.SentCount, OpenedCount: tot.OpenedCount,
		AnsweredCount: tot.AnsweredCount, ScheduledCount: tot.ScheduledCount,
		AverageScore: round1(tot.AverageScore), GoogleRedirects: tot.GoogleRedirects,
		FollowUpRequired: tot.FollowUpRequired, Distribution: make([]ScoreCount, 5), Trend: make([]TrendPoint, 0, len(trend)),
	}
	if tot.SentCount > 0 {
		out.ResponseRate = math.Round(float64(tot.AnsweredCount)/float64(tot.SentCount)*1000) / 1000
	}
	for i := range out.Distribution {
		out.Distribution[i].Score = i + 1
	}
	var answered int64
	for _, d := range dist {
		if d.Score >= 1 && d.Score <= 5 {
			out.Distribution[d.Score-1].Count = d.Count
		}
		answered += d.Count
		switch d.Score {
		case 5:
			out.Promoters += d.Count
		case 4:
			out.Passives += d.Count
		default:
			out.Detractors += d.Count
		}
	}
	if answered > 0 {
		out.NPS = int(math.Round(float64(out.Promoters-out.Detractors) / float64(answered) * 100))
	}
	for _, t := range trend {
		out.Trend = append(out.Trend, TrendPoint{
			PeriodStart: t.BucketStart.Time.Format("2006-01-02"), Sent: t.SentCount, Answered: t.AnsweredCount,
			AverageScore: round1(t.AverageScore),
		})
	}
	return out, nil
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
