package usecase

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
)

// Owner alert kinds (notification center, system templates in 000070).
const (
	KindUsageWarning        = "billing.usage_warning"
	KindLimitFull           = "billing.limit_full"
	KindLimitReached        = "billing.limit_reached"
	KindSubscriptionEnding  = "billing.subscription_ending"
	ownerAlertSubjectType   = "billing_alert"
	ownerAlertBillingPath   = "/settings/billing"
	storageFeatureKey       = "storage.gb"
	ownerAlertDefaultLocale = "tr"
)

// CenterDispatcher is the notification center (in-app + e-mail per owner).
type CenterDispatcher interface {
	Dispatch(ctx context.Context, n centermodel.Notification) (centermodel.Result, error)
}

// SetOwnerAlerts enables plan-limit / renewal alerts to organization owners
// through the notification center. appURL is the public web origin used for
// the billing link in e-mails.
func (s *Service) SetOwnerAlerts(center CenterDispatcher, appURL string) {
	s.center = center
	s.appURL = strings.TrimRight(appURL, "/")
}

func thresholdKind(th string) string {
	switch th {
	case entitlements.ThresholdWarning:
		return KindUsageWarning
	case entitlements.ThresholdFull:
		return KindLimitFull
	case entitlements.ThresholdReached:
		return KindLimitReached
	}
	return ""
}

// alertPeriod is the dedupe bucket: monthly counters alert once per counter
// month; daily and total counters once per subscription billing period.
func alertPeriod(a entitlements.Alert, sub db.GetLiveSubscriptionRow) string {
	if a.Period == entitlements.PeriodMonth && a.PeriodKey != "" {
		return sub.Uuid.String() + ":" + a.PeriodKey
	}
	return sub.Uuid.String() + ":" + sub.EndsAt.Time.UTC().Format("20060102")
}

// LimitAlert implements entitlements.Alerter: it notifies every owner of the
// organization once per threshold and billing period (in-app + e-mail) and
// reports whether the owners are notified (now or earlier in the period).
func (s *Service) LimitAlert(ctx context.Context, a entitlements.Alert) bool {
	kind := thresholdKind(a.Threshold)
	if s == nil || s.center == nil || kind == "" || a.Limit <= 0 {
		return false
	}
	sub, err := s.q.GetLiveSubscription(ctx, a.OrgID)
	if err != nil {
		return false
	}
	used, limit := a.Used, a.Limit
	if a.Key == storageFeatureKey {
		used, limit = used/mbPerGB, limit/mbPerGB
	}
	percent := int64(100)
	if a.Threshold == entitlements.ThresholdWarning {
		percent = used * 100 / max(limit, 1)
	}
	labels := s.featureLabels(ctx, a.Key)
	vars := map[string]string{
		"used":      strconv.FormatInt(used, 10),
		"limit":     strconv.FormatInt(limit, 10),
		"percent":   strconv.FormatInt(percent, 10),
		"plan_name": sub.PlanName,
	}
	key := fmt.Sprintf("%s:%s:%s", kind, alertPeriod(a, sub), a.Key)
	return s.notifyOwners(ctx, a.OrgID, kind, key, vars, func(locale string) map[string]string {
		return map[string]string{"feature_label": labels.pick(locale)}
	})
}

// subscriptionEndingAlert notifies owners that the plan ends in `days` days.
// Returns false when the center is not wired (caller falls back).
func (s *Service) subscriptionEndingAlert(ctx context.Context, orgID int64, subUUID string, planCode string, endsAt time.Time, days int32) bool {
	if s.center == nil {
		return false
	}
	planName := planCode
	if sub, err := s.q.GetLiveSubscription(ctx, orgID); err == nil {
		planName = sub.PlanName
	}
	vars := map[string]string{
		"days_left": strconv.Itoa(int(days)),
		"plan_name": planName,
	}
	key := fmt.Sprintf("%s:%s:%d", KindSubscriptionEnding, subUUID, days)
	return s.notifyOwners(ctx, orgID, KindSubscriptionEnding, key, vars, func(locale string) map[string]string {
		return map[string]string{"ends_at": formatAlertDate(endsAt, locale)}
	})
}

func (s *Service) notifyOwners(ctx context.Context, orgID int64, kind, key string, vars map[string]string, localized func(locale string) map[string]string) bool {
	owners, err := s.q.ListOrganizationOwnersForAlert(ctx, orgID)
	if err != nil || len(owners) == 0 {
		return false
	}
	path := ""
	if org, err := s.q.GetNotificationOrganization(ctx, orgID); err == nil && org.Slug != "" {
		path = "/t/" + org.Slug + ownerAlertBillingPath
	}
	notified := false
	for _, o := range owners {
		locale := o.Locale
		if locale != "en" {
			locale = ownerAlertDefaultLocale
		}
		v := make(map[string]string, len(vars)+3)
		for k, val := range vars {
			v[k] = val
		}
		for k, val := range localized(locale) {
			v[k] = val
		}
		if path != "" && s.appURL != "" {
			v["billing_link"] = s.appURL + path
		}
		dedupe := fmt.Sprintf("%s:u%d", key, o.ID)
		if len(dedupe) > 255 {
			dedupe = dedupe[:255]
		}
		if _, err := s.center.Dispatch(ctx, centermodel.Notification{
			OrgID: orgID, Kind: kind,
			SubjectType: ownerAlertSubjectType, SubjectID: orgID,
			Recipient: centermodel.Recipient{UserID: o.ID},
			Channels:  []string{centermodel.ChannelInapp, centermodel.ChannelEmail},
			Vars:      v, Locale: locale, ActionURL: path,
			DedupeKey: dedupe,
		}); err != nil {
			continue
		}
		notified = true
	}
	return notified
}

type featureLabels struct{ tr, en string }

func (l featureLabels) pick(locale string) string {
	if locale == "en" && l.en != "" {
		return l.en
	}
	return l.tr
}

func (s *Service) featureLabels(ctx context.Context, key string) featureLabels {
	out := featureLabels{tr: key, en: key}
	rows, err := s.q.ListBillingFeatures(ctx, false)
	if err != nil {
		return out
	}
	for _, r := range rows {
		if r.Key == key {
			if r.LabelTr != "" {
				out.tr = r.LabelTr
			}
			if r.LabelEn != "" {
				out.en = r.LabelEn
			}
			break
		}
	}
	return out
}

var enMonths = []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

func formatAlertDate(t time.Time, locale string) string {
	t = t.In(istanbulLocation())
	if locale == "en" {
		return fmt.Sprintf("%s %d, %d", enMonths[t.Month()-1], t.Day(), t.Year())
	}
	return t.Format("02.01.2006")
}
