package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	purchasesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases/usecase"
	stockreorder "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/stockreorder/usecase"
	"github.com/google/uuid"
)

type fakeReorder struct {
	items    []stockreorder.Suggestion
	disabled bool
	planned  stockreorder.CreateDraftsInput
	created  []stockreorder.CreateDraftsInput
}

func (f *fakeReorder) List(_ context.Context, _ stockreorder.ListFilters) (stockreorder.ListResult, error) {
	if f.disabled {
		return stockreorder.ListResult{}, stockreorder.ErrFeatureDisabled
	}
	return stockreorder.ListResult{Items: f.items, Total: len(f.items), Summary: stockreorder.Summary{Urgent: 1}}, nil
}

func (f *fakeReorder) PlanDrafts(_ context.Context, in stockreorder.CreateDraftsInput) ([]stockreorder.DraftPlan, error) {
	f.planned = in
	var lines []stockreorder.DraftPlanLine
	for _, it := range in.Items {
		lines = append(lines, stockreorder.DraftPlanLine{ProductUUID: it.ProductUUID, Name: "Yağ", Qty: it.Qty})
	}
	return []stockreorder.DraftPlan{{SupplierName: "Tedarik A", Currency: "TRY", Total: "100.00", Lines: lines}}, nil
}

func (f *fakeReorder) CreateDrafts(_ context.Context, in stockreorder.CreateDraftsInput) (stockreorder.CreateDraftsResult, error) {
	f.created = append(f.created, in)
	d := purchasesusecase.PurchaseDetail{Purchase: purchasesusecase.Purchase{UUID: uuid.New(), SupplierName: "Tedarik A", TotalAmount: "100.00", Currency: "TRY", Status: "draft"}}
	return stockreorder.CreateDraftsResult{Drafts: []purchasesusecase.PurchaseDetail{d}}, nil
}

func TestListReorderSuggestions(t *testing.T) {
	sup := uuid.New()
	f := &fakeReorder{items: []stockreorder.Suggestion{{
		ProductUUID: uuid.New(), Name: "Yağ", Urgency: stockreorder.UrgencyOutOfStock, Stock: "0", MinStock: "2",
		VelocityPerDay: "1", SuggestedQty: "19", Unit: "L", Currency: "TRY", UnitCost: "10.00", EstimatedTotal: "190.00",
		Supplier: &stockreorder.SupplierRef{UUID: sup, Name: "Tedarik A"},
	}}}
	res, err := (ListReorderSuggestions{reorder: f}).Run(context.Background(), Env{}, json.RawMessage(`{"urgency":"out_of_stock"}`))
	if err != nil || res.IsError {
		t.Fatalf("run: %v %s", err, res.Content)
	}
	if !strings.Contains(res.Content, `"suggested_qty":"19"`) || !strings.Contains(res.Content, sup.String()) {
		t.Fatalf("content: %s", res.Content)
	}
	if res, _ := (ListReorderSuggestions{reorder: f}).Run(context.Background(), Env{}, json.RawMessage(`{"urgency":"soon"}`)); !res.IsError {
		t.Fatal("unknown urgency must fail schema validation")
	}
	f.disabled = true
	if res, err := (ListReorderSuggestions{reorder: f}).Run(context.Background(), Env{}, json.RawMessage(`{}`)); err != nil || !res.IsError {
		t.Fatalf("plan disabled: %v %+v", err, res)
	}
}

func TestCreatePurchaseDraftsProposeAndRun(t *testing.T) {
	withSupplier := uuid.New()
	noSupplier := uuid.New()
	f := &fakeReorder{items: []stockreorder.Suggestion{
		{ProductUUID: withSupplier, Name: "Yağ", SuggestedQty: "12", Supplier: &stockreorder.SupplierRef{UUID: uuid.New(), Name: "A"}},
		{ProductUUID: noSupplier, Name: "Bez", SuggestedQty: "3"},
	}}
	tool := CreatePurchaseDrafts{reorder: f}
	// No items: every suggestion with a quantity and a supplier.
	p, err := tool.Propose(context.Background(), Env{}, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(f.created) != 0 {
		t.Fatal("Propose must not create drafts")
	}
	if len(f.planned.Items) != 1 || f.planned.Items[0].ProductUUID != withSupplier || f.planned.Items[0].Qty != "12" {
		t.Fatalf("planned = %+v", f.planned)
	}
	if p.Preview.Action != "create_purchase_drafts" || len(p.Preview.Fields) == 0 {
		t.Fatalf("preview = %+v", p.Preview)
	}
	res, err := tool.Run(context.Background(), Env{}, p.Input)
	if err != nil || res.IsError {
		t.Fatalf("run: %v %s", err, res.Content)
	}
	if len(f.created) != 1 || f.created[0].Items[0].Qty != "12" || res.Link == nil || res.Link.Kind != "purchase" {
		t.Fatalf("created = %+v link %+v", f.created, res.Link)
	}
	// An explicit item without a current suggestion needs a quantity.
	if _, err := tool.Propose(context.Background(), Env{}, json.RawMessage(`{"items":[{"product_uuid":"`+uuid.NewString()+`"}]}`)); err == nil {
		t.Fatal("missing qty must fail")
	}
	f.disabled = true
	if _, err := tool.Propose(context.Background(), Env{}, json.RawMessage(`{}`)); err == nil {
		t.Fatal("plan disabled must fail")
	} else if _, ok := AsInputError(err); !ok {
		t.Fatalf("plan disabled is an input error: %v", err)
	}
}
