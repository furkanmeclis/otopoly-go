package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/jackc/pgx/v5/pgtype"
)

// NotificationKind is the notification payload kind (push text catalog).
const NotificationKind = "stock.reorder_due"

// localDay returns the local (Europe/Istanbul) calendar day of t and the
// minutes since local midnight.
func (s *Service) localDay(t time.Time) (time.Time, int) {
	lt := t.In(s.loc)
	day := time.Date(lt.Year(), lt.Month(), lt.Day(), 0, 0, 0, 0, time.UTC)
	return day, lt.Hour()*60 + lt.Minute()
}

// notifyText is the in-app text (Turkish first; the push uses the
// lock-screen-safe catalog text).
func notifyText(sum Summary) (string, string) {
	title := "Stok sipariş önerisi"
	body := ""
	switch {
	case sum.OutOfStock > 0 && sum.BelowMin > 0:
		body = fmt.Sprintf("%d ürün stokta yok, %d ürün minimum stokun altında.", sum.OutOfStock, sum.BelowMin)
	case sum.OutOfStock > 0:
		body = fmt.Sprintf("%d ürün stokta yok.", sum.OutOfStock)
	default:
		body = fmt.Sprintf("%d ürün minimum stokun altında.", sum.BelowMin)
	}
	return title, body + " Sipariş önerilerini inceleyin."
}

// SendDue is the periodic sweep: once a day after 09:00 Europe/Istanbul,
// every organization with the notification on (default) and out-of-stock /
// below-minimum products notifies its members who may place purchases.
// Returns the number of notifications created.
func (s *Service) SendDue(ctx context.Context) (int, error) {
	if s.notifier == nil {
		return 0, nil
	}
	day, minutes := s.localDay(s.now())
	if minutes < notifyMinutes {
		return 0, nil
	}
	orgs, err := s.q.ListStockReorderNotifyOrganizations(ctx, pgtype.Date{Time: day, Valid: true})
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, o := range orgs {
		n, err := s.notifyOrg(ctx, o, day)
		if err != nil {
			s.log.Warn("stock_reorder_notify_failed", "organization_id", o.OrganizationID, "error", err)
			continue
		}
		sent += n
	}
	return sent, nil
}

func (s *Service) notifyOrg(ctx context.Context, o db.ListStockReorderNotifyOrganizationsRow, day time.Time) (int, error) {
	if err := s.requireFeature(ctx, o.OrganizationID); err != nil {
		if err == ErrFeatureDisabled {
			return 0, nil
		}
		return 0, err
	}
	// Claim first so two sweeps never notify twice; a day without urgent
	// items is claimed too (nothing to say until tomorrow).
	claimed, err := s.q.ClaimStockReorderNotification(ctx, db.ClaimStockReorderNotificationParams{
		OrganizationID: o.OrganizationID, Day: pgtype.Date{Time: day, Valid: true},
	})
	if err != nil || claimed == 0 {
		return 0, err
	}
	octx := orgctx.WithScope(ctx, orgctx.Scope{InternalID: o.OrganizationID, UUID: o.OrganizationUuid, Slug: o.OrganizationSlug})
	set, err := s.loadSettings(octx, o.OrganizationID)
	if err != nil {
		return 0, err
	}
	items, err := s.compute(octx, o.OrganizationID, set, nil)
	if err != nil {
		return 0, err
	}
	sum := summarize(items)
	if sum.Urgent == 0 {
		return 0, nil
	}
	recipients, err := s.q.ListStockReorderNotifyRecipients(ctx, o.OrganizationID)
	if err != nil {
		return 0, err
	}
	title, body := notifyText(sum)
	url := "/t/" + o.OrganizationSlug + "/purchases/reorder"
	sent := 0
	for _, userID := range recipients {
		if err := s.notifier.NotifyReorder(ctx, o.OrganizationID, userID, title, body, url, sum.Urgent); err != nil {
			s.log.Warn("stock_reorder_notify_member_failed", "organization_id", o.OrganizationID, "user_id", userID, "error", err)
			continue
		}
		sent++
	}
	return sent, nil
}
