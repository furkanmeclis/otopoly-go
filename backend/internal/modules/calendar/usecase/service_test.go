package usecase

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	leadsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/leads/usecase"
	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

func sp(s string) *string { return &s }

func TestParseEvent(t *testing.T) {
	s := New(nil, nil, nil)
	f, err := s.parseEvent(EventInput{Title: " Fuar ", AllDay: true, StartDate: sp("2026-10-08"), EndDate: sp("2026-10-10")})
	if err != nil {
		t.Fatal(err)
	}
	if f.title != "Fuar" || f.color != "blue" || f.end.Sub(f.start) != 72*time.Hour {
		t.Fatalf("all-day: %+v", f)
	}
	if f.start.Location() != s.loc || f.start.Hour() != 0 {
		t.Fatalf("all-day must start at business midnight: %v", f.start)
	}
	bad := []EventInput{
		{Title: "", AllDay: true, StartDate: sp("2026-10-08")},
		{Title: "x", AllDay: true},
		{Title: "x", AllDay: true, StartDate: sp("2026-10-08"), EndDate: sp("2026-10-07")},
		{Title: "x", StartsAt: sp("2026-10-08T10:00:00Z"), EndsAt: sp("2026-10-08T10:00:00Z")},
		{Title: "x", StartsAt: sp("2026-10-08T10:00:00Z"), EndsAt: sp("2026-12-08T10:00:00Z")},
		{Title: "x", StartsAt: sp("yarın"), EndsAt: sp("2026-10-08T10:00:00Z")},
		{Title: "x", Color: "black", StartsAt: sp("2026-10-08T10:00:00Z"), EndsAt: sp("2026-10-08T11:00:00Z")},
	}
	for i, in := range bad {
		if _, err := s.parseEvent(in); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("case %d: want invalid request, got %v", i, err)
		}
	}
	if _, err := s.parseEvent(EventInput{Title: "x", Color: "rose", StartsAt: sp("2026-10-08T10:00:00+03:00"), EndsAt: sp("2026-10-08T11:30:00+03:00")}); err != nil {
		t.Fatal(err)
	}
}

func TestParseLayers(t *testing.T) {
	if l, err := ParseLayers(""); err != nil || len(l) != len(Layers) {
		t.Fatalf("empty = all: %v %v", l, err)
	}
	if l, err := ParseLayers("jobs, todos,jobs"); err != nil || len(l) != 2 {
		t.Fatalf("dedupe: %v %v", l, err)
	}
	if _, err := ParseLayers("jobs,salaries"); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unknown layer must fail, got %v", err)
	}
	for _, l := range Layers {
		if _, ok := access[l]; !ok {
			t.Fatalf("layer %q has no access rule", l)
		}
	}
}

func TestParseRange(t *testing.T) {
	s := New(nil, nil, nil)
	if _, _, err := s.ParseRange("2026-10-01", "2026-12-02"); err != nil {
		t.Fatalf("62 days must pass: %v", err)
	}
	for _, c := range [][2]string{{"2026-10-01", "2026-12-03"}, {"2026-10-02", "2026-10-01"}, {"x", "2026-10-01"}} {
		if _, _, err := s.ParseRange(c[0], c[1]); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("%v: want invalid, got %v", c, err)
		}
	}
}

// fakeStore records which layers were queried.
type fakeStore struct {
	Store
	called map[string]bool
	events []db.CalendarEvent
}

func (f *fakeStore) mark(k string) { f.called[k] = true }

func (f *fakeStore) ListCalendarEventsInRange(_ context.Context, _ db.ListCalendarEventsInRangeParams) ([]db.CalendarEvent, error) {
	f.mark(LayerEvents)
	return f.events, nil
}
func (f *fakeStore) CalendarJobsOpened(context.Context, db.CalendarJobsOpenedParams) ([]db.CalendarJobsOpenedRow, error) {
	f.mark(LayerJobs)
	return nil, nil
}
func (f *fakeStore) CalendarJobsDelivered(context.Context, db.CalendarJobsDeliveredParams) ([]db.CalendarJobsDeliveredRow, error) {
	f.mark(LayerDeliveries)
	return nil, nil
}
func (f *fakeStore) CalendarTodos(context.Context, db.CalendarTodosParams) ([]db.CalendarTodosRow, error) {
	f.mark(LayerTodos)
	return nil, nil
}
func (f *fakeStore) CalendarFinanceDaily(context.Context, db.CalendarFinanceDailyParams) ([]db.CalendarFinanceDailyRow, error) {
	f.mark(LayerFinance)
	return nil, nil
}

func ctxWith(perms ...string) context.Context {
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 7})
	return authctx.WithPrincipal(ctx, authctx.Principal{UserInternal: 1, Permissions: perms})
}

func TestFeedFiltersLayersByPermission(t *testing.T) {
	st := &fakeStore{called: map[string]bool{}}
	s := New(st, nil, nil)
	ctx := ctxWith(rbac.PermTenantCalendarRead, rbac.PermTenantJobsRead)
	feed, err := s.GetFeed(ctx, "2026-10-01", "2026-11-01", Layers)
	if err != nil {
		t.Fatal(err)
	}
	if !st.called[LayerEvents] || !st.called[LayerJobs] || !st.called[LayerDeliveries] {
		t.Fatalf("permitted layers not loaded: %v", st.called)
	}
	if st.called[LayerFinance] || st.called[LayerTodos] {
		t.Fatalf("finance / todos must be skipped without permission: %v", st.called)
	}
	keys := map[string]LayerInfo{}
	for _, l := range feed.Layers {
		keys[l.Key] = l
	}
	if _, ok := keys[LayerFinance]; ok || len(keys) != 3 {
		t.Fatalf("layers: %+v", feed.Layers)
	}
	if keys[LayerEvents].Movable {
		t.Fatal("events are not movable without calendar.write")
	}
}

type fakeTodos struct{ got todosusecase.PatchInput }

func (f *fakeTodos) Patch(_ context.Context, id uuid.UUID, in todosusecase.PatchInput) (todosusecase.Todo, error) {
	f.got = in
	return todosusecase.Todo{UUID: id, Title: "Ara", Status: "open"}, nil
}

type fakeLeads struct{}

func (fakeLeads) Patch(context.Context, uuid.UUID, leadsusecase.PatchInput) (leadsusecase.Detail, error) {
	return leadsusecase.Detail{}, nil
}

func TestMoveTodoUsesBusinessTime(t *testing.T) {
	st := &fakeStore{called: map[string]bool{}}
	s := New(st, nil, nil)
	ft := &fakeTodos{}
	s.SetSchedulers(ft, fakeLeads{})
	ctx := ctxWith(rbac.PermTenantCalendarRead, rbac.PermTenantTodosRead, rbac.PermTenantTodosWrite)
	id := uuid.New()
	// 21:30 UTC is 00:30 the next day in Istanbul.
	item, err := s.Move(ctx, 1, MoveInput{Layer: LayerTodos, RefUUID: id, StartsAt: sp("2026-10-08T21:30:00Z")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if *ft.got.DueDate != "2026-10-09" || *ft.got.DueTime != "00:30" {
		t.Fatalf("patch: %s %s", *ft.got.DueDate, *ft.got.DueTime)
	}
	if item.AllDay || !item.Movable || item.RefKind != "todo" {
		t.Fatalf("item: %+v", item)
	}
	if _, err := s.Move(ctx, 1, MoveInput{Layer: LayerTodos, RefUUID: id, AllDay: true, StartDate: sp("2026-10-10")}, nil); err != nil {
		t.Fatal(err)
	}
	if *ft.got.DueDate != "2026-10-10" || *ft.got.DueTime != "" {
		t.Fatalf("all-day must clear the time: %+v", ft.got)
	}
	// Leads need leads.write; jobs are never movable.
	if _, err := s.Move(ctx, 1, MoveInput{Layer: LayerLeads, RefUUID: id, StartDate: sp("2026-10-10")}, nil); !errors.Is(err, ErrForbidden) {
		t.Fatalf("lead without permission: %v", err)
	}
	if _, err := s.Move(ctx, 1, MoveInput{Layer: LayerJobs, RefUUID: id, StartDate: sp("2026-10-10")}, nil); !errors.Is(err, ErrForbidden) {
		t.Fatalf("jobs: %v", err)
	}
}
