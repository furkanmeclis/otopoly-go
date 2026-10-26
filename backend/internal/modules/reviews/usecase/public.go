package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/jackc/pgx/v5/pgtype"
)

// publicRow loads a request by token; requests that were never sent are
// not found.
func (s *Service) publicRow(ctx context.Context, token string) (db.ReviewRequest, error) {
	if !ValidToken(token) {
		return db.ReviewRequest{}, ErrNotFound
	}
	row, err := s.q.GetReviewRequestByToken(ctx, token)
	if isNoRows(err) {
		return db.ReviewRequest{}, ErrNotFound
	}
	if err != nil {
		return db.ReviewRequest{}, err
	}
	switch row.Status {
	case StatusSent, StatusOpened, StatusAnswered, StatusExpired:
		return row, nil
	}
	return db.ReviewRequest{}, ErrNotFound
}

func (s *Service) expired(row db.ReviewRequest) bool {
	if row.Status == StatusExpired {
		return true
	}
	return row.Status != StatusAnswered && row.ExpiresAt.Valid && !row.ExpiresAt.Time.After(s.now())
}

func (s *Service) publicView(ctx context.Context, row db.ReviewRequest) (PublicReview, error) {
	org, err := s.q.GetReviewOrganization(ctx, row.OrganizationID)
	if err != nil {
		return PublicReview{}, err
	}
	st, err := s.loadSettings(ctx, row.OrganizationID)
	if err != nil {
		return PublicReview{}, err
	}
	color := strings.TrimSpace(org.PrimaryColor)
	if !validColor(color) {
		color = "#2563eb"
	}
	out := PublicReview{
		State: PublicStateOpen, OrganizationName: org.Name, OrganizationPhone: org.Phone, PrimaryColor: color,
		CustomerFirstName: FirstName(row.CustomerName), Locale: row.Locale, ConsentText: st.ConsentText,
		ExpiresAt: optTime(row.ExpiresAt), Score: optScore(row.Score), Comment: row.Comment,
		AnsweredAt: optTime(row.AnsweredAt),
	}
	if org.LogoObjectKey.Valid && strings.TrimSpace(org.LogoObjectKey.String) != "" {
		u := fmt.Sprintf("/v1/public/organizations/logo/%s", org.Uuid.String())
		out.OrganizationLogoURL = &u
	}
	switch {
	case row.Status == StatusAnswered:
		out.State = PublicStateAnswered
		out.Result = rating(row.IsHigh)
		if row.IsHigh.Valid && row.IsHigh.Bool {
			out.GoogleReviewURL = st.GoogleReviewUrl
		}
	case s.expired(row):
		out.State = PublicStateExpired
	}
	return out, nil
}

func validColor(c string) bool {
	if len(c) != 7 || c[0] != '#' {
		return false
	}
	for _, r := range c[1:] {
		hex := r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F'
		if !hex {
			return false
		}
	}
	return true
}

// PublicGet returns the customer page; the first open marks it opened.
func (s *Service) PublicGet(ctx context.Context, token string) (PublicReview, error) {
	row, err := s.publicRow(ctx, token)
	if err != nil {
		return PublicReview{}, err
	}
	if !s.expired(row) {
		wasSent := row.Status == StatusSent
		if row, err = s.q.MarkReviewRequestViewed(ctx, row.ID); err != nil {
			return PublicReview{}, err
		}
		if wasSent {
			s.live(orgctx.WithScope(ctx, orgctx.Scope{InternalID: row.OrganizationID}), resourceevents.ActionUpdated, row.Uuid)
		}
	}
	return s.publicView(ctx, row)
}

// PublicAnswer records the customer's stars (once). Low scores need a
// follow-up and notify the team.
func (s *Service) PublicAnswer(ctx context.Context, token string, in PublicAnswerInput, client ClientInfo) (PublicReview, error) {
	if in.Score < 1 || in.Score > 5 {
		return PublicReview{}, fmt.Errorf("%w: score must be 1-5", ErrInvalidRequest)
	}
	comment := strings.TrimSpace(in.Comment)
	if len([]rune(comment)) > maxComment {
		return PublicReview{}, fmt.Errorf("%w: comment is too long", ErrInvalidRequest)
	}
	row, err := s.publicRow(ctx, token)
	if err != nil {
		return PublicReview{}, err
	}
	if row.Status == StatusAnswered {
		return PublicReview{}, ErrAlreadyAnswered
	}
	if s.expired(row) {
		return PublicReview{}, ErrExpired
	}
	st, err := s.loadSettings(ctx, row.OrganizationID)
	if err != nil {
		return PublicReview{}, err
	}
	high := in.Score >= int(st.HighScoreThreshold)
	follow := followNone
	if !high && row.Kind == kindJob {
		follow = followNeeded
	}
	updated, err := s.q.AnswerReviewRequest(ctx, db.AnswerReviewRequestParams{
		Score: pgtype.Int2{Int16: int16(in.Score), Valid: true}, Comment: comment, Consent: in.Consent,
		IsHigh: pgtype.Bool{Bool: high, Valid: true}, FollowUpStatus: follow,
		AnswerIp: truncate(client.IP, 64), AnswerUserAgent: truncate(client.UserAgent, 400), ID: row.ID,
	})
	if isNoRows(err) {
		return PublicReview{}, ErrAlreadyAnswered // answered concurrently
	}
	if err != nil {
		return PublicReview{}, err
	}
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: updated.OrganizationID})
	s.live(octx, resourceevents.ActionUpdated, updated.Uuid)
	if s.act != nil {
		s.act.Record(octx, nil, "tenant.review.answer", ResourceName, &updated.Uuid, map[string]any{
			"score": in.Score, "rating": rating(updated.IsHigh), "customer": updated.CustomerName,
		}, nil)
	}
	if !high {
		s.notifyLowScore(octx, updated)
	}
	return s.publicView(ctx, updated)
}

// notifyLowScore sends the in-app notice (+ push) to members who can read
// reviews; a test request only notifies the member who sent it.
func (s *Service) notifyLowScore(ctx context.Context, r db.ReviewRequest) {
	if s.team == nil {
		return
	}
	org, err := s.q.GetReviewOrganization(ctx, r.OrganizationID)
	if err != nil {
		s.log.Warn("review_low_score_org_failed", "review", r.Uuid, "error", err)
		return
	}
	var users []int64
	if r.Kind == kindTest {
		if r.CreatedBy.Valid {
			users = []int64{r.CreatedBy.Int64}
		}
	} else if users, err = s.q.ListReviewNotifyRecipients(ctx, r.OrganizationID); err != nil {
		s.log.Warn("review_low_score_recipients_failed", "review", r.Uuid, "error", err)
		return
	}
	score := 0
	if r.Score.Valid {
		score = int(r.Score.Int16)
	}
	for _, uid := range users {
		if err := s.team.LowScore(ctx, TeamNotice{
			OrgID: r.OrganizationID, UserID: uid, ReviewID: r.ID, ReviewUUID: r.Uuid,
			CustomerName: r.CustomerName, Plate: r.Plate, Score: score, Comment: r.Comment,
			ActionURL: fmt.Sprintf("/t/%s/reviews/%s", org.Slug, r.Uuid),
		}); err != nil {
			s.log.Warn("review_low_score_notify_failed", "review", r.Uuid, "user_id", uid, "error", err)
		}
	}
}

// PublicGoogleRedirect counts a redirect to the Google review page (high
// scores only) and returns its URL.
func (s *Service) PublicGoogleRedirect(ctx context.Context, token string) (GoogleRedirect, error) {
	row, err := s.publicRow(ctx, token)
	if err != nil {
		return GoogleRedirect{}, err
	}
	st, err := s.loadSettings(ctx, row.OrganizationID)
	if err != nil {
		return GoogleRedirect{}, err
	}
	if row.Status != StatusAnswered || !row.IsHigh.Valid || !row.IsHigh.Bool || st.GoogleReviewUrl == "" {
		return GoogleRedirect{}, ErrNotFound
	}
	updated, err := s.q.RecordReviewGoogleRedirect(ctx, row.ID)
	if isNoRows(err) {
		return GoogleRedirect{}, ErrNotFound
	}
	if err != nil {
		return GoogleRedirect{}, err
	}
	s.live(orgctx.WithScope(ctx, orgctx.Scope{InternalID: updated.OrganizationID}), resourceevents.ActionUpdated, updated.Uuid)
	return GoogleRedirect{URL: st.GoogleReviewUrl}, nil
}
