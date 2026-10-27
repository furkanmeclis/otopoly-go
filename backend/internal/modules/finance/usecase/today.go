package usecase

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bizclock"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// DefaultCurrency is the currency the day figures are reported in when the
// caller names none (organizations have no currency of their own yet).
const DefaultCurrency = "TRY"

// MaxSeriesDays bounds the daily series of DayMoney.
const MaxSeriesDays = 31

// Source buckets of the day's collections.
const (
	BucketJobs    = "jobs"
	BucketSales   = "sales"
	BucketCari    = "cari"
	BucketLoyalty = "loyalty"
	BucketManual  = "manual"
	BucketOther   = "other"
)

// SourceBucket maps a finance_transactions.source_type to the collection
// bucket shown to people ("" and "manual" are manual entries).
func SourceBucket(sourceType string) string {
	switch strings.TrimSpace(sourceType) {
	case SourceServiceJob:
		return BucketJobs
	case SourceProductSale:
		return BucketSales
	case SourceCariPayment:
		return BucketCari
	case "loyalty_package", "loyalty_subscription":
		return BucketLoyalty
	case "", "manual":
		return BucketManual
	default:
		return BucketOther
	}
}

// MethodTotals splits a total by payment method.
type MethodTotals struct {
	Cash     string `json:"cash"`
	Card     string `json:"card"`
	Transfer string `json:"transfer"`
	Other    string `json:"other"`
}

// SourceTotals splits the collections by where the money came from.
type SourceTotals struct {
	Jobs    string `json:"jobs"`
	Sales   string `json:"sales"`
	Cari    string `json:"cari"`
	Loyalty string `json:"loyalty"`
	Manual  string `json:"manual"`
	Other   string `json:"other"`
}

// DayTotal is one business day of the series.
type DayTotal struct {
	Date      string `json:"date"`
	Collected string `json:"collected_total"`
	Expense   string `json:"expense_total"`
}

// AccountBalance is one active cash / bank account.
type AccountBalance struct {
	UUID      uuid.UUID `json:"uuid"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Currency  string    `json:"currency"`
	Balance   string    `json:"balance"`
	IsDefault bool      `json:"is_default"`
}

// TodayMoney is a business day's money in and out ("tahsilat").
//
// CollectedTotal is every posted income row of the day in the ledger: job
// payments taken in cash or by card, product sales, cari collections,
// package and subscription sales and manual income entries. Transfers
// between accounts and voided rows never count, and a job closed on cari is
// a receivable (no income row) until the cari collection posts one, so
// nothing is counted twice. It is the same basis as the finance summary
// (GET /v1/tenant/finance/summary) for that day.
type TodayMoney struct {
	Date           string           `json:"date"`
	Currency       string           `json:"currency"`
	CollectedTotal string           `json:"collected_total"`
	CollectedCount int64            `json:"collected_count"`
	ByMethod       MethodTotals     `json:"by_method"`
	BySource       SourceTotals     `json:"by_source"`
	ExpenseTotal   string           `json:"expense_total"`
	Net            string           `json:"net"`
	Series         []DayTotal       `json:"series"`
	Accounts       []AccountBalance `json:"accounts"`
}

// DayMoneyStore is what DayMoney reads (*db.Queries satisfies it).
type DayMoneyStore interface {
	FinanceDayIncomeBreakdown(ctx context.Context, arg db.FinanceDayIncomeBreakdownParams) ([]db.FinanceDayIncomeBreakdownRow, error)
	FinanceDailyIncomeExpense(ctx context.Context, arg db.FinanceDailyIncomeExpenseParams) ([]db.FinanceDailyIncomeExpenseRow, error)
	ListFinanceAccountBalances(ctx context.Context, arg db.ListFinanceAccountBalancesParams) ([]db.ListFinanceAccountBalancesRow, error)
}

// DayMoneyOptions tunes DayMoney.
type DayMoneyOptions struct {
	// Currency of the figures (default TRY); rows in other currencies are left out.
	Currency string
	// SeriesDays is how many days the series covers, ending on the day (0 = none).
	SeriesDays int
	// Accounts caps the account balances returned (0 = none).
	Accounts int
}

// DayMoney computes the money of one business day of an organization. day
// is any instant of that day; the day is taken in Europe/Istanbul.
func DayMoney(ctx context.Context, q DayMoneyStore, orgID int64, day time.Time, opt DayMoneyOptions) (TodayMoney, error) {
	currency := strings.ToUpper(strings.TrimSpace(opt.Currency))
	if currency == "" {
		currency = DefaultCurrency
	}
	date := bizclock.DateOf(day)
	out := TodayMoney{Date: date.Time.Format(bizclock.DayLayout), Currency: currency, Series: []DayTotal{}, Accounts: []AccountBalance{}}

	rows, err := q.FinanceDayIncomeBreakdown(ctx, db.FinanceDayIncomeBreakdownParams{OrganizationID: orgID, Currency: currency, Day: date})
	if err != nil {
		return TodayMoney{}, err
	}
	var total big.Rat
	methods := map[string]*big.Rat{}
	sources := map[string]*big.Rat{}
	add := func(m map[string]*big.Rat, key string, v *big.Rat) {
		if m[key] == nil {
			m[key] = new(big.Rat)
		}
		m[key].Add(m[key], v)
	}
	for _, r := range rows {
		v := ratFromNumeric(r.Total)
		total.Add(&total, v)
		out.CollectedCount += r.Count
		method := r.PaymentMethod
		switch method {
		case "cash", "card", "transfer":
		default:
			method = "other"
		}
		add(methods, method, v)
		add(sources, SourceBucket(r.SourceType), v)
	}
	s := func(m map[string]*big.Rat, key string) string { return ratString(m[key]) }
	out.CollectedTotal = ratString(&total)
	out.ByMethod = MethodTotals{Cash: s(methods, "cash"), Card: s(methods, "card"), Transfer: s(methods, "transfer"), Other: s(methods, "other")}
	out.BySource = SourceTotals{
		Jobs: s(sources, BucketJobs), Sales: s(sources, BucketSales), Cari: s(sources, BucketCari),
		Loyalty: s(sources, BucketLoyalty), Manual: s(sources, BucketManual), Other: s(sources, BucketOther),
	}

	days := opt.SeriesDays
	if days < 1 {
		days = 1
	}
	if days > MaxSeriesDays {
		days = MaxSeriesDays
	}
	from := pgtype.Date{Time: date.Time.AddDate(0, 0, -(days - 1)), Valid: true}
	daily, err := q.FinanceDailyIncomeExpense(ctx, db.FinanceDailyIncomeExpenseParams{OrganizationID: orgID, Currency: currency, DateFrom: from, DateTo: date})
	if err != nil {
		return TodayMoney{}, err
	}
	income := map[string]string{}
	expense := map[string]string{}
	for _, r := range daily {
		key := r.TransactionDate.Time.Format(bizclock.DayLayout)
		if r.Type == "income" {
			income[key] = numericToString(r.Total)
		} else {
			expense[key] = numericToString(r.Total)
		}
	}
	out.ExpenseTotal = orZero(expense[out.Date])
	out.Net = subtractAmountStrings(out.CollectedTotal, out.ExpenseTotal)
	if opt.SeriesDays > 0 {
		for i := 0; i < days; i++ {
			key := from.Time.AddDate(0, 0, i).Format(bizclock.DayLayout)
			out.Series = append(out.Series, DayTotal{Date: key, Collected: orZero(income[key]), Expense: orZero(expense[key])})
		}
	}

	if opt.Accounts > 0 {
		accs, err := q.ListFinanceAccountBalances(ctx, db.ListFinanceAccountBalancesParams{OrganizationID: orgID, LimitCount: int32(opt.Accounts)})
		if err != nil {
			return TodayMoney{}, err
		}
		for _, a := range accs {
			if !strings.EqualFold(a.Currency, currency) {
				continue
			}
			out.Accounts = append(out.Accounts, AccountBalance{
				UUID: a.Uuid, Name: a.Name, Type: a.Type, Currency: a.Currency,
				Balance: numericToString(a.CurrentBalance), IsDefault: a.IsDefault,
			})
		}
	}
	return out, nil
}

// Today is DayMoney for the caller's organization. date is YYYY-MM-DD
// (default: today in Europe/Istanbul); days is the length of the series.
func (s *Service) Today(ctx context.Context, date, currency string, days int) (TodayMoney, error) {
	orgID := orgctx.MustScope(ctx).InternalID
	day := s.now()
	if strings.TrimSpace(date) != "" {
		start, _, err := bizclock.ParseDay(date)
		if err != nil {
			return TodayMoney{}, fmt.Errorf("%w: date must be YYYY-MM-DD", ErrInvalidRequest)
		}
		day = start
	}
	if days < 0 || days > MaxSeriesDays {
		return TodayMoney{}, fmt.Errorf("%w: days must be between 0 and %d", ErrInvalidRequest, MaxSeriesDays)
	}
	return DayMoney(ctx, s.q, orgID, day, DayMoneyOptions{Currency: currency, SeriesDays: days, Accounts: 20})
}

func ratString(r *big.Rat) string {
	if r == nil {
		return "0.00"
	}
	return r.FloatString(2)
}

func orZero(v string) string {
	if v == "" {
		return "0.00"
	}
	return v
}
