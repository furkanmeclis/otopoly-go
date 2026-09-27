package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

// TaskBillingRecompute rebuilds usage counters from source tables once a day
// (06:00 Europe/Istanbul; the scheduler runs in UTC).
const TaskBillingRecompute = "app:billing:recompute"

const billingRecomputeCron = "0 3 * * *"

type RecomputeUsageFunc func(ctx context.Context) (int, error)

func NewBillingRecomputeTask() *asynq.Task {
	return asynq.NewTask(TaskBillingRecompute, []byte("{}"))
}

func (w *Worker) WithBillingRecompute(fn RecomputeUsageFunc) *Worker {
	w.mux.HandleFunc(TaskBillingRecompute, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		n, err := fn(ctx)
		w.log.Info("billing_recompute", "organizations", n)
		return err
	})
	return w
}

func RegisterBillingRecomputeSchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(
		billingRecomputeCron,
		NewBillingRecomputeTask(),
		asynq.Queue(QueueMaintenance),
		asynq.Unique(time.Hour),
		asynq.MaxRetry(0),
	); err != nil {
		return fmt.Errorf("queue: register billing recompute: %w", err)
	}
	return nil
}
