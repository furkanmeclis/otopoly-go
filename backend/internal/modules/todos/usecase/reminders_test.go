package usecase

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	notifmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/model"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCleanOffsets(t *testing.T) {
	got, err := CleanOffsets([]int{0, 60, 15, 60, 1440})
	if err != nil {
		t.Fatal(err)
	}
	want := []int32{1440, 60, 15, 0}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
	for _, bad := range [][]int{{-1}, {MaxReminderOffset + 1}, {1, 2, 3, 4, 5, 6}} {
		if _, err := CleanOffsets(bad); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("%v: err = %v", bad, err)
		}
	}
	if out, err := CleanOffsets(nil); err != nil || out == nil || len(out) != 0 {
		t.Fatalf("nil offsets must give empty non-nil slice: %v %v", out, err)
	}
}

func TestDueMomentDefaultsTo0900Istanbul(t *testing.T) {
	s := New(nil, nil)
	d, _ := ParseDate("2026-10-01")
	due, ok := s.DueMoment(db.Todo{DueDate: d})
	if !ok || due.UTC().Format("15:04") != "06:00" {
		t.Fatalf("due = %v", due)
	}
	tm, _ := ParseTime("14:30")
	due, _ = s.DueMoment(db.Todo{DueDate: d, DueTime: tm})
	if due.UTC().Format("15:04") != "11:30" {
		t.Fatalf("due = %v", due)
	}
}

type nopInbox struct{}

func (nopInbox) Enqueue(context.Context, notifmodel.EnqueueInput) ([]notifmodel.Notification, error) {
	return nil, nil
}

func TestTodoRemindersLifecycleDB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	bg := context.Background()
	pool, err := pgxpool.New(bg, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(bg); err != nil {
		t.Skipf("database unavailable: %v", err)
	}
	q := db.New(pool)
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	var orgID, userID, customerID int64
	var orgUUID, customerUUID uuid.UUID
	if err := pool.QueryRow(bg, `INSERT INTO organizations (slug, name) VALUES ($1,'Rem Test') RETURNING id, uuid`, "rem-"+suffix).Scan(&orgID, &orgUUID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(bg, `INSERT INTO users (email, password_hash, name, surname, status) VALUES ($1,'x','Ayşe','Usta','active') RETURNING id`, "rem-"+suffix+"@example.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, userID)
	})
	if _, err := pool.Exec(bg, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner')`, orgID, userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(bg, `INSERT INTO customers (organization_id, name) VALUES ($1,'Mehmet Kaya') RETURNING id, uuid`, orgID).Scan(&customerID, &customerUUID); err != nil {
		t.Fatal(err)
	}
	ctx := orgctx.WithScope(authctx.WithPrincipal(bg, authctx.Principal{UserInternal: userID}),
		orgctx.Scope{InternalID: orgID, UUID: orgUUID, Slug: "rem-" + suffix})

	center := centerusecase.New(q, nopInbox{}, nil, nil)
	svc := New(q, nil)
	svc.SetReminders(center)
	center.RegisterGuard("todo", svc.ReminderGuard)

	pending := func(todo Todo) []time.Time {
		t.Helper()
		rows, err := pool.Query(bg, `SELECT s.fire_at FROM scheduled_notifications s JOIN todos t ON t.id = s.subject_id
			WHERE s.subject_type='todo' AND t.uuid=$1 AND s.status='pending' ORDER BY s.fire_at`, todo.UUID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []time.Time
		for rows.Next() {
			var ts time.Time
			_ = rows.Scan(&ts)
			out = append(out, ts)
		}
		return out
	}

	tomorrow := time.Now().In(svc.loc).AddDate(0, 0, 1).Format("2006-01-02")
	dueTime := "14:00"
	todo, err := svc.Create(ctx, CreateInput{
		Title: "Seramik kontrolü", DueDate: &tomorrow, DueTime: &dueTime,
		CustomerUUID: &customerUUID, ReminderOffsets: []int{0, 15, 60},
	})
	if err != nil {
		t.Fatal(err)
	}
	if todo.Customer == nil || todo.Customer.Label != "Mehmet Kaya" {
		t.Fatalf("customer link = %+v", todo.Customer)
	}
	if len(todo.ReminderOffsets) != 3 || todo.NextReminderAt == nil {
		t.Fatalf("todo reminders = %+v next=%v", todo.ReminderOffsets, todo.NextReminderAt)
	}
	p := pending(todo)
	if len(p) != 3 || p[2].Sub(p[0]) != time.Hour {
		t.Fatalf("pending = %v", p)
	}

	// Reminders without a due date are rejected.
	if _, err := svc.Create(ctx, CreateInput{Title: "x", ReminderOffsets: []int{15}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("err = %v", err)
	}
	// Unknown lead with the default resolver.
	lead := uuid.New()
	if _, err := svc.Create(ctx, CreateInput{Title: "x", LeadUUID: &lead}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("lead err = %v", err)
	}

	// Reschedule: move 1h later and keep only the 15-minute reminder.
	later := "15:00"
	offs := []int{15}
	if todo, err = svc.Patch(ctx, todo.UUID, PatchInput{DueTime: &later, ReminderOffsets: &offs}); err != nil {
		t.Fatal(err)
	}
	p = pending(todo)
	if len(p) != 1 || p[0].In(svc.loc).Format("15:04") != "14:45" {
		t.Fatalf("after reschedule = %v", p)
	}

	// Complete cancels; reopen re-arms.
	if _, err := svc.SetStatus(ctx, todo.UUID, "done"); err != nil {
		t.Fatal(err)
	}
	if len(pending(todo)) != 0 {
		t.Fatal("complete must cancel reminders")
	}
	if _, err := svc.SetStatus(ctx, todo.UUID, "open"); err != nil {
		t.Fatal(err)
	}
	if len(pending(todo)) != 1 {
		t.Fatal("reopen must re-arm reminders")
	}
	// List filter by customer.
	items, total, err := svc.List(ctx, 20, 0, ListFilters{Customer: customerUUID.String()})
	if err != nil || total != 1 || items[0].NextReminderAt == nil {
		t.Fatalf("list by customer: %d %v", total, err)
	}

	// Delete cancels.
	var todoID int64
	_ = pool.QueryRow(bg, `SELECT id FROM todos WHERE uuid=$1`, todo.UUID).Scan(&todoID)
	if err := svc.Delete(ctx, todo.UUID); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = pool.QueryRow(bg, `SELECT count(*) FROM scheduled_notifications WHERE subject_type='todo' AND subject_id=$1 AND status='pending'`, todoID).Scan(&n)
	if n != 0 {
		t.Fatalf("delete left %d pending reminders", n)
	}
	if ok, _ := svc.ReminderGuard(bg, orgID, todoID); ok {
		t.Fatal("guard must reject deleted todo")
	}
}
