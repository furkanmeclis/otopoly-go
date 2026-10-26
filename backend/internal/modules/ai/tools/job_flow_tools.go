package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	catalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/catalog/usecase"
	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	vehiclecatalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclebrands/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// ---------------------------------------------------------------- list services (read)

// ListServices lists the organization's service catalog.
type ListServices struct{ catalog CatalogLookup }

var listServicesSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"query":            map[string]any{"type": "string", "maxLength": 80, "description": "Optional name/code filter."},
		"include_inactive": map[string]any{"type": "boolean", "description": "Also list passive services (default false; jobs can only use active ones)."},
		"limit":            map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "description": "Max rows (default 50)."},
	},
	"additionalProperties": false,
}

// Spec implements Tool.
func (ListServices) Spec() Spec {
	return Spec{
		Name: "list_services",
		Description: "List the service catalog (hizmetler): name, catalog price, duration, category and active flag. " +
			"Use it before create_job / quick_job to pick exact service names; job lines must be catalog services.",
		InputSchema: listServicesSchema,
		Permissions: []string{rbac.PermTenantCatalogRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

// Run implements Tool.
func (t ListServices) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Query           string `json:"query"`
		IncludeInactive bool   `json:"include_inactive"`
		Limit           int    `json:"limit"`
	}
	if err := Decode(listServicesSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	limit := clampInt(in.Limit, 50, 1, 100)
	filters := catalogusecase.ServiceFilters{Q: strings.TrimSpace(in.Query)}
	if !in.IncludeInactive {
		active := true
		filters.IsActive = &active
	}
	rows, total, err := t.catalog.ListServices(ctx, int32(limit), 0, filters)
	if err != nil {
		return userError(err)
	}
	type item struct {
		UUID     string  `json:"uuid"`
		Name     string  `json:"name"`
		Code     string  `json:"code,omitempty"`
		Price    string  `json:"price"`
		Number   float64 `json:"price_number"`
		Duration int32   `json:"duration_minutes"`
		Category string  `json:"category,omitempty"`
		Active   bool    `json:"active"`
	}
	items := make([]item, 0, len(rows))
	for _, s := range rows {
		it := item{UUID: s.UUID.String(), Name: DataText(s.Name, maxNameChars), Price: FormatMoney(s.Price, s.Currency), Number: Number(s.Price), Duration: s.DurationMinutes, Active: s.IsActive}
		if s.Code != nil {
			it.Code = DataText(*s.Code, 40)
		}
		if s.CategoryName != nil {
			it.Category = DataText(*s.CategoryName, maxNameChars)
		}
		items = append(items, it)
	}
	return JSONResult(map[string]any{"total": total, "services": items, "truncated": int64(len(items)) < total},
		"ai.tool_summary.services_found", map[string]any{"count": total}), nil
}

// ---------------------------------------------------------------- record job payment

// RecordJobPayment takes the payment of a service job through the jobs module.
type RecordJobPayment struct {
	jobs JobsWriter
	pay  jobPayment
}

var jobPaymentSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"job_uuid":        map[string]any{"type": "string", "format": "uuid", "description": "uuid from list_jobs / get_customer_account open_jobs; or pass plate."},
		"plate":           map[string]any{"type": "string", "maxLength": 16, "description": "Plate of the unpaid job (spaces and case do not matter)."},
		"method":          map[string]any{"type": "string", "enum": jobPaymentValues, "description": "cash (nakit), card (kart/POS), transfer (havale/EFT, booked like card into a bank account), cari (on the customer's account: their cari balance grows)."},
		"finance_account": map[string]any{"type": "string", "maxLength": 100, "description": "Cash/bank account name or uuid for cash/card/transfer. Omit for the default cash register (cash) or bank account (card/transfer)."},
	},
	"required":             []string{"method"},
	"additionalProperties": false,
}

type jobPaymentInput struct {
	JobUUID        string `json:"job_uuid,omitempty"`
	Plate          string `json:"plate,omitempty"`
	Method         string `json:"method"`
	FinanceAccount string `json:"finance_account,omitempty"`
}

// Spec implements Tool.
func (RecordJobPayment) Spec() Spec {
	return Spec{
		Name: "record_job_payment",
		Description: "Propose taking the payment of an unpaid service job (iş emri tahsilatı) for its full total. The job becomes paid and, for cash/card/transfer, " +
			"a \"Hizmet Geliri\" income is posted on the cash/bank account; for cari the total is charged to the customer's cari account. " +
			"Always use this (not record_finance_entry or record_cari_payment) to collect a job. Shows a confirmation card.",
		InputSchema:          jobPaymentSchema,
		Permissions:          []string{rbac.PermTenantJobsWrite, rbac.PermTenantJobsRead, rbac.PermTenantFinanceRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// Propose implements ActionTool.
func (t RecordJobPayment) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in jobPaymentInput
	if err := decodeInput(jobPaymentSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	detail, err := findJob(ctx, env, t.jobs, in.JobUUID, in.Plate, unpaidOpen, "unpaid")
	if err != nil {
		return Proposal{}, err
	}
	job := detail.Job
	if job.PaymentStatus == "paid" {
		return Proposal{}, inputErr("job %s is already paid", job.Plate)
	}
	if !unpaidOpen(job) {
		return Proposal{}, inputErr("job %s is %s and cannot take a payment", job.Plate, job.Status)
	}
	plan, err := t.pay.plan(ctx, env, job.CustomerUUID, job.TotalAmount, job.Currency, in.Method, in.FinanceAccount)
	if err != nil {
		return Proposal{}, err
	}
	// The card edits write to this tool's own input property (method).
	for i := range plan.Edit {
		if plan.Edit[i].Key == "payment_method" {
			plan.Edit[i].Key = "method"
		}
	}
	norm := jobPaymentInput{JobUUID: job.UUID.String(), Plate: job.Plate, Method: in.Method}
	if in.Method != "cari" {
		norm.FinanceAccount = plan.Account.UUID.String()
	}
	fields := []Field{
		{Key: "customer", Value: job.CustomerName},
		{Key: "plate", Value: job.Plate},
		{Key: "vehicle", Value: job.VehicleLabel},
		{Key: "job_status", ValueKey: "ai.confirm.values." + job.Status},
	}
	fields = append(fields, plan.Fields...)
	return Proposal{
		Input: mustJSON(norm),
		Preview: Preview{
			Action: "record_job_payment", Title: job.Plate + " · " + job.CustomerName, Amount: FormatMoney(job.TotalAmount, job.Currency),
			Fields: fields, Warnings: plan.Warnings, Edit: plan.Edit,
		},
	}, nil
}

// Run implements Tool.
func (t RecordJobPayment) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in jobPaymentInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	id, _ := uuid.Parse(in.JobUUID)
	job, err := closeJob(ctx, t.jobs, id, in.Method, in.FinanceAccount)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "already paid") {
			return ErrorResult("Not executed: the job is already paid."), nil
		}
		return execError(err)
	}
	out := map[string]any{
		"done": true, "job_uuid": job.UUID.String(), "plate": job.Plate, "status": job.Status,
		"payment_status": job.PaymentStatus, "total": FormatMoney(job.TotalAmount, job.Currency),
		"payment": t.pay.paymentResult(ctx, env, job, in.Method),
	}
	res := JSONResult(out, "ai.tool_summary.job_paid", map[string]any{"plate": job.Plate, "amount": FormatMoney(job.TotalAmount, job.Currency)})
	res.Link = &Link{Kind: "job", UUID: job.UUID.String()}
	return res, nil
}

// ---------------------------------------------------------------- cancel job

// CancelJob cancels an unpaid open job, or voids a paid one (owner only).
type CancelJob struct {
	jobs JobsWriter
	pay  jobPayment
}

var cancelJobSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"job_uuid": map[string]any{"type": "string", "format": "uuid", "description": "uuid from list_jobs; or pass plate."},
		"plate":    map[string]any{"type": "string", "maxLength": 16, "description": "Plate of the job to cancel (spaces and case do not matter)."},
	},
	"additionalProperties": false,
}

type cancelJobInput struct {
	JobUUID string `json:"job_uuid,omitempty"`
	Plate   string `json:"plate,omitempty"`
}

// Spec implements Tool.
func (CancelJob) Spec() Spec {
	return Spec{
		Name: "cancel_job",
		Description: "Propose cancelling a service job opened by mistake. An unpaid in_progress/ready job is cancelled (iptal). A paid job is voided (geçersiz, owner only): " +
			"its payment is reversed (the \"Hizmet Geliri\" income is voided or the cari charge removed). Products used on the job go back to stock in both cases. " +
			"Delivered unpaid jobs cannot be cancelled. Shows a confirmation card.",
		InputSchema:          cancelJobSchema,
		Permissions:          []string{rbac.PermTenantJobsWrite, rbac.PermTenantJobsRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

func isOwner(env Env) bool { return env.Principal.IsSuperAdmin || env.Scope.MemberRole == "owner" }

func cancelMode(env Env, job jobsusecase.Job) (string, error) {
	switch {
	case job.Status == "cancelled" || job.Status == "voided":
		return "", inputErr("job %s is already %s", job.Plate, job.Status)
	case job.PaymentStatus == "paid":
		if !isOwner(env) {
			return "", inputErr("job %s is paid; only the business owner can void a paid job (its payment is reversed). Ask the owner", job.Plate)
		}
		return "void", nil
	case job.Status == "in_progress" || job.Status == "ready":
		return "cancel", nil
	}
	return "", inputErr("job %s is delivered but unpaid and cannot be cancelled; take the payment (record_job_payment) or ask the owner to correct it in the panel", job.Plate)
}

func returnedStock(d jobsusecase.JobDetail) []string {
	var out []string
	for _, c := range d.Consumptions {
		if c.StockApplied && !c.Reverted {
			out = append(out, fmt.Sprintf("%s %s %s", c.Name, c.Qty, c.Unit))
		}
	}
	return out
}

// Propose implements ActionTool.
func (t CancelJob) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in cancelJobInput
	if err := decodeInput(cancelJobSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	notClosed := func(j jobsusecase.Job) bool { return j.Status != "cancelled" && j.Status != "voided" }
	detail, err := findJob(ctx, env, t.jobs, in.JobUUID, in.Plate, notClosed, "active")
	if err != nil {
		return Proposal{}, err
	}
	job := detail.Job
	mode, err := cancelMode(env, job)
	if err != nil {
		return Proposal{}, err
	}
	to := "cancelled"
	if mode == "void" {
		to = "voided"
	}
	fields := []Field{
		{Key: "customer", Value: job.CustomerName},
		{Key: "plate", Value: job.Plate},
		{Key: "vehicle", Value: job.VehicleLabel},
		{Key: "status_from", ValueKey: "ai.confirm.values." + job.Status},
		{Key: "status_to", ValueKey: "ai.confirm.values." + to},
		{Key: "payment_status", ValueKey: "ai.confirm.values." + job.PaymentStatus},
	}
	var warnings []string
	if mode == "void" {
		warnings = append(warnings, "payment_reversed")
		for _, p := range detail.Payments {
			if p.Status == "posted" {
				fields = append(fields, Field{Key: "reversed_payment", Value: FormatMoney(p.Amount, p.Currency) + " · " + p.Method})
			}
		}
	}
	if stock := returnedStock(detail); len(stock) > 0 {
		fields = append(fields, Field{Key: "stock_returned", Value: strings.Join(stock, " · ")})
	}
	return Proposal{
		Input: mustJSON(cancelJobInput{JobUUID: job.UUID.String(), Plate: job.Plate}),
		Preview: Preview{
			Action: "cancel_job", Title: job.Plate + " · " + job.CustomerName, Amount: FormatMoney(job.TotalAmount, job.Currency),
			Fields: fields, Warnings: warnings,
		},
	}, nil
}

// Run implements Tool.
func (t CancelJob) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in cancelJobInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	id, _ := uuid.Parse(in.JobUUID)
	before, err := t.jobs.Get(ctx, id)
	if err != nil {
		return execError(err)
	}
	mode, err := cancelMode(env, before.Job)
	if err != nil {
		return ErrorResult("Not executed: " + err.Error()), nil
	}
	var job jobsusecase.JobDetail
	if mode == "void" {
		job, err = t.jobs.Void(ctx, id)
	} else {
		job, err = t.jobs.Cancel(ctx, id)
	}
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "conflict") {
			return ErrorResult("Not executed: the job's status or payment changed meanwhile."), nil
		}
		return execError(err)
	}
	out := map[string]any{
		"done": true, "job_uuid": job.UUID.String(), "plate": job.Plate, "status": job.Status,
		"payment_status": job.PaymentStatus, "stock_returned": returnedStock(before),
	}
	if mode == "void" {
		var reversed []map[string]any
		for _, p := range before.Payments {
			if p.Status != "posted" {
				continue
			}
			r := map[string]any{"method": p.Method, "amount": FormatMoney(p.Amount, p.Currency)}
			if p.FinanceTransactionUUID != nil {
				r["voided_finance_transaction_uuid"] = p.FinanceTransactionUUID.String()
			}
			if p.CariEntryUUID != nil {
				r["voided_cari_entry_uuid"] = p.CariEntryUUID.String()
			}
			if p.FinanceAccountUUID != nil {
				for k, v := range t.pay.accountBalance(ctx, env, *p.FinanceAccountUUID) {
					r[k] = v
				}
			}
			if p.Method == "cari" {
				for k, v := range t.pay.cariBalance(ctx, env, job.CustomerUUID) {
					r[k] = v
				}
			}
			reversed = append(reversed, r)
		}
		out["reversed_payments"] = reversed
	}
	res := JSONResult(out, "ai.tool_summary.job_cancelled", map[string]any{"plate": job.Plate})
	res.Link = &Link{Kind: "job", UUID: job.UUID.String()}
	return res, nil
}

// ---------------------------------------------------------------- quick job

// QuickJob is the walk-in flow in one confirmable action: find or create the
// customer and vehicle, open the job and optionally take the payment.
type QuickJob struct {
	customers CustomersWriter
	search    CustomerSearchStore
	vehicles  VehicleCatalog
	jobs      JobsWriter
	catalog   CatalogLookup
	pay       jobPayment
}

var quickJobSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"plate":              map[string]any{"type": "string", "minLength": 2, "maxLength": 16, "description": "Vehicle plate (spaces and case do not matter)."},
		"customer_name":      map[string]any{"type": "string", "maxLength": 150, "description": "Needed when the customer is new."},
		"phone":              map[string]any{"type": "string", "maxLength": 32, "description": "Customer phone; used to find an existing customer."},
		"customer_uuid":      map[string]any{"type": "string", "format": "uuid", "description": "Use this existing customer (e.g. after the tool listed candidates)."},
		"allow_new_customer": map[string]any{"type": "boolean", "description": "Create a new customer even though customers with the same name exist."},
		"model_uuid":         map[string]any{"type": "string", "format": "uuid", "description": "Vehicle model from search_vehicle_models (needed only for a new vehicle)."},
		"brand":              map[string]any{"type": "string", "maxLength": 60, "description": "Alternative to model_uuid: brand name, e.g. Renault."},
		"model":              map[string]any{"type": "string", "maxLength": 80, "description": "Alternative to model_uuid: model name, e.g. Clio."},
		"year":               map[string]any{"type": "integer", "minimum": 1950, "maximum": 2100, "description": "Model year (needed for a new vehicle)."},
		"services":           jobServicesSchema,
		"notes":              map[string]any{"type": "string", "maxLength": 500},
		"payment_method":     map[string]any{"type": "string", "enum": jobPaymentValues, "description": "Also take the payment now (cash, card, transfer, cari). Omit to leave the job unpaid."},
		"finance_account":    map[string]any{"type": "string", "maxLength": 100, "description": "Account for cash/card/transfer; omit for the default."},
	},
	"required":             []string{"plate", "services"},
	"additionalProperties": false,
}

type quickJobInput struct {
	Plate            string            `json:"plate"`
	CustomerName     string            `json:"customer_name,omitempty"`
	Phone            string            `json:"phone,omitempty"`
	CustomerUUID     string            `json:"customer_uuid,omitempty"`
	AllowNewCustomer bool              `json:"allow_new_customer,omitempty"`
	ModelUUID        string            `json:"model_uuid,omitempty"`
	Brand            string            `json:"brand,omitempty"`
	Model            string            `json:"model,omitempty"`
	Year             int               `json:"year,omitempty"`
	Services         []jobServiceInput `json:"services"`
	Notes            string            `json:"notes,omitempty"`
	PaymentMethod    string            `json:"payment_method,omitempty"`
	FinanceAccount   string            `json:"finance_account,omitempty"`
}

// Spec implements Tool.
func (QuickJob) Spec() Spec {
	return Spec{
		Name: "quick_job",
		Description: "Propose the whole walk-in flow in one action: find the customer by plate or phone (or create them), add the vehicle if it is new, " +
			"open the job with catalog services (optional price overrides) and optionally take the payment. When several customers match it returns " +
			"the candidates instead of guessing; pass customer_uuid then. The proposal lists what will be created and what is reused. Shows a confirmation card.",
		InputSchema:          quickJobSchema,
		Permissions:          []string{rbac.PermTenantCustomersWrite, rbac.PermTenantCustomersRead, rbac.PermTenantJobsWrite, rbac.PermTenantCatalogRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// phoneKey is the phone match key: the last 10 digits ("" when too short).
func phoneKey(phone string) string {
	d := DigitsOnly(phone)
	if len(d) > 10 {
		d = d[len(d)-10:]
	}
	if len(d) < 7 {
		return ""
	}
	return d
}

func candidateLabel(r db.AIFindCustomersByPhoneOrPlateRow) string {
	s := fmt.Sprintf("%s %s", r.Uuid, DataText(r.Name, 60))
	if r.Phone != "" {
		s += " " + DataText(r.Phone, 32)
	}
	if r.Plates != "" {
		s += " [" + DataText(r.Plates, 80) + "]"
	}
	return s
}

// resolveModel finds the catalog model for a new vehicle.
func resolveModel(ctx context.Context, vehicles VehicleCatalog, modelUUID, brand, model string, year int) (vehiclecatalogusecase.ModelSummary, error) {
	var m vehiclecatalogusecase.ModelSummary
	if id, err := uuid.Parse(strings.TrimSpace(modelUUID)); err == nil {
		got, err := vehicles.GetModel(ctx, id)
		if err != nil {
			return m, inputErr("model_uuid not found in the vehicle catalog; use search_vehicle_models")
		}
		m = got
	} else {
		q := strings.TrimSpace(brand + " " + model)
		if strings.TrimSpace(model) == "" {
			return m, inputErr("the vehicle is new: pass model_uuid (search_vehicle_models) or brand + model, and year")
		}
		rows, err := vehicles.SearchModels(ctx, q, 0, 30)
		if err != nil {
			return m, err
		}
		label := func(r vehiclecatalogusecase.ModelSummary) string { return r.BrandName + " " + r.ModelName }
		want := FoldTR(model)
		var exact []vehiclecatalogusecase.ModelSummary
		for _, r := range rows {
			if FoldTR(r.ModelName) == want {
				exact = append(exact, r)
			}
		}
		switch {
		case len(exact) == 1:
			m = exact[0]
		case len(exact) == 0 && len(rows) == 1:
			m = rows[0]
		case len(rows) == 0:
			return m, inputErr("no vehicle model matches %q; use search_vehicle_models", q)
		default:
			pool := exact
			if len(pool) == 0 {
				pool = rows
			}
			return m, inputErr("vehicle model %q is ambiguous: %s; pass model_uuid from search_vehicle_models", q,
				names(pool, func(r vehiclecatalogusecase.ModelSummary) string { return label(r) + " " + r.ModelUUID.String() }, 8))
		}
	}
	if year == 0 {
		return m, inputErr("pass year for %s %s (catalog years: %s)", m.BrandName, m.ModelName, yearsText(m.Years))
	}
	for _, y := range m.Years {
		if y == year {
			return m, nil
		}
	}
	return m, inputErr("%s %s has no model year %d in the catalog (years: %s)", m.BrandName, m.ModelName, year, yearsText(m.Years))
}

func yearsText(ys []int) string {
	if len(ys) == 0 {
		return "none"
	}
	if len(ys) == 1 {
		return fmt.Sprint(ys[0])
	}
	return fmt.Sprintf("%d–%d", ys[0], ys[len(ys)-1])
}

// quickPlan is what quick_job will do.
type quickPlan struct {
	customer    *customersusecase.CustomerDetail // nil = create
	vehicle     *customersusecase.Vehicle        // nil = add
	model       vehiclecatalogusecase.ModelSummary
	warnings    []string
	phoneDiffer bool
}

func (t QuickJob) resolveParty(ctx context.Context, env Env, in *quickJobInput) (quickPlan, error) {
	var plan quickPlan
	key := PlateKey(in.Plate)
	rows, err := t.search.AIFindCustomersByPhoneOrPlate(ctx, db.AIFindCustomersByPhoneOrPlateParams{
		OrganizationID: env.Scope.InternalID, PhoneDigits: phoneKey(in.Phone), Plate: key, LimitCount: 10,
	})
	if err != nil {
		return plan, err
	}
	var byPlate *db.AIFindCustomersByPhoneOrPlateRow
	var byPhone []db.AIFindCustomersByPhoneOrPlateRow
	for i := range rows {
		if rows[i].PlateVehicleUuid != uuid.Nil {
			byPlate = &rows[i]
		} else if rows[i].PhoneMatch {
			byPhone = append(byPhone, rows[i])
		}
	}
	load := func(id uuid.UUID) (customersusecase.CustomerDetail, error) {
		c, err := t.customers.Get(ctx, id)
		if err != nil {
			return c, proposalError(err)
		}
		return c, nil
	}
	reqID, hasReq := uuid.Nil, false
	if id, err := uuid.Parse(strings.TrimSpace(in.CustomerUUID)); err == nil {
		reqID, hasReq = id, true
	}
	switch {
	case byPlate != nil:
		if hasReq && reqID != byPlate.Uuid {
			return plan, inputErr("plate %s already belongs to %s (%s), not to customer_uuid %s", displayPlate(in.Plate), DataText(byPlate.Name, 60), byPlate.Uuid, reqID)
		}
		c, err := load(byPlate.Uuid)
		if err != nil {
			return plan, err
		}
		plan.customer = &c
		if pk := phoneKey(in.Phone); pk != "" && !byPlate.PhoneMatch {
			plan.warnings = append(plan.warnings, "phone_differs")
			plan.phoneDiffer = true
		}
		if n := strings.TrimSpace(in.CustomerName); n != "" && FoldTR(n) != FoldTR(c.Name) {
			plan.warnings = append(plan.warnings, "name_differs")
		}
	case hasReq:
		c, err := load(reqID)
		if err != nil {
			return plan, err
		}
		plan.customer = &c
	case len(byPhone) == 1:
		c, err := load(byPhone[0].Uuid)
		if err != nil {
			return plan, err
		}
		plan.customer = &c
		if n := strings.TrimSpace(in.CustomerName); n != "" && FoldTR(n) != FoldTR(c.Name) {
			plan.warnings = append(plan.warnings, "name_differs")
		}
	case len(byPhone) > 1:
		return plan, inputErr("several customers have phone %s: %s; pass customer_uuid", in.Phone, names(byPhone, candidateLabel, 6))
	default:
		name := strings.TrimSpace(in.CustomerName)
		if len([]rune(name)) < 2 {
			return plan, inputErr("no customer found for plate %s or this phone; pass customer_name (and phone) to create one, or customer_uuid", displayPlate(in.Plate))
		}
		if !in.AllowNewCustomer {
			same, err := t.search.AISearchCustomers(ctx, db.AISearchCustomersParams{OrganizationID: env.Scope.InternalID, Folded: FoldTR(name), LimitCount: 5})
			if err != nil {
				return plan, err
			}
			var exact []db.AISearchCustomersRow
			for _, r := range same {
				if FoldTR(r.Name) == FoldTR(name) {
					exact = append(exact, r)
				}
			}
			if len(exact) > 0 {
				return plan, inputErr("customers named %q already exist: %s; pass customer_uuid to use one, or allow_new_customer=true to create a new customer", name,
					names(exact, func(r db.AISearchCustomersRow) string {
						return fmt.Sprintf("%s %s %s [%s]", r.Uuid, DataText(r.Name, 60), DataText(r.Phone, 32), DataText(r.Plates, 80))
					}, 5))
			}
		}
	}
	if plan.customer != nil {
		for i, v := range plan.customer.Vehicles {
			if PlateKey(v.Plate) == key {
				plan.vehicle = &plan.customer.Vehicles[i]
			}
		}
	}
	if plan.vehicle == nil {
		m, err := resolveModel(ctx, t.vehicles, in.ModelUUID, in.Brand, in.Model, in.Year)
		if err != nil {
			return plan, err
		}
		plan.model = m
		in.ModelUUID = m.ModelUUID.String()
	}
	return plan, nil
}

// Propose implements ActionTool.
func (t QuickJob) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in quickJobInput
	if err := decodeInput(quickJobSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	if len(PlateKey(in.Plate)) < 2 {
		return Proposal{}, inputErr("plate is invalid")
	}
	in.CustomerName, in.Phone, in.Notes = trimmed(in.CustomerName, 150), trimmed(in.Phone, 32), trimmed(in.Notes, 500)
	plan, err := t.resolveParty(ctx, env, &in)
	if err != nil {
		return Proposal{}, err
	}
	norm, lines, total, cur, err := resolveJobLines(ctx, t.catalog, in.Services)
	if err != nil {
		return Proposal{}, err
	}
	in.Services = norm
	in.Plate = displayPlate(in.Plate)
	in.Brand, in.Model = "", ""

	var fields []Field
	title := in.Plate
	if plan.customer != nil {
		in.CustomerUUID = plan.customer.UUID.String()
		in.CustomerName = plan.customer.Name
		title += " · " + plan.customer.Name
		fields = append(fields,
			Field{Key: "customer", Value: plan.customer.Name},
			Field{Key: "customer_action", ValueKey: "ai.confirm.values.reuse_existing"})
		if plan.customer.Phone != "" {
			fields = append(fields, Field{Key: "phone", Value: plan.customer.Phone})
		}
	} else {
		in.CustomerUUID = ""
		title += " · " + in.CustomerName
		fields = append(fields,
			Field{Key: "customer", Value: in.CustomerName},
			Field{Key: "customer_action", ValueKey: "ai.confirm.values.create_new"})
		if in.Phone != "" {
			fields = append(fields, Field{Key: "phone", Value: in.Phone})
		}
	}
	fields = append(fields, Field{Key: "plate", Value: in.Plate})
	if plan.vehicle != nil {
		in.ModelUUID, in.Year = "", 0
		fields = append(fields,
			Field{Key: "vehicle", Value: strings.TrimSpace(plan.vehicle.BrandName + " " + plan.vehicle.ModelName)},
			Field{Key: "vehicle_action", ValueKey: "ai.confirm.values.reuse_existing"})
	} else {
		fields = append(fields,
			Field{Key: "vehicle", Value: fmt.Sprintf("%s %s (%d)", plan.model.BrandName, plan.model.ModelName, in.Year)},
			Field{Key: "vehicle_action", ValueKey: "ai.confirm.values.create_new"})
	}
	fields = append(fields, Field{Key: "services", Value: jobLinesText(lines, cur)})
	if in.Notes != "" {
		fields = append(fields, Field{Key: "notes", Value: in.Notes})
	}
	warnings := plan.warnings
	edit := []EditField{{Key: "notes", Type: "text", Value: in.Notes}}
	if in.PaymentMethod != "" {
		custUUID := uuid.Nil
		if plan.customer != nil {
			custUUID = plan.customer.UUID
		}
		pp, err := t.pay.plan(ctx, env, custUUID, total.FloatString(2), cur, in.PaymentMethod, in.FinanceAccount)
		if err != nil {
			return Proposal{}, err
		}
		if in.PaymentMethod == "cari" {
			in.FinanceAccount = ""
		} else {
			in.FinanceAccount = pp.Account.UUID.String()
		}
		fields = append(fields, pp.Fields...)
		edit = append(edit, pp.Edit...)
	} else {
		in.FinanceAccount = ""
		fields = append(fields, Field{Key: "payment_status", ValueKey: "ai.confirm.values.unpaid"})
	}
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "quick_job", Title: title, Amount: FormatMoney(total.FloatString(2), cur),
			Fields: fields, Warnings: warnings, Edit: edit,
		},
	}, nil
}

// Run implements Tool. Steps run in order (customer + vehicle, job, payment);
// each step is atomic in its module. If a later step fails the result says
// exactly what was already saved, and a failed payment leaves an unpaid job,
// never a half-booked payment.
func (t QuickJob) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in quickJobInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	key := PlateKey(in.Plate)
	var done []string
	fail := func(step string, err error) (Result, error) {
		msg := "internal error"
		if pe := proposalError(err); pe != nil {
			if ie, ok := AsInputError(pe); ok {
				msg = ie.Msg
			}
		}
		prefix := "Not executed"
		if len(done) > 0 {
			prefix = "Partly executed: " + strings.Join(done, "; ") + ". Stopped"
		}
		return ErrorResult(fmt.Sprintf("%s at step %q: %s.", prefix, step, msg)), nil
	}
	customer := map[string]any{}
	vehicle := map[string]any{"plate": in.Plate}
	var cust customersusecase.CustomerDetail
	var err error
	if id, perr := uuid.Parse(in.CustomerUUID); perr == nil {
		if cust, err = t.customers.Get(ctx, id); err != nil {
			return fail("customer", err)
		}
		customer["created"] = false
	} else {
		mid, _ := uuid.Parse(in.ModelUUID)
		cust, err = t.customers.Create(ctx, customersusecase.CreateInput{
			Name: in.CustomerName, Phone: in.Phone, Kind: "individual",
			Vehicle: &customersusecase.CreateVehicleInput{Plate: in.Plate, ModelUUID: mid, Year: in.Year},
		})
		if err != nil {
			return fail("create customer", err)
		}
		customer["created"] = true
		vehicle["created"] = true
		done = append(done, fmt.Sprintf("customer %s created (%s) with vehicle %s", cust.Name, cust.UUID, in.Plate))
	}
	customer["uuid"], customer["name"] = cust.UUID.String(), DataText(cust.Name, maxNameChars)
	var vid uuid.UUID
	for _, v := range cust.Vehicles {
		if PlateKey(v.Plate) == key {
			vid = v.UUID
			vehicle["uuid"], vehicle["vehicle"] = v.UUID.String(), strings.TrimSpace(v.BrandName+" "+v.ModelName)
		}
	}
	if vid == uuid.Nil {
		mid, perr := uuid.Parse(in.ModelUUID)
		if perr != nil {
			return fail("add vehicle", inputErr("the vehicle model is missing; run quick_job again"))
		}
		v, err := t.customers.AddVehicle(ctx, cust.UUID, customersusecase.CreateVehicleInput{Plate: in.Plate, ModelUUID: mid, Year: in.Year})
		if err != nil {
			return fail("add vehicle", err)
		}
		vid = v.UUID
		vehicle["uuid"], vehicle["vehicle"], vehicle["created"] = v.UUID.String(), v.BrandName+" "+v.ModelName, true
		done = append(done, fmt.Sprintf("vehicle %s added to %s", v.Plate, cust.Name))
	} else if _, ok := vehicle["created"]; !ok {
		vehicle["created"] = false
	}
	job, err := t.jobs.Create(ctx, jobsusecase.CreateInput{CustomerUUID: cust.UUID, VehicleUUID: vid, Notes: in.Notes, Lines: jobCreateLines(in.Services)})
	if err != nil {
		return fail("open job", err)
	}
	done = append(done, fmt.Sprintf("job %s opened (%s, %s)", job.UUID, job.Plate, FormatMoney(job.TotalAmount, job.Currency)))
	rows, _ := activeServices(ctx, t.catalog)
	out := map[string]any{"done": true, "customer": customer, "vehicle": vehicle, "job": jobResult(job, catalogByUUID(rows))}
	if in.PaymentMethod != "" {
		paid, err := closeJob(ctx, t.jobs, job.UUID, in.PaymentMethod, in.FinanceAccount)
		if err != nil {
			r, _ := fail("take payment", err)
			r.Content += " The job is open and unpaid; take the payment with record_job_payment job_uuid=" + job.UUID.String() + "."
			return r, nil
		}
		out["job"] = jobResult(paid, catalogByUUID(rows))
		out["payment"] = t.pay.paymentResult(ctx, env, paid, in.PaymentMethod)
	}
	res := JSONResult(out, "ai.tool_summary.job_created", map[string]any{"plate": job.Plate})
	res.Link = &Link{Kind: "job", UUID: job.UUID.String()}
	return res, nil
}
