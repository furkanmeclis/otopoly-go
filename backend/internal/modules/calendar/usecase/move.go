package usecase

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	leadsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/leads/usecase"
	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
)

// ErrForbidden is returned when the member may not move items of a layer.
var ErrForbidden = errors.New("forbidden")

// TodoScheduler is the todos use case (due date / time changes go through it
// so reminders and activity stay correct).
type TodoScheduler interface {
	Patch(ctx context.Context, id uuid.UUID, in todosusecase.PatchInput) (todosusecase.Todo, error)
}

// LeadScheduler is the leads use case (follow-up date changes).
type LeadScheduler interface {
	Patch(ctx context.Context, id uuid.UUID, in leadsusecase.PatchInput) (leadsusecase.Detail, error)
}

// MoveInput reschedules one feed item (drag and drop). Timed placements use
// StartsAt/EndsAt (RFC 3339); all-day placements use StartDate/EndDate
// (YYYY-MM-DD, inclusive). Todos keep a 30 minute slot and leads only have a
// date, so EndsAt/EndDate are ignored for them.
type MoveInput struct {
	Layer     string    `json:"layer"`
	RefUUID   uuid.UUID `json:"ref_uuid"`
	AllDay    bool      `json:"all_day"`
	StartsAt  *string   `json:"starts_at"`
	EndsAt    *string   `json:"ends_at"`
	StartDate *string   `json:"start_date"`
	EndDate   *string   `json:"end_date"`
}

// Move reschedules an event, a todo (due date/time) or a lead (follow-up
// date) and returns the item at its new place.
func (s *Service) Move(ctx context.Context, actorID int64, in MoveInput, req *http.Request) (FeedItem, error) {
	org, err := orgID(ctx)
	if err != nil {
		return FeedItem{}, err
	}
	if in.RefUUID == uuid.Nil {
		return FeedItem{}, fmt.Errorf("%w: ref_uuid is required", ErrInvalidRequest)
	}
	if _, ok := access[in.Layer]; !ok {
		return FeedItem{}, fmt.Errorf("%w: unknown layer %q", ErrInvalidRequest, in.Layer)
	}
	avail, err := s.Available(ctx)
	if err != nil {
		return FeedItem{}, err
	}
	allowed := false
	for _, l := range avail {
		if l.Key == in.Layer {
			allowed = l.Movable
		}
	}
	if !allowed {
		return FeedItem{}, fmt.Errorf("%w: items of layer %q cannot be moved", ErrForbidden, in.Layer)
	}

	var item FeedItem
	switch in.Layer {
	case LayerEvents:
		cur, err := s.GetEvent(ctx, in.RefUUID)
		if err != nil {
			return FeedItem{}, err
		}
		f, err := s.parseEvent(EventInput{
			Title: cur.Title, Description: cur.Description, Location: cur.Location, Color: cur.Color,
			AllDay: in.AllDay, StartsAt: in.StartsAt, EndsAt: in.EndsAt, StartDate: in.StartDate, EndDate: in.EndDate,
		})
		if err != nil {
			return FeedItem{}, err
		}
		e, err := s.saveEvent(ctx, org, actorID, in.RefUUID, f, req)
		if err != nil {
			return FeedItem{}, err
		}
		item = s.eventItem(e)

	case LayerTodos:
		day, clock, err := s.placement(in, true)
		if err != nil {
			return FeedItem{}, err
		}
		empty := ""
		patch := todosusecase.PatchInput{DueDate: &day, DueTime: &empty}
		if clock != "" {
			patch.DueTime = &clock
		}
		t, err := s.todos.Patch(ctx, in.RefUUID, patch)
		if err != nil {
			return FeedItem{}, mapModuleErr(err, todosusecase.ErrNotFound, todosusecase.ErrInvalidRequest)
		}
		item = s.placedItem("todos:"+t.UUID.String(), LayerTodos, "todo", t.Title, day, clock)
		item.Status = t.Status
		if t.Customer != nil {
			item.Subtitle = t.Customer.Label
		}
		item.RefUUID = ref(t.UUID)

	case LayerLeads:
		day, _, err := s.placement(in, false)
		if err != nil {
			return FeedItem{}, err
		}
		l, err := s.leads.Patch(ctx, in.RefUUID, leadsusecase.PatchInput{FollowUpDate: &day})
		if err != nil {
			return FeedItem{}, mapModuleErr(err, leadsusecase.ErrNotFound, leadsusecase.ErrInvalidRequest)
		}
		item = s.placedItem("leads:"+l.UUID.String(), LayerLeads, "lead_follow_up", l.CustomerName, day, "")
		item.Subtitle, item.Status, item.RefUUID = l.Interest, l.Temperature, ref(l.UUID)
	}
	item.RefKind = access[in.Layer].refKind
	item.Movable = true
	// Own events were announced by saveEvent; todo / lead moves are announced
	// by their modules and again here so open calendars refetch even when
	// the member cannot read that module's list.
	if in.Layer != LayerEvents {
		s.live(ctx, resourceevents.ActionUpdated, in.RefUUID)
	}
	return item, nil
}

// placement turns a move into a business-time date and, when withTime and the
// target is timed, an HH:MM clock.
func (s *Service) placement(in MoveInput, withTime bool) (string, string, error) {
	if in.AllDay || !withTime {
		if in.StartDate != nil && strings.TrimSpace(*in.StartDate) != "" {
			d, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(*in.StartDate), s.loc)
			if err != nil {
				return "", "", fmt.Errorf("%w: start_date must be YYYY-MM-DD", ErrInvalidRequest)
			}
			return d.Format("2006-01-02"), "", nil
		}
		if in.AllDay {
			return "", "", fmt.Errorf("%w: start_date is required for all-day placement", ErrInvalidRequest)
		}
	}
	if in.StartsAt == nil {
		return "", "", fmt.Errorf("%w: starts_at is required", ErrInvalidRequest)
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(*in.StartsAt))
	if err != nil {
		return "", "", fmt.Errorf("%w: starts_at must be RFC 3339", ErrInvalidRequest)
	}
	t = t.In(s.loc)
	if !withTime {
		return t.Format("2006-01-02"), "", nil
	}
	return t.Format("2006-01-02"), t.Format("15:04"), nil
}

// placedItem builds the feed item for a moved todo / lead.
func (s *Service) placedItem(id, layer, kind, title, day, clock string) FeedItem {
	d, _ := time.ParseInLocation("2006-01-02", day, s.loc)
	if clock == "" {
		return s.dayItemAt(id, layer, kind, title, d)
	}
	c, _ := time.Parse("15:04", clock)
	start := d.Add(time.Duration(c.Hour())*time.Hour + time.Duration(c.Minute())*time.Minute)
	return FeedItem{ID: id, Layer: layer, Kind: kind, Title: title, StartsAt: start, EndsAt: start.Add(30 * time.Minute)}
}

func (s *Service) dayItemAt(id, layer, kind, title string, d time.Time) FeedItem {
	day := d.Format("2006-01-02")
	return FeedItem{
		ID: id, Layer: layer, Kind: kind, Title: title, AllDay: true,
		StartsAt: d, EndsAt: d.AddDate(0, 0, 1), StartDate: &day, EndDate: &day,
	}
}

func mapModuleErr(err, notFound, invalid error) error {
	switch {
	case errors.Is(err, notFound):
		return ErrNotFound
	case errors.Is(err, invalid):
		msg := strings.TrimPrefix(err.Error(), invalid.Error()+": ")
		return fmt.Errorf("%w: %s", ErrInvalidRequest, msg)
	}
	return err
}
