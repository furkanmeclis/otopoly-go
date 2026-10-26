package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/hibiken/asynq"
)

// Live Activity / widget push task types (modules/livepush).
const (
	// TaskLiveJobPush sends the current state of one job to the Live
	// Activities (APNs) and Live Updates (Expo data message) tracking it.
	TaskLiveJobPush = "app:livepush:job"
	// TaskLiveWidgetsPush sends the "today" snapshot of one organization to
	// the devices showing its widgets (background / data-only push).
	TaskLiveWidgetsPush = "app:livepush:widgets"
	// TaskLiveTokensPurge deletes Live Activity tokens past their lifetime.
	TaskLiveTokensPurge = "app:livepush:purge"

	liveTokensPurgeCron = "@every 1h"

	// LiveJobDebounce coalesces bursts of edits to one job into one push.
	LiveJobDebounce = 2 * time.Second
	// LiveWidgetsDebounce is the leading delay of a widget refresh.
	LiveWidgetsDebounce = 5 * time.Second
)

// LiveJobPayload identifies the job whose activities to refresh.
type LiveJobPayload struct {
	OrganizationID int64  `json:"organization_id"`
	JobUUID        string `json:"job_uuid"`
}

// LiveWidgetsPayload identifies the organization whose widgets to refresh.
type LiveWidgetsPayload struct {
	OrganizationID int64 `json:"organization_id"`
}

// ErrDuplicate is returned when an identical task is already waiting
// (coalesced; not a failure).
var ErrDuplicate = errors.New("queue: duplicate task")

func isConflict(err error) bool {
	return errors.Is(err, asynq.ErrTaskIDConflict) || errors.Is(err, asynq.ErrDuplicateTask)
}

// LiveEnqueuer is the queue surface livepush uses.
type LiveEnqueuer interface {
	Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error)
}

// EnqueueLiveJob schedules a coalesced job push: calls for the same job
// within one debounce window fold into one task (ErrDuplicate). The window
// is part of the task id, so a change made while a push is running gets its
// own task instead of being lost.
func EnqueueLiveJob(enq LiveEnqueuer, orgID int64, jobUUID string, now time.Time) error {
	slot := now.Unix() / int64(LiveJobDebounce/time.Second)
	body, err := json.Marshal(LiveJobPayload{OrganizationID: orgID, JobUUID: jobUUID})
	if err != nil {
		return fmt.Errorf("queue: marshal live job: %w", err)
	}
	_, err = enq.Enqueue(asynq.NewTask(TaskLiveJobPush, body),
		asynq.Queue(QueueNotifications),
		asynq.TaskID("livepush:job:"+strconv.FormatInt(orgID, 10)+":"+jobUUID+":"+strconv.FormatInt(slot, 10)),
		asynq.ProcessIn(LiveJobDebounce),
		asynq.MaxRetry(3),
		asynq.Timeout(time.Minute),
	)
	if isConflict(err) {
		return ErrDuplicate
	}
	return err
}

// EnqueueLiveWidgets schedules a widget refresh for an organization after
// delay. slot keeps throttled re-schedules apart from the leading task
// ("" = leading).
func EnqueueLiveWidgets(enq LiveEnqueuer, orgID int64, delay time.Duration, slot string) error {
	body, err := json.Marshal(LiveWidgetsPayload{OrganizationID: orgID})
	if err != nil {
		return fmt.Errorf("queue: marshal live widgets: %w", err)
	}
	id := "livepush:widgets:" + strconv.FormatInt(orgID, 10)
	if slot != "" {
		id += ":" + slot
	}
	_, err = enq.Enqueue(asynq.NewTask(TaskLiveWidgetsPush, body),
		asynq.Queue(QueueNotifications),
		asynq.TaskID(id),
		asynq.ProcessIn(delay),
		asynq.MaxRetry(2),
		asynq.Timeout(time.Minute),
	)
	if isConflict(err) {
		return ErrDuplicate
	}
	return err
}

// LiveJobFunc sends job activity pushes.
type LiveJobFunc func(ctx context.Context, p LiveJobPayload) error

// LiveWidgetsFunc sends a widget refresh.
type LiveWidgetsFunc func(ctx context.Context, p LiveWidgetsPayload) error

// LivePurgeFunc deletes expired tokens and returns how many.
type LivePurgeFunc func(ctx context.Context) (int64, error)

// WithLivePush registers the Live Activity / widget push handlers.
func (w *Worker) WithLivePush(job LiveJobFunc, widgets LiveWidgetsFunc, purge LivePurgeFunc) *Worker {
	w.mux.HandleFunc(TaskLiveJobPush, func(ctx context.Context, task *asynq.Task) error {
		var p LiveJobPayload
		if err := json.Unmarshal(task.Payload(), &p); err != nil {
			return fmt.Errorf("%w: %v", asynq.SkipRetry, err)
		}
		if job == nil {
			return nil
		}
		return job(ctx, p)
	})
	w.mux.HandleFunc(TaskLiveWidgetsPush, func(ctx context.Context, task *asynq.Task) error {
		var p LiveWidgetsPayload
		if err := json.Unmarshal(task.Payload(), &p); err != nil {
			return fmt.Errorf("%w: %v", asynq.SkipRetry, err)
		}
		if widgets == nil {
			return nil
		}
		return widgets(ctx, p)
	})
	w.mux.HandleFunc(TaskLiveTokensPurge, func(ctx context.Context, _ *asynq.Task) error {
		if purge == nil {
			return nil
		}
		n, err := purge(ctx)
		if n > 0 {
			w.log.Info("livepush_tokens_purged", "count", n)
		}
		return err
	})
	return w
}

// RegisterLiveTokensPurgeSchedule adds the hourly expiry sweep.
func RegisterLiveTokensPurgeSchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(
		liveTokensPurgeCron, asynq.NewTask(TaskLiveTokensPurge, []byte("{}")),
		asynq.Queue(QueueMaintenance), asynq.MaxRetry(0),
		asynq.Timeout(2*time.Minute), asynq.Unique(55*time.Minute),
	); err != nil {
		return fmt.Errorf("queue: register live tokens purge: %w", err)
	}
	return nil
}
