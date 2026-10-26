package loyalty

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	loyaltyusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/loyalty/usecase"
	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/msgtemplate"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/jackc/pgx/v5/pgtype"
)

// Notification kinds and subject of subscription renewal reminders.
const (
	KindRenewalReminder = "loyalty.renewal_reminder"
	KindTeamRenewalDue  = "loyalty.team_renewal_due"
	SubjectSubscription = "loyalty_subscription"
)

func init() {
	ph := []msgtemplate.Placeholder{
		{Key: "customer_name", SampleTR: "Ahmet Yılmaz", SampleEN: "John Smith"},
		{Key: "company_name", SampleTR: "Tech Oto", SampleEN: "Tech Oto"},
		{Key: "plan_name", SampleTR: "Aylık Sınırsız Yıkama", SampleEN: "Monthly unlimited wash"},
		{Key: "renewal_date", SampleTR: "26.11.2026", SampleEN: "26.11.2026"},
		{Key: "amount", SampleTR: "1.250,00", SampleEN: "1,250.00"},
		{Key: "currency", SampleTR: "TRY", SampleEN: "TRY"},
		{Key: "plate", SampleTR: "34 ABC 123", SampleEN: "34 ABC 123"},
	}
	msgtemplate.Register(msgtemplate.TypeSpec{Type: KindRenewalReminder, Group: "loyalty", Audience: msgtemplate.AudienceCustomer,
		Channels: []string{msgtemplate.ChannelWhatsApp, msgtemplate.ChannelSMS}, Placeholders: ph})
	team := append(append([]msgtemplate.Placeholder{}, ph...),
		msgtemplate.Placeholder{Key: "app_link", SampleTR: "https://otopoly.app/t/tech-oto/loyalty/subscriptions/abc", SampleEN: "https://otopoly.app/t/tech-oto/loyalty/subscriptions/abc"})
	msgtemplate.Register(msgtemplate.TypeSpec{Type: KindTeamRenewalDue, Group: "loyalty", Audience: msgtemplate.AudienceStaff,
		Channels: []string{msgtemplate.ChannelInapp, msgtemplate.ChannelEmail}, Placeholders: team, UserPreference: true})
}

// Center is the notification center as seen by the reminders.
type Center interface {
	Schedule(ctx context.Context, sn centermodel.ScheduledNotification) (centermodel.Result, error)
	CancelBySubject(ctx context.Context, subjectType string, subjectID int64) (int64, error)
	RegisterGuard(subjectType string, g centerusecase.Guard)
}

// Reminders schedules renewal reminders through the notification center:
// the member who started the subscription is told 3 days before the
// renewal (in-app / e-mail per their preferences) and the customer 1 day
// before (WhatsApp / SMS only when the organization enabled a rule for
// loyalty.renewal_reminder). A guard drops reminders once the period is
// paid or the subscription is cancelled.
type Reminders struct {
	center Center
	q      *db.Queries
	loc    *time.Location
	now    func() time.Time
	log    *slog.Logger
}

// NewReminders wires the reminders and registers their guard on svc.
func NewReminders(center Center, q *db.Queries, svc *loyaltyusecase.Service, log *slog.Logger) *Reminders {
	if log == nil {
		log = slog.Default()
	}
	r := &Reminders{center: center, q: q, loc: svc.Location(), now: time.Now, log: log}
	center.RegisterGuard(SubjectSubscription, svc.RenewalDue)
	return r
}

// ScheduleRenewal implements usecase.Reminders.
func (r *Reminders) ScheduleRenewal(ctx context.Context, orgID int64, sub db.LoyaltySubscription) {
	renewal := sub.PaidThrough.Time
	renewalAt := time.Date(renewal.Year(), renewal.Month(), renewal.Day(), 0, 0, 0, 0, r.loc)
	now := r.now()
	if !renewalAt.After(now) {
		return // already due: the renewals list shows it
	}
	cust, err := r.q.LoyaltyGetCustomerByID(ctx, db.LoyaltyGetCustomerByIDParams{OrganizationID: orgID, ID: sub.CustomerID})
	if err != nil {
		r.log.Warn("loyalty_reminder_customer", "error", err)
		return
	}
	vars := map[string]string{
		"customer_name": cust.Name,
		"plan_name":     sub.Name,
		"renewal_date":  renewal.Format("02.01.2006"),
		"amount":        trMoney(sub.Price),
		"currency":      sub.Currency,
	}
	if sub.VehicleID.Valid {
		if v, err := r.q.LoyaltyGetVehicleByID(ctx, db.LoyaltyGetVehicleByIDParams{ID: sub.VehicleID.Int64, OrganizationID: orgID}); err == nil {
			vars["plate"] = v.Plate
		}
	}
	actionURL := ""
	if sc, ok := orgctx.ScopeFrom(ctx); ok && sc.Slug != "" {
		actionURL = fmt.Sprintf("/t/%s/loyalty/subscriptions/%s", sc.Slug, sub.Uuid)
	}
	key := renewal.Format("20060102")
	if sub.CreatedBy.Valid {
		fire := renewalAt.AddDate(0, 0, -3).Add(9 * time.Hour)
		if fire.Before(now) {
			fire = now
		}
		r.schedule(ctx, centermodel.ScheduledNotification{
			Notification: centermodel.Notification{
				OrgID: orgID, Kind: KindTeamRenewalDue, SubjectType: SubjectSubscription, SubjectID: sub.ID,
				Recipient: centermodel.Recipient{UserID: sub.CreatedBy.Int64}, Vars: vars, ActionURL: actionURL,
				DedupeKey: fmt.Sprintf("%s:%d:%s:team", KindTeamRenewalDue, sub.ID, key), CreatedBy: sub.CreatedBy.Int64,
			},
			FireAt: fire,
		})
	}
	fire := renewalAt.AddDate(0, 0, -1).Add(10 * time.Hour)
	if fire.Before(now) {
		fire = now
	}
	r.schedule(ctx, centermodel.ScheduledNotification{
		Notification: centermodel.Notification{
			OrgID: orgID, Kind: KindRenewalReminder, SubjectType: SubjectSubscription, SubjectID: sub.ID,
			Recipient: centermodel.Recipient{CustomerID: sub.CustomerID}, Vars: vars,
			DedupeKey: fmt.Sprintf("%s:%d:%s:customer", KindRenewalReminder, sub.ID, key), CreatedBy: sub.CreatedBy.Int64,
		},
		FireAt: fire,
	})
}

func (r *Reminders) schedule(ctx context.Context, sn centermodel.ScheduledNotification) {
	if _, err := r.center.Schedule(ctx, sn); err != nil {
		r.log.Warn("loyalty_reminder_schedule_failed", "kind", sn.Kind, "subject_id", sn.SubjectID, "error", err)
	}
}

// CancelRenewal implements usecase.Reminders.
func (r *Reminders) CancelRenewal(ctx context.Context, subID int64) {
	if _, err := r.center.CancelBySubject(ctx, SubjectSubscription, subID); err != nil {
		r.log.Warn("loyalty_reminder_cancel_failed", "subject_id", subID, "error", err)
	}
}

// trMoney formats an amount Turkish style (1.250,00).
func trMoney(n pgtype.Numeric) string {
	v, err := n.Value()
	s, ok := v.(string)
	if err != nil || !ok {
		return "0,00"
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return s
	}
	plain := r.FloatString(2)
	intPart, frac, _ := strings.Cut(plain, ".")
	neg := strings.HasPrefix(intPart, "-")
	intPart = strings.TrimPrefix(intPart, "-")
	var b strings.Builder
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	out := b.String() + "," + frac
	if neg {
		out = "-" + out
	}
	return out
}
