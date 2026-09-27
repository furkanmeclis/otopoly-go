package pricing

import (
	"fmt"
	"math"
	"math/big"
	"sort"
	"strings"
	"time"
)

type Money = *big.Rat

type Current struct {
	PlanID        int64
	PlanRank      string
	Period        string
	Status        string
	StartsAt      time.Time
	EndsAt        time.Time
	PricePaid     string
	CreditBalance string
}

type Target struct {
	PlanID    int64
	PlanName  string
	PlanRank  string
	Period    string
	ListPrice string
}

type Discount struct {
	Code  string
	Kind  string
	Value string
}

type CustomOption struct {
	Key       string
	Label     string
	Unit      string
	Min       int64
	Max       int64
	Step      int64
	UnitPrice string
}

type CustomError struct {
	Field   string
	Message string
}

func (e CustomError) Error() string {
	if e.Field == "" {
		return e.Message
	}
	return e.Field + ": " + e.Message
}

type YearlyRule struct {
	Kind          string
	FixedPrice    string
	DiscountValue string
}

type Labels struct {
	Plan      string
	Proration string
	Discount  string
	Credit    string
	// Periods maps monthly/yearly to display names; missing keys print the code.
	Periods map[string]string
}

func (l Labels) period(code string) string {
	if name, ok := l.Periods[code]; ok {
		return name
	}
	return code
}

type Input struct {
	Now      time.Time
	Loc      *time.Location
	Current  *Current
	Target   Target
	Discount *Discount
	VATRate  int
	Labels   Labels
}

type Line struct {
	Kind   string
	Label  string
	Amount string
}

type Quote struct {
	Kind            string
	StartsAt        time.Time
	EndsAt          time.Time
	ListPrice       string
	ProrationCredit string
	DiscountAmount  string
	CreditApplied   string
	CreditSurplus   string
	Total           string
	VATAmount       string
	Lines           []Line
}

func Parse(raw string) (Money, error) {
	r, ok := new(big.Rat).SetString(raw)
	if !ok {
		return nil, fmt.Errorf("invalid money %q", raw)
	}
	return r, nil
}

func Format(m Money) string {
	return Round2(m).FloatString(2)
}

func ValidateCustom(opts []CustomOption, sel map[string]int64) (map[string]int64, error) {
	byKey := make(map[string]CustomOption, len(opts))
	for _, opt := range opts {
		if opt.Key == "" {
			continue
		}
		if opt.Step <= 0 {
			return nil, CustomError{Field: opt.Key, Message: "step must be positive"}
		}
		if opt.Min > opt.Max {
			return nil, CustomError{Field: opt.Key, Message: "min must be less than or equal to max"}
		}
		byKey[opt.Key] = opt
	}
	for key := range sel {
		if _, ok := byKey[key]; !ok {
			return nil, CustomError{Field: key, Message: "unknown custom feature"}
		}
	}
	out := make(map[string]int64, len(byKey))
	keys := make([]string, 0, len(byKey))
	for key := range byKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		opt := byKey[key]
		value, ok := sel[key]
		if !ok {
			value = opt.Min
		}
		if value < opt.Min {
			return nil, CustomError{Field: key, Message: "value is below min"}
		}
		if value > opt.Max {
			return nil, CustomError{Field: key, Message: "value is above max"}
		}
		if (value-opt.Min)%opt.Step != 0 {
			return nil, CustomError{Field: key, Message: "value does not match step"}
		}
		out[key] = value
	}
	return out, nil
}

func CustomMonthly(base string, opts []CustomOption, sel map[string]int64) (string, error) {
	total, err := parseNonNegative(base)
	if err != nil {
		return "", err
	}
	values, err := ValidateCustom(opts, sel)
	if err != nil {
		return "", err
	}
	for _, opt := range opts {
		unitPrice, err := parseNonNegative(opt.UnitPrice)
		if err != nil {
			return "", err
		}
		steps := (values[opt.Key] - opt.Min) / opt.Step
		total.Add(total, new(big.Rat).Mul(big.NewRat(steps, 1), unitPrice))
	}
	return Format(total), nil
}

func CustomMonthlyExtra(opts []CustomOption, sel map[string]int64) (string, error) {
	return CustomMonthly("0.00", opts, sel)
}

func CustomYearly(rule YearlyRule, monthlyExtra string, base string) string {
	extra, err := parseNonNegative(monthlyExtra)
	if err != nil {
		return "0.00"
	}
	monthly, err := parseNonNegative(base)
	if err != nil {
		return "0.00"
	}
	switch rule.Kind {
	case "fixed":
		fixed, err := parseNonNegative(rule.FixedPrice)
		if err != nil {
			return "0.00"
		}
		fixed.Add(fixed, new(big.Rat).Mul(extra, big.NewRat(12, 1)))
		return Format(fixed)
	case "discount_amount":
		discount, err := parseNonNegative(rule.DiscountValue)
		if err != nil {
			return "0.00"
		}
		total := new(big.Rat).Mul(new(big.Rat).Add(monthly, extra), big.NewRat(12, 1))
		total.Sub(total, discount)
		return Format(maxRat(total, zero()))
	case "discount_percent":
		pct, err := parseNonNegative(rule.DiscountValue)
		if err != nil {
			return "0.00"
		}
		total := new(big.Rat).Mul(new(big.Rat).Add(monthly, extra), big.NewRat(12, 1))
		factor := new(big.Rat).Sub(big.NewRat(1, 1), new(big.Rat).Quo(pct, big.NewRat(100, 1)))
		total.Mul(total, factor)
		return Format(maxRat(total, zero()))
	default:
		return "0.00"
	}
}

func Round2(m Money) Money {
	if m == nil {
		return new(big.Rat)
	}
	scaled := new(big.Rat).Mul(m, big.NewRat(100, 1))
	if scaled.Sign() >= 0 {
		scaled.Add(scaled, big.NewRat(1, 2))
	} else {
		scaled.Sub(scaled, big.NewRat(1, 2))
	}
	out := new(big.Int).Quo(scaled.Num(), scaled.Denom())
	return new(big.Rat).SetFrac(out, big.NewInt(100))
}

func Compute(in Input) (Quote, error) {
	loc := in.Loc
	if loc == nil {
		loc = time.UTC
	}
	now := in.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.In(loc)

	listPrice, err := parseNonNegative(in.Target.ListPrice)
	if err != nil {
		return Quote{}, err
	}
	listPrice = Round2(listPrice)

	kind, err := quoteKind(in.Current, in.Target)
	if err != nil {
		return Quote{}, err
	}
	startsAt := now
	if kind == "renew" && in.Current != nil && in.Current.EndsAt.After(now) {
		startsAt = in.Current.EndsAt.In(loc)
	}
	endsAt := PeriodEnd(startsAt, in.Target.Period, loc)

	prorationCredit, prorationDays, err := computeProration(in.Current, kind, now)
	if err != nil {
		return Quote{}, err
	}
	base := maxRat(new(big.Rat).Sub(listPrice, prorationCredit), zero())
	surplusFromProration := maxRat(new(big.Rat).Sub(prorationCredit, listPrice), zero())

	discountAmount, err := computeDiscount(base, in.Discount)
	if err != nil {
		return Quote{}, err
	}
	afterDiscount := maxRat(new(big.Rat).Sub(base, discountAmount), zero())

	creditBalance, err := currentCreditBalance(in.Current)
	if err != nil {
		return Quote{}, err
	}
	creditApplied := minRat(creditBalance, afterDiscount)
	total := maxRat(new(big.Rat).Sub(afterDiscount, creditApplied), zero())
	creditSurplus := new(big.Rat).Add(surplusFromProration, new(big.Rat).Sub(creditBalance, creditApplied))
	vatAmount := computeVAT(total, in.VATRate)

	q := Quote{
		Kind:            kind,
		StartsAt:        startsAt,
		EndsAt:          endsAt,
		ListPrice:       Format(listPrice),
		ProrationCredit: Format(prorationCredit),
		DiscountAmount:  Format(discountAmount),
		CreditApplied:   Format(creditApplied),
		CreditSurplus:   Format(creditSurplus),
		Total:           Format(total),
		VATAmount:       Format(vatAmount),
		Lines:           buildLines(in, listPrice, prorationCredit, discountAmount, creditApplied, prorationDays),
	}
	return q, nil
}

func PeriodEnd(start time.Time, period string, loc *time.Location) time.Time {
	if loc == nil {
		loc = time.UTC
	}
	local := start.In(loc)
	if period == "yearly" {
		return local.AddDate(1, 0, 0)
	}
	return local.AddDate(0, 1, 0)
}

func quoteKind(current *Current, target Target) (string, error) {
	if current == nil || current.Status == "trial" {
		return "new", nil
	}
	if current.PlanID == target.PlanID && current.Period == target.Period {
		return "renew", nil
	}
	if current.PlanID == target.PlanID {
		return "period_change", nil
	}
	currentRank, err := parseNonNegative(current.PlanRank)
	if err != nil {
		return "", err
	}
	targetRank, err := parseNonNegative(target.PlanRank)
	if err != nil {
		return "", err
	}
	if targetRank.Cmp(currentRank) > 0 {
		return "upgrade", nil
	}
	return "downgrade", nil
}

func computeProration(current *Current, kind string, now time.Time) (Money, int, error) {
	if current == nil || kind == "new" || kind == "renew" {
		return zero(), 0, nil
	}
	if current.Status != "active" && current.Status != "grace" {
		return zero(), 0, nil
	}
	pricePaid, err := parseNonNegative(current.PricePaid)
	if err != nil {
		return nil, 0, err
	}
	if pricePaid.Sign() == 0 || !current.EndsAt.After(now) || !current.EndsAt.After(current.StartsAt) {
		return zero(), 0, nil
	}
	remaining := current.EndsAt.Sub(now)
	total := current.EndsAt.Sub(current.StartsAt)
	ratio := big.NewRat(int64(remaining), int64(total))
	if ratio.Sign() < 0 {
		ratio = zero()
	}
	if ratio.Cmp(big.NewRat(1, 1)) > 0 {
		ratio = big.NewRat(1, 1)
	}
	days := int(math.Ceil(remaining.Hours() / 24))
	return Round2(new(big.Rat).Mul(pricePaid, ratio)), days, nil
}

func computeDiscount(base Money, discount *Discount) (Money, error) {
	if discount == nil || base.Sign() == 0 {
		return zero(), nil
	}
	value, err := parseNonNegative(discount.Value)
	if err != nil {
		return nil, err
	}
	var amount Money
	switch discount.Kind {
	case "percent":
		amount = new(big.Rat).Mul(base, new(big.Rat).Quo(value, big.NewRat(100, 1)))
	case "amount":
		amount = value
	default:
		return nil, fmt.Errorf("invalid discount kind %q", discount.Kind)
	}
	return Round2(minRat(amount, base)), nil
}

func currentCreditBalance(current *Current) (Money, error) {
	if current == nil {
		return zero(), nil
	}
	return parseNonNegative(current.CreditBalance)
}

func computeVAT(total Money, rate int) Money {
	if total.Sign() == 0 || rate <= 0 {
		return zero()
	}
	divisor := new(big.Rat).Add(big.NewRat(1, 1), big.NewRat(int64(rate), 100))
	net := new(big.Rat).Quo(total, divisor)
	return Round2(new(big.Rat).Sub(total, net))
}

func buildLines(
	in Input,
	listPrice Money,
	prorationCredit Money,
	discountAmount Money,
	creditApplied Money,
	prorationDays int,
) []Line {
	lines := []Line{}
	if listPrice.Sign() > 0 {
		lines = append(lines, Line{
			Kind:   "plan",
			Label:  planLabel(defaultLabel(in.Labels.Plan, "%s (%s)"), in.Target.PlanName, in.Labels.period(in.Target.Period)),
			Amount: Format(listPrice),
		})
	}
	if shownProration := minRat(prorationCredit, listPrice); shownProration.Sign() > 0 {
		lines = append(lines, Line{
			Kind:   "proration",
			Label:  fmt.Sprintf(defaultLabel(in.Labels.Proration, "Kıst iadesi (%s, %d gün)"), in.Labels.period(currentPeriod(in)), prorationDays),
			Amount: "-" + Format(shownProration),
		})
	}
	if discountAmount.Sign() > 0 && in.Discount != nil {
		lines = append(lines, Line{
			Kind:   "discount",
			Label:  fmt.Sprintf(defaultLabel(in.Labels.Discount, "İndirim kodu %s"), in.Discount.Code),
			Amount: "-" + Format(discountAmount),
		})
	}
	if creditApplied.Sign() > 0 {
		lines = append(lines, Line{
			Kind:   "credit",
			Label:  defaultLabel(in.Labels.Credit, "Alacak bakiyesi"),
			Amount: "-" + Format(creditApplied),
		})
	}
	return lines
}

func parseNonNegative(raw string) (Money, error) {
	if raw == "" {
		raw = "0"
	}
	r, err := Parse(raw)
	if err != nil {
		return nil, err
	}
	if r.Sign() < 0 {
		return nil, fmt.Errorf("negative money %q", raw)
	}
	return r, nil
}

func minRat(a, b Money) Money {
	if a.Cmp(b) <= 0 {
		return new(big.Rat).Set(a)
	}
	return new(big.Rat).Set(b)
}

func maxRat(a, b Money) Money {
	if a.Cmp(b) >= 0 {
		return new(big.Rat).Set(a)
	}
	return new(big.Rat).Set(b)
}

func zero() Money {
	return new(big.Rat)
}

func defaultLabel(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func currentPeriod(in Input) string {
	if in.Current != nil {
		return in.Current.Period
	}
	return in.Target.Period
}

// planLabel fills a plan label format that may take the plan name only
// ("%s", used for pre-built enterprise labels) or name and period ("%s (%s)").
func planLabel(format, name, period string) string {
	switch strings.Count(format, "%s") {
	case 0:
		return format
	case 1:
		return fmt.Sprintf(format, name)
	default:
		return fmt.Sprintf(format, name, period)
	}
}
