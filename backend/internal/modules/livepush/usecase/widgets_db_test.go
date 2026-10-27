package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bizclock"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/google/uuid"
)

// widgetNoon is 12:00 of the current Europe/Istanbul day, so fixtures placed
// around it never cross midnight whenever the test runs.
func widgetNoon() time.Time {
	d := bizclock.StartOfDay(time.Now())
	return d.Add(12 * time.Hour)
}

// Snapshots are per recipient: money only with tenant.finance.read, each
// alert and agenda source only with that module's read permission, nothing
// at all without tenant.jobs.read.
func TestWidgetSnapshotPermissionsAndContents_DB(t *testing.T) {
	f := setupLive(t)
	noon := widgetNoon()
	f.svc.SetClock(func() time.Time { return noon })
	ctx := context.Background()
	f.fx.Exec(`UPDATE service_jobs SET started_at = $2, plate = '34 ABC 123' WHERE id = $1`, f.job.ID, noon.Add(-time.Hour))

	// A delivered, unpaid job of today.
	c2 := f.fx.Customer(f.org, "Ayşe")
	j2 := f.fx.Job(f.org, c2, f.fx.Vehicle(f.org, c2), f.user)
	f.fx.Exec(`UPDATE service_jobs SET started_at = $2, status = 'delivered', delivered_at = $2, payment_status = 'unpaid' WHERE id = $1`, j2.ID, noon.Add(-30*time.Minute))

	// Money: a cash job payment and a card sale today, a transfer (excluded).
	if err := financeusecase.SeedDefaults(ctx, f.q, f.org.ID); err != nil {
		t.Fatal(err)
	}
	day := noon.Format("2006-01-02")
	f.fx.Exec(`INSERT INTO finance_transactions (organization_id, type, account_id, amount, currency, transaction_date, payment_method, created_by, source_type, source_uuid)
		SELECT $1, 'income', id, 100, 'TRY', $2::date, 'cash', $3, 'service_job', gen_random_uuid() FROM finance_accounts WHERE organization_id = $1 LIMIT 1`, f.org.ID, day, f.user.ID)
	f.fx.Exec(`INSERT INTO finance_transactions (organization_id, type, account_id, amount, currency, transaction_date, payment_method, created_by, source_type, source_uuid)
		SELECT $1, 'income', id, 40.5, 'TRY', $2::date, 'card', $3, 'product_sale', gen_random_uuid() FROM finance_accounts WHERE organization_id = $1 LIMIT 1`, f.org.ID, day, f.user.ID)
	f.fx.Exec(`INSERT INTO finance_transactions (organization_id, type, account_id, counter_account_id, amount, currency, transaction_date, payment_method, created_by)
		SELECT $1, 'transfer', id, id, 500, 'TRY', $2::date, 'transfer', $3 FROM finance_accounts WHERE organization_id = $1 LIMIT 1`, f.org.ID, day, f.user.ID)

	// Alerts and agenda.
	f.fx.Exec(`INSERT INTO products (organization_id, name, stock_quantity, min_stock_alert) VALUES ($1, 'Cila', 1, 5), ($1, 'Şampuan', 50, 5), ($1, 'Takipsiz', 0, 0)`, f.org.ID)
	f.fx.Exec(`INSERT INTO calendar_events (organization_id, title, starts_at, ends_at, all_day) VALUES
		($1, 'Sabah toplantısı', $2, $3, false),
		($1, 'Seramik randevusu', $4, $5, false),
		($1, 'Bayram', $6, $7, true)`, f.org.ID,
		noon.Add(-3*time.Hour), noon.Add(-2*time.Hour), // already over
		noon.Add(3*time.Hour), noon.Add(4*time.Hour),
		bizclock.StartOfDay(noon), bizclock.NextDay(noon))
	f.fx.Exec(`INSERT INTO todos (organization_id, title, due_date, due_time) VALUES
		($1, 'Tedarikçiyi ara', $2::date, '13:30'), ($1, 'Geçmiş iş', $2::date, '09:00'), ($1, 'Kasa sayımı', $2::date, NULL)`, f.org.ID, day)

	full, err := f.svc.BuildSnapshot(ctx, f.org.ID, WidgetAccess{Jobs: true, Finance: true, Catalog: true, Reviews: true, Loyalty: true, Calendar: true, Todos: true})
	if err != nil {
		t.Fatal(err)
	}
	if full.Counts.InProgress != 1 || full.Counts.Delivered != 1 || len(full.Queue) != 1 {
		t.Fatalf("counts %+v queue %d", full.Counts, len(full.Queue))
	}
	if full.Money == nil || full.Money.Collected != "140.50" || full.PaidTotal != "140.50" || full.Money.Cash != "100.00" || full.Money.Card != "40.50" {
		t.Fatalf("money %+v paid %s", full.Money, full.PaidTotal)
	}
	if len(full.Money.Week) != 7 || full.Money.Week[6] != "140.50" || full.Money.Week[0] != "0.00" || len(full.Money.Accounts) == 0 {
		t.Fatalf("week %v accounts %v", full.Money.Week, full.Money.Accounts)
	}
	if full.Money.Jobs != "0.00" {
		t.Fatalf("jobs revenue %s (no paid job)", full.Money.Jobs)
	}
	a := full.Alerts
	if a == nil || a.Stock == nil || *a.Stock != 1 || a.Unpaid == nil || *a.Unpaid != 1 || a.Reviews == nil || *a.Reviews != 0 || a.Renewals == nil || *a.Renewals != 0 {
		t.Fatalf("alerts %+v", a)
	}
	if full.Agenda == nil || len(full.Agenda.Items) != 3 {
		t.Fatalf("agenda %+v", full.Agenda)
	}
	titles := []string{}
	for _, it := range full.Agenda.Items {
		titles = append(titles, it.Kind+":"+it.Title)
	}
	// Timed first by time (13:30 to-do, 15:00 event), then all-day / untimed.
	if got := strings.Join(titles, "|"); got != "todo:Tedarikçiyi ara|event:Seramik randevusu|event:Bayram" {
		t.Fatalf("agenda order %s", got)
	}
	if full.Agenda.Items[2].At != "" {
		t.Fatal("all-day event has no time")
	}

	// Jobs only: no money, only the unpaid alert, no agenda.
	staff, err := f.svc.BuildSnapshot(ctx, f.org.ID, WidgetAccess{Jobs: true})
	if err != nil {
		t.Fatal(err)
	}
	if staff.Money != nil || staff.PaidTotal != "" || staff.Agenda != nil {
		t.Fatalf("staff must not see money / agenda: %+v", staff)
	}
	if staff.Alerts == nil || staff.Alerts.Stock != nil || staff.Alerts.Reviews != nil || staff.Alerts.Renewals != nil || staff.Alerts.Unpaid == nil {
		t.Fatalf("staff alerts %+v", staff.Alerts)
	}
	raw, _ := json.Marshal(staff)
	for _, leak := range []string{"money", "140.50", "paid_total", "agenda", "stock"} {
		if strings.Contains(string(raw), `"`+leak) || strings.Contains(string(raw), leak+`"`) {
			t.Fatalf("staff snapshot leaks %q: %s", leak, raw)
		}
	}

	// Push: per recipient. f.user (organization_user: finance read) gets
	// money; a jobs-only member does not; a member without jobs read gets
	// no push at all.
	jobsOnly := f.fx.User()
	f.fx.Exec(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'staff')`, f.org.ID, jobsOnly.ID)
	f.fx.Exec(`INSERT INTO roles (name, slug, description) VALUES ('Widget staff', 'widget_staff', '')`)
	f.fx.Exec(`INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.slug = 'widget_staff' AND p.slug = 'tenant.jobs.read'`)
	f.fx.Exec(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE slug = 'widget_staff'`, jobsOnly.ID)
	nobody := f.fx.User()
	f.fx.Exec(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'staff')`, f.org.ID, nobody.ID)
	tokens := map[int64]string{}
	for _, u := range []int64{f.user.ID, jobsOnly.ID, nobody.ID} {
		tok := f.devToken
		if u != f.user.ID {
			tok = "ExponentPushToken[" + uuid.NewString()[:12] + "]"
			f.fx.Exec(`INSERT INTO push_devices (user_id, token, platform) VALUES ($1, $2, 'ios')`, u, tok)
		}
		tokens[u] = tok
		if _, err := f.svc.RegisterDevice(f.ctx, u, DeviceInput{DeviceToken: tok}); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.svc.ProcessWidgets(ctx, queue.LiveWidgetsPayload{OrganizationID: f.org.ID}); err != nil {
		t.Fatal(err)
	}
	byToken := map[string]WidgetSnapshot{}
	for _, m := range f.expo.messages() {
		byToken[m.To] = m.Data["snapshot"].(WidgetSnapshot)
		raw, _ := json.Marshal(m)
		if len(raw) > 4000 {
			t.Fatalf("push too big: %d", len(raw))
		}
	}
	if len(byToken) != 2 {
		t.Fatalf("recipients %d", len(byToken))
	}
	if s := byToken[tokens[f.user.ID]]; s.Money == nil || s.Money.Collected != "140.50" {
		t.Fatalf("finance member snapshot %+v", s.Money)
	}
	if s, ok := byToken[tokens[jobsOnly.ID]]; !ok || s.Money != nil || s.PaidTotal != "" {
		t.Fatalf("jobs-only member snapshot %+v", s)
	}
	if _, ok := byToken[tokens[nobody.ID]]; ok {
		t.Fatal("member without jobs read must not get a widget push")
	}
}

// A busy day still fits in a push: the queue is trimmed and More counts the rest.
func TestWidgetSnapshotFitsPushBudget_DB(t *testing.T) {
	f := setupLive(t)
	noon := widgetNoon()
	f.svc.SetClock(func() time.Time { return noon })
	ctx := context.Background()
	long := strings.Repeat("Ğ", 60)
	for i := 0; i < 25; i++ {
		c := f.fx.Customer(f.org, fmt.Sprintf("%s %d", long, i))
		j := f.fx.Job(f.org, c, f.fx.Vehicle(f.org, c), f.user)
		f.fx.Exec(`UPDATE service_jobs SET started_at = $2, customer_name = $3, vehicle_label = $3 WHERE id = $1`, j.ID, noon.Add(-time.Duration(i+1)*time.Minute), long)
	}
	f.fx.Exec(`UPDATE service_jobs SET started_at = $2 WHERE id = $1`, f.job.ID, noon.Add(-time.Hour))
	for i := 0; i < 5; i++ {
		f.fx.Exec(`INSERT INTO calendar_events (organization_id, title, starts_at, ends_at) VALUES ($1, $2, $3, $4)`,
			f.org.ID, strings.Repeat("Ş", 80), noon.Add(time.Duration(i+1)*time.Hour), noon.Add(time.Duration(i+2)*time.Hour))
	}
	snap, err := f.svc.BuildSnapshot(ctx, f.org.ID, WidgetAccess{Jobs: true, Finance: true, Catalog: true, Reviews: true, Loyalty: true, Calendar: true, Todos: true})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(widgetData(f.org.UUID.String(), snap))
	if len(raw) > widgetDataBudget {
		t.Fatalf("data %d bytes > %d", len(raw), widgetDataBudget)
	}
	if snap.Counts.InProgress != 26 || len(snap.Queue)+snap.More != 26 || len(snap.Queue) == 0 || len(snap.Queue) >= widgetQueueMax {
		t.Fatalf("queue %d more %d counts %+v", len(snap.Queue), snap.More, snap.Counts)
	}
	if snap.Agenda == nil || len(snap.Agenda.Items) != widgetAgendaMax || len([]rune(snap.Agenda.Items[0].Title)) != 40 {
		t.Fatalf("agenda %+v", snap.Agenda)
	}
	t.Logf("busy-day push data: %d bytes, %d queue items, %d more", len(raw), len(snap.Queue), snap.More)
}
