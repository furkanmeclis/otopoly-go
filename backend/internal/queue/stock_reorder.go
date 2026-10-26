package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

// TaskStockReorderSweep sends the daily stock reorder notification (once per
// organization per day, after 09:00 Europe/Istanbul).
const TaskStockReorderSweep = "app:stock_reorder:sweep"

const stockReorderCron = "@every 5m"

const stockReorderUniqueTTL = 4 * time.Minute

// SendStockReorderFunc sends due notifications and returns how many were created.
type SendStockReorderFunc func(ctx context.Context) (int, error)

func NewStockReorderSweepTask() *asynq.Task {
	return asynq.NewTask(TaskStockReorderSweep, []byte("{}"))
}

// WithStockReorder registers the daily reorder notification sweep.
func (w *Worker) WithStockReorder(fn SendStockReorderFunc) *Worker {
	w.mux.HandleFunc(TaskStockReorderSweep, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		n, err := fn(ctx)
		if n > 0 {
			w.log.Info("stock_reorder_sweep", "notified", n)
		}
		return err
	})
	return w
}

// RegisterStockReorderSchedule adds the sweep; Unique collapses duplicate
// registrations from the API and worker processes.
func RegisterStockReorderSchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(
		stockReorderCron,
		NewStockReorderSweepTask(),
		asynq.Queue(QueueMaintenance),
		asynq.Unique(stockReorderUniqueTTL),
		asynq.MaxRetry(0),
	); err != nil {
		return fmt.Errorf("queue: register stock reorder schedule: %w", err)
	}
	return nil
}
