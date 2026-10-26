// Package orgtools holds the MCP-only read tools of the business endpoint
// (/mcp/org, docs/MCP.md) that the panel assistant does not have yet: leads
// and quotes. They implement the AI assistant's tools.Tool interface and
// read through the module use cases, which take the organization from
// orgctx, so another organization's record is "not found".
package orgtools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	aitools "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	leadsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/leads/usecase"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// FeatureQuotes is the plan toggle of the leads and quotes module.
const FeatureQuotes = "module.quotes"

const (
	defaultLimit = 20
	maxLimit     = 50
	maxText      = 160
)

// Leads is the leads use case.
type Leads interface {
	List(ctx context.Context, limit, offset int32, f leadsusecase.ListFilters) ([]leadsusecase.Lead, int64, error)
}

// Quotes is the quotes use case.
type Quotes interface {
	List(ctx context.Context, limit, offset int32, f quotesusecase.ListFilters) ([]quotesusecase.Quote, int64, error)
}

// Deps are the use cases behind the tools; nil leaves a tool out.
type Deps struct {
	Leads  Leads
	Quotes Quotes
}

// Tools returns the MCP-only business tools.
func Tools(d Deps) []aitools.Tool {
	var out []aitools.Tool
	if d.Leads != nil {
		out = append(out, ListLeads{leads: d.Leads})
	}
	if d.Quotes != nil {
		out = append(out, ListQuotes{quotes: d.Quotes})
	}
	return out
}

func pageProps(props map[string]any) map[string]any {
	props["limit"] = map[string]any{"type": "integer", "minimum": 1, "maximum": maxLimit, "description": "Page size (default 20)."}
	props["offset"] = map[string]any{"type": "integer", "minimum": 0, "maximum": 100000}
	return props
}

func clamp(limit, offset int32) (int32, int32) {
	if limit <= 0 {
		limit = defaultLimit
	}
	return min(limit, maxLimit), max(offset, 0)
}

func optUUID(raw string) (*uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func domainError(err error, invalid error) (aitools.Result, error) {
	if errors.Is(err, invalid) {
		return aitools.ErrorResult("Invalid input: " + err.Error()), nil
	}
	return aitools.Result{}, err
}

// --- leads ----------------------------------------------------------------------

var leadsSchema = map[string]any{
	"type": "object", "additionalProperties": false,
	"properties": pageProps(map[string]any{
		"q":             map[string]any{"type": "string", "maxLength": 120, "description": "Search in customer name, phone, plate or interest."},
		"status":        map[string]any{"type": "string", "enum": []string{"open", "new", "contacted", "quoted", "won", "lost"}, "description": "open = not won or lost."},
		"temperature":   map[string]any{"type": "string", "enum": []string{"hot", "warm", "cold"}},
		"follow_up":     map[string]any{"type": "string", "enum": []string{"overdue", "today"}, "description": "Leads whose follow-up is overdue or due today."},
		"assignee":      map[string]any{"type": "string", "enum": []string{"me"}, "description": "Only leads assigned to the user."},
		"customer_uuid": map[string]any{"type": "string", "format": "uuid"},
	}),
}

// ListLeads lists sales opportunities (leads).
type ListLeads struct{ leads Leads }

// Entitlement implements mcp.Entitled.
func (ListLeads) Entitlement() string { return FeatureQuotes }

// Spec implements tools.Tool.
func (ListLeads) Spec() aitools.Spec {
	return aitools.Spec{
		Name: "list_leads",
		Description: "List sales opportunities (leads) with customer, vehicle, interest, temperature, status and " +
			"follow-up date. Use for follow-up planning (follow_up=overdue|today) and pipeline questions.",
		InputSchema: leadsSchema, Permissions: []string{rbac.PermTenantLeadsRead},
		Feature: aitools.FeatureChat, Kind: aitools.KindRead,
	}
}

type leadItem struct {
	UUID         string  `json:"uuid"`
	CustomerUUID string  `json:"customer_uuid"`
	Customer     string  `json:"customer"`
	Plate        string  `json:"plate,omitempty"`
	Vehicle      string  `json:"vehicle,omitempty"`
	Interest     string  `json:"interest,omitempty"`
	Source       string  `json:"source"`
	Temperature  string  `json:"temperature"`
	Status       string  `json:"status"`
	FollowUp     *string `json:"follow_up_date"`
	FollowUpDue  string  `json:"follow_up_state"`
	Assignee     string  `json:"assignee,omitempty"`
	Quotes       int64   `json:"quote_count"`
	CreatedAt    string  `json:"created_at"`
}

// Run implements tools.Tool.
func (t ListLeads) Run(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
	var in struct {
		Limit        int32  `json:"limit"`
		Offset       int32  `json:"offset"`
		Q            string `json:"q"`
		Status       string `json:"status"`
		Temperature  string `json:"temperature"`
		FollowUp     string `json:"follow_up"`
		Assignee     string `json:"assignee"`
		CustomerUUID string `json:"customer_uuid"`
	}
	if err := aitools.Decode(leadsSchema, raw, &in); err != nil {
		return aitools.ErrorResult("Invalid input: " + err.Error()), nil
	}
	cust, err := optUUID(in.CustomerUUID)
	if err != nil {
		return aitools.ErrorResult("Invalid input: customer_uuid must be a uuid"), nil
	}
	l, o := clamp(in.Limit, in.Offset)
	rows, total, err := t.leads.List(ctx, l, o, leadsusecase.ListFilters{
		Q: strings.TrimSpace(in.Q), Status: in.Status, Temperature: in.Temperature,
		FollowUp: in.FollowUp, Assignee: in.Assignee, CustomerUUID: cust,
	})
	if err != nil {
		return domainError(err, leadsusecase.ErrInvalidRequest)
	}
	items := make([]leadItem, 0, len(rows))
	for _, r := range rows {
		it := leadItem{
			UUID: r.UUID.String(), CustomerUUID: r.CustomerUUID.String(), Customer: aitools.DataText(r.CustomerName, maxText),
			Plate: aitools.DataText(r.VehiclePlate, 32), Vehicle: aitools.DataText(r.VehicleText, maxText),
			Interest: aitools.DataText(r.Interest, maxText), Source: r.Source, Temperature: r.Temperature, Status: r.Status,
			FollowUp: r.FollowUpDate, FollowUpDue: r.FollowUpState, Quotes: r.QuoteCount,
			CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339),
		}
		if r.Assignee != nil {
			it.Assignee = aitools.DataText(r.Assignee.Label, maxText)
		}
		items = append(items, it)
	}
	return aitools.JSONResult(map[string]any{"items": items, "total": total, "limit": l, "offset": o}, "", nil), nil
}

// --- quotes ---------------------------------------------------------------------

var quotesSchema = map[string]any{
	"type": "object", "additionalProperties": false,
	"properties": pageProps(map[string]any{
		"q":             map[string]any{"type": "string", "maxLength": 120, "description": "Search in quote number, customer or plate."},
		"status":        map[string]any{"type": "string", "enum": []string{"open", "draft", "sent", "viewed", "accepted", "rejected", "expired", "cancelled"}, "description": "open = draft, sent or viewed."},
		"customer_uuid": map[string]any{"type": "string", "format": "uuid"},
		"lead_uuid":     map[string]any{"type": "string", "format": "uuid"},
	}),
}

// ListQuotes lists price quotes.
type ListQuotes struct{ quotes Quotes }

// Entitlement implements mcp.Entitled.
func (ListQuotes) Entitlement() string { return FeatureQuotes }

// Spec implements tools.Tool.
func (ListQuotes) Spec() aitools.Spec {
	return aitools.Spec{
		Name: "list_quotes",
		Description: "List price quotes (teklif) with number, status, customer, vehicle, grand total and validity. " +
			"Use for open quotes, acceptance follow-up and quote totals.",
		InputSchema: quotesSchema, Permissions: []string{rbac.PermTenantQuotesRead},
		Feature: aitools.FeatureChat, Kind: aitools.KindRead,
	}
}

type quoteItem struct {
	UUID         string  `json:"uuid"`
	Number       string  `json:"number"`
	Status       string  `json:"status"`
	CustomerUUID string  `json:"customer_uuid"`
	Customer     string  `json:"customer"`
	Plate        string  `json:"plate,omitempty"`
	Vehicle      string  `json:"vehicle,omitempty"`
	Total        string  `json:"grand_total"`
	TotalNumber  float64 `json:"grand_total_number"`
	ValidUntil   *string `json:"valid_until"`
	PastValid    bool    `json:"is_past_valid_until"`
	Lines        int64   `json:"line_count"`
	CreatedAt    string  `json:"created_at"`
}

// Run implements tools.Tool.
func (t ListQuotes) Run(ctx context.Context, _ aitools.Env, raw json.RawMessage) (aitools.Result, error) {
	var in struct {
		Limit        int32  `json:"limit"`
		Offset       int32  `json:"offset"`
		Q            string `json:"q"`
		Status       string `json:"status"`
		CustomerUUID string `json:"customer_uuid"`
		LeadUUID     string `json:"lead_uuid"`
	}
	if err := aitools.Decode(quotesSchema, raw, &in); err != nil {
		return aitools.ErrorResult("Invalid input: " + err.Error()), nil
	}
	cust, err := optUUID(in.CustomerUUID)
	if err != nil {
		return aitools.ErrorResult("Invalid input: customer_uuid must be a uuid"), nil
	}
	lead, err := optUUID(in.LeadUUID)
	if err != nil {
		return aitools.ErrorResult("Invalid input: lead_uuid must be a uuid"), nil
	}
	l, o := clamp(in.Limit, in.Offset)
	rows, total, err := t.quotes.List(ctx, l, o, quotesusecase.ListFilters{
		Q: strings.TrimSpace(in.Q), Status: in.Status, CustomerUUID: cust, LeadUUID: lead,
	})
	if err != nil {
		return domainError(err, quotesusecase.ErrInvalidRequest)
	}
	items := make([]quoteItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, quoteItem{
			UUID: r.UUID.String(), Number: r.Number, Status: r.Status, CustomerUUID: r.CustomerUUID.String(),
			Customer: aitools.DataText(r.CustomerName, maxText), Plate: aitools.DataText(r.VehiclePlate, 32),
			Vehicle: aitools.DataText(r.VehicleLabel, maxText), Total: aitools.FormatMoney(r.GrandTotal, r.Currency),
			TotalNumber: aitools.Number(r.GrandTotal), ValidUntil: r.ValidUntil, PastValid: r.Expired,
			Lines: r.LineCount, CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return aitools.JSONResult(map[string]any{"items": items, "total": total, "limit": l, "offset": o}, "", nil), nil
}
