package usecase

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/jackc/pgx/v5"
)

// Reminder limits.
const (
	ReminderKind       = "todo.reminder"
	MaxReminderOffsets = 5
	MaxReminderOffset  = 43200 // 30 days, minutes
	// DefaultDueHour is the due moment for date-only todos (local time).
	DefaultDueHour = 9
)

// Reminders is the notification center as seen by todos.
type Reminders interface {
	Schedule(ctx context.Context, sn centermodel.ScheduledNotification) (centermodel.Result, error)
	CancelBySubject(ctx context.Context, subjectType string, subjectID int64) (int64, error)
	PendingFireTimes(ctx context.Context, subjectType string, ids []int64) (map[int64][]time.Time, error)
}

// SetReminders enables early reminders (notification center).
func (s *Service) SetReminders(r Reminders) { s.reminders = r }

// CleanOffsets validates and normalizes reminder offsets (minutes before due):
// unique, 0..30 days, at most 5, sorted descending (earliest reminder first).
func CleanOffsets(in []int) ([]int32, error) {
	seen := map[int]bool{}
	out := make([]int32, 0, len(in))
	for _, v := range in {
		if v < 0 || v > MaxReminderOffset {
			return nil, invalid("reminder offsets must be between 0 and %d minutes", MaxReminderOffset)
		}
		if seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, int32(v))
	}
	if len(out) > MaxReminderOffsets {
		return nil, invalid("at most %d reminders", MaxReminderOffsets)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] > out[j] })
	return out, nil
}

// DueMoment is the absolute due time of a todo (date + time, or 09:00 local).
func (s *Service) DueMoment(t db.Todo) (time.Time, bool) {
	if !t.DueDate.Valid {
		return time.Time{}, false
	}
	d := t.DueDate.Time
	h, m := DefaultDueHour, 0
	if t.DueTime.Valid {
		mins := int(t.DueTime.Microseconds / 60_000_000)
		h, m = mins/60, mins%60
	}
	return time.Date(d.Year(), d.Month(), d.Day(), h, m, 0, 0, s.loc), true
}

// syncReminders cancels pending reminders for the todo and (re)schedules the
// future ones. Rescheduling back to an identical slot revives the cancelled
// row (dedupe key), and already-sent reminders are never sent again.
func (s *Service) syncReminders(ctx context.Context, t db.Todo, customerLabel string) error {
	if s.reminders == nil {
		return nil
	}
	if _, err := s.reminders.CancelBySubject(ctx, centermodel.SubjectTodo, t.ID); err != nil {
		return fmt.Errorf("cancel reminders: %w", err)
	}
	if t.Status != "open" || len(t.ReminderOffsets) == 0 {
		return nil
	}
	due, ok := s.DueMoment(t)
	if !ok {
		return nil
	}
	recipient := t.AssigneeUserID
	if !recipient.Valid {
		recipient = t.CreatedBy
	}
	if !recipient.Valid {
		return nil
	}
	actionURL := ""
	if sc, ok := orgctx.ScopeFrom(ctx); ok && sc.Slug != "" {
		actionURL = fmt.Sprintf("/t/%s/todos?todo=%s", sc.Slug, t.Uuid)
	}
	now := s.now()
	for _, off := range t.ReminderOffsets {
		fireAt := due.Add(-time.Duration(off) * time.Minute)
		if fireAt.Before(now.Add(-time.Minute)) {
			continue // already past
		}
		vars := map[string]string{
			"todo_title": t.Title,
			"todo_notes": t.Notes,
			"due_at_iso": due.Format(time.RFC3339),
		}
		if customerLabel != "" {
			vars["customer_name"] = customerLabel
		}
		if _, err := s.reminders.Schedule(ctx, centermodel.ScheduledNotification{
			Notification: centermodel.Notification{
				OrgID: t.OrganizationID, Kind: ReminderKind,
				SubjectType: centermodel.SubjectTodo, SubjectID: t.ID,
				Recipient: centermodel.Recipient{UserID: recipient.Int64},
				Vars:      vars, ActionURL: actionURL, CreatedBy: t.CreatedBy.Int64,
			},
			FireAt: fireAt,
		}); err != nil {
			return fmt.Errorf("schedule reminder: %w", err)
		}
	}
	return nil
}

// ReminderGuard is registered with the notification center: reminders only go
// out for todos that still exist and are open.
func (s *Service) ReminderGuard(ctx context.Context, orgID, todoID int64) (bool, error) {
	status, err := s.store.GetTodoReminderState(ctx, db.GetTodoReminderStateParams{ID: todoID, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return status == "open", nil
}

func (s *Service) afterWrite(ctx context.Context, id int64) {
	if s.reminders == nil {
		return
	}
	orgID, _, err := scope(ctx)
	if err != nil {
		return
	}
	row, err := s.store.GetTodoRowByID(ctx, db.GetTodoRowByIDParams{ID: id, OrganizationID: orgID})
	if err != nil {
		s.logErr("todos_reminder_load_failed", err)
		return
	}
	label := ""
	if row.CustomerID.Valid {
		if full, err := s.store.GetTodoByUUID(ctx, db.GetTodoByUUIDParams{Uuid: row.Uuid, OrganizationID: orgID}); err == nil {
			label = full.CustomerName
		}
	}
	if err := s.syncReminders(ctx, row, label); err != nil {
		s.logErr("todos_reminder_sync_failed", err)
	}
}
