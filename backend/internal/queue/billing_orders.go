package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

const TaskBillingOrdersExpire = "app:billing:orders-expire"

const billingOrdersExpireCron = "*/15 * * * *"

type ExpireBillingOrdersFunc func(ctx context.Context) (int, error)

func NewBillingOrdersExpireTask() *asynq.Task {
	return asynq.NewTask(TaskBillingOrdersExpire, []byte("{}"))
}

func (w *Worker) WithBillingOrdersExpire(fn ExpireBillingOrdersFunc) *Worker {
	w.mux.HandleFunc(TaskBillingOrdersExpire, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		n, err := fn(ctx)
		w.log.Info("billing_orders_expire", "orders", n)
		return err
	})
	return w
}

func RegisterBillingOrdersExpireSchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(
		billingOrdersExpireCron,
		NewBillingOrdersExpireTask(),
		asynq.Queue(QueueMaintenance),
		asynq.Unique(14*time.Minute),
		asynq.MaxRetry(0),
	); err != nil {
		return fmt.Errorf("queue: register billing orders expire: %w", err)
	}
	return nil
}
