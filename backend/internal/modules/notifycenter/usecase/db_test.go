package usecase_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	notifmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fakeInbox struct {
	mu   sync.Mutex
	sent []notifmodel.EnqueueInput
	err  error
}

func (f *fakeInbox) Enqueue(_ context.Context, in notifmodel.EnqueueInput) ([]notifmodel.Notification, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	f.sent = append(f.sent, in)
	return nil, nil
}

func (f *fakeInbox) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sent)
}

// fakeMessenger resolves templates through the real messaging service (DB
// defaults + overrides) and records queued sends.
type fakeMessenger struct {
	real  *messagingusecase.Service
	mu    sync.Mutex
	sends []usecase.OutboundMessage
	fail  error
	rules []string
}

func (f *fakeMessenger) ResolveTemplate(ctx context.Context, orgID int64, kind, ch, locale string) (usecase.Template, bool, error) {
	t, ok, err := f.real.ResolveTemplate(ctx, orgID, kind, ch, locale)
	return usecase.Template{Subject: t.Subject, Body: t.Body, Active: t.Active}, ok, err
}

func (f *fakeMessenger) RuleChannels(context.Context, int64, string) ([]string, error) {
	return f.rules, nil
}

func (f *fakeMessenger) QueueSend(_ context.Context, m usecase.OutboundMessage) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail != nil {
		return f.fail
	}
	f.sends = append(f.sends, m)
	return nil
}

type fixture struct {
	pool             *pgxpool.Pool
	q                *db.Queries
	orgID, otherOrg  int64
	userID, outsider int64
	customerID       int64
	ctx              context.Context
}

func setup(t *testing.T) fixture {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	bg := context.Background()
	pool, err := pgxpool.New(bg, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(bg); err != nil {
		t.Skipf("database unavailable: %v", err)
	}
	f := fixture{pool: pool, q: db.New(pool)}
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	scan := func(sql string, dest any, args ...any) {
		t.Helper()
		if err := pool.QueryRow(bg, sql, args...).Scan(dest); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	scan(`INSERT INTO organizations (slug, name) VALUES ($1, 'Tech Oto') RETURNING id`, &f.orgID, "nc-a-"+suffix)
	scan(`INSERT INTO organizations (slug, name) VALUES ($1, 'Other') RETURNING id`, &f.otherOrg, "nc-b-"+suffix)
	scan(`INSERT INTO users (email, password_hash, name, surname, status, locale) VALUES ($1,'x','Ayşe','Demir','active','tr') RETURNING id`, &f.userID, "nc-u-"+suffix+"@example.test")
	scan(`INSERT INTO users (email, password_hash, name, surname, status) VALUES ($1,'x','Veli','Dış','active') RETURNING id`, &f.outsider, "nc-o-"+suffix+"@example.test")
	scan(`INSERT INTO customers (organization_id, name, phone) VALUES ($1, 'Ahmet Yılmaz', '05321112233') RETURNING id`, &f.customerID, f.orgID)
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM organizations WHERE id = ANY($1)`, []int64{f.orgID, f.otherOrg})
		_, _ = pool.Exec(c, `DELETE FROM users WHERE id = ANY($1)`, []int64{f.userID, f.outsider})
	})
	for _, m := range [][2]int64{{f.orgID, f.userID}, {f.otherOrg, f.outsider}} {
		if _, err := pool.Exec(bg, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'staff')`, m[0], m[1]); err != nil {
			t.Fatal(err)
		}
	}
	f.ctx = orgctx.WithScope(bg, orgctx.Scope{InternalID: f.orgID, Slug: "nc-a-" + suffix})
	return f
}

func (f fixture) service(inbox *fakeInbox, msg *fakeMessenger) *usecase.Service {
	msg.real = messagingusecase.New(f.q, nil, nil)
	return usecase.New(f.q, inbox, msg, nil)
}

func (f fixture) status(t *testing.T, id uuid.UUID) (status string, attempts int32, delivered []string) {
	t.Helper()
	if err := f.pool.QueryRow(context.Background(),
		`SELECT status, attempts, delivered_channels FROM scheduled_notifications WHERE uuid = $1`, id,
	).Scan(&status, &attempts, &delivered); err != nil {
		t.Fatal(err)
	}
	return
}

func todoReminder(f fixture, fireAt time.Time) model.ScheduledNotification {
	return model.ScheduledNotification{
		Notification: model.Notification{
			Kind: "todo.reminder", SubjectType: "todo", SubjectID: 424242,
			Recipient: model.Recipient{UserID: f.userID},
			Vars: map[string]string{
				"todo_title": "Seramik kontrolü",
				"due_at_iso": fireAt.Add(15 * time.Minute).Format(time.RFC3339),
			},
			ActionURL: "/t/x/todos",
		},
		FireAt: fireAt,
	}
}

func TestScheduleDedupeClaimAndPreferences_DB(t *testing.T) {
	f := setup(t)
	inbox, msg := &fakeInbox{}, &fakeMessenger{}
	svc := f.service(inbox, msg)
	now := time.Now().UTC()
	svc.SetClock(func() time.Time { return now })

	due := now.Truncate(time.Minute).Add(-time.Minute)
	first, err := svc.Schedule(f.ctx, todoReminder(f, due))
	if err != nil || first.Duplicate {
		t.Fatalf("schedule: %+v %v", first, err)
	}
	dup, err := svc.Schedule(f.ctx, todoReminder(f, due.Add(20*time.Second)))
	if err != nil || !dup.Duplicate || dup.UUID != first.UUID {
		t.Fatalf("same slot must dedupe: %+v %v", dup, err)
	}
	future, err := svc.Schedule(f.ctx, todoReminder(f, now.Add(time.Hour)))
	if err != nil || future.Duplicate {
		t.Fatalf("future: %+v %v", future, err)
	}

	// Concurrent sweepers: each due row is delivered exactly once.
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := svc.ProcessDue(context.Background()); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if n := inbox.count(); n != 1 {
		t.Fatalf("in-app deliveries = %d, want 1", n)
	}
	got := inbox.sent[0]
	if got.Channels[0] != "inapp" || !strings.Contains(got.Title, "Seramik kontrolü") || !strings.Contains(got.Body, "dakika sonra") {
		t.Fatalf("rendered inapp = %+v", got)
	}
	if len(msg.sends) != 0 {
		t.Fatalf("no phone → no whatsapp, got %d", len(msg.sends))
	}
	if st, _, delivered := f.status(t, first.UUID); st != "sent" || len(delivered) != 1 {
		t.Fatalf("status %s delivered %v", st, delivered)
	}
	if st, _, _ := f.status(t, future.UUID); st != "pending" {
		t.Fatalf("future row status %s", st)
	}
	// A sent slot is never re-armed by scheduling it again.
	again, _ := svc.Schedule(f.ctx, todoReminder(f, due))
	if !again.Duplicate || again.Status != "sent" {
		t.Fatalf("re-schedule of sent slot: %+v", again)
	}

	// Preferences: phone + WhatsApp on, in-app off, English user.
	uctx := withUser(f.ctx, f.userID)
	phone := "0532 000 00 00"
	in := model.PreferencesInput{Phone: &phone}
	in.Types = append(in.Types, struct {
		Type  string             `json:"type"`
		Prefs model.ChannelPrefs `json:"prefs"`
	}{Type: "todo.reminder", Prefs: model.ChannelPrefs{WhatsApp: true}})
	prefs, err := svc.UpdatePreferences(uctx, in)
	var todoPref model.TypePreference
	for _, tp := range prefs.Types {
		if tp.Type == "todo.reminder" {
			todoPref = tp
		}
	}
	if err != nil || prefs.Phone != phone || !todoPref.Custom || todoPref.Prefs.Inapp {
		t.Fatalf("prefs: %+v %v", prefs, err)
	}
	if _, err := f.pool.Exec(context.Background(), `UPDATE users SET locale='en' WHERE id=$1`, f.userID); err != nil {
		t.Fatal(err)
	}
	res, err := svc.Dispatch(f.ctx, todoReminder(f, now).Notification)
	if err != nil || res.Status != "sent" || len(res.Delivered) != 1 || res.Delivered[0] != "whatsapp" {
		t.Fatalf("dispatch by prefs: %+v %v", res, err)
	}
	if inbox.count() != 1 || len(msg.sends) != 1 || msg.sends[0].Phone != phone || !strings.Contains(msg.sends[0].Body, "Seramik") {
		t.Fatalf("whatsapp send = %+v", msg.sends)
	}
	if !strings.Contains(msg.sends[0].Body, "Due") {
		t.Fatalf("english template expected: %q", msg.sends[0].Body)
	}
}

func TestRetryThenFail_DB(t *testing.T) {
	f := setup(t)
	inbox, msg := &fakeInbox{}, &fakeMessenger{fail: errors.New("whatsapp down"), rules: []string{"whatsapp"}}
	svc := f.service(inbox, msg)
	now := time.Now().UTC()
	svc.SetClock(func() time.Time { return now })

	n := model.Notification{
		Kind: "quote.reminder", SubjectType: "quote", SubjectID: 99,
		Recipient:   model.Recipient{CustomerID: f.customerID},
		Vars:        map[string]string{"quote_number": "TKL-1", "quote_link": "https://x"},
		MaxAttempts: 2,
		Attachment:  &model.Attachment{ObjectKey: "quotes/1.pdf", FileName: "teklif.pdf", MimeType: "application/pdf"},
	}
	res, err := svc.Dispatch(f.ctx, n)
	if err != nil {
		t.Fatal(err)
	}
	if st, attempts, _ := f.status(t, res.UUID); st != "pending" || attempts != 1 {
		t.Fatalf("after first failure: %s/%d", st, attempts)
	}
	// Not due yet (backoff).
	_ = svc.ProcessDue(context.Background())
	if _, attempts, _ := f.status(t, res.UUID); attempts != 1 {
		t.Fatal("retry must wait for backoff")
	}
	now = now.Add(2 * time.Minute)
	_ = svc.ProcessDue(context.Background())
	if st, attempts, _ := f.status(t, res.UUID); st != "failed" || attempts != 2 {
		t.Fatalf("after max attempts: %s/%d", st, attempts)
	}

	// Recovery path: a new notification succeeds with the attachment and the
	// customer's phone; customers never receive in-app.
	msg.fail = nil
	n.SubjectID = 100
	res, err = svc.Dispatch(f.ctx, n)
	if err != nil || res.Status != "sent" {
		t.Fatalf("dispatch: %+v %v", res, err)
	}
	s := msg.sends[len(msg.sends)-1]
	if s.Phone != "05321112233" || s.AttachmentKey != "quotes/1.pdf" || !strings.Contains(s.Body, "Ahmet Yılmaz") || !strings.Contains(s.Body, "Tech Oto") {
		t.Fatalf("quote send = %+v", s)
	}
	if inbox.count() != 0 {
		t.Fatal("customer must not get in-app")
	}
}

func TestCancelReviveAndIsolation_DB(t *testing.T) {
	f := setup(t)
	svc := f.service(&fakeInbox{}, &fakeMessenger{})
	now := time.Now().UTC()
	at := now.Add(time.Hour)
	r1, err := svc.Schedule(f.ctx, todoReminder(f, at))
	if err != nil {
		t.Fatal(err)
	}
	n, err := svc.CancelBySubject(f.ctx, "todo", 424242)
	if err != nil || n != 1 {
		t.Fatalf("cancel = %d %v", n, err)
	}
	if st, _, _ := f.status(t, r1.UUID); st != "cancelled" {
		t.Fatalf("status %s", st)
	}
	r2, err := svc.Schedule(f.ctx, todoReminder(f, at))
	if err != nil || r2.Duplicate || r2.UUID != r1.UUID || r2.Status != "pending" {
		t.Fatalf("revive: %+v %v", r2, err)
	}
	// Other org cannot cancel it.
	other := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: f.otherOrg})
	if n, _ := svc.CancelBySubject(other, "todo", 424242); n != 0 {
		t.Fatal("cross-tenant cancel")
	}
	// Recipient must be a member of the org.
	bad := todoReminder(f, at)
	bad.Recipient.UserID = f.outsider
	if _, err := svc.Schedule(f.ctx, bad); !errors.Is(err, usecase.ErrInvalidRequest) {
		t.Fatalf("outsider recipient err = %v", err)
	}
	// Guard cancels ineligible subjects at send time.
	svc.RegisterGuard("todo", func(context.Context, int64, int64) (bool, error) { return false, nil })
	svc.SetClock(func() time.Time { return at.Add(time.Minute) })
	_ = svc.ProcessDue(context.Background())
	if st, _, _ := f.status(t, r1.UUID); st != "cancelled" {
		t.Fatalf("guarded status %s", st)
	}
}
