// Package usecase builds and sends the end-of-day WhatsApp summary: vehicles
// served (per service), revenue by payment method, unpaid work, expenses and
// cash balances, sent at the organization's closing time to selected members.
package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata" // Europe/Istanbul without relying on the host zoneinfo.

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrInvalidRequest        = errors.New("dailysummary: invalid request")
	ErrWhatsAppNotConnected  = errors.New("dailysummary: whatsapp is not connected")
	ErrNoRecipientsWithPhone = errors.New("dailysummary: no recipient has a phone number")
	defaultSendMinutes       = 20 * 60
	sendTimeRE               = regexp.MustCompile(`^([01]\d|2[0-3]):([0-5]\d)$`)
	maxRecipients            = 20
	summaryEventType         = messagingmodel.EventDailySummary
	summarySubjectType       = "daily_summary"
	businessTimeZone         = "Europe/Istanbul"
)

// Sender delivers WhatsApp text through the organization's line (or the
// platform number, which sends the catalog text built from vars).
type Sender interface {
	WhatsAppConnected(ctx context.Context, orgID int64) (bool, error)
	QueueWhatsApp(ctx context.Context, orgID int64, phone, body, eventType, subjectType string, vars map[string]string) error
}

type Service struct {
	q      *db.Queries
	sender Sender
	loc    *time.Location
	now    func() time.Time
	log    *slog.Logger
}

func New(q *db.Queries, sender Sender, log *slog.Logger) *Service {
	loc, err := time.LoadLocation(businessTimeZone)
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{q: q, sender: sender, loc: loc, now: time.Now, log: log}
}

type Member struct {
	UUID     uuid.UUID `json:"uuid"`
	Name     string    `json:"name"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	HasPhone bool      `json:"has_phone"`
}

type Settings struct {
	Enabled            bool        `json:"enabled"`
	SendTime           string      `json:"send_time"`
	RecipientUserUUIDs []uuid.UUID `json:"recipient_user_uuids"`
	LastSentOn         *string     `json:"last_sent_on,omitempty"`
	WhatsAppConnected  bool        `json:"whatsapp_connected"`
	Members            []Member    `json:"members"`
}

type UpdateInput struct {
	Enabled            bool        `json:"enabled"`
	SendTime           string      `json:"send_time"`
	RecipientUserUUIDs []uuid.UUID `json:"recipient_user_uuids"`
}

type Preview struct {
	Message string `json:"message"`
	Date    string `json:"date"`
}

type SendResult struct {
	Sent    int      `json:"sent"`
	Skipped []string `json:"skipped"`
}

func (s *Service) GetSettings(ctx context.Context, orgID int64) (Settings, error) {
	row, err := s.loadSettings(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	members, err := s.q.ListDailySummaryMembers(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	out := Settings{
		Enabled:            row.Enabled,
		SendTime:           formatSendTime(row.SendTime),
		RecipientUserUUIDs: []uuid.UUID{},
		Members:            make([]Member, 0, len(members)),
	}
	selected := make(map[int64]bool, len(row.RecipientUserIds))
	for _, id := range row.RecipientUserIds {
		selected[id] = true
	}
	for _, m := range members {
		out.Members = append(out.Members, Member{
			UUID:     m.UserUuid,
			Name:     strings.TrimSpace(m.Name + " " + m.Surname),
			Email:    m.Email,
			Role:     m.Role,
			HasPhone: strings.TrimSpace(m.Phone) != "",
		})
		if selected[m.UserID] {
			out.RecipientUserUUIDs = append(out.RecipientUserUUIDs, m.UserUuid)
		}
	}
	if row.LastSentOn.Valid {
		d := row.LastSentOn.Time.Format("2006-01-02")
		out.LastSentOn = &d
	}
	if s.sender != nil {
		if ok, err := s.sender.WhatsAppConnected(ctx, orgID); err == nil {
			out.WhatsAppConnected = ok
		}
	}
	return out, nil
}

func (s *Service) UpdateSettings(ctx context.Context, orgID int64, in UpdateInput) (Settings, error) {
	minutes, err := parseSendTime(in.SendTime)
	if err != nil {
		return Settings{}, err
	}
	if len(in.RecipientUserUUIDs) > maxRecipients {
		return Settings{}, fmt.Errorf("%w: at most %d recipients", ErrInvalidRequest, maxRecipients)
	}
	members, err := s.q.ListDailySummaryMembers(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	byUUID := make(map[uuid.UUID]int64, len(members))
	for _, m := range members {
		byUUID[m.UserUuid] = m.UserID
	}
	ids := make([]int64, 0, len(in.RecipientUserUUIDs))
	seen := map[int64]bool{}
	for _, u := range in.RecipientUserUUIDs {
		id, ok := byUUID[u]
		if !ok {
			return Settings{}, fmt.Errorf("%w: recipient is not an active member", ErrInvalidRequest)
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if in.Enabled && len(ids) == 0 {
		return Settings{}, fmt.Errorf("%w: select at least one recipient", ErrInvalidRequest)
	}
	if _, err := s.q.UpsertDailySummarySettings(ctx, db.UpsertDailySummarySettingsParams{
		OrganizationID:   orgID,
		Enabled:          in.Enabled,
		SendTime:         pgtype.Time{Microseconds: int64(minutes) * 60_000_000, Valid: true},
		RecipientUserIds: ids,
	}); err != nil {
		return Settings{}, err
	}
	return s.GetSettings(ctx, orgID)
}

// Preview renders today's summary so far.
func (s *Service) Preview(ctx context.Context, orgID int64) (Preview, error) {
	day := s.localToday()
	r, err := s.BuildReport(ctx, orgID, day)
	if err != nil {
		return Preview{}, err
	}
	return Preview{Message: r.Message(), Date: day.Format("2006-01-02")}, nil
}

// SendTest sends today's summary so far to the saved recipients right now
// (does not mark the day as sent).
func (s *Service) SendTest(ctx context.Context, orgID int64) (SendResult, error) {
	row, err := s.loadSettings(ctx, orgID)
	if err != nil {
		return SendResult{}, err
	}
	if len(row.RecipientUserIds) == 0 {
		return SendResult{}, fmt.Errorf("%w: select and save at least one recipient", ErrInvalidRequest)
	}
	r, err := s.BuildReport(ctx, orgID, s.localToday())
	if err != nil {
		return SendResult{}, err
	}
	return s.deliver(ctx, orgID, row.RecipientUserIds, r, true)
}

// SendDue is the periodic sweep: every enabled organization whose local send
// time has passed today gets its summary once.
func (s *Service) SendDue(ctx context.Context) (int, error) {
	rows, err := s.q.ListEnabledDailySummarySettings(ctx)
	if err != nil {
		return 0, err
	}
	now := s.now().In(s.loc)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, s.loc)
	sent := 0
	for _, row := range rows {
		var last *time.Time
		if row.LastSentOn.Valid {
			t := row.LastSentOn.Time
			last = &t
		}
		if !isDue(now, sendMinutes(row.SendTime), last) || len(row.RecipientUserIds) == 0 {
			continue
		}
		if s.sender != nil {
			if ok, err := s.sender.WhatsAppConnected(ctx, row.OrganizationID); err != nil || !ok {
				// Not claimed: retried every sweep until the line is back today.
				continue
			}
		}
		n, err := s.q.ClaimDailySummary(ctx, db.ClaimDailySummaryParams{
			OrganizationID: row.OrganizationID,
			Day:            pgtype.Date{Time: day, Valid: true},
		})
		if err != nil {
			s.log.Error("daily_summary_claim_failed", "org_id", row.OrganizationID, "error", err)
			continue
		}
		if n == 0 {
			continue // another sweep already sent today's summary
		}
		r, err := s.BuildReport(ctx, row.OrganizationID, day)
		if err != nil {
			s.log.Error("daily_summary_build_failed", "org_id", row.OrganizationID, "error", err)
			continue
		}
		res, err := s.deliver(ctx, row.OrganizationID, row.RecipientUserIds, r, false)
		if err != nil {
			s.log.Error("daily_summary_send_failed", "org_id", row.OrganizationID, "error", err)
			continue
		}
		sent += res.Sent
		s.log.Info("daily_summary_sent", "org_id", row.OrganizationID, "sent", res.Sent, "skipped", len(res.Skipped))
	}
	return sent, nil
}

func (s *Service) deliver(ctx context.Context, orgID int64, recipientIDs []int64, r Report, requireConnected bool) (SendResult, error) {
	body, vars := r.Message(), r.Vars()
	if s.sender == nil {
		return SendResult{}, ErrWhatsAppNotConnected
	}
	if requireConnected {
		ok, err := s.sender.WhatsAppConnected(ctx, orgID)
		if err != nil {
			return SendResult{}, err
		}
		if !ok {
			return SendResult{}, ErrWhatsAppNotConnected
		}
	}
	members, err := s.q.ListDailySummaryMembers(ctx, orgID)
	if err != nil {
		return SendResult{}, err
	}
	wanted := make(map[int64]bool, len(recipientIDs))
	for _, id := range recipientIDs {
		wanted[id] = true
	}
	res := SendResult{Skipped: []string{}}
	for _, m := range members {
		if !wanted[m.UserID] {
			continue
		}
		name := strings.TrimSpace(m.Name + " " + m.Surname)
		phone := strings.TrimSpace(m.Phone)
		if phone == "" {
			res.Skipped = append(res.Skipped, name)
			continue
		}
		if err := s.sender.QueueWhatsApp(ctx, orgID, phone, body, summaryEventType, summarySubjectType, vars); err != nil {
			s.log.Warn("daily_summary_queue_failed", "org_id", orgID, "user_id", m.UserID, "error", err)
			res.Skipped = append(res.Skipped, name)
			continue
		}
		res.Sent++
	}
	if res.Sent == 0 && requireConnected {
		return res, ErrNoRecipientsWithPhone
	}
	return res, nil
}

// BuildReport gathers the figures for a local calendar day.
func (s *Service) BuildReport(ctx context.Context, orgID int64, day time.Time) (Report, error) {
	from := pgtype.Timestamptz{Time: day, Valid: true}
	to := pgtype.Timestamptz{Time: day.AddDate(0, 0, 1), Valid: true}
	org, err := s.q.GetOrganizationByID(ctx, orgID)
	if err != nil {
		return Report{}, err
	}
	r := Report{OrgName: org.Name, Day: day, Currency: "TRY"}

	counts, err := s.q.DailySummaryJobCounts(ctx, db.DailySummaryJobCountsParams{OrganizationID: orgID, DateFrom: from, DateTo: to})
	if err != nil {
		return Report{}, err
	}
	r.JobCount, r.OpenCount = counts.JobCount, counts.OpenCount
	r.DeliveredCount, r.CancelledCount = counts.DeliveredCount, counts.CancelledCount
	r.UnpaidCount, r.UnpaidTotal = counts.UnpaidCount, num(counts.UnpaidTotal)

	services, err := s.q.DailySummaryServiceBreakdown(ctx, db.DailySummaryServiceBreakdownParams{OrganizationID: orgID, DateFrom: from, DateTo: to})
	if err != nil {
		return Report{}, err
	}
	for _, sv := range services {
		r.Services = append(r.Services, ServiceCount{Name: sv.Name, JobCount: sv.JobCount})
	}

	// Same basis as the İşlemler day summary bar.
	money, err := s.q.SumServiceJobsDaily(ctx, db.SumServiceJobsDailyParams{OrganizationID: orgID, DayStart: from, DayEnd: to})
	if err != nil {
		return Report{}, err
	}
	r.PaidTotal = num(money.PaidTotal)
	r.CardTotal = num(money.CardTotal)
	r.CariTotal = num(money.CariTotal)
	r.CashTotal = num(money.NetTotal) - r.CardTotal

	sales, err := s.q.DailySummarySales(ctx, db.DailySummarySalesParams{OrganizationID: orgID, DateFrom: from, DateTo: to})
	if err != nil {
		return Report{}, err
	}
	r.SaleCount, r.SaleTotal = sales.SaleCount, num(sales.SaleTotal)

	purchases, err := s.q.DailySummaryPurchases(ctx, db.DailySummaryPurchasesParams{OrganizationID: orgID, DateFrom: from, DateTo: to})
	if err != nil {
		return Report{}, err
	}
	r.PurchaseCount, r.PurchaseTotal = purchases.PurchaseCount, num(purchases.PurchaseTotal)

	expenses, err := s.q.DailySummaryExpenses(ctx, db.DailySummaryExpensesParams{OrganizationID: orgID, Day: pgtype.Date{Time: day, Valid: true}})
	if err != nil {
		return Report{}, err
	}
	r.ExpenseCount, r.ExpenseTotal = expenses.ExpenseCount, num(expenses.ExpenseTotal)

	accounts, err := s.q.DailySummaryAccounts(ctx, orgID)
	if err != nil {
		return Report{}, err
	}
	for _, a := range accounts {
		r.Accounts = append(r.Accounts, AccountBalance{Name: a.Name, Balance: num(a.CurrentBalance)})
	}
	return r, nil
}

func (s *Service) loadSettings(ctx context.Context, orgID int64) (db.DailySummarySetting, error) {
	row, err := s.q.GetDailySummarySettings(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DailySummarySetting{
			OrganizationID: orgID,
			SendTime:       pgtype.Time{Microseconds: int64(defaultSendMinutes) * 60_000_000, Valid: true},
		}, nil
	}
	return row, err
}

func (s *Service) localToday() time.Time {
	now := s.now().In(s.loc)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, s.loc)
}

// isDue: the local time of day reached the schedule and today's summary has
// not been sent yet.
func isDue(now time.Time, sendMin int, lastSent *time.Time) bool {
	if now.Hour()*60+now.Minute() < sendMin {
		return false
	}
	if lastSent != nil {
		y, m, d := now.Date()
		ly, lm, ld := lastSent.Date()
		if ly == y && lm == m && ld == d {
			return false
		}
	}
	return true
}

func parseSendTime(v string) (int, error) {
	m := sendTimeRE.FindStringSubmatch(strings.TrimSpace(v))
	if m == nil {
		return 0, fmt.Errorf("%w: send_time must be HH:MM", ErrInvalidRequest)
	}
	var h, min int
	_, _ = fmt.Sscanf(m[1]+" "+m[2], "%d %d", &h, &min)
	return h*60 + min, nil
}

func sendMinutes(t pgtype.Time) int {
	if !t.Valid {
		return defaultSendMinutes
	}
	return int(t.Microseconds / 60_000_000)
}

func formatSendTime(t pgtype.Time) string {
	m := sendMinutes(t)
	return fmt.Sprintf("%02d:%02d", m/60, m%60)
}

func num(n pgtype.Numeric) float64 {
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return 0
	}
	return f.Float64
}
