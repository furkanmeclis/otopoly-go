package tools

import (
	"encoding/json"
	"strings"
	"testing"

	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

func (w *world) addTx(typ, amount, source string, account *financeusecase.Account) *financeusecase.Transaction {
	tx := &financeusecase.Transaction{
		UUID: uuid.New(), Type: typ, Status: "posted", AccountUUID: account.UUID, AccountName: account.Name,
		Amount: amount, Currency: "TRY", TransactionDate: "2026-10-25",
	}
	if source != "" {
		src := source
		tx.SourceType = &src
	}
	w.txs[tx.UUID] = tx
	return tx
}

func (w *world) category(name string) financeusecase.Category {
	for _, c := range w.cats {
		if c.Name == name {
			return c
		}
	}
	panic(name)
}

func TestRecordFinanceEntryRequiresCategory(t *testing.T) {
	w := newWorld()
	tool := RecordFinanceEntry{finance: fakeFinanceW{w}}
	_, err := propose(t, tool, ownerEnv(), `{"type":"income","amount":100}`)
	wantInputErr(t, err, "category is required", "Hizmet Geliri", "Diğer Gelir")
	_, err = propose(t, tool, ownerEnv(), `{"type":"expense","amount":100,"category":"Yakıt"}`)
	wantInputErr(t, err, "not found", "Kira", "Genel Gider")

	p := mustPropose(t, tool, ownerEnv(), `{"type":"income","amount":100,"category":"hizmet geliri"}`)
	if len(p.Preview.Warnings) != 1 || p.Preview.Warnings[0] != "system_category" {
		t.Fatalf("warnings = %v", p.Preview.Warnings)
	}
	out := run(t, tool, ownerEnv(), p.Input)
	if out["transaction_uuid"] == nil || !strings.Contains(out["undo"].(string), "void_finance_entry") {
		t.Fatalf("out = %v", out)
	}
}

func TestListFinanceCategoriesMarksSystemOnes(t *testing.T) {
	w := newWorld()
	w.cats = append(w.cats, financeusecase.Category{UUID: uuid.New(), Name: "Yakıt", Kind: "expense", IsActive: true})
	out := run(t, ListFinanceCategories{finance: fakeFinanceW{w}}, ownerEnv(), json.RawMessage(`{"type":"expense"}`))
	auto := map[string]string{}
	system := map[string]bool{}
	for _, c := range out["categories"].([]any) {
		m := c.(map[string]any)
		system[m["name"].(string)] = m["system"].(bool)
		if s, ok := m["auto_source"].(string); ok {
			auto[m["name"].(string)] = s
		}
	}
	if !system["Kira"] || system["Yakıt"] || auto["Stok Alımı"] != financeusecase.SourcePurchase || len(system) != 7 {
		t.Fatalf("categories = %v", out)
	}
}

func TestVoidFinanceEntryManual(t *testing.T) {
	w := newWorld()
	kasa := w.account("Ana Kasa")
	tx := w.addTx("income", "200.00", "manual", kasa)
	tool := VoidFinanceEntry{finance: fakeFinanceW{w}, cari: fakeCariW{w}}

	_, err := propose(t, tool, ownerEnv(), `{}`)
	wantInputErr(t, err, "exactly one")
	p := mustPropose(t, tool, ownerEnv(), `{"transaction_uuid":"`+tx.UUID.String()+`"}`)
	if !strings.Contains(field(p, "account_balance_after"), "800,00") || len(w.writes) != 0 {
		t.Fatalf("preview = %+v writes=%v", p.Preview.Fields, w.writes)
	}
	out := run(t, tool, ownerEnv(), p.Input)
	if out["status"] != "void" || out["account_balances"].(map[string]any)["Ana Kasa"] != "₺800,00" {
		t.Fatalf("out = %v", out)
	}
	_, err = propose(t, tool, ownerEnv(), `{"transaction_uuid":"`+tx.UUID.String()+`"}`)
	wantInputErr(t, err, "already void")
}

func TestVoidFinanceEntryRefusesDocumentEntries(t *testing.T) {
	w := newWorld()
	kasa := w.account("Ana Kasa")
	job := w.addTx("income", "300.00", financeusecase.SourceServiceJob, kasa)
	jobUUID := uuid.New()
	job.SourceDetail = &financeusecase.SourceDetail{Kind: financeusecase.SourceServiceJob, UUID: jobUUID, Plate: "34ABC123", Title: "Ali"}
	sale := w.addTx("income", "50.00", financeusecase.SourceProductSale, kasa)
	tool := VoidFinanceEntry{finance: fakeFinanceW{w}, cari: fakeCariW{w}}

	_, err := propose(t, tool, ownerEnv(), `{"transaction_uuid":"`+job.UUID.String()+`"}`)
	wantInputErr(t, err, "cancel_job", jobUUID.String())
	_, err = propose(t, tool, ownerEnv(), `{"transaction_uuid":"`+sale.UUID.String()+`"}`)
	wantInputErr(t, err, "sale")

	// A cari entry posted by a job close is refused too.
	c := w.addCustomer("Ali", "", "34ABC123")
	e := &cariusecase.EntryInfo{Entry: cariusecase.Entry{UUID: uuid.New(), AccountUUID: *c.CariAccountUUID, Type: "charge", Status: "posted", Amount: "300.00"}, SourceType: financeusecase.SourceServiceJob}
	w.entries[e.UUID] = e
	_, err = propose(t, tool, ownerEnv(), `{"cari_entry_uuid":"`+e.UUID.String()+`"}`)
	wantInputErr(t, err, "cancel_job")
	if len(w.writes) != 0 {
		t.Fatalf("writes = %v", w.writes)
	}
}

func TestVoidFinanceEntryCariCollectionGoesThroughCari(t *testing.T) {
	w := newWorld()
	c := w.addCustomer("Ali", "", "34ABC123")
	w.cari[c.UUID].Balance = "100.00"
	kasa := w.account("Ana Kasa")
	e := &cariusecase.EntryInfo{Entry: cariusecase.Entry{UUID: uuid.New(), AccountUUID: *c.CariAccountUUID, Type: "payment", Status: "posted", Amount: "400.00"}, CustomerName: "Ali"}
	ftx := w.addTx("income", "400.00", financeusecase.SourceCariPayment, kasa)
	ftx.SourceUUID = &e.UUID
	e.FinanceTransactionUUID, e.FinanceAccountUUID = &ftx.UUID, &kasa.UUID
	w.entries[e.UUID] = e
	tool := VoidFinanceEntry{finance: fakeFinanceW{w}, cari: fakeCariW{w}}

	// Without cari.write the finance path is closed for collections.
	env := ownerEnv()
	env.Principal.Permissions = []string{rbac.PermTenantFinanceRead, rbac.PermTenantFinanceWrite}
	_, err := propose(t, tool, env, `{"transaction_uuid":"`+ftx.UUID.String()+`"}`)
	wantInputErr(t, err, "cari write")

	p := mustPropose(t, tool, ownerEnv(), `{"transaction_uuid":"`+ftx.UUID.String()+`"}`)
	if !strings.Contains(field(p, "balance_after"), "500,00") {
		t.Fatalf("preview = %+v", p.Preview.Fields)
	}
	out := run(t, tool, ownerEnv(), p.Input)
	if strings.Join(w.writes, ",") != "cari.void" || out["cari_balance"] != "₺500,00" || out["voided_finance_transaction_uuid"] != ftx.UUID.String() {
		t.Fatalf("writes=%v out=%v", w.writes, out)
	}
}

func TestUpdateFinanceEntry(t *testing.T) {
	w := newWorld()
	kasa := w.account("Ana Kasa")
	tx := w.addTx("expense", "100.00", "", kasa)
	genel := w.category("Genel Gider")
	tool := UpdateFinanceEntry{finance: fakeFinanceW{w}}

	_, err := propose(t, tool, ownerEnv(), `{"transaction_uuid":"`+tx.UUID.String()+`"}`)
	wantInputErr(t, err, "nothing to change")
	_, err = propose(t, tool, ownerEnv(), `{"transaction_uuid":"`+tx.UUID.String()+`","category":"Hizmet Geliri"}`)
	wantInputErr(t, err, "not found")

	p := mustPropose(t, tool, ownerEnv(), `{"transaction_uuid":"`+tx.UUID.String()+`","category":"genel gider","amount":150,"finance_account":"Garanti POS"}`)
	if field(p, "finance_account") != "Ana Kasa → Garanti POS" || !strings.Contains(field(p, "from_balance_after"), "1.100,00") ||
		!strings.Contains(field(p, "to_balance_after"), "4.850,00") || len(w.writes) != 0 {
		t.Fatalf("preview = %+v", p.Preview.Fields)
	}
	if err := Validate(updateEntrySchema, p.Input); err != nil {
		t.Fatalf("stored input invalid: %v", err)
	}
	out := run(t, tool, ownerEnv(), p.Input)
	u := w.updateIn
	if u.CategoryUUID == nil || *u.CategoryUUID != genel.UUID || u.Amount == nil || *u.Amount != "150.00" || u.AccountUUID == nil || *u.AccountUUID != w.account("Garanti POS").UUID || u.TransactionDate != nil {
		t.Fatalf("update input = %+v", u)
	}
	if out["category"] != "Genel Gider" {
		t.Fatalf("out = %v", out)
	}

	job := w.addTx("income", "300.00", financeusecase.SourceServiceJob, kasa)
	_, err = propose(t, tool, ownerEnv(), `{"transaction_uuid":"`+job.UUID.String()+`","description":"x"}`)
	wantInputErr(t, err, "cancel_job")
}

func TestNewToolsAreRegisteredAndConfirmable(t *testing.T) {
	w := newWorld()
	r := DefaultRegistry(Deps{
		Customers: nopReader{}, CustomersSearch: fakeSearch{w}, Cari: fakeCariW{w}, Jobs: fakeJobsW{w}, Finance: fakeFinanceW{w},
		UnpaidJobs: fakeJobsW{w}, CariWrite: fakeCariW{w}, FinanceWrite: fakeFinanceW{w}, CustomersWrite: fakeCustomersW{w},
		VehicleCatalog: fakeVehicles{w}, VehicleOptions: nopVehicleOptions{}, JobsWrite: fakeJobsW{w}, CatalogLookup: fakeCatalogL{w},
	})
	for _, name := range []string{"record_job_payment", "cancel_job", "quick_job", "void_finance_entry", "update_finance_entry"} {
		tool, ok := r.Get(name)
		if !ok {
			t.Fatalf("%s not registered", name)
		}
		spec := tool.Spec()
		if _, isAction := tool.(ActionTool); !isAction || spec.Kind != KindWrite || !spec.RequiresConfirmation || spec.Feature != FeatureActions {
			t.Errorf("%s is not a confirmable write tool", name)
		}
	}
	for _, name := range []string{"list_services", "list_finance_categories"} {
		tool, ok := r.Get(name)
		if !ok || tool.Spec().Kind != KindRead {
			t.Errorf("%s: read tool missing", name)
		}
	}
	// Owner-only money corrections.
	for _, name := range []string{"void_finance_entry", "update_finance_entry"} {
		tool, _ := r.Get(name)
		if roles := tool.Spec().OrgRoles; len(roles) != 1 || roles[0] != "owner" {
			t.Errorf("%s roles = %v", name, roles)
		}
	}
}

type nopReader struct{ CustomerReader }
