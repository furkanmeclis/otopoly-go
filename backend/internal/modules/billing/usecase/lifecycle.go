package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/jackc/pgx/v5/pgtype"
)

type emailNotifier interface {
	NotifyOrganizationEmail(ctx context.Context, orgID int64, title, body, link string)
}

type LifecycleResult struct {
	MovedToGrace       int `json:"moved_to_grace"`
	MovedToReadOnly    int `json:"moved_to_read_only"`
	RemindersSent      int `json:"reminders_sent"`
	OrderRemindersSent int `json:"order_reminders_sent"`
}

func (s *Service) RunLifecycle(ctx context.Context, now time.Time) (LifecycleResult, error) {
	now = now.UTC()
	settings, err := s.q.GetBillingSettings(ctx)
	if err != nil {
		return LifecycleResult{}, err
	}
	var out LifecycleResult
	toGrace, err := s.q.ListSubscriptionsToGrace(ctx, pgTimeValue(now))
	if err != nil {
		return out, err
	}
	for _, row := range toGrace {
		if settings.GraceDays <= 0 {
			if _, err := s.q.MoveToReadOnly(ctx, row.ID); err != nil {
				return out, err
			}
			if err := s.q.ClearOrganizationAccessEnd(ctx, row.OrganizationID); err != nil {
				return out, err
			}
			out.MovedToReadOnly++
			if s.sendSubscriptionReminder(ctx, row.Uuid.String()+":read_only", "read_only", row.OrganizationID, row.OrganizationSlug, "Aboneliğiniz salt okunur moda geçti", "Abonelik süreniz doldu. Yeni kayıt açmak için aboneliğinizi yenileyin.") {
				out.RemindersSent++
			}
			continue
		}
		graceEnds := row.EndsAt.Time.AddDate(0, 0, int(settings.GraceDays))
		if _, err := s.q.MoveToGrace(ctx, db.MoveToGraceParams{ID: row.ID, GraceEndsAt: pgTimeValue(graceEnds)}); err != nil {
			return out, err
		}
		if err := s.q.ClearOrganizationAccessEnd(ctx, row.OrganizationID); err != nil {
			return out, err
		}
		out.MovedToGrace++
		if s.sendSubscriptionReminder(ctx, row.Uuid.String()+":ended", "ended", row.OrganizationID, row.OrganizationSlug, "Aboneliğiniz ek süreye geçti", fmt.Sprintf("Abonelik süreniz doldu. Ek süreniz %s tarihinde sona erecek.", istanbulDate(graceEnds))) {
			out.RemindersSent++
		}
	}
	toReadOnly, err := s.q.ListSubscriptionsToReadOnly(ctx, pgTimeValue(now))
	if err != nil {
		return out, err
	}
	for _, row := range toReadOnly {
		if _, err := s.q.MoveToReadOnly(ctx, row.ID); err != nil {
			return out, err
		}
		out.MovedToReadOnly++
		if s.sendSubscriptionReminder(ctx, row.Uuid.String()+":read_only", "read_only", row.OrganizationID, row.OrganizationSlug, "Aboneliğiniz salt okunur moda geçti", "Ek süreniz doldu. Yeni kayıt açmak için aboneliğinizi yenileyin.") {
			out.RemindersSent++
		}
	}
	for _, day := range reminderDays(settings.ReminderDays) {
		start, end := istanbulDayRange(now.AddDate(0, 0, int(day)))
		rows, err := s.q.ListSubscriptionsEndingOn(ctx, db.ListSubscriptionsEndingOnParams{DayStart: pgTimeValue(start), DayEnd: pgTimeValue(end)})
		if err != nil {
			return out, err
		}
		kind := fmt.Sprintf("ends_in_%d", day)
		for _, row := range rows {
			if s.center != nil {
				// Localized owner e-mail + neutral in-app notice (notify center).
				n, err := s.q.InsertReminderLog(ctx, db.InsertReminderLogParams{
					Key: row.Uuid.String() + ":" + kind, Kind: kind,
					OrganizationID: pgtype.Int8{Int64: row.OrganizationID, Valid: true},
				})
				if err == nil && n > 0 && s.subscriptionEndingAlert(ctx, row.OrganizationID, row.Uuid.String(), row.PlanCode, row.EndsAt.Time, day) {
					out.RemindersSent++
				}
				continue
			}
			if s.sendSubscriptionReminder(ctx, row.Uuid.String()+":"+kind, kind, row.OrganizationID, row.OrganizationSlug, "Aboneliğiniz yakında sona eriyor", fmt.Sprintf("Aboneliğiniz %d gün içinde sona erecek.", day)) {
				out.RemindersSent++
			}
		}
	}
	orders, err := s.q.ListOrdersExpiringWithin(ctx, db.ListOrdersExpiringWithinParams{NowAt: pgTimeValue(now), UntilAt: pgTimeValue(now.Add(24 * time.Hour))})
	if err != nil {
		return out, err
	}
	for _, row := range orders {
		if s.sendSubscriptionReminder(ctx, row.Uuid.String()+":order_expiring", "order_expiring", row.OrganizationID, row.OrganizationSlug, "Ödeme siparişiniz yakında iptal olacak", "Açık ödeme siparişiniz 24 saat içinde sona erecek.") {
			out.OrderRemindersSent++
		}
	}
	return out, nil
}

func (s *Service) SendAdminDigest(ctx context.Context, now time.Time) error {
	key := "digest:" + now.In(istanbulLocation()).Format("2006-01-02")
	n, err := s.q.InsertReminderLog(ctx, db.InsertReminderLogParams{Key: key, Kind: "digest", OrganizationID: pgtype.Int8{}})
	if err != nil || n == 0 {
		return err
	}
	orders, err := s.q.OrderStatusSummary(ctx)
	if err != nil {
		return err
	}
	expiring, err := s.q.BillingExpiringCounts(ctx, db.BillingExpiringCountsParams{
		NowAt: pgTimeValue(now.UTC()), Within7: pgTimeValue(now.UTC().AddDate(0, 0, 7)), Within30: pgTimeValue(now.UTC().AddDate(0, 0, 30)),
	})
	if err != nil {
		return err
	}
	counts, err := s.q.BillingSubscriptionStatusCounts(ctx)
	if err != nil {
		return err
	}
	if s.notifier != nil {
		body := fmt.Sprintf("Bekleyen ödeme: %d, ödeme bildirildi: %d, 7 gün içinde bitecek: %d, ek sürede: %d, salt okunur: %d.",
			orders.PendingPayment, orders.PaymentReported, expiring.Within7, counts.Grace, counts.ReadOnly)
		s.notifier.NotifyPlatform(ctx, "Günlük abonelik özeti", body, "/platform/billing")
	}
	return nil
}

func (s *Service) sendSubscriptionReminder(ctx context.Context, key, kind string, orgID int64, orgSlug, title, body string) bool {
	n, err := s.q.InsertReminderLog(ctx, db.InsertReminderLogParams{
		Key: key, Kind: kind, OrganizationID: pgtype.Int8{Int64: orgID, Valid: true},
	})
	if err != nil || n == 0 || s.notifier == nil {
		return false
	}
	link := "/t/" + orgSlug + "/settings/billing"
	if emailer, ok := s.notifier.(emailNotifier); ok {
		emailer.NotifyOrganizationEmail(ctx, orgID, title, body, link)
	} else {
		s.notifier.NotifyOrganization(ctx, orgID, title, body, link)
	}
	return true
}

func reminderDays(days []int32) []int32 {
	if len(days) == 0 {
		return []int32{7, 3, 1}
	}
	return days
}

func istanbulLocation() *time.Location {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		return time.FixedZone("TRT", 3*60*60)
	}
	return loc
}

func istanbulDayRange(t time.Time) (time.Time, time.Time) {
	loc := istanbulLocation()
	y, m, d := t.In(loc).Date()
	start := time.Date(y, m, d, 0, 0, 0, 0, loc)
	return start.UTC(), start.AddDate(0, 0, 1).UTC()
}

func istanbulDate(t time.Time) string {
	return t.In(istanbulLocation()).Format("02.01.2006")
}
