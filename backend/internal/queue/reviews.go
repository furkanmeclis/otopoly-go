package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

// TaskReviewsSweep sends due review requests (after the delivery delay and
// outside quiet hours) and expires old review links.
const TaskReviewsSweep = "app:reviews:sweep"

const reviewsCron = "@every 1m"

const reviewsUniqueTTL = 50 * time.Second

// ReviewsSweepFunc processes due review requests and returns how many were sent.
type ReviewsSweepFunc func(ctx context.Context) (int, error)

// NewReviewsSweepTask builds the periodic sweep task.
func NewReviewsSweepTask() *asynq.Task {
	return asynq.NewTask(TaskReviewsSweep, []byte("{}"))
}

// WithReviews registers the review request sweep processor.
func (w *Worker) WithReviews(fn ReviewsSweepFunc) *Worker {
	w.mux.HandleFunc(TaskReviewsSweep, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		n, err := fn(ctx)
		if n > 0 {
			w.log.Info("reviews_sweep", "sent", n)
		}
		return err
	})
	return w
}

// RegisterReviewsSchedule adds the minute sweep; Unique collapses the
// duplicate registration from the API and worker processes.
func RegisterReviewsSchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(
		reviewsCron,
		NewReviewsSweepTask(),
		asynq.Queue(QueueMaintenance),
		asynq.Unique(reviewsUniqueTTL),
		asynq.MaxRetry(0),
	); err != nil {
		return fmt.Errorf("queue: register reviews schedule: %w", err)
	}
	return nil
}
