package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

// TaskDailySummarySweep sends end-of-day WhatsApp summaries whose local send
// time has passed (once per organization per day).
const TaskDailySummarySweep = "app:daily_summary:sweep"

// Minute granularity so a 20:00 schedule goes out within a minute.
const dailySummaryCron = "@every 1m"

const dailySummaryUniqueTTL = 50 * time.Second

// SendDailySummariesFunc sends due summaries and returns how many messages were queued.
type SendDailySummariesFunc func(ctx context.Context) (int, error)

func NewDailySummarySweepTask() *asynq.Task {
	return asynq.NewTask(TaskDailySummarySweep, []byte("{}"))
}

// WithDailySummary registers the end-of-day summary sweep processor.
func (w *Worker) WithDailySummary(fn SendDailySummariesFunc) *Worker {
	w.mux.HandleFunc(TaskDailySummarySweep, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		n, err := fn(ctx)
		if n > 0 {
			w.log.Info("daily_summary_sweep", "queued", n)
		}
		return err
	})
	return w
}

// RegisterDailySummarySchedule adds the minute sweep; Unique collapses the
// duplicate registration from the API and worker processes.
func RegisterDailySummarySchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(
		dailySummaryCron,
		NewDailySummarySweepTask(),
		asynq.Queue(QueueMaintenance),
		asynq.Unique(dailySummaryUniqueTTL),
		asynq.MaxRetry(0),
	); err != nil {
		return fmt.Errorf("queue: register daily summary schedule: %w", err)
	}
	return nil
}
