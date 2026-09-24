package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	catalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/catalog/usecase"
	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	salesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/sales/usecase"
	vehiclecatalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// Narrow operations service interfaces.
type (
	CustomersWriter interface {
		Get(ctx context.Context, id uuid.UUID) (customersusecase.CustomerDetail, error)
		Create(ctx context.Context, in customersusecase.CreateInput) (customersusecase.CustomerDetail, error)
		AddVehicle(ctx context.Context, customerUUID uuid.UUID, in customersusecase.CreateVehicleInput) (customersusecase.Vehicle, error)
	}
	VehicleCatalog interface {
		SearchOptions(ctx context.Context, q string, limit int) ([]vehiclecatalogusecase.CatalogOption, error)
	}
	VehicleOptionStore interface {
		GetVehicleCatalogOption(ctx context.Context, arg db.GetVehicleCatalogOptionParams) (db.GetVehicleCatalogOptionRow, error)
	}
	JobsWriter interface {
		JobsReader
		Get(ctx context.Context, id uuid.UUID) (jobsusecase.JobDetail, error)
		Create(ctx context.Context, in jobsusecase.CreateInput) (jobsusecase.JobDetail, error)
		MarkDone(ctx context.Context, id uuid.UUID) (jobsusecase.JobDetail, error)
		MarkDelivered(ctx context.Context, id uuid.UUID) (jobsusecase.JobDetail, error)
	}
	CatalogLookup interface {
		CatalogReader
		ListServices(ctx context.Context, limit, offset int32, filters catalogusecase.ServiceFilters) ([]catalogusecase.ServiceItem, int64, error)
	}
	SalesWriter interface {
		Create(ctx context.Context, in salesusecase.CreateInput) (salesusecase.SaleDetail, error)
	}
)

// ---------------------------------------------------------------- create customer

// CreateCustomer adds a customer (with a cari account).
type CreateCustomer struct {
	customers CustomersWriter
	search    CustomerSearchStore
}

var createCustomerSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"name":  map[string]any{"type": "string", "minLength": 2, "maxLength": 150, "description": "Full name or company title."},
		"phone": map[string]any{"type": "string", "maxLength": 32},
		"email": map[string]any{"type": "string", "maxLength": 200},
		"kind":  map[string]any{"type": "string", "enum": []string{"individual", "company"}, "description": "Default individual."},
		"notes": map[string]any{"type": "string", "maxLength": 500},
	},
	"required":             []string{"name"},
	"additionalProperties": false,
}

type createCustomerInput struct {
	Name  string `json:"name"`
	Phone string `json:"phone,omitempty"`
	Email string `json:"email,omitempty"`
	Kind  string `json:"kind,omitempty"`
	Notes string `json:"notes,omitempty"`
}

// Spec implements Tool.
func (CreateCustomer) Spec() Spec {
	return Spec{
		Name:                 "create_customer",
		Description:          "Propose adding a new customer. Search first (search_customers) to avoid duplicates. Shows a confirmation card.",
		InputSchema:          createCustomerSchema,
		Permissions:          []string{rbac.PermTenantCustomersWrite, rbac.PermTenantCustomersRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// Propose implements ActionTool.
func (t CreateCustomer) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in createCustomerInput
	if err := decodeInput(createCustomerSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	in.Name, in.Phone, in.Email, in.Notes = trimmed(in.Name, 150), trimmed(in.Phone, 32), trimmed(in.Email, 200), trimmed(in.Notes, 500)
	if len([]rune(in.Name)) < 2 {
		return Proposal{}, inputErr("name is required")
	}
	if in.Kind == "" {
		in.Kind = "individual"
	}
	var warnings []string
	if t.search != nil {
		params := db.AISearchCustomersParams{OrganizationID: env.Scope.InternalID, Folded: FoldTR(in.Name), LimitCount: 3}
		if d := DigitsOnly(in.Phone); len(d) >= 7 {
			params.Digits = d
		}
		if rows, err := t.search.AISearchCustomers(ctx, params); err == nil && len(rows) > 0 {
			warnings = append(warnings, "possible_duplicate")
		}
	}
	fields := []Field{{Key: "name", Value: in.Name}, {Key: "kind", ValueKey: "ai.confirm.values." + in.Kind}}
	if in.Phone != "" {
		fields = append(fields, Field{Key: "phone", Value: in.Phone})
	}
	if in.Email != "" {
		fields = append(fields, Field{Key: "email", Value: in.Email})
	}
	if in.Notes != "" {
		fields = append(fields, Field{Key: "notes", Value: in.Notes})
	}
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "create_customer", Title: in.Name, Fields: fields, Warnings: warnings,
			Edit: []EditField{
				{Key: "name", Type: "text", Value: in.Name, Required: true},
				{Key: "phone", Type: "text", Value: in.Phone},
				{Key: "email", Type: "text", Value: in.Email},
				{Key: "notes", Type: "text", Value: in.Notes},
			},
		},
	}, nil
}

// Run implements Tool.
func (t CreateCustomer) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in createCustomerInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	c, err := t.customers.Create(ctx, customersusecase.CreateInput{Name: in.Name, Phone: in.Phone, Email: in.Email, Kind: in.Kind, Notes: in.Notes})
	if err != nil {
		return execError(err)
	}
	out := map[string]any{"done": true, "customer_uuid": c.UUID.String(), "name": c.Name}
	if c.CariAccountUUID != nil {
		out["cari_account_uuid"] = c.CariAccountUUID.String()
	}
	res := JSONResult(out, "ai.tool_summary.customer_created", map[string]any{"name": c.Name})
	res.Link = &Link{Kind: "customer", UUID: c.UUID.String()}
	return res, nil
}

// ---------------------------------------------------------------- vehicle models (read)

// SearchVehicleModels looks up brand/model/year options in the vehicle catalog.
type SearchVehicleModels struct{ catalog VehicleCatalog }

var vehicleModelsSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"query": map[string]any{"type": "string", "minLength": 2, "maxLength": 80, "description": "Brand and/or model, e.g. \"Renault Clio\"."},
		"year":  map[string]any{"type": "integer", "minimum": 1950, "maximum": 2100, "description": "Only this model year."},
	},
	"required":             []string{"query"},
	"additionalProperties": false,
}

// Spec implements Tool.
func (SearchVehicleModels) Spec() Spec {
	return Spec{
		Name:        "search_vehicle_models",
		Description: "Find vehicle brand/model/year options in the catalog (model_uuid + year) before add_customer_vehicle.",
		InputSchema: vehicleModelsSchema,
		Permissions: []string{rbac.PermTenantCustomersRead},
		Feature:     FeatureActions,
		Kind:        KindRead,
	}
}

// Run implements Tool.
func (t SearchVehicleModels) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Query string `json:"query"`
		Year  int    `json:"year"`
	}
	if err := Decode(vehicleModelsSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	q := strings.TrimSpace(in.Query)
	if in.Year > 0 {
		q += " " + strconv.Itoa(in.Year)
	}
	opts, err := t.catalog.SearchOptions(ctx, q, 20)
	if err != nil {
		return Result{}, err
	}
	type model struct {
		ModelUUID string `json:"model_uuid"`
		Name      string `json:"name"`
		Years     []int  `json:"years"`
	}
	byModel := map[uuid.UUID]*model{}
	var order []uuid.UUID
	for _, o := range opts {
		if in.Year > 0 && o.Year != in.Year {
			continue
		}
		m, ok := byModel[o.ModelUUID]
		if !ok {
			m = &model{ModelUUID: o.ModelUUID.String(), Name: o.BrandName + " " + o.ModelName}
			byModel[o.ModelUUID] = m
			order = append(order, o.ModelUUID)
		}
		m.Years = append(m.Years, o.Year)
	}
	items := make([]model, 0, len(order))
	for _, id := range order {
		items = append(items, *byModel[id])
	}
	return JSONResult(map[string]any{"models": items}, "ai.tool_summary.models_found", map[string]any{"count": len(items)}), nil
}

// ---------------------------------------------------------------- add vehicle

// AddCustomerVehicle adds a vehicle to an existing customer.
type AddCustomerVehicle struct {
	customers CustomersWriter
	options   VehicleOptionStore
}

var addVehicleSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"customer_uuid": map[string]any{"type": "string", "format": "uuid"},
		"plate":         map[string]any{"type": "string", "minLength": 2, "maxLength": 16},
		"model_uuid":    map[string]any{"type": "string", "format": "uuid", "description": "From search_vehicle_models."},
		"year":          map[string]any{"type": "integer", "minimum": 1950, "maximum": 2100},
	},
	"required":             []string{"customer_uuid", "plate", "model_uuid", "year"},
	"additionalProperties": false,
}

type addVehicleInput struct {
	CustomerUUID string `json:"customer_uuid"`
	Plate        string `json:"plate"`
	ModelUUID    string `json:"model_uuid"`
	Year         int    `json:"year"`
}

// Spec implements Tool.
func (AddCustomerVehicle) Spec() Spec {
	return Spec{
		Name:                 "add_customer_vehicle",
		Description:          "Propose adding a vehicle (plate + catalog model/year) to an existing customer. Shows a confirmation card.",
		InputSchema:          addVehicleSchema,
		Permissions:          []string{rbac.PermTenantCustomersWrite, rbac.PermTenantCustomersRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

func displayPlate(p string) string { return strings.ToUpper(strings.Join(strings.Fields(p), " ")) }

// Propose implements ActionTool.
func (t AddCustomerVehicle) Propose(ctx context.Context, _ Env, raw json.RawMessage) (Proposal, error) {
	var in addVehicleInput
	if err := decodeInput(addVehicleSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	cid, _ := uuid.Parse(in.CustomerUUID)
	cust, err := t.customers.Get(ctx, cid)
	if err != nil {
		return Proposal{}, proposalError(err)
	}
	key := PlateKey(in.Plate)
	if len(key) < 2 {
		return Proposal{}, inputErr("plate is invalid")
	}
	for _, v := range cust.Vehicles {
		if PlateKey(v.Plate) == key {
			return Proposal{}, inputErr("%s already has plate %s", cust.Name, v.Plate)
		}
	}
	mid, _ := uuid.Parse(in.ModelUUID)
	opt, err := t.options.GetVehicleCatalogOption(ctx, db.GetVehicleCatalogOptionParams{Uuid: mid, Year: int16(in.Year)})
	if err != nil {
		return Proposal{}, inputErr("model_uuid/year not found in the vehicle catalog; use search_vehicle_models")
	}
	in.Plate = displayPlate(in.Plate)
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "add_customer_vehicle", Title: cust.Name,
			Fields: []Field{
				{Key: "customer", Value: cust.Name},
				{Key: "plate", Value: in.Plate},
				{Key: "vehicle", Value: fmt.Sprintf("%s %s (%d)", opt.BrandName, opt.ModelName, in.Year)},
			},
			Edit: []EditField{{Key: "plate", Type: "text", Value: in.Plate, Required: true}},
		},
	}, nil
}

// Run implements Tool.
func (t AddCustomerVehicle) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in addVehicleInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	cid, _ := uuid.Parse(in.CustomerUUID)
	mid, _ := uuid.Parse(in.ModelUUID)
	v, err := t.customers.AddVehicle(ctx, cid, customersusecase.CreateVehicleInput{Plate: in.Plate, ModelUUID: mid, Year: in.Year})
	if err != nil {
		return execError(err)
	}
	res := JSONResult(map[string]any{
		"done": true, "vehicle_uuid": v.UUID.String(), "plate": v.Plate, "vehicle": v.BrandName + " " + v.ModelName,
	}, "ai.tool_summary.vehicle_added", map[string]any{"plate": v.Plate})
	res.Link = &Link{Kind: "customer", UUID: cid.String()}
	return res, nil
}

// ---------------------------------------------------------------- create job

// CreateJob opens a service job (iş emri) for a customer's vehicle.
type CreateJob struct {
	customers CustomersWriter
	jobs      JobsWriter
	catalog   CatalogLookup
}

var createJobSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"customer_uuid": map[string]any{"type": "string", "format": "uuid"},
		"plate":         map[string]any{"type": "string", "maxLength": 16, "description": "Plate of one of the customer's vehicles (optional if the customer has exactly one)."},
		"services": map[string]any{
			"type": "array", "minItems": 1, "maxItems": 10,
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"service": map[string]any{"type": "string", "minLength": 2, "maxLength": 100, "description": "Service name (e.g. \"Dış yıkama\") or uuid."},
					"price":   map[string]any{"type": "number", "minimum": 0, "description": "Override the catalog price."},
					"qty":     map[string]any{"type": "number", "minimum": 0.01, "maximum": 1000},
				},
				"required":             []string{"service"},
				"additionalProperties": false,
			},
		},
		"notes": map[string]any{"type": "string", "maxLength": 500},
	},
	"required":             []string{"customer_uuid", "services"},
	"additionalProperties": false,
}

type jobServiceInput struct {
	Service string   `json:"service"`
	Price   *float64 `json:"price,omitempty"`
	Qty     *float64 `json:"qty,omitempty"`
}

type createJobInput struct {
	CustomerUUID string            `json:"customer_uuid"`
	Plate        string            `json:"plate,omitempty"`
	Services     []jobServiceInput `json:"services"`
	Notes        string            `json:"notes,omitempty"`
	VehicleUUID  string            `json:"vehicle_uuid,omitempty"`
}

// Spec implements Tool.
func (CreateJob) Spec() Spec {
	return Spec{
		Name:                 "create_job",
		Description:          "Propose opening a service job (iş emri) for a customer's vehicle with one or more catalog services. Shows a confirmation card.",
		InputSchema:          createJobSchema,
		Permissions:          []string{rbac.PermTenantJobsWrite, rbac.PermTenantCustomersRead, rbac.PermTenantCatalogRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

func resolveService(ctx context.Context, catalog CatalogLookup, ref string) (catalogusecase.ServiceItem, error) {
	active := true
	name := func(s catalogusecase.ServiceItem) string { return s.Name }
	if id, err := uuid.Parse(strings.TrimSpace(ref)); err == nil {
		rows, _, err := catalog.ListServices(ctx, 100, 0, catalogusecase.ServiceFilters{IsActive: &active})
		if err != nil {
			return catalogusecase.ServiceItem{}, err
		}
		for _, s := range rows {
			if s.UUID == id {
				return s, nil
			}
		}
		return catalogusecase.ServiceItem{}, inputErr("service %s not found", ref)
	}
	rows, _, err := catalog.ListServices(ctx, 100, 0, catalogusecase.ServiceFilters{IsActive: &active})
	if err != nil {
		return catalogusecase.ServiceItem{}, err
	}
	if s, _, ok := matchByName(ref, rows, name); ok {
		return s, nil
	}
	return catalogusecase.ServiceItem{}, inputErr("service %q not found or ambiguous; available services: %s", ref, names(rows, name, 20))
}

// Propose implements ActionTool.
func (t CreateJob) Propose(ctx context.Context, _ Env, raw json.RawMessage) (Proposal, error) {
	var in createJobInput
	if err := decodeInput(createJobSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	cid, _ := uuid.Parse(in.CustomerUUID)
	cust, err := t.customers.Get(ctx, cid)
	if err != nil {
		return Proposal{}, proposalError(err)
	}
	if len(cust.Vehicles) == 0 {
		return Proposal{}, inputErr("%s has no vehicles; add one first (add_customer_vehicle)", cust.Name)
	}
	var vehicle customersusecase.Vehicle
	found := false
	if key := PlateKey(in.Plate); key != "" {
		for _, v := range cust.Vehicles {
			if PlateKey(v.Plate) == key {
				vehicle, found = v, true
			}
		}
	} else if len(cust.Vehicles) == 1 {
		vehicle, found = cust.Vehicles[0], true
	}
	if !found {
		plates := names(cust.Vehicles, func(v customersusecase.Vehicle) string { return v.Plate }, 10)
		return Proposal{}, inputErr("pass the plate of one of %s's vehicles: %s", cust.Name, plates)
	}
	total := new(big.Rat)
	var lines []string
	norm := make([]jobServiceInput, 0, len(in.Services))
	cur := "TRY"
	for _, line := range in.Services {
		svc, err := resolveService(ctx, t.catalog, line.Service)
		if err != nil {
			return Proposal{}, err
		}
		cur = firstNonBlank(svc.Currency, cur)
		price := ratOf(svc.Price)
		if line.Price != nil {
			price = new(big.Rat).SetFloat64(*line.Price)
		}
		qty := big.NewRat(1, 1)
		if line.Qty != nil {
			qty = new(big.Rat).SetFloat64(*line.Qty)
		}
		lineTotal := new(big.Rat).Mul(price, qty)
		total.Add(total, lineTotal)
		label := svc.Name + " " + FormatMoney(lineTotal.FloatString(2), cur)
		if qty.Cmp(big.NewRat(1, 1)) != 0 {
			label = fmt.Sprintf("%s ×%s %s", svc.Name, fmtQty(qty), FormatMoney(lineTotal.FloatString(2), cur))
		}
		lines = append(lines, label)
		norm = append(norm, jobServiceInput{Service: svc.UUID.String(), Price: line.Price, Qty: line.Qty})
	}
	in.Services = norm
	in.Plate = vehicle.Plate
	in.VehicleUUID = vehicle.UUID.String()
	in.Notes = trimmed(in.Notes, 500)
	fields := []Field{
		{Key: "customer", Value: cust.Name},
		{Key: "plate", Value: vehicle.Plate},
		{Key: "vehicle", Value: strings.TrimSpace(vehicle.BrandName + " " + vehicle.ModelName)},
		{Key: "services", Value: strings.Join(lines, " · ")},
	}
	if in.Notes != "" {
		fields = append(fields, Field{Key: "notes", Value: in.Notes})
	}
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "create_job", Title: vehicle.Plate + " · " + cust.Name, Amount: FormatMoney(total.FloatString(2), cur),
			Fields: fields,
			Edit:   []EditField{{Key: "notes", Type: "text", Value: in.Notes}},
		},
	}, nil
}

// Run implements Tool.
func (t CreateJob) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in createJobInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	cid, _ := uuid.Parse(in.CustomerUUID)
	vid, _ := uuid.Parse(in.VehicleUUID)
	lines := make([]jobsusecase.CreateLineInput, 0, len(in.Services))
	for _, l := range in.Services {
		sid, _ := uuid.Parse(l.Service)
		line := jobsusecase.CreateLineInput{ServiceUUID: sid}
		if l.Price != nil {
			p := strconv.FormatFloat(*l.Price, 'f', 2, 64)
			line.UnitPrice = &p
		}
		if l.Qty != nil {
			q := strconv.FormatFloat(*l.Qty, 'f', -1, 64)
			line.Qty = &q
		}
		lines = append(lines, line)
	}
	job, err := t.jobs.Create(ctx, jobsusecase.CreateInput{CustomerUUID: cid, VehicleUUID: vid, Notes: in.Notes, Lines: lines})
	if err != nil {
		return execError(err)
	}
	res := JSONResult(map[string]any{
		"done": true, "job_uuid": job.UUID.String(), "plate": job.Plate, "status": job.Status,
		"total": FormatMoney(job.TotalAmount, job.Currency),
	}, "ai.tool_summary.job_created", map[string]any{"plate": job.Plate})
	res.Link = &Link{Kind: "job", UUID: job.UUID.String()}
	return res, nil
}

// ---------------------------------------------------------------- job status

// UpdateJobStatus marks a job ready (hazır) or delivered (teslim edildi).
type UpdateJobStatus struct{ jobs JobsWriter }

var jobStatusSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"job_uuid": map[string]any{"type": "string", "format": "uuid", "description": "uuid from list_jobs; or pass plate."},
		"plate":    map[string]any{"type": "string", "maxLength": 16, "description": "Plate of an open job (in_progress/ready)."},
		"status":   map[string]any{"type": "string", "enum": []string{"ready", "delivered"}},
	},
	"required":             []string{"status"},
	"additionalProperties": false,
}

type jobStatusInput struct {
	JobUUID string `json:"job_uuid,omitempty"`
	Plate   string `json:"plate,omitempty"`
	Status  string `json:"status"`
}

// Spec implements Tool.
func (UpdateJobStatus) Spec() Spec {
	return Spec{
		Name:                 "update_job_status",
		Description:          "Propose marking a service job ready (hazır, washed and waiting) or delivered (teslim edildi). Identify it by job_uuid or plate. Shows a confirmation card.",
		InputSchema:          jobStatusSchema,
		Permissions:          []string{rbac.PermTenantJobsWrite, rbac.PermTenantJobsRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

func (t UpdateJobStatus) find(ctx context.Context, in jobStatusInput) (jobsusecase.Job, error) {
	if id, err := uuid.Parse(strings.TrimSpace(in.JobUUID)); err == nil {
		d, err := t.jobs.Get(ctx, id)
		if err != nil {
			return jobsusecase.Job{}, proposalError(err)
		}
		return d.Job, nil
	}
	key := PlateKey(in.Plate)
	if key == "" {
		return jobsusecase.Job{}, inputErr("pass job_uuid or plate")
	}
	rows, _, err := t.jobs.List(ctx, 25, 0, jobsusecase.ListFilters{Q: strings.TrimSpace(in.Plate), Sort: "-started_at"})
	if err != nil {
		return jobsusecase.Job{}, err
	}
	var open []jobsusecase.Job
	for _, j := range rows {
		if PlateKey(j.Plate) == key && (j.Status == "in_progress" || j.Status == "ready") {
			open = append(open, j)
		}
	}
	if len(open) == 1 {
		return open[0], nil
	}
	if len(open) == 0 {
		return jobsusecase.Job{}, inputErr("no open job (in_progress/ready) found for plate %s", in.Plate)
	}
	return jobsusecase.Job{}, inputErr("several open jobs for plate %s; pass job_uuid from list_jobs", in.Plate)
}

// Propose implements ActionTool.
func (t UpdateJobStatus) Propose(ctx context.Context, _ Env, raw json.RawMessage) (Proposal, error) {
	var in jobStatusInput
	if err := decodeInput(jobStatusSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	job, err := t.find(ctx, in)
	if err != nil {
		return Proposal{}, err
	}
	switch {
	case in.Status == "ready" && job.Status != "in_progress":
		return Proposal{}, inputErr("job %s is %s; only in_progress jobs can be marked ready", job.Plate, job.Status)
	case in.Status == "delivered" && job.Status != "in_progress" && job.Status != "ready":
		return Proposal{}, inputErr("job %s is %s and cannot be delivered", job.Plate, job.Status)
	}
	var warnings []string
	if in.Status == "delivered" && job.PaymentStatus != "paid" {
		warnings = append(warnings, "unpaid_delivery")
	}
	norm := jobStatusInput{JobUUID: job.UUID.String(), Plate: job.Plate, Status: in.Status}
	return Proposal{
		Input: mustJSON(norm),
		Preview: Preview{
			Action: "update_job_status", Title: job.Plate + " · " + job.CustomerName, Amount: FormatMoney(job.TotalAmount, job.Currency),
			Fields: []Field{
				{Key: "customer", Value: job.CustomerName},
				{Key: "vehicle", Value: job.VehicleLabel},
				{Key: "status_from", ValueKey: "ai.confirm.values." + job.Status},
				{Key: "status_to", ValueKey: "ai.confirm.values." + in.Status},
				{Key: "payment_status", ValueKey: "ai.confirm.values." + job.PaymentStatus},
			},
			Warnings: warnings,
		},
	}, nil
}

// Run implements Tool.
func (t UpdateJobStatus) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in jobStatusInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	id, _ := uuid.Parse(in.JobUUID)
	var job jobsusecase.JobDetail
	var err error
	if in.Status == "ready" {
		job, err = t.jobs.MarkDone(ctx, id)
	} else {
		job, err = t.jobs.MarkDelivered(ctx, id)
	}
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "conflict") {
			return ErrorResult("Not executed: the job's status changed meanwhile."), nil
		}
		return execError(err)
	}
	res := JSONResult(map[string]any{"done": true, "plate": job.Plate, "status": job.Status, "payment_status": job.PaymentStatus},
		"ai.tool_summary.job_updated", map[string]any{"plate": job.Plate})
	res.Link = &Link{Kind: "job", UUID: job.UUID.String()}
	return res, nil
}

// ---------------------------------------------------------------- quick sale

// CreateQuickSale records a retail product sale.
type CreateQuickSale struct {
	sales     SalesWriter
	catalog   CatalogLookup
	finance   FinanceReader
	customers CustomersWriter
}

var quickSaleSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"items": map[string]any{
			"type": "array", "minItems": 1, "maxItems": 10,
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"product":    map[string]any{"type": "string", "minLength": 2, "maxLength": 100, "description": "Product name, SKU or uuid."},
					"qty":        map[string]any{"type": "number", "minimum": 0.01, "maximum": 10000},
					"unit_price": map[string]any{"type": "number", "minimum": 0, "description": "Override the sale price."},
				},
				"required":             []string{"product"},
				"additionalProperties": false,
			},
		},
		"payment_method":  map[string]any{"type": "string", "enum": []string{"cash", "card", "cari"}, "description": "cari = on the customer's account (needs customer_uuid)."},
		"finance_account": map[string]any{"type": "string", "maxLength": 100, "description": "Cash/bank account for cash or card; omit for the default."},
		"customer_uuid":   map[string]any{"type": "string", "format": "uuid"},
		"notes":           map[string]any{"type": "string", "maxLength": 300},
	},
	"required":             []string{"items", "payment_method"},
	"additionalProperties": false,
}

type saleItemInput struct {
	Product   string   `json:"product"`
	Qty       *float64 `json:"qty,omitempty"`
	UnitPrice *float64 `json:"unit_price,omitempty"`
}

type quickSaleInput struct {
	Items          []saleItemInput `json:"items"`
	PaymentMethod  string          `json:"payment_method"`
	FinanceAccount string          `json:"finance_account,omitempty"`
	CustomerUUID   string          `json:"customer_uuid,omitempty"`
	Notes          string          `json:"notes,omitempty"`
}

// Spec implements Tool.
func (CreateQuickSale) Spec() Spec {
	return Spec{
		Name:                 "create_quick_sale",
		Description:          "Propose a retail product sale (hızlı satış) paid by cash, card or on the customer's cari account. Stock is decreased. Shows a confirmation card.",
		InputSchema:          quickSaleSchema,
		Permissions:          []string{rbac.PermTenantSalesWrite, rbac.PermTenantCatalogRead, rbac.PermTenantFinanceRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

func resolveProduct(ctx context.Context, catalog CatalogLookup, ref string) (catalogusecase.Product, error) {
	active := true
	name := func(p catalogusecase.Product) string { return p.Name }
	ref = strings.TrimSpace(ref)
	if id, err := uuid.Parse(ref); err == nil {
		rows, _, err := catalog.ListProducts(ctx, 100, 0, catalogusecase.ProductFilters{IsActive: &active})
		if err != nil {
			return catalogusecase.Product{}, err
		}
		for _, p := range rows {
			if p.UUID == id {
				return p, nil
			}
		}
		return catalogusecase.Product{}, inputErr("product %s not found", ref)
	}
	rows, _, err := catalog.ListProducts(ctx, 25, 0, catalogusecase.ProductFilters{Q: ref, IsActive: &active})
	if err != nil {
		return catalogusecase.Product{}, err
	}
	for _, p := range rows {
		if (p.SKU != nil && strings.EqualFold(*p.SKU, ref)) || (p.Barcode != nil && *p.Barcode == ref) {
			return p, nil
		}
	}
	if len(rows) == 1 {
		return rows[0], nil
	}
	if p, _, ok := matchByName(ref, rows, name); ok {
		return p, nil
	}
	if len(rows) == 0 {
		return catalogusecase.Product{}, inputErr("product %q not found; use search_products", ref)
	}
	return catalogusecase.Product{}, inputErr("product %q is ambiguous: %s", ref, names(rows, name, 10))
}

// Propose implements ActionTool.
func (t CreateQuickSale) Propose(ctx context.Context, _ Env, raw json.RawMessage) (Proposal, error) {
	var in quickSaleInput
	if err := decodeInput(quickSaleSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	cur := "TRY"
	total := new(big.Rat)
	var lines []string
	var warnings []string
	norm := make([]saleItemInput, 0, len(in.Items))
	for _, it := range in.Items {
		p, err := resolveProduct(ctx, t.catalog, it.Product)
		if err != nil {
			return Proposal{}, err
		}
		cur = firstNonBlank(p.Currency, cur)
		price := ratOf(p.SalePrice)
		if it.UnitPrice != nil {
			price = new(big.Rat).SetFloat64(*it.UnitPrice)
		}
		qty := big.NewRat(1, 1)
		if it.Qty != nil {
			qty = new(big.Rat).SetFloat64(*it.Qty)
		}
		if p.TrackStock && ratOf(p.StockQuantity).Cmp(qty) < 0 {
			return Proposal{}, inputErr("insufficient stock for %s (in stock: %s)", p.Name, p.StockQuantity)
		}
		lineTotal := new(big.Rat).Mul(price, qty)
		total.Add(total, lineTotal)
		lines = append(lines, fmt.Sprintf("%s ×%s %s", p.Name, fmtQty(qty), FormatMoney(lineTotal.FloatString(2), cur)))
		norm = append(norm, saleItemInput{Product: p.UUID.String(), Qty: it.Qty, UnitPrice: it.UnitPrice})
	}
	in.Items = norm
	in.Notes = trimmed(in.Notes, 300)
	fields := []Field{{Key: "items", Value: strings.Join(lines, " · ")}, {Key: "payment_method", ValueKey: "ai.confirm.values." + in.PaymentMethod}}
	title := ""
	if in.CustomerUUID != "" {
		cid, _ := uuid.Parse(in.CustomerUUID)
		c, err := t.customers.Get(ctx, cid)
		if err != nil {
			return Proposal{}, proposalError(err)
		}
		title = c.Name
		fields = append(fields, Field{Key: "customer", Value: c.Name})
	} else if in.PaymentMethod == "cari" {
		return Proposal{}, inputErr("customer_uuid is required for payment_method cari")
	}
	edit := []EditField{}
	if in.PaymentMethod == "cari" {
		in.FinanceAccount = ""
	} else {
		accounts, err := activeAccounts(ctx, t.finance)
		if err != nil {
			return Proposal{}, err
		}
		fa, err := resolveAccount(accounts, in.FinanceAccount, cur, preferredAccountType(in.PaymentMethod), "finance_account")
		if err != nil {
			return Proposal{}, err
		}
		in.FinanceAccount = fa.UUID.String()
		fields = append(fields, Field{Key: "finance_account", Value: fa.Name})
		edit = append(edit,
			EditField{Key: "payment_method", Type: "select", Value: in.PaymentMethod, Options: methodOptions([]string{"cash", "card"}), Required: true},
			EditField{Key: "finance_account", Type: "select", Value: in.FinanceAccount, Options: accountOptions(accounts, cur), Required: true},
		)
	}
	if in.Notes != "" {
		fields = append(fields, Field{Key: "notes", Value: in.Notes})
	}
	edit = append(edit, EditField{Key: "notes", Type: "text", Value: in.Notes})
	if title == "" {
		title = strings.SplitN(lines[0], " ×", 2)[0]
	}
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "create_quick_sale", Title: title, Amount: FormatMoney(total.FloatString(2), cur),
			Fields: fields, Edit: edit, Warnings: warnings,
		},
	}, nil
}

// Run implements Tool.
func (t CreateQuickSale) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in quickSaleInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	lines := make([]salesusecase.CreateLineInput, 0, len(in.Items))
	for _, it := range in.Items {
		pid, _ := uuid.Parse(it.Product)
		line := salesusecase.CreateLineInput{ProductUUID: pid}
		if it.UnitPrice != nil {
			p := strconv.FormatFloat(*it.UnitPrice, 'f', 2, 64)
			line.UnitPrice = &p
		}
		if it.Qty != nil {
			q := strconv.FormatFloat(*it.Qty, 'f', -1, 64)
			line.Qty = &q
		}
		lines = append(lines, line)
	}
	sale := salesusecase.CreateInput{Method: in.PaymentMethod, Notes: in.Notes, Lines: lines}
	if in.CustomerUUID != "" {
		cid, _ := uuid.Parse(in.CustomerUUID)
		sale.CustomerUUID = &cid
	}
	if in.FinanceAccount != "" {
		fid, _ := uuid.Parse(in.FinanceAccount)
		sale.FinanceAccountUUID = &fid
	}
	out, err := t.sales.Create(ctx, sale)
	if err != nil {
		return execError(err)
	}
	res := JSONResult(map[string]any{
		"done": true, "sale_uuid": out.UUID.String(), "total": FormatMoney(out.TotalAmount, out.Currency), "method": out.Method,
	}, "ai.tool_summary.sale_created", map[string]any{"amount": FormatMoney(out.TotalAmount, out.Currency)})
	res.Link = &Link{Kind: "sale", UUID: out.UUID.String()}
	return res, nil
}
