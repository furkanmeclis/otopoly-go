package tools

import (
	"context"
	"errors"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	catalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/catalog/usecase"
	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	vehiclecatalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclebrands/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// world is an in-memory organization the tool fakes share. writes counts
// every mutating call so tests can assert Propose stays side-effect free.
type world struct {
	writes   []string
	jobs     map[uuid.UUID]*jobsusecase.JobDetail
	services []catalogusecase.ServiceItem
	accounts []financeusecase.Account
	cats     []financeusecase.Category
	txs      map[uuid.UUID]*financeusecase.Transaction
	cari     map[uuid.UUID]*cariusecase.AccountDetail // by customer uuid
	entries  map[uuid.UUID]*cariusecase.EntryInfo
	custs    map[uuid.UUID]*customersusecase.CustomerDetail
	found    []db.AIFindCustomersByPhoneOrPlateRow
	named    []db.AISearchCustomersRow
	models   []vehiclecatalogusecase.ModelSummary
	variants []vehiclecatalogusecase.ModelVariant
	closeErr error
	lastFind db.AIFindCustomersByPhoneOrPlateParams
	closeIn  jobsusecase.CloseInput
	updateIn financeusecase.UpdateTransactionInput
	unpaid   jobsusecase.UnpaidJobs
}

func newWorld() *world {
	w := &world{
		jobs: map[uuid.UUID]*jobsusecase.JobDetail{}, txs: map[uuid.UUID]*financeusecase.Transaction{},
		cari: map[uuid.UUID]*cariusecase.AccountDetail{}, entries: map[uuid.UUID]*cariusecase.EntryInfo{},
		custs: map[uuid.UUID]*customersusecase.CustomerDetail{},
	}
	w.services = []catalogusecase.ServiceItem{
		{UUID: uuid.New(), Name: "Dış Yıkama", Price: "300.00", Currency: "TRY", IsActive: true, DurationMinutes: 30},
		{UUID: uuid.New(), Name: "İç Dış Yıkama", Price: "500.00", Currency: "TRY", IsActive: true, DurationMinutes: 60},
		{UUID: uuid.New(), Name: "Seramik Kaplama", Price: "8000.00", Currency: "TRY", IsActive: true, DurationMinutes: 480},
	}
	w.accounts = []financeusecase.Account{
		{UUID: uuid.New(), Name: "Ana Kasa", Type: "cash", Currency: "TRY", CurrentBalance: "1000.00", IsDefault: true, IsActive: true},
		{UUID: uuid.New(), Name: "Garanti POS", Type: "bank", Currency: "TRY", CurrentBalance: "5000.00", IsActive: true},
	}
	for _, c := range financeusecase.SystemCategories() {
		w.cats = append(w.cats, financeusecase.Category{UUID: uuid.New(), Name: c.Name, Kind: c.Kind, IsActive: true})
	}
	return w
}

func (w *world) write(op string) { w.writes = append(w.writes, op) }

func (w *world) addCustomer(name, phone, plate string) *customersusecase.CustomerDetail {
	c := &customersusecase.CustomerDetail{Customer: customersusecase.Customer{UUID: uuid.New(), Name: name, Phone: phone, IsActive: true}}
	acc := uuid.New()
	c.CariAccountUUID = &acc
	if plate != "" {
		c.Vehicles = []customersusecase.Vehicle{{UUID: uuid.New(), Plate: plate, BrandName: "Renault", ModelName: "Clio"}}
	}
	w.custs[c.UUID] = c
	w.cari[c.UUID] = &cariusecase.AccountDetail{Account: cariusecase.Account{UUID: acc, CustomerUUID: c.UUID, CustomerName: name, Currency: "TRY", Balance: "0.00"}}
	return c
}

func (w *world) addJob(c *customersusecase.CustomerDetail, status, payment, total string) *jobsusecase.JobDetail {
	j := &jobsusecase.JobDetail{Job: jobsusecase.Job{
		UUID: uuid.New(), CustomerUUID: c.UUID, CustomerName: c.Name, Plate: c.Vehicles[0].Plate, VehicleUUID: c.Vehicles[0].UUID,
		VehicleLabel: "Renault Clio", Status: status, PaymentStatus: payment, TotalAmount: total, Currency: "TRY", StartedAt: time.Now(),
	}}
	w.jobs[j.UUID] = j
	return j
}

func (w *world) account(name string) *financeusecase.Account {
	for i := range w.accounts {
		if w.accounts[i].Name == name {
			return &w.accounts[i]
		}
	}
	return nil
}

func addMoney(balance, delta string, neg bool) string {
	d := ratOf(delta)
	if neg {
		d.Neg(d)
	}
	return new(big.Rat).Add(ratOf(balance), d).FloatString(2)
}

// ---------------------------------------------------------------- jobs

type fakeJobsW struct{ w *world }

func (f fakeJobsW) List(_ context.Context, _, _ int32, _ jobsusecase.ListFilters) ([]jobsusecase.Job, int64, error) {
	var out []jobsusecase.Job
	for _, j := range f.w.jobs {
		out = append(out, j.Job)
	}
	return out, int64(len(out)), nil
}

func (f fakeJobsW) SummaryIn(context.Context, string, *time.Location) (jobsusecase.Summary, error) {
	return jobsusecase.Summary{}, nil
}

func (f fakeJobsW) Get(_ context.Context, id uuid.UUID) (jobsusecase.JobDetail, error) {
	j, ok := f.w.jobs[id]
	if !ok {
		return jobsusecase.JobDetail{}, jobsusecase.ErrNotFound
	}
	return *j, nil
}

func (f fakeJobsW) Create(_ context.Context, in jobsusecase.CreateInput) (jobsusecase.JobDetail, error) {
	f.w.write("jobs.create")
	c := f.w.custs[in.CustomerUUID]
	plate := ""
	for _, v := range c.Vehicles {
		if v.UUID == in.VehicleUUID {
			plate = v.Plate
		}
	}
	j := &jobsusecase.JobDetail{Job: jobsusecase.Job{
		UUID: uuid.New(), CustomerUUID: c.UUID, CustomerName: c.Name, Plate: plate, VehicleUUID: in.VehicleUUID,
		Status: "in_progress", PaymentStatus: "unpaid", Currency: "TRY",
	}}
	total := new(big.Rat)
	for _, l := range in.Lines {
		for _, s := range f.w.services {
			if s.UUID == l.ServiceUUID {
				price := s.Price
				if l.UnitPrice != nil {
					price = *l.UnitPrice
				}
				id := s.UUID
				j.Lines = append(j.Lines, jobsusecase.Line{Name: s.Name, ServiceUUID: &id, UnitPrice: price, Qty: "1", LineTotal: price, Currency: "TRY"})
				total.Add(total, ratOf(price))
			}
		}
	}
	j.TotalAmount = total.FloatString(2)
	f.w.jobs[j.UUID] = j
	return *j, nil
}

func (f fakeJobsW) setStatus(id uuid.UUID, from []string, to string) (jobsusecase.JobDetail, error) {
	j, ok := f.w.jobs[id]
	if !ok {
		return jobsusecase.JobDetail{}, jobsusecase.ErrNotFound
	}
	for _, s := range from {
		if j.Status == s {
			j.Status = to
			return *j, nil
		}
	}
	return jobsusecase.JobDetail{}, jobsusecase.ErrConflict
}

func (f fakeJobsW) MarkDone(_ context.Context, id uuid.UUID) (jobsusecase.JobDetail, error) {
	f.w.write("jobs.ready")
	return f.setStatus(id, []string{"in_progress"}, "ready")
}

func (f fakeJobsW) MarkDelivered(_ context.Context, id uuid.UUID) (jobsusecase.JobDetail, error) {
	f.w.write("jobs.deliver")
	return f.setStatus(id, []string{"in_progress", "ready"}, "delivered")
}

func (f fakeJobsW) Close(_ context.Context, id uuid.UUID, in jobsusecase.CloseInput) (jobsusecase.JobDetail, error) {
	f.w.write("jobs.close")
	f.w.closeIn = in
	if f.w.closeErr != nil {
		return jobsusecase.JobDetail{}, f.w.closeErr
	}
	j := f.w.jobs[id]
	if j.PaymentStatus == "paid" {
		return jobsusecase.JobDetail{}, errors.New("conflict: job already paid")
	}
	j.PaymentStatus = "paid"
	pay := jobsusecase.Payment{UUID: uuid.New(), Method: in.Method, Amount: j.TotalAmount, Currency: "TRY", Status: "posted"}
	if in.FinanceAccountUUID != nil {
		tx := uuid.New()
		pay.FinanceTransactionUUID, pay.FinanceAccountUUID = &tx, in.FinanceAccountUUID
		for i := range f.w.accounts {
			if f.w.accounts[i].UUID == *in.FinanceAccountUUID {
				f.w.accounts[i].CurrentBalance = addMoney(f.w.accounts[i].CurrentBalance, j.TotalAmount, false)
				name := f.w.accounts[i].Name
				pay.FinanceAccountName = &name
			}
		}
	} else {
		e := uuid.New()
		pay.CariEntryUUID = &e
		acc := f.w.cari[j.CustomerUUID]
		acc.Balance = addMoney(acc.Balance, j.TotalAmount, false)
	}
	j.Payments = append(j.Payments, pay)
	return *j, nil
}

func (f fakeJobsW) Cancel(_ context.Context, id uuid.UUID) (jobsusecase.JobDetail, error) {
	f.w.write("jobs.cancel")
	return f.setStatus(id, []string{"in_progress", "ready"}, "cancelled")
}

func (f fakeJobsW) Void(_ context.Context, id uuid.UUID) (jobsusecase.JobDetail, error) {
	f.w.write("jobs.void")
	j := f.w.jobs[id]
	j.Status = "voided"
	j.Payments = append([]jobsusecase.Payment(nil), j.Payments...) // Get returned copies
	for i, p := range j.Payments {
		if p.FinanceAccountUUID != nil {
			for k := range f.w.accounts {
				if f.w.accounts[k].UUID == *p.FinanceAccountUUID {
					f.w.accounts[k].CurrentBalance = addMoney(f.w.accounts[k].CurrentBalance, p.Amount, true)
				}
			}
		}
		j.Payments[i].Status = "void"
	}
	return *j, nil
}

func (f fakeJobsW) UnpaidByCustomer(_ context.Context, _ uuid.UUID, _ int32) (jobsusecase.UnpaidJobs, error) {
	return f.w.unpaid, nil
}

func (f fakeJobsW) UnpaidTotalsByCustomers(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]jobsusecase.UnpaidTotal, error) {
	out := map[uuid.UUID]jobsusecase.UnpaidTotal{}
	if len(ids) > 0 {
		out[ids[0]] = jobsusecase.UnpaidTotal{Count: f.w.unpaid.Count, TotalAmount: f.w.unpaid.TotalAmount}
	}
	return out, nil
}

// ---------------------------------------------------------------- finance

type fakeFinanceW struct{ w *world }

func (f fakeFinanceW) ListAccounts(context.Context, int32, int32, string, *bool) ([]financeusecase.Account, int64, error) {
	return append([]financeusecase.Account(nil), f.w.accounts...), int64(len(f.w.accounts)), nil
}

func (f fakeFinanceW) ListCategories(_ context.Context, kind string, _ *bool) ([]financeusecase.Category, error) {
	var out []financeusecase.Category
	for _, c := range f.w.cats {
		if kind == "" || c.Kind == kind {
			out = append(out, c)
		}
	}
	return out, nil
}

func (f fakeFinanceW) CreateTransaction(_ context.Context, _ int64, in financeusecase.CreateTransactionInput, _ *http.Request) (financeusecase.Transaction, error) {
	f.w.write("finance.create")
	tx := financeusecase.Transaction{UUID: uuid.New(), Type: in.Type, Status: "posted", AccountUUID: in.AccountUUID, Amount: in.Amount, Currency: "TRY", TransactionDate: in.TransactionDate}
	f.w.txs[tx.UUID] = &tx
	return tx, nil
}

func (f fakeFinanceW) CreateTransfer(context.Context, int64, financeusecase.CreateTransferInput, *http.Request) (financeusecase.Transaction, error) {
	f.w.write("finance.transfer")
	return financeusecase.Transaction{}, nil
}

func (f fakeFinanceW) GetTransaction(_ context.Context, id uuid.UUID) (financeusecase.Transaction, error) {
	tx, ok := f.w.txs[id]
	if !ok {
		return financeusecase.Transaction{}, financeusecase.ErrNotFound
	}
	return *tx, nil
}

func (f fakeFinanceW) VoidTransaction(_ context.Context, _ int64, id uuid.UUID, _ *http.Request) (financeusecase.Transaction, error) {
	f.w.write("finance.void")
	tx := f.w.txs[id]
	tx.Status = "void"
	if a := f.w.accountByUUID(tx.AccountUUID); a != nil {
		a.CurrentBalance = addMoney(a.CurrentBalance, tx.Amount, tx.Type == "income")
	}
	return *tx, nil
}

func (f fakeFinanceW) UpdateTransaction(_ context.Context, _ int64, id uuid.UUID, in financeusecase.UpdateTransactionInput, _ *http.Request) (financeusecase.Transaction, error) {
	f.w.write("finance.update")
	f.w.updateIn = in
	tx := f.w.txs[id]
	if in.Amount != nil {
		tx.Amount = *in.Amount
	}
	if in.CategoryUUID != nil {
		for _, c := range f.w.cats {
			if c.UUID == *in.CategoryUUID {
				name := c.Name
				tx.CategoryUUID, tx.CategoryName = &c.UUID, &name
			}
		}
	}
	return *tx, nil
}

func (w *world) accountByUUID(id uuid.UUID) *financeusecase.Account {
	for i := range w.accounts {
		if w.accounts[i].UUID == id {
			return &w.accounts[i]
		}
	}
	return nil
}

// ---------------------------------------------------------------- cari

type fakeCariW struct{ w *world }

func (f fakeCariW) byAccount(id uuid.UUID) (*cariusecase.AccountDetail, bool) {
	for _, a := range f.w.cari {
		if a.UUID == id {
			return a, true
		}
	}
	return nil, false
}

func (f fakeCariW) Get(_ context.Context, id uuid.UUID) (cariusecase.AccountDetail, error) {
	if a, ok := f.byAccount(id); ok {
		return *a, nil
	}
	return cariusecase.AccountDetail{}, cariusecase.ErrNotFound
}

func (f fakeCariW) GetByCustomer(_ context.Context, id uuid.UUID) (cariusecase.AccountDetail, error) {
	if a, ok := f.w.cari[id]; ok {
		return *a, nil
	}
	return cariusecase.AccountDetail{}, cariusecase.ErrNotFound
}

func (f fakeCariW) ListEntries(context.Context, uuid.UUID, int32, int32, cariusecase.EntryFilters) ([]cariusecase.Entry, int64, error) {
	return nil, 0, nil
}

func (f fakeCariW) GetEntry(_ context.Context, id uuid.UUID) (cariusecase.EntryInfo, error) {
	if e, ok := f.w.entries[id]; ok {
		return *e, nil
	}
	return cariusecase.EntryInfo{}, cariusecase.ErrNotFound
}

func (f fakeCariW) CreatePayment(context.Context, uuid.UUID, cariusecase.PaymentInput) (cariusecase.Entry, error) {
	f.w.write("cari.payment")
	return cariusecase.Entry{}, nil
}

func (f fakeCariW) CreateCharge(context.Context, uuid.UUID, cariusecase.ChargeInput) (cariusecase.Entry, error) {
	f.w.write("cari.charge")
	return cariusecase.Entry{}, nil
}

func (f fakeCariW) VoidEntry(_ context.Context, id uuid.UUID) (cariusecase.Entry, error) {
	f.w.write("cari.void")
	e := f.w.entries[id]
	e.Status = "void"
	if a, ok := f.byAccount(e.AccountUUID); ok {
		a.Balance = addMoney(a.Balance, e.Amount, e.Type != "payment")
	}
	return e.Entry, nil
}

// ---------------------------------------------------------------- catalog, customers, search, vehicles

type fakeCatalogL struct{ w *world }

func (f fakeCatalogL) ListProducts(context.Context, int32, int32, catalogusecase.ProductFilters) ([]catalogusecase.Product, int64, error) {
	return nil, 0, nil
}

func (f fakeCatalogL) ListServices(_ context.Context, _, _ int32, filters catalogusecase.ServiceFilters) ([]catalogusecase.ServiceItem, int64, error) {
	var out []catalogusecase.ServiceItem
	for _, s := range f.w.services {
		if filters.Q == "" || strings.Contains(FoldTR(s.Name), FoldTR(filters.Q)) {
			out = append(out, s)
		}
	}
	return out, int64(len(out)), nil
}

type fakeCustomersW struct{ w *world }

func (f fakeCustomersW) Get(_ context.Context, id uuid.UUID) (customersusecase.CustomerDetail, error) {
	if c, ok := f.w.custs[id]; ok {
		return *c, nil
	}
	return customersusecase.CustomerDetail{}, customersusecase.ErrNotFound
}

func (f fakeCustomersW) Create(_ context.Context, in customersusecase.CreateInput) (customersusecase.CustomerDetail, error) {
	f.w.write("customers.create")
	plate := ""
	if in.Vehicle != nil {
		plate = strings.ReplaceAll(strings.ToUpper(in.Vehicle.Plate), " ", "")
	}
	return *f.w.addCustomer(in.Name, in.Phone, plate), nil
}

func (f fakeCustomersW) AddVehicle(_ context.Context, id uuid.UUID, in customersusecase.CreateVehicleInput) (customersusecase.Vehicle, error) {
	f.w.write("customers.add_vehicle")
	v := customersusecase.Vehicle{UUID: uuid.New(), Plate: strings.ReplaceAll(strings.ToUpper(in.Plate), " ", ""), BrandName: "Renault", ModelName: "Clio"}
	c := f.w.custs[id]
	c.Vehicles = append(c.Vehicles, v)
	return v, nil
}

type fakeSearch struct{ w *world }

func (f fakeSearch) AISearchCustomers(context.Context, db.AISearchCustomersParams) ([]db.AISearchCustomersRow, error) {
	return f.w.named, nil
}

func (f fakeSearch) AIFindCustomersByPhoneOrPlate(_ context.Context, arg db.AIFindCustomersByPhoneOrPlateParams) ([]db.AIFindCustomersByPhoneOrPlateRow, error) {
	f.w.lastFind = arg
	return f.w.found, nil
}

type fakeVehicles struct{ w *world }

func (f fakeVehicles) SearchOptions(context.Context, string, int) ([]vehiclecatalogusecase.CatalogOption, error) {
	return nil, nil
}

func (f fakeVehicles) SearchModels(_ context.Context, q string, _, _ int) ([]vehiclecatalogusecase.ModelSummary, error) {
	var out []vehiclecatalogusecase.ModelSummary
	for _, m := range f.w.models {
		ok := true
		for _, w := range strings.Fields(FoldTR(q)) {
			if !strings.Contains(FoldTR(m.BrandName+" "+m.ModelName), w) {
				ok = false
			}
		}
		if ok {
			out = append(out, m)
		}
	}
	return out, nil
}

func (f fakeVehicles) GetModel(_ context.Context, id uuid.UUID) (vehiclecatalogusecase.ModelSummary, error) {
	for _, m := range f.w.models {
		if m.ModelUUID == id {
			return m, nil
		}
	}
	return vehiclecatalogusecase.ModelSummary{}, vehiclecatalogusecase.ErrNotFound
}

func (f fakeVehicles) ModelVariants(context.Context, uuid.UUID, int, int) ([]vehiclecatalogusecase.ModelVariant, error) {
	return f.w.variants, nil
}

// ---------------------------------------------------------------- env

var allPerms = []string{
	rbac.PermTenantJobsRead, rbac.PermTenantJobsWrite, rbac.PermTenantFinanceRead, rbac.PermTenantFinanceWrite,
	rbac.PermTenantCariRead, rbac.PermTenantCariWrite, rbac.PermTenantCustomersRead, rbac.PermTenantCustomersWrite,
	rbac.PermTenantCatalogRead,
}

func ownerEnv() Env {
	return Env{
		Principal: authctx.Principal{UserInternal: 7, Permissions: allPerms},
		Scope:     orgctx.Scope{InternalID: 1, MemberRole: "owner"},
		Now:       time.Date(2026, 10, 26, 10, 0, 0, 0, time.UTC),
	}
}

func staffEnv(perms ...string) Env {
	e := ownerEnv()
	e.Scope.MemberRole = "staff"
	e.Principal.Permissions = perms
	return e
}

func (w *world) pay() jobPayment { return jobPayment{finance: fakeFinanceW{w}, cari: fakeCariW{w}} }
