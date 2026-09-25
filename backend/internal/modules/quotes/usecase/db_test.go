package usecase

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// --- fakes

type memStorage struct {
	storage.Driver
	mu      sync.Mutex
	objects map[string][]byte
}

func (m *memStorage) Upload(_ context.Context, f storage.File, path string) error {
	data, err := io.ReadAll(f.Body)
	m.mu.Lock()
	m.objects[path] = data
	m.mu.Unlock()
	return err
}

func (m *memStorage) Download(_ context.Context, path string) (io.ReadCloser, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.objects[path]
	if !ok {
		return nil, 0, errors.New("missing")
	}
	return io.NopCloser(bytes.NewReader(data)), int64(len(data)), nil
}

func (m *memStorage) Delete(_ context.Context, path string) error {
	m.mu.Lock()
	delete(m.objects, path)
	m.mu.Unlock()
	return nil
}

type fakePDF struct{ calls int }

func (f *fakePDF) HTMLToPDF(_ context.Context, html string) ([]byte, error) {
	f.calls++
	return []byte("%PDF-1.4 " + html[:20]), nil
}

type fakeMessenger struct {
	msgs []QuoteMessage
	err  error
}

func (f *fakeMessenger) SendQuote(_ context.Context, m QuoteMessage) (QuoteSendResult, error) {
	if f.err != nil {
		return QuoteSendResult{}, f.err
	}
	f.msgs = append(f.msgs, m)
	return QuoteSendResult{Channel: "whatsapp", ProviderRef: "wa-1"}, nil
}

type fakeScheduler struct {
	scheduled, cancelled []QuoteReminder
}

func (f *fakeScheduler) Schedule(_ context.Context, r QuoteReminder) (string, error) {
	f.scheduled = append(f.scheduled, r)
	return "sched-" + r.Kind, nil
}

func (f *fakeScheduler) Cancel(_ context.Context, r QuoteReminder) error {
	f.cancelled = append(f.cancelled, r)
	return nil
}

// --- fixtures

type fixture struct {
	pool                  *pgxpool.Pool
	q                     *db.Queries
	svc                   *Service
	ctxA, ctxB            context.Context
	orgA, orgB            int64
	customerA, customerB  uuid.UUID
	serviceA, serviceB    uuid.UUID
	productA              uuid.UUID
	modelUUID             uuid.UUID
	leadA                 uuid.UUID
	storage               *memStorage
	pdf                   *fakePDF
	messenger             *fakeMessenger
	scheduler             *fakeScheduler
}

func setup(t *testing.T) *fixture {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	f := &fixture{pool: pool, q: q}
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	scan := func(sql string, dest []any, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dest...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	var orgAUUID, orgBUUID uuid.UUID
	var userA, userB int64
	scan(`INSERT INTO organizations (slug, name, phone) VALUES ($1, 'Tech Oto', '0212 000 00 00') RETURNING id, uuid`, []any{&f.orgA, &orgAUUID}, "qa-"+suffix)
	scan(`INSERT INTO organizations (slug, name) VALUES ($1, 'Other Wash') RETURNING id, uuid`, []any{&f.orgB, &orgBUUID}, "qb-"+suffix)
	t.Cleanup(func() {
		c := context.Background()
		// Jobs reference customers without cascade; remove org data explicitly.
		for _, id := range []int64{f.orgA, f.orgB} {
			_, _ = pool.Exec(c, `DELETE FROM quotes WHERE organization_id = $1`, id)
			_, _ = pool.Exec(c, `DELETE FROM leads WHERE organization_id = $1`, id)
			_, _ = pool.Exec(c, `DELETE FROM service_jobs WHERE organization_id = $1`, id)
			_, _ = pool.Exec(c, `DELETE FROM organizations WHERE id = $1`, id)
		}
	})
	scan(`INSERT INTO users (email, password_hash, name, surname) VALUES ($1, 'x', 'Kasa', 'A') RETURNING id`, []any{&userA}, "qa-"+suffix+"@example.test")
	scan(`INSERT INTO users (email, password_hash, name, surname) VALUES ($1, 'x', 'Kasa', 'B') RETURNING id`, []any{&userB}, "qb-"+suffix+"@example.test")
	for _, m := range [][2]int64{{f.orgA, userA}, {f.orgB, userB}} {
		if _, err := pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, m[0], m[1]); err != nil {
			t.Fatal(err)
		}
	}
	var brandID, modelID int64
	scan(`INSERT INTO vehicle_brands (name) VALUES ($1) RETURNING id`, []any{&brandID}, "Brand"+suffix)
	scan(`INSERT INTO vehicle_models (brand_id, name) VALUES ($1, 'Model X') RETURNING id, uuid`, []any{&modelID, &f.modelUUID}, brandID)
	if _, err := pool.Exec(ctx, `INSERT INTO vehicle_model_years (model_id, year) VALUES ($1, 2021)`, modelID); err != nil {
		t.Fatal(err)
	}
	scan(`INSERT INTO customers (organization_id, name, phone) VALUES ($1, 'Ayşe Kaya', '05321234567') RETURNING uuid`, []any{&f.customerA}, f.orgA)
	scan(`INSERT INTO customers (organization_id, name, phone) VALUES ($1, 'Başka Müşteri', '05000000000') RETURNING uuid`, []any{&f.customerB}, f.orgB)
	scan(`INSERT INTO services (organization_id, name, price, vat_rate) VALUES ($1, 'Seramik Kaplama', 150, 20) RETURNING uuid`, []any{&f.serviceA}, f.orgA)
	scan(`INSERT INTO services (organization_id, name, price, vat_rate) VALUES ($1, 'Yıkama', 100, 20) RETURNING uuid`, []any{&f.serviceB}, f.orgB)
	scan(`INSERT INTO products (organization_id, name, sale_price, vat_rate, unit) VALUES ($1, 'Oto Parfüm', 40, 20, 'adet') RETURNING uuid`, []any{&f.productA}, f.orgA)
	scan(`INSERT INTO leads (organization_id, customer_id, source, created_by)
	      SELECT $1, id, 'incoming_call', $2 FROM customers WHERE uuid = $3 RETURNING uuid`, []any{&f.leadA}, f.orgA, userA, f.customerA)

	f.storage = &memStorage{objects: map[string][]byte{}}
	f.pdf = &fakePDF{}
	f.messenger = &fakeMessenger{}
	f.scheduler = &fakeScheduler{}
	f.svc = New(pool, q, nil, f.storage, f.pdf, "https://app.test")
	f.svc.SetMessenger(f.messenger)
	f.svc.SetReminderScheduler(f.scheduler)
	f.svc.SetJobCreator(jobsusecase.New(pool, q, nil, nil, nil))
	f.svc.SetVehicleCreator(customersusecase.New(pool, q, nil))

	f.ctxA = authctx.WithPrincipal(orgctx.WithScope(ctx, orgctx.Scope{InternalID: f.orgA, UUID: orgAUUID}), authctx.Principal{UserInternal: userA})
	f.ctxB = authctx.WithPrincipal(orgctx.WithScope(ctx, orgctx.Scope{InternalID: f.orgB, UUID: orgBUUID}), authctx.Principal{UserInternal: userB})
	return f
}

func sp(s string) *string { return &s }

func (f *fixture) basicInput() SaveInput {
	lead := f.leadA
	return SaveInput{
		CustomerUUID: f.customerA,
		LeadUUID:     &lead,
		Lines: []LineInput{
			{LineType: "service", ServiceUUID: &f.serviceA, Quantity: "2", DiscountType: DiscountPercent, DiscountValue: "10"},
			{LineType: "custom", Description: "Özel işçilik", Quantity: "1", UnitPrice: sp("50"), VATRate: sp("20")},
		},
	}
}

func TestQuoteNumberConcurrency_DB(t *testing.T) {
	f := setup(t)
	const n = 20
	var wg sync.WaitGroup
	nums := make([]string, n)
	errs := make([]error, n)
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			in := f.basicInput()
			in.LeadUUID = nil
			d, err := f.svc.Create(f.ctxA, in)
			nums[i], errs[i] = d.Number, err
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("create: %v", err)
		}
	}
	sort.Strings(nums)
	year := time.Now().In(f.svc.loc).Year()
	for i, got := range nums {
		if want := FormatNumber(year, int32(i+1)); got != want {
			t.Fatalf("numbers not sequential/unique: %v", nums)
		}
	}
	// Org B has its own sequence.
	in := SaveInput{CustomerUUID: f.customerB, Lines: []LineInput{{ServiceUUID: &f.serviceB}}}
	d, err := f.svc.Create(f.ctxB, in)
	if err != nil || d.Number != FormatNumber(year, 1) {
		t.Fatalf("org B number: %q %v", d.Number, err)
	}
}

func TestQuoteCreateTotalsAndCrossOrg_DB(t *testing.T) {
	f := setup(t)
	d, err := f.svc.Create(f.ctxA, f.basicInput())
	if err != nil {
		t.Fatal(err)
	}
	// 2×150 −10% = 270 + 50 = 320 (VAT inclusive → 53.33).
	if d.Subtotal != "350.00" || d.DiscountTotal != "30.00" || d.GrandTotal != "320.00" || d.VATTotal != "53.33" {
		t.Fatalf("totals: %+v", d)
	}
	if d.Lines[0].Description != "Seramik Kaplama" || d.Lines[0].UnitPrice != "150.00" || d.Status != StatusDraft {
		t.Fatalf("service defaults: %+v", d.Lines[0])
	}
	if !strings.HasPrefix(d.ShareURL, "https://app.test/q/") || strings.Contains(d.ShareURL, d.UUID.String()) {
		t.Fatalf("share url: %s", d.ShareURL)
	}
	// The lead moved to "quoted" with a timeline entry.
	var leadStatus string
	var events int
	_ = f.pool.QueryRow(context.Background(), `SELECT status, (SELECT count(*) FROM lead_events e WHERE e.lead_id = l.id AND e.kind = 'quote_created') FROM leads l WHERE uuid = $1`, f.leadA).Scan(&leadStatus, &events)
	if leadStatus != "quoted" || events != 1 {
		t.Fatalf("lead: %s events=%d", leadStatus, events)
	}

	// Org B cannot read or touch org A's quote.
	if _, err := f.svc.Get(f.ctxB, d.UUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-org get: %v", err)
	}
	if _, err := f.svc.SetStatus(f.ctxB, d.UUID, StatusInput{Status: StatusCancelled}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-org status: %v", err)
	}
	// Org A cannot reference org B's customer / service / lead.
	bad := []SaveInput{
		{CustomerUUID: f.customerB, Lines: []LineInput{{ServiceUUID: &f.serviceA}}},
		{CustomerUUID: f.customerA, Lines: []LineInput{{ServiceUUID: &f.serviceB}}},
	}
	for i, in := range bad {
		if _, err := f.svc.Create(f.ctxA, in); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("case %d: expected invalid request, got %v", i, err)
		}
	}
	leadA := f.leadA
	if _, err := f.svc.Create(f.ctxB, SaveInput{CustomerUUID: f.customerB, LeadUUID: &leadA, Lines: []LineInput{{ServiceUUID: &f.serviceB}}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("cross-org lead: %v", err)
	}
	// Product line picks catalog price and unit.
	in := f.basicInput()
	in.Lines = []LineInput{{ProductUUID: &f.productA, Quantity: "3"}}
	p, err := f.svc.Create(f.ctxA, in)
	if err != nil || p.Lines[0].Unit != "adet" || p.GrandTotal != "120.00" {
		t.Fatalf("product line: %+v %v", p.Lines, err)
	}
}

func TestQuoteSendRemindersAndDecision_DB(t *testing.T) {
	f := setup(t)
	in := f.basicInput()
	in.ValidUntil = sp(time.Now().In(f.svc.loc).AddDate(0, 0, 10).Format("2006-01-02"))
	d, err := f.svc.Create(f.ctxA, in)
	if err != nil {
		t.Fatal(err)
	}
	res, err := f.svc.Send(f.ctxA, d.UUID, SendInput{Reminders: []ReminderInput{{Kind: ReminderBefore3d}, {Kind: ReminderLastDay}}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Quote.Status != StatusSent || res.Delivery.Status != "sent" || res.Delivery.AttemptCount != 1 {
		t.Fatalf("send: status=%s delivery=%+v", res.Quote.Status, res.Delivery)
	}
	if len(f.messenger.msgs) != 1 || len(f.messenger.msgs[0].PDF) == 0 || f.messenger.msgs[0].CustomerPhone != "05321234567" ||
		f.messenger.msgs[0].QuoteNumber != d.Number || !strings.Contains(f.messenger.msgs[0].ShareURL, "/q/") {
		t.Fatalf("messenger payload: %+v", f.messenger.msgs)
	}
	if len(f.scheduler.scheduled) != 2 || len(res.Quote.Reminders) != 2 {
		t.Fatalf("reminders: %+v", res.Quote.Reminders)
	}
	// Default messenger failure is recorded and retryable.
	f.messenger.err = errors.New("wa down")
	res2, err := f.svc.Send(f.ctxA, d.UUID, SendInput{})
	if err != nil || res2.Delivery.Status != "failed" || res2.Delivery.Error != "wa down" {
		t.Fatalf("failed delivery: %+v %v", res2.Delivery, err)
	}
	f.messenger.err = nil
	res3, err := f.svc.RetryDelivery(f.ctxA, d.UUID, res2.Delivery.UUID)
	if err != nil || res3.Delivery.Status != "sent" || res3.Delivery.AttemptCount != 2 {
		t.Fatalf("retry: %+v %v", res3.Delivery, err)
	}
	// PDF rendered once and reused while content is unchanged.
	if f.pdf.calls != 1 {
		t.Fatalf("pdf renders=%d", f.pdf.calls)
	}

	// Public link: first open marks viewed exactly once.
	token := strings.TrimPrefix(d.ShareURL, "https://app.test/q/")
	for range 2 {
		pv, err := f.svc.PublicGet(context.Background(), token, ClientInfo{IP: "1.2.3.4", UserAgent: "test"})
		if err != nil || pv.Status != StatusViewed || !pv.CanDecide {
			t.Fatalf("public get: %+v %v", pv, err)
		}
	}
	var viewedEvents, viewCount int
	_ = f.pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM quote_events e WHERE e.quote_id = q.id AND e.to_status = 'viewed'), view_count FROM quotes q WHERE uuid = $1`, d.UUID).Scan(&viewedEvents, &viewCount)
	if viewedEvents != 1 || viewCount != 2 {
		t.Fatalf("viewed events=%d views=%d", viewedEvents, viewCount)
	}
	if _, err := f.svc.PublicGet(context.Background(), strings.Repeat("A", 43), ClientInfo{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown token: %v", err)
	}

	// Customer accepts: evidence stored, reminders cancelled, lead won.
	pv, err := f.svc.PublicDecide(context.Background(), token, true, PublicDecisionInput{Note: "Tamam"}, ClientInfo{IP: "5.6.7.8", UserAgent: "UA"})
	if err != nil || pv.Status != StatusAccepted || pv.CanDecide {
		t.Fatalf("accept: %+v %v", pv, err)
	}
	full, _ := f.svc.Get(f.ctxA, d.UUID)
	for _, r := range full.Reminders {
		if r.Status != "cancelled" {
			t.Fatalf("reminder not cancelled: %+v", r)
		}
	}
	if len(f.scheduler.cancelled) != 2 || full.DecisionChannel != "public" || full.DecisionNote != "Tamam" {
		t.Fatalf("decision: cancelled=%d %+v", len(f.scheduler.cancelled), full.DecisionChannel)
	}
	var ip, leadStatus string
	_ = f.pool.QueryRow(context.Background(), `SELECT decision_ip FROM quotes WHERE uuid = $1`, d.UUID).Scan(&ip)
	_ = f.pool.QueryRow(context.Background(), `SELECT status FROM leads WHERE uuid = $1`, f.leadA).Scan(&leadStatus)
	if ip != "5.6.7.8" || leadStatus != "won" {
		t.Fatalf("ip=%s lead=%s", ip, leadStatus)
	}
	// Second decision and invalid manual transitions are refused.
	if _, err := f.svc.PublicDecide(context.Background(), token, false, PublicDecisionInput{}, ClientInfo{}); !errors.Is(err, ErrConflict) {
		t.Fatalf("second decision: %v", err)
	}
	if _, err := f.svc.SetStatus(f.ctxA, d.UUID, StatusInput{Status: StatusRejected}); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("accepted → rejected: %v", err)
	}
	if _, err := f.svc.SetStatus(f.ctxA, d.UUID, StatusInput{Status: StatusViewed}); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("manual viewed: %v", err)
	}
	if _, err := f.svc.Update(f.ctxA, d.UUID, f.basicInput()); !errors.Is(err, ErrConflict) {
		t.Fatalf("edit accepted: %v", err)
	}
}

func TestQuoteExpirySweep_DB(t *testing.T) {
	f := setup(t)
	yesterday := time.Now().In(f.svc.loc).AddDate(0, 0, -1).Format("2006-01-02")
	mk := func() Detail {
		in := f.basicInput()
		in.LeadUUID = nil
		in.ValidUntil = sp(yesterday)
		d, err := f.svc.Create(f.ctxA, in)
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	sent, accepted, draft, cancelled := mk(), mk(), mk(), mk()
	if _, err := f.svc.Send(f.ctxA, sent.UUID, SendInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SetStatus(f.ctxA, accepted.UUID, StatusInput{Status: StatusAccepted}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SetStatus(f.ctxA, cancelled.UUID, StatusInput{Status: StatusCancelled}); err != nil {
		t.Fatal(err)
	}
	// A future-dated quote in another org stays untouched.
	future := SaveInput{CustomerUUID: f.customerB, ValidUntil: sp(time.Now().AddDate(0, 0, 5).Format("2006-01-02")), Lines: []LineInput{{ServiceUUID: &f.serviceB}}}
	fq, err := f.svc.Create(f.ctxB, future)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ExpireDue(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := map[uuid.UUID]string{sent.UUID: StatusExpired, draft.UUID: StatusExpired, accepted.UUID: StatusAccepted, cancelled.UUID: StatusCancelled}
	for id, st := range want {
		d, _ := f.svc.Get(f.ctxA, id)
		if d.Status != st {
			t.Errorf("quote %s: status %s want %s", d.Number, d.Status, st)
		}
	}
	if d, _ := f.svc.Get(f.ctxB, fq.UUID); d.Status != StatusDraft {
		t.Fatalf("future quote touched: %s", d.Status)
	}
	// Idempotent: nothing left for this org.
	var left int
	_ = f.pool.QueryRow(context.Background(), `SELECT count(*) FROM quotes WHERE organization_id = $1 AND status IN ('draft','sent','viewed') AND valid_until < CURRENT_DATE`, f.orgA).Scan(&left)
	if left != 0 {
		t.Fatalf("left=%d", left)
	}
	var expiredEvents int
	if _, err := f.svc.ExpireDue(context.Background()); err != nil {
		t.Fatal(err)
	}
	_ = f.pool.QueryRow(context.Background(), `SELECT count(*) FROM quote_events e JOIN quotes q ON q.id = e.quote_id WHERE q.organization_id = $1 AND e.to_status = 'expired'`, f.orgA).Scan(&expiredEvents)
	if expiredEvents != 2 {
		t.Fatalf("expired events=%d (second run must not add)", expiredEvents)
	}
	// Public link of an expired quote cannot be decided.
	token := strings.TrimPrefix(sent.ShareURL, "https://app.test/q/")
	if _, err := f.svc.PublicDecide(context.Background(), token, true, PublicDecisionInput{}, ClientInfo{}); !errors.Is(err, ErrConflict) {
		t.Fatalf("decide expired: %v", err)
	}
}

func TestQuoteQuickConvert_DB(t *testing.T) {
	f := setup(t)
	in := f.basicInput()
	year := 2021
	in.Vehicle = &VehicleInput{Plate: "34 xyz 99", ModelUUID: &f.modelUUID, Year: &year}
	in.Lines = append(in.Lines, LineInput{ServiceUUID: &f.serviceA, Quantity: "3", DiscountType: DiscountAmount, DiscountValue: "10"})
	d, err := f.svc.Create(f.ctxA, in)
	if err != nil {
		t.Fatal(err)
	}
	if d.VehiclePlate != "34XYZ99" || !strings.Contains(d.VehicleLabel, "Model X") {
		t.Fatalf("vehicle: %q %q", d.VehiclePlate, d.VehicleLabel)
	}
	// Draft quotes cannot be converted.
	if _, err := f.svc.Convert(f.ctxA, d.UUID, ConvertInput{}); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("draft convert: %v", err)
	}
	if _, err := f.svc.Send(f.ctxA, d.UUID, SendInput{}); err != nil {
		t.Fatal(err)
	}
	pv, err := f.svc.ConvertPreview(f.ctxA, d.UUID)
	if err != nil || !pv.CanConvert || !pv.WillAccept || !pv.CreatesVehicle || len(pv.Missing) != 0 {
		t.Fatalf("preview: %+v %v", pv, err)
	}
	// 2×150 −10% = 270 (2 × 135); 3×150 − 10 = 440 (not divisible → 1 × 440); custom 50 skipped.
	if pv.JobTotal != "710.00" || pv.SkippedTotal != "50.00" || pv.Lines[1].Included {
		t.Fatalf("preview lines: %+v", pv)
	}
	res, err := f.svc.Convert(f.ctxA, d.UUID, ConvertInput{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Quote.Status != StatusAccepted || res.Quote.JobUUID == nil || *res.Quote.JobUUID != res.JobUUID || res.Quote.CanConvert {
		t.Fatalf("quote after convert: %+v", res.Quote.Quote)
	}
	jobs := jobsusecase.New(f.pool, f.q, nil, nil, nil)
	job, err := jobs.Get(f.ctxA, res.JobUUID)
	if err != nil {
		t.Fatal(err)
	}
	if job.Plate != "34XYZ99" || job.TotalAmount != "710.00" || len(job.Lines) != 2 {
		t.Fatalf("job: %+v", job)
	}
	if job.Lines[0].UnitPrice != "135.00" || !strings.HasPrefix(job.Lines[0].Qty, "2") {
		t.Fatalf("line 0: %+v", job.Lines[0])
	}
	if job.Lines[1].UnitPrice != "440.00" || !strings.Contains(job.Notes, d.Number) || !strings.Contains(job.Notes, "Özel işçilik") {
		t.Fatalf("line 1 / notes: %+v %q", job.Lines[1], job.Notes)
	}
	var leadStatus string
	_ = f.pool.QueryRow(context.Background(), `SELECT status FROM leads WHERE uuid = $1`, f.leadA).Scan(&leadStatus)
	if leadStatus != "won" {
		t.Fatalf("lead=%s", leadStatus)
	}
	// Second conversion is refused.
	if _, err := f.svc.Convert(f.ctxA, d.UUID, ConvertInput{}); !errors.Is(err, ErrConflict) {
		t.Fatalf("double convert: %v", err)
	}
	if _, err := f.svc.SetStatus(f.ctxA, d.UUID, StatusInput{Status: StatusCancelled}); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("cancel converted: %v", err)
	}

	// Without plate / model the conversion asks only for what is missing.
	in2 := f.basicInput()
	in2.LeadUUID = nil
	in2.Vehicle = &VehicleInput{Label: "Beyaz Clio"}
	d2, err := f.svc.Create(f.ctxA, in2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SetStatus(f.ctxA, d2.UUID, StatusInput{Status: StatusAccepted}); err != nil {
		t.Fatal(err)
	}
	pv2, _ := f.svc.ConvertPreview(f.ctxA, d2.UUID)
	if len(pv2.Missing) != 2 || pv2.CanConvert != true {
		t.Fatalf("missing: %+v", pv2)
	}
	if _, err := f.svc.Convert(f.ctxA, d2.UUID, ConvertInput{}); !errors.Is(err, ErrVehicleRequired) {
		t.Fatalf("missing vehicle: %v", err)
	}
	res2, err := f.svc.Convert(f.ctxA, d2.UUID, ConvertInput{Plate: "06 ABC 06", ModelUUID: &f.modelUUID, Year: &year})
	if err != nil || res2.JobUUID == uuid.Nil {
		t.Fatalf("convert with filled vehicle: %v", err)
	}
	// Another org cannot convert it.
	if _, err := f.svc.Convert(f.ctxB, d2.UUID, ConvertInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-org convert: %v", err)
	}
}
