package tools

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	calendarusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/calendar/usecase"
	"github.com/google/uuid"
)

type fakeCalendar struct {
	from, to string
	created  calendarusecase.EventInput
	calls    int
}

func (f *fakeCalendar) GetFeed(_ context.Context, from, to string, _ []string) (calendarusecase.Feed, error) {
	f.from, f.to = from, to
	day := from
	return calendarusecase.Feed{From: from, To: to, Items: []calendarusecase.FeedItem{
		{Layer: "jobs", Kind: "job_opened", Title: "34 ABC 123", StartsAt: time.Date(2026, 9, 24, 7, 0, 0, 0, time.UTC)},
		{Layer: "todos", Kind: "todo", Title: "Ara", AllDay: true, StartDate: &day, EndDate: &day, StartsAt: time.Date(2026, 9, 23, 21, 0, 0, 0, time.UTC)},
	}, Counts: map[string]int64{"jobs": 1, "todos": 1}}, nil
}

func (f *fakeCalendar) CreateEvent(_ context.Context, _ int64, in calendarusecase.EventInput, _ *http.Request) (calendarusecase.Event, error) {
	f.calls++
	f.created = in
	return calendarusecase.Event{UUID: uuid.New(), Title: in.Title}, nil
}

func TestListCalendarRangeIsIstanbulAndCapped(t *testing.T) {
	cal := &fakeCalendar{}
	// 22:30 UTC on the 23rd is already the 24th in Istanbul.
	env := Env{Now: time.Date(2026, 9, 23, 22, 30, 0, 0, time.UTC), Location: istanbul(t)}
	res, err := (ListCalendar{calendar: cal}).Run(context.Background(), env, json.RawMessage(`{}`))
	if err != nil || res.IsError {
		t.Fatalf("run: %v %s", err, res.Content)
	}
	if cal.from != "2026-09-24" || cal.to != "2026-10-01" {
		t.Fatalf("default range = [%s, %s)", cal.from, cal.to)
	}
	if !strings.Contains(res.Content, `"when":"2026-09-24"`) || !strings.Contains(res.Content, `"when":"2026-09-24 10:00"`) {
		t.Fatalf("content: %s", res.Content)
	}
	// All-day items sort first.
	if strings.Index(res.Content, "Ara") > strings.Index(res.Content, "34 ABC") {
		t.Fatalf("order: %s", res.Content)
	}
	res, _ = (ListCalendar{calendar: cal}).Run(context.Background(), env, json.RawMessage(`{"from":"2026-09-01","to":"2026-10-15"}`))
	if !res.IsError {
		t.Fatal("ranges over 31 days must fail")
	}
}

func TestCreateCalendarEventProposeAndRun(t *testing.T) {
	cal := &fakeCalendar{}
	tool := CreateCalendarEvent{calendar: cal}
	env := Env{Now: time.Date(2026, 9, 23, 9, 0, 0, 0, time.UTC), Location: istanbul(t)}
	p, err := tool.Propose(context.Background(), env, json.RawMessage(`{"title":" Toplantı ","date":"2026-09-25","start_time":"14:00"}`))
	if err != nil {
		t.Fatal(err)
	}
	if cal.calls != 0 {
		t.Fatal("Propose must not create")
	}
	if p.Preview.Fields[0].Value != "2026-09-25 14:00–15:00" {
		t.Fatalf("when: %+v", p.Preview.Fields)
	}
	if _, err := tool.Run(context.Background(), env, p.Input); err != nil {
		t.Fatal(err)
	}
	if cal.created.Title != "Toplantı" || cal.created.AllDay || *cal.created.StartsAt != "2026-09-25T14:00:00+03:00" || *cal.created.EndsAt != "2026-09-25T15:00:00+03:00" {
		t.Fatalf("created: %+v", cal.created)
	}
	p, err = tool.Propose(context.Background(), env, json.RawMessage(`{"title":"Fuar","date":"2026-10-08","end_date":"2026-10-10"}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tool.Run(context.Background(), env, p.Input); err != nil {
		t.Fatal(err)
	}
	if !cal.created.AllDay || *cal.created.StartDate != "2026-10-08" || *cal.created.EndDate != "2026-10-10" {
		t.Fatalf("all-day: %+v", cal.created)
	}
	for _, bad := range []string{
		`{"title":"x","date":"2026-09-25"}`,
		`{"title":"Toplantı","date":"2026-09-25","start_time":"14:00","end_time":"13:00"}`,
		`{"title":"Toplantı","date":"2026-09-25","start_time":"25:00"}`,
		`{"title":"Fuar","date":"2026-10-08","end_date":"2026-10-01"}`,
	} {
		if _, err := tool.Propose(context.Background(), env, json.RawMessage(bad)); err == nil {
			t.Errorf("%s: want error", bad)
		}
	}
	if !tool.Spec().RequiresConfirmation || tool.Spec().Kind != KindWrite {
		t.Fatal("create_calendar_event must be a confirmable write")
	}
}
