package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/apns"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/google/uuid"
)

type liveFixture struct {
	fx       *dbtest.Fixtures
	q        *db.Queries
	svc      *Service
	apns     *fakeAPNs
	expo     *fakeExpo
	queue    *fakeQueue
	org      dbtest.Row
	user     dbtest.Row
	job      dbtest.Row
	ctx      context.Context
	devToken string
}

const iosToken = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"

func setupLive(t *testing.T) *liveFixture {
	t.Helper()
	fx := dbtest.NewFixtures(t)
	f := &liveFixture{fx: fx, q: db.New(fx.Pool), apns: &fakeAPNs{}, expo: &fakeExpo{gone: map[string]bool{}}, queue: &fakeQueue{}}
	f.org = fx.Organization()
	f.user = fx.User()
	fx.Exec(`UPDATE users SET locale = 'en' WHERE id = $1`, f.user.ID)
	fx.Exec(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'staff')`, f.org.ID, f.user.ID)
	fx.Exec(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE slug = 'organization_user'`, f.user.ID)
	customer := fx.Customer(f.org, "Ahmet Yılmaz")
	vehicle := fx.Vehicle(f.org, customer)
	f.job = fx.Job(f.org, customer, vehicle, f.user)
	f.devToken = "ExponentPushToken[" + uuid.NewString()[:12] + "]"
	fx.Exec(`INSERT INTO push_devices (user_id, token, platform) VALUES ($1, $2, 'android')`, f.user.ID, f.devToken)
	f.svc = New(f.q, f.apns, f.expo, f.queue, nil)
	f.ctx = orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: f.org.ID, UUID: f.org.UUID})
	return f
}

func (f *liveFixture) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := f.fx.Pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRegisterActivityIsolation_DB(t *testing.T) {
	f := setupLive(t)
	in := ActivityInput{Platform: "ios", ActivityID: "act-1", PushToken: strings.ToUpper(iosToken)}
	a, err := f.svc.RegisterActivity(f.ctx, f.user.ID, f.job.UUID, in)
	if err != nil {
		t.Fatal(err)
	}
	if a.JobUUID != f.job.UUID || !a.RemoteUpdates || a.ExpiresAt.Before(time.Now().Add(11*time.Hour)) {
		t.Fatalf("activity %+v", a)
	}
	// Idempotent: token rotation updates the same row.
	in.PushToken = strings.Repeat("ab", 32)
	if _, err := f.svc.RegisterActivity(f.ctx, f.user.ID, f.job.UUID, in); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM live_activity_tokens WHERE job_id = $1`, f.job.ID); n != 1 {
		t.Fatalf("rows %d", n)
	}

	// Another organization's job answers not found; its activity id cannot be hijacked.
	other := f.fx.Organization()
	f.fx.Exec(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'staff')`, other.ID, f.user.ID)
	otherCtx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: other.ID, UUID: other.UUID})
	if _, err := f.svc.RegisterActivity(otherCtx, f.user.ID, f.job.UUID, in); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign job must be 404, got %v", err)
	}
	oc := f.fx.Customer(other, "Other")
	otherJob := f.fx.Job(other, oc, f.fx.Vehicle(other, oc), f.user)
	if _, err := f.svc.RegisterActivity(otherCtx, f.user.ID, otherJob.UUID, in); !errors.Is(err, ErrNotFound) {
		t.Fatalf("activity id of another organization must not move, got %v", err)
	}

	// Android needs the caller's own push device.
	stranger := f.fx.User()
	androidIn := ActivityInput{Platform: "android", ActivityID: f.job.UUID.String(), DeviceToken: f.devToken}
	if _, err := f.svc.RegisterActivity(f.ctx, stranger.ID, f.job.UUID, androidIn); !errors.Is(err, ErrNotFound) {
		t.Fatalf("someone else's device must be 404, got %v", err)
	}
	if _, err := f.svc.RegisterActivity(f.ctx, f.user.ID, f.job.UUID, androidIn); err != nil {
		t.Fatal(err)
	}

	if err := f.svc.UnregisterActivity(f.ctx, f.user.ID, f.job.UUID, "act-1", ""); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM live_activity_tokens WHERE job_id = $1 AND platform = 'ios'`, f.job.ID); n != 0 {
		t.Fatalf("ios row left: %d", n)
	}
	if n := f.count(t, `SELECT count(*) FROM live_activity_tokens WHERE job_id = $1 AND platform = 'android'`, f.job.ID); n != 1 {
		t.Fatalf("android row must stay: %d", n)
	}
}

func TestProcessJobPushesIOSAndAndroid_DB(t *testing.T) {
	f := setupLive(t)
	if _, err := f.svc.RegisterActivity(f.ctx, f.user.ID, f.job.UUID, ActivityInput{Platform: "ios", ActivityID: "act-1", PushToken: iosToken}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.RegisterActivity(f.ctx, f.user.ID, f.job.UUID, ActivityInput{Platform: "android", ActivityID: f.job.UUID.String(), DeviceToken: f.devToken}); err != nil {
		t.Fatal(err)
	}
	p := queue.LiveJobPayload{OrganizationID: f.org.ID, JobUUID: f.job.UUID.String()}
	if err := f.svc.ProcessJob(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	pushes := f.apns.pushes()
	if len(pushes) != 1 || pushes[0].Event != apns.EventUpdate || pushes[0].Token != iosToken || pushes[0].HighPriority {
		t.Fatalf("ios push %+v", pushes)
	}
	cs := pushes[0].ContentState.(ContentState)
	var props JobActivityProps
	if err := json.Unmarshal([]byte(cs.Props), &props); err != nil || cs.Name != ActivityName {
		t.Fatalf("content-state %+v %v", cs, err)
	}
	if props.Status != "in_progress" || props.Labels.Status != "In progress" || props.JobID != f.job.UUID.String() {
		t.Fatalf("props (user locale en) %+v", props)
	}
	msgs := f.expo.messages()
	if len(msgs) != 1 || msgs[0].To != f.devToken || msgs[0].Data["kind"] != KindLiveJob || msgs[0].Priority != "high" {
		t.Fatalf("android message %+v", msgs)
	}

	// Nothing changed: no second push.
	if err := f.svc.ProcessJob(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if len(f.apns.pushes()) != 1 || len(f.expo.messages()) != 1 {
		t.Fatal("unchanged state must not be pushed again")
	}

	// Ready: high priority with an alert.
	f.fx.Exec(`UPDATE service_jobs SET status = 'ready', completed_at = NOW() WHERE id = $1`, f.job.ID)
	if err := f.svc.ProcessJob(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	ready := f.apns.pushes()[1]
	if !ready.HighPriority || ready.Alert == nil || ready.Alert.Body != "Car is ready for pickup" {
		t.Fatalf("ready push %+v", ready)
	}

	// Delivered: end, token rows removed afterwards.
	f.fx.Exec(`UPDATE service_jobs SET status = 'delivered', delivered_at = NOW() WHERE id = $1`, f.job.ID)
	if err := f.svc.ProcessJob(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	end := f.apns.pushes()[2]
	if end.Event != apns.EventEnd || end.DismissalDate.IsZero() {
		t.Fatalf("end push %+v", end)
	}
	last := f.expo.messages()[2]
	if last.Data["end"] != "default" {
		t.Fatalf("android end %+v", last.Data)
	}
	if n := f.count(t, `SELECT count(*) FROM live_activity_tokens WHERE job_id = $1`, f.job.ID); n != 0 {
		t.Fatalf("ended activities must be forgotten, %d left", n)
	}
}

func TestProcessJobDropsInvalidAndForeignRecipients_DB(t *testing.T) {
	f := setupLive(t)
	if _, err := f.svc.RegisterActivity(f.ctx, f.user.ID, f.job.UUID, ActivityInput{Platform: "ios", ActivityID: "act-1", PushToken: iosToken}); err != nil {
		t.Fatal(err)
	}
	p := queue.LiveJobPayload{OrganizationID: f.org.ID, JobUUID: f.job.UUID.String()}

	// APNs says the token is gone → row deleted, no retry.
	f.apns.status, f.apns.reason = 410, "Unregistered"
	if err := f.svc.ProcessJob(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM live_activity_tokens`); n != 0 {
		t.Fatalf("invalid token kept: %d", n)
	}

	// A member removed from the organization gets nothing.
	f.apns.status, f.apns.reason = 0, ""
	if _, err := f.svc.RegisterActivity(f.ctx, f.user.ID, f.job.UUID, ActivityInput{Platform: "ios", ActivityID: "act-2", PushToken: iosToken}); err != nil {
		t.Fatal(err)
	}
	f.fx.Exec(`DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`, f.org.ID, f.user.ID)
	before := len(f.apns.pushes())
	if err := f.svc.ProcessJob(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if len(f.apns.pushes()) != before {
		t.Fatal("removed member must not receive pushes")
	}

	// Retryable APNs answers fail the task (asynq retries).
	f.fx.Exec(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'staff')`, f.org.ID, f.user.ID)
	f.apns.status = 503
	if err := f.svc.ProcessJob(context.Background(), p); !errors.Is(err, errRetry) {
		t.Fatalf("503 must retry, got %v", err)
	}

	// No APNs credentials: iOS skipped silently.
	f.apns.off, f.apns.status = true, 0
	before = len(f.apns.pushes())
	if err := f.svc.ProcessJob(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if len(f.apns.pushes()) != before {
		t.Fatal("unconfigured APNs must not be called")
	}
}

func TestWidgetsSnapshotAndThrottle_DB(t *testing.T) {
	f := setupLive(t)
	now := time.Now()
	f.svc.SetClock(func() time.Time { return now })
	if _, err := f.svc.RegisterDevice(f.ctx, f.user.ID, DeviceInput{DeviceToken: f.devToken, PushToStartToken: iosToken}); err != nil {
		t.Fatal(err)
	}
	f.fx.Exec(`UPDATE service_jobs SET plate = '34 ABC 123', customer_name = 'Ahmet', started_at = NOW() WHERE id = $1`, f.job.ID)

	p := queue.LiveWidgetsPayload{OrganizationID: f.org.ID}
	if err := f.svc.ProcessWidgets(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	msgs := f.expo.messages()
	if len(msgs) != 1 || msgs[0].Data["kind"] != KindWidgetsRefresh || msgs[0].Data["org"] != f.org.UUID.String() {
		t.Fatalf("widget push %+v", msgs)
	}
	snap := msgs[0].Data["snapshot"].(WidgetSnapshot)
	if snap.Counts.InProgress != 1 || len(snap.Queue) != 1 || snap.Queue[0].Plate != "34 ABC 123" || snap.Queue[0].Status != "in_progress" {
		t.Fatalf("snapshot %+v", snap)
	}
	raw, _ := json.Marshal(msgs[0])
	if len(raw) > 4000 {
		t.Fatalf("payload too big: %d", len(raw))
	}

	// Within a minute: no push, one trailing task instead (twice → coalesced).
	now = now.Add(20 * time.Second)
	_ = f.svc.ProcessWidgets(context.Background(), p)
	_ = f.svc.ProcessWidgets(context.Background(), p)
	if len(f.expo.messages()) != 1 {
		t.Fatal("throttled refresh must not send")
	}
	if tasks := f.queue.list(); len(tasks) != 1 || tasks[0].Type != queue.TaskLiveWidgetsPush {
		t.Fatalf("trailing task %+v", tasks)
	}

	// Another organization's devices never receive this snapshot.
	if err := f.svc.UnregisterDevice(f.ctx, f.user.ID, f.devToken); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Minute)
	if err := f.svc.ProcessWidgets(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if len(f.expo.messages()) != 1 {
		t.Fatal("unregistered device must not get widget pushes")
	}
}

func TestWidgetsDisableGoneDevice_DB(t *testing.T) {
	f := setupLive(t)
	if _, err := f.svc.RegisterDevice(f.ctx, f.user.ID, DeviceInput{DeviceToken: f.devToken}); err != nil {
		t.Fatal(err)
	}
	f.expo.gone[f.devToken] = true
	if err := f.svc.ProcessWidgets(context.Background(), queue.LiveWidgetsPayload{OrganizationID: f.org.ID}); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM push_devices WHERE token = $1 AND disabled_at IS NOT NULL`, f.devToken); n != 1 {
		t.Fatal("DeviceNotRegistered must disable the push device")
	}
	if n, err := f.svc.PurgeExpired(context.Background()); err != nil || n != 0 {
		t.Fatalf("purge %d %v", n, err)
	}
}
