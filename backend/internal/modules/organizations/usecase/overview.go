package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	billingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/usecase"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// BillingSource is the billing slice the platform organization detail needs.
type BillingSource interface {
	OrganizationBilling(ctx context.Context, orgID int64) (billingusecase.OrganizationBilling, error)
	ExtendLiveSubscription(ctx context.Context, orgID int64, days int, note string) (time.Time, bool, error)
}

// WhatsAppSource is the messaging slice the platform organization detail needs.
type WhatsAppSource interface {
	GetSession(ctx context.Context, orgID int64) (messagingmodel.WhatsAppSession, error)
	ListOutbound(ctx context.Context, orgID int64, limit, offset int32) ([]messagingmodel.OutboundMessage, int64, error)
}

// SetOverviewSources wires billing and messaging (built after this service).
func (s *Service) SetOverviewSources(billing BillingSource, whatsapp WhatsAppSource) {
	s.billingSrc = billing
	s.whatsapp = whatsapp
}

// outboundSummaryWindow is the "recent sends" window on the overview.
const outboundSummaryWindow = 30 * 24 * time.Hour

// MaxAccessExtensionDays bounds a single extend-access call.
const MaxAccessExtensionDays = 3650

// Overview is the platform 360° view of one organization.
type Overview struct {
	Organization Organization                        `json:"organization"`
	Stats        OrganizationStats                   `json:"stats"`
	Billing      *billingusecase.OrganizationBilling `json:"billing"`
	WhatsApp     *WhatsAppOverview                   `json:"whatsapp"`
}

// OrganizationStats are record counts and the latest observed activity.
type OrganizationStats struct {
	Customers      int64      `json:"customers"`
	Jobs           int64      `json:"jobs"`
	Quotes         int64      `json:"quotes"`
	Contracts      int64      `json:"contracts"`
	Members        int64      `json:"members"`
	LastActivityAt *time.Time `json:"last_activity_at"`
}

// WhatsAppSessionSummary is the own-number session without pairing secrets
// (no QR code, no keys).
type WhatsAppSessionSummary struct {
	Status                  string     `json:"status"`
	PhoneNumber             string     `json:"phone_number,omitempty"`
	DisplayName             string     `json:"display_name,omitempty"`
	LastSeenAt              *time.Time `json:"last_seen_at,omitempty"`
	ErrorMessage            string     `json:"error_message,omitempty"`
	OwnNumberEntitled       bool       `json:"own_number_entitled"`
	FallbackToPlatform      bool       `json:"fallback_to_platform"`
	PlatformSenderAvailable bool       `json:"platform_sender_available"`
}

// OutboundSummary counts outbound messages in the overview window.
type OutboundSummary struct {
	Since     time.Time  `json:"since"`
	Total     int64      `json:"total"`
	Sent      int64      `json:"sent"`
	Delivered int64      `json:"delivered"`
	Failed    int64      `json:"failed"`
	OwnNumber int64      `json:"own_number"`
	Platform  int64      `json:"platform"`
	LastAt    *time.Time `json:"last_at"`
}

// WhatsAppOverview is the WhatsApp part of the overview.
type WhatsAppOverview struct {
	Session  WhatsAppSessionSummary `json:"session"`
	Outbound OutboundSummary        `json:"outbound"`
}

// ActivityActor is who performed an organization activity event.
type ActivityActor struct {
	UUID    uuid.UUID `json:"uuid"`
	Email   string    `json:"email"`
	Name    string    `json:"name"`
	Surname string    `json:"surname"`
}

// ActivityEntry is an audit event attributed to an organization.
type ActivityEntry struct {
	UUID         uuid.UUID      `json:"uuid"`
	Action       string         `json:"action"`
	Resource     string         `json:"resource"`
	ResourceUUID *uuid.UUID     `json:"resource_uuid,omitempty"`
	Payload      map[string]any `json:"payload"`
	Actor        *ActivityActor `json:"actor"`
	CreatedAt    time.Time      `json:"created_at"`
}

func (s *Service) organizationRow(ctx context.Context, id uuid.UUID) (db.Organization, error) {
	row, err := s.q.GetOrganizationByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Organization{}, ErrNotFound
		}
		return db.Organization{}, err
	}
	return row, nil
}

// Overview aggregates profile, stats, billing and WhatsApp for one organization.
func (s *Service) Overview(ctx context.Context, id uuid.UUID) (Overview, error) {
	org, err := s.organizationRow(ctx, id)
	if err != nil {
		return Overview{}, err
	}
	stats, err := s.q.GetOrganizationPlatformStats(ctx, org.ID)
	if err != nil {
		return Overview{}, fmt.Errorf("organization stats: %w", err)
	}
	out := Overview{
		Organization: mapOrganization(org),
		Stats: OrganizationStats{
			Customers: stats.CustomersCount, Jobs: stats.JobsCount, Quotes: stats.QuotesCount,
			Contracts: stats.ContractsCount, Members: stats.MembersCount,
			LastActivityAt: timePtr(stats.LastActivityAt),
		},
	}
	if s.billingSrc != nil {
		billing, err := s.billingSrc.OrganizationBilling(ctx, org.ID)
		if err != nil {
			return Overview{}, fmt.Errorf("organization billing: %w", err)
		}
		out.Billing = &billing
	}
	if s.whatsapp != nil {
		wa, err := s.whatsAppOverview(ctx, org.ID)
		if err != nil {
			return Overview{}, err
		}
		out.WhatsApp = &wa
	}
	return out, nil
}

func (s *Service) whatsAppOverview(ctx context.Context, orgID int64) (WhatsAppOverview, error) {
	session, err := s.whatsapp.GetSession(ctx, orgID)
	if err != nil {
		return WhatsAppOverview{}, fmt.Errorf("organization whatsapp session: %w", err)
	}
	since := time.Now().UTC().Add(-outboundSummaryWindow)
	sum, err := s.q.SummarizeOutboundMessagesByOrg(ctx, db.SummarizeOutboundMessagesByOrgParams{
		OrganizationID: orgID, Since: pgtype.Timestamptz{Time: since, Valid: true},
	})
	if err != nil {
		return WhatsAppOverview{}, fmt.Errorf("organization outbound summary: %w", err)
	}
	return WhatsAppOverview{
		Session: WhatsAppSessionSummary{
			Status: session.Status, PhoneNumber: session.PhoneNumber, DisplayName: session.DisplayName,
			LastSeenAt: session.LastSeenAt, ErrorMessage: session.ErrorMessage,
			OwnNumberEntitled: session.OwnNumberEntitled, FallbackToPlatform: session.FallbackToPlatform,
			PlatformSenderAvailable: session.PlatformSenderAvailable,
		},
		Outbound: OutboundSummary{
			Since: since, Total: sum.Total, Sent: sum.Sent, Delivered: sum.Delivered, Failed: sum.Failed,
			OwnNumber: sum.OwnNumber, Platform: sum.Platform, LastAt: timePtr(sum.LastAt),
		},
	}, nil
}

// ListOutbound pages the organization's outbound messages (newest first).
func (s *Service) ListOutbound(ctx context.Context, id uuid.UUID, limit, offset int32) ([]messagingmodel.OutboundMessage, int64, error) {
	org, err := s.organizationRow(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	if s.whatsapp == nil {
		return []messagingmodel.OutboundMessage{}, 0, nil
	}
	return s.whatsapp.ListOutbound(ctx, org.ID, limit, offset)
}

// ListActivity pages audit events attributed to the organization.
func (s *Service) ListActivity(ctx context.Context, id uuid.UUID, limit, offset int32, action, search string) ([]ActivityEntry, int64, error) {
	org, err := s.organizationRow(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	orgID := pgtype.Int8{Int64: org.ID, Valid: true}
	actionArg := optionalText(action)
	qArg := optionalText(search)
	rows, err := s.q.ListActivityEventsForOrganization(ctx, db.ListActivityEventsForOrganizationParams{
		OrganizationID: orgID, Action: actionArg, Q: qArg, LimitCount: limit, OffsetCount: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountActivityEventsForOrganization(ctx, db.CountActivityEventsForOrganizationParams{
		OrganizationID: orgID, Action: actionArg, Q: qArg,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]ActivityEntry, 0, len(rows))
	for _, row := range rows {
		entry := ActivityEntry{
			UUID: row.Uuid, Action: row.Action, Resource: row.Resource, CreatedAt: row.CreatedAt.Time,
			Payload: map[string]any{},
		}
		_ = json.Unmarshal(row.Payload, &entry.Payload)
		if row.ResourceUuid.Valid {
			ru := uuid.UUID(row.ResourceUuid.Bytes)
			entry.ResourceUUID = &ru
		}
		if row.ActorUuid.Valid {
			entry.Actor = &ActivityActor{
				UUID: uuid.UUID(row.ActorUuid.Bytes), Email: row.ActorEmail.String, Name: row.ActorName.String, Surname: row.ActorSurname.String,
			}
		}
		out = append(out, entry)
	}
	return out, total, nil
}

// SetStatus suspends or re-activates an organization (platform admin).
// Setting the current status again is a no-op without an audit event.
func (s *Service) SetStatus(ctx context.Context, id uuid.UUID, status, reason string) (Organization, error) {
	status = strings.TrimSpace(status)
	if status != "active" && status != "suspended" {
		return Organization{}, fmt.Errorf("%w: status must be active or suspended", ErrInvalidRequest)
	}
	current, err := s.organizationRow(ctx, id)
	if err != nil {
		return Organization{}, err
	}
	if current.Status == status {
		return mapOrganization(current), nil
	}
	row, err := s.q.SetOrganizationStatusPlatform(ctx, db.SetOrganizationStatusPlatformParams{Status: status, Uuid: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Organization{}, ErrNotFound
		}
		return Organization{}, err
	}
	action := "organizations.activated"
	if status == "suspended" {
		action = "organizations.suspended"
	}
	payload := map[string]any{"from": current.Status, "to": status}
	if reason = strings.TrimSpace(reason); reason != "" {
		payload["reason"] = reason
	}
	s.recordActivity(ctx, action, row, payload)
	return mapOrganization(row), nil
}

// ExtendAccess moves the organization's access end forward by days from
// max(now, current end). With a live billing subscription the subscription
// is extended too (it owns the access window); an expired organization is
// re-activated, a suspended one stays suspended.
func (s *Service) ExtendAccess(ctx context.Context, id uuid.UUID, days int, note string) (Organization, error) {
	if days < 1 || days > MaxAccessExtensionDays {
		return Organization{}, fmt.Errorf("%w: days must be between 1 and %d", ErrInvalidRequest, MaxAccessExtensionDays)
	}
	note = strings.TrimSpace(note)
	current, err := s.organizationRow(ctx, id)
	if err != nil {
		return Organization{}, err
	}
	if !current.AccessEndsAt.Valid {
		return Organization{}, fmt.Errorf("%w: organization access is unlimited", ErrInvalidRequest)
	}
	endsAt, viaSubscription := ExtendedAccessEnd(current.AccessEndsAt.Time, time.Now().UTC(), days), false
	if s.billingSrc != nil {
		subNote := fmt.Sprintf("platform: access extended by %d days", days)
		if note != "" {
			subNote += ": " + note
		}
		subEnd, ok, err := s.billingSrc.ExtendLiveSubscription(ctx, current.ID, days, subNote)
		if err != nil {
			return Organization{}, err
		}
		if ok {
			endsAt, viaSubscription = subEnd, true
		}
	}
	row, err := s.q.SetOrganizationAccessEndPlatform(ctx, db.SetOrganizationAccessEndPlatformParams{
		AccessEndsAt: pgtype.Timestamptz{Time: endsAt, Valid: true}, Uuid: id,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Organization{}, ErrNotFound
		}
		return Organization{}, err
	}
	payload := map[string]any{
		"days": days, "from": current.AccessEndsAt.Time, "to": endsAt, "via_subscription": viaSubscription,
	}
	if current.Status != row.Status {
		payload["status_from"], payload["status_to"] = current.Status, row.Status
	}
	if note != "" {
		payload["note"] = note
	}
	s.recordActivity(ctx, "organizations.access_extended", row, payload)
	return mapOrganization(row), nil
}

// ExtendedAccessEnd is max(now, currentEnd) + days.
func ExtendedAccessEnd(currentEnd, now time.Time, days int) time.Time {
	base := now
	if currentEnd.After(now) {
		base = currentEnd
	}
	return base.AddDate(0, 0, days)
}

func timePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func optionalText(s string) pgtype.Text {
	s = strings.TrimSpace(s)
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}
