package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	reviewsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reviews/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/google/uuid"
)

type fakeReviews struct {
	filters  reviewsusecase.ListFilters
	review   reviewsusecase.ReviewDetail
	marked   *reviewsusecase.FollowUpInput
	disabled bool
}

func (f *fakeReviews) List(_ context.Context, _, _ int32, fl reviewsusecase.ListFilters) ([]reviewsusecase.Review, int64, error) {
	if f.disabled {
		return nil, 0, entitlements.ErrFeatureDisabled
	}
	f.filters = fl
	return []reviewsusecase.Review{f.review.Review}, 1, nil
}

func (f *fakeReviews) Summary(context.Context, int) (reviewsusecase.Summary, error) {
	return reviewsusecase.Summary{Days: 30, AnsweredCount: 4, SentCount: 8, ResponseRate: 0.5, AverageScore: 4.2,
		Distribution: []reviewsusecase.ScoreCount{{Score: 1}, {Score: 2}, {Score: 3}, {Score: 4, Count: 2}, {Score: 5, Count: 2}}}, nil
}

func (f *fakeReviews) Get(context.Context, uuid.UUID) (reviewsusecase.ReviewDetail, error) {
	return f.review, nil
}

func (f *fakeReviews) MarkFollowedUp(_ context.Context, _ uuid.UUID, in reviewsusecase.FollowUpInput) (reviewsusecase.ReviewDetail, error) {
	f.marked = &in
	d := f.review
	d.FollowUpStatus = "done"
	return d, nil
}

func TestReviewTools(t *testing.T) {
	score := 2
	rv := &fakeReviews{review: reviewsusecase.ReviewDetail{Review: reviewsusecase.Review{
		UUID: uuid.New(), Status: reviewsusecase.StatusAnswered, CustomerName: "Ayşe Kaya", Plate: "34 ABC 123",
		Score: &score, Comment: "Geç teslim", FollowUpStatus: "required", CreatedAt: time.Now(),
	}}}
	env := Env{Now: time.Now()}
	res, err := (ListReviews{reviews: rv}).Run(context.Background(), env, json.RawMessage(`{"follow_up":"required","days":30}`))
	if err != nil || res.IsError || rv.filters.FollowUp != "required" || rv.filters.Days != 30 ||
		!strings.Contains(res.Content, `"follow_up":"required"`) || !strings.Contains(res.Content, `"score":2`) {
		t.Fatalf("list: %v %s %+v", err, res.Content, rv.filters)
	}
	res, err = (ReviewSummary{reviews: rv}).Run(context.Background(), env, json.RawMessage(`{}`))
	if err != nil || res.IsError || !strings.Contains(res.Content, `"response_rate_pct":50`) || !strings.Contains(res.Content, `"average_score":4.2`) {
		t.Fatalf("summary: %v %s", err, res.Content)
	}
	tool := MarkReviewFollowedUp{reviews: rv}
	if !tool.Spec().RequiresConfirmation || tool.Spec().Kind != KindWrite {
		t.Fatal("follow-up must be a confirmable write")
	}
	p, err := tool.Propose(context.Background(), env, json.RawMessage(`{"review_uuid":"`+rv.review.UUID.String()+`","note":" Arandı "}`))
	if err != nil || p.Preview.Title != "Ayşe Kaya" || len(p.Preview.Fields) < 3 {
		t.Fatalf("propose: %v %+v", err, p.Preview)
	}
	res, err = tool.Run(context.Background(), env, p.Input)
	if err != nil || res.IsError || rv.marked == nil || rv.marked.Note != "Arandı" || res.Link == nil || res.Link.Kind != "review" {
		t.Fatalf("run: %v %+v %+v", err, res, rv.marked)
	}
	rv.review.FollowUpStatus = "done"
	if _, err := tool.Propose(context.Background(), env, json.RawMessage(`{"review_uuid":"`+rv.review.UUID.String()+`"}`)); err == nil {
		t.Fatal("already followed up must not be proposed")
	}
	rv.disabled = true
	res, _ = (ListReviews{reviews: rv}).Run(context.Background(), env, json.RawMessage(`{}`))
	if !res.IsError || !strings.Contains(res.Content, "plan") {
		t.Fatalf("plan off: %s", res.Content)
	}
}
