package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	reviewsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reviews/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bizclock"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// ReviewsService is the review collection use case as seen by the assistant
// (organization from orgctx; the reviews.enabled plan toggle is checked by
// the use case).
type ReviewsService interface {
	List(ctx context.Context, limit, offset int32, f reviewsusecase.ListFilters) ([]reviewsusecase.Review, int64, error)
	Summary(ctx context.Context, days int) (reviewsusecase.Summary, error)
	Get(ctx context.Context, id uuid.UUID) (reviewsusecase.ReviewDetail, error)
	MarkFollowedUp(ctx context.Context, id uuid.UUID, in reviewsusecase.FollowUpInput) (reviewsusecase.ReviewDetail, error)
}

const planReviewsOff = "Review collection (değerlendirme toplama) is not included in the organization's plan."

func reviewsError(err error) (Result, error) {
	if errors.Is(err, entitlements.ErrFeatureDisabled) {
		return ErrorResult(planReviewsOff), nil
	}
	return userError(err)
}

// ---------------------------------------------------------------- list

// ListReviews lists customer reviews (değerlendirmeler).
type ListReviews struct{ reviews ReviewsService }

var listReviewsSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"follow_up": map[string]any{"type": "string", "enum": []string{"required", "done"}, "description": "required = low scores waiting for the business to call back (takip gerekli)."},
		"rating":    map[string]any{"type": "string", "enum": []string{"low", "high"}},
		"status": map[string]any{"type": "string", "enum": []string{"scheduled", "sent", "opened", "answered", "expired", "cancelled", "skipped", "failed"},
			"description": "Default: all. answered = the customer gave stars."},
		"days":          map[string]any{"type": "integer", "minimum": 1, "maximum": 365, "description": "Only requests created in the last N days."},
		"customer_uuid": map[string]any{"type": "string", "format": "uuid"},
		"query":         map[string]any{"type": "string", "maxLength": 80, "description": "Customer name, phone, plate or comment text."},
		"limit":         map[string]any{"type": "integer", "minimum": 1, "maximum": 25, "description": "Default 15."},
	},
	"additionalProperties": false,
}

// Spec implements Tool.
func (ListReviews) Spec() Spec {
	return Spec{
		Name: "list_reviews",
		Description: "List customer review requests (değerlendirmeler) sent after deliveries: score (1-5), comment, status, " +
			"channel and follow-up state. Use follow_up=required for low scores that need a call back.",
		InputSchema: listReviewsSchema,
		Permissions: []string{rbac.PermTenantReviewsRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

// Run implements Tool.
func (t ListReviews) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in struct {
		FollowUp     string `json:"follow_up"`
		Rating       string `json:"rating"`
		Status       string `json:"status"`
		Days         int    `json:"days"`
		CustomerUUID string `json:"customer_uuid"`
		Query        string `json:"query"`
		Limit        int    `json:"limit"`
	}
	if err := Decode(listReviewsSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	f := reviewsusecase.ListFilters{FollowUp: in.FollowUp, Rating: in.Rating, Status: in.Status, Days: in.Days, Q: in.Query}
	if strings.TrimSpace(in.CustomerUUID) != "" {
		id, _ := uuid.Parse(in.CustomerUUID)
		f.CustomerUUID = &id
	}
	rows, total, err := t.reviews.List(ctx, int32(clampInt(in.Limit, 15, 1, 25)), 0, f)
	if err != nil {
		return reviewsError(err)
	}
	type item struct {
		UUID     string `json:"uuid"`
		Date     string `json:"date"`
		Customer string `json:"customer,omitempty"`
		Plate    string `json:"plate,omitempty"`
		Score    *int   `json:"score,omitempty"`
		Comment  string `json:"comment,omitempty"`
		Status   string `json:"status"`
		Channel  string `json:"channel,omitempty"`
		FollowUp string `json:"follow_up,omitempty"`
		Note     string `json:"follow_up_note,omitempty"`
	}
	items := make([]item, 0, len(rows))
	for _, r := range rows {
		it := item{
			UUID: r.UUID.String(), Date: bizclock.FormatDay(r.CreatedAt), Customer: DataText(r.CustomerName, maxNameChars),
			Plate: r.Plate, Score: r.Score, Comment: DataText(r.Comment, maxTextChars), Status: r.Status, Channel: r.Channel,
			Note: DataText(r.FollowUpNote, maxTextChars),
		}
		if r.FollowUpStatus != "none" {
			it.FollowUp = r.FollowUpStatus
		}
		items = append(items, it)
	}
	return JSONResult(map[string]any{"total": total, "reviews": items}, "ai.tool_summary.reviews_found", map[string]any{"count": total}), nil
}

// ---------------------------------------------------------------- summary

// ReviewSummary returns review KPIs for a period.
type ReviewSummary struct{ reviews ReviewsService }

var reviewSummarySchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"days": map[string]any{"type": "integer", "minimum": 1, "maximum": 365, "description": "Period length in days (default 30)."},
	},
	"additionalProperties": false,
}

// Spec implements Tool.
func (ReviewSummary) Spec() Spec {
	return Spec{
		Name: "get_review_summary",
		Description: "Customer satisfaction summary for the last N days: average score, response rate, score distribution, " +
			"NPS-like score (promoters 5 minus detractors 1-3), Google review redirects and open follow-ups.",
		InputSchema: reviewSummarySchema,
		Permissions: []string{rbac.PermTenantReviewsRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

// Run implements Tool.
func (t ReviewSummary) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Days int `json:"days"`
	}
	if err := Decode(reviewSummarySchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	sum, err := t.reviews.Summary(ctx, clampInt(in.Days, 30, 1, 365))
	if err != nil {
		return reviewsError(err)
	}
	dist := map[string]int64{}
	for _, d := range sum.Distribution {
		dist[strconv.Itoa(d.Score)] = d.Count
	}
	out := map[string]any{
		"days": sum.Days, "requests_sent": sum.SentCount, "answered": sum.AnsweredCount,
		"response_rate_pct": int(sum.ResponseRate*100 + 0.5), "average_score": sum.AverageScore,
		"distribution": dist, "nps": sum.NPS, "google_redirects": sum.GoogleRedirects,
		"follow_up_required": sum.FollowUpRequired, "scheduled": sum.ScheduledCount,
	}
	return JSONResult(out, "ai.tool_summary.review_summary", map[string]any{"average": sum.AverageScore, "count": sum.AnsweredCount}), nil
}

// ---------------------------------------------------------------- follow-up

// MarkReviewFollowedUp marks a low-score review handled ("ele alındı").
type MarkReviewFollowedUp struct{ reviews ReviewsService }

var markReviewSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"review_uuid": map[string]any{"type": "string", "format": "uuid", "description": "uuid from list_reviews."},
		"note":        map[string]any{"type": "string", "maxLength": 1000, "description": "What was done, e.g. \"Müşteri arandı, yeniden yıkama yapıldı\"."},
	},
	"required":             []string{"review_uuid"},
	"additionalProperties": false,
}

type markReviewInput struct {
	ReviewUUID string `json:"review_uuid"`
	Note       string `json:"note,omitempty"`
}

// Spec implements Tool.
func (MarkReviewFollowedUp) Spec() Spec {
	return Spec{
		Name:                 "mark_review_followed_up",
		Description:          "Propose marking an answered review as followed up (ele alındı) with an optional note. Shows a confirmation card.",
		InputSchema:          markReviewSchema,
		Permissions:          []string{rbac.PermTenantReviewsWrite, rbac.PermTenantReviewsRead},
		OrgRoles:             []string{"owner"},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// Propose implements ActionTool.
func (t MarkReviewFollowedUp) Propose(ctx context.Context, _ Env, raw json.RawMessage) (Proposal, error) {
	var in markReviewInput
	if err := decodeInput(markReviewSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	in.Note = strings.TrimSpace(in.Note)
	id, _ := uuid.Parse(in.ReviewUUID)
	r, err := t.reviews.Get(ctx, id)
	if err != nil {
		if errors.Is(err, entitlements.ErrFeatureDisabled) {
			return Proposal{}, inputErr("%s", planReviewsOff)
		}
		return Proposal{}, proposalError(err)
	}
	if r.Status != reviewsusecase.StatusAnswered {
		return Proposal{}, inputErr("review %s is not answered yet (status %s)", r.UUID, r.Status)
	}
	if r.FollowUpStatus == "done" {
		return Proposal{}, inputErr("review %s is already followed up", r.UUID)
	}
	fields := []Field{}
	if r.Score != nil {
		fields = append(fields, Field{Key: "score", Value: strconv.Itoa(*r.Score) + "/5"})
	}
	if r.Plate != "" {
		fields = append(fields, Field{Key: "plate", Value: r.Plate})
	}
	if r.Comment != "" {
		fields = append(fields, Field{Key: "comment", Value: Truncate(r.Comment, 120)})
	}
	if in.Note != "" {
		fields = append(fields, Field{Key: "note", Value: Truncate(in.Note, 120)})
	}
	return Proposal{Input: mustJSON(in), Preview: Preview{Action: "mark_review_followed_up", Title: r.CustomerName, Fields: fields}}, nil
}

// Run implements Tool.
func (t MarkReviewFollowedUp) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in markReviewInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	id, _ := uuid.Parse(in.ReviewUUID)
	r, err := t.reviews.MarkFollowedUp(ctx, id, reviewsusecase.FollowUpInput{Note: in.Note})
	if err != nil {
		if errors.Is(err, entitlements.ErrFeatureDisabled) {
			return ErrorResult("Not executed: " + planReviewsOff), nil
		}
		return execError(err)
	}
	res := JSONResult(map[string]any{"done": true, "review_uuid": r.UUID.String(), "follow_up": r.FollowUpStatus,
		"customer": DataText(r.CustomerName, maxNameChars)},
		"ai.tool_summary.review_followed_up", map[string]any{"customer": Truncate(r.CustomerName, 40)})
	res.Link = &Link{Kind: "review", UUID: r.UUID.String()}
	return res, nil
}
