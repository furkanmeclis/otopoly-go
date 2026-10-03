package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/config"
	"github.com/hibiken/asynq"
)

// Notification center task types / queues.
const (
	// TaskMessagingSend delivers one queued outbound WhatsApp/SMS row. It is
	// consumed only by the API process, which owns the WhatsApp sessions.
	TaskMessagingSend = "app:messaging:send"
	// TaskReminderSweep claims and dispatches due scheduled notifications.
	TaskReminderSweep = "app:notifications:reminder_sweep"

	QueueMessaging = "messaging"

	// MessagingSendMaxRetry bounds WhatsApp/SMS retries (exponential backoff).
	MessagingSendMaxRetry = 5

	reminderSweepCron = "@every 1m"
)

// MessagingSendPayload identifies an outbound_messages row.
type MessagingSendPayload struct {
	OutboundMessageID int64 `json:"outbound_message_id"`
}

// NewMessagingSendTask builds a messaging send task.
func NewMessagingSendTask(outboundID int64) (*asynq.Task, error) {
	body, err := json.Marshal(MessagingSendPayload{OutboundMessageID: outboundID})
	if err != nil {
		return nil, fmt.Errorf("queue: marshal messaging send: %w", err)
	}
	return asynq.NewTask(TaskMessagingSend, body), nil
}

// ParseMessagingSendPayload decodes a messaging send payload.
func ParseMessagingSendPayload(data []byte) (MessagingSendPayload, error) {
	var p MessagingSendPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return MessagingSendPayload{}, fmt.Errorf("queue: unmarshal messaging send: %w", err)
	}
	return p, nil
}

// MessagingSendOptions are the enqueue options for a messaging send.
func MessagingSendOptions() []asynq.Option {
	return []asynq.Option{
		asynq.Queue(QueueMessaging),
		asynq.MaxRetry(MessagingSendMaxRetry),
		asynq.Timeout(2 * time.Minute),
	}
}

// NewReminderSweepTask builds the periodic sweep task.
func NewReminderSweepTask() *asynq.Task {
	return asynq.NewTask(TaskReminderSweep, []byte("{}"))
}

// RegisterReminderSweep adds the every-minute sweep to a scheduler. Unique()
// collapses duplicate registrations (API in-process worker + worker service);
// the DB claim (FOR UPDATE SKIP LOCKED) is the real concurrency guard.
func RegisterReminderSweep(scheduler *asynq.Scheduler, log *slog.Logger) error {
	if _, err := scheduler.Register(reminderSweepCron, NewReminderSweepTask(),
		asynq.Queue(QueueMaintenance), asynq.MaxRetry(0),
		asynq.Timeout(55*time.Second), asynq.Unique(50*time.Second),
	); err != nil {
		return fmt.Errorf("queue: register reminder sweep: %w", err)
	}
	if log != nil {
		log.Info("queue_reminder_sweep_registered", "cron", reminderSweepCron)
	}
	return nil
}

// StartReminderScheduler creates a scheduler with only the reminder sweep
// (used by the API process when it runs the queue worker in-process).
func StartReminderScheduler(cfg config.Config, log *slog.Logger) (*asynq.Scheduler, error) {
	scheduler := asynq.NewScheduler(RedisOpt(cfg.Redis), nil)
	if err := RegisterReminderSweep(scheduler, log); err != nil {
		return nil, err
	}
	return scheduler, nil
}

// ProcessReminderSweepFunc dispatches due scheduled notifications.
type ProcessReminderSweepFunc func(ctx context.Context) error

// WithReminderSweep registers the sweep processor.
func (w *Worker) WithReminderSweep(fn ProcessReminderSweepFunc) *Worker {
	w.mux.HandleFunc(TaskReminderSweep, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		return fn(ctx)
	})
	return w
}

// ProcessMessagingSendFunc delivers one outbound row. final is true on the
// last attempt so the row can be marked failed instead of re-queued.
type ProcessMessagingSendFunc func(ctx context.Context, outboundID int64, final bool) error

// MessagingWorker consumes only the messaging queue (API process).
type MessagingWorker struct {
	server *asynq.Server
	mux    *asynq.ServeMux
	log    *slog.Logger
}

// NewMessagingWorker builds the API-side consumer for WhatsApp/SMS sends.
func NewMessagingWorker(cfg config.Config, log *slog.Logger, fn ProcessMessagingSendFunc) *MessagingWorker {
	if log == nil {
		log = slog.Default()
	}
	server := asynq.NewServer(RedisOpt(cfg.Redis), asynq.Config{
		Concurrency: 4,
		Queues:      map[string]int{QueueMessaging: 1},
		RetryDelayFunc: func(n int, _ error, _ *asynq.Task) time.Duration {
			// 30s, 1m, 2m, 4m, 8m …
			return time.Duration(30<<min(n, 6)) * time.Second
		},
		ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
			log.Warn("messaging_send_attempt_failed", "type", task.Type(), "error", err)
			reportTaskFailure(ctx, task, err)
		}),
	})
	mux := asynq.NewServeMux()
	mux.HandleFunc(TaskMessagingSend, func(ctx context.Context, task *asynq.Task) error {
		p, err := ParseMessagingSendPayload(task.Payload())
		if err != nil {
			return fmt.Errorf("%w: %v", asynq.SkipRetry, err)
		}
		retried, _ := asynq.GetRetryCount(ctx)
		maxRetry, ok := asynq.GetMaxRetry(ctx)
		final := !ok || retried >= maxRetry
		return fn(ctx, p.OutboundMessageID, final)
	})
	return &MessagingWorker{server: server, mux: mux, log: log}
}

// Start runs the consumer in the background.
func (m *MessagingWorker) Start() error {
	if m == nil {
		return nil
	}
	m.log.Info("queue_messaging_worker_start")
	return m.server.Start(m.mux)
}

// Shutdown stops the consumer.
func (m *MessagingWorker) Shutdown() {
	if m != nil && m.server != nil {
		m.server.Shutdown()
	}
}
