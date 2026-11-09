package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

// TaskAccountAnonymize scrubs accounts whose 30-day deletion grace period
// ended (users.deletion_scheduled_on <= today, Europe/Istanbul).
const TaskAccountAnonymize = "app:account:anonymize"

const accountAnonymizeCron = "@every 1h"

const accountAnonymizeUniqueTTL = 55 * time.Minute

// AnonymizeAccountsFunc anonymizes due accounts and returns how many.
type AnonymizeAccountsFunc func(ctx context.Context) (int, error)

func NewAccountAnonymizeTask() *asynq.Task {
	return asynq.NewTask(TaskAccountAnonymize, []byte("{}"))
}

// WithAccountAnonymization registers the anonymization sweep processor.
func (w *Worker) WithAccountAnonymization(fn AnonymizeAccountsFunc) *Worker {
	w.mux.HandleFunc(TaskAccountAnonymize, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		n, err := fn(ctx)
		if n > 0 {
			w.log.Info("account_anonymize_sweep", "anonymized", n)
		}
		return err
	})
	return w
}

// RegisterAccountAnonymizeSchedule adds the hourly sweep; Unique collapses the
// duplicate registration from the API and worker processes.
func RegisterAccountAnonymizeSchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(
		accountAnonymizeCron,
		NewAccountAnonymizeTask(),
		asynq.Queue(QueueMaintenance),
		asynq.Unique(accountAnonymizeUniqueTTL),
		asynq.MaxRetry(0),
	); err != nil {
		return fmt.Errorf("queue: register account anonymize schedule: %w", err)
	}
	return nil
}
