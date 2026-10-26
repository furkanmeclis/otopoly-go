package usecase

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/google/uuid"
)

func sampleJob(status string) JobState {
	start := time.Date(2026, 10, 26, 9, 0, 0, 0, time.UTC)
	return JobState{
		UUID: uuid.MustParse("6a1f5f1e-6b5c-4c8e-9a51-1f2f3a4b5c6d"), Plate: "34 ABC 123",
		Customer: "Ahmet Yılmaz", Vehicle: "Renault Clio", Services: []string{"Yıkama", "Pasta cila"},
		Status: status, StartedAt: start, CompletedAt: start.Add(2 * time.Hour), UpdatedAt: start.Add(3 * time.Hour),
	}
}

func TestBuildJobPropsMatchesAppShape(t *testing.T) {
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	props, outcome := BuildJobProps(sampleJob("in_progress"), "Oto Kuaför", "tr-TR", now)
	if outcome != OutcomeUpdate || props.FinishedAt != 0 || props.Status != "in_progress" {
		t.Fatalf("in progress: %+v %v", props, outcome)
	}
	if props.Labels.Status != "Devam ediyor" || props.Labels.Hint != "İşlem devam ediyor" || props.Labels.Elapsed != "Geçen süre" {
		t.Fatalf("tr labels: %+v", props.Labels)
	}
	if props.Services != "Yıkama, Pasta cila" || props.StartedAt != sampleJob("").StartedAt.UnixMilli() {
		t.Fatalf("content: %+v", props)
	}
	// Same keys as JobActivityProps in src/widgets/types.ts.
	raw, _ := json.Marshal(props)
	var keys map[string]any
	_ = json.Unmarshal(raw, &keys)
	for _, k := range []string{"v", "jobId", "plate", "customer", "vehicle", "services", "status", "startedAt", "finishedAt", "org", "labels"} {
		if _, ok := keys[k]; !ok {
			t.Fatalf("missing key %s in %s", k, raw)
		}
	}

	ready, outcome := BuildJobProps(sampleJob("ready"), "Oto", "en", now)
	if outcome != OutcomeUpdate || ready.FinishedAt != sampleJob("").CompletedAt.UnixMilli() || ready.Labels.Status != "Ready for delivery" {
		t.Fatalf("ready: %+v", ready)
	}
	if _, outcome := BuildJobProps(sampleJob("delivered"), "Oto", "en", now); outcome != OutcomeEnd {
		t.Fatal("delivered ends the activity")
	}
	voided, outcome := BuildJobProps(sampleJob("voided"), "Oto", "fr", now)
	if outcome != OutcomeDismiss || voided.Status != "cancelled" || voided.Labels.Status != "İptal" {
		t.Fatalf("voided falls back to tr + cancelled: %+v", voided)
	}
}

func TestPropsHashChangesWithContent(t *testing.T) {
	now := time.Now()
	a, o := BuildJobProps(sampleJob("in_progress"), "Org", "tr", now)
	b, _ := BuildJobProps(sampleJob("in_progress"), "Org", "tr", now.Add(time.Minute))
	if propsHash(a, o) != propsHash(b, o) {
		t.Fatal("in-progress props must not depend on now")
	}
	c, _ := BuildJobProps(sampleJob("in_progress"), "Org", "en", now)
	if propsHash(a, o) == propsHash(c, o) {
		t.Fatal("language is part of what the recipient sees")
	}
}

func TestValidateActivity(t *testing.T) {
	ok := ActivityInput{Platform: "ios", ActivityID: "A1B2-C3", PushToken: strings.Repeat("ab", 32)}
	if errs := ValidateActivity(ok); len(errs) != 0 {
		t.Fatalf("valid ios: %v", errs)
	}
	if errs := ValidateActivity(ActivityInput{Platform: "ios", ActivityID: "x", PushToken: "zz"}); errs["push_token"] == "" {
		t.Fatal("ios needs a hex push token")
	}
	if errs := ValidateActivity(ActivityInput{Platform: "android", ActivityID: "x"}); errs["device_token"] != "required" {
		t.Fatal("android needs the Expo device token")
	}
	if errs := ValidateActivity(ActivityInput{Platform: "android", ActivityID: "x", DeviceToken: "ExponentPushToken[abc]"}); len(errs) != 0 {
		t.Fatalf("valid android: %v", errs)
	}
	if errs := ValidateActivity(ActivityInput{Platform: "web", ActivityID: "a b"}); errs["platform"] == "" || errs["activity_id"] == "" {
		t.Fatalf("invalid: %v", errs)
	}
	if errs := ValidateDevice(DeviceInput{DeviceToken: "ExponentPushToken[abc]", PushToStartToken: "xyz"}); errs["push_to_start_token"] == "" {
		t.Fatal("push-to-start token must be hex")
	}
}

type recordingPublisher struct{ calls []string }

func (r *recordingPublisher) Publish(_ context.Context, resource, action string, _ ...string) {
	r.calls = append(r.calls, resource+":"+action)
}

func TestPublisherSchedulesJobAndWidgetTasks(t *testing.T) {
	q := &fakeQueue{}
	svc := New(nil, nil, &fakeExpo{}, q, nil)
	now := time.Unix(1_800_000_000, 0)
	svc.SetClock(func() time.Time { return now })
	next := &recordingPublisher{}
	pub := Publisher{Next: next, Svc: svc}
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 7})
	job := uuid.NewString()

	pub.Publish(ctx, resourceevents.TenantJobs, resourceevents.ActionUpdated, job)
	pub.Publish(ctx, resourceevents.TenantJobs, resourceevents.ActionUpdated, job, "not-a-uuid")
	pub.Publish(ctx, resourceevents.TenantCustomers, resourceevents.ActionUpdated, uuid.NewString())
	pub.Publish(context.Background(), resourceevents.TenantJobs, resourceevents.ActionUpdated, job) // no org: ignored

	if len(next.calls) != 4 {
		t.Fatalf("every event is forwarded: %v", next.calls)
	}
	tasks := q.list()
	if len(tasks) != 2 {
		t.Fatalf("one coalesced job task + one widget task, got %+v", tasks)
	}
	if tasks[0].Type != queue.TaskLiveJobPush || !strings.Contains(tasks[0].ID, ":7:"+job+":") {
		t.Fatalf("job task %+v", tasks[0])
	}
	if tasks[1].Type != queue.TaskLiveWidgetsPush || tasks[1].ID != "livepush:widgets:7" {
		t.Fatalf("widget task %+v", tasks[1])
	}
	// A later debounce window gets its own task.
	now = now.Add(3 * time.Second)
	pub.Publish(ctx, resourceevents.TenantJobs, resourceevents.ActionUpdated, job)
	if got := len(q.list()); got != 3 {
		t.Fatalf("new window must enqueue again, got %d tasks", got)
	}
}
