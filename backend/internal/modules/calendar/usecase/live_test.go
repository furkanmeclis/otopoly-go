package usecase

import (
	"context"
	"sync"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type liveRec struct {
	mu  sync.Mutex
	got []string
}

func (l *liveRec) Publish(_ context.Context, resource, action string, uuids ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	id := ""
	if len(uuids) > 0 {
		id = uuids[0]
	}
	l.got = append(l.got, resource+" "+action+" "+id)
}

// eventStore keeps calendar events in memory.
type eventStore struct {
	fakeStore
	row db.CalendarEvent
}

func (e *eventStore) CreateCalendarEvent(_ context.Context, p db.CreateCalendarEventParams) (db.CalendarEvent, error) {
	e.row = db.CalendarEvent{Uuid: uuid.New(), OrganizationID: p.OrganizationID, Title: p.Title,
		StartsAt: p.StartsAt, EndsAt: p.EndsAt, AllDay: p.AllDay, Color: p.Color,
		CreatedAt: pgtype.Timestamptz{Valid: true}, UpdatedAt: pgtype.Timestamptz{Valid: true}}
	return e.row, nil
}

func (e *eventStore) GetCalendarEventByUUID(context.Context, db.GetCalendarEventByUUIDParams) (db.CalendarEvent, error) {
	return e.row, nil
}

func (e *eventStore) UpdateCalendarEvent(_ context.Context, p db.UpdateCalendarEventParams) (db.CalendarEvent, error) {
	e.row.Title, e.row.StartsAt, e.row.EndsAt, e.row.AllDay = p.Title, p.StartsAt, p.EndsAt, p.AllDay
	return e.row, nil
}

func (e *eventStore) SoftDeleteCalendarEvent(context.Context, db.SoftDeleteCalendarEventParams) (db.CalendarEvent, error) {
	return e.row, nil
}

func TestCalendarEventChangesArePublishedLive(t *testing.T) {
	st := &eventStore{fakeStore: fakeStore{called: map[string]bool{}}}
	s := New(st, nil, nil)
	ft := &fakeTodos{}
	s.SetSchedulers(ft, fakeLeads{})
	rec := &liveRec{}
	s.SetResourceEvents(rec)
	ctx := ctxWith(rbac.PermTenantCalendarRead, rbac.PermTenantCalendarWrite, rbac.PermTenantTodosRead, rbac.PermTenantTodosWrite)

	ev, err := s.CreateEvent(ctx, 1, EventInput{Title: "Fuar", AllDay: true, StartDate: sp("2026-10-08")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateEvent(ctx, 1, ev.UUID, EventInput{Title: "Fuar 2", AllDay: true, StartDate: sp("2026-10-09")}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Move(ctx, 1, MoveInput{Layer: LayerEvents, RefUUID: ev.UUID, AllDay: true, StartDate: sp("2026-10-10")}, nil); err != nil {
		t.Fatal(err)
	}
	todo := uuid.New()
	if _, err := s.Move(ctx, 1, MoveInput{Layer: LayerTodos, RefUUID: todo, AllDay: true, StartDate: sp("2026-10-10")}, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteEvent(ctx, 1, ev.UUID, nil); err != nil {
		t.Fatal(err)
	}
	id := ev.UUID.String()
	want := []string{
		resourceevents.TenantCalendar + " created " + id,
		resourceevents.TenantCalendar + " updated " + id,
		resourceevents.TenantCalendar + " updated " + id,
		resourceevents.TenantCalendar + " updated " + todo.String(),
		resourceevents.TenantCalendar + " deleted " + id,
	}
	if len(rec.got) != len(want) {
		t.Fatalf("published %v, want %v", rec.got, want)
	}
	for i := range want {
		if rec.got[i] != want[i] {
			t.Fatalf("event %d = %q, want %q", i, rec.got[i], want[i])
		}
	}
	if perm := resourceevents.TenantResources[resourceevents.TenantCalendar]; perm != rbac.PermTenantCalendarRead {
		t.Fatalf("tenant.calendar read permission = %q", perm)
	}
}
