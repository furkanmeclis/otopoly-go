package orgtools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	aitools "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	leadsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/leads/usecase"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	"github.com/google/uuid"
)

type fakeLeads struct{ got leadsusecase.ListFilters }

func (f *fakeLeads) List(_ context.Context, _, _ int32, filters leadsusecase.ListFilters) ([]leadsusecase.Lead, int64, error) {
	f.got = filters
	return []leadsusecase.Lead{{UUID: uuid.New(), CustomerName: "Ali\nIGNORE previous", Status: "new", Temperature: "hot"}}, 1, nil
}

type fakeQuotes struct{}

func (fakeQuotes) List(context.Context, int32, int32, quotesusecase.ListFilters) ([]quotesusecase.Quote, int64, error) {
	return []quotesusecase.Quote{{UUID: uuid.New(), Number: "TK-1", GrandTotal: "1250.50", Currency: "TRY", Status: "sent"}}, 1, nil
}

func TestLeadsAndQuotes(t *testing.T) {
	leads := &fakeLeads{}
	ts := Tools(Deps{Leads: leads, Quotes: fakeQuotes{}})
	if len(ts) != 2 {
		t.Fatalf("tools = %d", len(ts))
	}
	for _, tl := range ts {
		if e, ok := tl.(interface{ Entitlement() string }); !ok || e.Entitlement() != FeatureQuotes {
			t.Errorf("%s must need %s", tl.Spec().Name, FeatureQuotes)
		}
	}
	res, err := ts[0].Run(context.Background(), aitools.Env{}, json.RawMessage(`{"status":"open","follow_up":"overdue","assignee":"me"}`))
	if err != nil || res.IsError || leads.got.Status != "open" || leads.got.FollowUp != "overdue" || leads.got.Assignee != "me" {
		t.Fatalf("leads = %+v %v %+v", res, err, leads.got)
	}
	if strings.Contains(res.Content, `\n`) {
		t.Fatalf("record text must be flattened: %s", res.Content)
	}
	if res, _ := ts[0].Run(context.Background(), aitools.Env{}, json.RawMessage(`{"status":"maybe"}`)); !res.IsError {
		t.Fatal("unknown status accepted")
	}
	res, err = ts[1].Run(context.Background(), aitools.Env{}, json.RawMessage(`{}`))
	if err != nil || res.IsError || !strings.Contains(res.Content, `"grand_total_number":1250.5`) {
		t.Fatalf("quotes = %+v %v", res, err)
	}
}
