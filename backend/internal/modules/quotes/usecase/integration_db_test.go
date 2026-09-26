package usecase

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeNotifier struct{ events []QuoteEvent }

func (f *fakeNotifier) QuoteChanged(_ context.Context, ev QuoteEvent) { f.events = append(f.events, ev) }

func TestQuoteIntegrationSeams_DB(t *testing.T) {
	f := setup(t)
	n := &fakeNotifier{}
	f.svc.SetNotifier(n)
	in := f.basicInput()
	in.ValidUntil = sp(time.Now().In(f.svc.loc).AddDate(0, 0, 10).Format("2006-01-02"))
	d, err := f.svc.Create(f.ctxA, in)
	if err != nil {
		t.Fatal(err)
	}
	res, err := f.svc.Send(f.ctxA, d.UUID, SendInput{Reminders: []ReminderInput{{Kind: ReminderBefore3d}}})
	if err != nil || res.Delivery.Status != "sent" {
		t.Fatalf("send: %+v %v", res.Delivery, err)
	}
	if len(n.events) != 2 || n.events[0].Kind != "created" || n.events[1].Kind != "sent" || n.events[1].Status != StatusSent ||
		n.events[1].ValidUntil == nil || n.events[0].ActorID == 0 {
		t.Fatalf("notifier events: %+v", n.events)
	}
	m := f.messenger.msgs[0]
	if m.DeliveryUUID != res.Delivery.UUID || m.Attempt != 1 || m.CustomerID == 0 {
		t.Fatalf("delivery identity not passed to messenger: %+v", m)
	}

	// A late WhatsApp failure flips the delivery (other orgs cannot touch it).
	if err := f.svc.AsyncSendFailed(context.Background(), f.orgB, "wa-1", "x"); err != nil {
		t.Fatal(err)
	}
	if got, _ := f.svc.Get(f.ctxA, d.UUID); got.Deliveries[0].Status != "sent" {
		t.Fatal("cross-org async failure must be ignored")
	}
	if err := f.svc.AsyncSendFailed(context.Background(), f.orgA, "wa-1", "session lost"); err != nil {
		t.Fatal(err)
	}
	got, _ := f.svc.Get(f.ctxA, d.UUID)
	if got.Deliveries[0].Status != "failed" || got.Deliveries[0].Error != "session lost" {
		t.Fatalf("async failure: %+v", got.Deliveries[0])
	}

	// Reminder: id → uuid is org-scoped; a failure after hand-off is recorded.
	rem := got.Reminders[0]
	var remID int64
	_ = f.pool.QueryRow(context.Background(), `SELECT id FROM quote_reminders WHERE uuid = $1`, rem.UUID).Scan(&remID)
	if _, err := f.svc.ReminderUUID(context.Background(), f.orgB, remID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-org reminder lookup: %v", err)
	}
	id, err := f.svc.ReminderUUID(context.Background(), f.orgA, remID)
	if err != nil || id != rem.UUID {
		t.Fatalf("reminder uuid: %v %v", id, err)
	}
	if err := f.svc.CompleteReminder(context.Background(), id, nil); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.AsyncSendFailed(context.Background(), f.orgA, "sched-"+ReminderBefore3d, "phone not on whatsapp"); err != nil {
		t.Fatal(err)
	}
	got, _ = f.svc.Get(f.ctxA, d.UUID)
	if got.Reminders[0].Status != "failed" {
		t.Fatalf("reminder after async failure: %+v", got.Reminders[0])
	}

	// Status changes reach the notifier (team expiry notice is cancelled).
	if _, err := f.svc.SetStatus(f.ctxA, d.UUID, StatusInput{Status: StatusAccepted}); err != nil {
		t.Fatal(err)
	}
	if n.events[len(n.events)-1].Kind != "status" || n.events[len(n.events)-1].Status != StatusAccepted {
		t.Fatalf("status event: %+v", n.events[len(n.events)-1])
	}
}
