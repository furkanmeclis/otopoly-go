package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/jackc/pgx/v5/pgtype"
)

// ─── Widgets ───────────────────────────────────────────────────────────────

const (
	// widgetDataBudget caps the JSON of a widget push's data (kind, org,
	// snapshot). APNs and FCM allow 4 KB for the whole message; Expo adds
	// its own envelope, so the data stays well below that. Queue items are
	// dropped from the end (and counted in More) until it fits.
	widgetDataBudget = 3000
	// widgetAgendaMax is how many upcoming agenda items a snapshot carries.
	widgetAgendaMax = 3
	// widgetAccountsMax is how many account balances a snapshot carries.
	widgetAccountsMax = 4
	// widgetWeekDays is the length of the collections series.
	widgetWeekDays = 7
	// widgetRenewalHorizon is how far ahead subscription renewals count as due.
	widgetRenewalHorizon = 7
)

// WidgetSnapshot is the compact "today" state carried by a widget push and
// returned by GET /live-activities/widget-snapshot. The app turns it into
// widget props with the same code it uses in the foreground
// (buildTodayPropsFromSnapshot), adding labels and formatting.
//
// Snapshots are built per recipient: Money only for members with
// tenant.finance.read, each alert and agenda source only for members who
// may read that module. A missing part means "locked", an empty one "none".
type WidgetSnapshot struct {
	V      int          `json:"v"`
	Date   string       `json:"date"`
	At     int64        `json:"at"`
	Counts WidgetCounts `json:"counts"`
	// PaidTotal is the day's collections (Money.Collected), kept for app
	// versions that predate Money. Empty without tenant.finance.read.
	PaidTotal string        `json:"paid_total,omitempty"`
	Queue     []WidgetQueue `json:"queue"`
	// More is how many open jobs did not fit into Queue.
	More   int           `json:"more"`
	Money  *WidgetMoney  `json:"money,omitempty"`
	Alerts *WidgetAlerts `json:"alerts,omitempty"`
	Agenda *WidgetAgenda `json:"agenda,omitempty"`
}

// WidgetCounts are the dashboard "today" tiles.
type WidgetCounts struct {
	InProgress int `json:"in_progress"`
	Ready      int `json:"ready"`
	Delivered  int `json:"delivered"`
}

// WidgetQueue is one open job (ready first, then in progress).
type WidgetQueue struct {
	ID        string `json:"id"`
	Plate     string `json:"plate"`
	Name      string `json:"name"`
	Vehicle   string `json:"vehicle"`
	Status    string `json:"status"`
	StartedAt string `json:"started_at"`
}

// WidgetMoney is the day's money (finance.DayMoney) in decimal strings.
type WidgetMoney struct {
	Currency string `json:"cur"`
	// Collected is the day's real collections ("tahsilat"), see
	// financeusecase.TodayMoney.
	Collected string `json:"collected"`
	// Jobs is the jobs revenue of the day ("işlerden ciro"): paid jobs,
	// cari closes included. It is not money in and is shown apart.
	Jobs     string `json:"jobs"`
	Cash     string `json:"cash"`
	Card     string `json:"card"`
	Transfer string `json:"transfer"`
	Other    string `json:"other"`
	Expense  string `json:"expense"`
	Net      string `json:"net"`
	// Week is Collected per day, oldest first, ending on Date.
	Week     []string        `json:"week"`
	Accounts []WidgetAccount `json:"accounts"`
}

// WidgetAccount is one cash / bank balance.
type WidgetAccount struct {
	Name    string `json:"n"`
	Type    string `json:"t"`
	Balance string `json:"b"`
}

// WidgetAlerts are the things that need someone's attention. A nil field
// is a module the recipient may not read.
type WidgetAlerts struct {
	// Stock: active stock-tracked products at or below their minimum.
	Stock *int64 `json:"stock,omitempty"`
	// Reviews: answered reviews waiting for a follow-up.
	Reviews *int64 `json:"reviews,omitempty"`
	// Renewals: subscriptions past due or due within 7 days.
	Renewals *int64 `json:"renewals,omitempty"`
	// Unpaid: jobs delivered today without payment.
	Unpaid *int64 `json:"unpaid,omitempty"`
}

// WidgetAgenda is the next few calendar events / to-dos of the day.
type WidgetAgenda struct {
	Items []WidgetAgendaItem `json:"items"`
}

// WidgetAgendaItem is one agenda entry. At is RFC 3339 (UTC), empty for an
// all-day event or an untimed to-do.
type WidgetAgendaItem struct {
	Kind  string `json:"k"`
	ID    string `json:"id"`
	Title string `json:"t"`
	At    string `json:"at"`
}

// WidgetAccess is what one recipient may see on the widgets.
type WidgetAccess struct {
	Jobs, Finance, Catalog, Reviews, Loyalty, Calendar, Todos bool
}

// WidgetAccessFrom reads the widget access out of permission slugs.
func WidgetAccessFrom(has func(slug string) bool) WidgetAccess {
	return WidgetAccess{
		Jobs:     has(rbac.PermTenantJobsRead),
		Finance:  has(rbac.PermTenantFinanceRead),
		Catalog:  has(rbac.PermTenantCatalogRead),
		Reviews:  has(rbac.PermTenantReviewsRead),
		Loyalty:  has(rbac.PermTenantLoyaltyRead),
		Calendar: has(rbac.PermTenantCalendarRead),
		Todos:    has(rbac.PermTenantTodosRead),
	}
}

func (a WidgetAccess) key() string {
	b := []bool{a.Jobs, a.Finance, a.Catalog, a.Reviews, a.Loyalty, a.Calendar, a.Todos}
	out := make([]byte, len(b))
	for i, v := range b {
		out[i] = '0'
		if v {
			out[i] = '1'
		}
	}
	return string(out)
}

// widgetParts loads each part of a snapshot at most once per build, so a
// push to many recipients costs the same queries as one.
type widgetParts struct {
	s         *Service
	org       int64
	now       time.Time
	day, next time.Time

	base     *WidgetSnapshot
	money    *WidgetMoney
	counts   map[string]*int64
	events   []WidgetAgendaItem
	todos    []WidgetAgendaItem
	loaded   map[string]bool
	agendaAt map[string]time.Time
}

func (s *Service) newWidgetParts(orgID int64) *widgetParts {
	now := s.now().In(s.loc)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, s.loc)
	return &widgetParts{
		s: s, org: orgID, now: now, day: day, next: day.AddDate(0, 0, 1),
		counts: map[string]*int64{}, loaded: map[string]bool{}, agendaAt: map[string]time.Time{},
	}
}

func tsArg(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

// jobs: today's jobs of the organization (same list as the app's widget
// sync: today plus open carry-overs and today's deliveries).
func (p *widgetParts) jobs(ctx context.Context) (WidgetSnapshot, error) {
	if p.base != nil {
		return *p.base, nil
	}
	rows, err := p.s.q.ListServiceJobs(ctx, db.ListServiceJobsParams{
		OrganizationID: p.org,
		DateFrom:       tsArg(p.day),
		DateTo:         tsArg(p.next),
		IncludeOpen:    true,
		Sort:           "-started_at",
		LimitCount:     100,
	})
	if err != nil {
		return WidgetSnapshot{}, err
	}
	snap := WidgetSnapshot{V: 1, Date: p.day.Format("2006-01-02"), At: p.now.UnixMilli(), Queue: []WidgetQueue{}}
	var ready, working []WidgetQueue
	for _, r := range rows {
		item := WidgetQueue{
			ID: r.Uuid.String(), Plate: r.Plate, Name: clip(r.CustomerName, 40), Vehicle: clip(r.VehicleLabel, 40),
			Status: r.Status,
		}
		if r.StartedAt.Valid {
			item.StartedAt = r.StartedAt.Time.UTC().Format(time.RFC3339)
		}
		switch r.Status {
		case "in_progress":
			snap.Counts.InProgress++
			working = append(working, item)
		case "ready":
			snap.Counts.Ready++
			ready = append(ready, item)
		case "delivered":
			snap.Counts.Delivered++
		}
	}
	all := append(ready, working...)
	if len(all) > widgetQueueMax {
		snap.More = len(all) - widgetQueueMax
		all = all[:widgetQueueMax]
	}
	snap.Queue = append(snap.Queue, all...)
	p.base = &snap
	return snap, nil
}

func (p *widgetParts) moneyPart(ctx context.Context) (*WidgetMoney, error) {
	if p.money != nil {
		return p.money, nil
	}
	m, err := financeusecase.DayMoney(ctx, p.s.q, p.org, p.now, financeusecase.DayMoneyOptions{
		SeriesDays: widgetWeekDays, Accounts: widgetAccountsMax,
	})
	if err != nil {
		return nil, err
	}
	sum, err := p.s.q.SumServiceJobsDaily(ctx, db.SumServiceJobsDailyParams{
		OrganizationID: p.org, DayStart: tsArg(p.day), DayEnd: tsArg(p.next),
	})
	if err != nil {
		return nil, err
	}
	out := &WidgetMoney{
		Currency: m.Currency, Collected: m.CollectedTotal, Jobs: amountString(numericString(sum.PaidTotal)),
		Cash: m.ByMethod.Cash, Card: m.ByMethod.Card, Transfer: m.ByMethod.Transfer, Other: m.ByMethod.Other,
		Expense: m.ExpenseTotal, Net: m.Net, Week: make([]string, 0, len(m.Series)), Accounts: []WidgetAccount{},
	}
	for _, d := range m.Series {
		out.Week = append(out.Week, d.Collected)
	}
	for _, a := range m.Accounts {
		out.Accounts = append(out.Accounts, WidgetAccount{Name: clip(a.Name, 24), Type: a.Type, Balance: a.Balance})
	}
	p.money = out
	return out, nil
}

func (p *widgetParts) count(ctx context.Context, name string) (*int64, error) {
	if p.loaded[name] {
		return p.counts[name], nil
	}
	var n int64
	var err error
	switch name {
	case "stock":
		n, err = p.s.q.WidgetLowStockCount(ctx, p.org)
	case "reviews":
		n, err = p.s.q.WidgetReviewFollowUpCount(ctx, p.org)
	case "unpaid":
		n, err = p.s.q.WidgetUnpaidDeliveredCount(ctx, db.WidgetUnpaidDeliveredCountParams{
			OrganizationID: p.org, DayStart: tsArg(p.day), DayEnd: tsArg(p.next),
		})
	case "renewals":
		today := time.Date(p.day.Year(), p.day.Month(), p.day.Day(), 0, 0, 0, 0, time.UTC)
		var row db.LoyaltyRenewalCountsRow
		row, err = p.s.q.LoyaltyRenewalCounts(ctx, db.LoyaltyRenewalCountsParams{
			OrganizationID: p.org,
			Today:          pgtype.Date{Time: today, Valid: true},
			Horizon:        pgtype.Date{Time: today.AddDate(0, 0, widgetRenewalHorizon), Valid: true},
		})
		n = row.PastDueCount + row.UpcomingCount
	default:
		return nil, fmt.Errorf("livepush: unknown widget count %q", name)
	}
	if err != nil {
		return nil, err
	}
	p.loaded[name] = true
	p.counts[name] = &n
	return &n, nil
}

func (p *widgetParts) eventItems(ctx context.Context) ([]WidgetAgendaItem, error) {
	if p.loaded["events"] {
		return p.events, nil
	}
	rows, err := p.s.q.WidgetAgendaEvents(ctx, db.WidgetAgendaEventsParams{
		OrganizationID: p.org, DayEnd: tsArg(p.next), NowAt: tsArg(p.now), LimitCount: widgetAgendaMax * 2,
	})
	if err != nil {
		return nil, err
	}
	out := make([]WidgetAgendaItem, 0, len(rows))
	for _, r := range rows {
		item := WidgetAgendaItem{Kind: "event", ID: r.Uuid.String(), Title: clip(r.Title, 40)}
		if !r.AllDay {
			item.At = r.StartsAt.Time.UTC().Format(time.RFC3339)
			p.agendaAt[item.ID] = r.StartsAt.Time
		}
		out = append(out, item)
	}
	p.loaded["events"] = true
	p.events = out
	return out, nil
}

func (p *widgetParts) todoItems(ctx context.Context) ([]WidgetAgendaItem, error) {
	if p.loaded["todos"] {
		return p.todos, nil
	}
	clock := int64(p.now.Hour())*3600 + int64(p.now.Minute())*60
	rows, err := p.s.q.WidgetAgendaTodos(ctx, db.WidgetAgendaTodosParams{
		OrganizationID: p.org,
		Day:            pgtype.Date{Time: time.Date(p.day.Year(), p.day.Month(), p.day.Day(), 0, 0, 0, 0, time.UTC), Valid: true},
		AfterTime:      pgtype.Time{Microseconds: clock * 1_000_000, Valid: true},
		LimitCount:     widgetAgendaMax * 2,
	})
	if err != nil {
		return nil, err
	}
	out := make([]WidgetAgendaItem, 0, len(rows))
	for _, r := range rows {
		item := WidgetAgendaItem{Kind: "todo", ID: r.Uuid.String(), Title: clip(r.Title, 40)}
		if r.DueTime.Valid {
			at := p.day.Add(time.Duration(r.DueTime.Microseconds) * time.Microsecond)
			item.At = at.UTC().Format(time.RFC3339)
			p.agendaAt[item.ID] = at
		}
		out = append(out, item)
	}
	p.loaded["todos"] = true
	p.todos = out
	return out, nil
}

// build assembles the snapshot one recipient may see.
func (p *widgetParts) build(ctx context.Context, a WidgetAccess) (WidgetSnapshot, error) {
	base, err := p.jobs(ctx)
	if err != nil {
		return WidgetSnapshot{}, err
	}
	snap := base
	snap.Queue = append([]WidgetQueue{}, base.Queue...)
	if a.Finance {
		m, err := p.moneyPart(ctx)
		if err != nil {
			return WidgetSnapshot{}, err
		}
		cp := *m
		snap.Money = &cp
		snap.PaidTotal = m.Collected
	}
	alerts := &WidgetAlerts{}
	for _, it := range []struct {
		ok   bool
		name string
		dst  **int64
	}{
		{a.Catalog, "stock", &alerts.Stock},
		{a.Reviews, "reviews", &alerts.Reviews},
		{a.Loyalty, "renewals", &alerts.Renewals},
		{a.Jobs, "unpaid", &alerts.Unpaid},
	} {
		if !it.ok {
			continue
		}
		n, err := p.count(ctx, it.name)
		if err != nil {
			return WidgetSnapshot{}, err
		}
		*it.dst = n
	}
	snap.Alerts = alerts
	if a.Calendar || a.Todos {
		var items []WidgetAgendaItem
		if a.Calendar {
			ev, err := p.eventItems(ctx)
			if err != nil {
				return WidgetSnapshot{}, err
			}
			items = append(items, ev...)
		}
		if a.Todos {
			td, err := p.todoItems(ctx)
			if err != nil {
				return WidgetSnapshot{}, err
			}
			items = append(items, td...)
		}
		// Timed items by time first, then all-day / untimed ones.
		sort.SliceStable(items, func(i, j int) bool {
			ti, iok := p.agendaAt[items[i].ID]
			tj, jok := p.agendaAt[items[j].ID]
			if iok != jok {
				return iok
			}
			return ti.Before(tj)
		})
		if len(items) > widgetAgendaMax {
			items = items[:widgetAgendaMax]
		}
		snap.Agenda = &WidgetAgenda{Items: append([]WidgetAgendaItem{}, items...)}
	}
	return snap, nil
}

// widgetData is the data of a widget push.
func widgetData(orgUUID string, snap WidgetSnapshot) map[string]any {
	return map[string]any{"kind": KindWidgetsRefresh, "org": orgUUID, "snapshot": snap}
}

// fitWidgetSnapshot drops queue items from the end until the push data fits
// widgetDataBudget; the dropped jobs are counted in More.
func fitWidgetSnapshot(orgUUID string, snap WidgetSnapshot) (WidgetSnapshot, int) {
	for {
		raw, err := json.Marshal(widgetData(orgUUID, snap))
		if err != nil || len(raw) <= widgetDataBudget || len(snap.Queue) == 0 {
			return snap, len(raw)
		}
		snap.Queue = snap.Queue[:len(snap.Queue)-1]
		snap.More++
	}
}

// BuildSnapshot builds the snapshot a member with the given access sees,
// trimmed to fit a push.
func (s *Service) BuildSnapshot(ctx context.Context, orgID int64, access WidgetAccess) (WidgetSnapshot, error) {
	org, err := s.q.GetOrganizationByID(ctx, orgID)
	if err != nil {
		return WidgetSnapshot{}, err
	}
	snap, err := s.newWidgetParts(orgID).build(ctx, access)
	if err != nil {
		return WidgetSnapshot{}, err
	}
	snap, _ = fitWidgetSnapshot(org.Uuid.String(), snap)
	return snap, nil
}

// Snapshot is BuildSnapshot for the caller's organization (in-app sync).
func (s *Service) Snapshot(ctx context.Context, access WidgetAccess) (WidgetSnapshot, error) {
	orgID, err := s.scope(ctx)
	if err != nil {
		return WidgetSnapshot{}, err
	}
	return s.BuildSnapshot(ctx, orgID, access)
}

// recipientAccess loads the widget access of the users behind the targets.
func (s *Service) recipientAccess(ctx context.Context, targets []db.ListWidgetRefreshTargetsRow) (map[int64]WidgetAccess, error) {
	ids := make([]int64, 0, len(targets))
	seen := map[int64]bool{}
	for _, t := range targets {
		if !seen[t.UserID] {
			seen[t.UserID] = true
			ids = append(ids, t.UserID)
		}
	}
	rows, err := s.q.ListPermissionSlugsForUsers(ctx, ids)
	if err != nil {
		return nil, err
	}
	perms := map[int64]map[string]bool{}
	for _, r := range rows {
		if perms[r.UserID] == nil {
			perms[r.UserID] = map[string]bool{}
		}
		perms[r.UserID][r.Slug] = true
	}
	out := make(map[int64]WidgetAccess, len(ids))
	for _, id := range ids {
		set := perms[id]
		out[id] = WidgetAccessFrom(func(slug string) bool { return set[slug] })
	}
	return out, nil
}

// ProcessWidgets sends the organization's snapshot to every device showing
// its widgets, at most once per WidgetMinInterval (later calls inside the
// window fold into one trailing push). Each recipient gets the parts their
// permissions allow; members who lost tenant.jobs.read get nothing.
func (s *Service) ProcessWidgets(ctx context.Context, p queue.LiveWidgetsPayload) error {
	if s.expo == nil || p.OrganizationID <= 0 {
		return nil
	}
	targets, err := s.q.ListWidgetRefreshTargets(ctx, p.OrganizationID)
	if err != nil || len(targets) == 0 {
		return err
	}
	now := s.now()
	last, err := s.q.LastWidgetPushAt(ctx, p.OrganizationID)
	if err != nil {
		return err
	}
	if last.Valid {
		if wait := WidgetMinInterval - now.Sub(last.Time); wait > 0 {
			if s.queue != nil {
				slot := strconv.FormatInt(last.Time.Add(WidgetMinInterval).Unix(), 10)
				if err := queue.EnqueueLiveWidgets(s.queue, p.OrganizationID, wait, slot); err != nil && !errors.Is(err, queue.ErrDuplicate) {
					return err
				}
			}
			return nil
		}
	}
	org, err := s.q.GetOrganizationByID(ctx, p.OrganizationID)
	if err != nil {
		return err
	}
	access, err := s.recipientAccess(ctx, targets)
	if err != nil {
		return err
	}
	parts := s.newWidgetParts(p.OrganizationID)
	orgUUID := org.Uuid.String()
	snapshots := map[string]WidgetSnapshot{}
	msgs := make([]ExpoMessage, 0, len(targets))
	sent := make([]db.ListWidgetRefreshTargetsRow, 0, len(targets))
	for _, t := range targets {
		a := access[t.UserID]
		if !a.Jobs {
			continue
		}
		snap, ok := snapshots[a.key()]
		if !ok {
			built, err := parts.build(ctx, a)
			if err != nil {
				return err
			}
			snap, _ = fitWidgetSnapshot(orgUUID, built)
			snapshots[a.key()] = snap
		}
		m := ExpoMessage{
			To:   t.Token,
			Data: widgetData(orgUUID, snap),
			TTL:  int((15 * time.Minute) / time.Second),
		}
		if t.Platform == "ios" {
			m.ContentAvailable = true
			m.Priority = "normal"
		} else {
			m.Priority = "high"
		}
		msgs = append(msgs, m)
		sent = append(sent, t)
	}
	if len(msgs) == 0 {
		return nil
	}
	// Mark first: a failing Expo call must not turn into a push storm.
	if err := s.q.MarkWidgetPushSent(ctx, p.OrganizationID); err != nil {
		return err
	}
	tickets, err := s.expo.Send(ctx, msgs)
	if err != nil {
		return fmt.Errorf("livepush: widgets: %w", err)
	}
	for i, t := range tickets {
		if i < len(sent) && t.DeviceGone() {
			_ = s.q.DisablePushDevice(ctx, db.DisablePushDeviceParams{ID: sent[i].PushDeviceID, Reason: "DeviceNotRegistered"})
		}
	}
	return nil
}

// amountString normalises a numeric string to two decimals ("0" → "0.00").
func amountString(v string) string {
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return "0.00"
	}
	return strconv.FormatFloat(f, 'f', 2, 64)
}
