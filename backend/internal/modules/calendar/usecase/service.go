// Package usecase is the organization calendar: own events plus a live feed of
// dated records from other modules (jobs, todos, quotes, leads, sales, …).
package usecase

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
)

// Colors an event may use; mirrors chk_calendar_events_color.
var Colors = []string{"blue", "emerald", "amber", "rose", "violet", "sky", "orange", "teal", "pink", "slate"}

// maxRangeDays caps one feed request (a 6-week month grid plus slack).
const maxRangeDays = 62

// Store is the persistence boundary (sqlc queries).
type Store interface {
	CreateCalendarEvent(ctx context.Context, arg db.CreateCalendarEventParams) (db.CalendarEvent, error)
	GetCalendarEventByUUID(ctx context.Context, arg db.GetCalendarEventByUUIDParams) (db.CalendarEvent, error)
	UpdateCalendarEvent(ctx context.Context, arg db.UpdateCalendarEventParams) (db.CalendarEvent, error)
	SoftDeleteCalendarEvent(ctx context.Context, arg db.SoftDeleteCalendarEventParams) (db.CalendarEvent, error)
	ListCalendarEventsInRange(ctx context.Context, arg db.ListCalendarEventsInRangeParams) ([]db.CalendarEvent, error)
	CalendarJobsOpened(ctx context.Context, arg db.CalendarJobsOpenedParams) ([]db.CalendarJobsOpenedRow, error)
	CalendarJobsDelivered(ctx context.Context, arg db.CalendarJobsDeliveredParams) ([]db.CalendarJobsDeliveredRow, error)
	CalendarTodos(ctx context.Context, arg db.CalendarTodosParams) ([]db.CalendarTodosRow, error)
	CalendarQuotesExpiring(ctx context.Context, arg db.CalendarQuotesExpiringParams) ([]db.CalendarQuotesExpiringRow, error)
	CalendarLeadFollowUps(ctx context.Context, arg db.CalendarLeadFollowUpsParams) ([]db.CalendarLeadFollowUpsRow, error)
	CalendarFinanceDaily(ctx context.Context, arg db.CalendarFinanceDailyParams) ([]db.CalendarFinanceDailyRow, error)
	CalendarSales(ctx context.Context, arg db.CalendarSalesParams) ([]db.CalendarSalesRow, error)
	CalendarPurchases(ctx context.Context, arg db.CalendarPurchasesParams) ([]db.CalendarPurchasesRow, error)
	CalendarContracts(ctx context.Context, arg db.CalendarContractsParams) ([]db.CalendarContractsRow, error)
}

type Service struct {
	q     Store
	act   *activity.Recorder
	ent   *entitlements.Service
	todos TodoScheduler
	leads LeadScheduler
	loc   *time.Location
	now   func() time.Time
}

// New creates the service. ent may be nil (every module counts as enabled).
func New(q Store, act *activity.Recorder, ent *entitlements.Service) *Service {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Service{q: q, act: act, ent: ent, loc: loc, now: time.Now}
}

// SetSchedulers wires the modules whose dates the calendar may move (drag
// and drop). Without them those layers are read-only.
func (s *Service) SetSchedulers(todos TodoScheduler, leads LeadScheduler) {
	s.todos, s.leads = todos, leads
}

// SetClock overrides time.Now (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// Location is the business time zone used for dates and all-day items.
func (s *Service) Location() *time.Location { return s.loc }

// Event is an organization calendar event. For all-day events StartDate/EndDate
// (inclusive) carry the days; StartsAt/EndsAt are business-time midnights.
type Event struct {
	UUID        uuid.UUID `json:"uuid"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Location    string    `json:"location"`
	StartsAt    time.Time `json:"starts_at"`
	EndsAt      time.Time `json:"ends_at"`
	AllDay      bool      `json:"all_day"`
	StartDate   *string   `json:"start_date,omitempty"`
	EndDate     *string   `json:"end_date,omitempty"`
	Color       string    `json:"color"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// EventInput creates or replaces an event. Timed events use StartsAt/EndsAt
// (RFC 3339); all-day events use StartDate/EndDate (YYYY-MM-DD, inclusive).
type EventInput struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Location    string  `json:"location"`
	AllDay      bool    `json:"all_day"`
	StartsAt    *string `json:"starts_at"`
	EndsAt      *string `json:"ends_at"`
	StartDate   *string `json:"start_date"`
	EndDate     *string `json:"end_date"`
	Color       string  `json:"color"`
}

type eventFields struct {
	title, description, location, color string
	start, end                          time.Time
	allDay                              bool
}

func (s *Service) parseEvent(in EventInput) (eventFields, error) {
	f := eventFields{
		title:       strings.TrimSpace(in.Title),
		description: strings.TrimSpace(in.Description),
		location:    strings.TrimSpace(in.Location),
		color:       strings.TrimSpace(in.Color),
		allDay:      in.AllDay,
	}
	if f.title == "" {
		return f, fmt.Errorf("%w: title is required", ErrInvalidRequest)
	}
	if len([]rune(f.title)) > 200 || len([]rune(f.location)) > 200 {
		return f, fmt.Errorf("%w: title and location are limited to 200 characters", ErrInvalidRequest)
	}
	if f.color == "" {
		f.color = "blue"
	}
	if !validColor(f.color) {
		return f, fmt.Errorf("%w: invalid color", ErrInvalidRequest)
	}
	if f.allDay {
		if in.StartDate == nil || *in.StartDate == "" {
			return f, fmt.Errorf("%w: start_date is required for all-day events", ErrInvalidRequest)
		}
		start, err := time.ParseInLocation("2006-01-02", *in.StartDate, s.loc)
		if err != nil {
			return f, fmt.Errorf("%w: invalid start_date", ErrInvalidRequest)
		}
		last := start
		if in.EndDate != nil && *in.EndDate != "" {
			if last, err = time.ParseInLocation("2006-01-02", *in.EndDate, s.loc); err != nil {
				return f, fmt.Errorf("%w: invalid end_date", ErrInvalidRequest)
			}
		}
		if last.Before(start) {
			return f, fmt.Errorf("%w: end_date is before start_date", ErrInvalidRequest)
		}
		f.start, f.end = start, last.AddDate(0, 0, 1)
		return f, nil
	}
	if in.StartsAt == nil || in.EndsAt == nil {
		return f, fmt.Errorf("%w: starts_at and ends_at are required", ErrInvalidRequest)
	}
	start, err := time.Parse(time.RFC3339, *in.StartsAt)
	if err != nil {
		return f, fmt.Errorf("%w: invalid starts_at", ErrInvalidRequest)
	}
	end, err := time.Parse(time.RFC3339, *in.EndsAt)
	if err != nil {
		return f, fmt.Errorf("%w: invalid ends_at", ErrInvalidRequest)
	}
	if !end.After(start) {
		return f, fmt.Errorf("%w: ends_at must be after starts_at", ErrInvalidRequest)
	}
	if end.Sub(start) > 31*24*time.Hour {
		return f, fmt.Errorf("%w: an event can last at most 31 days", ErrInvalidRequest)
	}
	f.start, f.end = start, end
	return f, nil
}

func validColor(c string) bool {
	for _, v := range Colors {
		if v == c {
			return true
		}
	}
	return false
}

func (s *Service) mapEvent(row db.CalendarEvent) Event {
	e := Event{
		UUID: row.Uuid, Title: row.Title, Description: row.Description, Location: row.Location,
		StartsAt: row.StartsAt.Time, EndsAt: row.EndsAt.Time, AllDay: row.AllDay, Color: row.Color,
		CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	}
	if row.AllDay {
		start := row.StartsAt.Time.In(s.loc).Format("2006-01-02")
		end := row.EndsAt.Time.In(s.loc).AddDate(0, 0, -1).Format("2006-01-02")
		e.StartDate, e.EndDate = &start, &end
	}
	return e
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

// errNoOrganization guards calls made without an organization scope.
var errNoOrganization = errors.New("calendar: organization scope missing")

func orgID(ctx context.Context) (int64, error) {
	sc, ok := orgctx.ScopeFrom(ctx)
	if !ok || sc.InternalID == 0 {
		return 0, errNoOrganization
	}
	return sc.InternalID, nil
}

func (s *Service) CreateEvent(ctx context.Context, actorID int64, in EventInput, req *http.Request) (Event, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Event{}, err
	}
	f, err := s.parseEvent(in)
	if err != nil {
		return Event{}, err
	}
	createdBy := pgtype.Int8{}
	if actorID > 0 {
		createdBy = pgtype.Int8{Int64: actorID, Valid: true}
	}
	row, err := s.q.CreateCalendarEvent(ctx, db.CreateCalendarEventParams{
		OrganizationID: org, Title: f.title, Description: f.description,
		Location: f.location, StartsAt: ts(f.start), EndsAt: ts(f.end), AllDay: f.allDay, Color: f.color,
		CreatedBy: createdBy,
	})
	if err != nil {
		return Event{}, err
	}
	s.record(ctx, actorID, "calendar.event.create", row.Uuid, row.Title, req)
	return s.mapEvent(row), nil
}

func (s *Service) GetEvent(ctx context.Context, id uuid.UUID) (Event, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Event{}, err
	}
	row, err := s.q.GetCalendarEventByUUID(ctx, db.GetCalendarEventByUUIDParams{Uuid: id, OrganizationID: org})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Event{}, ErrNotFound
		}
		return Event{}, err
	}
	return s.mapEvent(row), nil
}

func (s *Service) UpdateEvent(ctx context.Context, actorID int64, id uuid.UUID, in EventInput, req *http.Request) (Event, error) {
	org, err := orgID(ctx)
	if err != nil {
		return Event{}, err
	}
	f, err := s.parseEvent(in)
	if err != nil {
		return Event{}, err
	}
	return s.saveEvent(ctx, org, actorID, id, f, req)
}

func (s *Service) saveEvent(ctx context.Context, org, actorID int64, id uuid.UUID, f eventFields, req *http.Request) (Event, error) {
	row, err := s.q.UpdateCalendarEvent(ctx, db.UpdateCalendarEventParams{
		Uuid: id, OrganizationID: org, Title: f.title, Description: f.description,
		Location: f.location, StartsAt: ts(f.start), EndsAt: ts(f.end), AllDay: f.allDay, Color: f.color,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Event{}, ErrNotFound
		}
		return Event{}, err
	}
	s.record(ctx, actorID, "calendar.event.update", row.Uuid, row.Title, req)
	return s.mapEvent(row), nil
}

func (s *Service) DeleteEvent(ctx context.Context, actorID int64, id uuid.UUID, req *http.Request) error {
	org, err := orgID(ctx)
	if err != nil {
		return err
	}
	row, err := s.q.SoftDeleteCalendarEvent(ctx, db.SoftDeleteCalendarEventParams{Uuid: id, OrganizationID: org})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	s.record(ctx, actorID, "calendar.event.delete", row.Uuid, row.Title, req)
	return nil
}

func (s *Service) record(ctx context.Context, actorID int64, action string, id uuid.UUID, title string, req *http.Request) {
	if s.act == nil {
		return
	}
	var actor *int64
	if actorID > 0 {
		actor = &actorID
	}
	s.act.Record(ctx, actor, action, "calendar.event", &id, map[string]any{"title": title}, req)
}

// Meta is static calendar metadata for clients (layers this member may see,
// event colours, business time zone, feed range cap).
type Meta struct {
	Layers       []LayerInfo `json:"layers"`
	Colors       []string    `json:"colors"`
	Timezone     string      `json:"timezone"`
	MaxRangeDays int         `json:"max_range_days"`
}

// GetMeta returns the calendar metadata for the caller.
func (s *Service) GetMeta(ctx context.Context) (Meta, error) {
	layers, err := s.Available(ctx)
	if err != nil {
		return Meta{}, err
	}
	return Meta{Layers: layers, Colors: Colors, Timezone: s.loc.String(), MaxRangeDays: maxRangeDays}, nil
}
