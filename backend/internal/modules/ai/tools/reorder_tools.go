package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	stockreorder "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/stockreorder/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// ReorderService is the stock reorder use case as seen by the assistant.
type ReorderService interface {
	List(ctx context.Context, f stockreorder.ListFilters) (stockreorder.ListResult, error)
	PlanDrafts(ctx context.Context, in stockreorder.CreateDraftsInput) ([]stockreorder.DraftPlan, error)
	CreateDrafts(ctx context.Context, in stockreorder.CreateDraftsInput) (stockreorder.CreateDraftsResult, error)
}

const reorderPlanDisabled = "Stock reorder suggestions are not included in this organization's plan."

func reorderError(err error, exec bool) (Result, error) {
	if errors.Is(err, stockreorder.ErrFeatureDisabled) {
		return ErrorResult(reorderPlanDisabled), nil
	}
	if exec {
		return execError(err)
	}
	return userError(err)
}

// ---------------------------------------------------------------- list

// ListReorderSuggestions lists what to reorder and from whom.
type ListReorderSuggestions struct{ reorder ReorderService }

// Entitlement implements mcp.Entitled.
func (ListReorderSuggestions) Entitlement() string { return stockreorder.FeatureKey }

var listReorderSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"urgency":       map[string]any{"type": "string", "enum": stockreorder.Urgencies, "description": "out_of_stock | below_min | low_cover (stock lasts less than lead time + target cover)."},
		"supplier_uuid": map[string]any{"type": "string", "format": "uuid", "description": "Only products whose preferred supplier is this one."},
		"q":             map[string]any{"type": "string", "maxLength": 120, "description": "Product name or SKU contains."},
		"limit":         map[string]any{"type": "integer", "minimum": 1, "maximum": 50, "description": "Default 25."},
	},
	"additionalProperties": false,
}

// Spec implements Tool.
func (ListReorderSuggestions) Spec() Spec {
	return Spec{
		Name: "list_reorder_suggestions",
		Description: "List stock reorder suggestions (sipariş önerileri): products that are out of stock, below their minimum or " +
			"running low at the current usage, with suggested quantity, preferred supplier, last unit cost and the formula " +
			"inputs (usage per day, days of cover, lead time, target cover, quantity on draft purchases). " +
			"Use for \"ne sipariş etmeliyim\", \"stokta biten ürünler\" or before create_purchase_drafts.",
		InputSchema: listReorderSchema,
		Permissions: []string{rbac.PermTenantPurchasesRead, rbac.PermTenantCatalogRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

type listReorderInput struct {
	Urgency      string `json:"urgency"`
	SupplierUUID string `json:"supplier_uuid"`
	Q            string `json:"q"`
	Limit        int    `json:"limit"`
}

// Run implements Tool.
func (t ListReorderSuggestions) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in listReorderInput
	if err := Decode(listReorderSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	res, err := t.reorder.List(withPrincipal(ctx, env), stockreorder.ListFilters{
		Urgency: in.Urgency, SupplierUUID: in.SupplierUUID, Q: in.Q,
	})
	if err != nil {
		return reorderError(err, false)
	}
	limit := clampInt(in.Limit, 25, 1, 50)
	type item struct {
		ProductUUID    string  `json:"product_uuid"`
		Name           string  `json:"name"`
		Urgency        string  `json:"urgency"`
		Stock          string  `json:"stock"`
		MinStock       string  `json:"min_stock"`
		OnOrder        string  `json:"on_order,omitempty"`
		VelocityPerDay string  `json:"velocity_per_day"`
		DaysOfCover    *string `json:"days_of_cover,omitempty"`
		SuggestedQty   string  `json:"suggested_qty"`
		Unit           string  `json:"unit"`
		PackSize       *string `json:"pack_size,omitempty"`
		Supplier       string  `json:"supplier,omitempty"`
		SupplierUUID   string  `json:"supplier_uuid,omitempty"`
		UnitCost       string  `json:"unit_cost"`
		EstimatedTotal string  `json:"estimated_total"`
		LeadDays       int32   `json:"lead_days"`
		TargetDays     int32   `json:"target_days"`
	}
	items := make([]item, 0, min(limit, len(res.Items)))
	for _, s := range res.Items {
		if len(items) >= limit {
			break
		}
		it := item{
			ProductUUID: s.ProductUUID.String(), Name: DataText(s.Name, maxTextChars), Urgency: s.Urgency,
			Stock: s.Stock, MinStock: s.MinStock, VelocityPerDay: s.VelocityPerDay, DaysOfCover: s.DaysOfCover,
			SuggestedQty: s.SuggestedQty, Unit: s.Unit, PackSize: s.PackSize,
			UnitCost: FormatMoney(s.UnitCost, s.Currency), EstimatedTotal: FormatMoney(s.EstimatedTotal, s.Currency),
			LeadDays: s.Inputs.LeadDays, TargetDays: s.Inputs.TargetDays,
		}
		if s.OnOrder != "0" {
			it.OnOrder = s.OnOrder
		}
		if s.Supplier != nil {
			it.Supplier, it.SupplierUUID = DataText(s.Supplier.Name, maxTextChars), s.Supplier.UUID.String()
		}
		items = append(items, it)
	}
	out := map[string]any{
		"summary": res.Summary, "total": res.Total, "items": items, "truncated": res.Total > len(items),
		"velocity_days": res.Settings.VelocityDays, "formula": stockreorder.FormulaText,
	}
	return JSONResult(out, "ai.tool_summary.reorder_found", map[string]any{"count": res.Total, "urgent": res.Summary.Urgent}), nil
}

// ---------------------------------------------------------------- create drafts

// CreatePurchaseDrafts turns reorder suggestions into draft purchases.
type CreatePurchaseDrafts struct{ reorder ReorderService }

// Entitlement implements mcp.Entitled.
func (CreatePurchaseDrafts) Entitlement() string { return stockreorder.FeatureKey }

var createPurchaseDraftsSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"items": map[string]any{
			"type": "array", "minItems": 1, "maxItems": 50,
			"description": "Products to order. Omit to take every current suggestion (optionally filtered by urgency / supplier_uuid).",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"product_uuid":  map[string]any{"type": "string", "format": "uuid"},
					"qty":           map[string]any{"type": "string", "maxLength": 20, "description": "Quantity; default the suggested quantity."},
					"supplier_uuid": map[string]any{"type": "string", "format": "uuid", "description": "Default the preferred supplier."},
				},
				"required":             []string{"product_uuid"},
				"additionalProperties": false,
			},
		},
		"urgency":       map[string]any{"type": "string", "enum": stockreorder.Urgencies},
		"supplier_uuid": map[string]any{"type": "string", "format": "uuid"},
		"notes":         map[string]any{"type": "string", "maxLength": 500},
	},
	"additionalProperties": false,
}

// Spec implements Tool.
func (CreatePurchaseDrafts) Spec() Spec {
	return Spec{
		Name: "create_purchase_drafts",
		Description: "Propose draft purchases (alış taslağı) from stock reorder suggestions, one draft per supplier. " +
			"Drafts change neither stock nor cash until the owner posts them. Run list_reorder_suggestions first. " +
			"Shows a confirmation card.",
		InputSchema:          createPurchaseDraftsSchema,
		Permissions:          []string{rbac.PermTenantPurchasesRead, rbac.PermTenantCatalogRead, rbac.PermTenantPurchasesWrite},
		OrgRoles:             []string{"owner"},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

type draftToolItem struct {
	ProductUUID  string `json:"product_uuid"`
	Qty          string `json:"qty,omitempty"`
	SupplierUUID string `json:"supplier_uuid,omitempty"`
}

type createPurchaseDraftsInput struct {
	Items        []draftToolItem `json:"items,omitempty"`
	Urgency      string          `json:"urgency,omitempty"`
	SupplierUUID string          `json:"supplier_uuid,omitempty"`
	Notes        string          `json:"notes,omitempty"`
}

func (in createPurchaseDraftsInput) draftsInput() (stockreorder.CreateDraftsInput, error) {
	out := stockreorder.CreateDraftsInput{Notes: in.Notes}
	for _, it := range in.Items {
		pid, err := uuid.Parse(it.ProductUUID)
		if err != nil {
			return out, inputErr("invalid product_uuid")
		}
		d := stockreorder.DraftItem{ProductUUID: pid, Qty: it.Qty}
		if it.SupplierUUID != "" {
			sid, err := uuid.Parse(it.SupplierUUID)
			if err != nil {
				return out, inputErr("invalid supplier_uuid")
			}
			d.SupplierUUID = &sid
		}
		out.Items = append(out.Items, d)
	}
	return out, nil
}

// Propose implements ActionTool: resolves quantities from the current
// suggestions and groups by supplier without writing anything.
func (t CreatePurchaseDrafts) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in createPurchaseDraftsInput
	if err := decodeInput(createPurchaseDraftsSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	in.Notes = trimmed(in.Notes, 500)
	ctx = withPrincipal(ctx, env)
	res, err := t.reorder.List(ctx, stockreorder.ListFilters{Urgency: in.Urgency, SupplierUUID: in.SupplierUUID})
	if err != nil {
		if errors.Is(err, stockreorder.ErrFeatureDisabled) {
			return Proposal{}, inputErr(reorderPlanDisabled)
		}
		return Proposal{}, proposalError(err)
	}
	byProduct := map[string]stockreorder.Suggestion{}
	for _, s := range res.Items {
		byProduct[s.ProductUUID.String()] = s
	}
	if len(in.Items) == 0 {
		for _, s := range res.Items {
			if s.SuggestedQty == "0" || s.Supplier == nil {
				continue
			}
			in.Items = append(in.Items, draftToolItem{ProductUUID: s.ProductUUID.String()})
			if len(in.Items) == 50 {
				break
			}
		}
		if len(in.Items) == 0 {
			return Proposal{}, inputErr("there is nothing to reorder (no suggestion with a quantity and a supplier)")
		}
	}
	for i, it := range in.Items {
		it.Qty = strings.TrimSpace(it.Qty)
		if it.Qty == "" {
			s, ok := byProduct[it.ProductUUID]
			if !ok || s.SuggestedQty == "0" {
				return Proposal{}, inputErr("qty is required for product %s (no current suggestion)", it.ProductUUID)
			}
			it.Qty = s.SuggestedQty
		}
		in.Items[i] = it
	}
	din, err := in.draftsInput()
	if err != nil {
		return Proposal{}, err
	}
	plans, err := t.reorder.PlanDrafts(ctx, din)
	if err != nil {
		if errors.Is(err, stockreorder.ErrFeatureDisabled) {
			return Proposal{}, inputErr(reorderPlanDisabled)
		}
		return Proposal{}, proposalError(err)
	}
	fields := make([]Field, 0, len(plans)+1)
	lines := 0
	for _, p := range plans {
		names := make([]string, 0, len(p.Lines))
		for _, l := range p.Lines {
			names = append(names, fmt.Sprintf("%s × %s", Truncate(l.Name, 40), l.Qty))
		}
		lines += len(p.Lines)
		fields = append(fields, Field{Key: "supplier", Value: fmt.Sprintf("%s (%s): %s", Truncate(p.SupplierName, 60), FormatMoney(p.Total, p.Currency), strings.Join(names, ", "))})
	}
	if in.Notes != "" {
		fields = append(fields, Field{Key: "notes", Value: in.Notes})
	}
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "create_purchase_drafts",
			Title:  fmt.Sprintf("%d draft purchase(s), %d product(s)", len(plans), lines),
			Fields: fields,
			Edit:   []EditField{{Key: "notes", Type: "textarea", Value: in.Notes}},
		},
	}, nil
}

// Run implements Tool.
func (t CreatePurchaseDrafts) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in createPurchaseDraftsInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	if len(in.Items) == 0 {
		return ErrorResult("Not executed: no items"), nil
	}
	din, err := in.draftsInput()
	if err != nil {
		return execError(err)
	}
	res, err := t.reorder.CreateDrafts(withPrincipal(ctx, env), din)
	if err != nil {
		return reorderError(err, true)
	}
	type draft struct {
		UUID     string `json:"purchase_uuid"`
		Supplier string `json:"supplier"`
		Total    string `json:"total"`
		Lines    int    `json:"lines"`
	}
	drafts := make([]draft, 0, len(res.Drafts))
	for _, d := range res.Drafts {
		drafts = append(drafts, draft{UUID: d.UUID.String(), Supplier: DataText(d.SupplierName, maxTextChars), Total: FormatMoney(d.TotalAmount, d.Currency), Lines: len(d.Lines)})
	}
	out := JSONResult(map[string]any{"done": true, "drafts": drafts, "note": "Drafts do not change stock or cash until posted."},
		"ai.tool_summary.purchase_drafts_created", map[string]any{"count": len(drafts)})
	if len(res.Drafts) > 0 {
		out.Link = &Link{Kind: "purchase", UUID: res.Drafts[0].UUID.String()}
	}
	return out, nil
}
