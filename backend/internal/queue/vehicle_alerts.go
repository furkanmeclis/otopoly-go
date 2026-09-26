package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

// TaskVehicleAlertsFlush sends queued vehicle alert lines over WhatsApp
// (instant or as a digest per the org's batch window).
const TaskVehicleAlertsFlush = "app:vehicle_alerts:flush"

const vehicleAlertsCron = "@every 1m"

const vehicleAlertsUniqueTTL = 50 * time.Second

// FlushVehicleAlertsFunc sends due alerts and returns how many messages were queued.
type FlushVehicleAlertsFunc func(ctx context.Context) (int, error)

func NewVehicleAlertsFlushTask() *asynq.Task {
	return asynq.NewTask(TaskVehicleAlertsFlush, []byte("{}"))
}

// WithVehicleAlerts registers the vehicle alert flush processor.
func (w *Worker) WithVehicleAlerts(fn FlushVehicleAlertsFunc) *Worker {
	w.mux.HandleFunc(TaskVehicleAlertsFlush, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		n, err := fn(ctx)
		if n > 0 {
			w.log.Info("vehicle_alerts_flush", "queued", n)
		}
		return err
	})
	return w
}

// RegisterVehicleAlertsSchedule adds the minute flush; Unique collapses the
// duplicate registration from the API and worker processes.
func RegisterVehicleAlertsSchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(
		vehicleAlertsCron,
		NewVehicleAlertsFlushTask(),
		asynq.Queue(QueueMaintenance),
		asynq.Unique(vehicleAlertsUniqueTTL),
		asynq.MaxRetry(0),
	); err != nil {
		return fmt.Errorf("queue: register vehicle alerts schedule: %w", err)
	}
	return nil
}
