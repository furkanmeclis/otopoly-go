package reviews_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reviews"
	reviewsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reviews/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

// fakeSMS is the SMS transport behind the messaging service.
type fakeSMS struct {
	mu    sync.Mutex
	sends []string
}

func (f *fakeSMS) Available(context.Context, int64) (bool, error) { return true, nil }

func (f *fakeSMS) Deliver(_ context.Context, _ int64, phone, body, _ string) (messagingmodel.SMSDelivery, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sends = append(f.sends, phone+"|"+body)
	return messagingmodel.SMSDelivery{Provider: "netgsm", MessageID: "sms-1", Status: "accepted", Segments: 1}, nil
}

type fakeCenter struct{ got []centermodel.Notification }

func (f *fakeCenter) Dispatch(_ context.Context, n centermodel.Notification) (centermodel.Result, error) {
	f.got = append(f.got, n)
	return centermodel.Result{}, nil
}

// The job event → sweep → messaging path with the real messaging service
// (inline sends, fake SMS transport): the request is logged in
// outbound_messages with the review as subject.
func TestDeliveredJobSendsThroughMessaging(t *testing.T) {
	fx := dbtest.NewFixtures(t)
	q := db.New(fx.Pool)
	ctx := context.Background()
	org := fx.Organization()
	user := fx.User()
	cust := fx.Customer(org, "Ali Veli")
	fx.Exec(`UPDATE customers SET phone = '+905551234567' WHERE id = $1`, cust.ID)
	job := fx.Job(org, cust, fx.Vehicle(org, cust), user)
	delivered := time.Now().Add(-3 * time.Hour)
	fx.Exec(`UPDATE service_jobs SET status = 'delivered', delivered_at = $2 WHERE id = $1`, job.ID, delivered)

	sms := &fakeSMS{}
	msg := messagingusecase.New(q, nil, nil)
	msg.SetSMSChannel(sms)
	svc := reviewsusecase.New(q, reviews.NewMessagingAdapter(msg), "https://app.test", nil)
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: org.ID, UUID: org.UUID})
	if _, err := svc.UpdateSettings(octx, reviewsusecase.UpdateSettingsInput{
		Enabled: ptr(true), QuietHoursEnabled: ptr(false), Channel: ptr("sms"),
	}); err != nil {
		t.Fatal(err)
	}
	bus := events.NewBus(nil)
	reviews.RegisterEventHandlers(bus, svc, nil)
	if err := bus.Publish(octx, events.New(events.JobsDelivered).WithPayload(map[string]any{"job_uuid": job.UUID.String()})); err != nil {
		t.Fatal(err)
	}
	if n, err := svc.ProcessDue(ctx); err != nil || n != 1 {
		t.Fatalf("sweep sent %d: %v", n, err)
	}
	if len(sms.sends) != 1 {
		t.Fatalf("sms sends %v", sms.sends)
	}
	var subject uuid.UUID
	var status, event, channel, body string
	if err := fx.Pool.QueryRow(ctx, `SELECT subject_uuid, status, event_type, channel, body FROM outbound_messages
		WHERE organization_id = $1 AND subject_type = 'review_request'`, org.ID).Scan(&subject, &status, &event, &channel, &body); err != nil {
		t.Fatalf("outbound log: %v", err)
	}
	var reviewUUID uuid.UUID
	var token string
	if err := fx.Pool.QueryRow(ctx, `SELECT uuid, token FROM review_requests WHERE job_id = $1`, job.ID).Scan(&reviewUUID, &token); err != nil {
		t.Fatal(err)
	}
	if subject != reviewUUID || status != "sent" || event != reviewsusecase.EventRequest || channel != "sms" {
		t.Fatalf("outbound %s %s %s %s", subject, status, event, channel)
	}
	if want := "https://app.test/r/" + token; !contains(body, want) || !contains(body, "Ali Veli") {
		t.Fatalf("body %q", body)
	}
	// Cancelling afterwards does not touch a sent request.
	if err := bus.Publish(octx, events.New(events.JobsCancelled).WithPayload(map[string]any{"job_uuid": job.UUID.String()})); err != nil {
		t.Fatal(err)
	}
	var st string
	_ = fx.Pool.QueryRow(ctx, `SELECT status FROM review_requests WHERE job_id = $1`, job.ID).Scan(&st)
	if st != reviewsusecase.StatusSent {
		t.Fatalf("status after cancel event %s", st)
	}
}

func TestCenterNotifier(t *testing.T) {
	c := &fakeCenter{}
	id := uuid.New()
	err := reviews.NewCenterNotifier(c).LowScore(context.Background(), reviewsusecase.TeamNotice{
		OrgID: 3, UserID: 7, ReviewID: 9, ReviewUUID: id, CustomerName: "Ali", Score: 2, ActionURL: "/t/x/reviews/" + id.String(),
	})
	if err != nil || len(c.got) != 1 {
		t.Fatalf("dispatch %v %v", c.got, err)
	}
	n := c.got[0]
	if n.Kind != reviewsusecase.KindLowScore || n.Recipient.UserID != 7 || n.Vars["score"] != "2" || n.SubjectID != 9 || n.ActionURL == "" {
		t.Fatalf("notification %+v", n)
	}
}

func ptr[T any](v T) *T { return &v }

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
