package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

const (
	TaskBillingLifecycle = "app:billing:lifecycle"
	TaskBillingDigest    = "app:billing:digest"
)

const (
	billingLifecycleCron = "5 * * * *"
	billingDigestCron    = "0 3 * * *"
)

type BillingLifecycleResult struct {
	MovedToGrace       int
	MovedToReadOnly    int
	RemindersSent      int
	OrderRemindersSent int
}

type BillingLifecycleFunc func(ctx context.Context, now time.Time) (BillingLifecycleResult, error)
type BillingDigestFunc func(ctx context.Context, now time.Time) error

func NewBillingLifecycleTask() *asynq.Task {
	return asynq.NewTask(TaskBillingLifecycle, []byte("{}"))
}

func NewBillingDigestTask() *asynq.Task {
	return asynq.NewTask(TaskBillingDigest, []byte("{}"))
}

func (w *Worker) WithBillingLifecycle(fn BillingLifecycleFunc) *Worker {
	w.mux.HandleFunc(TaskBillingLifecycle, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		res, err := fn(ctx, time.Now().UTC())
		w.log.Info("billing_lifecycle", "grace", res.MovedToGrace, "read_only", res.MovedToReadOnly, "reminders", res.RemindersSent, "order_reminders", res.OrderRemindersSent)
		return err
	})
	return w
}

func (w *Worker) WithBillingDigest(fn BillingDigestFunc) *Worker {
	w.mux.HandleFunc(TaskBillingDigest, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		return fn(ctx, time.Now().UTC())
	})
	return w
}

func RegisterBillingLifecycleSchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(
		billingLifecycleCron,
		NewBillingLifecycleTask(),
		asynq.Queue(QueueMaintenance),
		asynq.Unique(55*time.Minute),
		asynq.MaxRetry(0),
	); err != nil {
		return fmt.Errorf("queue: register billing lifecycle: %w", err)
	}
	return nil
}

func RegisterBillingDigestSchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(
		billingDigestCron,
		NewBillingDigestTask(),
		asynq.Queue(QueueMaintenance),
		asynq.Unique(23*time.Hour),
		asynq.MaxRetry(0),
	); err != nil {
		return fmt.Errorf("queue: register billing digest: %w", err)
	}
	return nil
}
