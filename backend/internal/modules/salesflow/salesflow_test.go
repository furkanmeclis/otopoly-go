package salesflow_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	centermodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/model"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/salesflow"
	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ---- fakes ----

type fakeCenter struct {
	dispatched []centermodel.Notification
	scheduled  []centermodel.ScheduledNotification
	cancelled  []string
	result     centermodel.Result
	err        error
}

func (f *fakeCenter) Dispatch(ctx context.Context, n centermodel.Notification) (centermodel.Result, error) {
	if sc, ok := orgctx.ScopeFrom(ctx); !ok || sc.InternalID != n.OrgID {
		return centermodel.Result{}, errors.New("org scope missing")
	}
	f.dispatched = append(f.dispatched, n)
	return f.result, f.err
}

func (f *fakeCenter) Schedule(_ context.Context, sn centermodel.ScheduledNotification) (centermodel.Result, error) {
	f.scheduled = append(f.scheduled, sn)
	return centermodel.Result{UUID: uuid.New(), Status: "pending"}, f.err
}

func (f *fakeCenter) CancelBySubject(ctx context.Context, subjectType string, id int64) (int64, error) {
	if _, ok := orgctx.ScopeFrom(ctx); !ok {
		return 0, errors.New("org scope missing")
	}
	f.cancelled = append(f.cancelled, subjectType)
	return 1, nil
}

type fakeChannels struct {
	connected bool
	rules     []string
}

func (f fakeChannels) WhatsAppConnected(context.Context, int64) (bool, error) {
	return f.connected, nil
}
func (f fakeChannels) RuleChannels(context.Context, int64, string) ([]string, error) {
	return f.rules, nil
}
func (f fakeChannels) ResolveTemplate(_ context.Context, _ int64, kind, ch, locale string) (centerusecase.Template, bool, error) {
	return centerusecase.Template{Body: "{{customer_name}} {{quote_number}} {{total_amount}} {{valid_until}} {{quote_link}}", Active: true}, true, nil
}

type fakeQuotes struct {
	msg       quotesusecase.QuoteMessage
	msgErr    error
	completed map[uuid.UUID]error
	failed    []string
}

var reminderUUID = uuid.MustParse("11111111-1111-1111-1111-111111111111")

func (f *fakeQuotes) ReminderUUID(_ context.Context, orgID, id int64) (uuid.UUID, error) {
	if orgID != 7 {
		return uuid.Nil, quotesusecase.ErrNotFound
	}
	return reminderUUID, nil
}

func (f *fakeQuotes) ReminderMessage(context.Context, uuid.UUID) (quotesusecase.QuoteMessage, quotesusecase.QuoteReminder, error) {
	return f.msg, quotesusecase.QuoteReminder{}, f.msgErr
}

func (f *fakeQuotes) CompleteReminder(_ context.Context, id uuid.UUID, err error) error {
	if f.completed == nil {
		f.completed = map[uuid.UUID]error{}
	}
	f.completed[id] = err
	return nil
}

func (f *fakeQuotes) AsyncSendFailed(_ context.Context, _ int64, ref, reason string) error {
	f.failed = append(f.failed, ref+"|"+reason)
	return nil
}

type fakeStore struct {
	people db.GetQuoteNotifyPeopleRow
	quote  db.Quote
}

func (f fakeStore) GetQuoteRowByUUID(_ context.Context, a db.GetQuoteRowByUUIDParams) (db.Quote, error) {
	if a.OrganizationID != f.quote.OrganizationID {
		return db.Quote{}, pgx.ErrNoRows
	}
	return f.quote, nil
}
func (f fakeStore) GetQuoteRowByID(context.Context, int64) (db.Quote, error) { return f.quote, nil }
func (f fakeStore) GetQuoteNotifyPeople(context.Context, db.GetQuoteNotifyPeopleParams) (db.GetQuoteNotifyPeopleRow, error) {
	return f.people, nil
}
func (f fakeStore) ResolveTodoLeadLink(_ context.Context, a db.ResolveTodoLeadLinkParams) (int64, error) {
	if a.OrganizationID != 7 {
		return 0, pgx.ErrNoRows
	}
	return 5, nil
}
func (f fakeStore) ResolveTodoQuoteLink(_ context.Context, a db.ResolveTodoQuoteLinkParams) (int64, error) {
	if a.OrganizationID != 7 {
		return 0, pgx.ErrNoRows
	}
	return 6, nil
}
func (f fakeStore) DescribeTodoLeadLinks(_ context.Context, a db.DescribeTodoLeadLinksParams) ([]db.DescribeTodoLeadLinksRow, error) {
	return []db.DescribeTodoLeadLinksRow{{ID: 5, Uuid: uuid.New(), Label: "Ahmet — seramik"}}, nil
}
func (f fakeStore) DescribeTodoQuoteLinks(context.Context, db.DescribeTodoQuoteLinksParams) ([]db.DescribeTodoQuoteLinksRow, error) {
	return []db.DescribeTodoQuoteLinksRow{{ID: 6, Uuid: uuid.New(), Label: "TKL-2026-0001 · Ahmet"}}, nil
}

func sampleMessage() quotesusecase.QuoteMessage {
	v := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)
	return quotesusecase.QuoteMessage{
		OrganizationID: 7, OrganizationName: "Tech Oto", QuoteID: 42, QuoteUUID: uuid.New(), QuoteNumber: "TKL-2026-0001",
		Status: "sent", CustomerID: 9, CustomerName: "Ahmet Yılmaz", CustomerPhone: "05321112233",
		CustomerEmail: "ahmet@example.test", VehiclePlate: "34ABC123", GrandTotal: "12500.00", Currency: "TRY",
		ValidUntil: &v, ShareURL: "https://app.test/q/tok", PDFObjectKey: "quotes/o/q/abc.pdf",
		PDFFileName: "TKL-2026-0001.pdf", Locale: "tr", DeliveryUUID: uuid.New(), Attempt: 1,
	}
}

// ---- tests ----

func TestFormatMoney(t *testing.T) {
	cases := map[[3]string]string{
		{"12500.00", "TRY", "tr"}: "12.500,00 TRY",
		{"12500.00", "TRY", "en"}: "TRY 12,500.00",
		{"999.5", "EUR", "tr"}:    "999,50 EUR",
		{"1234567.89", "", "tr"}:  "1.234.567,89",
		{"0", "TRY", "tr"}:        "0,00 TRY",
	}
	for in, want := range cases {
		if got := salesflow.FormatMoney(in[0], in[1], in[2]); got != want {
			t.Errorf("FormatMoney(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestSendQuoteBuildsNotification(t *testing.T) {
	notifUUID := uuid.New()
	center := &fakeCenter{result: centermodel.Result{UUID: notifUUID, Status: "sent", Delivered: []string{"whatsapp", "email"}}}
	x := salesflow.New(center, fakeChannels{connected: true, rules: []string{"whatsapp", "email"}}, fakeStore{}, nil)
	m := sampleMessage()

	res, err := x.SendQuote(context.Background(), m)
	if err != nil {
		t.Fatal(err)
	}
	if res.Channel != "whatsapp" || res.ProviderRef != notifUUID.String() {
		t.Fatalf("result = %+v", res)
	}
	if len(center.dispatched) != 1 {
		t.Fatalf("dispatched %d", len(center.dispatched))
	}
	n := center.dispatched[0]
	if n.Kind != "quote.sent" || n.SubjectType != "quote" || n.SubjectID != 42 || n.OrgID != 7 {
		t.Fatalf("notification = %+v", n)
	}
	if n.Recipient.CustomerID != 9 || n.MaxAttempts != 1 || n.Locale != "tr" {
		t.Fatalf("recipient / attempts = %+v", n)
	}
	if strings.Join(n.Channels, ",") != "whatsapp,email" {
		t.Fatalf("channels = %v", n.Channels)
	}
	want := map[string]string{
		"quote_number": "TKL-2026-0001", "total_amount": "12.500,00 TRY", "valid_until_iso": "2026-10-30",
		"quote_link": "https://app.test/q/tok", "plate": "34ABC123", "customer_name": "Ahmet Yılmaz",
	}
	for k, v := range want {
		if n.Vars[k] != v {
			t.Errorf("var %s = %q, want %q", k, n.Vars[k], v)
		}
	}
	if n.Attachment == nil || n.Attachment.ObjectKey != m.PDFObjectKey || n.Attachment.MimeType != "application/pdf" {
		t.Fatalf("attachment = %+v", n.Attachment)
	}
	if !strings.Contains(n.DedupeKey, m.DeliveryUUID.String()) || !strings.HasSuffix(n.DedupeKey, ":1") {
		t.Fatalf("dedupe key = %q", n.DedupeKey)
	}
	// A retry of the same delivery is a new attempt → new dedupe key.
	m.Attempt = 2
	_, _ = x.SendQuote(context.Background(), m)
	if center.dispatched[1].DedupeKey == n.DedupeKey {
		t.Fatal("retry must not reuse the dedupe key")
	}

	// No e-mail rule / address → WhatsApp only; bytes are attached when no key.
	x = salesflow.New(center, fakeChannels{connected: true}, fakeStore{}, nil)
	m.PDFObjectKey, m.PDF = "", []byte("%PDF")
	_, _ = x.SendQuote(context.Background(), m)
	last := center.dispatched[len(center.dispatched)-1]
	if strings.Join(last.Channels, ",") != "whatsapp" || last.Attachment == nil || string(last.Attachment.Data) != "%PDF" {
		t.Fatalf("whatsapp-only notification = %+v", last)
	}
}

func TestSendQuoteErrors(t *testing.T) {
	center := &fakeCenter{}
	x := salesflow.New(center, fakeChannels{connected: false}, fakeStore{}, nil)
	if _, err := x.SendQuote(context.Background(), sampleMessage()); !errors.Is(err, salesflow.ErrWhatsAppNotConnected) {
		t.Fatalf("not connected err = %v", err)
	}
	m := sampleMessage()
	m.CustomerPhone = ""
	if _, err := x.SendQuote(context.Background(), m); !errors.Is(err, salesflow.ErrCustomerNoPhone) {
		t.Fatalf("no phone err = %v", err)
	}
	if len(center.dispatched) != 0 {
		t.Fatal("nothing must be dispatched")
	}
	center.result = centermodel.Result{Status: "cancelled", LastError: "no active template for selected channels"}
	x = salesflow.New(center, fakeChannels{connected: true}, fakeStore{}, nil)
	if _, err := x.SendQuote(context.Background(), sampleMessage()); err == nil || !strings.Contains(err.Error(), "no active template") {
		t.Fatalf("undelivered err = %v", err)
	}
}

func TestPreviewQuote(t *testing.T) {
	x := salesflow.New(&fakeCenter{}, fakeChannels{connected: true}, fakeStore{}, nil)
	p, err := x.PreviewQuote(context.Background(), sampleMessage())
	if err != nil {
		t.Fatal(err)
	}
	if !p.ChannelConnected || !p.TemplateActive || p.Message != "Ahmet Yılmaz TKL-2026-0001 12.500,00 TRY 30.10.2026 https://app.test/q/tok" {
		t.Fatalf("preview = %+v", p)
	}
}

func TestReminderScheduleAndKinds(t *testing.T) {
	center := &fakeCenter{}
	store := fakeStore{quote: db.Quote{ID: 42, OrganizationID: 7, CustomerID: 9, Number: "TKL-1",
		ValidUntil: pgtype.Date{Time: time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC), Valid: true}}}
	x := salesflow.New(center, fakeChannels{connected: true}, store, nil)
	fire := time.Date(2026, 10, 29, 7, 0, 0, 0, time.UTC)
	ref, err := x.Schedule(context.Background(), quotesusecase.QuoteReminder{
		ReminderID: 3, ReminderUUID: reminderUUID, OrganizationID: 7, QuoteID: 42, Kind: "before_1d", FireAt: fire,
	})
	if err != nil || ref == "" {
		t.Fatalf("schedule: %q %v", ref, err)
	}
	sn := center.scheduled[0]
	if sn.Kind != "quote.expiring" || sn.SubjectType != "quote_reminder" || sn.SubjectID != 3 ||
		sn.Recipient.CustomerID != 9 || !sn.FireAt.Equal(fire) || sn.Channels[0] != "whatsapp" ||
		!strings.Contains(sn.DedupeKey, reminderUUID.String()) {
		t.Fatalf("scheduled = %+v", sn)
	}
	if salesflow.ReminderKind("before_3d") != "quote.reminder" || salesflow.ReminderKind("last_day") != "quote.expiring" {
		t.Fatal("reminder kind mapping")
	}
	// Cancel works from a worker context without org scope.
	if err := x.Cancel(context.Background(), quotesusecase.QuoteReminder{ReminderID: 3, OrganizationID: 7}); err != nil {
		t.Fatal(err)
	}
	// Tenant isolation: a reminder of another org's quote cannot be scheduled.
	if _, err := x.Schedule(context.Background(), quotesusecase.QuoteReminder{OrganizationID: 8, QuoteUUID: uuid.New()}); err == nil {
		t.Fatal("cross-org schedule must fail")
	}
}

func TestReminderGuardSkipsClosedQuotes(t *testing.T) {
	q := &fakeQuotes{msgErr: quotesusecase.ErrReminderNotApplicable}
	x := salesflow.New(&fakeCenter{}, fakeChannels{connected: true}, fakeStore{}, nil)
	x.SetQuotes(q)
	p, err := x.PrepareReminder(context.Background(), 7, 3)
	if err != nil || !p.Skip {
		t.Fatalf("accepted quote must be skipped: %+v %v", p, err)
	}
	// Unknown reminder / other org → skipped.
	if p, err := x.PrepareReminder(context.Background(), 8, 3); err != nil || !p.Skip {
		t.Fatalf("other org: %+v %v", p, err)
	}
	// Open quote → fresh vars.
	q.msgErr, q.msg = nil, sampleMessage()
	p, err = x.PrepareReminder(context.Background(), 7, 3)
	if err != nil || p.Skip || p.Vars["total_amount"] != "12.500,00 TRY" || p.Vars["quote_link"] == "" {
		t.Fatalf("open quote: %+v %v", p, err)
	}
	// WhatsApp down → error (center retries with backoff).
	x2 := salesflow.New(&fakeCenter{}, fakeChannels{connected: false}, fakeStore{}, nil)
	x2.SetQuotes(q)
	if _, err := x2.PrepareReminder(context.Background(), 7, 3); !errors.Is(err, salesflow.ErrWhatsAppNotConnected) {
		t.Fatalf("not connected: %v", err)
	}
}

func TestReminderSentCompletesReminder(t *testing.T) {
	q := &fakeQuotes{}
	x := salesflow.New(&fakeCenter{}, fakeChannels{connected: true}, fakeStore{}, nil)
	x.SetQuotes(q)
	ev := centerusecase.SentEvent{OrgID: 7, SubjectType: "quote_reminder", SubjectID: 3}

	ev.Status = "pending"
	x.ReminderSent(context.Background(), ev)
	ev.Status, ev.Skipped = "cancelled", true
	x.ReminderSent(context.Background(), ev)
	if len(q.completed) != 0 {
		t.Fatalf("retrying / skipped must not complete: %v", q.completed)
	}
	ev.Status, ev.Skipped, ev.Delivered = "sent", false, []string{"whatsapp"}
	x.ReminderSent(context.Background(), ev)
	if err, ok := q.completed[reminderUUID]; !ok || err != nil {
		t.Fatalf("sent → CompleteReminder(nil): %v %v", ok, err)
	}
	ev.Status, ev.Delivered, ev.LastError = "failed", nil, "whatsapp: down"
	x.ReminderSent(context.Background(), ev)
	if err := q.completed[reminderUUID]; err == nil || !strings.Contains(err.Error(), "down") {
		t.Fatalf("failed → CompleteReminder(err): %v", err)
	}

	ref := uuid.New()
	x.OutboundFailed(context.Background(), 7, "todo.reminder", &ref, "x")
	x.OutboundFailed(context.Background(), 7, "quote.sent", &ref, "session lost")
	if len(q.failed) != 1 || q.failed[0] != ref.String()+"|session lost" {
		t.Fatalf("async failures = %v", q.failed)
	}
}

func TestTeamNotifications(t *testing.T) {
	center := &fakeCenter{}
	store := fakeStore{people: db.GetQuoteNotifyPeopleRow{
		CreatedBy: pgtype.Int8{Int64: 1, Valid: true}, CreatedByName: "Mehmet",
		LeadAssigneeID: pgtype.Int8{Int64: 2, Valid: true}, CustomerName: "Ahmet",
	}}
	x := salesflow.New(center, fakeChannels{}, store, nil)
	now := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	x.SetClock(func() time.Time { return now })
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 7, Slug: "tech-oto"})
	v := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)
	ev := quotesusecase.QuoteEvent{Kind: "created", OrganizationID: 7, QuoteID: 42, QuoteUUID: uuid.New(),
		Number: "TKL-1", Status: "draft", GrandTotal: "100.00", Currency: "TRY", ValidUntil: &v, CreatedBy: 1, ActorID: 1}

	x.QuoteChanged(ctx, ev)
	if len(center.dispatched) != 1 {
		t.Fatalf("assignee must be told: %+v", center.dispatched)
	}
	n := center.dispatched[0]
	if n.Kind != "quote.team_created" || n.Recipient.UserID != 2 || n.Vars["created_by_name"] != "Mehmet" ||
		n.ActionURL != "/t/tech-oto/quotes/"+ev.QuoteUUID.String() {
		t.Fatalf("team created = %+v", n)
	}
	ev.ActorID = 2 // the assignee created it themselves → no notification
	x.QuoteChanged(ctx, ev)
	if len(center.dispatched) != 1 {
		t.Fatal("self-created quote must not notify")
	}

	// Sent → expiring notice for creator + assignee, the day before at 10:00 TRT.
	ev.Kind, ev.Status = "sent", "sent"
	x.QuoteChanged(ctx, ev)
	if len(center.scheduled) != 2 || len(center.cancelled) != 1 {
		t.Fatalf("scheduled %d cancelled %d", len(center.scheduled), len(center.cancelled))
	}
	s := center.scheduled[0]
	if s.Kind != "quote.team_expiring" || s.SubjectType != "quote_expiry" || s.FireAt.UTC().Format(time.RFC3339) != "2026-10-29T07:00:00Z" {
		t.Fatalf("expiring = %+v at %s", s, s.FireAt.UTC())
	}
	// Accepted → only cancelled.
	ev.Kind, ev.Status = "status", "accepted"
	x.QuoteChanged(ctx, ev)
	if len(center.scheduled) != 2 || len(center.cancelled) != 2 {
		t.Fatal("closed quote must not reschedule")
	}
}

func TestExpiryGuard(t *testing.T) {
	store := fakeStore{quote: db.Quote{ID: 42, OrganizationID: 7, Status: "sent",
		ValidUntil: pgtype.Date{Time: time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC), Valid: true}}}
	x := salesflow.New(&fakeCenter{}, fakeChannels{}, store, nil)
	x.SetClock(func() time.Time { return time.Date(2026, 10, 29, 7, 0, 0, 0, time.UTC) })
	if ok, _ := x.ExpiryGuard(context.Background(), 7, 42); !ok {
		t.Fatal("sent quote must pass")
	}
	if ok, _ := x.ExpiryGuard(context.Background(), 8, 42); ok {
		t.Fatal("other org must not pass")
	}
	store.quote.Status = "accepted"
	x = salesflow.New(&fakeCenter{}, fakeChannels{}, store, nil)
	if ok, _ := x.ExpiryGuard(context.Background(), 7, 42); ok {
		t.Fatal("accepted quote must be skipped")
	}
}

func TestLinksIsolationAndPermissions(t *testing.T) {
	l := salesflow.NewLinks(fakeStore{})
	ctx := context.Background()
	if id, err := l.ResolveLead(ctx, 7, uuid.New()); err != nil || id != 5 {
		t.Fatalf("own lead: %d %v", id, err)
	}
	if _, err := l.ResolveLead(ctx, 8, uuid.New()); !errors.Is(err, todosusecase.ErrLinkNotFound) {
		t.Fatalf("other org lead: %v", err)
	}
	if _, err := l.ResolveQuote(ctx, 8, uuid.New()); !errors.Is(err, todosusecase.ErrLinkNotFound) {
		t.Fatalf("other org quote: %v", err)
	}
	// Signed-in user without leads.read can neither link nor see labels.
	noPerm := authctx.WithPrincipal(ctx, authctx.Principal{UserInternal: 1})
	if _, err := l.ResolveLead(noPerm, 7, uuid.New()); !errors.Is(err, todosusecase.ErrLinkNotFound) {
		t.Fatalf("no permission: %v", err)
	}
	if m, _ := l.DescribeLeads(noPerm, 7, []int64{5}); len(m) != 0 {
		t.Fatalf("labels leaked: %v", m)
	}
	if m, _ := l.DescribeQuotes(ctx, 7, []int64{6}); m[6].Label == "" {
		t.Fatalf("describe quotes: %v", m)
	}
}
