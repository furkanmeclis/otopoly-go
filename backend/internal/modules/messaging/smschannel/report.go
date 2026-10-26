package smschannel

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/sms"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// maxReportDays bounds a report range.
const maxReportDays = 366

// ReportQuerier is the persistence surface of the platform SMS report.
type ReportQuerier interface {
	SMSReportByProvider(ctx context.Context, arg db.SMSReportByProviderParams) ([]db.SMSReportByProviderRow, error)
	SMSReportDaily(ctx context.Context, arg db.SMSReportDailyParams) ([]db.SMSReportDailyRow, error)
	SMSReportOrganizations(ctx context.Context, arg db.SMSReportOrganizationsParams) ([]db.SMSReportOrganizationsRow, error)
	SMSReportOrgMessages(ctx context.Context, arg db.SMSReportOrgMessagesParams) ([]db.SMSReportOrgMessagesRow, error)
	CountSMSReportOrgMessages(ctx context.Context, organizationID int64) (int64, error)
	GetOrganizationByUUID(ctx context.Context, argUuid uuid.UUID) (db.Organization, error)
}

// QuotaReader reports an organization's plan usage (entitlements snapshot).
type QuotaReader interface {
	Snapshot(ctx context.Context, orgID int64) (entitlements.Snapshot, error)
}

// Report builds the platform SMS report.
type Report struct {
	q     ReportQuerier
	quota QuotaReader
	loc   *time.Location
	now   func() time.Time
}

// NewReport builds the report service (quota may be nil).
func NewReport(q ReportQuerier, quota QuotaReader) *Report {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Report{q: q, quota: quota, loc: loc, now: time.Now}
}

// Counts are sent / failed messages and billed parts of sent messages.
type Counts struct {
	Sent     int64 `json:"sent"`
	Failed   int64 `json:"failed"`
	Segments int64 `json:"segments"`
}

// ProviderCounts is one provider's share.
type ProviderCounts struct {
	Provider string `json:"provider"`
	Counts
}

// DayCounts is one local (Europe/Istanbul) day.
type DayCounts struct {
	Date string `json:"date"`
	Counts
}

// OrgRow is one organization of the report.
type OrgRow struct {
	OrganizationUUID uuid.UUID `json:"organization_uuid"`
	OrganizationName string    `json:"organization_name"`
	OrganizationSlug string    `json:"organization_slug"`
	// Provider is the active (else latest) SMS account; "" when none.
	Provider      string `json:"provider"`
	IsActive      bool   `json:"is_active"`
	AccountStatus string `json:"account_status"`
	Counts
	LastSentAt *time.Time `json:"last_sent_at"`
	// QuotaUsed / QuotaLimit: sms.monthly parts this calendar month
	// (QuotaLimit -1 = unlimited).
	QuotaUsed  int64 `json:"quota_used"`
	QuotaLimit int64 `json:"quota_limit"`
}

// ReportResult is the platform SMS report for a date range.
type ReportResult struct {
	From          string           `json:"from"`
	To            string           `json:"to"`
	Totals        Counts           `json:"totals"`
	ByProvider    []ProviderCounts `json:"by_provider"`
	Daily         []DayCounts      `json:"daily"`
	Organizations []OrgRow         `json:"organizations"`
}

// ReportMessage is one SMS of an organization (number masked).
type ReportMessage struct {
	UUID              uuid.UUID  `json:"uuid"`
	EventType         string     `json:"event_type"`
	Recipient         string     `json:"recipient"`
	Status            string     `json:"status"`
	Provider          string     `json:"provider"`
	ProviderReference string     `json:"provider_reference,omitempty"`
	DeliveryStatus    string     `json:"delivery_status,omitempty"`
	ErrorCode         string     `json:"error_code,omitempty"`
	Segments          *int32     `json:"segments"`
	SentAt            *time.Time `json:"sent_at"`
	CreatedAt         time.Time  `json:"created_at"`
}

// ReportMessagesPage is an organization's SMS log page.
type ReportMessagesPage struct {
	Organization struct {
		UUID uuid.UUID `json:"uuid"`
		Name string    `json:"name"`
		Slug string    `json:"slug"`
	} `json:"organization"`
	Items  []ReportMessage `json:"items"`
	Total  int64           `json:"total"`
	Limit  int32           `json:"limit"`
	Offset int32           `json:"offset"`
}

// Range resolves from / to (YYYY-MM-DD, inclusive, Europe/Istanbul). The
// default is the current month up to today.
func (r *Report) Range(from, to string) (time.Time, time.Time, error) {
	now := r.now().In(r.loc)
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, r.loc)
	end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, r.loc)
	var err error
	if strings.TrimSpace(from) != "" {
		if start, err = time.ParseInLocation("2006-01-02", strings.TrimSpace(from), r.loc); err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("%w: from must be YYYY-MM-DD", ErrInvalidRequest)
		}
	}
	if strings.TrimSpace(to) != "" {
		if end, err = time.ParseInLocation("2006-01-02", strings.TrimSpace(to), r.loc); err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("%w: to must be YYYY-MM-DD", ErrInvalidRequest)
		}
	}
	if end.Before(start) {
		return time.Time{}, time.Time{}, fmt.Errorf("%w: to is before from", ErrInvalidRequest)
	}
	if end.Sub(start) > maxReportDays*24*time.Hour {
		return time.Time{}, time.Time{}, fmt.Errorf("%w: range is longer than %d days", ErrInvalidRequest, maxReportDays)
	}
	return start, end, nil
}

func providerOf(senderKind string) string {
	return strings.TrimPrefix(senderKind, "sms_")
}

// Build returns the report for the inclusive local day range.
func (r *Report) Build(ctx context.Context, from, to string) (ReportResult, error) {
	start, end, err := r.Range(from, to)
	if err != nil {
		return ReportResult{}, err
	}
	pFrom := pgtype.Timestamptz{Time: start, Valid: true}
	pTo := pgtype.Timestamptz{Time: end.AddDate(0, 0, 1), Valid: true}
	out := ReportResult{
		From: start.Format("2006-01-02"), To: end.Format("2006-01-02"),
		ByProvider: []ProviderCounts{}, Daily: []DayCounts{}, Organizations: []OrgRow{},
	}
	byProvider, err := r.q.SMSReportByProvider(ctx, db.SMSReportByProviderParams{DateFrom: pFrom, DateTo: pTo})
	if err != nil {
		return ReportResult{}, fmt.Errorf("sms report providers: %w", err)
	}
	merged := map[string]*ProviderCounts{}
	for _, row := range byProvider {
		p := providerOf(row.SenderKind)
		if p == "" {
			p = "unknown"
		}
		pc, ok := merged[p]
		if !ok {
			pc = &ProviderCounts{Provider: p}
			merged[p] = pc
		}
		pc.Sent += row.Sent
		pc.Failed += row.Failed
		pc.Segments += row.Segments
		out.Totals.Sent += row.Sent
		out.Totals.Failed += row.Failed
		out.Totals.Segments += row.Segments
	}
	for _, code := range []string{sms.ProviderNetgsm, sms.ProviderTwilio, "unknown"} {
		if pc, ok := merged[code]; ok {
			out.ByProvider = append(out.ByProvider, *pc)
		}
	}
	daily, err := r.q.SMSReportDaily(ctx, db.SMSReportDailyParams{DateFrom: pFrom, DateTo: pTo})
	if err != nil {
		return ReportResult{}, fmt.Errorf("sms report daily: %w", err)
	}
	for _, row := range daily {
		if !row.Day.Valid {
			continue
		}
		out.Daily = append(out.Daily, DayCounts{
			Date:   row.Day.Time.Format("2006-01-02"),
			Counts: Counts{Sent: row.Sent, Failed: row.Failed, Segments: row.Segments},
		})
	}
	orgs, err := r.q.SMSReportOrganizations(ctx, db.SMSReportOrganizationsParams{DateFrom: pFrom, DateTo: pTo})
	if err != nil {
		return ReportResult{}, fmt.Errorf("sms report organizations: %w", err)
	}
	for _, row := range orgs {
		o := OrgRow{
			OrganizationUUID: row.OrganizationUuid, OrganizationName: row.OrganizationName,
			OrganizationSlug: row.OrganizationSlug, Provider: row.Provider, IsActive: row.IsActive,
			AccountStatus: row.AccountStatus,
			Counts:        Counts{Sent: row.Sent, Failed: row.Failed, Segments: row.Segments},
			QuotaLimit:    -1,
		}
		if row.LastSentAt.Valid {
			t := row.LastSentAt.Time
			o.LastSentAt = &t
		}
		o.QuotaUsed, o.QuotaLimit = r.quotaOf(ctx, row.OrganizationID)
		out.Organizations = append(out.Organizations, o)
	}
	return out, nil
}

// quotaOf reads sms.monthly usage / limit (-1 = unlimited) best effort.
func (r *Report) quotaOf(ctx context.Context, orgID int64) (used, limit int64) {
	limit = -1
	if r.quota == nil {
		return 0, limit
	}
	snap, err := r.quota.Snapshot(ctx, orgID)
	if err != nil {
		return 0, limit
	}
	for _, u := range snap.Usage {
		if u.Key == FeatureSMSMonthly {
			return u.Used, u.Limit
		}
	}
	return 0, limit
}

// Messages lists an organization's SMS, newest first (numbers masked).
func (r *Report) Messages(ctx context.Context, orgUUID uuid.UUID, limit, offset int32) (ReportMessagesPage, error) {
	org, err := r.q.GetOrganizationByUUID(ctx, orgUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ReportMessagesPage{}, ErrNotFound
	}
	if err != nil {
		return ReportMessagesPage{}, err
	}
	rows, err := r.q.SMSReportOrgMessages(ctx, db.SMSReportOrgMessagesParams{
		OrganizationID: org.ID, RowLimit: limit, RowOffset: offset,
	})
	if err != nil {
		return ReportMessagesPage{}, fmt.Errorf("sms report messages: %w", err)
	}
	total, err := r.q.CountSMSReportOrgMessages(ctx, org.ID)
	if err != nil {
		return ReportMessagesPage{}, fmt.Errorf("sms report messages count: %w", err)
	}
	page := ReportMessagesPage{Items: make([]ReportMessage, 0, len(rows)), Total: total, Limit: limit, Offset: offset}
	page.Organization.UUID, page.Organization.Name, page.Organization.Slug = org.Uuid, org.Name, org.Slug
	for _, row := range rows {
		m := ReportMessage{
			UUID: row.Uuid, EventType: row.EventType, Recipient: sms.MaskPhone(row.RecipientPhone),
			Status: row.Status, Provider: providerOf(row.SenderKind.String),
			ProviderReference: row.ProviderReference, DeliveryStatus: row.DeliveryStatus.String,
			ErrorCode: row.ErrorCode.String,
		}
		if row.Segments.Valid {
			v := row.Segments.Int32
			m.Segments = &v
		}
		if row.SentAt.Valid {
			t := row.SentAt.Time
			m.SentAt = &t
		}
		if row.CreatedAt.Valid {
			m.CreatedAt = row.CreatedAt.Time
		}
		page.Items = append(page.Items, m)
	}
	return page, nil
}
