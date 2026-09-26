package usecase_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
)

func TestPreparerAndSentHook_DB(t *testing.T) {
	f := setup(t)
	msg := &fakeMessenger{}
	svc := f.service(&fakeInbox{}, msg)
	now := time.Now().UTC()
	svc.SetClock(func() time.Time { return now })

	var events []usecase.SentEvent
	svc.RegisterSentHook("quote_reminder", func(_ context.Context, ev usecase.SentEvent) { events = append(events, ev) })
	svc.RegisterPreparer("quote_reminder", func(_ context.Context, orgID, id int64) (usecase.Prepared, error) {
		if orgID != f.orgID {
			t.Errorf("preparer org = %d", orgID)
		}
		if id == 2 {
			return usecase.Prepared{Skip: true}, nil
		}
		return usecase.Prepared{Vars: map[string]string{"total_amount": "999,00 TRY"}}, nil
	})
	sched := func(id int64) model.Result {
		t.Helper()
		r, err := svc.Schedule(f.ctx, model.ScheduledNotification{
			Notification: model.Notification{
				Kind: "quote.reminder", SubjectType: "quote_reminder", SubjectID: id,
				Recipient: model.Recipient{CustomerID: f.customerID}, Channels: []string{"whatsapp"},
				Vars: map[string]string{"quote_number": "TKL-9", "total_amount": "1,00 TRY"},
			},
			FireAt: now.Add(-time.Minute),
		})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	ok, skipped := sched(1), sched(2)
	if err := svc.ProcessDue(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(msg.sends) != 1 || !strings.Contains(msg.sends[0].Body, "999,00 TRY") {
		t.Fatalf("preparer vars must override stored vars: %+v", msg.sends)
	}
	if st, _, _ := f.status(t, skipped.UUID); st != "cancelled" {
		t.Fatalf("skipped status %s", st)
	}
	if len(events) != 2 {
		t.Fatalf("hook events = %+v", events)
	}
	for _, ev := range events {
		switch ev.UUID {
		case ok.UUID:
			if ev.Status != "sent" || ev.Skipped || len(ev.Delivered) != 1 || ev.SubjectID != 1 || ev.OrgID != f.orgID {
				t.Fatalf("sent event = %+v", ev)
			}
		case skipped.UUID:
			if ev.Status != "cancelled" || !ev.Skipped {
				t.Fatalf("skipped event = %+v", ev)
			}
		default:
			t.Fatalf("unexpected event %+v", ev)
		}
	}
}
