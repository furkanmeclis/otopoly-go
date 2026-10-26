package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	catalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/catalog/usecase"
	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	reportsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reports/usecase"
	salesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/sales/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// Narrow service interfaces (satisfied by the existing module use cases).
type (
	CustomerSearchStore interface {
		AISearchCustomers(ctx context.Context, arg db.AISearchCustomersParams) ([]db.AISearchCustomersRow, error)
		AIFindCustomersByPhoneOrPlate(ctx context.Context, arg db.AIFindCustomersByPhoneOrPlateParams) ([]db.AIFindCustomersByPhoneOrPlateRow, error)
	}
	CustomerReader interface {
		List(ctx context.Context, limit, offset int32, filters customersusecase.Filters) ([]customersusecase.Customer, int64, error)
	}
	CariReader interface {
		Get(ctx context.Context, id uuid.UUID) (cariusecase.AccountDetail, error)
		GetByCustomer(ctx context.Context, customerUUID uuid.UUID) (cariusecase.AccountDetail, error)
		ListEntries(ctx context.Context, accountUUID uuid.UUID, limit, offset int32, filters cariusecase.EntryFilters) ([]cariusecase.Entry, int64, error)
	}
	JobsReader interface {
		List(ctx context.Context, limit, offset int32, filters jobsusecase.ListFilters) ([]jobsusecase.Job, int64, error)
		// SummaryIn takes day boundaries in loc (the assistant passes Europe/Istanbul).
		SummaryIn(ctx context.Context, dateStr string, loc *time.Location) (jobsusecase.Summary, error)
	}
	// UnpaidJobsReader lists a customer's unpaid jobs (not in the cari ledger).
	UnpaidJobsReader interface {
		UnpaidByCustomer(ctx context.Context, customerUUID uuid.UUID, limit int32) (jobsusecase.UnpaidJobs, error)
		UnpaidTotalsByCustomers(ctx context.Context, customerUUIDs []uuid.UUID) (map[uuid.UUID]jobsusecase.UnpaidTotal, error)
	}
	ReportsReader interface {
		Overview(ctx context.Context, in reportsusecase.Query) (reportsusecase.Overview, error)
	}
	FinanceReader interface {
		ListAccounts(ctx context.Context, limit, offset int32, q string, isActive *bool) ([]financeusecase.Account, int64, error)
	}
	SalesReader interface {
		List(ctx context.Context, limit, offset int32, filters salesusecase.ListFilters) ([]salesusecase.Sale, int64, error)
		SummaryIn(ctx context.Context, dateStr string, loc *time.Location) (salesusecase.Summary, error)
	}
	CatalogReader interface {
		ListProducts(ctx context.Context, limit, offset int32, filters catalogusecase.ProductFilters) ([]catalogusecase.Product, int64, error)
	}
)

// Deps wires read tools to services; nil deps skip their tools.
type Deps struct {
	Customers       CustomerReader
	CustomersSearch CustomerSearchStore
	Cari            CariReader
	Jobs            JobsReader
	Reports         ReportsReader
	Finance         FinanceReader
	Sales           SalesReader
	Catalog         CatalogReader
	// UnpaidJobs adds open (unpaid) jobs to get_customer_account / search_customers.
	UnpaidJobs UnpaidJobsReader

	// Write tools (Phase 2). A nil dependency skips the tools that need it.
	CariWrite      CariWriter
	FinanceWrite   FinanceWriter
	CustomersWrite CustomersWriter
	VehicleCatalog VehicleCatalog
	VehicleOptions VehicleOptionStore
	JobsWrite      JobsWriter
	CatalogLookup  CatalogLookup
	SalesWrite     SalesWriter
	Todos          TodosService
	Calendar       CalendarService
	// Reviews adds list_reviews / get_review_summary and the confirmable
	// mark_review_followed_up.
	Reviews ReviewsService
	// Reorder adds list_reorder_suggestions and create_purchase_drafts.
	Reorder ReorderService
	// Loyalty adds get_customer_loyalty / list_loyalty_programs, and with
	// Finance / JobsWrite the sell_package / redeem_reward write tools.
	Loyalty LoyaltyService
}

// DefaultRegistry builds the tool set (read tools, charts, plan checklist and
// confirmable write tools).
func DefaultRegistry(d Deps) *Registry {
	r := NewRegistry(RenderChart{}, UpdatePlan{})
	if d.Customers != nil {
		r.Register(SearchCustomers{customers: d.Customers, unpaid: d.UnpaidJobs})
	}
	if d.Cari != nil {
		r.Register(GetCustomerAccount{cari: d.Cari, unpaid: d.UnpaidJobs})
	}
	if d.Jobs != nil {
		r.Register(ListJobs{jobs: d.Jobs})
	}
	if d.Reports != nil {
		r.Register(ReportSummary{reports: d.Reports})
	}
	if d.Finance != nil {
		r.Register(FinanceBalances{finance: d.Finance})
	}
	if d.Sales != nil {
		r.Register(SalesSummary{sales: d.Sales})
	}
	if d.Catalog != nil {
		r.Register(SearchProducts{catalog: d.Catalog})
	}
	if d.CatalogLookup != nil {
		r.Register(ListServices{catalog: d.CatalogLookup})
	}
	if d.FinanceWrite != nil {
		r.Register(ListFinanceCategories{finance: d.FinanceWrite})
	}
	if d.Calendar != nil {
		r.Register(ListCalendar{calendar: d.Calendar})
	}
	if d.Reviews != nil {
		r.Register(ListReviews{reviews: d.Reviews})
		r.Register(ReviewSummary{reviews: d.Reviews})
	}
	if d.Reorder != nil {
		r.Register(ListReorderSuggestions{reorder: d.Reorder})
	}
	registerLoyaltyTools(r, d)
	registerWriteTools(r, d)
	return r
}

func registerWriteTools(r *Registry, d Deps) {
	if d.CariWrite != nil && d.FinanceWrite != nil {
		r.Register(RecordCariPayment{cari: d.CariWrite, finance: d.FinanceWrite})
	}
	if d.CariWrite != nil {
		r.Register(RecordCariCharge{cari: d.CariWrite})
	}
	if d.FinanceWrite != nil {
		r.Register(RecordFinanceEntry{finance: d.FinanceWrite})
		r.Register(CreateFinanceTransfer{finance: d.FinanceWrite})
		r.Register(UpdateFinanceEntry{finance: d.FinanceWrite})
		r.Register(VoidFinanceEntry{finance: d.FinanceWrite, cari: d.CariWrite})
	}
	pay := jobPayment{cari: d.Cari}
	if d.FinanceWrite != nil {
		pay.finance = d.FinanceWrite
	}
	if d.CustomersWrite != nil {
		r.Register(CreateCustomer{customers: d.CustomersWrite, search: d.CustomersSearch})
		if d.VehicleOptions != nil {
			r.Register(AddCustomerVehicle{customers: d.CustomersWrite, options: d.VehicleOptions})
		}
		if d.JobsWrite != nil && d.CatalogLookup != nil {
			r.Register(CreateJob{customers: d.CustomersWrite, jobs: d.JobsWrite, catalog: d.CatalogLookup})
			if d.CustomersSearch != nil && d.VehicleCatalog != nil {
				r.Register(QuickJob{customers: d.CustomersWrite, search: d.CustomersSearch, vehicles: d.VehicleCatalog,
					jobs: d.JobsWrite, catalog: d.CatalogLookup, pay: pay})
			}
		}
		if d.SalesWrite != nil && d.CatalogLookup != nil && d.FinanceWrite != nil {
			r.Register(CreateQuickSale{sales: d.SalesWrite, catalog: d.CatalogLookup, finance: d.FinanceWrite, customers: d.CustomersWrite})
		}
	}
	if d.VehicleCatalog != nil {
		r.Register(SearchVehicleModels{catalog: d.VehicleCatalog})
	}
	if d.JobsWrite != nil {
		r.Register(UpdateJobStatus{jobs: d.JobsWrite, pay: pay})
		r.Register(RecordJobPayment{jobs: d.JobsWrite, pay: pay})
		r.Register(CancelJob{jobs: d.JobsWrite, pay: pay})
	}
	if d.Todos != nil {
		r.Register(CreateTodo{todos: d.Todos, customers: d.CustomersWrite})
		r.Register(ListTodos{todos: d.Todos})
		r.Register(CompleteTodo{todos: d.Todos})
	}
	if d.Calendar != nil {
		r.Register(CreateCalendarEvent{calendar: d.Calendar})
	}
	if d.Reviews != nil {
		r.Register(MarkReviewFollowedUp{reviews: d.Reviews})
	}
	if d.Reorder != nil {
		r.Register(CreatePurchaseDrafts{reorder: d.Reorder})
	}
}

// userError turns domain validation errors into tool errors; other errors bubble up.
func userError(err error) (Result, error) {
	msg := err.Error()
	switch {
	case strings.Contains(strings.ToLower(msg), "not found"):
		return ErrorResult("not found: " + msg), nil
	case strings.Contains(strings.ToLower(msg), "invalid"),
		strings.Contains(strings.ToLower(msg), "must"),
		strings.Contains(strings.ToLower(msg), "cannot"):
		return ErrorResult(msg), nil
	}
	return Result{}, err
}

func clampInt(v, def, lo, hi int) int {
	if v == 0 {
		v = def
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func fmtTime(t time.Time, loc *time.Location) string {
	if t.IsZero() {
		return ""
	}
	if loc != nil {
		t = t.In(loc)
	}
	return t.Format("2006-01-02 15:04")
}

// ---------------------------------------------------------------- customers

// SearchCustomers lists customers or finds customers by name, phone or plate.
type SearchCustomers struct {
	customers CustomerReader
	unpaid    UnpaidJobsReader
}

var searchCustomersSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"query": map[string]any{"type": "string", "maxLength": 100, "description": "Optional. Leave empty to list customers and get the total count; otherwise name, phone number or plate (spaces and case in plates/phones do not matter)."},
		"limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 10, "description": "Max results (default 5)."},
	},
	"additionalProperties": false,
}

func (SearchCustomers) Spec() Spec {
	return Spec{
		Name: "search_customers",
		Description: "Search the organization's customers by name, phone or vehicle plate, or leave query empty to list customers and get the total count (e.g. 'how many customers do I have'). " +
			"Returns uuid, name, phone, vehicle count, the cari (receivable) account with its ledger balance and, separately, unpaid jobs (unpaid_jobs_total; not in the cari ledger). " +
			"Use before any customer-specific question; if several match, ask the user which one.",
		InputSchema: searchCustomersSchema,
		Permissions: []string{rbac.PermTenantCustomersRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

func (t SearchCustomers) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := Decode(searchCustomersSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	limit := clampInt(in.Limit, 5, 1, 10)
	query := strings.TrimSpace(in.Query)
	if query != "" && len([]rune(query)) < 2 {
		return ErrorResult("Invalid input: query: must be at least 2 characters"), nil
	}
	list := func(q string) ([]customersusecase.Customer, int64, error) {
		return t.customers.List(ctx, int32(limit), 0, customersusecase.Filters{Q: q, Sort: "-created_at"})
	}
	rows, total, err := list(query)
	if err != nil {
		return userError(err)
	}
	// Phones are stored as typed ("0532 123 45 67"): retry a phone-looking
	// query by its last digits.
	if total == 0 {
		if d := DigitsOnly(query); len(d) >= 7 && len(d) >= len([]rune(query))/2 {
			if len(d) > 10 {
				d = d[len(d)-10:]
			}
			if rows, total, err = list(d); err != nil {
				return userError(err)
			}
		}
	}
	type item struct {
		UUID            string `json:"uuid"`
		Name            string `json:"name"`
		Phone           string `json:"phone,omitempty"`
		Kind            string `json:"kind"`
		VehicleCount    int64  `json:"vehicle_count"`
		Active          bool   `json:"active"`
		CariAccountUUID string `json:"cari_account_uuid,omitempty"`
		CariBalance     string `json:"cari_balance,omitempty"`
		UnpaidJobCount  *int64 `json:"unpaid_job_count,omitempty"`
		UnpaidJobsTotal string `json:"unpaid_jobs_total,omitempty"`
	}
	var totals map[uuid.UUID]jobsusecase.UnpaidTotal
	if t.unpaid != nil && env.Principal.HasPermission(rbac.PermTenantJobsRead) && len(rows) > 0 {
		ids := make([]uuid.UUID, 0, len(rows))
		for _, r := range rows {
			ids = append(ids, r.UUID)
		}
		totals, _ = t.unpaid.UnpaidTotalsByCustomers(ctx, ids)
	}
	items := make([]item, 0, len(rows))
	for _, r := range rows {
		it := item{
			UUID: r.UUID.String(), Name: DataText(r.Name, maxNameChars), Phone: DataText(r.Phone, 32),
			Kind: r.Kind, VehicleCount: r.VehicleCount, Active: r.IsActive,
		}
		if r.CariAccountUUID != nil {
			it.CariAccountUUID = r.CariAccountUUID.String()
			if r.CariBalance != nil {
				it.CariBalance = FormatMoney(*r.CariBalance, "TRY")
			}
		}
		if totals != nil {
			u := totals[r.UUID]
			n := u.Count
			it.UnpaidJobCount = &n
			it.UnpaidJobsTotal = FormatMoney(firstNonBlank(u.TotalAmount, "0"), "TRY")
		}
		items = append(items, it)
	}
	out := map[string]any{"count": len(items), "total": total, "customers": items}
	if totals != nil {
		out["note"] = "cari_balance is the cari ledger only; unpaid_jobs_total are jobs not paid yet (collect them with record_job_payment)."
	}
	return JSONResult(out, "ai.tool_summary.customers_found", map[string]any{"count": total}), nil
}

// ---------------------------------------------------------------- cari

// GetCustomerAccount returns a cari account balance, recent ledger entries
// and the customer's unpaid jobs.
type GetCustomerAccount struct {
	cari   CariReader
	unpaid UnpaidJobsReader
}

var customerAccountSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"cari_account_uuid": map[string]any{"type": "string", "format": "uuid", "description": "cari_account_uuid from search_customers."},
		"customer_uuid":     map[string]any{"type": "string", "format": "uuid", "description": "Alternative to cari_account_uuid: the customer's uuid."},
		"entries_limit":     map[string]any{"type": "integer", "minimum": 0, "maximum": 20, "description": "Recent ledger entries to include (default 8)."},
		"jobs_limit":        map[string]any{"type": "integer", "minimum": 0, "maximum": 20, "description": "Unpaid jobs to list (default 10)."},
	},
	"additionalProperties": false,
}

func (GetCustomerAccount) Spec() Spec {
	return Spec{
		Name: "get_customer_account",
		Description: "Get what a customer owes. balance is the cari (receivable) ledger only (positive = customer owes us) with the recent ledger entries (charges, collections, adjustments). " +
			"Unpaid jobs are NOT in the ledger: they are listed separately in open_jobs with unpaid_jobs_total, and total_due = balance + unpaid_jobs_total (what the customer page shows as debt). " +
			"To collect a job use record_job_payment; record_cari_payment only reduces the cari ledger balance and record_finance_entry does not mark a job paid. Pass cari_account_uuid or customer_uuid.",
		InputSchema: customerAccountSchema,
		Permissions: []string{rbac.PermTenantCariRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

func (t GetCustomerAccount) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in struct {
		AccountUUID  string `json:"cari_account_uuid"`
		CustomerUUID string `json:"customer_uuid"`
		EntriesLimit *int   `json:"entries_limit"`
		JobsLimit    *int   `json:"jobs_limit"`
	}
	if err := Decode(customerAccountSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	var acc cariusecase.AccountDetail
	var err error
	switch {
	case in.AccountUUID != "":
		id, _ := uuid.Parse(in.AccountUUID)
		acc, err = t.cari.Get(ctx, id)
	case in.CustomerUUID != "":
		id, _ := uuid.Parse(in.CustomerUUID)
		acc, err = t.cari.GetByCustomer(ctx, id)
	default:
		return ErrorResult("Invalid input: pass cari_account_uuid or customer_uuid"), nil
	}
	if err != nil {
		return userError(err)
	}
	id := acc.UUID
	limit := 8
	if in.EntriesLimit != nil {
		limit = clampInt(*in.EntriesLimit, 8, 0, 20)
		if *in.EntriesLimit == 0 {
			limit = 0
		}
	}
	type entry struct {
		UUID         string `json:"uuid"`
		Date         string `json:"date"`
		Type         string `json:"type"`
		Status       string `json:"status,omitempty"`
		Amount       string `json:"amount"`
		BalanceAfter string `json:"balance_after"`
		Description  string `json:"description,omitempty"`
		Method       string `json:"method,omitempty"`
	}
	entries := []entry{}
	if limit > 0 {
		rows, _, err := t.cari.ListEntries(ctx, id, int32(limit), 0, cariusecase.EntryFilters{})
		if err != nil {
			return userError(err)
		}
		for _, e := range rows {
			en := entry{
				UUID: e.UUID.String(), Date: e.EntryDate, Type: e.Type, Amount: FormatMoney(e.Amount, acc.Currency),
				BalanceAfter: FormatMoney(e.BalanceAfter, acc.Currency), Description: DataText(e.Description, 80),
			}
			if e.Status != "posted" && e.Status != "" {
				en.Status = e.Status
			}
			if e.PaymentMethod != nil {
				en.Method = *e.PaymentMethod
			}
			entries = append(entries, en)
		}
	}
	out := map[string]any{
		"customer":          DataText(acc.CustomerName, maxNameChars),
		"customer_uuid":     acc.CustomerUUID.String(),
		"cari_account_uuid": acc.UUID.String(),
		"phone":             DataText(acc.CustomerPhone, 32),
		"currency":          acc.Currency,
		"balance":           FormatMoney(acc.Balance, acc.Currency),
		"balance_number":    Number(acc.Balance),
		"recent_entries":    entries,
	}
	if t.unpaid != nil && env.Principal.HasPermission(rbac.PermTenantJobsRead) {
		jl := 10
		if in.JobsLimit != nil {
			jl = *in.JobsLimit
		}
		lim := int32(jl)
		if lim == 0 {
			lim = 1
		}
		unpaid, err := t.unpaid.UnpaidByCustomer(ctx, acc.CustomerUUID, lim)
		if err != nil {
			return userError(err)
		}
		jobs := []map[string]any{}
		for i, j := range unpaid.Jobs {
			if i >= jl {
				break
			}
			row := map[string]any{
				"job_uuid": j.UUID.String(), "plate": DataText(j.Plate, 20), "vehicle": DataText(j.VehicleLabel, maxNameChars),
				"status": j.Status, "total": FormatMoney(j.TotalAmount, j.Currency), "started_at": fmtTime(j.StartedAt, env.Location),
			}
			if j.DeliveredAt != nil {
				row["delivered_at"] = fmtTime(*j.DeliveredAt, env.Location)
			}
			jobs = append(jobs, row)
		}
		due := ratOf(acc.Balance)
		due.Add(due, ratOf(unpaid.TotalAmount))
		out["open_jobs"] = jobs
		out["unpaid_job_count"] = unpaid.Count
		out["unpaid_jobs_total"] = FormatMoney(unpaid.TotalAmount, acc.Currency)
		out["unpaid_jobs_total_number"] = Number(unpaid.TotalAmount)
		out["total_due"] = FormatMoney(due.FloatString(2), acc.Currency)
		out["total_due_number"] = Number(due.FloatString(2))
		out["note"] = "balance = cari ledger only; unpaid jobs are separate (open_jobs). Collect a job with record_job_payment, not record_cari_payment or record_finance_entry."
	}
	return JSONResult(out, "ai.tool_summary.account_balance", map[string]any{
		"name": DataText(acc.CustomerName, 60), "balance": FormatMoney(acc.Balance, acc.Currency),
	}), nil
}

// ---------------------------------------------------------------- jobs

// ListJobs lists service jobs (araç iş emirleri) for a date range.
type ListJobs struct{ jobs JobsReader }

var listJobsSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"date_from": map[string]any{"type": "string", "format": "date", "description": "Start date (YYYY-MM-DD). Default: today."},
		"date_to":   map[string]any{"type": "string", "format": "date", "description": "End date inclusive (YYYY-MM-DD). Default: date_from."},
		"status":    map[string]any{"type": "string", "enum": []string{"in_progress", "ready", "delivered", "cancelled", "voided"}, "description": "Filter by status. ready = washed/ready for pickup, delivered = handed over to customer."},
		"query":     map[string]any{"type": "string", "maxLength": 80, "description": "Plate or customer name filter."},
		"limit":     map[string]any{"type": "integer", "minimum": 1, "maximum": 25, "description": "Max rows (default 15)."},
	},
	"additionalProperties": false,
}

func (ListJobs) Spec() Spec {
	return Spec{
		Name:        "list_jobs",
		Description: "List service jobs (vehicles washed/detailed) with status, payment status and totals for a date range (default today). Returns total count, per-status counts of the returned rows and, for a single day, the day's payment totals.",
		InputSchema: listJobsSchema,
		Permissions: []string{rbac.PermTenantJobsRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

func (t ListJobs) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in struct {
		DateFrom string `json:"date_from"`
		DateTo   string `json:"date_to"`
		Status   string `json:"status"`
		Query    string `json:"query"`
		Limit    int    `json:"limit"`
	}
	if err := Decode(listJobsSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	if in.DateFrom == "" {
		in.DateFrom = env.Today()
	}
	if in.DateTo == "" {
		in.DateTo = in.DateFrom
	}
	if in.DateTo < in.DateFrom {
		return ErrorResult("date_to must be on or after date_from"), nil
	}
	limit := clampInt(in.Limit, 15, 1, 25)
	rows, total, err := t.jobs.List(ctx, int32(limit), 0, jobsusecase.ListFilters{
		Q: strings.TrimSpace(in.Query), Status: in.Status, DateFrom: in.DateFrom, DateTo: in.DateTo, Sort: "-started_at",
		Location: env.loc(),
	})
	if err != nil {
		return userError(err)
	}
	type job struct {
		UUID     string `json:"uuid"`
		Plate    string `json:"plate"`
		Vehicle  string `json:"vehicle,omitempty"`
		Customer string `json:"customer"`
		Status   string `json:"status"`
		Payment  string `json:"payment_status"`
		Total    string `json:"total"`
		Started  string `json:"started_at"`
		Assignee string `json:"assignee,omitempty"`
	}
	items := make([]job, 0, len(rows))
	byStatus := map[string]int{}
	for _, j := range rows {
		byStatus[j.Status]++
		items = append(items, job{
			UUID: j.UUID.String(), Plate: DataText(j.Plate, 20), Vehicle: DataText(j.VehicleLabel, maxNameChars),
			Customer: DataText(j.CustomerName, maxNameChars), Status: j.Status,
			Payment: j.PaymentStatus, Total: FormatMoney(j.TotalAmount, j.Currency),
			Started: fmtTime(j.StartedAt, env.Location), Assignee: DataText(j.AssigneeName, maxNameChars),
		})
	}
	out := map[string]any{
		"date_from":         in.DateFrom,
		"date_to":           in.DateTo,
		"total":             total,
		"returned":          len(items),
		"status_of_listed":  byStatus,
		"jobs":              items,
		"truncated":         int64(len(items)) < total,
		"status_glossary":   "in_progress=işlemde, ready=hazır, delivered=teslim edildi, cancelled=iptal, voided=geçersiz",
		"payment_glossary":  "unpaid=ödenmedi, paid=ödendi",
		"hint_for_counting": "use status filter + total for exact counts per status",
	}
	if in.DateFrom == in.DateTo && in.Status == "" && in.Query == "" {
		if sum, err := t.jobs.SummaryIn(ctx, in.DateFrom, env.loc()); err == nil {
			out["day_totals"] = map[string]any{
				"job_count":  sum.JobCount,
				"paid_total": FormatMoney(sum.PaidTotal, "TRY"),
				"card_total": FormatMoney(sum.CardTotal, "TRY"),
				"cari_total": FormatMoney(sum.CariTotal, "TRY"),
				"net_total":  FormatMoney(sum.NetTotal, "TRY"),
			}
		}
	}
	return JSONResult(out, "ai.tool_summary.jobs_found", map[string]any{"count": total}), nil
}

// ---------------------------------------------------------------- reports

// ReportSummary returns KPIs + a timeseries for a date range (reports module).
type ReportSummary struct{ reports ReportsReader }

var reportSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"date_from":   map[string]any{"type": "string", "format": "date", "description": "Start date. Default: first day of the current month."},
		"date_to":     map[string]any{"type": "string", "format": "date", "description": "End date inclusive. Default: today."},
		"granularity": map[string]any{"type": "string", "enum": []string{"day", "week", "month"}, "description": "Timeseries bucket (default day)."},
	},
	"additionalProperties": false,
}

func (ReportSummary) Spec() Spec {
	return Spec{
		Name:        "get_report_summary",
		Description: "Business report for a date range: income, expense, net profit, job counts (paid/done/in progress/cancelled), vehicles served, product sales, purchases, cari charged/collected, cash vs card, top services/products, expense categories, and a timeseries (numeric income/expense/net/job_count per bucket; use it with render_chart via source_tool_use_id and rows_path=\"timeseries\").",
		InputSchema: reportSchema,
		Permissions: []string{rbac.PermTenantReportsRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

func (t ReportSummary) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in struct {
		DateFrom    string `json:"date_from"`
		DateTo      string `json:"date_to"`
		Granularity string `json:"granularity"`
	}
	if err := Decode(reportSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	now := env.Now.In(env.loc())
	if in.DateFrom == "" {
		in.DateFrom = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, env.loc()).Format("2006-01-02")
	}
	if in.DateTo == "" {
		in.DateTo = now.Format("2006-01-02")
	}
	ov, err := t.reports.Overview(ctx, reportsusecase.Query{DateFrom: in.DateFrom, DateTo: in.DateTo, Granularity: in.Granularity})
	if err != nil {
		if errors.Is(err, reportsusecase.ErrInvalidRequest) {
			return ErrorResult(err.Error()), nil
		}
		return Result{}, err
	}
	cur := "TRY"
	if ov.Filters.Currency != nil && *ov.Filters.Currency != "" {
		cur = *ov.Filters.Currency
	}
	k := ov.KPIs
	m := func(v string) string { return FormatMoney(v, cur) }
	series := make([]map[string]any, 0, len(ov.Timeseries))
	for i, p := range ov.Timeseries {
		if i >= 62 {
			break
		}
		series = append(series, map[string]any{
			"date": p.Date, "income": Number(p.Income), "expense": Number(p.Expense),
			"net": Number(p.Net), "job_paid": Number(p.JobPaid), "job_count": p.JobCount,
		})
	}
	top := func(items []reportsusecase.NamedTotal, n int) []map[string]any {
		out := []map[string]any{}
		for i, it := range items {
			if i >= n {
				break
			}
			row := map[string]any{"name": DataText(it.Name, maxNameChars), "total": m(it.Total), "count": it.Count}
			if it.Qty != "" {
				row["qty"] = it.Qty
			}
			out = append(out, row)
		}
		return out
	}
	out := map[string]any{
		"date_from":   ov.Filters.DateFrom,
		"date_to":     ov.Filters.DateTo,
		"granularity": ov.Filters.Granularity,
		"currency":    cur,
		"kpis": map[string]any{
			"total_income": m(k.TotalIncome), "total_expense": m(k.TotalExpense), "net_profit": m(k.NetProfit),
			"job_count": k.JobCount, "job_paid_count": k.JobPaidCount, "job_done_count": k.JobDoneCount,
			"job_in_progress_count": k.JobInProgress, "job_cancelled_count": k.JobCancelled,
			"job_paid_total": m(k.JobPaidTotal), "avg_ticket": m(k.AvgTicket), "vehicles_served": k.VehiclesServed,
			"sale_count": k.SaleCount, "sale_total": m(k.SaleTotal),
			"purchase_count": k.PurchaseCount, "purchase_total": m(k.PurchaseTotal),
			"cari_charged": m(k.CariCharged), "cari_collected": m(k.CariCollected), "cari_outstanding": m(k.CariOutstanding),
			"cash_total": m(k.CashTotal), "card_total": m(k.CardTotal),
		},
		"top_services":         top(ov.Services, 5),
		"top_products":         top(ov.Products, 5),
		"expenses_by_category": top(ov.ExpensesByCategory, 6),
		"payments_by_method":   top(ov.PaymentsByMethod, 4),
		"timeseries":           series,
	}
	return JSONResult(out, "ai.tool_summary.report_ready", map[string]any{"from": ov.Filters.DateFrom, "to": ov.Filters.DateTo}), nil
}

// ---------------------------------------------------------------- finance

// FinanceBalances lists cash/bank account balances.
type FinanceBalances struct{ finance FinanceReader }

var financeSchema = map[string]any{
	"type":                 "object",
	"properties":           map[string]any{},
	"additionalProperties": false,
}

func (FinanceBalances) Spec() Spec {
	return Spec{
		Name:        "get_finance_balances",
		Description: "Current balances of the organization's active cash registers (kasa), bank and POS accounts, with totals per currency.",
		InputSchema: financeSchema,
		Permissions: []string{rbac.PermTenantFinanceRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

func (t FinanceBalances) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in struct{}
	if err := Decode(financeSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	active := true
	rows, _, err := t.finance.ListAccounts(ctx, 50, 0, "", &active)
	if err != nil {
		return userError(err)
	}
	totals := map[string]float64{}
	type acc struct {
		Name     string  `json:"name"`
		Type     string  `json:"type"`
		Balance  string  `json:"balance"`
		Number   float64 `json:"balance_number"`
		Currency string  `json:"currency"`
		Default  bool    `json:"default,omitempty"`
	}
	items := make([]acc, 0, len(rows))
	for _, a := range rows {
		n := Number(a.CurrentBalance)
		totals[a.Currency] += n
		items = append(items, acc{Name: DataText(a.Name, maxNameChars), Type: a.Type, Balance: FormatMoney(a.CurrentBalance, a.Currency), Number: n, Currency: a.Currency, Default: a.IsDefault})
	}
	totalOut := map[string]string{}
	for cur, v := range totals {
		totalOut[cur] = FormatMoney(fmt.Sprintf("%.2f", v), cur)
	}
	return JSONResult(map[string]any{"accounts": items, "totals": totalOut},
		"ai.tool_summary.accounts_found", map[string]any{"count": len(items)}), nil
}

// ---------------------------------------------------------------- sales

// SalesSummary returns a day's product sales totals and recent sales.
type SalesSummary struct{ sales SalesReader }

var salesSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"date":  map[string]any{"type": "string", "format": "date", "description": "Day (YYYY-MM-DD). Default: today."},
		"limit": map[string]any{"type": "integer", "minimum": 0, "maximum": 20, "description": "Recent sales rows to include (default 10)."},
	},
	"additionalProperties": false,
}

func (SalesSummary) Spec() Spec {
	return Spec{
		Name:        "get_sales_summary",
		Description: "Product (retail) sales for one day: count, paid/card/cari/net totals and the most recent sales with customer, amount and payment method. For multi-day revenue use get_report_summary.",
		InputSchema: salesSchema,
		Permissions: []string{rbac.PermTenantSalesRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

func (t SalesSummary) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Date  string `json:"date"`
		Limit *int   `json:"limit"`
	}
	if err := Decode(salesSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	if in.Date == "" {
		in.Date = env.Today()
	}
	sum, err := t.sales.SummaryIn(ctx, in.Date, env.loc())
	if err != nil {
		return userError(err)
	}
	limit := 10
	if in.Limit != nil {
		limit = *in.Limit
	}
	type sale struct {
		Customer string `json:"customer,omitempty"`
		Total    string `json:"total"`
		Method   string `json:"method"`
		Status   string `json:"status"`
		SoldAt   string `json:"sold_at"`
	}
	items := []sale{}
	if limit > 0 {
		rows, _, err := t.sales.List(ctx, int32(limit), 0, salesusecase.ListFilters{DateFrom: in.Date, DateTo: in.Date, Location: env.loc()})
		if err != nil {
			return userError(err)
		}
		for _, s := range rows {
			items = append(items, sale{Customer: DataText(s.CustomerName, maxNameChars), Total: FormatMoney(s.TotalAmount, s.Currency), Method: s.Method, Status: s.Status, SoldAt: fmtTime(s.SoldAt, env.Location)})
		}
	}
	out := map[string]any{
		"date":       sum.Date,
		"sale_count": sum.SaleCount,
		"paid_total": FormatMoney(sum.PaidTotal, "TRY"),
		"card_total": FormatMoney(sum.CardTotal, "TRY"),
		"cari_total": FormatMoney(sum.CariTotal, "TRY"),
		"net_total":  FormatMoney(sum.NetTotal, "TRY"),
		"recent":     items,
	}
	return JSONResult(out, "ai.tool_summary.sales_ready", map[string]any{"count": sum.SaleCount}), nil
}

// ---------------------------------------------------------------- catalog

// SearchProducts looks up products and stock.
type SearchProducts struct{ catalog CatalogReader }

var productsSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"query":        map[string]any{"type": "string", "maxLength": 80, "description": "Product name, SKU or barcode."},
		"stock_status": map[string]any{"type": "string", "enum": []string{"low_stock", "out_of_stock", "in_stock"}, "description": "Filter by stock level (low_stock = at or below the alert level)."},
		"limit":        map[string]any{"type": "integer", "minimum": 1, "maximum": 25, "description": "Max rows (default 10)."},
	},
	"additionalProperties": false,
}

func (SearchProducts) Spec() Spec {
	return Spec{
		Name:        "search_products",
		Description: "Look up retail products with stock quantity, alert level and sale price; filter by stock status to find low-stock or out-of-stock items.",
		InputSchema: productsSchema,
		Permissions: []string{rbac.PermTenantCatalogRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

func (t SearchProducts) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Query       string `json:"query"`
		StockStatus string `json:"stock_status"`
		Limit       int    `json:"limit"`
	}
	if err := Decode(productsSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	limit := clampInt(in.Limit, 10, 1, 25)
	active := true
	rows, total, err := t.catalog.ListProducts(ctx, int32(limit), 0, catalogusecase.ProductFilters{
		Q: strings.TrimSpace(in.Query), StockStatus: in.StockStatus, IsActive: &active,
	})
	if err != nil {
		return userError(err)
	}
	type product struct {
		Name     string `json:"name"`
		SKU      string `json:"sku,omitempty"`
		Stock    string `json:"stock"`
		MinAlert string `json:"min_alert,omitempty"`
		Unit     string `json:"unit"`
		Price    string `json:"sale_price"`
		Status   string `json:"stock_status"`
	}
	items := make([]product, 0, len(rows))
	for _, p := range rows {
		it := product{Name: DataText(p.Name, maxNameChars), Stock: p.StockQuantity, Unit: p.Unit, Price: FormatMoney(p.SalePrice, p.Currency), Status: p.StockStatus}
		if p.SKU != nil {
			it.SKU = DataText(*p.SKU, 64)
		}
		if p.TrackStock {
			it.MinAlert = p.MinStockAlert
		}
		items = append(items, it)
	}
	return JSONResult(map[string]any{"total": total, "products": items, "truncated": int64(len(items)) < total},
		"ai.tool_summary.products_found", map[string]any{"count": total}), nil
}
