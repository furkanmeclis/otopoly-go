package usecase_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/loyalty/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
)

type fixture struct {
	t        *testing.T
	fx       *dbtest.Fixtures
	q        *db.Queries
	loyalty  *usecase.Service
	jobs     *jobsusecase.Service
	ctx      context.Context
	org      dbtest.Row
	user     dbtest.Row
	customer dbtest.Row
	vehicle  dbtest.Row
	wash     uuid.UUID // "İç-dış yıkama", 200 TRY
	wax      uuid.UUID // "Pasta cila", 1000 TRY
	kasa     uuid.UUID
}

func setup(t *testing.T) *fixture {
	t.Helper()
	fx := dbtest.NewFixtures(t)
	q := db.New(fx.Pool)
	f := &fixture{t: t, fx: fx, q: q}
	f.org, f.user = fx.Organization(), fx.User()
	f.customer = fx.Customer(f.org, "Sadık Müşteri")
	f.vehicle = fx.Vehicle(f.org, f.customer)
	fx.Exec(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, f.org.ID, f.user.ID)
	if err := financeusecase.SeedDefaults(context.Background(), q, f.org.ID); err != nil {
		t.Fatal(err)
	}
	f.wash = f.service("İç-dış yıkama", "200")
	f.wax = f.service("Pasta cila", "1000")
	fin := financeusecase.New(fx.Pool, q, nil)
	cari := cariusecase.New(fx.Pool, q, nil, fin)
	f.loyalty = usecase.New(fx.Pool, q, nil, fin, cari, nil)
	f.jobs = jobsusecase.New(fx.Pool, q, nil, fin, cari)
	f.jobs.SetLoyalty(f.loyalty)
	f.ctx = f.scope(f.org)
	accs, _, err := fin.ListAccounts(f.ctx, 10, 0, "", nil)
	if err != nil || len(accs) == 0 {
		t.Fatalf("accounts: %v %v", accs, err)
	}
	f.kasa = accs[0].UUID
	return f
}

func (f *fixture) scope(org dbtest.Row) context.Context {
	return authctx.WithPrincipal(
		orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: org.ID, UUID: org.UUID, Slug: "fx"}),
		authctx.Principal{UserInternal: f.user.ID},
	)
}

func (f *fixture) service(name, price string) uuid.UUID {
	var id uuid.UUID
	if err := f.fx.Pool.QueryRow(context.Background(),
		`INSERT INTO services (organization_id, name, price, vat_rate) VALUES ($1, $2, $3, 20) RETURNING uuid`,
		f.org.ID, name, price).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *fixture) job(services ...uuid.UUID) jobsusecase.JobDetail {
	f.t.Helper()
	lines := make([]jobsusecase.CreateLineInput, 0, len(services))
	for _, s := range services {
		lines = append(lines, jobsusecase.CreateLineInput{ServiceUUID: s})
	}
	j, err := f.jobs.Create(f.ctx, jobsusecase.CreateInput{CustomerUUID: f.customer.UUID, VehicleUUID: f.vehicle.UUID, Lines: lines})
	if err != nil {
		f.t.Fatalf("create job: %v", err)
	}
	return j
}

// settle delivers and closes a job (cash).
func (f *fixture) settle(j jobsusecase.JobDetail) jobsusecase.JobDetail {
	f.t.Helper()
	if _, err := f.jobs.MarkDelivered(f.ctx, j.UUID); err != nil {
		f.t.Fatalf("deliver: %v", err)
	}
	out, err := f.jobs.Close(f.ctx, j.UUID, jobsusecase.CloseInput{Method: "cash", FinanceAccountUUID: &f.kasa})
	if err != nil {
		f.t.Fatalf("close: %v", err)
	}
	return out
}

func (f *fixture) campaign(stamps int32) usecase.Campaign {
	f.t.Helper()
	c, err := f.loyalty.CreateCampaign(f.ctx, usecase.CampaignInput{
		Name: "10 yıkama 1 bedava", ServiceUUIDs: []uuid.UUID{f.wash}, StampsRequired: stamps,
		RewardType: usecase.RewardFreeService, RewardServiceUUID: &f.wash,
	})
	if err != nil {
		f.t.Fatalf("campaign: %v", err)
	}
	return c
}

func (f *fixture) card(uuid uuid.UUID) usecase.StampCard {
	f.t.Helper()
	cl, err := f.loyalty.CustomerLoyalty(f.ctx, f.customer.UUID)
	if err != nil {
		f.t.Fatal(err)
	}
	for _, c := range cl.Stamps {
		if c.CampaignUUID == uuid {
			return c
		}
	}
	f.t.Fatalf("no card for %s", uuid)
	return usecase.StampCard{}
}

func find(opts []usecase.Option, kind string) *usecase.Option {
	for i := range opts {
		if opts[i].Kind == kind {
			return &opts[i]
		}
	}
	return nil
}

func TestStampsEarnOncePerJobAndReverseOnVoid(t *testing.T) {
	f := setup(t)
	c := f.campaign(3)

	// A job without an eligible line earns nothing.
	f.settle(f.job(f.wax))
	if got := f.card(c.UUID).Balance; got != 0 {
		t.Fatalf("ineligible job earned %d stamps", got)
	}

	j := f.settle(f.job(f.wash))
	if got := f.card(c.UUID).Balance; got != 1 {
		t.Fatalf("balance after one job = %d, want 1", got)
	}
	// Settling again (e.g. a retried hook) does not earn twice.
	var jobID int64
	if err := f.fx.Pool.QueryRow(context.Background(), `SELECT id FROM service_jobs WHERE uuid = $1`, j.UUID).Scan(&jobID); err != nil {
		t.Fatal(err)
	}
	f.loyalty.JobSettled(f.ctx, f.org.ID, jobID)
	f.loyalty.JobSettled(f.ctx, f.org.ID, jobID)
	if got := f.card(c.UUID).Balance; got != 1 {
		t.Fatalf("balance after repeated settle = %d, want 1", got)
	}
	view, err := f.loyalty.JobLoyalty(f.ctx, j.UUID)
	if err != nil || len(view.StampsEarned) != 1 {
		t.Fatalf("job view stamps earned = %+v %v", view.StampsEarned, err)
	}

	// Voiding the paid job reverses its stamp (once).
	if _, err := f.jobs.Void(f.ctx, j.UUID); err != nil {
		t.Fatalf("void: %v", err)
	}
	if got := f.card(c.UUID).Balance; got != 0 {
		t.Fatalf("balance after void = %d, want 0", got)
	}
	if err := f.loyalty.JobReversedTx(f.ctx, f.q, f.org.ID, jobID, 0); err != nil {
		t.Fatal(err)
	}
	if got := f.card(c.UUID).Balance; got != 0 {
		t.Fatalf("balance after repeated reverse = %d, want 0", got)
	}
}

func TestRewardRedeemRevertAndCoveredClose(t *testing.T) {
	f := setup(t)
	c := f.campaign(2)
	f.settle(f.job(f.wash))
	f.settle(f.job(f.wash))
	if card := f.card(c.UUID); card.RewardsAvailable != 1 || card.Stamps != 0 {
		t.Fatalf("card after 2 jobs = %+v", card)
	}

	j := f.job(f.wash)
	view, err := f.loyalty.JobLoyalty(f.ctx, j.UUID)
	if err != nil {
		t.Fatal(err)
	}
	opt := find(view.Options, usecase.KindReward)
	if opt == nil || opt.DiscountAmount != "200.00" {
		t.Fatalf("reward option = %+v (options %+v)", opt, view.Options)
	}
	if _, err := f.loyalty.Apply(f.ctx, j.UUID, usecase.ApplyInput{Kind: opt.Kind, SourceUUID: opt.SourceUUID, LineUUID: opt.LineUUID}); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if card := f.card(c.UUID); card.RewardsAvailable != 0 || card.Balance != 0 || card.RewardsRedeemed != 1 {
		t.Fatalf("card after redeem = %+v", card)
	}
	detail, _ := f.jobs.Get(f.ctx, j.UUID)
	if detail.TotalAmount != "0.00" || detail.Lines[0].DiscountSource != "reward" || detail.Lines[0].DiscountAmount != "200.00" {
		t.Fatalf("job after redeem: total %s line %+v", detail.TotalAmount, detail.Lines[0])
	}
	// Applying the same reward twice is refused.
	if _, err := f.loyalty.Apply(f.ctx, j.UUID, usecase.ApplyInput{Kind: opt.Kind, SourceUUID: opt.SourceUUID, LineUUID: opt.LineUUID}); err == nil {
		t.Fatal("second apply on a covered line must fail")
	}

	// Revert gives the stamps back and charges the line again.
	view, _ = f.loyalty.JobLoyalty(f.ctx, j.UUID)
	if _, err := f.loyalty.Revert(f.ctx, j.UUID, view.Applied[0].UUID); err != nil {
		t.Fatalf("revert: %v", err)
	}
	if card := f.card(c.UUID); card.RewardsAvailable != 1 || card.Balance != 2 {
		t.Fatalf("card after revert = %+v", card)
	}
	detail, _ = f.jobs.Get(f.ctx, j.UUID)
	if detail.TotalAmount != "200.00" || detail.Lines[0].DiscountSource != "" {
		t.Fatalf("job after revert: total %s line %+v", detail.TotalAmount, detail.Lines[0])
	}

	// Redeem again and close: a fully covered job closes without payment
	// and does not earn a new stamp.
	if _, err := f.loyalty.Apply(f.ctx, j.UUID, usecase.ApplyInput{Kind: opt.Kind, SourceUUID: opt.SourceUUID, LineUUID: opt.LineUUID}); err != nil {
		t.Fatalf("re-apply: %v", err)
	}
	if _, err := f.jobs.MarkDelivered(f.ctx, j.UUID); err != nil {
		t.Fatal(err)
	}
	closed, err := f.jobs.Close(f.ctx, j.UUID, jobsusecase.CloseInput{})
	if err != nil {
		t.Fatalf("covered close: %v", err)
	}
	if closed.PaymentStatus != "paid" || len(closed.Payments) != 0 {
		t.Fatalf("covered close = %s payments %d", closed.PaymentStatus, len(closed.Payments))
	}
	if card := f.card(c.UUID); card.Balance != 0 {
		t.Fatalf("free job earned a stamp: %+v", card)
	}
	// Paid job: loyalty is locked.
	view, _ = f.loyalty.JobLoyalty(f.ctx, j.UUID)
	if view.Editable {
		t.Fatal("paid job must not be editable")
	}
	if _, err := f.loyalty.Revert(f.ctx, j.UUID, view.Applied[len(view.Applied)-1].UUID); !errors.Is(err, usecase.ErrConflict) {
		t.Fatalf("revert on paid job = %v", err)
	}
}

func TestPackageSaleCreditsAndCancel(t *testing.T) {
	f := setup(t)
	pkg, err := f.loyalty.CreatePackage(f.ctx, usecase.PackageInput{
		Name: "10 Yıkama Paketi", Price: "1500", ValidityDays: ptr(int32(90)),
		Items: []usecase.PackageItemInput{{ServiceUUID: f.wash, Quantity: 2}},
	})
	if err != nil {
		t.Fatalf("package: %v", err)
	}
	if pkg.ListValue != "400.00" || len(pkg.Items) != 1 {
		t.Fatalf("package = %+v", pkg)
	}
	sold, err := f.loyalty.SellPackage(f.ctx, usecase.SellPackageInput{
		PackageUUID: pkg.UUID, CustomerUUID: f.customer.UUID, Method: "cash", FinanceAccountUUID: &f.kasa,
	})
	if err != nil {
		t.Fatalf("sell: %v", err)
	}
	if sold.State != "active" || sold.CreditsTotal != 2 || sold.ExpiresAt == nil {
		t.Fatalf("sold = %+v", sold)
	}
	var income string
	if err := f.fx.Pool.QueryRow(context.Background(), `
		SELECT ft.amount::text FROM finance_transactions ft JOIN finance_categories fc ON fc.id = ft.category_id
		WHERE ft.organization_id = $1 AND ft.source_type = 'loyalty_package' AND fc.name = 'Paket Satışı' AND ft.status = 'posted'`,
		f.org.ID).Scan(&income); err != nil {
		t.Fatalf("package income: %v", err)
	}

	// Use a credit, then cancel the job: the credit comes back.
	j := f.job(f.wash, f.wax)
	view, _ := f.loyalty.JobLoyalty(f.ctx, j.UUID)
	opt := find(view.Options, usecase.KindPackage)
	if opt == nil || opt.Units != 1 || opt.Remaining == nil || *opt.Remaining != 1 {
		t.Fatalf("package option = %+v", opt)
	}
	if _, err := f.loyalty.Apply(f.ctx, j.UUID, usecase.ApplyInput{Kind: opt.Kind, SourceUUID: opt.SourceUUID, LineUUID: opt.LineUUID}); err != nil {
		t.Fatalf("apply credit: %v", err)
	}
	detail, _ := f.jobs.Get(f.ctx, j.UUID)
	if detail.TotalAmount != "1000.00" {
		t.Fatalf("total after credit = %s", detail.TotalAmount)
	}
	cp, _ := f.loyalty.GetCustomerPackage(f.ctx, sold.UUID)
	if cp.CreditsUsed != 1 || len(cp.Usage) != 1 {
		t.Fatalf("after use = %+v", cp)
	}
	// Cancelling the package is refused while a credit sits on an open job.
	if _, err := f.loyalty.CancelCustomerPackage(f.ctx, sold.UUID); !errors.Is(err, usecase.ErrConflict) {
		t.Fatalf("cancel with applied credit = %v", err)
	}
	if _, err := f.jobs.Cancel(f.ctx, j.UUID); err != nil {
		t.Fatalf("cancel job: %v", err)
	}
	cp, _ = f.loyalty.GetCustomerPackage(f.ctx, sold.UUID)
	if cp.CreditsUsed != 0 || cp.Usage[0].Status != "reverted" {
		t.Fatalf("after job cancel = %+v", cp)
	}

	// Unused package: cancelling refunds the sale.
	res, err := f.loyalty.CancelCustomerPackage(f.ctx, sold.UUID)
	if err != nil || !res.Refunded || res.State != "cancelled" {
		t.Fatalf("cancel package = %+v %v", res, err)
	}
	var status string
	_ = f.fx.Pool.QueryRow(context.Background(), `SELECT status FROM finance_transactions WHERE organization_id = $1 AND source_type = 'loyalty_package'`, f.org.ID).Scan(&status)
	if status != "void" {
		t.Fatalf("package income status after refund = %s", status)
	}
}

func TestPackageExpiryAndUsedUp(t *testing.T) {
	f := setup(t)
	pkg, _ := f.loyalty.CreatePackage(f.ctx, usecase.PackageInput{
		Name: "Tek yıkama", Price: "150", ValidityDays: ptr(int32(10)),
		Items: []usecase.PackageItemInput{{ServiceUUID: f.wash, Quantity: 1}},
	})
	sold, err := f.loyalty.SellPackage(f.ctx, usecase.SellPackageInput{PackageUUID: pkg.UUID, CustomerUUID: f.customer.UUID, Method: "cari"})
	if err != nil {
		t.Fatalf("sell on cari: %v", err)
	}
	j := f.job(f.wash)
	view, _ := f.loyalty.JobLoyalty(f.ctx, j.UUID)
	opt := find(view.Options, usecase.KindPackage)
	if _, err := f.loyalty.Apply(f.ctx, j.UUID, usecase.ApplyInput{Kind: opt.Kind, SourceUUID: opt.SourceUUID, LineUUID: opt.LineUUID}); err != nil {
		t.Fatal(err)
	}
	cp, _ := f.loyalty.GetCustomerPackage(f.ctx, sold.UUID)
	if cp.State != "used_up" {
		t.Fatalf("state = %s, want used_up", cp.State)
	}
	// An expired package offers nothing even with credits left.
	sold2, _ := f.loyalty.SellPackage(f.ctx, usecase.SellPackageInput{PackageUUID: pkg.UUID, CustomerUUID: f.customer.UUID, Method: "cari"})
	f.fx.Exec(`UPDATE loyalty_customer_packages SET expires_at = NOW() - INTERVAL '1 hour' WHERE uuid = $1`, sold2.UUID)
	cp2, _ := f.loyalty.GetCustomerPackage(f.ctx, sold2.UUID)
	if cp2.State != "expired" {
		t.Fatalf("state = %s, want expired", cp2.State)
	}
	j2 := f.job(f.wash)
	view, _ = f.loyalty.JobLoyalty(f.ctx, j2.UUID)
	if find(view.Options, usecase.KindPackage) != nil {
		t.Fatalf("expired package offered: %+v", view.Options)
	}
}

func TestSubscriptionPeriodUsesAndPayments(t *testing.T) {
	f := setup(t)
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	f.loyalty.SetClock(func() time.Time { return now })
	plan, err := f.loyalty.CreatePlan(f.ctx, usecase.PlanInput{
		Name: "Aylık 2 yıkama", Price: "500", UsesPerPeriod: ptr(int32(2)), ServiceUUIDs: []uuid.UUID{f.wash},
	})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	// Started without payment: past due and no option on jobs.
	sub, err := f.loyalty.StartSubscription(f.ctx, usecase.StartSubscriptionInput{PlanUUID: plan.UUID, CustomerUUID: f.customer.UUID})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if sub.State != "past_due" || sub.RenewalDate != "2026-10-26" || sub.NextPeriod.End != "2026-11-26" {
		t.Fatalf("unpaid subscription = %+v", sub.Subscription)
	}
	j := f.job(f.wash)
	view, _ := f.loyalty.JobLoyalty(f.ctx, j.UUID)
	if find(view.Options, usecase.KindSubscription) != nil {
		t.Fatal("an unpaid subscription must not cover jobs")
	}
	sub, err = f.loyalty.PaySubscription(f.ctx, sub.UUID, usecase.PaymentInput{Method: "card", FinanceAccountUUID: &f.kasa})
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	if sub.State != "active" || sub.RenewalDate != "2026-11-26" || len(sub.Payments) != 1 || sub.CurrentPeriod == nil {
		t.Fatalf("paid subscription = %+v", sub)
	}
	// Two uses in the period, the third is refused.
	for i := 0; i < 2; i++ {
		jj := j
		if i > 0 {
			jj = f.job(f.wash)
		}
		view, _ = f.loyalty.JobLoyalty(f.ctx, jj.UUID)
		opt := find(view.Options, usecase.KindSubscription)
		if opt == nil {
			t.Fatalf("use %d: no subscription option", i+1)
		}
		if _, err := f.loyalty.Apply(f.ctx, jj.UUID, usecase.ApplyInput{Kind: opt.Kind, SourceUUID: opt.SourceUUID, LineUUID: opt.LineUUID}); err != nil {
			t.Fatalf("use %d: %v", i+1, err)
		}
	}
	third := f.job(f.wash)
	view, _ = f.loyalty.JobLoyalty(f.ctx, third.UUID)
	if find(view.Options, usecase.KindSubscription) != nil {
		t.Fatal("third use within a 2-use period must not be offered")
	}
	_, err = f.loyalty.Apply(f.ctx, third.UUID, usecase.ApplyInput{Kind: usecase.KindSubscription, SourceUUID: sub.UUID, LineUUID: third.Lines[0].UUID})
	if !errors.Is(err, usecase.ErrNotApplicable) {
		t.Fatalf("third use = %v", err)
	}
	got, _ := f.loyalty.GetSubscription(f.ctx, sub.UUID)
	if got.CurrentPeriod.Used != 2 || *got.CurrentPeriod.Remaining != 0 || len(got.Usage) != 2 {
		t.Fatalf("period = %+v usage %d", got.CurrentPeriod, len(got.Usage))
	}

	// Next month: a new period, uses start over once it is paid.
	now = time.Date(2026, 11, 27, 9, 0, 0, 0, time.UTC)
	got, _ = f.loyalty.GetSubscription(f.ctx, sub.UUID)
	if got.State != "past_due" || got.DaysUntilRenewal >= 0 {
		t.Fatalf("after renewal date = %+v", got.Subscription)
	}
	got, err = f.loyalty.PaySubscription(f.ctx, sub.UUID, usecase.PaymentInput{Method: "cari"})
	if err != nil || got.RenewalDate != "2026-12-26" || got.CurrentPeriod.Used != 0 {
		t.Fatalf("second period = %+v %v", got.CurrentPeriod, err)
	}
	due, _, err := f.loyalty.ListSubscriptions(f.ctx, usecase.SubscriptionFilter{DueWithinDays: ptr(30), Limit: 10})
	if err != nil || len(due) != 1 {
		t.Fatalf("renewals within 30 days = %d %v", len(due), err)
	}
	// Cancel: no further payments.
	if _, err := f.loyalty.CancelSubscription(f.ctx, sub.UUID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.loyalty.PaySubscription(f.ctx, sub.UUID, usecase.PaymentInput{Method: "cari"}); !errors.Is(err, usecase.ErrConflict) {
		t.Fatalf("pay cancelled = %v", err)
	}
}

func TestUnlimitedSubscriptionVehicleBound(t *testing.T) {
	f := setup(t)
	plan, _ := f.loyalty.CreatePlan(f.ctx, usecase.PlanInput{Name: "Sınırsız", Price: "900", ServiceUUIDs: []uuid.UUID{f.wash}})
	other := f.fx.Vehicle(f.org, f.customer)
	sub, err := f.loyalty.StartSubscription(f.ctx, usecase.StartSubscriptionInput{
		PlanUUID: plan.UUID, CustomerUUID: f.customer.UUID, VehicleUUID: &other.UUID,
		Payment: &usecase.PaymentInput{Method: "cash", FinanceAccountUUID: &f.kasa},
	})
	if err != nil || sub.State != "active" || sub.CurrentPeriod.Limit != nil {
		t.Fatalf("start paid = %+v %v", sub, err)
	}
	// The job's vehicle is not the subscribed one.
	j := f.job(f.wash)
	view, _ := f.loyalty.JobLoyalty(f.ctx, j.UUID)
	if find(view.Options, usecase.KindSubscription) != nil {
		t.Fatal("a vehicle-bound subscription must not cover another vehicle")
	}
	f.vehicle = other
	for i := 0; i < 3; i++ {
		jj := f.job(f.wash)
		view, _ = f.loyalty.JobLoyalty(f.ctx, jj.UUID)
		opt := find(view.Options, usecase.KindSubscription)
		if opt == nil || opt.Remaining != nil {
			t.Fatalf("unlimited use %d option = %+v", i+1, opt)
		}
		if _, err := f.loyalty.Apply(f.ctx, jj.UUID, usecase.ApplyInput{Kind: opt.Kind, SourceUUID: opt.SourceUUID, LineUUID: opt.LineUUID}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOrganizationIsolation(t *testing.T) {
	f := setup(t)
	c := f.campaign(3)
	pkg, _ := f.loyalty.CreatePackage(f.ctx, usecase.PackageInput{Name: "P", Price: "100", Items: []usecase.PackageItemInput{{ServiceUUID: f.wash, Quantity: 1}}})
	sold, err := f.loyalty.SellPackage(f.ctx, usecase.SellPackageInput{PackageUUID: pkg.UUID, CustomerUUID: f.customer.UUID, Method: "cari"})
	if err != nil {
		t.Fatal(err)
	}
	plan, _ := f.loyalty.CreatePlan(f.ctx, usecase.PlanInput{Name: "S", Price: "100", ServiceUUIDs: []uuid.UUID{f.wash}})
	sub, _ := f.loyalty.StartSubscription(f.ctx, usecase.StartSubscriptionInput{PlanUUID: plan.UUID, CustomerUUID: f.customer.UUID})
	j := f.job(f.wash)

	other := f.fx.Organization()
	f.fx.Exec(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, other.ID, f.user.ID)
	octx := f.scope(other)

	checks := map[string]error{}
	_, checks["campaign"] = f.loyalty.GetCampaign(octx, c.UUID)
	_, checks["update campaign"] = f.loyalty.UpdateCampaign(octx, c.UUID, usecase.CampaignInput{
		Name: "x", StampsRequired: 1, RewardType: usecase.RewardFixed, RewardValue: "1",
	})
	checks["delete campaign"] = f.loyalty.DeleteCampaign(octx, c.UUID)
	_, checks["package"] = f.loyalty.GetPackage(octx, pkg.UUID)
	_, checks["plan"] = f.loyalty.GetPlan(octx, plan.UUID)
	_, checks["customer package"] = f.loyalty.GetCustomerPackage(octx, sold.UUID)
	_, checks["cancel customer package"] = f.loyalty.CancelCustomerPackage(octx, sold.UUID)
	_, checks["subscription"] = f.loyalty.GetSubscription(octx, sub.UUID)
	_, checks["pay subscription"] = f.loyalty.PaySubscription(octx, sub.UUID, usecase.PaymentInput{Method: "cari"})
	_, checks["cancel subscription"] = f.loyalty.CancelSubscription(octx, sub.UUID)
	_, checks["customer loyalty"] = f.loyalty.CustomerLoyalty(octx, f.customer.UUID)
	_, checks["job loyalty"] = f.loyalty.JobLoyalty(octx, j.UUID)
	_, checks["apply"] = f.loyalty.Apply(octx, j.UUID, usecase.ApplyInput{Kind: usecase.KindPackage, SourceUUID: sold.UUID, LineUUID: j.Lines[0].UUID})
	_, checks["sell"] = f.loyalty.SellPackage(octx, usecase.SellPackageInput{PackageUUID: pkg.UUID, CustomerUUID: f.customer.UUID, Method: "cari"})
	_, checks["start"] = f.loyalty.StartSubscription(octx, usecase.StartSubscriptionInput{PlanUUID: plan.UUID, CustomerUUID: f.customer.UUID})
	for name, err := range checks {
		if !errors.Is(err, usecase.ErrNotFound) {
			t.Errorf("%s from another organization = %v, want not found", name, err)
		}
	}
	// Another organization's services cannot be referenced.
	_, err = f.loyalty.CreateCampaign(octx, usecase.CampaignInput{
		Name: "x", ServiceUUIDs: []uuid.UUID{f.wash}, StampsRequired: 2, RewardType: usecase.RewardFixed, RewardValue: "10",
	})
	if !errors.Is(err, usecase.ErrInvalidRequest) {
		t.Errorf("campaign with a foreign service = %v", err)
	}
	// Lists stay empty.
	if list, total, _ := f.loyalty.ListCampaigns(octx, usecase.ListFilter{Limit: 10}); total != 0 || len(list) != 0 {
		t.Errorf("foreign campaigns listed: %d", total)
	}
	if list, total, _ := f.loyalty.ListCustomerPackages(octx, usecase.CustomerPackageFilter{Limit: 10}); total != 0 || len(list) != 0 {
		t.Errorf("foreign packages listed: %d", total)
	}
	if list, total, _ := f.loyalty.ListSubscriptions(octx, usecase.SubscriptionFilter{Limit: 10}); total != 0 || len(list) != 0 {
		t.Errorf("foreign subscriptions listed: %d", total)
	}
	// Nothing changed in the owner organization.
	if got, err := f.loyalty.GetCampaign(f.ctx, c.UUID); err != nil || got.Name != c.Name {
		t.Errorf("campaign changed: %+v %v", got, err)
	}
}

func ptr[T any](v T) *T { return &v }
