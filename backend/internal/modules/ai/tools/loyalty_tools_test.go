package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	loyaltyusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/loyalty/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/google/uuid"
)

// fakeLoyalty is an in-memory loyalty use case; writes are recorded on w.
type fakeLoyalty struct {
	w        *world
	off      bool
	customer loyaltyusecase.Ref
	pkgs     []loyaltyusecase.Package
	options  []loyaltyusecase.Option
	editable bool
	sold     *loyaltyusecase.SellPackageInput
	applied  *loyaltyusecase.ApplyInput
}

func (f *fakeLoyalty) CheckEnabled(context.Context) error {
	if f.off {
		return entitlements.ErrFeatureDisabled
	}
	return nil
}

func (f *fakeLoyalty) CustomerRef(_ context.Context, id uuid.UUID) (loyaltyusecase.Ref, error) {
	if id != f.customer.UUID {
		return loyaltyusecase.Ref{}, loyaltyusecase.ErrNotFound
	}
	return f.customer, nil
}

func (f *fakeLoyalty) CustomerLoyalty(_ context.Context, id uuid.UUID) (loyaltyusecase.CustomerLoyalty, error) {
	left := int64(1)
	return loyaltyusecase.CustomerLoyalty{
		CustomerUUID: id, RewardsAvailable: 1,
		Stamps: []loyaltyusecase.StampCard{{CampaignUUID: uuid.New(), CampaignName: "10 yıkama 1 bedava", Stamps: 3, StampsRequired: 10,
			RewardsAvailable: 1, RewardType: "free_service", RewardService: &loyaltyusecase.Ref{Name: "İç Dış Yıkama"}, Active: true}},
		Packages: []loyaltyusecase.CustomerPackage{{UUID: uuid.New(), Name: "5'li paket", Credits: []loyaltyusecase.Credit{{ServiceName: "Dış Yıkama", Total: 5, Remaining: 2}}}},
		Subscriptions: []loyaltyusecase.Subscription{{UUID: uuid.New(), Name: "Aylık", State: "active", RenewalDate: "2026-11-26", Price: "900.00", Currency: "TRY",
			CurrentPeriod: &loyaltyusecase.Period{Remaining: &left}}},
	}, nil
}

func (f *fakeLoyalty) ListCampaigns(context.Context, loyaltyusecase.ListFilter) ([]loyaltyusecase.Campaign, int64, error) {
	return []loyaltyusecase.Campaign{{UUID: uuid.New(), Name: "Damga", StampsRequired: 10, RewardType: "percent", RewardValue: "50.00", IsActive: true}}, 1, nil
}

func (f *fakeLoyalty) ListPackages(context.Context, loyaltyusecase.ListFilter) ([]loyaltyusecase.Package, int64, error) {
	return f.pkgs, int64(len(f.pkgs)), nil
}

func (f *fakeLoyalty) ListPlans(context.Context, loyaltyusecase.ListFilter) ([]loyaltyusecase.Plan, int64, error) {
	return []loyaltyusecase.Plan{{UUID: uuid.New(), Name: "Sınırsız", Price: "900.00", Currency: "TRY", PeriodMonths: 1, IsActive: true}}, 1, nil
}

func (f *fakeLoyalty) SellPackage(_ context.Context, in loyaltyusecase.SellPackageInput) (loyaltyusecase.CustomerPackageDetail, error) {
	f.w.write("sell_package")
	f.sold = &in
	return loyaltyusecase.CustomerPackageDetail{CustomerPackage: loyaltyusecase.CustomerPackage{
		UUID: uuid.New(), Name: "10 Yıkama", CustomerName: f.customer.Name, Price: "1500.00", Currency: "TRY", PaymentMethod: in.Method,
	}}, nil
}

func (f *fakeLoyalty) JobLoyalty(_ context.Context, id uuid.UUID) (loyaltyusecase.JobLoyalty, error) {
	return loyaltyusecase.JobLoyalty{JobUUID: id, Editable: f.editable, Options: f.options}, nil
}

func (f *fakeLoyalty) Apply(_ context.Context, id uuid.UUID, in loyaltyusecase.ApplyInput) (loyaltyusecase.JobLoyalty, error) {
	f.w.write("apply")
	f.applied = &in
	return loyaltyusecase.JobLoyalty{JobUUID: id, Applied: []loyaltyusecase.Application{{UUID: uuid.New(), LineUUID: in.LineUUID, Status: "applied", DiscountAmount: "500.00"}}}, nil
}

func loyaltyWorld(t *testing.T) (*world, *fakeLoyalty) {
	t.Helper()
	w := newWorld()
	c := w.addCustomer("Ayşe Kaya", "05551112233", "34 AK 34")
	f := &fakeLoyalty{w: w, customer: loyaltyusecase.Ref{UUID: c.UUID, Name: c.Name}, editable: true,
		pkgs: []loyaltyusecase.Package{
			{UUID: uuid.New(), Name: "10 Yıkama Paketi", Price: "1500.00", Currency: "TRY", IsActive: true,
				Items: []loyaltyusecase.PackageItem{{ServiceName: "Dış Yıkama", Quantity: 10}}},
			{UUID: uuid.New(), Name: "Seramik Bakım Paketi", Price: "3000.00", Currency: "TRY", IsActive: true},
		}}
	return w, f
}

func loyaltyEnv() Env {
	e := ownerEnv()
	e.Principal.Permissions = append(e.Principal.Permissions, "tenant.loyalty.read", "tenant.loyalty.apply")
	return e
}

func TestSellPackageProposeResolvesWithoutWriting(t *testing.T) {
	w, f := loyaltyWorld(t)
	tool := SellPackage{loyalty: f, finance: fakeFinanceW{w: w}}
	raw, _ := json.Marshal(map[string]any{"customer_uuid": f.customer.UUID.String(), "package": "10 yıkama", "payment_method": "card"})
	p, err := tool.Propose(context.Background(), loyaltyEnv(), raw)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	if len(w.writes) != 0 {
		t.Fatalf("propose wrote: %v", w.writes)
	}
	var in sellPackageInput
	_ = json.Unmarshal(p.Input, &in)
	if in.Package != f.pkgs[0].UUID.String() || in.FinanceAccount != w.account("Garanti POS").UUID.String() {
		t.Fatalf("normalized input = %+v", in)
	}
	if p.Preview.Title != "Ayşe Kaya" || !strings.Contains(p.Preview.Amount, "1.500") {
		t.Fatalf("preview = %+v", p.Preview)
	}
	res, err := tool.Run(context.Background(), loyaltyEnv(), p.Input)
	if err != nil || res.IsError || f.sold == nil || f.sold.Method != "card" || f.sold.FinanceAccountUUID == nil {
		t.Fatalf("run = %+v %v sold %+v", res, err, f.sold)
	}
	if res.Link == nil || res.Link.Kind != "customer_package" {
		t.Fatalf("link = %+v", res.Link)
	}

	// Unknown package lists the available ones; cari needs no account.
	raw, _ = json.Marshal(map[string]any{"customer_uuid": f.customer.UUID.String(), "package": "yok böyle"})
	if _, err := tool.Propose(context.Background(), loyaltyEnv(), raw); err == nil || !strings.Contains(err.Error(), "available") {
		t.Fatalf("unknown package = %v", err)
	}
	raw, _ = json.Marshal(map[string]any{"customer_uuid": f.customer.UUID.String(), "package": f.pkgs[1].UUID.String(), "payment_method": "cari"})
	p, err = tool.Propose(context.Background(), loyaltyEnv(), raw)
	if err != nil {
		t.Fatal(err)
	}
	in = sellPackageInput{}
	_ = json.Unmarshal(p.Input, &in)
	if in.FinanceAccount != "" {
		t.Fatalf("cari sale with an account: %+v", in)
	}
}

func TestLoyaltyToolsRespectPlanToggle(t *testing.T) {
	w, f := loyaltyWorld(t)
	f.off = true
	raw, _ := json.Marshal(map[string]any{"customer_uuid": f.customer.UUID.String(), "package": "10 yıkama"})
	_, err := SellPackage{loyalty: f, finance: fakeFinanceW{w: w}}.Propose(context.Background(), loyaltyEnv(), raw)
	if _, ok := AsInputError(err); !ok || !strings.Contains(err.Error(), "plan") {
		t.Fatalf("propose with module off = %v", err)
	}
	res, err := GetCustomerLoyalty{loyalty: f}.Run(context.Background(), loyaltyEnv(), json.RawMessage(`{"customer_uuid":"`+f.customer.UUID.String()+`"}`))
	if err != nil || !res.IsError {
		t.Fatalf("read with module off = %+v %v", res, err)
	}
	for _, tool := range []interface{ Entitlement() string }{GetCustomerLoyalty{}, ListLoyaltyPrograms{}, SellPackage{}, RedeemReward{}} {
		if tool.Entitlement() != "loyalty.enabled" {
			t.Fatalf("entitlement = %s", tool.Entitlement())
		}
	}
}

func TestRedeemRewardPicksBestMatchingOption(t *testing.T) {
	w, f := loyaltyWorld(t)
	c := w.custs[f.customer.UUID]
	job := w.addJob(c, "in_progress", "unpaid", "800.00")
	line1, line2 := uuid.New(), uuid.New()
	pkg, camp := uuid.New(), uuid.New()
	left := int64(4)
	f.options = []loyaltyusecase.Option{
		{Kind: "package", SourceUUID: pkg, SourceName: "5'li paket", LineUUID: line1, LineName: "İç Dış Yıkama", Units: 1, DiscountAmount: "500.00", Remaining: &left},
		{Kind: "reward", SourceUUID: camp, SourceName: "10 yıkama 1 bedava", LineUUID: line2, LineName: "Dış Yıkama", Units: 1, DiscountAmount: "300.00"},
	}
	tool := RedeemReward{loyalty: f, jobs: fakeJobsW{w: w}}

	raw, _ := json.Marshal(map[string]any{"plate": "34ak34"})
	p, err := tool.Propose(context.Background(), loyaltyEnv(), raw)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	var in redeemRewardInput
	_ = json.Unmarshal(p.Input, &in)
	if in.Kind != "package" || in.LineUUID != line1.String() || in.JobUUID != job.UUID.String() || len(w.writes) != 0 {
		t.Fatalf("best pick = %+v writes %v", in, w.writes)
	}
	raw, _ = json.Marshal(map[string]any{"job_uuid": job.UUID.String(), "kind": "reward"})
	if p, err = tool.Propose(context.Background(), loyaltyEnv(), raw); err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(p.Input, &in)
	if in.SourceUUID != camp.String() || in.LineUUID != line2.String() {
		t.Fatalf("reward pick = %+v", in)
	}
	res, err := tool.Run(context.Background(), loyaltyEnv(), p.Input)
	if err != nil || res.IsError || f.applied == nil || f.applied.Kind != "reward" || f.applied.LineUUID != line2 {
		t.Fatalf("run = %+v %v applied %+v", res, err, f.applied)
	}
	// Subscription asked but none applies.
	raw, _ = json.Marshal(map[string]any{"job_uuid": job.UUID.String(), "kind": "subscription"})
	if _, err := tool.Propose(context.Background(), loyaltyEnv(), raw); err == nil {
		t.Fatal("no subscription option must fail")
	}
	// A paid job is refused.
	f.editable = false
	raw, _ = json.Marshal(map[string]any{"job_uuid": job.UUID.String()})
	if _, err := tool.Propose(context.Background(), loyaltyEnv(), raw); err == nil {
		t.Fatal("paid job must be refused")
	}
}

func TestLoyaltyReadTools(t *testing.T) {
	_, f := loyaltyWorld(t)
	res, err := GetCustomerLoyalty{loyalty: f}.Run(context.Background(), loyaltyEnv(), json.RawMessage(`{"customer_uuid":"`+f.customer.UUID.String()+`"}`))
	if err != nil || res.IsError {
		t.Fatalf("get = %+v %v", res, err)
	}
	for _, want := range []string{"rewards_available", "uses_left_this_period", "remaining"} {
		if !strings.Contains(res.Content, want) {
			t.Errorf("result misses %s: %s", want, res.Content)
		}
	}
	res, err = GetCustomerLoyalty{loyalty: f}.Run(context.Background(), loyaltyEnv(), json.RawMessage(`{"customer_uuid":"`+uuid.NewString()+`"}`))
	if err != nil || !res.IsError {
		t.Fatalf("unknown customer = %+v %v", res, err)
	}
	res, err = ListLoyaltyPrograms{loyalty: f}.Run(context.Background(), loyaltyEnv(), json.RawMessage(`{}`))
	if err != nil || res.IsError || !strings.Contains(res.Content, "package_uuid") || !strings.Contains(res.Content, "plans") {
		t.Fatalf("programs = %+v %v", res, err)
	}
}
