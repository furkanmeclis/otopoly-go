package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	vehiclecatalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclebrands/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

func propose(t *testing.T, tool ActionTool, env Env, in string) (Proposal, error) {
	t.Helper()
	return tool.Propose(context.Background(), env, json.RawMessage(in))
}

func mustPropose(t *testing.T, tool ActionTool, env Env, in string) Proposal {
	t.Helper()
	p, err := propose(t, tool, env, in)
	if err != nil {
		t.Fatalf("%s propose: %v", tool.Spec().Name, err)
	}
	return p
}

func wantInputErr(t *testing.T, err error, contains ...string) {
	t.Helper()
	ie, ok := AsInputError(err)
	if !ok {
		t.Fatalf("want InputError, got %v", err)
	}
	for _, c := range contains {
		if !strings.Contains(ie.Msg, c) {
			t.Fatalf("error %q does not mention %q", ie.Msg, c)
		}
	}
}

func run(t *testing.T, tool Tool, env Env, input json.RawMessage) map[string]any {
	t.Helper()
	res, err := tool.Run(context.Background(), env, input)
	if err != nil || res.IsError {
		t.Fatalf("%s run: %+v %v", tool.Spec().Name, res, err)
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(res.Content), &out); err != nil {
		t.Fatalf("result is not JSON: %s", res.Content)
	}
	return out
}

// editKeysValid: card edits are written to the tool input, so every edit key
// must be a property of the tool's schema.
func editKeysValid(t *testing.T, schema map[string]any, p Proposal) {
	t.Helper()
	props := schema["properties"].(map[string]any)
	for _, e := range p.Preview.Edit {
		if _, ok := props[e.Key]; !ok {
			t.Fatalf("%s: edit key %q is not an input property", p.Preview.Action, e.Key)
		}
	}
}

func field(p Proposal, key string) string {
	for _, f := range p.Preview.Fields {
		if f.Key == key {
			return f.Value + f.ValueKey
		}
	}
	return ""
}

func TestRecordJobPaymentByPlate(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali Yılmaz", "0532 111 22 33", "01ASJ729")
	j := w.addJob(c, "delivered", "unpaid", "700.00")
	tool := RecordJobPayment{jobs: fakeJobsW{w}, pay: w.pay()}
	env := ownerEnv()

	p := mustPropose(t, tool, env, `{"plate":"01 asj 729","method":"transfer"}`)
	if len(w.writes) != 0 {
		t.Fatalf("propose wrote: %v", w.writes)
	}
	editKeysValid(t, jobPaymentSchema, p)
	var in jobPaymentInput
	_ = json.Unmarshal(p.Input, &in)
	pos := w.account("Garanti POS")
	if in.JobUUID != j.UUID.String() || in.FinanceAccount != pos.UUID.String() || in.Method != "transfer" {
		t.Fatalf("normalized = %+v", in)
	}
	if got := field(p, "account_balance_after"); !strings.Contains(got, "5.700,00") {
		t.Fatalf("balance after = %q", got)
	}

	out := run(t, tool, env, p.Input)
	if w.closeIn.Method != "card" || *w.closeIn.FinanceAccountUUID != pos.UUID {
		t.Fatalf("close input = %+v", w.closeIn)
	}
	pay := out["payment"].(map[string]any)
	if out["payment_status"] != "paid" || pay["finance_transaction_uuid"] == nil || pay["finance_category"] != financeusecase.CategoryServiceIncome ||
		!strings.Contains(pay["account_balance"].(string), "5.700,00") || pay["recorded_as"] != "card" {
		t.Fatalf("result = %v", out)
	}

	// Paid now: by uuid it is refused, by plate there is no unpaid job left.
	_, err := propose(t, tool, env, `{"job_uuid":"`+j.UUID.String()+`","method":"cash"}`)
	wantInputErr(t, err, "already paid")
	_, err = propose(t, tool, env, `{"plate":"01ASJ729","method":"cash"}`)
	wantInputErr(t, err, "no unpaid job")
}

func TestRecordJobPaymentCari(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali", "", "34ABC123")
	w.addJob(c, "in_progress", "unpaid", "450.00")
	tool := RecordJobPayment{jobs: fakeJobsW{w}, pay: w.pay()}
	p := mustPropose(t, tool, ownerEnv(), `{"plate":"34 ABC 123","method":"cari"}`)
	if field(p, "balance_after") == "" {
		t.Fatalf("cari preview has no balance: %+v", p.Preview.Fields)
	}
	out := run(t, tool, ownerEnv(), p.Input)
	pay := out["payment"].(map[string]any)
	if w.closeIn.Method != "cari" || w.closeIn.FinanceAccountUUID != nil || pay["cari_entry_uuid"] == nil || !strings.Contains(pay["cari_balance"].(string), "450,00") {
		t.Fatalf("cari close = %+v / %v", w.closeIn, out)
	}
}

func TestRecordJobPaymentAmbiguousPlate(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali", "", "34ABC123")
	w.addJob(c, "delivered", "unpaid", "100.00")
	w.addJob(c, "ready", "unpaid", "200.00")
	_, err := propose(t, RecordJobPayment{jobs: fakeJobsW{w}, pay: w.pay()}, ownerEnv(), `{"plate":"34abc123","method":"cash"}`)
	wantInputErr(t, err, "several unpaid jobs", "job_uuid")
}

func TestUpdateJobStatusDeliverAndPay(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali", "", "34ABC123")
	j := w.addJob(c, "ready", "unpaid", "300.00")
	tool := UpdateJobStatus{jobs: fakeJobsW{w}, pay: w.pay()}

	_, err := propose(t, tool, ownerEnv(), `{"plate":"34ABC123","status":"ready","payment_method":"cash"}`)
	wantInputErr(t, err, "only allowed with status delivered")

	p := mustPropose(t, tool, ownerEnv(), `{"plate":"34 abc 123","status":"delivered","payment_method":"cash"}`)
	editKeysValid(t, jobStatusSchema, p)
	if len(p.Preview.Warnings) != 0 || len(w.writes) != 0 {
		t.Fatalf("warnings=%v writes=%v", p.Preview.Warnings, w.writes)
	}
	out := run(t, tool, ownerEnv(), p.Input)
	if strings.Join(w.writes, ",") != "jobs.deliver,jobs.close" || out["status"] != "delivered" || out["payment_status"] != "paid" {
		t.Fatalf("writes=%v out=%v", w.writes, out)
	}
	if *w.closeIn.FinanceAccountUUID != w.account("Ana Kasa").UUID {
		t.Fatal("cash must go to the default cash register")
	}
	if w.jobs[j.UUID].PaymentStatus != "paid" {
		t.Fatal("job not paid")
	}

	// Payment failure after delivery: reported as partly executed.
	j2 := w.addJob(c, "ready", "unpaid", "300.00")
	w.closeErr = errors.New("conflict: job cannot be closed")
	p = mustPropose(t, tool, ownerEnv(), `{"job_uuid":"`+j2.UUID.String()+`","status":"delivered","payment_method":"card"}`)
	res, err := tool.Run(context.Background(), ownerEnv(), p.Input)
	if err != nil || !res.IsError || !strings.Contains(res.Content, "Partly executed") {
		t.Fatalf("partial = %+v %v", res, err)
	}
}

func TestUpdateJobStatusPaymentNeedsFinanceRead(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali", "", "34ABC123")
	w.addJob(c, "ready", "unpaid", "300.00")
	env := staffEnv(rbac.PermTenantJobsRead, rbac.PermTenantJobsWrite)
	_, err := propose(t, UpdateJobStatus{jobs: fakeJobsW{w}, pay: w.pay()}, env, `{"plate":"34ABC123","status":"delivered","payment_method":"cash"}`)
	wantInputErr(t, err, "finance read permission")
}

func TestCancelJob(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali", "", "34ABC123")
	open := w.addJob(c, "in_progress", "unpaid", "300.00")
	open.Consumptions = []jobsusecase.Consumption{{Name: "Şampuan", Qty: "0.5", Unit: "lt", StockApplied: true}}
	tool := CancelJob{jobs: fakeJobsW{w}, pay: w.pay()}

	p := mustPropose(t, tool, staffEnv(rbac.PermTenantJobsRead, rbac.PermTenantJobsWrite), `{"job_uuid":"`+open.UUID.String()+`"}`)
	if !strings.Contains(field(p, "stock_returned"), "Şampuan") || field(p, "status_to") != "ai.confirm.values.cancelled" {
		t.Fatalf("preview = %+v", p.Preview.Fields)
	}
	out := run(t, tool, ownerEnv(), p.Input)
	if out["status"] != "cancelled" || w.writes[0] != "jobs.cancel" {
		t.Fatalf("cancel = %v %v", out, w.writes)
	}

	// Paid job: staff is refused, the owner voids it and the income is reversed.
	paid := w.addJob(c, "delivered", "unpaid", "500.00")
	kasa := w.account("Ana Kasa")
	if _, err := (fakeJobsW{w}).Close(context.Background(), paid.UUID, jobsusecase.CloseInput{Method: "cash", FinanceAccountUUID: &kasa.UUID}); err != nil {
		t.Fatal(err)
	}
	_, err := propose(t, tool, staffEnv(rbac.PermTenantJobsRead, rbac.PermTenantJobsWrite), `{"job_uuid":"`+paid.UUID.String()+`"}`)
	wantInputErr(t, err, "only the business owner")
	p = mustPropose(t, tool, ownerEnv(), `{"job_uuid":"`+paid.UUID.String()+`"}`)
	if len(p.Preview.Warnings) != 1 || p.Preview.Warnings[0] != "payment_reversed" {
		t.Fatalf("warnings = %v", p.Preview.Warnings)
	}
	out = run(t, tool, ownerEnv(), p.Input)
	rev := out["reversed_payments"].([]any)[0].(map[string]any)
	if out["status"] != "voided" || rev["voided_finance_transaction_uuid"] == nil || !strings.Contains(rev["account_balance"].(string), "1.000,00") {
		t.Fatalf("void = %v", out)
	}

	// Delivered unpaid jobs cannot be cancelled.
	d := w.addJob(c, "delivered", "unpaid", "100.00")
	_, err = propose(t, tool, ownerEnv(), `{"job_uuid":"`+d.UUID.String()+`"}`)
	wantInputErr(t, err, "record_job_payment")
}

func quickTool(w *world) QuickJob {
	return QuickJob{customers: fakeCustomersW{w}, search: fakeSearch{w}, vehicles: fakeVehicles{w}, jobs: fakeJobsW{w}, catalog: fakeCatalogL{w}, pay: w.pay()}
}

func TestQuickJobReusesCustomerByPlate(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali Yılmaz", "05321112233", "01ASJ729")
	w.found = []db.AIFindCustomersByPhoneOrPlateRow{{Uuid: c.UUID, Name: c.Name, Phone: c.Phone, PlateVehicleUuid: c.Vehicles[0].UUID, PhoneMatch: true}}
	tool := quickTool(w)
	p := mustPropose(t, tool, ownerEnv(), `{"plate":"01 asj 729","customer_name":"Ali Yilmaz","phone":"+90 532 111 22 33","services":[{"service":"dış yıkama","price":250}]}`)
	if w.lastFind.Plate != "01ASJ729" || w.lastFind.PhoneDigits != "5321112233" {
		t.Fatalf("lookup = %+v", w.lastFind)
	}
	if field(p, "customer_action") != "ai.confirm.values.reuse_existing" || field(p, "vehicle_action") != "ai.confirm.values.reuse_existing" {
		t.Fatalf("preview = %+v", p.Preview.Fields)
	}
	if !strings.Contains(field(p, "services"), "katalog") || len(w.writes) != 0 {
		t.Fatalf("services = %q writes=%v", field(p, "services"), w.writes)
	}
	out := run(t, tool, ownerEnv(), p.Input)
	if strings.Join(w.writes, ",") != "jobs.create" {
		t.Fatalf("writes = %v", w.writes)
	}
	job := out["job"].(map[string]any)
	line := job["lines"].([]any)[0].(map[string]any)
	if line["price_overridden"] != true || line["matched_service"].(map[string]any)["name"] != "Dış Yıkama" || job["payment_status"] != "unpaid" {
		t.Fatalf("job = %v", job)
	}
	if out["customer"].(map[string]any)["created"] != false || out["vehicle"].(map[string]any)["created"] != false {
		t.Fatalf("out = %v", out)
	}
}

func TestQuickJobAmbiguousPhoneReturnsCandidates(t *testing.T) {
	w := newWorld()
	a := w.addCustomer("Ali", "05321112233", "")
	b := w.addCustomer("Ayşe", "0532 111 22 33", "")
	w.found = []db.AIFindCustomersByPhoneOrPlateRow{{Uuid: a.UUID, Name: "Ali", PhoneMatch: true}, {Uuid: b.UUID, Name: "Ayşe", PhoneMatch: true}}
	_, err := propose(t, quickTool(w), ownerEnv(), `{"plate":"34XYZ99","phone":"05321112233","services":[{"service":"Dış Yıkama"}]}`)
	wantInputErr(t, err, "several customers", a.UUID.String(), b.UUID.String(), "customer_uuid")
}

func TestQuickJobSameNameNeedsConfirmation(t *testing.T) {
	w := newWorld()
	old := w.addCustomer("Mehmet Kaya", "", "")
	w.named = []db.AISearchCustomersRow{{Uuid: old.UUID, Name: "Mehmet Kaya"}}
	_, err := propose(t, quickTool(w), ownerEnv(), `{"plate":"34XYZ99","customer_name":"Mehmet Kaya","services":[{"service":"Dış Yıkama"}]}`)
	wantInputErr(t, err, "already exist", "allow_new_customer")
}

func TestQuickJobCreatesEverythingAndPays(t *testing.T) {
	w := newWorld()
	clio := vehiclecatalogusecase.ModelSummary{ModelUUID: uuid.New(), BrandName: "Renault", ModelName: "Clio", Years: []int{2015, 2016, 2017}}
	w.models = []vehiclecatalogusecase.ModelSummary{clio, {ModelUUID: uuid.New(), BrandName: "Renault", ModelName: "Clio Symbol", Years: []int{2015}}}
	tool := quickTool(w)

	_, err := propose(t, tool, ownerEnv(), `{"plate":"34XYZ99","customer_name":"Veli","brand":"Renault","model":"Clio","services":[{"service":"Dış Yıkama"}]}`)
	wantInputErr(t, err, "pass year", "2015–2017")
	_, err = propose(t, tool, ownerEnv(), `{"plate":"34XYZ99","customer_name":"Veli","brand":"Renault","model":"Clio","year":2016,"services":[{"service":"Cila"}]}`)
	wantInputErr(t, err, "not in the catalog")

	p := mustPropose(t, tool, ownerEnv(), `{"plate":"34 xyz 99","customer_name":"Veli Demir","phone":"0533 000 00 00","brand":"renault","model":"clio","year":2016,
		"services":[{"service":"Dış Yıkama"},{"service":"Seramik"}],"payment_method":"cash"}`)
	if field(p, "customer_action") != "ai.confirm.values.create_new" || field(p, "vehicle_action") != "ai.confirm.values.create_new" || len(w.writes) != 0 {
		t.Fatalf("preview = %+v writes=%v", p.Preview.Fields, w.writes)
	}
	editKeysValid(t, quickJobSchema, p)
	var in quickJobInput
	_ = json.Unmarshal(p.Input, &in)
	if in.ModelUUID != clio.ModelUUID.String() || in.FinanceAccount != w.account("Ana Kasa").UUID.String() || in.Plate != "34 XYZ 99" {
		t.Fatalf("normalized = %+v", in)
	}
	if err := Validate(quickJobSchema, p.Input); err != nil {
		t.Fatalf("stored input must stay valid for card edits: %v", err)
	}
	out := run(t, tool, ownerEnv(), p.Input)
	if strings.Join(w.writes, ",") != "customers.create,jobs.create,jobs.close" {
		t.Fatalf("writes = %v", w.writes)
	}
	pay := out["payment"].(map[string]any)
	if out["job"].(map[string]any)["payment_status"] != "paid" || !strings.Contains(pay["account_balance"].(string), "9.300,00") ||
		out["customer"].(map[string]any)["created"] != true {
		t.Fatalf("out = %v", out)
	}
}

func TestQuickJobPaymentFailureReportsWhatWasDone(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali", "", "34ABC123")
	w.found = []db.AIFindCustomersByPhoneOrPlateRow{{Uuid: c.UUID, Name: c.Name, PlateVehicleUuid: c.Vehicles[0].UUID}}
	tool := quickTool(w)
	p := mustPropose(t, tool, ownerEnv(), `{"plate":"34ABC123","services":[{"service":"Dış Yıkama"}],"payment_method":"card"}`)
	w.closeErr = errors.New("boom")
	res, err := tool.Run(context.Background(), ownerEnv(), p.Input)
	if err != nil || !res.IsError || !strings.Contains(res.Content, "Partly executed: job") || !strings.Contains(res.Content, "record_job_payment") {
		t.Fatalf("res = %+v %v", res, err)
	}
}

func TestCreateJobReportsMatchedServices(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali", "", "34ABC123")
	tool := CreateJob{customers: fakeCustomersW{w}, jobs: fakeJobsW{w}, catalog: fakeCatalogL{w}}
	_, err := propose(t, tool, ownerEnv(), `{"customer_uuid":"`+c.UUID.String()+`","services":[{"service":"Yıkama"}]}`)
	wantInputErr(t, err, "matches several", "Dış Yıkama", "İç Dış Yıkama")
	_, err = propose(t, tool, ownerEnv(), `{"customer_uuid":"`+c.UUID.String()+`","services":[{"service":"Seramk Kaplma"}]}`)
	wantInputErr(t, err, "Closest: Seramik Kaplama")

	p := mustPropose(t, tool, ownerEnv(), `{"customer_uuid":"`+c.UUID.String()+`","plate":"34 abc 123","services":[{"service":"seramik kaplama"}]}`)
	if err := Validate(createJobSchema, p.Input); err != nil {
		t.Fatalf("stored input must stay valid: %v", err)
	}
	out := run(t, tool, ownerEnv(), p.Input)
	line := out["lines"].([]any)[0].(map[string]any)
	if line["price_overridden"] != false || line["matched_service"].(map[string]any)["catalog_price"] != "₺8.000,00" {
		t.Fatalf("line = %v", line)
	}
}

func TestCreateCustomerPossibleDuplicates(t *testing.T) {
	w := newWorld()
	old := w.addCustomer("Ali", "05321112233", "34ABC123")
	w.found = []db.AIFindCustomersByPhoneOrPlateRow{{Uuid: old.UUID, Name: "Ali", Phone: "05321112233", PhoneMatch: true}}
	tool := CreateCustomer{customers: fakeCustomersW{w}, search: fakeSearch{w}}
	_, err := propose(t, tool, ownerEnv(), `{"name":"Ali Veli","phone":"+90 (532) 111 22 33"}`)
	wantInputErr(t, err, "possible_duplicates", old.UUID.String(), `"matched_by":"phone"`, "allow_duplicate")
	if w.lastFind.PhoneDigits != "5321112233" {
		t.Fatalf("phone key = %q", w.lastFind.PhoneDigits)
	}
	p := mustPropose(t, tool, ownerEnv(), `{"name":"Ali Veli","phone":"05321112233","allow_duplicate":true}`)
	if len(p.Preview.Warnings) != 1 || p.Preview.Warnings[0] != "possible_duplicate" {
		t.Fatalf("warnings = %v", p.Preview.Warnings)
	}
	run(t, tool, ownerEnv(), p.Input)
	if strings.Join(w.writes, ",") != "customers.create" {
		t.Fatalf("writes = %v", w.writes)
	}
}

func TestGetCustomerAccountOpenJobs(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali", "", "34ABC123")
	w.cari[c.UUID].Balance = "150.00"
	w.unpaid = jobsusecase.UnpaidJobs{Count: 2, TotalAmount: "800.00", Jobs: []jobsusecase.UnpaidJob{
		{UUID: uuid.New(), Plate: "34ABC123", Status: "delivered", TotalAmount: "500.00", Currency: "TRY"},
		{UUID: uuid.New(), Plate: "34ABC123", Status: "ready", TotalAmount: "300.00", Currency: "TRY"},
	}}
	tool := GetCustomerAccount{cari: fakeCariW{w}, unpaid: fakeJobsW{w}}
	out := run(t, tool, ownerEnv(), json.RawMessage(`{"customer_uuid":"`+c.UUID.String()+`"}`))
	if out["balance"] != "₺150,00" || out["unpaid_jobs_total"] != "₺800,00" || out["total_due"] != "₺950,00" || len(out["open_jobs"].([]any)) != 2 {
		t.Fatalf("out = %v", out)
	}
	// Without jobs.read the job part is left out.
	out = run(t, tool, staffEnv(rbac.PermTenantCariRead), json.RawMessage(`{"cari_account_uuid":"`+c.CariAccountUUID.String()+`"}`))
	if _, ok := out["open_jobs"]; ok {
		t.Fatalf("open_jobs leaked without jobs.read: %v", out)
	}
	res, _ := tool.Run(context.Background(), ownerEnv(), json.RawMessage(`{}`))
	if !res.IsError {
		t.Fatal("missing ids must fail")
	}
}

func TestListServices(t *testing.T) {
	w := newWorld()
	out := run(t, ListServices{catalog: fakeCatalogL{w}}, ownerEnv(), json.RawMessage(`{"query":"yıkama"}`))
	svcs := out["services"].([]any)
	if len(svcs) != 2 || svcs[0].(map[string]any)["price"] != "₺300,00" || svcs[0].(map[string]any)["duration_minutes"] != 30.0 {
		t.Fatalf("services = %v", svcs)
	}
}

func TestSearchVehicleModelsTwoLevels(t *testing.T) {
	w := newWorld()
	clio := vehiclecatalogusecase.ModelSummary{ModelUUID: uuid.New(), BrandName: "Renault", ModelName: "Clio", Years: []int{2015, 2016}}
	w.models = []vehiclecatalogusecase.ModelSummary{clio, {ModelUUID: uuid.New(), BrandName: "Renault", ModelName: "Megane", Years: []int{2018}}}
	w.variants = []vehiclecatalogusecase.ModelVariant{{Name: "CLIO 1.5 DCI TOUCH", Years: []int{2016}}}
	tool := SearchVehicleModels{catalog: fakeVehicles{w}}

	out := run(t, tool, ownerEnv(), json.RawMessage(`{"query":"Renault"}`))
	brands := out["brands"].([]any)
	if out["level"] != "models" || len(out["models"].([]any)) != 2 || len(brands) != 1 || brands[0].(map[string]any)["model_count"] != 2.0 {
		t.Fatalf("models level = %v", out)
	}
	out = run(t, tool, ownerEnv(), json.RawMessage(`{"brand":"Renault","model":"clio"}`))
	if out["level"] != "variants" || out["model"].(map[string]any)["model_uuid"] != clio.ModelUUID.String() || len(out["variants"].([]any)) != 1 {
		t.Fatalf("variants level = %v", out)
	}
	out = run(t, tool, ownerEnv(), json.RawMessage(`{"model_uuid":"`+clio.ModelUUID.String()+`"}`))
	if out["level"] != "variants" {
		t.Fatalf("by uuid = %v", out)
	}
}

func TestPhoneKey(t *testing.T) {
	for in, want := range map[string]string{
		"0532 111 22 33": "5321112233", "+90 (532) 111-22-33": "5321112233", "5321112233": "5321112233", "123": "", "212 555 1234": "2125551234",
	} {
		if got := phoneKey(in); got != want {
			t.Errorf("phoneKey(%q) = %q, want %q", in, got, want)
		}
	}
}
