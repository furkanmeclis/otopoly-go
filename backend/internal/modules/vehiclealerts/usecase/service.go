// Package usecase implements team vehicle alerts: when a vehicle is accepted,
// ready, delivered or cancelled, selected members get an in-app notification
// (with web push when they have it) and, if web push cannot reach them, a
// WhatsApp message from the business line — instantly or as a digest.
package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrInvalidRequest       = errors.New("vehiclealerts: invalid request")
	ErrWhatsAppNotConnected = errors.New("vehiclealerts: whatsapp is not connected")
)

const (
	maxRecipients = 20
	// Lines older than this are dropped instead of sent late (line was down).
	staleAfter       = 6 * time.Hour
	alertEventType   = "vehicle.alert"
	alertSubjectType = "vehicle_alert"
)

var allowedBatch = []int32{0, 30, 60}

// Sender delivers WhatsApp text through the organization's own line.
type Sender interface {
	WhatsAppConnected(ctx context.Context, orgID int64) (bool, error)
	QueueWhatsApp(ctx context.Context, orgID int64, phone, body, eventType, subjectType string) error
}

// InApp creates an in-app notification (the notifications module also sends
// web push to members who enabled it).
type InApp interface {
	NotifyMember(ctx context.Context, orgID, userID int64, title, body, actionURL string) error
}

type Service struct {
	q      *db.Queries
	sender Sender
	inapp  InApp
	log    *slog.Logger
}

func New(q *db.Queries, sender Sender, inapp InApp, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{q: q, sender: sender, inapp: inapp, log: log}
}

type Member struct {
	UUID     uuid.UUID `json:"uuid"`
	Name     string    `json:"name"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	HasPhone bool      `json:"has_phone"`
	HasPush  bool      `json:"has_push"`
}

type ServiceOption struct {
	UUID uuid.UUID `json:"uuid"`
	Name string    `json:"name"`
}

type Settings struct {
	Enabled            bool            `json:"enabled"`
	Events             []string        `json:"events"`
	ServiceUUIDs       []uuid.UUID     `json:"service_uuids"`
	RecipientUserUUIDs []uuid.UUID     `json:"recipient_user_uuids"`
	BatchMinutes       int32           `json:"batch_minutes"`
	WhatsAppConnected  bool            `json:"whatsapp_connected"`
	Members            []Member        `json:"members"`
	Services           []ServiceOption `json:"services"`
}

type UpdateInput struct {
	Enabled            bool        `json:"enabled"`
	Events             []string    `json:"events"`
	ServiceUUIDs       []uuid.UUID `json:"service_uuids"`
	RecipientUserUUIDs []uuid.UUID `json:"recipient_user_uuids"`
	BatchMinutes       int32       `json:"batch_minutes"`
}

type TestResult struct {
	InApp    int      `json:"in_app"`
	WhatsApp int      `json:"whatsapp"`
	Skipped  []string `json:"skipped"`
}

func (s *Service) GetSettings(ctx context.Context, orgID int64) (Settings, error) {
	row, err := s.loadSettings(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	members, err := s.q.ListVehicleAlertMembers(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	services, err := s.q.ListVehicleAlertServices(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	out := Settings{
		Enabled:            row.Enabled,
		Events:             row.Events,
		ServiceUUIDs:       []uuid.UUID{},
		RecipientUserUUIDs: []uuid.UUID{},
		BatchMinutes:       row.BatchMinutes,
		Members:            make([]Member, 0, len(members)),
		Services:           make([]ServiceOption, 0, len(services)),
	}
	for _, m := range members {
		out.Members = append(out.Members, Member{
			UUID: m.UserUuid, Name: strings.TrimSpace(m.Name + " " + m.Surname), Email: m.Email,
			Role: m.Role, HasPhone: strings.TrimSpace(m.Phone) != "", HasPush: m.HasPush,
		})
		if slices.Contains(row.RecipientUserIds, m.UserID) {
			out.RecipientUserUUIDs = append(out.RecipientUserUUIDs, m.UserUuid)
		}
	}
	for _, sv := range services {
		out.Services = append(out.Services, ServiceOption{UUID: sv.Uuid, Name: sv.Name})
		if slices.Contains(row.ServiceIds, sv.ID) {
			out.ServiceUUIDs = append(out.ServiceUUIDs, sv.Uuid)
		}
	}
	if s.sender != nil {
		if ok, err := s.sender.WhatsAppConnected(ctx, orgID); err == nil {
			out.WhatsAppConnected = ok
		}
	}
	return out, nil
}

func (s *Service) UpdateSettings(ctx context.Context, orgID int64, in UpdateInput) (Settings, error) {
	if !slices.Contains(allowedBatch, in.BatchMinutes) {
		return Settings{}, fmt.Errorf("%w: batch_minutes must be 0, 30 or 60", ErrInvalidRequest)
	}
	events := []string{}
	for _, e := range in.Events {
		if !slices.Contains(AllEvents, e) {
			return Settings{}, fmt.Errorf("%w: unknown event %q", ErrInvalidRequest, e)
		}
		if !slices.Contains(events, e) {
			events = append(events, e)
		}
	}
	if len(in.RecipientUserUUIDs) > maxRecipients {
		return Settings{}, fmt.Errorf("%w: at most %d recipients", ErrInvalidRequest, maxRecipients)
	}
	members, err := s.q.ListVehicleAlertMembers(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	recipientIDs := []int64{}
	for _, u := range in.RecipientUserUUIDs {
		idx := slices.IndexFunc(members, func(m db.ListVehicleAlertMembersRow) bool { return m.UserUuid == u })
		if idx < 0 {
			return Settings{}, fmt.Errorf("%w: recipient is not an active member", ErrInvalidRequest)
		}
		if !slices.Contains(recipientIDs, members[idx].UserID) {
			recipientIDs = append(recipientIDs, members[idx].UserID)
		}
	}
	services, err := s.q.ListVehicleAlertServices(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	serviceIDs := []int64{}
	for _, u := range in.ServiceUUIDs {
		idx := slices.IndexFunc(services, func(sv db.ListVehicleAlertServicesRow) bool { return sv.Uuid == u })
		if idx < 0 {
			return Settings{}, fmt.Errorf("%w: unknown service", ErrInvalidRequest)
		}
		if !slices.Contains(serviceIDs, services[idx].ID) {
			serviceIDs = append(serviceIDs, services[idx].ID)
		}
	}
	if in.Enabled && (len(recipientIDs) == 0 || len(events) == 0) {
		return Settings{}, fmt.Errorf("%w: select at least one recipient and one event", ErrInvalidRequest)
	}
	if _, err := s.q.UpsertVehicleAlertSettings(ctx, db.UpsertVehicleAlertSettingsParams{
		OrganizationID:   orgID,
		Enabled:          in.Enabled,
		Events:           events,
		ServiceIds:       serviceIDs,
		RecipientUserIds: recipientIDs,
		BatchMinutes:     in.BatchMinutes,
	}); err != nil {
		return Settings{}, err
	}
	return s.GetSettings(ctx, orgID)
}

// HandleJobEvent runs inside the jobs request (synchronous event bus): it only
// reads, creates in-app notifications and queues WhatsApp lines for the sweep.
func (s *Service) HandleJobEvent(ctx context.Context, event string, jobUUID uuid.UUID) error {
	job, err := s.q.GetVehicleAlertJob(ctx, jobUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	settings, err := s.q.GetVehicleAlertSettings(ctx, job.OrganizationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if !settings.Enabled || !slices.Contains(settings.Events, event) || len(settings.RecipientUserIds) == 0 {
		return nil
	}
	if len(settings.ServiceIds) > 0 && !slices.ContainsFunc(job.ServiceIds, func(id int64) bool {
		return slices.Contains(settings.ServiceIds, id)
	}) {
		return nil
	}

	info := JobInfo{
		Plate: job.Plate, CustomerName: job.CustomerName, Services: job.ServiceNames,
		PaymentStatus: job.PaymentStatus, Amount: num(job.TotalAmount),
	}
	title, detail := AlertText(event, info)
	actionURL := fmt.Sprintf("/t/%s/operations/%s", job.OrganizationSlug, job.Uuid)

	if s.inapp != nil {
		members, err := s.q.ListVehicleAlertMembers(ctx, job.OrganizationID)
		if err != nil {
			return err
		}
		for _, m := range members {
			if !slices.Contains(settings.RecipientUserIds, m.UserID) {
				continue
			}
			body := detail
			if m.Role == "owner" && info.Amount > 0 && event != EventCancelled {
				body = joinNonEmpty(" · ", detail, formatTRY(info.Amount))
			}
			if err := s.inapp.NotifyMember(ctx, job.OrganizationID, m.UserID, title, body, actionURL); err != nil {
				s.log.Warn("vehicle_alert_inapp_failed", "org_id", job.OrganizationID, "user_id", m.UserID, "error", err)
			}
		}
	}

	return s.q.InsertVehicleAlertEvent(ctx, db.InsertVehicleAlertEventParams{
		OrganizationID: job.OrganizationID,
		JobID:          job.ID,
		Event:          event,
		Line:           WhatsAppLine(event, info),
		Amount:         job.TotalAmount,
	})
}

// Flush is the minute sweep: sends queued lines over WhatsApp to recipients
// that web push cannot reach, per org, respecting the batch window.
func (s *Service) Flush(ctx context.Context) (int, error) {
	orgs, err := s.q.ListOrgsWithPendingVehicleAlerts(ctx)
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, st := range orgs {
		n, err := s.flushOrg(ctx, st)
		if err != nil {
			s.log.Error("vehicle_alert_flush_failed", "org_id", st.OrganizationID, "error", err)
			continue
		}
		sent += n
	}
	return sent, nil
}

func (s *Service) flushOrg(ctx context.Context, st db.VehicleAlertSetting) (int, error) {
	if s.sender == nil {
		return 0, nil
	}
	if ok, err := s.sender.WhatsAppConnected(ctx, st.OrganizationID); err != nil || !ok {
		return 0, err // keep lines pending until the line is back (or they go stale)
	}
	claimed, err := s.q.ClaimVehicleAlertFlush(ctx, st.OrganizationID)
	if err != nil || claimed == 0 {
		return 0, err
	}
	cutoff := time.Now().Add(-staleAfter)
	ts := pgtype.Timestamptz{Time: cutoff, Valid: true}
	if err := s.q.DropStaleVehicleAlertEvents(ctx, db.DropStaleVehicleAlertEventsParams{OrganizationID: st.OrganizationID, Before: ts}); err != nil {
		return 0, err
	}
	pending, err := s.q.ListPendingVehicleAlertEvents(ctx, db.ListPendingVehicleAlertEventsParams{OrganizationID: st.OrganizationID, Since: ts})
	if err != nil || len(pending) == 0 {
		return 0, err
	}
	lines := make([]PendingLine, 0, len(pending))
	ids := make([]int64, 0, len(pending))
	for _, e := range pending {
		lines = append(lines, PendingLine{Line: e.Line, Amount: num(e.Amount), Event: e.Event})
		ids = append(ids, e.ID)
	}
	org, err := s.q.GetOrganizationByID(ctx, st.OrganizationID)
	if err != nil {
		return 0, err
	}
	members, err := s.q.ListVehicleAlertMembers(ctx, st.OrganizationID)
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, m := range members {
		if !slices.Contains(st.RecipientUserIds, m.UserID) || m.HasPush || strings.TrimSpace(m.Phone) == "" {
			continue
		}
		body := Message(org.Name, lines, m.Role == "owner")
		if err := s.sender.QueueWhatsApp(ctx, st.OrganizationID, m.Phone, body, alertEventType, alertSubjectType); err != nil {
			s.log.Warn("vehicle_alert_whatsapp_failed", "org_id", st.OrganizationID, "user_id", m.UserID, "error", err)
			continue
		}
		sent++
	}
	if err := s.q.MarkVehicleAlertEventsSent(ctx, db.MarkVehicleAlertEventsSentParams{OrganizationID: st.OrganizationID, Ids: ids}); err != nil {
		return sent, err
	}
	return sent, nil
}

// SendTest sends a sample alert through the same channels to the saved
// recipients: in-app to everyone, WhatsApp to those without web push.
func (s *Service) SendTest(ctx context.Context, orgID int64) (TestResult, error) {
	row, err := s.loadSettings(ctx, orgID)
	if err != nil {
		return TestResult{}, err
	}
	if len(row.RecipientUserIds) == 0 {
		return TestResult{}, fmt.Errorf("%w: select and save at least one recipient", ErrInvalidRequest)
	}
	org, err := s.q.GetOrganizationByID(ctx, orgID)
	if err != nil {
		return TestResult{}, err
	}
	members, err := s.q.ListVehicleAlertMembers(ctx, orgID)
	if err != nil {
		return TestResult{}, err
	}
	sample := JobInfo{Plate: "34 TEST 34", CustomerName: "Örnek Müşteri", Services: []string{"Yıkama"}, Amount: 450}
	title, detail := AlertText(EventCreated, sample)
	title = "Test · " + title
	line := PendingLine{Line: "🧪 " + WhatsAppLine(EventCreated, sample), Amount: sample.Amount, Event: EventCreated}
	connected := false
	if s.sender != nil {
		connected, _ = s.sender.WhatsAppConnected(ctx, orgID)
	}
	res := TestResult{Skipped: []string{}}
	for _, m := range members {
		if !slices.Contains(row.RecipientUserIds, m.UserID) {
			continue
		}
		name := strings.TrimSpace(m.Name + " " + m.Surname)
		if s.inapp != nil {
			if err := s.inapp.NotifyMember(ctx, orgID, m.UserID, title, detail, fmt.Sprintf("/t/%s/operations", org.Slug)); err == nil {
				res.InApp++
			}
		}
		if m.HasPush {
			continue
		}
		if strings.TrimSpace(m.Phone) == "" || !connected {
			res.Skipped = append(res.Skipped, name)
			continue
		}
		body := Message(org.Name, []PendingLine{line}, m.Role == "owner")
		if err := s.sender.QueueWhatsApp(ctx, orgID, m.Phone, body, alertEventType, alertSubjectType); err != nil {
			res.Skipped = append(res.Skipped, name)
			continue
		}
		res.WhatsApp++
	}
	return res, nil
}

func (s *Service) loadSettings(ctx context.Context, orgID int64) (db.VehicleAlertSetting, error) {
	row, err := s.q.GetVehicleAlertSettings(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.VehicleAlertSetting{
			OrganizationID:   orgID,
			Events:           slices.Clone(DefaultEvents),
			ServiceIds:       []int64{},
			RecipientUserIds: []int64{},
		}, nil
	}
	return row, err
}

func joinNonEmpty(sep string, parts ...string) string {
	out := parts[:0:0]
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, sep)
}

func num(n pgtype.Numeric) float64 {
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return 0
	}
	return f.Float64
}
