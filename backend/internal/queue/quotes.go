package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

// TaskQuotesExpireSweep marks quotes past valid_until as expired.
const TaskQuotesExpireSweep = "app:quotes:expire_sweep"

// quoteExpireCron: expiry is day-granular (Europe/Istanbul); hourly keeps the
// status fresh shortly after midnight without load.
const quoteExpireCron = "@every 1h"

// ExpireQuotesFunc expires due quotes and returns how many changed.
type ExpireQuotesFunc func(ctx context.Context) (int, error)

// NewQuotesExpireSweepTask builds the periodic sweep task.
func NewQuotesExpireSweepTask() *asynq.Task {
	return asynq.NewTask(TaskQuotesExpireSweep, []byte("{}"))
}

// WithQuoteExpire registers the quote expiry sweep processor.
func (w *Worker) WithQuoteExpire(fn ExpireQuotesFunc) *Worker {
	w.mux.HandleFunc(TaskQuotesExpireSweep, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		n, err := fn(ctx)
		if n > 0 {
			w.log.Info("quotes_expire_sweep", "expired", n)
		}
		return err
	})
	return w
}

// RegisterQuoteExpirySchedule adds the hourly expiry sweep to a scheduler.
func RegisterQuoteExpirySchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(quoteExpireCron, NewQuotesExpireSweepTask(), asynq.Queue(QueueMaintenance), asynq.Unique(quoteExpireUniqueTTL)); err != nil {
		return fmt.Errorf("queue: register quote expiry schedule: %w", err)
	}
	return nil
}

const quoteExpireUniqueTTL = 55 * time.Minute
