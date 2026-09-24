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
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---- pure helpers ----

func TestParseDateAndTime(t *testing.T) {
	d, err := ParseDate(" 2026-09-24 ")
	if err != nil || d.Time.Format("2006-01-02") != "2026-09-24" {
		t.Fatalf("ParseDate = %v, %v", d, err)
	}
	if _, err := ParseDate("24.09.2026"); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("bad date err = %v", err)
	}
	tm, err := ParseTime("09:05")
	if err != nil {
		t.Fatal(err)
	}
	if got := fmtTime(tm); got == nil || *got != "09:05" {
		t.Fatalf("round trip = %v", got)
	}
	if _, err := ParseTime("25:00"); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("bad time err = %v", err)
	}
}

func TestCleanTitleAndNotes(t *testing.T) {
	if _, err := cleanTitle("   "); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("blank title err = %v", err)
	}
	if _, err := cleanTitle(strings.Repeat("ş", MaxTitleLength+1)); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("long title err = %v", err)
	}
	if got, err := cleanTitle("  Seramik kontrolü "); err != nil || got != "Seramik kontrolü" {
		t.Fatalf("title = %q, %v", got, err)
	}
	if _, err := cleanNotes(strings.Repeat("a", MaxNotesLength+1)); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("long notes err = %v", err)
	}
}

// Today follows Europe/Istanbul, not the server clock's zone.
func TestTodayUsesIstanbul(t *testing.T) {
	s := New(nil, nil)
	s.SetClock(func() time.Time { return time.Date(2026, 9, 23, 22, 30, 0, 0, time.UTC) })
	if got := s.Today().Format("2006-01-02"); got != "2026-09-24" {
		t.Fatalf("today = %s", got)
	}
}

func TestListParamsValidation(t *testing.T) {
	s := New(nil, nil)
	ctx := context.Background()
	for _, f := range []ListFilters{{Status: "x"}, {Scope: "later"}, {Assignee: "not-a-uuid"}} {
		if _, err := s.listParams(ctx, 1, 2, f); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("%+v: err = %v", f, err)
		}
	}
	p, err := s.listParams(ctx, 1, 2, ListFilters{Status: "open", Scope: "open_due", Assignee: "me", Q: " seramik "})
	if err != nil {
		t.Fatal(err)
	}
	if p.Status.String != "open" || p.Scope.String != "open_due" || p.AssigneeUserID.Int64 != 2 || p.Q.String != "seramik" {
		t.Fatalf("params = %+v", p)
	}
	if _, err := s.Create(ctx, CreateInput{Title: "x"}); err == nil {
		t.Fatal("create without organization context must fail")
	}
}

// ---- DB-backed flow (skipped without DATABASE_URL) ----

func TestTodosFlowDB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	bg := context.Background()
	pool, err := pgxpool.New(bg, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(bg); err != nil {
		t.Skipf("database unavailable: %v", err)
	}
	q := db.New(pool)

	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	var orgIDs, userIDs []int64
	t.Cleanup(func() {
		for _, id := range orgIDs {
			_, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, id)
		}
		for _, id := range userIDs {
			_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
		}
	})
	mustScan := func(sql string, dest []any, args ...any) {
		t.Helper()
		if err := pool.QueryRow(bg, sql, args...).Scan(dest...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	newOrg := func(tag string) (int64, uuid.UUID) {
		var id int64
		var u uuid.UUID
		mustScan(`INSERT INTO organizations (slug, name) VALUES ($1, 'Todo Test') RETURNING id, uuid`, []any{&id, &u}, "todo-"+tag+"-"+suffix)
		orgIDs = append(orgIDs, id)
		return id, u
	}
	newMember := func(orgID int64, tag, name string) (int64, uuid.UUID) {
		var id int64
		var u uuid.UUID
		mustScan(`INSERT INTO users (email, password_hash, name, surname, status) VALUES ($1, 'x', $2, 'Usta', 'active') RETURNING id, uuid`,
			[]any{&id, &u}, "todo-"+tag+"-"+suffix+"@example.test", name)
		userIDs = append(userIDs, id)
		if _, err := pool.Exec(bg, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'staff')`, orgID, id); err != nil {
			t.Fatal(err)
		}
		return id, u
	}
	orgA, orgAUUID := newOrg("a")
	orgB, orgBUUID := newOrg("b")
	actorID, actorUUID := newMember(orgA, "actor", "Ayşe")
	_, aliUUID := newMember(orgA, "ali", "Ali")
	_, outsiderUUID := newMember(orgB, "outsider", "Veli")
	var customerA, customerB uuid.UUID
	mustScan(`INSERT INTO customers (organization_id, name) VALUES ($1, 'Hüseyin Ülken') RETURNING uuid`, []any{&customerA}, orgA)
	mustScan(`INSERT INTO customers (organization_id, name) VALUES ($1, 'Başka Müşteri') RETURNING uuid`, []any{&customerB}, orgB)

	ctxFor := func(orgID int64, orgUUID uuid.UUID, userID int64, userUUID uuid.UUID) context.Context {
		ctx := authctx.WithPrincipal(bg, authctx.Principal{UserID: userUUID, UserInternal: userID})
		return orgctx.WithScope(ctx, orgctx.Scope{InternalID: orgID, UUID: orgUUID, Slug: "t"})
	}
	ctxA := ctxFor(orgA, orgAUUID, actorID, actorUUID)
	ctxB := ctxFor(orgB, orgBUUID, 0, uuid.Nil)

	svc := New(q, nil)
	// 01:30 in Istanbul on 24.09 (still 23.09 in UTC).
	svc.SetClock(func() time.Time { return time.Date(2026, 9, 23, 22, 30, 0, 0, time.UTC) })
	str := func(v string) *string { return &v }

	// Create: assignee, customer, due date/time, via AI.
	todo, err := svc.Create(ctxA, CreateInput{
		Title: " 34 ABC 123 seramik kontrolü ", Notes: "arka tampon", DueDate: str("2026-09-25"), DueTime: str("10:30"),
		AssigneeUUID: &aliUUID, CustomerUUID: &customerA, ViaAI: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if todo.Title != "34 ABC 123 seramik kontrolü" || !todo.ViaAI || todo.Status != "open" || todo.Overdue ||
		todo.DueDate == nil || *todo.DueDate != "2026-09-25" || todo.DueTime == nil || *todo.DueTime != "10:30" ||
		todo.Assignee == nil || todo.Assignee.UUID != aliUUID || todo.Customer == nil || todo.Customer.Label != "Hüseyin Ülken" ||
		todo.CreatedByName != "Ayşe Usta" {
		t.Fatalf("todo = %+v", todo)
	}

	// References from another organization do not resolve.
	if _, err := svc.Create(ctxA, CreateInput{Title: "x", CustomerUUID: &customerB}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("foreign customer err = %v", err)
	}
	if _, err := svc.Create(ctxA, CreateInput{Title: "x", AssigneeUUID: &outsiderUUID}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("foreign assignee err = %v", err)
	}
	if _, err := svc.Create(ctxA, CreateInput{Title: "x", DueTime: str("10:00")}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("time without date err = %v", err)
	}

	// Overdue + today are computed in Istanbul time.
	overdue, err := svc.Create(ctxA, CreateInput{Title: "Dünkü iş", DueDate: str("2026-09-23")})
	if err != nil || !overdue.Overdue {
		t.Fatalf("overdue = %+v, %v", overdue, err)
	}
	if _, err := svc.Create(ctxA, CreateInput{Title: "Bugünkü iş", DueDate: str("2026-09-24"), AssigneeUUID: &actorUUID}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctxA, CreateInput{Title: "Tarihsiz"}); err != nil {
		t.Fatal(err)
	}

	count := func(ctx context.Context, f ListFilters) int64 {
		t.Helper()
		_, total, err := svc.List(ctx, 50, 0, f)
		if err != nil {
			t.Fatalf("list %+v: %v", f, err)
		}
		return total
	}
	for f, want := range map[ListFilters]int64{
		{}:                           4,
		{Scope: "overdue"}:           1,
		{Scope: "today"}:             1,
		{Scope: "open_due"}:          2,
		{Scope: "upcoming"}:          1,
		{Scope: "no_date"}:           1,
		{Assignee: "me"}:             1,
		{Assignee: aliUUID.String()}: 1,
		{Q: "seramik"}:               1,
		{Q: "tampon"}:                1,
	} {
		if got := count(ctxA, f); got != want {
			t.Errorf("list %+v = %d, want %d", f, got, want)
		}
	}
	if _, _, err := svc.List(ctxA, 10, 0, ListFilters{Assignee: outsiderUUID.String()}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("foreign assignee filter err = %v", err)
	}
	sum, err := svc.Summary(ctxA)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Open != 4 || sum.Overdue != 1 || sum.Today != 1 || sum.Mine != 1 || sum.Date != "2026-09-24" {
		t.Fatalf("summary = %+v", sum)
	}

	// Organization isolation: another org cannot see, change or delete it.
	if count(ctxB, ListFilters{}) != 0 {
		t.Fatal("org B must not see org A's todos")
	}
	if _, err := svc.Get(ctxB, todo.UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign get err = %v", err)
	}
	if _, err := svc.SetStatus(ctxB, todo.UUID, "done"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign complete err = %v", err)
	}
	if _, err := svc.Patch(ctxB, todo.UUID, PatchInput{Title: str("hack")}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign patch err = %v", err)
	}
	if err := svc.Delete(ctxB, todo.UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign delete err = %v", err)
	}

	// Patch: clear the time and assignee, keep the rest.
	patched, err := svc.Patch(ctxA, todo.UUID, PatchInput{Title: str("Seramik kontrolü"), DueTime: str(""), AssigneeUUID: str("")})
	if err != nil {
		t.Fatalf("patch: %v", err)
	}
	if patched.Title != "Seramik kontrolü" || patched.DueTime != nil || patched.Assignee != nil || patched.DueDate == nil || patched.Customer == nil {
		t.Fatalf("patched = %+v", patched)
	}
	if _, err := svc.Patch(ctxA, todo.UUID, PatchInput{DueDate: str(""), DueTime: str("09:00")}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("time after clearing date err = %v", err)
	}

	// Complete, idempotent, reopen.
	done, err := svc.SetStatus(ctxA, todo.UUID, "done")
	if err != nil || done.Status != "done" || done.CompletedAt == nil {
		t.Fatalf("done = %+v, %v", done, err)
	}
	if again, err := svc.SetStatus(ctxA, todo.UUID, "done"); err != nil || again.Status != "done" {
		t.Fatalf("complete twice = %+v, %v", again, err)
	}
	if count(ctxA, ListFilters{Status: "done"}) != 1 || count(ctxA, ListFilters{Status: "open"}) != 3 {
		t.Fatal("status filter mismatch")
	}
	if _, err := svc.SetStatus(ctxA, todo.UUID, "archived"); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("bad status err = %v", err)
	}
	reopened, err := svc.SetStatus(ctxA, todo.UUID, "open")
	if err != nil || reopened.Status != "open" || reopened.CompletedAt != nil {
		t.Fatalf("reopen = %+v, %v", reopened, err)
	}

	// Assignees lists only this organization's members.
	members, err := svc.Assignees(ctxA)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 2 {
		t.Fatalf("assignees = %+v", members)
	}

	if err := svc.Delete(ctxA, todo.UUID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctxA, todo.UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get after delete err = %v", err)
	}
}
