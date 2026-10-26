package usecase

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

// ---- fakes

type fakeMessenger struct {
	mu       sync.Mutex
	wa, sms  bool
	queueErr error
	tplBody  string
	inactive bool
	sent     []OutboundMessage
}

func (f *fakeMessenger) ChannelAvailable(_ context.Context, _ int64, ch string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if ch == ChannelWhatsApp {
		return f.wa, nil
	}
	return f.sms, nil
}

func (f *fakeMessenger) Template(_ context.Context, _ int64, ch, locale string) (Template, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.tplBody == "" {
		return Template{}, nil // not found → built-in default
	}
	return Template{Body: f.tplBody, Active: !f.inactive, Custom: true, Found: true}, nil
}

func (f *fakeMessenger) Queue(_ context.Context, m OutboundMessage) (uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.queueErr != nil {
		return uuid.Nil, f.queueErr
	}
	f.sent = append(f.sent, m)
	return uuid.New(), nil
}

func (f *fakeMessenger) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sent)
}

func (f *fakeMessenger) last() OutboundMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sent[len(f.sent)-1]
}

type fakeTeam struct {
	mu      sync.Mutex
	notices []TeamNotice
}

func (f *fakeTeam) LowScore(_ context.Context, n TeamNotice) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.notices = append(f.notices, n)
	return nil
}

type fakeGate struct {
	disabled bool
	full     bool
	consumed int
}

func (g *fakeGate) Enabled(context.Context, int64, string) (bool, error) { return !g.disabled, nil }

func (g *fakeGate) Check(_ context.Context, _ int64, key string, delta int64) (entitlements.Decision, error) {
	d := entitlements.Decision{Key: key, Limit: 10, Used: int64(g.consumed), Allowed: true}
	if g.full && delta > 0 {
		d.Allowed = false
		return d, &entitlements.LimitError{Decision: d}
	}
	return d, nil
}

func (g *fakeGate) Consume(_ context.Context, _ int64, _ string, delta int64) error {
	g.consumed += int(delta)
	return nil
}

// ---- fixture

type rvFixture struct {
	fx    *dbtest.Fixtures
	q     *db.Queries
	svc   *Service
	msg   *fakeMessenger
	team  *fakeTeam
	gate  *fakeGate
	now   time.Time
	loc   *time.Location
	orgA  dbtest.Row
	orgB  dbtest.Row
	owner dbtest.Row
	staff dbtest.Row
	other dbtest.Row
	ctxA  context.Context
	ctxB  context.Context
	user  dbtest.Row
}

func newRV(t *testing.T) *rvFixture {
	t.Helper()
	fx := dbtest.NewFixtures(t)
	loc := istanbul(t)
	f := &rvFixture{fx: fx, q: db.New(fx.Pool), loc: loc, msg: &fakeMessenger{wa: true, sms: true}, team: &fakeTeam{}, gate: &fakeGate{}}
	f.orgA, f.orgB = fx.Organization(), fx.Organization()
	f.owner, f.staff, f.other = fx.User(), fx.User(), fx.User()
	fx.Exec(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'staff'), ($4, $5, 'owner')`,
		f.orgA.ID, f.owner.ID, f.staff.ID, f.orgB.ID, f.other.ID)
	fx.Exec(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE slug = 'organization_owner'`, f.owner.ID)
	fx.Exec(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE slug = 'organization_user'`, f.staff.ID)
	fx.Exec(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE slug = 'organization_owner'`, f.other.ID)
	f.user = fx.User()
	f.now = time.Date(2026, 10, 20, 14, 0, 0, 0, loc)
	f.svc = New(f.q, f.msg, "https://app.test", nil)
	f.svc.SetTeamNotifier(f.team)
	f.svc.SetEntitlementsGate(f.gate)
	f.svc.SetClock(func() time.Time { return f.now })
	base := context.Background()
	f.ctxA = orgctx.WithScope(authctx.WithPrincipal(base, authctx.Principal{UserInternal: f.owner.ID}),
		orgctx.Scope{InternalID: f.orgA.ID, UUID: f.orgA.UUID, MemberRole: "owner"})
	f.ctxB = orgctx.WithScope(authctx.WithPrincipal(base, authctx.Principal{UserInternal: f.other.ID}),
		orgctx.Scope{InternalID: f.orgB.ID, UUID: f.orgB.UUID, MemberRole: "owner"})
	return f
}

func (f *rvFixture) customer(org dbtest.Row, name, phone string) dbtest.Row {
	c := f.fx.Customer(org, name)
	f.fx.Exec(`UPDATE customers SET phone = $2 WHERE id = $1`, c.ID, phone)
	return c
}

// deliveredJob opens and delivers a job at the given time.
func (f *rvFixture) deliveredJob(org, customer dbtest.Row, at time.Time) dbtest.Row {
	v := f.fx.Vehicle(org, customer)
	j := f.fx.Job(org, customer, v, f.user)
	f.fx.Exec(`UPDATE service_jobs SET status = 'delivered', delivered_at = $2 WHERE id = $1`, j.ID, at)
	return j
}

func (f *rvFixture) request(t *testing.T, job dbtest.Row) db.ReviewRequest {
	t.Helper()
	var token string
	if err := f.fx.Pool.QueryRow(context.Background(), `SELECT token FROM review_requests WHERE job_id = $1`, job.ID).Scan(&token); err != nil {
		t.Fatalf("request for job %d: %v", job.ID, err)
	}
	r, err := f.q.GetReviewRequestByToken(context.Background(), token)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func (f *rvFixture) countForJob(t *testing.T, job dbtest.Row) int {
	t.Helper()
	var n int
	if err := f.fx.Pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM review_requests WHERE job_id = $1`, job.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (f *rvFixture) sweep(t *testing.T) int {
	t.Helper()
	n, err := f.svc.ProcessDue(context.Background())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	return n
}

func ptr[T any](v T) *T { return &v }

func TestReviewsDB(t *testing.T) {
	f := newRV(t)
	ctx := context.Background()

	ayse := f.customer(f.orgA, "Ayşe Kaya", "+905551112233")
	mehmet := f.customer(f.orgA, "Mehmet Demir", "+905552223344")
	nophone := f.customer(f.orgA, "Telefonsuz Müşteri", "")

	// Disabled settings schedule nothing.
	j0 := f.deliveredJob(f.orgA, ayse, f.now)
	if err := f.svc.HandleJobDelivered(f.ctxA, j0.UUID); err != nil || f.countForJob(t, j0) != 0 {
		t.Fatalf("disabled settings must not schedule: %v", err)
	}
	if _, err := f.svc.UpdateSettings(f.ctxA, UpdateSettingsInput{
		Enabled: ptr(true), GoogleReviewURL: ptr("https://g.page/r/tech-oto/review"), DelayMinutes: ptr(120),
		ExcludedCustomerUUIDs: &[]uuid.UUID{},
	}); err != nil {
		t.Fatalf("settings: %v", err)
	}
	if _, err := f.svc.UpdateSettings(f.ctxA, UpdateSettingsInput{GoogleReviewURL: ptr("http://insecure")}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("http google url accepted: %v", err)
	}
	if _, err := f.svc.UpdateSettings(f.ctxA, UpdateSettingsInput{ExcludedCustomerUUIDs: &[]uuid.UUID{uuid.New()}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unknown excluded customer accepted: %v", err)
	}

	var j1Req db.ReviewRequest
	t.Run("scheduling is idempotent per job", func(t *testing.T) {
		j1 := f.deliveredJob(f.orgA, ayse, f.now)
		for i := 0; i < 3; i++ {
			if err := f.svc.HandleJobDelivered(f.ctxA, j1.UUID); err != nil {
				t.Fatal(err)
			}
		}
		if n := f.countForJob(t, j1); n != 1 {
			t.Fatalf("%d requests for one job", n)
		}
		j1Req = f.request(t, j1)
		want := f.now.Add(2 * time.Hour)
		if !j1Req.SendAt.Time.Equal(want) || j1Req.Deferred || j1Req.Status != StatusScheduled {
			t.Fatalf("send_at %v deferred %v status %s", j1Req.SendAt.Time, j1Req.Deferred, j1Req.Status)
		}
		if !ValidToken(j1Req.Token) {
			t.Fatalf("token %q", j1Req.Token)
		}
		// Not sent yet: the public link does not exist.
		if _, err := f.svc.PublicGet(ctx, j1Req.Token); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unsent request visible: %v", err)
		}
	})

	var j2 dbtest.Row
	t.Run("quiet hours defer to the morning", func(t *testing.T) {
		evening := time.Date(2026, 10, 20, 20, 30, 0, 0, f.loc)
		j2 = f.deliveredJob(f.orgA, ayse, evening)
		if err := f.svc.HandleJobDelivered(f.ctxA, j2.UUID); err != nil {
			t.Fatal(err)
		}
		r := f.request(t, j2)
		want := time.Date(2026, 10, 21, 9, 0, 0, 0, f.loc)
		if !r.SendAt.Time.Equal(want) || !r.Deferred {
			t.Fatalf("send_at %v deferred %v, want %v", r.SendAt.Time.In(f.loc), r.Deferred, want)
		}
	})

	t.Run("sweep sends due requests over the messaging fake", func(t *testing.T) {
		f.now = time.Date(2026, 10, 20, 16, 1, 0, 0, f.loc)
		if n := f.sweep(t); n != 1 {
			t.Fatalf("sent %d", n)
		}
		m := f.msg.last()
		if m.Channel != ChannelWhatsApp || m.Phone != "+905551112233" || m.SubjectUUID != j1Req.Uuid {
			t.Fatalf("outbound %+v", m)
		}
		if want := "https://app.test/r/" + j1Req.Token; m.Vars[VarLink] != want || !containsAll(m.Body, want, "Ayşe Kaya") {
			t.Fatalf("body %q vars %v", m.Body, m.Vars)
		}
		r := f.request(t, dbtest.Row{ID: j1Req.JobID.Int64})
		if r.Status != StatusSent || r.Channel != ChannelWhatsApp || !r.ExpiresAt.Valid {
			t.Fatalf("after send %+v", r)
		}
		if f.gate.consumed != 1 {
			t.Fatalf("reviews.monthly consumed %d", f.gate.consumed)
		}
		// Late sweep inside quiet hours: the request is pushed to 09:00.
		f.fx.Exec(`UPDATE review_requests SET send_at = $2, deferred = false WHERE job_id = $1`, j2.ID, time.Date(2026, 10, 20, 21, 30, 0, 0, f.loc))
		f.now = time.Date(2026, 10, 20, 22, 0, 0, 0, f.loc)
		before := f.msg.count()
		f.sweep(t)
		r2 := f.request(t, j2)
		if f.msg.count() != before || r2.Status != StatusScheduled || !r2.Deferred ||
			!r2.SendAt.Time.Equal(time.Date(2026, 10, 21, 9, 0, 0, 0, f.loc)) {
			t.Fatalf("quiet-hours sweep: status %s deferred %v at %v", r2.Status, r2.Deferred, r2.SendAt.Time.In(f.loc))
		}
	})

	t.Run("frequency cap skips the same customer", func(t *testing.T) {
		f.now = time.Date(2026, 10, 21, 9, 1, 0, 0, f.loc)
		f.sweep(t)
		r2 := f.request(t, j2)
		if r2.Status != StatusSkipped || r2.SkipReason != ReasonFrequencyCap {
			t.Fatalf("j2: %s %s", r2.Status, r2.SkipReason)
		}
	})

	t.Run("cancelled jobs cancel the request", func(t *testing.T) {
		j := f.deliveredJob(f.orgA, mehmet, f.now)
		if err := f.svc.HandleJobDelivered(f.ctxA, j.UUID); err != nil {
			t.Fatal(err)
		}
		if err := f.svc.HandleJobCancelled(f.ctxA, j.UUID); err != nil {
			t.Fatal(err)
		}
		if r := f.request(t, j); r.Status != StatusCancelled || r.SkipReason != ReasonJobCancelled {
			t.Fatalf("event cancel: %s %s", r.Status, r.SkipReason)
		}
		// Voided without the event reaching us: the sweep checks the job.
		j2 := f.deliveredJob(f.orgA, mehmet, f.now)
		if err := f.svc.HandleJobDelivered(f.ctxA, j2.UUID); err != nil {
			t.Fatal(err)
		}
		f.fx.Exec(`UPDATE service_jobs SET status = 'voided' WHERE id = $1`, j2.ID)
		f.now = f.now.Add(3 * time.Hour)
		f.sweep(t)
		if r := f.request(t, j2); r.Status != StatusCancelled || r.SkipReason != ReasonJobCancelled {
			t.Fatalf("sweep cancel: %s %s", r.Status, r.SkipReason)
		}
	})

	t.Run("no phone and exclusions are skipped", func(t *testing.T) {
		j := f.deliveredJob(f.orgA, nophone, f.now.Add(-3*time.Hour))
		if err := f.svc.HandleJobDelivered(f.ctxA, j.UUID); err != nil {
			t.Fatal(err)
		}
		f.sweep(t)
		if r := f.request(t, j); r.Status != StatusSkipped || r.SkipReason != ReasonNoPhone {
			t.Fatalf("no phone: %s %s", r.Status, r.SkipReason)
		}
		excluded := f.customer(f.orgA, "Hariç Tutulan", "+905559998877")
		if _, err := f.svc.UpdateSettings(f.ctxA, UpdateSettingsInput{ExcludedCustomerUUIDs: &[]uuid.UUID{excluded.UUID}}); err != nil {
			t.Fatal(err)
		}
		st, err := f.svc.GetSettings(f.ctxA)
		if err != nil || len(st.ExcludedCustomers) != 1 || st.ExcludedCustomers[0].UUID != excluded.UUID {
			t.Fatalf("settings exclude list %+v %v", st.ExcludedCustomers, err)
		}
		j2 := f.deliveredJob(f.orgA, excluded, f.now.Add(-3*time.Hour))
		if err := f.svc.HandleJobDelivered(f.ctxA, j2.UUID); err != nil {
			t.Fatal(err)
		}
		f.sweep(t)
		if r := f.request(t, j2); r.Status != StatusSkipped || r.SkipReason != ReasonExcluded {
			t.Fatalf("excluded: %s %s", r.Status, r.SkipReason)
		}
	})

	t.Run("token validation and submit once", func(t *testing.T) {
		if _, err := f.svc.PublicGet(ctx, "not-a-token"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("garbage token: %v", err)
		}
		if _, err := f.svc.PublicGet(ctx, "AbCdEfGhIjKlMnOpQrStUv"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unknown token: %v", err)
		}
		view, err := f.svc.PublicGet(ctx, j1Req.Token)
		if err != nil || view.State != PublicStateOpen || view.CustomerFirstName != "Ayşe" || view.GoogleReviewURL != "" {
			t.Fatalf("view %+v %v", view, err)
		}
		if r := f.request(t, dbtest.Row{ID: j1Req.JobID.Int64}); r.Status != StatusOpened || !r.OpenedAt.Valid {
			t.Fatalf("not opened: %s", r.Status)
		}
		if _, err := f.svc.PublicAnswer(ctx, j1Req.Token, PublicAnswerInput{Score: 6}, ClientInfo{}); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("score 6: %v", err)
		}
		if _, err := f.svc.PublicGoogleRedirect(ctx, j1Req.Token); !errors.Is(err, ErrNotFound) {
			t.Fatalf("google before answer: %v", err)
		}
		ans, err := f.svc.PublicAnswer(ctx, j1Req.Token, PublicAnswerInput{Score: 5, Comment: "Harika", Consent: true}, ClientInfo{IP: "1.2.3.4"})
		if err != nil || ans.State != PublicStateAnswered || ans.Result != "high" || ans.GoogleReviewURL != "https://g.page/r/tech-oto/review" {
			t.Fatalf("answer %+v %v", ans, err)
		}
		if _, err := f.svc.PublicAnswer(ctx, j1Req.Token, PublicAnswerInput{Score: 1}, ClientInfo{}); !errors.Is(err, ErrAlreadyAnswered) {
			t.Fatalf("second answer: %v", err)
		}
		g, err := f.svc.PublicGoogleRedirect(ctx, j1Req.Token)
		if err != nil || g.URL != "https://g.page/r/tech-oto/review" {
			t.Fatalf("google %+v %v", g, err)
		}
		d, err := f.svc.Get(f.ctxA, j1Req.Uuid)
		if err != nil || d.GoogleRedirects != 1 || d.Score == nil || *d.Score != 5 || d.FollowUpStatus != followNone || !d.Consent {
			t.Fatalf("detail %+v %v", d, err)
		}
		if len(f.team.notices) != 0 {
			t.Fatal("high score must not notify")
		}
	})

	var lowReq db.ReviewRequest
	t.Run("low score notifies the team and needs a follow-up", func(t *testing.T) {
		j := f.deliveredJob(f.orgA, mehmet, f.now.Add(-3*time.Hour))
		if err := f.svc.HandleJobDelivered(f.ctxA, j.UUID); err != nil {
			t.Fatal(err)
		}
		f.sweep(t)
		lowReq = f.request(t, j)
		if lowReq.Status != StatusSent {
			t.Fatalf("not sent: %s %s %s", lowReq.Status, lowReq.SkipReason, lowReq.Error)
		}
		ans, err := f.svc.PublicAnswer(ctx, lowReq.Token, PublicAnswerInput{Score: 2, Comment: "Geç teslim"}, ClientInfo{})
		if err != nil || ans.Result != "low" || ans.GoogleReviewURL != "" {
			t.Fatalf("low answer %+v %v", ans, err)
		}
		got := map[int64]bool{}
		for _, n := range f.team.notices {
			got[n.UserID] = true
			if n.Score != 2 || n.ReviewUUID != lowReq.Uuid || n.ActionURL == "" {
				t.Fatalf("notice %+v", n)
			}
		}
		if !got[f.owner.ID] || !got[f.staff.ID] || got[f.other.ID] || len(got) != 2 {
			t.Fatalf("recipients %v", got)
		}
		if _, err := f.svc.PublicGoogleRedirect(ctx, lowReq.Token); !errors.Is(err, ErrNotFound) {
			t.Fatalf("google for a low score: %v", err)
		}
		list, total, err := f.svc.List(f.ctxA, 20, 0, ListFilters{FollowUp: followNeeded})
		if err != nil || total != 1 || list[0].UUID != lowReq.Uuid || list[0].Rating != "low" {
			t.Fatalf("follow-up list %d %+v %v", total, list, err)
		}
		d, err := f.svc.MarkFollowedUp(f.ctxA, lowReq.Uuid, FollowUpInput{Note: "Arandı, yeniden yıkandı"})
		if err != nil || d.FollowUpStatus != followDone || d.FollowUpNote == "" || d.FollowedUpAt == nil || d.FollowedUpByName == "" {
			t.Fatalf("follow-up %+v %v", d, err)
		}
		if _, err := f.svc.MarkFollowedUp(f.ctxA, j1Req.Uuid, FollowUpInput{}); err != nil {
			t.Fatalf("answered high score can be marked too: %v", err)
		}
	})

	t.Run("organization isolation", func(t *testing.T) {
		if _, err := f.svc.Get(f.ctxB, j1Req.Uuid); !errors.Is(err, ErrNotFound) {
			t.Fatalf("other org get: %v", err)
		}
		if _, err := f.svc.MarkFollowedUp(f.ctxB, lowReq.Uuid, FollowUpInput{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("other org follow-up: %v", err)
		}
		if items, total, err := f.svc.List(f.ctxB, 20, 0, ListFilters{}); err != nil || total != 0 || len(items) != 0 {
			t.Fatalf("other org list %d %v", total, err)
		}
		if items, _, err := f.svc.List(f.ctxB, 20, 0, ListFilters{CustomerUUID: &ayse.UUID}); err != nil || len(items) != 0 {
			t.Fatalf("other org customer filter %v", err)
		}
		if sum, err := f.svc.Summary(f.ctxB, 30); err != nil || sum.SentCount != 0 {
			t.Fatalf("other org summary %+v %v", sum, err)
		}
		// A delivery event seen in another organization's context is ignored.
		j := f.deliveredJob(f.orgA, ayse, f.now)
		if err := f.svc.HandleJobDelivered(f.ctxB, j.UUID); err != nil || f.countForJob(t, j) != 0 {
			t.Fatalf("cross-org schedule: %v", err)
		}
		// The customer 360 filter of the own organization works.
		items, _, err := f.svc.List(f.ctxA, 20, 0, ListFilters{CustomerUUID: &ayse.UUID})
		if err != nil || len(items) == 0 {
			t.Fatalf("customer filter %v", err)
		}
		for _, it := range items {
			if it.CustomerUUID == nil || *it.CustomerUUID != ayse.UUID {
				t.Fatalf("foreign row %+v", it)
			}
		}
	})

	t.Run("plan limit, channel fallback and channel plan gates", func(t *testing.T) {
		if _, err := f.svc.UpdateSettings(f.ctxA, UpdateSettingsInput{MinDaysBetween: ptr(0), ExcludedCustomerUUIDs: &[]uuid.UUID{}}); err != nil {
			t.Fatal(err)
		}
		run := func(c dbtest.Row) db.ReviewRequest {
			j := f.deliveredJob(f.orgA, c, f.now.Add(-3*time.Hour))
			if err := f.svc.HandleJobDelivered(f.ctxA, j.UUID); err != nil {
				t.Fatal(err)
			}
			f.sweep(t)
			return f.request(t, j)
		}
		f.gate.full = true
		if r := run(ayse); r.Status != StatusSkipped || r.SkipReason != ReasonMonthlyLimit {
			t.Fatalf("monthly limit: %s %s", r.Status, r.SkipReason)
		}
		f.gate.full = false
		f.msg.wa = false
		if r := run(ayse); r.Status != StatusSent || r.Channel != ChannelSMS {
			t.Fatalf("auto → sms: %s %s", r.Status, r.Channel)
		}
		f.msg.queueErr = entitlements.ErrFeatureDisabled
		if r := run(ayse); r.Status != StatusSkipped || r.SkipReason != ReasonChannelPlan {
			t.Fatalf("sms plan off: %s %s", r.Status, r.SkipReason)
		}
		f.msg.queueErr = nil
		f.msg.sms = false
		if r := run(ayse); r.Status != StatusFailed || r.SkipReason != ReasonChannelUnavailable {
			t.Fatalf("no channel: %s %s", r.Status, r.SkipReason)
		}
		f.msg.wa, f.msg.sms = true, true
		f.msg.tplBody, f.msg.inactive = "Selam {musteri_adi} {link}", true
		if r := run(ayse); r.Status != StatusSkipped || r.SkipReason != ReasonTemplateInactive {
			t.Fatalf("inactive template: %s %s", r.Status, r.SkipReason)
		}
		f.msg.inactive = false
		r := run(ayse)
		if r.Status != StatusSent || f.msg.last().Body != "Selam Ayşe Kaya https://app.test/r/"+r.Token {
			t.Fatalf("custom template body %q", f.msg.last().Body)
		}
		// Async failure reported by messaging.
		f.svc.OutboundFailed(ctx, f.orgA.ID, r.Uuid, "provider rejected")
		if got := f.request(t, dbtest.Row{ID: r.JobID.Int64}); got.Status != StatusFailed || got.Error != "provider rejected" {
			t.Fatalf("outbound failed: %s %q", got.Status, got.Error)
		}
		f.msg.tplBody = ""
	})

	t.Run("test send to own phone", func(t *testing.T) {
		if _, err := f.svc.SendTest(f.ctxA, TestInput{}); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("no phone: %v", err)
		}
		consumed := f.gate.consumed
		res, err := f.svc.SendTest(f.ctxA, TestInput{Phone: "+90 555 000 11 22"})
		if err != nil || res.PublicURL == "" || res.Review.Kind != kindTest || res.Review.Status != StatusSent {
			t.Fatalf("test send %+v %v", res, err)
		}
		if f.gate.consumed != consumed {
			t.Fatal("test sends must not count toward reviews.monthly")
		}
		items, _, err := f.svc.List(f.ctxA, 50, 0, ListFilters{})
		if err != nil {
			t.Fatal(err)
		}
		for _, it := range items {
			if it.Kind == kindTest {
				t.Fatal("tests are hidden from the default list")
			}
		}
		// A low test answer notifies only the sender and needs no follow-up.
		f.team.notices = nil
		token := res.PublicURL[len("https://app.test/r/"):]
		if _, err := f.svc.PublicAnswer(ctx, token, PublicAnswerInput{Score: 1}, ClientInfo{}); err != nil {
			t.Fatal(err)
		}
		if len(f.team.notices) != 1 || f.team.notices[0].UserID != f.owner.ID {
			t.Fatalf("test notices %+v", f.team.notices)
		}
		if d, _ := f.svc.Get(f.ctxA, res.Review.UUID); d.FollowUpStatus != followNone {
			t.Fatalf("test follow-up %s", d.FollowUpStatus)
		}
	})

	t.Run("summary", func(t *testing.T) {
		sum, err := f.svc.Summary(f.ctxA, 30)
		if err != nil {
			t.Fatal(err)
		}
		if sum.AnsweredCount != 2 || sum.AverageScore != 3.5 || sum.Promoters != 1 || sum.Detractors != 1 || sum.NPS != 0 ||
			sum.GoogleRedirects != 1 || len(sum.Distribution) != 5 || sum.Distribution[4].Count != 1 || sum.SentCount < 3 || len(sum.Trend) == 0 {
			t.Fatalf("summary %+v", sum)
		}
		if sum.ResponseRate <= 0 || sum.ResponseRate > 1 {
			t.Fatalf("response rate %v", sum.ResponseRate)
		}
	})

	t.Run("links expire", func(t *testing.T) {
		j := f.deliveredJob(f.orgA, mehmet, f.now.Add(-3*time.Hour))
		if err := f.svc.HandleJobDelivered(f.ctxA, j.UUID); err != nil {
			t.Fatal(err)
		}
		f.sweep(t)
		r := f.request(t, j)
		if r.Status != StatusSent {
			t.Fatalf("not sent %s %s", r.Status, r.SkipReason)
		}
		// Past expiry but before the sweep: the page already says expired.
		f.now = r.ExpiresAt.Time.Add(time.Minute)
		view, err := f.svc.PublicGet(ctx, r.Token)
		if err != nil || view.State != PublicStateExpired {
			t.Fatalf("expired view %+v %v", view, err)
		}
		if _, err := f.svc.PublicAnswer(ctx, r.Token, PublicAnswerInput{Score: 4}, ClientInfo{}); !errors.Is(err, ErrExpired) {
			t.Fatalf("answer after expiry: %v", err)
		}
		f.sweep(t)
		if got := f.request(t, j); got.Status != StatusExpired {
			t.Fatalf("sweep expiry: %s", got.Status)
		}
		// Answered links never expire.
		if v, err := f.svc.PublicGet(ctx, j1Req.Token); err != nil || v.State != PublicStateAnswered {
			t.Fatalf("answered after expiry window: %+v %v", v, err)
		}
	})

	t.Run("plan toggle off", func(t *testing.T) {
		f.gate.disabled = true
		defer func() { f.gate.disabled = false }()
		if _, _, err := f.svc.List(f.ctxA, 10, 0, ListFilters{}); !errors.Is(err, entitlements.ErrFeatureDisabled) {
			t.Fatalf("list with plan off: %v", err)
		}
		j := f.deliveredJob(f.orgA, mehmet, f.now)
		if err := f.svc.HandleJobDelivered(f.ctxA, j.UUID); err != nil || f.countForJob(t, j) != 0 {
			t.Fatalf("schedule with plan off: %v", err)
		}
	})
}

func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			return false
		}
	}
	return true
}
