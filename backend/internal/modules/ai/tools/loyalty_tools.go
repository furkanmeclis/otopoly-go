package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	loyaltyusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/loyalty/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bizclock"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// LoyaltyFeature is the plan toggle of the loyalty tools (MCP filters by it;
// the tools also check it).
const LoyaltyFeature = loyaltyusecase.FeatureKey

// LoyaltyService is the loyalty use case as seen by the assistant.
type LoyaltyService interface {
	CheckEnabled(ctx context.Context) error
	CustomerRef(ctx context.Context, customerUUID uuid.UUID) (loyaltyusecase.Ref, error)
	CustomerLoyalty(ctx context.Context, customerUUID uuid.UUID) (loyaltyusecase.CustomerLoyalty, error)
	ListCampaigns(ctx context.Context, f loyaltyusecase.ListFilter) ([]loyaltyusecase.Campaign, int64, error)
	ListPackages(ctx context.Context, f loyaltyusecase.ListFilter) ([]loyaltyusecase.Package, int64, error)
	ListPlans(ctx context.Context, f loyaltyusecase.ListFilter) ([]loyaltyusecase.Plan, int64, error)
	SellPackage(ctx context.Context, in loyaltyusecase.SellPackageInput) (loyaltyusecase.CustomerPackageDetail, error)
	JobLoyalty(ctx context.Context, jobUUID uuid.UUID) (loyaltyusecase.JobLoyalty, error)
	Apply(ctx context.Context, jobUUID uuid.UUID, in loyaltyusecase.ApplyInput) (loyaltyusecase.JobLoyalty, error)
}

const loyaltyOff = "the loyalty & packages module is not included in this organization's plan"

// loyaltyErr maps a plan refusal to a readable error.
func loyaltyErr(err error) error {
	if errors.Is(err, entitlements.ErrFeatureDisabled) {
		return inputErr(loyaltyOff)
	}
	return proposalError(err)
}

func loyaltyUserError(err error) (Result, error) {
	if errors.Is(err, entitlements.ErrFeatureDisabled) {
		return ErrorResult(loyaltyOff), nil
	}
	return userError(err)
}

func loyaltyExecError(err error) (Result, error) {
	if errors.Is(err, entitlements.ErrFeatureDisabled) {
		return ErrorResult("Not executed: " + loyaltyOff), nil
	}
	return execError(err)
}

// ---------------------------------------------------------------- read

// GetCustomerLoyalty returns a customer's stamps, packages and subscription.
type GetCustomerLoyalty struct{ loyalty LoyaltyService }

var getCustomerLoyaltySchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"customer_uuid": map[string]any{"type": "string", "format": "uuid", "description": "customer_uuid from search_customers."},
	},
	"required":             []string{"customer_uuid"},
	"additionalProperties": false,
}

// Entitlement implements mcp.Entitled.
func (GetCustomerLoyalty) Entitlement() string { return LoyaltyFeature }

// Spec implements Tool.
func (GetCustomerLoyalty) Spec() Spec {
	return Spec{
		Name: "get_customer_loyalty",
		Description: "A customer's loyalty: stamp cards (damga, progress and free rewards ready), prepaid packages with remaining " +
			"credits (paket, kalan hak) and subscriptions (abonelik: state, renewal date, uses left this period). " +
			"Use for \"kaç yıkaması kaldı\", \"bedava hakkı var mı\", \"aboneliği ne zaman yenileniyor\".",
		InputSchema: getCustomerLoyaltySchema,
		Permissions: []string{rbac.PermTenantLoyaltyRead, rbac.PermTenantCustomersRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

// Run implements Tool.
func (t GetCustomerLoyalty) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in struct {
		CustomerUUID string `json:"customer_uuid"`
	}
	if err := Decode(getCustomerLoyaltySchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	if err := t.loyalty.CheckEnabled(ctx); err != nil {
		return loyaltyUserError(err)
	}
	id, _ := uuid.Parse(in.CustomerUUID)
	cust, err := t.loyalty.CustomerRef(ctx, id)
	if err != nil {
		return loyaltyUserError(err)
	}
	cl, err := t.loyalty.CustomerLoyalty(ctx, id)
	if err != nil {
		return loyaltyUserError(err)
	}
	stamps := make([]map[string]any, 0, len(cl.Stamps))
	for _, c := range cl.Stamps {
		row := map[string]any{
			"campaign": DataText(c.CampaignName, maxTextChars), "campaign_uuid": c.CampaignUUID.String(),
			"stamps": c.Stamps, "stamps_required": c.StampsRequired, "rewards_available": c.RewardsAvailable,
			"reward_type": c.RewardType, "active": c.Active,
		}
		if c.RewardService != nil {
			row["reward_service"] = DataText(c.RewardService.Name, maxTextChars)
		} else {
			row["reward_value"] = c.RewardValue
		}
		stamps = append(stamps, row)
	}
	packages := make([]map[string]any, 0, len(cl.Packages))
	for _, p := range cl.Packages {
		credits := make([]map[string]any, 0, len(p.Credits))
		for _, c := range p.Credits {
			credits = append(credits, map[string]any{"service": DataText(c.ServiceName, maxTextChars), "remaining": c.Remaining, "total": c.Total})
		}
		row := map[string]any{"package": DataText(p.Name, maxTextChars), "customer_package_uuid": p.UUID.String(), "credits": credits}
		if p.ExpiresAt != nil {
			// expires_at is the exclusive end (midnight Europe/Istanbul);
			// report the last valid business day.
			row["expires"] = bizclock.FormatDay(p.ExpiresAt.Add(-time.Nanosecond))
		}
		packages = append(packages, row)
	}
	subs := make([]map[string]any, 0, len(cl.Subscriptions))
	for _, s := range cl.Subscriptions {
		row := map[string]any{
			"plan": DataText(s.Name, maxTextChars), "subscription_uuid": s.UUID.String(), "state": s.State,
			"renewal_date": s.RenewalDate, "price": FormatMoney(s.Price, s.Currency),
		}
		if s.CurrentPeriod != nil {
			if s.CurrentPeriod.Remaining != nil {
				row["uses_left_this_period"] = *s.CurrentPeriod.Remaining
			} else {
				row["uses_left_this_period"] = "unlimited"
			}
		}
		if s.Plate != nil {
			row["plate"] = *s.Plate
		}
		subs = append(subs, row)
	}
	out := map[string]any{
		"customer": DataText(cust.Name, maxTextChars), "rewards_available": cl.RewardsAvailable,
		"stamps": stamps, "packages": packages, "subscriptions": subs,
	}
	return JSONResult(out, "ai.tool_summary.loyalty_found", map[string]any{"name": cust.Name}), nil
}

// ListLoyaltyPrograms lists the organization's campaigns, package
// definitions and subscription plans.
type ListLoyaltyPrograms struct{ loyalty LoyaltyService }

var listLoyaltyProgramsSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"kind":        map[string]any{"type": "string", "enum": []string{"all", "campaigns", "packages", "plans"}, "description": "Default all."},
		"active_only": map[string]any{"type": "boolean", "description": "Default true."},
	},
	"additionalProperties": false,
}

// Entitlement implements mcp.Entitled.
func (ListLoyaltyPrograms) Entitlement() string { return LoyaltyFeature }

// Spec implements Tool.
func (ListLoyaltyPrograms) Spec() Spec {
	return Spec{
		Name: "list_loyalty_programs",
		Description: "List loyalty programs: stamp campaigns (\"10 yıkama 1 bedava\"), prepaid packages for sale (paketler, " +
			"package_uuid for sell_package) and subscription plans (abonelik planları).",
		InputSchema: listLoyaltyProgramsSchema,
		Permissions: []string{rbac.PermTenantLoyaltyRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

// Run implements Tool.
func (t ListLoyaltyPrograms) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Kind       string `json:"kind"`
		ActiveOnly *bool  `json:"active_only"`
	}
	if err := Decode(listLoyaltyProgramsSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	if err := t.loyalty.CheckEnabled(ctx); err != nil {
		return loyaltyUserError(err)
	}
	f := loyaltyusecase.ListFilter{Limit: 50}
	if in.ActiveOnly == nil || *in.ActiveOnly {
		on := true
		f.IsActive = &on
	}
	kind := in.Kind
	if kind == "" {
		kind = "all"
	}
	out := map[string]any{}
	count := 0
	if kind == "all" || kind == "campaigns" {
		rows, _, err := t.loyalty.ListCampaigns(ctx, f)
		if err != nil {
			return loyaltyUserError(err)
		}
		list := make([]map[string]any, 0, len(rows))
		for _, c := range rows {
			row := map[string]any{
				"campaign_uuid": c.UUID.String(), "name": DataText(c.Name, maxTextChars), "stamps_required": c.StampsRequired,
				"reward_type": c.RewardType, "active": c.IsActive, "services": refNames(c.Services), "categories": refNames(c.Categories),
			}
			if c.RewardService != nil {
				row["reward_service"] = DataText(c.RewardService.Name, maxTextChars)
			} else {
				row["reward_value"] = c.RewardValue
			}
			list = append(list, row)
		}
		out["campaigns"], count = list, count+len(list)
	}
	if kind == "all" || kind == "packages" {
		rows, _, err := t.loyalty.ListPackages(ctx, f)
		if err != nil {
			return loyaltyUserError(err)
		}
		list := make([]map[string]any, 0, len(rows))
		for _, p := range rows {
			items := make([]string, 0, len(p.Items))
			for _, it := range p.Items {
				items = append(items, DataText(it.ServiceName, maxTextChars)+" x"+itoa(int64(it.Quantity)))
			}
			row := map[string]any{
				"package_uuid": p.UUID.String(), "name": DataText(p.Name, maxTextChars), "price": FormatMoney(p.Price, p.Currency),
				"price_number": Number(p.Price), "items": items, "active": p.IsActive, "sold": p.SoldCount,
			}
			if p.ValidityDays != nil {
				row["validity_days"] = *p.ValidityDays
			}
			list = append(list, row)
		}
		out["packages"], count = list, count+len(list)
	}
	if kind == "all" || kind == "plans" {
		rows, _, err := t.loyalty.ListPlans(ctx, f)
		if err != nil {
			return loyaltyUserError(err)
		}
		list := make([]map[string]any, 0, len(rows))
		for _, p := range rows {
			row := map[string]any{
				"plan_uuid": p.UUID.String(), "name": DataText(p.Name, maxTextChars), "price": FormatMoney(p.Price, p.Currency),
				"period_months": p.PeriodMonths, "active": p.IsActive, "active_subscriptions": p.ActiveCount,
				"services": refNames(p.Services), "categories": refNames(p.Categories),
			}
			if p.UsesPerPeriod != nil {
				row["uses_per_period"] = *p.UsesPerPeriod
			} else {
				row["uses_per_period"] = "unlimited"
			}
			list = append(list, row)
		}
		out["plans"], count = list, count+len(list)
	}
	return JSONResult(out, "ai.tool_summary.loyalty_programs_found", map[string]any{"count": count}), nil
}

func refNames(refs []loyaltyusecase.Ref) []string {
	out := make([]string, 0, len(refs))
	for _, r := range refs {
		out = append(out, DataText(r.Name, maxTextChars))
	}
	return out
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}

// ---------------------------------------------------------------- sell package

// SellPackage sells a prepaid package to a customer.
type SellPackage struct {
	loyalty LoyaltyService
	finance FinanceReader
}

var loyaltyPayMethods = []string{"cash", "card", "cari"}

var sellPackageSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"customer_uuid":   map[string]any{"type": "string", "format": "uuid", "description": "customer_uuid from search_customers."},
		"package":         map[string]any{"type": "string", "minLength": 1, "maxLength": 150, "description": "Package name or package_uuid from list_loyalty_programs."},
		"payment_method":  map[string]any{"type": "string", "enum": loyaltyPayMethods, "description": "cash (nakit, default), card (kart) or cari (veresiye: charged to the customer's account)."},
		"finance_account": map[string]any{"type": "string", "maxLength": 100, "description": "Cash/bank account name or uuid for cash/card. Omit for the default."},
		"notes":           map[string]any{"type": "string", "maxLength": 300},
	},
	"required":             []string{"customer_uuid", "package"},
	"additionalProperties": false,
}

type sellPackageInput struct {
	CustomerUUID   string `json:"customer_uuid"`
	Package        string `json:"package"`
	PaymentMethod  string `json:"payment_method,omitempty"`
	FinanceAccount string `json:"finance_account,omitempty"`
	Notes          string `json:"notes,omitempty"`
}

// Entitlement implements mcp.Entitled.
func (SellPackage) Entitlement() string { return LoyaltyFeature }

// Spec implements Tool.
func (SellPackage) Spec() Spec {
	return Spec{
		Name: "sell_package",
		Description: "Propose selling a prepaid package (paket satışı, e.g. \"10 yıkama paketi\") to a customer: the customer gets " +
			"the package's service credits and the price is taken in cash / card or charged to their cari account. " +
			"Shows a confirmation card; nothing changes until the user approves.",
		InputSchema: sellPackageSchema,
		Permissions: []string{rbac.PermTenantLoyaltyApply, rbac.PermTenantLoyaltyRead, rbac.PermTenantCustomersRead,
			rbac.PermTenantFinanceRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// Propose implements ActionTool.
func (t SellPackage) Propose(ctx context.Context, _ Env, raw json.RawMessage) (Proposal, error) {
	var in sellPackageInput
	if err := decodeInput(sellPackageSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	if err := t.loyalty.CheckEnabled(ctx); err != nil {
		return Proposal{}, loyaltyErr(err)
	}
	id, _ := uuid.Parse(in.CustomerUUID)
	cust, err := t.loyalty.CustomerRef(ctx, id)
	if err != nil {
		return Proposal{}, loyaltyErr(err)
	}
	on := true
	pkgs, _, err := t.loyalty.ListPackages(ctx, loyaltyusecase.ListFilter{IsActive: &on, Limit: 100})
	if err != nil {
		return Proposal{}, err
	}
	pkgName := func(p loyaltyusecase.Package) string { return p.Name }
	var pkg loyaltyusecase.Package
	if pid, err := uuid.Parse(strings.TrimSpace(in.Package)); err == nil {
		found := false
		for _, p := range pkgs {
			if p.UUID == pid {
				pkg, found = p, true
			}
		}
		if !found {
			return Proposal{}, inputErr("package %s not found or not active; available: %s", in.Package, names(pkgs, pkgName, 10))
		}
	} else {
		p, _, ok := matchByName(in.Package, pkgs, pkgName)
		if !ok {
			return Proposal{}, inputErr("package %q not found or ambiguous; available: %s", in.Package, names(pkgs, pkgName, 10))
		}
		pkg = p
	}
	if in.PaymentMethod == "" {
		in.PaymentMethod = "cash"
	}
	fields := []Field{
		{Key: "customer", Value: cust.Name},
		{Key: "package", Value: pkg.Name},
		{Key: "payment_method", ValueKey: "ai.confirm.values." + in.PaymentMethod},
	}
	items := make([]string, 0, len(pkg.Items))
	for _, it := range pkg.Items {
		items = append(items, it.ServiceName+" ×"+itoa(int64(it.Quantity)))
	}
	fields = append(fields, Field{Key: "credits", Value: strings.Join(items, ", ")})
	if pkg.ValidityDays != nil {
		fields = append(fields, Field{Key: "validity_days", Value: itoa(int64(*pkg.ValidityDays))})
	}
	edit := []EditField{{Key: "payment_method", Type: "select", Value: in.PaymentMethod, Options: methodOptions(loyaltyPayMethods), Required: true}}
	if in.PaymentMethod == "cari" {
		in.FinanceAccount = ""
	} else {
		accounts, err := activeAccounts(ctx, t.finance)
		if err != nil {
			return Proposal{}, err
		}
		fa, err := resolveAccount(accounts, in.FinanceAccount, pkg.Currency, preferredAccountType(in.PaymentMethod), "finance_account")
		if err != nil {
			return Proposal{}, err
		}
		in.FinanceAccount = fa.UUID.String()
		fields = append(fields, Field{Key: "finance_account", Value: fa.Name})
		edit = append(edit, EditField{Key: "finance_account", Type: "select", Value: in.FinanceAccount, Options: accountOptions(accounts, pkg.Currency)})
	}
	in.Package = pkg.UUID.String()
	in.CustomerUUID = cust.UUID.String()
	in.Notes = trimmed(in.Notes, 300)
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "sell_package", Title: cust.Name, Amount: FormatMoney(pkg.Price, pkg.Currency), Fields: fields, Edit: edit,
		},
	}, nil
}

// Run implements Tool.
func (t SellPackage) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in sellPackageInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	pkgID, _ := uuid.Parse(in.Package)
	custID, _ := uuid.Parse(in.CustomerUUID)
	sell := loyaltyusecase.SellPackageInput{PackageUUID: pkgID, CustomerUUID: custID, Method: in.PaymentMethod, Notes: in.Notes}
	if in.PaymentMethod != "cari" {
		fa, err := uuid.Parse(in.FinanceAccount)
		if err != nil {
			return ErrorResult("Not executed: finance_account is required for cash / card"), nil
		}
		sell.FinanceAccountUUID = &fa
	}
	if err := t.loyalty.CheckEnabled(ctx); err != nil {
		return loyaltyExecError(err)
	}
	cp, err := t.loyalty.SellPackage(ctx, sell)
	if err != nil {
		return loyaltyExecError(err)
	}
	credits := make([]map[string]any, 0, len(cp.Credits))
	for _, c := range cp.Credits {
		credits = append(credits, map[string]any{"service": DataText(c.ServiceName, maxTextChars), "credits": c.Total})
	}
	res := JSONResult(map[string]any{
		"done": true, "customer_package_uuid": cp.UUID.String(), "customer": DataText(cp.CustomerName, maxTextChars),
		"package": DataText(cp.Name, maxTextChars), "amount": FormatMoney(cp.Price, cp.Currency), "payment_method": cp.PaymentMethod,
		"credits": credits,
	}, "ai.tool_summary.package_sold", map[string]any{"name": cp.CustomerName, "package": cp.Name})
	res.Link = &Link{Kind: "customer_package", UUID: cp.UUID.String()}
	return res, nil
}

// ---------------------------------------------------------------- redeem

// RedeemReward covers a job line with a stamp reward, package credits or a
// subscription use.
type RedeemReward struct {
	loyalty LoyaltyService
	jobs    JobsWriter
}

var redeemRewardSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"job_uuid":    map[string]any{"type": "string", "format": "uuid", "description": "Open, unpaid job (list_jobs)."},
		"plate":       map[string]any{"type": "string", "maxLength": 16, "description": "Alternative to job_uuid: the open unpaid job of this plate."},
		"kind":        map[string]any{"type": "string", "enum": []string{"reward", "package", "subscription"}, "description": "reward (stamp campaign reward / bedava yıkama), package (paket hakkı) or subscription (abonelik). Omit to take the biggest saving."},
		"source":      map[string]any{"type": "string", "maxLength": 150, "description": "Optional campaign / package / subscription name or uuid."},
		"service":     map[string]any{"type": "string", "maxLength": 150, "description": "Optional job line (service name) to cover."},
		"source_uuid": map[string]any{"type": "string", "format": "uuid", "description": "Optional: source_uuid of an option (exact pick)."},
		"line_uuid":   map[string]any{"type": "string", "format": "uuid", "description": "Optional: job line uuid to cover (exact pick)."},
	},
	"additionalProperties": false,
}

type redeemRewardInput struct {
	JobUUID    string `json:"job_uuid,omitempty"`
	Plate      string `json:"plate,omitempty"`
	Kind       string `json:"kind,omitempty"`
	Source     string `json:"source,omitempty"`
	Service    string `json:"service,omitempty"`
	SourceUUID string `json:"source_uuid,omitempty"`
	LineUUID   string `json:"line_uuid,omitempty"`
}

// Entitlement implements mcp.Entitled.
func (RedeemReward) Entitlement() string { return LoyaltyFeature }

// Spec implements Tool.
func (RedeemReward) Spec() Spec {
	return Spec{
		Name: "redeem_reward",
		Description: "Propose using a customer's loyalty on an open, unpaid job: a stamp campaign reward (bedava yıkama / indirim), " +
			"prepaid package credits (paketten düş) or a subscription use (abonelikten). The covered line's price drops by the " +
			"covered amount; it can be reverted from the job. Shows a confirmation card.",
		InputSchema: redeemRewardSchema,
		Permissions: []string{rbac.PermTenantLoyaltyApply, rbac.PermTenantLoyaltyRead, rbac.PermTenantJobsWrite,
			rbac.PermTenantJobsRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// Propose implements ActionTool.
func (t RedeemReward) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in redeemRewardInput
	if err := decodeInput(redeemRewardSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	if err := t.loyalty.CheckEnabled(ctx); err != nil {
		return Proposal{}, loyaltyErr(err)
	}
	job, err := findJob(ctx, env, t.jobs, in.JobUUID, in.Plate, unpaidOpen, "open unpaid")
	if err != nil {
		return Proposal{}, err
	}
	view, err := t.loyalty.JobLoyalty(ctx, job.UUID)
	if err != nil {
		return Proposal{}, loyaltyErr(err)
	}
	if !view.Editable {
		return Proposal{}, inputErr("job %s is paid or closed; loyalty can only be used on an open, unpaid job", job.UUID)
	}
	if len(view.Options) == 0 {
		return Proposal{}, inputErr("nothing to apply: the customer has no reward, package credit or subscription use for this job's services")
	}
	var picks []loyaltyusecase.Option
	for _, o := range view.Options {
		if in.Kind != "" && o.Kind != in.Kind {
			continue
		}
		if s := strings.TrimSpace(in.Source); s != "" && s != o.SourceUUID.String() && !strings.Contains(FoldTR(o.SourceName), FoldTR(s)) {
			continue
		}
		if s := strings.TrimSpace(in.Service); s != "" && !strings.Contains(FoldTR(o.LineName), FoldTR(s)) {
			continue
		}
		if in.SourceUUID != "" && in.SourceUUID != o.SourceUUID.String() {
			continue
		}
		if in.LineUUID != "" && in.LineUUID != o.LineUUID.String() {
			continue
		}
		picks = append(picks, o)
	}
	if len(picks) == 0 {
		return Proposal{}, inputErr("no match; available: %s", names(view.Options, optionLabel, 10))
	}
	o := picks[0] // options come biggest saving first
	in.JobUUID, in.Plate = job.UUID.String(), ""
	in.Kind, in.SourceUUID, in.LineUUID = o.Kind, o.SourceUUID.String(), o.LineUUID.String()
	in.Source, in.Service = o.SourceName, o.LineName
	fields := []Field{
		{Key: "job", Value: job.Plate + " — " + job.CustomerName},
		{Key: "loyalty_kind", ValueKey: "ai.confirm.values.loyalty_" + o.Kind},
		{Key: "source", Value: o.SourceName},
		{Key: "line", Value: o.LineName},
	}
	if o.Kind != loyaltyusecase.KindReward {
		fields = append(fields, Field{Key: "units", Value: itoa(int64(o.Units))})
	}
	if o.Remaining != nil {
		fields = append(fields, Field{Key: "remaining_after", Value: itoa(*o.Remaining)})
	}
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "redeem_reward", Title: job.Plate, Amount: FormatMoney(o.DiscountAmount, job.Currency), Fields: fields,
		},
	}, nil
}

func optionLabel(o loyaltyusecase.Option) string {
	return o.Kind + ": " + o.SourceName + " → " + o.LineName + " (" + o.DiscountAmount + ")"
}

// Run implements Tool.
func (t RedeemReward) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in redeemRewardInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	jobID, _ := uuid.Parse(in.JobUUID)
	src, _ := uuid.Parse(in.SourceUUID)
	line, _ := uuid.Parse(in.LineUUID)
	if err := t.loyalty.CheckEnabled(ctx); err != nil {
		return loyaltyExecError(err)
	}
	view, err := t.loyalty.Apply(ctx, jobID, loyaltyusecase.ApplyInput{Kind: in.Kind, SourceUUID: src, LineUUID: line})
	if err != nil {
		return loyaltyExecError(err)
	}
	out := map[string]any{"done": true, "job_uuid": jobID.String(), "kind": in.Kind, "source": DataText(in.Source, maxTextChars),
		"line": DataText(in.Service, maxTextChars)}
	for _, a := range view.Applied {
		if a.LineUUID == line && a.Status == "applied" {
			out["covered"] = a.DiscountAmount
			out["application_uuid"] = a.UUID.String()
		}
	}
	if job, err := t.jobs.Get(ctx, jobID); err == nil {
		out["new_job_total"] = FormatMoney(job.TotalAmount, job.Currency)
	}
	res := JSONResult(out, "ai.tool_summary.loyalty_applied", map[string]any{"source": in.Source})
	res.Link = &Link{Kind: "job", UUID: jobID.String()}
	return res, nil
}

func registerLoyaltyTools(r *Registry, d Deps) {
	if d.Loyalty == nil {
		return
	}
	r.Register(GetCustomerLoyalty{loyalty: d.Loyalty})
	r.Register(ListLoyaltyPrograms{loyalty: d.Loyalty})
	if d.Finance != nil {
		r.Register(SellPackage{loyalty: d.Loyalty, finance: d.Finance})
	}
	if d.JobsWrite != nil {
		r.Register(RedeemReward{loyalty: d.Loyalty, jobs: d.JobsWrite})
	}
}
