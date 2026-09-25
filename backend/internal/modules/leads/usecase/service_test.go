package usecase

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fakeTodos struct{ reqs []TodoRequest }

func (f *fakeTodos) CreateTodoForLead(_ context.Context, r TodoRequest) (CreatedTodo, error) {
	f.reqs = append(f.reqs, r)
	return CreatedTodo{UUID: uuid.New(), Title: r.Title}, nil
}

func sp(s string) *string { return &s }

func TestFollowUpState(t *testing.T) {
	s := &Service{loc: time.UTC, now: func() time.Time { return time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC) }}
	for _, c := range []struct {
		day    int
		status string
		want   string
	}{{24, "new", "overdue"}, {25, "contacted", "today"}, {26, "quoted", "upcoming"}, {24, "won", "none"}} {
		got := s.followUpState(dateOf(2026, 9, c.day), c.status)
		if got != c.want {
			t.Errorf("day %d %s: %s want %s", c.day, c.status, got, c.want)
		}
	}
}

func TestLeadsFlow_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	scan := func(sql string, dest []any, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dest...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	var orgA, orgB, user int64
	var orgAUUID uuid.UUID
	var custA, custB, userUUID uuid.UUID
	scan(`INSERT INTO organizations (slug, name) VALUES ($1, 'A') RETURNING id, uuid`, []any{&orgA, &orgAUUID}, "la-"+suffix)
	scan(`INSERT INTO organizations (slug, name) VALUES ($1, 'B') RETURNING id`, []any{&orgB}, "lb-"+suffix)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM leads WHERE organization_id IN ($1, $2)`, orgA, orgB)
		_, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id IN ($1, $2)`, orgA, orgB)
	})
	scan(`INSERT INTO users (email, password_hash, name, surname) VALUES ($1, 'x', 'Ali', 'Satış') RETURNING id, uuid`, []any{&user, &userUUID}, "la-"+suffix+"@example.test")
	if _, err := pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, orgA, user); err != nil {
		t.Fatal(err)
	}
	scan(`INSERT INTO customers (organization_id, name, phone) VALUES ($1, 'Mehmet', '0555') RETURNING uuid`, []any{&custA}, orgA)
	scan(`INSERT INTO customers (organization_id, name) VALUES ($1, 'Diğer') RETURNING uuid`, []any{&custB}, orgB)

	svc := New(pool, q, nil)
	todos := &fakeTodos{}
	svc.SetTodoCreator(todos)
	ctxA := authctx.WithPrincipal(orgctx.WithScope(ctx, orgctx.Scope{InternalID: orgA, UUID: orgAUUID}), authctx.Principal{UserInternal: user})
	ctxB := orgctx.WithScope(ctx, orgctx.Scope{InternalID: orgB})

	if _, err := svc.Create(ctxA, CreateInput{CustomerUUID: custB}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("cross-org customer: %v", err)
	}
	if _, err := svc.Create(ctxA, CreateInput{CustomerUUID: custA, Source: "fax"}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("bad source: %v", err)
	}
	yesterday := time.Now().In(svc.loc).AddDate(0, 0, -1).Format("2006-01-02")
	lead, err := svc.Create(ctxA, CreateInput{
		CustomerUUID: custA, Source: "incoming_call", Temperature: "hot", Interest: "Seramik kaplama",
		FollowUpDate: sp(yesterday), AssigneeUUID: &userUUID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if lead.Status != "new" || lead.FollowUpState != "overdue" || lead.Assignee == nil || len(lead.Events) != 1 {
		t.Fatalf("created: %+v", lead)
	}
	if _, err := svc.Get(ctxB, lead.UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-org get: %v", err)
	}
	items, total, err := svc.List(ctxA, 20, 0, ListFilters{FollowUp: "overdue", Assignee: "me", Temperature: "hot"})
	if err != nil || total != 1 || len(items) != 1 {
		t.Fatalf("overdue filter: %d %v", total, err)
	}
	sum, _ := svc.Summary(ctxA)
	if sum.Open != 1 || sum.Overdue != 1 || sum.Hot != 1 || sum.Mine != 1 {
		t.Fatalf("summary: %+v", sum)
	}

	lead, err = svc.Patch(ctxA, lead.UUID, PatchInput{Status: sp("lost"), LostReason: sp("Fiyat yüksek"), Temperature: sp("cold"), FollowUpDate: sp("")})
	if err != nil {
		t.Fatal(err)
	}
	if lead.Status != "lost" || lead.LostReason != "Fiyat yüksek" || lead.ClosedAt == nil || lead.FollowUpDate != nil {
		t.Fatalf("patched: %+v", lead)
	}
	kinds := map[string]bool{}
	for _, e := range lead.Events {
		kinds[e.Kind] = true
	}
	for _, k := range []string{"created", "status_changed", "temperature_changed", "follow_up_changed"} {
		if !kinds[k] {
			t.Errorf("missing event %s: %+v", k, lead.Events)
		}
	}
	if _, err := svc.Patch(ctxA, lead.UUID, PatchInput{AssigneeUUID: sp(uuid.NewString())}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("non-member assignee: %v", err)
	}
	lead, err = svc.AddNote(ctxA, lead.UUID, NoteInput{Body: "Tekrar aranacak"})
	if err != nil || lead.Events[0].Kind != "note" || lead.Events[0].ActorName != "Ali Satış" {
		t.Fatalf("note: %+v %v", lead.Events, err)
	}
	res, err := svc.CreateTodo(ctxA, lead.UUID, TodoInput{})
	if err != nil || len(todos.reqs) != 1 || todos.reqs[0].CustomerUUID != custA || !strings.Contains(res.Title, "Mehmet") {
		t.Fatalf("todo: %+v %v", todos.reqs, err)
	}
	if res.Lead.Events[0].Kind != "todo_created" {
		t.Fatalf("todo event: %+v", res.Lead.Events[0])
	}
	svc.SetTodoCreator(nil)
	if _, err := svc.CreateTodo(ctxA, lead.UUID, TodoInput{}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("noop todo creator: %v", err)
	}
	if err := svc.Delete(ctxB, lead.UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-org delete: %v", err)
	}
	if err := svc.Delete(ctxA, lead.UUID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctxA, lead.UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted lead visible: %v", err)
	}
}

func dateOf(y int, m time.Month, d int) pgtype.Date {
	return pgtype.Date{Time: time.Date(y, m, d, 0, 0, 0, 0, time.UTC), Valid: true}
}
