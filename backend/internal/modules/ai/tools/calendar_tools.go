package tools

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	calendarusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/calendar/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// CalendarService is the calendar use case as seen by the assistant.
type CalendarService interface {
	GetFeed(ctx context.Context, from, to string, layers []string) (calendarusecase.Feed, error)
	CreateEvent(ctx context.Context, actorID int64, in calendarusecase.EventInput, req *http.Request) (calendarusecase.Event, error)
}

// maxCalendarToolDays caps one list_calendar call (the feed allows more).
const maxCalendarToolDays = 31

// withPrincipal makes sure the calendar sees the caller (layer permissions).
func withPrincipal(ctx context.Context, env Env) context.Context {
	if _, ok := authctx.PrincipalFrom(ctx); ok {
		return ctx
	}
	return authctx.WithPrincipal(ctx, env.Principal)
}

// ---------------------------------------------------------------- list

// ListCalendar lists calendar items (own events + module layers) in a range.
type ListCalendar struct{ calendar CalendarService }

var listCalendarSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"from": map[string]any{"type": "string", "format": "date", "description": "First day, YYYY-MM-DD. Default today."},
		"to":   map[string]any{"type": "string", "format": "date", "description": "Last day (inclusive), YYYY-MM-DD. Default from + 6 days; at most 31 days after from."},
		"layers": map[string]any{
			"type": "array", "maxItems": 10,
			"items":       map[string]any{"type": "string", "enum": calendarusecase.Layers},
			"description": "Limit to these layers; omit for all the user may see.",
		},
		"limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 60, "description": "Default 40."},
	},
	"additionalProperties": false,
}

// Spec implements Tool.
func (ListCalendar) Spec() Spec {
	return Spec{
		Name: "list_calendar",
		Description: "List the business calendar (takvim) for a date range: own events plus jobs opened, deliveries, todos, " +
			"quote deadlines, lead follow-ups, daily income/expense, sales, purchases and signed contracts. " +
			"Use for \"bugün/yarın/bu hafta neler var\", agenda or schedule questions.",
		InputSchema: listCalendarSchema,
		Permissions: []string{rbac.PermTenantCalendarRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

type calendarToolInput struct {
	From   string   `json:"from"`
	To     string   `json:"to"`
	Layers []string `json:"layers"`
	Limit  int      `json:"limit"`
}

// Run implements Tool.
func (t ListCalendar) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in calendarToolInput
	if err := Decode(listCalendarSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	from, err := dateOrToday(env, in.From)
	if err != nil {
		return ErrorResult(err.Error()), nil
	}
	fromDay, _ := time.Parse("2006-01-02", from)
	toDay := fromDay.AddDate(0, 0, 6)
	if strings.TrimSpace(in.To) != "" {
		if toDay, err = time.Parse("2006-01-02", strings.TrimSpace(in.To)); err != nil {
			return ErrorResult("to must be YYYY-MM-DD"), nil
		}
	}
	if toDay.Before(fromDay) {
		return ErrorResult("to must not be before from"), nil
	}
	if toDay.Sub(fromDay) > (maxCalendarToolDays-1)*24*time.Hour {
		return ErrorResult("range is limited to 31 days"), nil
	}
	layers := in.Layers
	if len(layers) == 0 {
		layers = calendarusecase.Layers
	}
	feed, err := t.calendar.GetFeed(withPrincipal(ctx, env), from, toDay.AddDate(0, 0, 1).Format("2006-01-02"), layers)
	if err != nil {
		return userError(err)
	}
	limit := clampInt(in.Limit, 40, 1, 60)
	type item struct {
		Layer    string `json:"layer"`
		Kind     string `json:"kind"`
		When     string `json:"when"`
		Title    string `json:"title,omitempty"`
		Subtitle string `json:"subtitle,omitempty"`
		Status   string `json:"status,omitempty"`
		Amount   string `json:"amount,omitempty"`
		Count    *int64 `json:"count,omitempty"`
		RefKind  string `json:"ref_kind,omitempty"`
		RefUUID  string `json:"ref_uuid,omitempty"`
	}
	loc := env.loc()
	items := make([]item, 0, min(limit, len(feed.Items)))
	for _, f := range sortedFeed(feed.Items) {
		if len(items) >= limit {
			break
		}
		it := item{
			Layer: f.Layer, Kind: f.Kind, Title: DataText(f.Title, maxTextChars), Subtitle: DataText(f.Subtitle, maxTextChars),
			Status: f.Status, Count: f.Count, RefKind: f.RefKind,
		}
		if f.AllDay && f.StartDate != nil {
			it.When = *f.StartDate
			if f.EndDate != nil && *f.EndDate != *f.StartDate {
				it.When += " – " + *f.EndDate
			}
		} else {
			it.When = f.StartsAt.In(loc).Format("2006-01-02 15:04")
			if f.Layer == calendarusecase.LayerEvents {
				it.When += "–" + f.EndsAt.In(loc).Format("15:04")
			}
		}
		if f.Amount != nil && f.Currency != nil {
			it.Amount = FormatMoney(*f.Amount, *f.Currency)
		}
		if f.RefUUID != nil {
			it.RefUUID = f.RefUUID.String()
		}
		items = append(items, it)
	}
	out := map[string]any{
		"from": from, "to": toDay.Format("2006-01-02"), "total": len(feed.Items),
		"counts": feed.Counts, "items": items, "truncated": len(feed.Items) > len(items),
	}
	return JSONResult(out, "ai.tool_summary.calendar_found", map[string]any{"count": len(feed.Items)}), nil
}

// sortedFeed orders items by start (all-day first within a day).
func sortedFeed(items []calendarusecase.FeedItem) []calendarusecase.FeedItem {
	out := append([]calendarusecase.FeedItem(nil), items...)
	less := func(a, b calendarusecase.FeedItem) bool {
		if !a.StartsAt.Equal(b.StartsAt) {
			return a.StartsAt.Before(b.StartsAt)
		}
		return a.AllDay && !b.AllDay
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && less(out[j], out[j-1]); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// ---------------------------------------------------------------- create

// CreateCalendarEvent adds an event to the business calendar.
type CreateCalendarEvent struct{ calendar CalendarService }

var createCalendarEventSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"title":      map[string]any{"type": "string", "minLength": 2, "maxLength": 200, "description": "e.g. \"Tedarikçi toplantısı\"."},
		"date":       map[string]any{"type": "string", "format": "date", "description": "YYYY-MM-DD; resolve \"yarın\", \"cuma\" from the current date."},
		"start_time": map[string]any{"type": "string", "maxLength": 5, "description": "HH:MM (24h). Omit for an all-day event."},
		"end_time":   map[string]any{"type": "string", "maxLength": 5, "description": "HH:MM (24h), after start_time. Default start + 1 hour."},
		"end_date":   map[string]any{"type": "string", "format": "date", "description": "Last day of a multi-day all-day event."},
		"location":   map[string]any{"type": "string", "maxLength": 200},
		"notes":      map[string]any{"type": "string", "maxLength": 1000},
		"color":      map[string]any{"type": "string", "enum": calendarusecase.Colors},
	},
	"required":             []string{"title", "date"},
	"additionalProperties": false,
}

type createCalendarEventInput struct {
	Title     string `json:"title"`
	Date      string `json:"date"`
	StartTime string `json:"start_time,omitempty"`
	EndTime   string `json:"end_time,omitempty"`
	EndDate   string `json:"end_date,omitempty"`
	Location  string `json:"location,omitempty"`
	Notes     string `json:"notes,omitempty"`
	Color     string `json:"color,omitempty"`
}

// Spec implements Tool.
func (CreateCalendarEvent) Spec() Spec {
	return Spec{
		Name: "create_calendar_event",
		Description: "Propose adding an event (etkinlik, toplantı, randevu) to the business calendar, timed or all-day. " +
			"Use create_todo instead for tasks. Shows a confirmation card.",
		InputSchema:          createCalendarEventSchema,
		Permissions:          []string{rbac.PermTenantCalendarWrite},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// eventInput turns the normalized tool input into the use case input.
func (in createCalendarEventInput) eventInput(loc *time.Location) (calendarusecase.EventInput, error) {
	out := calendarusecase.EventInput{Title: in.Title, Description: in.Notes, Location: in.Location, Color: in.Color}
	if in.StartTime == "" {
		out.AllDay = true
		out.StartDate = &in.Date
		if in.EndDate != "" {
			out.EndDate = &in.EndDate
		}
		return out, nil
	}
	start, err := time.ParseInLocation("2006-01-02 15:04", in.Date+" "+in.StartTime, loc)
	if err != nil {
		return out, inputErr("start_time must be HH:MM")
	}
	end := start.Add(time.Hour)
	if in.EndTime != "" {
		if end, err = time.ParseInLocation("2006-01-02 15:04", in.Date+" "+in.EndTime, loc); err != nil {
			return out, inputErr("end_time must be HH:MM")
		}
		if !end.After(start) {
			return out, inputErr("end_time must be after start_time")
		}
	}
	s, e := start.Format(time.RFC3339), end.Format(time.RFC3339)
	out.StartsAt, out.EndsAt = &s, &e
	return out, nil
}

func (in createCalendarEventInput) whenLabel() string {
	if in.StartTime == "" {
		if in.EndDate != "" && in.EndDate != in.Date {
			return in.Date + " – " + in.EndDate
		}
		return in.Date
	}
	end := in.EndTime
	if end == "" {
		if t, err := time.Parse("15:04", in.StartTime); err == nil {
			end = t.Add(time.Hour).Format("15:04")
		}
	}
	return in.Date + " " + in.StartTime + "–" + end
}

// Propose implements ActionTool.
func (t CreateCalendarEvent) Propose(_ context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in createCalendarEventInput
	if err := decodeInput(createCalendarEventSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	in.Title, in.Location, in.Notes = trimmed(in.Title, 200), trimmed(in.Location, 200), trimmed(in.Notes, 1000)
	in.StartTime, in.EndTime, in.EndDate = strings.TrimSpace(in.StartTime), strings.TrimSpace(in.EndTime), strings.TrimSpace(in.EndDate)
	if in.Title == "" {
		return Proposal{}, inputErr("title is required")
	}
	date, err := dateOrToday(env, in.Date)
	if err != nil {
		return Proposal{}, err
	}
	in.Date = date
	if in.StartTime == "" {
		in.EndTime = ""
		if in.EndDate != "" {
			if _, err := dateOrToday(env, in.EndDate); err != nil {
				return Proposal{}, err
			}
			if in.EndDate < in.Date {
				return Proposal{}, inputErr("end_date must not be before date")
			}
		}
	} else {
		in.EndDate = ""
	}
	if _, err := in.eventInput(env.loc()); err != nil {
		return Proposal{}, err
	}
	fields := []Field{{Key: "when", Value: in.whenLabel()}}
	if in.Location != "" {
		fields = append(fields, Field{Key: "location", Value: in.Location})
	}
	if in.Notes != "" {
		fields = append(fields, Field{Key: "notes", Value: in.Notes})
	}
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "create_calendar_event", Title: in.Title, Fields: fields,
			Edit: []EditField{
				{Key: "title", Type: "text", Value: in.Title, Required: true},
				{Key: "date", Type: "date", Value: in.Date, Required: true},
				{Key: "start_time", Type: "time", Value: in.StartTime},
				{Key: "end_time", Type: "time", Value: in.EndTime},
				{Key: "location", Type: "text", Value: in.Location},
				{Key: "notes", Type: "textarea", Value: in.Notes},
			},
		},
	}, nil
}

// Run implements Tool.
func (t CreateCalendarEvent) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in createCalendarEventInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	ev, err := in.eventInput(env.loc())
	if err != nil {
		return execError(err)
	}
	e, err := t.calendar.CreateEvent(withPrincipal(ctx, env), env.Principal.UserInternal, ev, nil)
	if err != nil {
		return execError(err)
	}
	res := JSONResult(map[string]any{"done": true, "event_uuid": e.UUID.String(), "title": DataText(e.Title, maxTextChars), "when": in.whenLabel()},
		"ai.tool_summary.calendar_event_created", map[string]any{"title": Truncate(e.Title, 40)})
	res.Link = &Link{Kind: "calendar_event", UUID: e.UUID.String()}
	return res, nil
}
