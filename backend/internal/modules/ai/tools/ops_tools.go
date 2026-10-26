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
	vehiclecatalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclebrands/usecase"
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
		SearchModels(ctx context.Context, q string, year, limit int) ([]vehiclecatalogusecase.ModelSummary, error)
		GetModel(ctx context.Context, id uuid.UUID) (vehiclecatalogusecase.ModelSummary, error)
		ModelVariants(ctx context.Context, modelUUID uuid.UUID, year, limit int) ([]vehiclecatalogusecase.ModelVariant, error)
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
		Close(ctx context.Context, id uuid.UUID, in jobsusecase.CloseInput) (jobsusecase.JobDetail, error)
		Cancel(ctx context.Context, id uuid.UUID) (jobsusecase.JobDetail, error)
		Void(ctx context.Context, id uuid.UUID) (jobsusecase.JobDetail, error)
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
		"name":            map[string]any{"type": "string", "minLength": 2, "maxLength": 150, "description": "Full name or company title."},
		"phone":           map[string]any{"type": "string", "maxLength": 32},
		"email":           map[string]any{"type": "string", "maxLength": 200},
		"kind":            map[string]any{"type": "string", "enum": []string{"individual", "company"}, "description": "Default individual."},
		"notes":           map[string]any{"type": "string", "maxLength": 500},
		"plate":           map[string]any{"type": "string", "maxLength": 16, "description": "Optional plate the customer brings: only checked for duplicates (add the vehicle with add_customer_vehicle, or use quick_job)."},
		"allow_duplicate": map[string]any{"type": "boolean", "description": "Create the customer even though possible_duplicates (same phone or plate) were found. Only after the user confirmed it is a different person."},
	},
	"required":             []string{"name"},
	"additionalProperties": false,
}

type createCustomerInput struct {
	Name           string `json:"name"`
	Phone          string `json:"phone,omitempty"`
	Email          string `json:"email,omitempty"`
	Kind           string `json:"kind,omitempty"`
	Notes          string `json:"notes,omitempty"`
	Plate          string `json:"plate,omitempty"`
	AllowDuplicate bool   `json:"allow_duplicate,omitempty"`
}

// Spec implements Tool.
func (CreateCustomer) Spec() Spec {
	return Spec{
		Name: "create_customer",
		Description: "Propose adding a new customer. Customers with the same phone (last 10 digits) or plate are returned as possible_duplicates and nothing is " +
			"created; use the existing customer, or pass allow_duplicate=true once the user confirms it is someone else. Shows a confirmation card.",
		InputSchema:          createCustomerSchema,
		Permissions:          []string{rbac.PermTenantCustomersWrite, rbac.PermTenantCustomersRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// possibleDuplicates lists customers with the same phone or plate.
func possibleDuplicates(ctx context.Context, env Env, search CustomerSearchStore, phone, plate string) ([]map[string]any, error) {
	if search == nil || (phoneKey(phone) == "" && PlateKey(plate) == "") {
		return nil, nil
	}
	rows, err := search.AIFindCustomersByPhoneOrPlate(ctx, db.AIFindCustomersByPhoneOrPlateParams{
		OrganizationID: env.Scope.InternalID, PhoneDigits: phoneKey(phone), Plate: PlateKey(plate), LimitCount: 5,
	})
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		var by []string
		if r.PhoneMatch {
			by = append(by, "phone")
		}
		if r.PlateVehicleUuid != uuid.Nil {
			by = append(by, "plate")
		}
		out = append(out, map[string]any{
			"customer_uuid": r.Uuid.String(), "name": DataText(r.Name, maxNameChars), "phone": DataText(r.Phone, 32),
			"plates": DataText(r.Plates, 120), "matched_by": strings.Join(by, ","),
		})
	}
	return out, nil
}

// Propose implements ActionTool.
func (t CreateCustomer) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in createCustomerInput
	if err := decodeInput(createCustomerSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	in.Name, in.Phone, in.Email, in.Notes = trimmed(in.Name, 150), trimmed(in.Phone, 32), trimmed(in.Email, 200), trimmed(in.Notes, 500)
	in.Plate = trimmed(in.Plate, 16)
	if len([]rune(in.Name)) < 2 {
		return Proposal{}, inputErr("name is required")
	}
	if in.Kind == "" {
		in.Kind = "individual"
	}
	var warnings []string
	dups, err := possibleDuplicates(ctx, env, t.search, in.Phone, in.Plate)
	if err != nil {
		return Proposal{}, err
	}
	if len(dups) > 0 {
		if !in.AllowDuplicate {
			raw, _ := json.Marshal(dups)
			return Proposal{}, inputErr("not created: possible_duplicates (same phone or plate) %s. Use one of these customers (customer_uuid), or call again with allow_duplicate=true if the user confirms this is a different customer", raw)
		}
		warnings = append(warnings, "possible_duplicate")
	} else if t.search != nil {
		params := db.AISearchCustomersParams{OrganizationID: env.Scope.InternalID, Folded: FoldTR(in.Name), LimitCount: 3}
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
func (t CreateCustomer) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in createCustomerInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	if !in.AllowDuplicate {
		// The phone may have been edited on the card: check again.
		if dups, err := possibleDuplicates(ctx, env, t.search, in.Phone, in.Plate); err == nil && len(dups) > 0 {
			raw, _ := json.Marshal(dups)
			return ErrorResult("Not executed: possible_duplicates (same phone or plate) " + string(raw)), nil
		}
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

// SearchVehicleModels looks up the vehicle catalog in two levels: brands and
// models (one row per model with its years), then the variants of one model.
type SearchVehicleModels struct{ catalog VehicleCatalog }

var vehicleModelsSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"query":      map[string]any{"type": "string", "minLength": 2, "maxLength": 80, "description": "Brand and/or model words, e.g. \"Renault Clio\" or \"Renault\"."},
		"brand":      map[string]any{"type": "string", "maxLength": 60, "description": "Brand name (alternative to query)."},
		"model":      map[string]any{"type": "string", "maxLength": 80, "description": "Exact model name: returns that model's variants (trim/engine/package) and years."},
		"model_uuid": map[string]any{"type": "string", "format": "uuid", "description": "A model from an earlier result: returns its variants and years."},
		"year":       map[string]any{"type": "integer", "minimum": 1950, "maximum": 2100, "description": "Only this model year."},
	},
	"additionalProperties": false,
}

// Spec implements Tool.
func (SearchVehicleModels) Spec() Spec {
	return Spec{
		Name: "search_vehicle_models",
		Description: "Find vehicles in the catalog before add_customer_vehicle / quick_job. Without model: brands and models (one row per model_uuid with its years). " +
			"With model (or model_uuid): that model's variants (trim/engine/package names) and years. A customer vehicle is saved as model_uuid + year; variants only help pick the model.",
		InputSchema: vehicleModelsSchema,
		Permissions: []string{rbac.PermTenantCustomersRead},
		Feature:     FeatureActions,
		Kind:        KindRead,
	}
}

type vehicleModelItem struct {
	ModelUUID string `json:"model_uuid"`
	Name      string `json:"name"`
	Brand     string `json:"brand"`
	Model     string `json:"model"`
	Years     []int  `json:"years"`
}

func modelItem(m vehiclecatalogusecase.ModelSummary) vehicleModelItem {
	return vehicleModelItem{ModelUUID: m.ModelUUID.String(), Name: m.BrandName + " " + m.ModelName, Brand: m.BrandName, Model: m.ModelName, Years: m.Years}
}

// Run implements Tool.
func (t SearchVehicleModels) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Query     string `json:"query"`
		Brand     string `json:"brand"`
		Model     string `json:"model"`
		ModelUUID string `json:"model_uuid"`
		Year      int    `json:"year"`
	}
	if err := Decode(vehicleModelsSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	variants := func(m vehiclecatalogusecase.ModelSummary) (Result, error) {
		vs, err := t.catalog.ModelVariants(ctx, m.ModelUUID, in.Year, 40)
		if err != nil {
			return Result{}, err
		}
		out := map[string]any{"level": "variants", "model": modelItem(m), "variants": vs, "models": []vehicleModelItem{modelItem(m)}}
		if len(vs) == 0 {
			out["note"] = "no variant list for this model in the catalog; use model_uuid + year"
		}
		return JSONResult(out, "ai.tool_summary.models_found", map[string]any{"count": 1}), nil
	}
	if id, err := uuid.Parse(strings.TrimSpace(in.ModelUUID)); err == nil {
		m, err := t.catalog.GetModel(ctx, id)
		if err != nil {
			return userError(err)
		}
		return variants(m)
	}
	q := strings.TrimSpace(strings.Join([]string{in.Query, in.Brand, in.Model}, " "))
	if len([]rune(q)) < 2 {
		return ErrorResult("Invalid input: pass query (brand and/or model), brand, model or model_uuid"), nil
	}
	rows, err := t.catalog.SearchModels(ctx, q, in.Year, 40)
	if err != nil {
		return Result{}, err
	}
	if m := strings.TrimSpace(in.Model); m != "" {
		var exact []vehiclecatalogusecase.ModelSummary
		for _, r := range rows {
			if FoldTR(r.ModelName) == FoldTR(m) {
				exact = append(exact, r)
			}
		}
		if len(exact) == 1 {
			return variants(exact[0])
		}
	}
	type brand struct {
		Name       string `json:"name"`
		ModelCount int    `json:"model_count"`
	}
	var brands []brand
	idx := map[string]int{}
	items := make([]vehicleModelItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, modelItem(r))
		if i, ok := idx[r.BrandName]; ok {
			brands[i].ModelCount++
		} else {
			idx[r.BrandName] = len(brands)
			brands = append(brands, brand{Name: r.BrandName, ModelCount: 1})
		}
	}
	out := map[string]any{"level": "models", "brands": brands, "models": items, "truncated": len(rows) >= 40}
	if len(items) == 0 {
		out["note"] = "no catalog model matches; try fewer words (only the brand) or another spelling"
	}
	return JSONResult(out, "ai.tool_summary.models_found", map[string]any{"count": len(items)}), nil
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

var jobServicesSchema = map[string]any{
	"type": "array", "minItems": 1, "maxItems": 10,
	"items": map[string]any{
		"type": "object",
		"properties": map[string]any{
			"service": map[string]any{"type": "string", "minLength": 2, "maxLength": 100, "description": "Catalog service name (e.g. \"Dış yıkama\") or uuid from list_services. Names that are not in the catalog are refused with the closest matches."},
			"price":   map[string]any{"type": "number", "minimum": 0, "description": "Override the catalog price for this job."},
			"qty":     map[string]any{"type": "number", "minimum": 0.01, "maximum": 1000},
		},
		"required":             []string{"service"},
		"additionalProperties": false,
	},
}

var createJobSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"customer_uuid": map[string]any{"type": "string", "format": "uuid"},
		"plate":         map[string]any{"type": "string", "maxLength": 16, "description": "Plate of one of the customer's vehicles (optional if the customer has exactly one). Spaces and case do not matter."},
		"vehicle_uuid":  map[string]any{"type": "string", "format": "uuid", "description": "Alternative to plate: one of the customer's vehicle uuids."},
		"services":      jobServicesSchema,
		"notes":         map[string]any{"type": "string", "maxLength": 500},
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
	VehicleUUID  string            `json:"vehicle_uuid,omitempty"`
	Services     []jobServiceInput `json:"services"`
	Notes        string            `json:"notes,omitempty"`
}

// Spec implements Tool.
func (CreateJob) Spec() Spec {
	return Spec{
		Name: "create_job",
		Description: "Propose opening a service job (iş emri) for an existing customer's vehicle with one or more catalog services (see list_services). " +
			"The result lists each line's matched catalog service and whether its price was overridden. For a walk-in car use quick_job. Shows a confirmation card.",
		InputSchema:          createJobSchema,
		Permissions:          []string{rbac.PermTenantJobsWrite, rbac.PermTenantCustomersRead, rbac.PermTenantCatalogRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// pickVehicle finds the customer's vehicle by uuid or plate (or the only one).
func pickVehicle(cust customersusecase.CustomerDetail, vehicleUUID, plate string) (customersusecase.Vehicle, error) {
	if len(cust.Vehicles) == 0 {
		return customersusecase.Vehicle{}, inputErr("%s has no vehicles; add one first (add_customer_vehicle)", cust.Name)
	}
	if id, err := uuid.Parse(strings.TrimSpace(vehicleUUID)); err == nil {
		for _, v := range cust.Vehicles {
			if v.UUID == id {
				return v, nil
			}
		}
	} else if key := PlateKey(plate); key != "" {
		for _, v := range cust.Vehicles {
			if PlateKey(v.Plate) == key {
				return v, nil
			}
		}
	} else if len(cust.Vehicles) == 1 {
		return cust.Vehicles[0], nil
	}
	plates := names(cust.Vehicles, func(v customersusecase.Vehicle) string { return v.Plate }, 10)
	return customersusecase.Vehicle{}, inputErr("pass the plate of one of %s's vehicles: %s", cust.Name, plates)
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
	vehicle, err := pickVehicle(cust, in.VehicleUUID, in.Plate)
	if err != nil {
		return Proposal{}, err
	}
	norm, lines, total, cur, err := resolveJobLines(ctx, t.catalog, in.Services)
	if err != nil {
		return Proposal{}, err
	}
	in.Services = norm
	in.Plate = vehicle.Plate
	in.VehicleUUID = vehicle.UUID.String()
	in.Notes = trimmed(in.Notes, 500)
	fields := []Field{
		{Key: "customer", Value: cust.Name},
		{Key: "plate", Value: vehicle.Plate},
		{Key: "vehicle", Value: strings.TrimSpace(vehicle.BrandName + " " + vehicle.ModelName)},
		{Key: "services", Value: jobLinesText(lines, cur)},
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

func jobCreateLines(in []jobServiceInput) []jobsusecase.CreateLineInput {
	lines := make([]jobsusecase.CreateLineInput, 0, len(in))
	for _, l := range in {
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
	return lines
}

func jobResult(job jobsusecase.JobDetail, catalog map[uuid.UUID]catalogusecase.ServiceItem) map[string]any {
	return map[string]any{
		"job_uuid": job.UUID.String(), "plate": job.Plate, "status": job.Status, "payment_status": job.PaymentStatus,
		"total": FormatMoney(job.TotalAmount, job.Currency), "total_number": Number(job.TotalAmount),
		"lines": jobLinesResult(job, catalog),
	}
}

// Run implements Tool.
func (t CreateJob) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in createJobInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	cid, _ := uuid.Parse(in.CustomerUUID)
	vid, _ := uuid.Parse(in.VehicleUUID)
	job, err := t.jobs.Create(ctx, jobsusecase.CreateInput{CustomerUUID: cid, VehicleUUID: vid, Notes: in.Notes, Lines: jobCreateLines(in.Services)})
	if err != nil {
		return execError(err)
	}
	rows, _ := activeServices(ctx, t.catalog)
	out := jobResult(job, catalogByUUID(rows))
	out["done"] = true
	res := JSONResult(out, "ai.tool_summary.job_created", map[string]any{"plate": job.Plate})
	res.Link = &Link{Kind: "job", UUID: job.UUID.String()}
	return res, nil
}

// ---------------------------------------------------------------- job status

// UpdateJobStatus marks a job ready (hazır) or delivered (teslim edildi),
// optionally taking the payment on delivery.
type UpdateJobStatus struct {
	jobs JobsWriter
	pay  jobPayment
}

var jobStatusSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"job_uuid":        map[string]any{"type": "string", "format": "uuid", "description": "uuid from list_jobs; or pass plate."},
		"plate":           map[string]any{"type": "string", "maxLength": 16, "description": "Plate of an open job (in_progress/ready). Spaces and case do not matter."},
		"status":          map[string]any{"type": "string", "enum": []string{"ready", "delivered"}},
		"payment_method":  map[string]any{"type": "string", "enum": jobPaymentValues, "description": "Only with status=delivered: also take the payment in the same action (cash, card, transfer = havale/EFT into a bank account, cari = on the customer's account)."},
		"finance_account": map[string]any{"type": "string", "maxLength": 100, "description": "With payment_method cash/card/transfer: account name or uuid; omit for the default."},
	},
	"required":             []string{"status"},
	"additionalProperties": false,
}

type jobStatusInput struct {
	JobUUID        string `json:"job_uuid,omitempty"`
	Plate          string `json:"plate,omitempty"`
	Status         string `json:"status"`
	PaymentMethod  string `json:"payment_method,omitempty"`
	FinanceAccount string `json:"finance_account,omitempty"`
}

// Spec implements Tool.
func (UpdateJobStatus) Spec() Spec {
	return Spec{
		Name: "update_job_status",
		Description: "Propose marking a service job ready (hazır, washed and waiting) or delivered (teslim edildi). Identify it by job_uuid or plate. " +
			"With status=delivered and payment_method it also takes the payment (like record_job_payment) in one action. Shows a confirmation card.",
		InputSchema:          jobStatusSchema,
		Permissions:          []string{rbac.PermTenantJobsWrite, rbac.PermTenantJobsRead},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// Propose implements ActionTool.
func (t UpdateJobStatus) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in jobStatusInput
	if err := decodeInput(jobStatusSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	if in.PaymentMethod != "" && in.Status != "delivered" {
		return Proposal{}, inputErr("payment_method is only allowed with status delivered; use record_job_payment to take a payment without delivering")
	}
	open := func(j jobsusecase.Job) bool { return j.Status == "in_progress" || j.Status == "ready" }
	detail, err := findJob(ctx, env, t.jobs, in.JobUUID, in.Plate, open, "open (in_progress/ready)")
	if err != nil {
		return Proposal{}, err
	}
	job := detail.Job
	switch {
	case in.Status == "ready" && job.Status != "in_progress":
		return Proposal{}, inputErr("job %s is %s; only in_progress jobs can be marked ready", job.Plate, job.Status)
	case in.Status == "delivered" && job.Status != "in_progress" && job.Status != "ready":
		return Proposal{}, inputErr("job %s is %s and cannot be delivered", job.Plate, job.Status)
	}
	norm := jobStatusInput{JobUUID: job.UUID.String(), Plate: job.Plate, Status: in.Status}
	fields := []Field{
		{Key: "customer", Value: job.CustomerName},
		{Key: "vehicle", Value: job.VehicleLabel},
		{Key: "status_from", ValueKey: "ai.confirm.values." + job.Status},
		{Key: "status_to", ValueKey: "ai.confirm.values." + in.Status},
		{Key: "payment_status", ValueKey: "ai.confirm.values." + job.PaymentStatus},
	}
	var warnings []string
	var edit []EditField
	if in.PaymentMethod != "" {
		if job.PaymentStatus == "paid" {
			return Proposal{}, inputErr("job %s is already paid; drop payment_method", job.Plate)
		}
		plan, err := t.pay.plan(ctx, env, job.CustomerUUID, job.TotalAmount, job.Currency, in.PaymentMethod, in.FinanceAccount)
		if err != nil {
			return Proposal{}, err
		}
		norm.PaymentMethod = in.PaymentMethod
		if in.PaymentMethod != "cari" {
			norm.FinanceAccount = plan.Account.UUID.String()
		}
		fields = append(fields, plan.Fields...)
		edit = plan.Edit
	} else if in.Status == "delivered" && job.PaymentStatus != "paid" {
		warnings = append(warnings, "unpaid_delivery")
	}
	return Proposal{
		Input: mustJSON(norm),
		Preview: Preview{
			Action: "update_job_status", Title: job.Plate + " · " + job.CustomerName, Amount: FormatMoney(job.TotalAmount, job.Currency),
			Fields: fields, Warnings: warnings, Edit: edit,
		},
	}, nil
}

// Run implements Tool.
func (t UpdateJobStatus) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
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
	out := map[string]any{"done": true, "job_uuid": job.UUID.String(), "plate": job.Plate, "status": job.Status, "payment_status": job.PaymentStatus}
	if in.PaymentMethod != "" {
		paid, err := closeJob(ctx, t.jobs, id, in.PaymentMethod, in.FinanceAccount)
		if err != nil {
			msg := "internal error"
			if pe := proposalError(err); pe != nil {
				if ie, ok := AsInputError(pe); ok {
					msg = ie.Msg
				}
			}
			return ErrorResult(fmt.Sprintf("Partly executed: job %s is delivered, but the payment was NOT taken (%s). Retry with record_job_payment.", job.Plate, msg)), nil
		}
		job = paid
		out["payment_status"] = paid.PaymentStatus
		out["payment"] = t.pay.paymentResult(ctx, env, paid, in.PaymentMethod)
	}
	res := JSONResult(out, "ai.tool_summary.job_updated", map[string]any{"plate": job.Plate})
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
