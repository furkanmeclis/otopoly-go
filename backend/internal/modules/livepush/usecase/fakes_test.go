package usecase

import (
	"context"
	"sync"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/apns"
	"github.com/hibiken/asynq"
)

// fakeAPNs records ActivityKit pushes and answers with status (200 default).
type fakeAPNs struct {
	mu     sync.Mutex
	off    bool
	status int
	reason string
	sent   []apns.LiveActivity
}

func (f *fakeAPNs) Configured() bool { return !f.off }

func (f *fakeAPNs) SendLiveActivity(_ context.Context, p apns.LiveActivity) (apns.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, p)
	st := f.status
	if st == 0 {
		st = 200
	}
	return apns.Result{Status: st, Reason: f.reason}, nil
}

func (f *fakeAPNs) pushes() []apns.LiveActivity {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]apns.LiveActivity(nil), f.sent...)
}

// fakeExpo records Expo messages; gone lists tokens answered with
// DeviceNotRegistered.
type fakeExpo struct {
	mu   sync.Mutex
	gone map[string]bool
	sent []ExpoMessage
}

func (f *fakeExpo) Send(_ context.Context, msgs []ExpoMessage) ([]ExpoTicket, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]ExpoTicket, 0, len(msgs))
	for _, m := range msgs {
		f.sent = append(f.sent, m)
		t := ExpoTicket{Status: "ok", ID: "t"}
		if f.gone[m.To] {
			t = ExpoTicket{Status: "error"}
			t.Details.Error = "DeviceNotRegistered"
		}
		out = append(out, t)
	}
	return out, nil
}

func (f *fakeExpo) messages() []ExpoMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]ExpoMessage(nil), f.sent...)
}

// fakeQueue records tasks and rejects a repeated task id like asynq does.
type fakeQueue struct {
	mu    sync.Mutex
	ids   map[string]bool
	tasks []queued
}

type queued struct {
	Type string
	ID   string
	In   any
}

func (f *fakeQueue) Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.ids == nil {
		f.ids = map[string]bool{}
	}
	q := queued{Type: task.Type()}
	for _, o := range opts {
		switch o.Type() {
		case asynq.TaskIDOpt:
			q.ID, _ = o.Value().(string)
		case asynq.ProcessInOpt:
			q.In = o.Value()
		}
	}
	if q.ID != "" && f.ids[q.ID] {
		return nil, asynq.ErrTaskIDConflict
	}
	f.ids[q.ID] = true
	f.tasks = append(f.tasks, q)
	return &asynq.TaskInfo{ID: q.ID}, nil
}

func (f *fakeQueue) list() []queued {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]queued(nil), f.tasks...)
}
