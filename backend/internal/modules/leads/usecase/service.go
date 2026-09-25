// Package usecase implements tenant leads (potansiyel müşteri / fırsat):
// source, temperature, a new → contacted → quoted → won | lost workflow,
// follow-ups, assignee and an append-only timeline (lead_events).
package usecase

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	_ "time/tzdata" // Europe/Istanbul must resolve in minimal containers.

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourcemeta"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
)

// Limits.
const (
	MaxInterest = 300
	MaxVehicle  = 200
	MaxNotes    = 5000
	MaxNote     = 2000
	MaxReason   = 500
)

// Service is the leads use case.
type Service struct {
	pool  *pgxpool.Pool
	q     *db.Queries
	act   *activity.Recorder
	todos TodoCreator
	loc   *time.Location
	now   func() time.Time
}

// New builds the service with the no-op TodoCreator.
func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder) *Service {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Service{pool: pool, q: q, act: act, todos: NoopTodoCreator{}, loc: loc, now: time.Now}
}

// SetTodoCreator replaces the TodoCreator seam (nil restores the no-op).
func (s *Service) SetTodoCreator(t TodoCreator) {
	if t == nil {
		t = NoopTodoCreator{}
	}
	s.todos = t
}

// ResourceMeta returns list metadata.
func (s *Service) ResourceMeta() resourcemeta.ResourceMeta { return resourcemeta.TenantLeads() }

func (s *Service) requireOrg(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, errors.New("organization context required")
	}
	return scope.InternalID, nil
}

func actor(ctx context.Context) pgtype.Int8 {
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		return pgtype.Int8{Int64: p.UserInternal, Valid: true}
	}
	return pgtype.Int8{}
}

func (s *Service) record(ctx context.Context, action string, id uuid.UUID, payload map[string]any) {
	if s.act == nil {
		return
	}
	var a *int64
	if v := actor(ctx); v.Valid {
		x := v.Int64
		a = &x
	}
	s.act.Record(ctx, a, action, "lead", &id, payload, nil)
}

func (s *Service) today() time.Time {
	n := s.now().In(s.loc)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func optDate(d pgtype.Date) *string {
	if !d.Valid {
		return nil
	}
	v := d.Time.Format("2006-01-02")
	return &v
}

func optTime(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func optUUID(u pgtype.UUID) *uuid.UUID {
	if !u.Valid {
		return nil
	}
	id := uuid.UUID(u.Bytes)
	return &id
}

func parseDate(raw string) (pgtype.Date, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return pgtype.Date{}, nil
	}
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return pgtype.Date{}, fmt.Errorf("%w: invalid date %q (want yyyy-MM-dd)", ErrInvalidRequest, raw)
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}

func (s *Service) followUpState(d pgtype.Date, status string) string {
	if !d.Valid || !isOpen(status) {
		return "none"
	}
	today := s.today()
	switch {
	case d.Time.Before(today):
		return "overdue"
	case d.Time.Equal(today):
		return "today"
	default:
		return "upcoming"
	}
}

func isOpen(status string) bool {
	return status == "new" || status == "contacted" || status == "quoted"
}

func tooLong(s string, n int) bool { return len([]rune(s)) > n }

func checkEnum(field, v string, allowed []string) error {
	if !slices.Contains(allowed, v) {
		return fmt.Errorf("%w: %s must be one of %s", ErrInvalidRequest, field, strings.Join(allowed, ", "))
	}
	return nil
}

// ---------------------------------------------------------------- queries

// List returns leads.
func (s *Service) List(ctx context.Context, limit, offset int32, f ListFilters) ([]Lead, int64, error) {
	orgID, err := s.requireOrg(ctx)
	if err != nil {
		return nil, 0, err
	}
	sort := strings.TrimSpace(f.Sort)
	switch sort {
	case "", "-created_at", "created_at", "follow_up_date", "-follow_up_date", "-updated_at":
	default:
		return nil, 0, fmt.Errorf("%w: unsupported sort", ErrInvalidRequest)
	}
	p := db.ListLeadsParams{OrganizationID: orgID, Sort: sort, LimitCount: limit, OffsetCount: offset}
	if v := strings.TrimSpace(f.Status); v != "" {
		if v != "open" {
			if err := checkEnum("status", v, Statuses); err != nil {
				return nil, 0, err
			}
		}
		p.Status = pgtype.Text{String: v, Valid: true}
	}
	if v := strings.TrimSpace(f.Temperature); v != "" {
		if err := checkEnum("temperature", v, Temperatures); err != nil {
			return nil, 0, err
		}
		p.Temperature = pgtype.Text{String: v, Valid: true}
	}
	if v := strings.TrimSpace(f.Source); v != "" {
		if err := checkEnum("source", v, Sources); err != nil {
			return nil, 0, err
		}
		p.Source = pgtype.Text{String: v, Valid: true}
	}
	switch a := strings.TrimSpace(f.Assignee); a {
	case "":
	case "me":
		p.AssigneeID = actor(ctx)
		if !p.AssigneeID.Valid {
			return []Lead{}, 0, nil
		}
	default:
		id, err := uuid.Parse(a)
		if err != nil {
			return nil, 0, fmt.Errorf("%w: assignee must be me or a uuid", ErrInvalidRequest)
		}
		u, err := s.q.GetOrgMemberUser(ctx, db.GetOrgMemberUserParams{OrganizationID: orgID, Uuid: id})
		if err != nil {
			if isNoRows(err) {
				return []Lead{}, 0, nil
			}
			return nil, 0, err
		}
		p.AssigneeID = pgtype.Int8{Int64: u.ID, Valid: true}
	}
	today := pgtype.Date{Time: s.today(), Valid: true}
	switch strings.TrimSpace(f.FollowUp) {
	case "":
	case "overdue":
		p.FollowUpBefore = today
	case "today":
		p.FollowUpOn = today
	default:
		return nil, 0, fmt.Errorf("%w: follow_up must be overdue or today", ErrInvalidRequest)
	}
	if f.CustomerUUID != nil {
		c, err := s.q.GetOrgCustomerRef(ctx, db.GetOrgCustomerRefParams{OrganizationID: orgID, Uuid: *f.CustomerUUID})
		if err != nil {
			if isNoRows(err) {
				return []Lead{}, 0, nil
			}
			return nil, 0, err
		}
		p.CustomerID = pgtype.Int8{Int64: c.ID, Valid: true}
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		p.Q = pgtype.Text{String: q, Valid: true}
	}
	rows, err := s.q.ListLeads(ctx, p)
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountLeads(ctx, db.CountLeadsParams{
		OrganizationID: orgID, Status: p.Status, Temperature: p.Temperature, Source: p.Source,
		AssigneeID: p.AssigneeID, CustomerID: p.CustomerID, FollowUpBefore: p.FollowUpBefore,
		FollowUpOn: p.FollowUpOn, Q: p.Q,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Lead, 0, len(rows))
	for _, r := range rows {
		l := Lead{
			UUID: r.Uuid, CustomerUUID: r.CustomerUuid, CustomerName: r.CustomerName, CustomerPhone: r.CustomerPhone,
			VehiclePlate: r.VehiclePlate.String, VehicleText: r.VehicleText, Interest: r.Interest,
			Source: r.Source, Temperature: r.Temperature, Status: r.Status, LostReason: r.LostReason,
			FollowUpDate: optDate(r.FollowUpDate), FollowUpState: s.followUpState(r.FollowUpDate, r.Status),
			QuoteCount: r.QuoteCount, LastActivityAt: optTime(r.LastActivityAt),
			CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time,
		}
		if r.AssigneeUuid.Valid {
			l.Assignee = &Ref{UUID: uuid.UUID(r.AssigneeUuid.Bytes), Label: r.AssigneeName}
		}
		out = append(out, l)
	}
	return out, total, nil
}

// Summary returns open-lead counts.
func (s *Service) Summary(ctx context.Context) (Summary, error) {
	orgID, err := s.requireOrg(ctx)
	if err != nil {
		return Summary{}, err
	}
	today := s.today()
	row, err := s.q.LeadSummary(ctx, db.LeadSummaryParams{
		OrganizationID: orgID, Today: pgtype.Date{Time: today, Valid: true}, UserID: actor(ctx),
	})
	if err != nil {
		return Summary{}, err
	}
	return Summary{
		Open: row.Open, New: row.NewCount, Hot: row.Hot, Overdue: row.Overdue, DueToday: row.DueToday,
		Mine: row.Mine, Date: today.Format("2006-01-02"),
	}, nil
}

// Assignees lists active org members.
func (s *Service) Assignees(ctx context.Context) ([]Assignee, error) {
	orgID, err := s.requireOrg(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListOrgMemberOptions(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := make([]Assignee, 0, len(rows))
	for _, r := range rows {
		out = append(out, Assignee{UUID: r.Uuid, Label: r.Label, Role: r.Role})
	}
	return out, nil
}

// Get returns the lead with its quotes and timeline.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Detail, error) {
	orgID, err := s.requireOrg(ctx)
	if err != nil {
		return Detail{}, err
	}
	return s.load(ctx, orgID, id)
}

func (s *Service) load(ctx context.Context, orgID int64, id uuid.UUID) (Detail, error) {
	r, err := s.q.GetLeadDetail(ctx, db.GetLeadDetailParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if isNoRows(err) {
			return Detail{}, ErrNotFound
		}
		return Detail{}, err
	}
	quotes, err := s.q.ListLeadQuotes(ctx, db.ListLeadQuotesParams{LeadID: pgtype.Int8{Int64: r.ID, Valid: true}, OrganizationID: orgID})
	if err != nil {
		return Detail{}, err
	}
	events, err := s.q.ListLeadEvents(ctx, db.ListLeadEventsParams{LeadID: r.ID, OrganizationID: orgID, LimitCount: 200})
	if err != nil {
		return Detail{}, err
	}
	d := Detail{
		Lead: Lead{
			UUID: r.Uuid, CustomerUUID: r.CustomerUuid, CustomerName: r.CustomerName, CustomerPhone: r.CustomerPhone,
			VehiclePlate: r.VehiclePlate.String, VehicleText: r.VehicleText, Interest: r.Interest,
			Source: r.Source, Temperature: r.Temperature, Status: r.Status, LostReason: r.LostReason,
			FollowUpDate: optDate(r.FollowUpDate), FollowUpState: s.followUpState(r.FollowUpDate, r.Status),
			QuoteCount: int64(len(quotes)), CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time,
		},
		VehicleUUID: optUUID(r.VehicleUuid), Notes: r.Notes, CreatedByName: r.CreatedByName,
		ContactedAt: optTime(r.ContactedAt), ClosedAt: optTime(r.ClosedAt),
		Quotes: make([]LeadQuote, 0, len(quotes)), Events: make([]Event, 0, len(events)),
	}
	if r.AssigneeUuid.Valid {
		d.Assignee = &Ref{UUID: uuid.UUID(r.AssigneeUuid.Bytes), Label: r.AssigneeName}
	}
	for _, q := range quotes {
		d.Quotes = append(d.Quotes, LeadQuote{
			UUID: q.Uuid, Number: q.Number, Status: q.Status, GrandTotal: financeusecase.NumericToString(q.GrandTotal),
			Currency: q.Currency, ValidUntil: optDate(q.ValidUntil), CreatedAt: q.CreatedAt.Time,
		})
	}
	for _, e := range events {
		d.Events = append(d.Events, Event{
			UUID: e.Uuid, Kind: e.Kind, FromValue: e.FromValue, ToValue: e.ToValue, Body: e.Body,
			RefType: e.RefType, RefUUID: optUUID(e.RefUuid), RefLabel: e.RefLabel, ActorName: e.ActorName,
			CreatedAt: e.CreatedAt.Time,
		})
	}
	if len(d.Events) > 0 {
		t := d.Events[0].CreatedAt
		d.LastActivityAt = &t
	}
	return d, nil
}

// ---------------------------------------------------------------- mutations

func (s *Service) event(ctx context.Context, q *db.Queries, orgID, leadID int64, kind, from, to, body string) error {
	_, err := q.CreateLeadEvent(ctx, db.CreateLeadEventParams{
		OrganizationID: orgID, LeadID: leadID, Kind: kind, FromValue: truncate(from, 200),
		ToValue: truncate(to, 200), Body: body, ActorUserID: actor(ctx),
	})
	return err
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func (s *Service) resolveAssignee(ctx context.Context, orgID int64, id uuid.UUID) (pgtype.Int8, string, error) {
	u, err := s.q.GetOrgMemberUser(ctx, db.GetOrgMemberUserParams{OrganizationID: orgID, Uuid: id})
	if err != nil {
		if isNoRows(err) {
			return pgtype.Int8{}, "", fmt.Errorf("%w: assignee is not a member", ErrInvalidRequest)
		}
		return pgtype.Int8{}, "", err
	}
	return pgtype.Int8{Int64: u.ID, Valid: true}, u.Label, nil
}

func (s *Service) resolveVehicle(ctx context.Context, orgID, customerID int64, id uuid.UUID) (pgtype.Int8, error) {
	v, err := s.q.GetOrgCustomerVehicleRef(ctx, db.GetOrgCustomerVehicleRefParams{OrganizationID: orgID, Uuid: id})
	if err != nil {
		if isNoRows(err) {
			return pgtype.Int8{}, fmt.Errorf("%w: vehicle not found", ErrInvalidRequest)
		}
		return pgtype.Int8{}, err
	}
	if v.CustomerID != customerID {
		return pgtype.Int8{}, fmt.Errorf("%w: vehicle belongs to another customer", ErrInvalidRequest)
	}
	return pgtype.Int8{Int64: v.ID, Valid: true}, nil
}

// Create creates a lead for an existing organization customer.
func (s *Service) Create(ctx context.Context, in CreateInput) (Detail, error) {
	orgID, err := s.requireOrg(ctx)
	if err != nil {
		return Detail{}, err
	}
	if in.CustomerUUID == uuid.Nil {
		return Detail{}, fmt.Errorf("%w: customer_uuid is required", ErrInvalidRequest)
	}
	cust, err := s.q.GetOrgCustomerRef(ctx, db.GetOrgCustomerRefParams{OrganizationID: orgID, Uuid: in.CustomerUUID})
	if err != nil {
		if isNoRows(err) {
			return Detail{}, fmt.Errorf("%w: customer not found", ErrInvalidRequest)
		}
		return Detail{}, err
	}
	source := strings.TrimSpace(in.Source)
	if source == "" {
		source = "other"
	}
	if err := checkEnum("source", source, Sources); err != nil {
		return Detail{}, err
	}
	temp := strings.TrimSpace(in.Temperature)
	if temp == "" {
		temp = "warm"
	}
	if err := checkEnum("temperature", temp, Temperatures); err != nil {
		return Detail{}, err
	}
	interest, vtext, notes := strings.TrimSpace(in.Interest), strings.TrimSpace(in.VehicleText), strings.TrimSpace(in.Notes)
	if tooLong(interest, MaxInterest) || tooLong(vtext, MaxVehicle) || tooLong(notes, MaxNotes) {
		return Detail{}, fmt.Errorf("%w: text is too long", ErrInvalidRequest)
	}
	var follow pgtype.Date
	if in.FollowUpDate != nil {
		if follow, err = parseDate(*in.FollowUpDate); err != nil {
			return Detail{}, err
		}
	}
	var vehicle, assignee pgtype.Int8
	if in.VehicleUUID != nil && *in.VehicleUUID != uuid.Nil {
		if vehicle, err = s.resolveVehicle(ctx, orgID, cust.ID, *in.VehicleUUID); err != nil {
			return Detail{}, err
		}
	}
	if in.AssigneeUUID != nil && *in.AssigneeUUID != uuid.Nil {
		if assignee, _, err = s.resolveAssignee(ctx, orgID, *in.AssigneeUUID); err != nil {
			return Detail{}, err
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	row, err := q.CreateLead(ctx, db.CreateLeadParams{
		OrganizationID: orgID, CustomerID: cust.ID, VehicleID: vehicle, VehicleText: vtext, Interest: interest,
		Source: source, Temperature: temp, Notes: notes, FollowUpDate: follow, AssigneeUserID: assignee,
		CreatedBy: actor(ctx),
	})
	if err != nil {
		return Detail{}, err
	}
	if err := s.event(ctx, q, orgID, row.ID, "created", "", source, interest); err != nil {
		return Detail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	s.record(ctx, "tenant.lead.create", row.Uuid, map[string]any{"customer": cust.Name, "source": source})
	return s.load(ctx, orgID, row.Uuid)
}

type change struct{ kind, from, to string }

// Patch updates a lead and records a timeline entry per changed aspect.
func (s *Service) Patch(ctx context.Context, id uuid.UUID, in PatchInput) (Detail, error) {
	orgID, err := s.requireOrg(ctx)
	if err != nil {
		return Detail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	cur, err := q.GetLeadRowByUUIDForUpdate(ctx, db.GetLeadRowByUUIDForUpdateParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if isNoRows(err) {
			return Detail{}, ErrNotFound
		}
		return Detail{}, err
	}
	p := db.UpdateLeadParams{
		CustomerID: cur.CustomerID, VehicleID: cur.VehicleID, VehicleText: cur.VehicleText, Interest: cur.Interest,
		Source: cur.Source, Temperature: cur.Temperature, Status: cur.Status, LostReason: cur.LostReason,
		Notes: cur.Notes, FollowUpDate: cur.FollowUpDate, AssigneeUserID: cur.AssigneeUserID,
		ContactedAt: cur.ContactedAt, ClosedAt: cur.ClosedAt, ID: cur.ID, OrganizationID: orgID,
	}
	var changes []change
	updated := false

	if in.CustomerUUID != nil && *in.CustomerUUID != uuid.Nil {
		c, err := s.q.GetOrgCustomerRef(ctx, db.GetOrgCustomerRefParams{OrganizationID: orgID, Uuid: *in.CustomerUUID})
		if err != nil {
			if isNoRows(err) {
				return Detail{}, fmt.Errorf("%w: customer not found", ErrInvalidRequest)
			}
			return Detail{}, err
		}
		if c.ID != cur.CustomerID {
			p.CustomerID = c.ID
			p.VehicleID = pgtype.Int8{}
			updated = true
		}
	}
	if in.VehicleUUID != nil {
		if v := strings.TrimSpace(*in.VehicleUUID); v == "" {
			p.VehicleID = pgtype.Int8{}
		} else {
			vid, err := uuid.Parse(v)
			if err != nil {
				return Detail{}, fmt.Errorf("%w: vehicle_uuid is invalid", ErrInvalidRequest)
			}
			if p.VehicleID, err = s.resolveVehicle(ctx, orgID, p.CustomerID, vid); err != nil {
				return Detail{}, err
			}
		}
		updated = true
	}
	if in.VehicleText != nil {
		p.VehicleText = strings.TrimSpace(*in.VehicleText)
		updated = true
	}
	if in.Interest != nil {
		p.Interest = strings.TrimSpace(*in.Interest)
		updated = true
	}
	if in.Notes != nil {
		p.Notes = strings.TrimSpace(*in.Notes)
		updated = true
	}
	if tooLong(p.Interest, MaxInterest) || tooLong(p.VehicleText, MaxVehicle) || tooLong(p.Notes, MaxNotes) {
		return Detail{}, fmt.Errorf("%w: text is too long", ErrInvalidRequest)
	}
	if in.Source != nil {
		v := strings.TrimSpace(*in.Source)
		if err := checkEnum("source", v, Sources); err != nil {
			return Detail{}, err
		}
		if v != p.Source {
			changes = append(changes, change{"source_changed", p.Source, v})
			p.Source = v
		}
	}
	if in.Temperature != nil {
		v := strings.TrimSpace(*in.Temperature)
		if err := checkEnum("temperature", v, Temperatures); err != nil {
			return Detail{}, err
		}
		if v != p.Temperature {
			changes = append(changes, change{"temperature_changed", p.Temperature, v})
			p.Temperature = v
		}
	}
	if in.LostReason != nil {
		p.LostReason = truncate(strings.TrimSpace(*in.LostReason), MaxReason)
		updated = true
	}
	if in.Status != nil {
		v := strings.TrimSpace(*in.Status)
		if err := checkEnum("status", v, Statuses); err != nil {
			return Detail{}, err
		}
		if v != p.Status {
			changes = append(changes, change{"status_changed", p.Status, v})
			now := pgtype.Timestamptz{Time: s.now(), Valid: true}
			if v == "contacted" && !p.ContactedAt.Valid {
				p.ContactedAt = now
			}
			if v == "won" || v == "lost" {
				p.ClosedAt = now
			} else {
				p.ClosedAt = pgtype.Timestamptz{}
			}
			if v != "lost" && in.LostReason == nil {
				p.LostReason = ""
			}
			p.Status = v
		}
	}
	if in.FollowUpDate != nil {
		d, err := parseDate(*in.FollowUpDate)
		if err != nil {
			return Detail{}, err
		}
		if d != p.FollowUpDate {
			changes = append(changes, change{"follow_up_changed", derefDate(p.FollowUpDate), derefDate(d)})
			p.FollowUpDate = d
		}
	}
	if in.AssigneeUUID != nil {
		var next pgtype.Int8
		label := ""
		if v := strings.TrimSpace(*in.AssigneeUUID); v != "" {
			uid, err := uuid.Parse(v)
			if err != nil {
				return Detail{}, fmt.Errorf("%w: assignee_uuid is invalid", ErrInvalidRequest)
			}
			if next, label, err = s.resolveAssignee(ctx, orgID, uid); err != nil {
				return Detail{}, err
			}
		}
		if next != p.AssigneeUserID {
			prev := ""
			if p.AssigneeUserID.Valid {
				if u, err := s.q.GetUserByID(ctx, p.AssigneeUserID.Int64); err == nil {
					prev = strings.TrimSpace(u.Name + " " + u.Surname)
				}
			}
			changes = append(changes, change{"assignee_changed", prev, label})
			p.AssigneeUserID = next
		}
	}
	if !updated && len(changes) == 0 {
		return s.load(ctx, orgID, id)
	}
	if _, err := q.UpdateLead(ctx, p); err != nil {
		return Detail{}, err
	}
	for _, c := range changes {
		body := ""
		if c.kind == "status_changed" && c.to == "lost" {
			body = p.LostReason
		}
		if err := s.event(ctx, q, orgID, cur.ID, c.kind, c.from, c.to, body); err != nil {
			return Detail{}, err
		}
	}
	if updated && len(changes) == 0 {
		if err := s.event(ctx, q, orgID, cur.ID, "updated", "", "", ""); err != nil {
			return Detail{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	action := "tenant.lead.update"
	for _, c := range changes {
		if c.kind == "status_changed" {
			action = "tenant.lead.status"
		}
	}
	s.record(ctx, action, cur.Uuid, map[string]any{"status": p.Status, "temperature": p.Temperature})
	return s.load(ctx, orgID, id)
}

func derefDate(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format("2006-01-02")
}

// Delete soft-deletes a lead.
func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	orgID, err := s.requireOrg(ctx)
	if err != nil {
		return err
	}
	if _, err := s.q.SoftDeleteLead(ctx, db.SoftDeleteLeadParams{Uuid: id, OrganizationID: orgID}); err != nil {
		if isNoRows(err) {
			return ErrNotFound
		}
		return err
	}
	s.record(ctx, "tenant.lead.delete", id, nil)
	return nil
}

// AddNote appends a free note to the timeline.
func (s *Service) AddNote(ctx context.Context, id uuid.UUID, in NoteInput) (Detail, error) {
	orgID, err := s.requireOrg(ctx)
	if err != nil {
		return Detail{}, err
	}
	body := strings.TrimSpace(in.Body)
	if body == "" {
		return Detail{}, fmt.Errorf("%w: note is required", ErrInvalidRequest)
	}
	if tooLong(body, MaxNote) {
		return Detail{}, fmt.Errorf("%w: note is too long", ErrInvalidRequest)
	}
	row, err := s.q.GetLeadRowByUUID(ctx, db.GetLeadRowByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if isNoRows(err) {
			return Detail{}, ErrNotFound
		}
		return Detail{}, err
	}
	if err := s.event(ctx, s.q, orgID, row.ID, "note", "", "", body); err != nil {
		return Detail{}, err
	}
	s.record(ctx, "tenant.lead.note", row.Uuid, nil)
	return s.load(ctx, orgID, id)
}

// CreateTodo creates a todo from the lead through the TodoCreator seam and
// records it on the timeline.
func (s *Service) CreateTodo(ctx context.Context, id uuid.UUID, in TodoInput) (TodoResult, error) {
	orgID, err := s.requireOrg(ctx)
	if err != nil {
		return TodoResult{}, err
	}
	d, err := s.load(ctx, orgID, id)
	if err != nil {
		return TodoResult{}, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = fmt.Sprintf("%s — takip", d.CustomerName)
	}
	if tooLong(title, 200) || tooLong(in.Notes, MaxNote) {
		return TodoResult{}, fmt.Errorf("%w: text is too long", ErrInvalidRequest)
	}
	assignee := in.AssigneeUUID
	if assignee == nil && d.Assignee != nil {
		a := d.Assignee.UUID
		assignee = &a
	}
	if assignee != nil && *assignee != uuid.Nil {
		if _, _, err := s.resolveAssignee(ctx, orgID, *assignee); err != nil {
			return TodoResult{}, err
		}
	}
	due := in.DueDate
	if due == nil {
		due = d.FollowUpDate
	}
	row, err := s.q.GetLeadRowByUUID(ctx, db.GetLeadRowByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		return TodoResult{}, err
	}
	todo, err := s.todos.CreateTodoForLead(ctx, TodoRequest{
		OrganizationID: orgID, LeadID: row.ID, LeadUUID: row.Uuid, CustomerUUID: d.CustomerUUID,
		Title: title, Notes: strings.TrimSpace(in.Notes), DueDate: due, DueTime: in.DueTime, AssigneeUUID: assignee,
	})
	if err != nil {
		return TodoResult{}, err
	}
	if _, err := s.q.CreateLeadEvent(ctx, db.CreateLeadEventParams{
		OrganizationID: orgID, LeadID: row.ID, Kind: "todo_created", RefType: "todo",
		RefUuid: pgtype.UUID{Bytes: todo.UUID, Valid: todo.UUID != uuid.Nil}, RefLabel: truncate(todo.Title, 200),
		ActorUserID: actor(ctx),
	}); err != nil {
		return TodoResult{}, err
	}
	s.record(ctx, "tenant.lead.todo", row.Uuid, map[string]any{"todo": todo.UUID.String()})
	detail, err := s.load(ctx, orgID, id)
	if err != nil {
		return TodoResult{}, err
	}
	return TodoResult{TodoUUID: todo.UUID, Title: todo.Title, Lead: detail}, nil
}
