// Package usecase implements organization todos (görevler): short tasks with
// an optional due date/time, assignee and related customer or job. Todos are
// created from the UI or by the AI assistant (via_ai).
package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	_ "time/tzdata" // Europe/Istanbul must resolve in minimal containers.

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourcemeta"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
)

// Limits.
const (
	MaxTitleLength = 200
	MaxNotesLength = 2000
)

// Store is the persistence port (satisfied by *db.Queries).
type Store interface {
	CreateTodo(ctx context.Context, arg db.CreateTodoParams) (db.Todo, error)
	GetTodoByUUID(ctx context.Context, arg db.GetTodoByUUIDParams) (db.GetTodoByUUIDRow, error)
	ListTodos(ctx context.Context, arg db.ListTodosParams) ([]db.ListTodosRow, error)
	CountTodos(ctx context.Context, arg db.CountTodosParams) (int64, error)
	TodoSummary(ctx context.Context, arg db.TodoSummaryParams) (db.TodoSummaryRow, error)
	UpdateTodo(ctx context.Context, arg db.UpdateTodoParams) (db.Todo, error)
	SetTodoStatus(ctx context.Context, arg db.SetTodoStatusParams) (db.Todo, error)
	DeleteTodo(ctx context.Context, arg db.DeleteTodoParams) error
	GetTodoAssigneeByUUID(ctx context.Context, arg db.GetTodoAssigneeByUUIDParams) (db.GetTodoAssigneeByUUIDRow, error)
	ListTodoAssignees(ctx context.Context, organizationID int64) ([]db.ListTodoAssigneesRow, error)
	GetTodoCustomerRef(ctx context.Context, arg db.GetTodoCustomerRefParams) (db.GetTodoCustomerRefRow, error)
	GetTodoJobRef(ctx context.Context, arg db.GetTodoJobRefParams) (db.GetTodoJobRefRow, error)
}

// Ref is a related record.
type Ref struct {
	UUID  uuid.UUID `json:"uuid"`
	Label string    `json:"label"`
}

// Todo is the API shape.
type Todo struct {
	UUID          uuid.UUID  `json:"uuid"`
	Title         string     `json:"title"`
	Notes         string     `json:"notes"`
	DueDate       *string    `json:"due_date"`
	DueTime       *string    `json:"due_time"`
	Status        string     `json:"status"`
	Overdue       bool       `json:"overdue"`
	Assignee      *Ref       `json:"assignee"`
	Customer      *Ref       `json:"customer"`
	Job           *Ref       `json:"job"`
	ViaAI         bool       `json:"via_ai"`
	CreatedByName string     `json:"created_by_name"`
	CompletedAt   *time.Time `json:"completed_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// Summary counts open todos for the dashboard and nav badge.
type Summary struct {
	Open    int64  `json:"open"`
	Overdue int64  `json:"overdue"`
	Today   int64  `json:"today"`
	Mine    int64  `json:"mine"`
	Date    string `json:"date"`
}

// Assignee is a member that todos can be assigned to.
type Assignee struct {
	UUID uuid.UUID `json:"uuid"`
	Name string    `json:"name"`
	Role string    `json:"role"`
}

// ListFilters narrows the list.
type ListFilters struct {
	Status string // open | done
	// Scope: overdue | today | open_due | upcoming | no_date.
	Scope string
	// Assignee: "me" or a user uuid.
	Assignee string
	Q        string
}

// CreateInput creates a todo.
type CreateInput struct {
	Title        string     `json:"title"`
	Notes        string     `json:"notes"`
	DueDate      *string    `json:"due_date"`
	DueTime      *string    `json:"due_time"`
	AssigneeUUID *uuid.UUID `json:"assignee_uuid"`
	CustomerUUID *uuid.UUID `json:"customer_uuid"`
	JobUUID      *uuid.UUID `json:"job_uuid"`
	// ViaAI marks todos created by the assistant (never bound from JSON).
	ViaAI bool `json:"-"`
}

// PatchInput updates a todo. For the optional fields an empty string clears
// the value and a missing field keeps it.
type PatchInput struct {
	Title        *string `json:"title"`
	Notes        *string `json:"notes"`
	DueDate      *string `json:"due_date"`
	DueTime      *string `json:"due_time"`
	AssigneeUUID *string `json:"assignee_uuid"`
	CustomerUUID *string `json:"customer_uuid"`
	JobUUID      *string `json:"job_uuid"`
}

// Service is the todos use case.
type Service struct {
	store Store
	act   *activity.Recorder
	loc   *time.Location
	now   func() time.Time
}

// New creates the service.
func New(store Store, act *activity.Recorder) *Service {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Service{store: store, act: act, loc: loc, now: time.Now}
}

// SetClock overrides time (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// ResourceMeta describes the list resource.
func (s *Service) ResourceMeta() resourcemeta.ResourceMeta { return resourcemeta.TenantTodos() }

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidRequest, fmt.Sprintf(format, args...))
}

func scope(ctx context.Context) (int64, int64, error) {
	sc, ok := orgctx.ScopeFrom(ctx)
	if !ok || sc.InternalID <= 0 {
		return 0, 0, errors.New("organization context required")
	}
	var actor int64
	if p, ok := authctx.PrincipalFrom(ctx); ok {
		actor = p.UserInternal
	}
	return sc.InternalID, actor, nil
}

// Today returns the local date (Europe/Istanbul).
func (s *Service) Today() time.Time {
	lt := s.now().In(s.loc)
	return time.Date(lt.Year(), lt.Month(), lt.Day(), 0, 0, 0, 0, time.UTC)
}

func (s *Service) record(ctx context.Context, action string, id uuid.UUID, payload map[string]any) {
	if s.act == nil {
		return
	}
	var actor *int64
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		v := p.UserInternal
		actor = &v
	}
	s.act.Record(ctx, actor, action, "todos.todo", &id, payload, nil)
}

// ParseDate parses YYYY-MM-DD.
func ParseDate(v string) (pgtype.Date, error) {
	t, err := time.Parse("2006-01-02", strings.TrimSpace(v))
	if err != nil {
		return pgtype.Date{}, invalid("due_date must be YYYY-MM-DD")
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}

// ParseTime parses HH:MM.
func ParseTime(v string) (pgtype.Time, error) {
	t, err := time.Parse("15:04", strings.TrimSpace(v))
	if err != nil {
		return pgtype.Time{}, invalid("due_time must be HH:MM")
	}
	us := int64(t.Hour())*3600_000_000 + int64(t.Minute())*60_000_000
	return pgtype.Time{Microseconds: us, Valid: true}, nil
}

func fmtTime(t pgtype.Time) *string {
	if !t.Valid {
		return nil
	}
	mins := t.Microseconds / 60_000_000
	v := fmt.Sprintf("%02d:%02d", mins/60, mins%60)
	return &v
}

func (s *Service) mapRow(r db.GetTodoByUUIDRow) Todo {
	out := Todo{
		UUID: r.Uuid, Title: r.Title, Notes: r.Notes, Status: r.Status, ViaAI: r.ViaAi,
		CreatedByName: r.CreatedByName, CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time,
		DueTime: fmtTime(r.DueTime),
	}
	if r.DueDate.Valid {
		d := r.DueDate.Time.Format("2006-01-02")
		out.DueDate = &d
		out.Overdue = r.Status == "open" && r.DueDate.Time.Before(s.Today())
	}
	if r.CompletedAt.Valid {
		t := r.CompletedAt.Time
		out.CompletedAt = &t
	}
	if r.AssigneeUuid.Valid {
		out.Assignee = &Ref{UUID: r.AssigneeUuid.Bytes, Label: r.AssigneeName}
	}
	if r.CustomerUuid.Valid {
		out.Customer = &Ref{UUID: r.CustomerUuid.Bytes, Label: r.CustomerName}
	}
	if r.JobUuid.Valid {
		out.Job = &Ref{UUID: r.JobUuid.Bytes, Label: r.JobPlate}
	}
	return out
}

func text(v string) pgtype.Text { return pgtype.Text{String: v, Valid: true} }

func (s *Service) listParams(ctx context.Context, orgID, actor int64, f ListFilters) (db.ListTodosParams, error) {
	p := db.ListTodosParams{OrganizationID: orgID, Today: pgtype.Date{Time: s.Today(), Valid: true}}
	switch f.Status {
	case "":
	case "open", "done":
		p.Status = text(f.Status)
	default:
		return p, invalid("status must be open or done")
	}
	switch f.Scope {
	case "":
	case "overdue", "today", "open_due", "upcoming", "no_date":
		p.Scope = text(f.Scope)
	default:
		return p, invalid("scope must be overdue, today, open_due, upcoming or no_date")
	}
	switch a := strings.TrimSpace(f.Assignee); a {
	case "":
	case "me":
		p.AssigneeUserID = pgtype.Int8{Int64: actor, Valid: true}
	default:
		id, err := uuid.Parse(a)
		if err != nil {
			return p, invalid("assignee must be me or a user uuid")
		}
		m, err := s.store.GetTodoAssigneeByUUID(ctx, db.GetTodoAssigneeByUUIDParams{OrganizationID: orgID, Uuid: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return p, invalid("assignee is not a member of this organization")
		}
		if err != nil {
			return p, err
		}
		p.AssigneeUserID = pgtype.Int8{Int64: m.ID, Valid: true}
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		p.Q = text(q)
	}
	return p, nil
}

// List returns todos (open first, by due date).
func (s *Service) List(ctx context.Context, limit, offset int32, f ListFilters) ([]Todo, int64, error) {
	orgID, actor, err := scope(ctx)
	if err != nil {
		return nil, 0, err
	}
	p, err := s.listParams(ctx, orgID, actor, f)
	if err != nil {
		return nil, 0, err
	}
	p.LimitCount, p.OffsetCount = limit, offset
	rows, err := s.store.ListTodos(ctx, p)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.store.CountTodos(ctx, db.CountTodosParams{
		OrganizationID: p.OrganizationID, Status: p.Status, AssigneeUserID: p.AssigneeUserID,
		Q: p.Q, Scope: p.Scope, Today: p.Today,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Todo, 0, len(rows))
	for _, r := range rows {
		out = append(out, s.mapRow(db.GetTodoByUUIDRow(r)))
	}
	return out, total, nil
}

// Summary counts open/overdue/today/mine.
func (s *Service) Summary(ctx context.Context) (Summary, error) {
	orgID, actor, err := scope(ctx)
	if err != nil {
		return Summary{}, err
	}
	today := s.Today()
	r, err := s.store.TodoSummary(ctx, db.TodoSummaryParams{
		OrganizationID: orgID, Today: pgtype.Date{Time: today, Valid: true},
		UserID: pgtype.Int8{Int64: actor, Valid: actor > 0},
	})
	if err != nil {
		return Summary{}, err
	}
	return Summary{Open: r.OpenCount, Overdue: r.OverdueCount, Today: r.TodayCount, Mine: r.MineCount, Date: today.Format("2006-01-02")}, nil
}

// Assignees lists active members.
func (s *Service) Assignees(ctx context.Context) ([]Assignee, error) {
	orgID, _, err := scope(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.store.ListTodoAssignees(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := make([]Assignee, 0, len(rows))
	for _, r := range rows {
		out = append(out, Assignee{UUID: r.Uuid, Name: strings.TrimSpace(r.Name + " " + r.Surname), Role: r.Role})
	}
	return out, nil
}

// Get returns one todo.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Todo, error) {
	orgID, _, err := scope(ctx)
	if err != nil {
		return Todo{}, err
	}
	row, err := s.store.GetTodoByUUID(ctx, db.GetTodoByUUIDParams{Uuid: id, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Todo{}, ErrNotFound
	}
	if err != nil {
		return Todo{}, err
	}
	return s.mapRow(row), nil
}

func (s *Service) resolveRefs(ctx context.Context, orgID int64, assignee, customer, job *uuid.UUID) (a, c, j pgtype.Int8, err error) {
	if assignee != nil && *assignee != uuid.Nil {
		m, e := s.store.GetTodoAssigneeByUUID(ctx, db.GetTodoAssigneeByUUIDParams{OrganizationID: orgID, Uuid: *assignee})
		if errors.Is(e, pgx.ErrNoRows) {
			return a, c, j, invalid("assignee is not a member of this organization")
		}
		if e != nil {
			return a, c, j, e
		}
		a = pgtype.Int8{Int64: m.ID, Valid: true}
	}
	if customer != nil && *customer != uuid.Nil {
		r, e := s.store.GetTodoCustomerRef(ctx, db.GetTodoCustomerRefParams{OrganizationID: orgID, Uuid: *customer})
		if errors.Is(e, pgx.ErrNoRows) {
			return a, c, j, invalid("customer not found")
		}
		if e != nil {
			return a, c, j, e
		}
		c = pgtype.Int8{Int64: r.ID, Valid: true}
	}
	if job != nil && *job != uuid.Nil {
		r, e := s.store.GetTodoJobRef(ctx, db.GetTodoJobRefParams{OrganizationID: orgID, Uuid: *job})
		if errors.Is(e, pgx.ErrNoRows) {
			return a, c, j, invalid("job not found")
		}
		if e != nil {
			return a, c, j, e
		}
		j = pgtype.Int8{Int64: r.ID, Valid: true}
	}
	return a, c, j, nil
}

func cleanTitle(v string) (string, error) {
	t := strings.TrimSpace(v)
	if t == "" {
		return "", invalid("title is required")
	}
	if len([]rune(t)) > MaxTitleLength {
		return "", invalid("title is too long (max %d)", MaxTitleLength)
	}
	return t, nil
}

func cleanNotes(v string) (string, error) {
	n := strings.TrimSpace(v)
	if len([]rune(n)) > MaxNotesLength {
		return "", invalid("notes are too long (max %d)", MaxNotesLength)
	}
	return n, nil
}

// Create adds a todo.
func (s *Service) Create(ctx context.Context, in CreateInput) (Todo, error) {
	orgID, actor, err := scope(ctx)
	if err != nil {
		return Todo{}, err
	}
	p := db.CreateTodoParams{OrganizationID: orgID, ViaAi: in.ViaAI}
	if p.Title, err = cleanTitle(in.Title); err != nil {
		return Todo{}, err
	}
	if p.Notes, err = cleanNotes(in.Notes); err != nil {
		return Todo{}, err
	}
	if in.DueDate != nil && strings.TrimSpace(*in.DueDate) != "" {
		if p.DueDate, err = ParseDate(*in.DueDate); err != nil {
			return Todo{}, err
		}
	}
	if in.DueTime != nil && strings.TrimSpace(*in.DueTime) != "" {
		if !p.DueDate.Valid {
			return Todo{}, invalid("due_time requires due_date")
		}
		if p.DueTime, err = ParseTime(*in.DueTime); err != nil {
			return Todo{}, err
		}
	}
	if p.AssigneeUserID, p.CustomerID, p.ServiceJobID, err = s.resolveRefs(ctx, orgID, in.AssigneeUUID, in.CustomerUUID, in.JobUUID); err != nil {
		return Todo{}, err
	}
	if actor > 0 {
		p.CreatedBy = pgtype.Int8{Int64: actor, Valid: true}
	}
	row, err := s.store.CreateTodo(ctx, p)
	if err != nil {
		return Todo{}, err
	}
	s.record(ctx, "todos.create", row.Uuid, map[string]any{"title": row.Title, "via_ai": row.ViaAi})
	return s.Get(ctx, row.Uuid)
}

func optionalUUID(v *string, field string) (*uuid.UUID, bool, error) {
	if v == nil {
		return nil, false, nil
	}
	if strings.TrimSpace(*v) == "" {
		return nil, true, nil
	}
	id, err := uuid.Parse(strings.TrimSpace(*v))
	if err != nil {
		return nil, false, invalid("%s must be a uuid", field)
	}
	return &id, false, nil
}

// Patch updates a todo.
func (s *Service) Patch(ctx context.Context, id uuid.UUID, in PatchInput) (Todo, error) {
	orgID, _, err := scope(ctx)
	if err != nil {
		return Todo{}, err
	}
	cur, err := s.store.GetTodoByUUID(ctx, db.GetTodoByUUIDParams{Uuid: id, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Todo{}, ErrNotFound
	}
	if err != nil {
		return Todo{}, err
	}
	p := db.UpdateTodoParams{ID: cur.ID, OrganizationID: orgID}
	if in.Title != nil {
		t, err := cleanTitle(*in.Title)
		if err != nil {
			return Todo{}, err
		}
		p.Title = text(t)
	}
	if in.Notes != nil {
		n, err := cleanNotes(*in.Notes)
		if err != nil {
			return Todo{}, err
		}
		p.Notes = text(n)
	}
	hasDate := cur.DueDate.Valid
	if in.DueDate != nil {
		if strings.TrimSpace(*in.DueDate) == "" {
			p.ClearDue = true
			hasDate = false
		} else {
			if p.DueDate, err = ParseDate(*in.DueDate); err != nil {
				return Todo{}, err
			}
			hasDate = true
		}
	}
	if in.DueTime != nil {
		if strings.TrimSpace(*in.DueTime) == "" {
			p.ClearDueTime = true
		} else {
			if !hasDate {
				return Todo{}, invalid("due_time requires due_date")
			}
			if p.DueTime, err = ParseTime(*in.DueTime); err != nil {
				return Todo{}, err
			}
		}
	}
	assignee, clearA, err := optionalUUID(in.AssigneeUUID, "assignee_uuid")
	if err != nil {
		return Todo{}, err
	}
	customer, clearC, err := optionalUUID(in.CustomerUUID, "customer_uuid")
	if err != nil {
		return Todo{}, err
	}
	job, clearJ, err := optionalUUID(in.JobUUID, "job_uuid")
	if err != nil {
		return Todo{}, err
	}
	p.ClearAssignee, p.ClearCustomer, p.ClearJob = clearA, clearC, clearJ
	if p.AssigneeUserID, p.CustomerID, p.ServiceJobID, err = s.resolveRefs(ctx, orgID, assignee, customer, job); err != nil {
		return Todo{}, err
	}
	if _, err := s.store.UpdateTodo(ctx, p); err != nil {
		return Todo{}, err
	}
	s.record(ctx, "todos.update", id, nil)
	return s.Get(ctx, id)
}

// SetStatus completes (done) or reopens (open) a todo.
func (s *Service) SetStatus(ctx context.Context, id uuid.UUID, status string) (Todo, error) {
	if status != "open" && status != "done" {
		return Todo{}, invalid("status must be open or done")
	}
	orgID, actor, err := scope(ctx)
	if err != nil {
		return Todo{}, err
	}
	cur, err := s.store.GetTodoByUUID(ctx, db.GetTodoByUUIDParams{Uuid: id, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Todo{}, ErrNotFound
	}
	if err != nil {
		return Todo{}, err
	}
	if cur.Status == status {
		return s.mapRow(cur), nil
	}
	if _, err := s.store.SetTodoStatus(ctx, db.SetTodoStatusParams{
		ID: cur.ID, OrganizationID: orgID, Status: status, CompletedBy: pgtype.Int8{Int64: actor, Valid: actor > 0},
	}); err != nil {
		return Todo{}, err
	}
	action := "todos.complete"
	if status == "open" {
		action = "todos.reopen"
	}
	s.record(ctx, action, id, map[string]any{"title": cur.Title})
	return s.Get(ctx, id)
}

// Delete removes a todo.
func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	orgID, _, err := scope(ctx)
	if err != nil {
		return err
	}
	cur, err := s.store.GetTodoByUUID(ctx, db.GetTodoByUUIDParams{Uuid: id, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := s.store.DeleteTodo(ctx, db.DeleteTodoParams{ID: cur.ID, OrganizationID: orgID}); err != nil {
		return err
	}
	s.record(ctx, "todos.delete", id, map[string]any{"title": cur.Title})
	return nil
}
