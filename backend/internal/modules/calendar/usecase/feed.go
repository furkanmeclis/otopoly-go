package usecase

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/sync/errgroup"
)

// Layers the feed can return; each can be toggled in the UI.
const (
	LayerEvents     = "events"
	LayerJobs       = "jobs"
	LayerDeliveries = "deliveries"
	LayerTodos      = "todos"
	LayerQuotes     = "quotes"
	LayerLeads      = "leads"
	LayerFinance    = "finance"
	LayerSales      = "sales"
	LayerPurchases  = "purchases"
	LayerContracts  = "contracts"
)

// Layers in display order.
var Layers = []string{
	LayerEvents, LayerJobs, LayerDeliveries, LayerTodos, LayerQuotes, LayerLeads,
	LayerFinance, LayerSales, LayerPurchases, LayerContracts,
}

// layerAccess is what a member needs to see (read) or move (write) a layer.
// Feature is the plan toggle the owning module sits behind ("" = always on).
type layerAccess struct {
	read, write, feature string
	refKind              string
}

var access = map[string]layerAccess{
	LayerEvents:     {read: rbac.PermTenantCalendarRead, write: rbac.PermTenantCalendarWrite, refKind: "event"},
	LayerJobs:       {read: rbac.PermTenantJobsRead, refKind: "job"},
	LayerDeliveries: {read: rbac.PermTenantJobsRead, refKind: "job"},
	LayerTodos:      {read: rbac.PermTenantTodosRead, write: rbac.PermTenantTodosWrite, refKind: "todo"},
	LayerQuotes:     {read: rbac.PermTenantQuotesRead, feature: "module.quotes", refKind: "quote"},
	LayerLeads:      {read: rbac.PermTenantLeadsRead, write: rbac.PermTenantLeadsWrite, feature: "module.quotes", refKind: "lead"},
	LayerFinance:    {read: rbac.PermTenantFinanceRead, refKind: ""},
	LayerSales:      {read: rbac.PermTenantSalesRead, refKind: "sale"},
	LayerPurchases:  {read: rbac.PermTenantPurchasesRead, refKind: "purchase"},
	LayerContracts:  {read: rbac.PermTenantContractsRead, feature: "module.contracts", refKind: "contract"},
}

// FeedItem is one calendar entry. Kind refines the layer (e.g. finance_income
// / finance_expense); RefKind + RefUUID name the record the UI opens. All-day
// items also carry StartDate/EndDate (inclusive, business time zone).
// Movable items can be rescheduled with POST /calendar/items/move.
type FeedItem struct {
	ID        string     `json:"id"`
	Layer     string     `json:"layer"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	Subtitle  string     `json:"subtitle,omitempty"`
	StartsAt  time.Time  `json:"starts_at"`
	EndsAt    time.Time  `json:"ends_at"`
	AllDay    bool       `json:"all_day"`
	StartDate *string    `json:"start_date,omitempty"`
	EndDate   *string    `json:"end_date,omitempty"`
	Status    string     `json:"status,omitempty"`
	Amount    *string    `json:"amount,omitempty"`
	Currency  *string    `json:"currency,omitempty"`
	Count     *int64     `json:"count,omitempty"`
	RefKind   string     `json:"ref_kind,omitempty"`
	RefUUID   *uuid.UUID `json:"ref_uuid,omitempty"`
	Movable   bool       `json:"movable"`
	Event     *Event     `json:"event,omitempty"`
}

// LayerInfo tells the client which layers this member may see and move.
type LayerInfo struct {
	Key     string `json:"key"`
	Movable bool   `json:"movable"`
}

// Feed is the calendar for [From, To) (dates, To exclusive).
type Feed struct {
	From     string           `json:"from"`
	To       string           `json:"to"`
	Timezone string           `json:"timezone"`
	Layers   []LayerInfo      `json:"layers"`
	Items    []FeedItem       `json:"items"`
	Counts   map[string]int64 `json:"counts"`
}

// ParseLayers validates a comma-separated list; empty means every layer.
func ParseLayers(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Layers, nil
	}
	seen := map[string]bool{}
	out := []string{}
	for _, l := range strings.Split(raw, ",") {
		l = strings.TrimSpace(l)
		if l == "" || seen[l] {
			continue
		}
		if _, ok := access[l]; !ok {
			return nil, fmt.Errorf("%w: unknown layer %q", ErrInvalidRequest, l)
		}
		seen[l] = true
		out = append(out, l)
	}
	return out, nil
}

// Available lists the layers the caller may read (permission + plan), in
// display order, with whether the caller may move their items.
func (s *Service) Available(ctx context.Context) ([]LayerInfo, error) {
	org, err := orgID(ctx)
	if err != nil {
		return nil, err
	}
	p, _ := authctx.PrincipalFrom(ctx)
	features := map[string]bool{}
	out := make([]LayerInfo, 0, len(Layers))
	for _, l := range Layers {
		a := access[l]
		if !p.HasPermission(a.read) {
			continue
		}
		if a.feature != "" {
			on, seen := features[a.feature]
			if !seen {
				if on, err = s.ent.Enabled(ctx, org, a.feature); err != nil {
					return nil, err
				}
				features[a.feature] = on
			}
			if !on {
				continue
			}
		}
		out = append(out, LayerInfo{Key: l, Movable: a.write != "" && p.HasPermission(a.write) && s.canMove(l)})
	}
	return out, nil
}

func (s *Service) canMove(layer string) bool {
	switch layer {
	case LayerEvents:
		return true
	case LayerTodos:
		return s.todos != nil
	case LayerLeads:
		return s.leads != nil
	}
	return false
}

// ParseRange parses the [from, to) dates of a feed request.
func (s *Service) ParseRange(fromStr, toStr string) (time.Time, time.Time, error) {
	from, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(fromStr), s.loc)
	if err != nil {
		return from, from, fmt.Errorf("%w: from must be YYYY-MM-DD", ErrInvalidRequest)
	}
	to, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(toStr), s.loc)
	if err != nil {
		return from, to, fmt.Errorf("%w: to must be YYYY-MM-DD", ErrInvalidRequest)
	}
	if !to.After(from) {
		return from, to, fmt.Errorf("%w: to must be after from", ErrInvalidRequest)
	}
	if days := int(to.Sub(from).Hours()/24 + 0.5); days > maxRangeDays {
		return from, to, fmt.Errorf("%w: range is limited to %d days", ErrInvalidRequest, maxRangeDays)
	}
	return from, to, nil
}

// GetFeed collects the requested layers the caller may see for the date
// range, concurrently. Layers outside the caller's permissions or plan are
// silently left out (they are absent from Feed.Layers too).
func (s *Service) GetFeed(ctx context.Context, fromStr, toStr string, layers []string) (Feed, error) {
	from, to, err := s.ParseRange(fromStr, toStr)
	if err != nil {
		return Feed{}, err
	}
	org, err := orgID(ctx)
	if err != nil {
		return Feed{}, err
	}
	avail, err := s.Available(ctx)
	if err != nil {
		return Feed{}, err
	}
	movable := map[string]bool{}
	allowed := map[string]bool{}
	for _, l := range avail {
		allowed[l.Key] = true
		movable[l.Key] = l.Movable
	}
	var load []string
	for _, l := range layers {
		if allowed[l] {
			load = append(load, l)
		}
	}
	r := feedRange{
		org:   org,
		tsMin: pgtype.Timestamptz{Time: from, Valid: true},
		tsMax: pgtype.Timestamptz{Time: to, Valid: true},
		dMin:  pgtype.Date{Time: time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC), Valid: true},
		dMax:  pgtype.Date{Time: time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, time.UTC), Valid: true},
	}
	results := make([][]FeedItem, len(load))
	g, gctx := errgroup.WithContext(ctx)
	for i, layer := range load {
		g.Go(func() error {
			items, err := s.loadLayer(gctx, layer, r)
			results[i] = items
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return Feed{}, err
	}
	feed := Feed{
		From: from.Format("2006-01-02"), To: to.Format("2006-01-02"), Timezone: s.loc.String(),
		Layers: avail, Items: []FeedItem{}, Counts: map[string]int64{},
	}
	for i, layer := range load {
		feed.Counts[layer] = int64(len(results[i]))
		for _, it := range results[i] {
			it.RefKind = access[layer].refKind
			it.Movable = movable[layer]
			feed.Items = append(feed.Items, it)
		}
	}
	return feed, nil
}

type feedRange struct {
	org          int64
	tsMin, tsMax pgtype.Timestamptz
	dMin, dMax   pgtype.Date
}

func (s *Service) eventItem(e Event) FeedItem {
	id := e.UUID
	return FeedItem{
		ID: "events:" + e.UUID.String(), Layer: LayerEvents, Kind: "event", Title: e.Title,
		Subtitle: e.Location, StartsAt: e.StartsAt, EndsAt: e.EndsAt, AllDay: e.AllDay,
		StartDate: e.StartDate, EndDate: e.EndDate, RefUUID: &id, Event: &e,
	}
}

func (s *Service) loadLayer(ctx context.Context, layer string, r feedRange) ([]FeedItem, error) {
	switch layer {
	case LayerEvents:
		rows, err := s.q.ListCalendarEventsInRange(ctx, db.ListCalendarEventsInRangeParams{OrganizationID: r.org, RangeFrom: r.tsMin, RangeTo: r.tsMax})
		if err != nil {
			return nil, err
		}
		out := make([]FeedItem, 0, len(rows))
		for _, row := range rows {
			out = append(out, s.eventItem(s.mapEvent(row)))
		}
		return out, nil

	case LayerJobs:
		rows, err := s.q.CalendarJobsOpened(ctx, db.CalendarJobsOpenedParams{OrganizationID: r.org, RangeFrom: r.tsMin, RangeTo: r.tsMax})
		if err != nil {
			return nil, err
		}
		out := make([]FeedItem, 0, len(rows))
		for _, row := range rows {
			start := row.StartedAt.Time
			out = append(out, FeedItem{
				ID: "jobs:" + row.Uuid.String(), Layer: LayerJobs, Kind: "job_opened",
				Title: row.Plate, Subtitle: joinNonEmpty(" · ", row.CustomerName, row.VehicleLabel),
				StartsAt: start, EndsAt: start.Add(time.Hour), Status: row.Status,
				Amount: amount(row.TotalAmount), Currency: str(row.Currency), RefUUID: ref(row.Uuid),
			})
		}
		return out, nil

	case LayerDeliveries:
		rows, err := s.q.CalendarJobsDelivered(ctx, db.CalendarJobsDeliveredParams{OrganizationID: r.org, RangeFrom: r.tsMin, RangeTo: r.tsMax})
		if err != nil {
			return nil, err
		}
		out := make([]FeedItem, 0, len(rows))
		for _, row := range rows {
			at := row.DeliveredAt.Time
			out = append(out, FeedItem{
				ID: "deliveries:" + row.Uuid.String(), Layer: LayerDeliveries, Kind: "job_delivered",
				Title: row.Plate, Subtitle: joinNonEmpty(" · ", row.CustomerName, row.VehicleLabel),
				StartsAt: at, EndsAt: at.Add(30 * time.Minute),
				Status: row.PaymentStatus, Amount: amount(row.TotalAmount), Currency: str(row.Currency), RefUUID: ref(row.Uuid),
			})
		}
		return out, nil

	case LayerTodos:
		rows, err := s.q.CalendarTodos(ctx, db.CalendarTodosParams{OrganizationID: r.org, DateFrom: r.dMin, DateTo: r.dMax})
		if err != nil {
			return nil, err
		}
		out := make([]FeedItem, 0, len(rows))
		for _, row := range rows {
			item := s.dayItem("todos:"+row.Uuid.String(), LayerTodos, "todo", row.Title, row.DueDate)
			if row.DueTime.Valid {
				d := row.DueDate.Time
				start := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, s.loc).Add(time.Duration(row.DueTime.Microseconds) * time.Microsecond)
				item.AllDay, item.StartDate, item.EndDate = false, nil, nil
				item.StartsAt, item.EndsAt = start, start.Add(30*time.Minute)
			}
			item.Subtitle = row.CustomerName.String
			item.Status = row.Status
			item.RefUUID = ref(row.Uuid)
			out = append(out, item)
		}
		return out, nil

	case LayerQuotes:
		rows, err := s.q.CalendarQuotesExpiring(ctx, db.CalendarQuotesExpiringParams{OrganizationID: r.org, DateFrom: r.dMin, DateTo: r.dMax})
		if err != nil {
			return nil, err
		}
		out := make([]FeedItem, 0, len(rows))
		for _, row := range rows {
			item := s.dayItem("quotes:"+row.Uuid.String(), LayerQuotes, "quote_expiry", row.Number, row.ValidUntil)
			item.Subtitle, item.Status = row.CustomerName, row.Status
			item.Amount, item.Currency, item.RefUUID = amount(row.GrandTotal), str(row.Currency), ref(row.Uuid)
			out = append(out, item)
		}
		return out, nil

	case LayerLeads:
		rows, err := s.q.CalendarLeadFollowUps(ctx, db.CalendarLeadFollowUpsParams{OrganizationID: r.org, DateFrom: r.dMin, DateTo: r.dMax})
		if err != nil {
			return nil, err
		}
		out := make([]FeedItem, 0, len(rows))
		for _, row := range rows {
			item := s.dayItem("leads:"+row.Uuid.String(), LayerLeads, "lead_follow_up", row.CustomerName, row.FollowUpDate)
			item.Subtitle, item.Status, item.RefUUID = row.Interest, row.Temperature, ref(row.Uuid)
			out = append(out, item)
		}
		return out, nil

	case LayerFinance:
		rows, err := s.q.CalendarFinanceDaily(ctx, db.CalendarFinanceDailyParams{OrganizationID: r.org, DateFrom: r.dMin, DateTo: r.dMax})
		if err != nil {
			return nil, err
		}
		out := make([]FeedItem, 0, len(rows))
		for _, row := range rows {
			day := row.TransactionDate.Time.Format("2006-01-02")
			item := s.dayItem(fmt.Sprintf("finance:%s:%s:%s", day, row.Type, row.Currency), LayerFinance, "finance_"+row.Type, "", row.TransactionDate)
			count := row.Count
			item.Amount, item.Currency, item.Count = amount(row.Total), str(row.Currency), &count
			out = append(out, item)
		}
		return out, nil

	case LayerSales:
		rows, err := s.q.CalendarSales(ctx, db.CalendarSalesParams{OrganizationID: r.org, RangeFrom: r.tsMin, RangeTo: r.tsMax})
		if err != nil {
			return nil, err
		}
		out := make([]FeedItem, 0, len(rows))
		for _, row := range rows {
			at := row.SoldAt.Time
			out = append(out, FeedItem{
				ID: "sales:" + row.Uuid.String(), Layer: LayerSales, Kind: "sale", Title: row.CustomerName,
				StartsAt: at, EndsAt: at.Add(30 * time.Minute), Status: row.Method,
				Amount: amount(row.TotalAmount), Currency: str(row.Currency), RefUUID: ref(row.Uuid),
			})
		}
		return out, nil

	case LayerPurchases:
		rows, err := s.q.CalendarPurchases(ctx, db.CalendarPurchasesParams{OrganizationID: r.org, RangeFrom: r.tsMin, RangeTo: r.tsMax})
		if err != nil {
			return nil, err
		}
		out := make([]FeedItem, 0, len(rows))
		for _, row := range rows {
			at := row.PurchasedAt.Time
			out = append(out, FeedItem{
				ID: "purchases:" + row.Uuid.String(), Layer: LayerPurchases, Kind: "purchase", Title: row.SupplierName,
				StartsAt: at, EndsAt: at.Add(30 * time.Minute), Status: row.Method,
				Amount: amount(row.TotalAmount), Currency: str(row.Currency), RefUUID: ref(row.Uuid),
			})
		}
		return out, nil

	case LayerContracts:
		rows, err := s.q.CalendarContracts(ctx, db.CalendarContractsParams{OrganizationID: r.org, RangeFrom: r.tsMin, RangeTo: r.tsMax})
		if err != nil {
			return nil, err
		}
		out := make([]FeedItem, 0, len(rows))
		for _, row := range rows {
			at := row.ExecutedAt.Time
			out = append(out, FeedItem{
				ID: "contracts:" + row.Uuid.String(), Layer: LayerContracts, Kind: "contract_executed",
				Title: row.Title, Subtitle: fmt.Sprintf("#%d", row.Number), StartsAt: at, EndsAt: at.Add(30 * time.Minute),
				Status: row.Status, RefUUID: ref(row.Uuid),
			})
		}
		return out, nil
	}
	return nil, fmt.Errorf("%w: unknown layer %q", ErrInvalidRequest, layer)
}

// dayItem builds an all-day item for a DATE column (business time zone).
func (s *Service) dayItem(id, layer, kind, title string, d pgtype.Date) FeedItem {
	day := d.Time.Format("2006-01-02")
	start := time.Date(d.Time.Year(), d.Time.Month(), d.Time.Day(), 0, 0, 0, 0, s.loc)
	return FeedItem{
		ID: id, Layer: layer, Kind: kind, Title: title, AllDay: true,
		StartsAt: start, EndsAt: start.AddDate(0, 0, 1), StartDate: &day, EndDate: &day,
	}
}

func amount(n pgtype.Numeric) *string {
	if !n.Valid {
		return nil
	}
	v := financeusecase.NumericToString(n)
	return &v
}

func str(v string) *string { return &v }

func ref(id uuid.UUID) *uuid.UUID { return &id }

func joinNonEmpty(sep string, parts ...string) string {
	var out []string
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, sep)
}
