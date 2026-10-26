// Package usecase builds stock reorder suggestions: for every stock-tracked
// product of the organization it compares the stock (plus quantities on
// draft purchases) with the usage of the last N days over the supplier's
// lead time and a target cover, and suggests how much to order from which
// supplier. Suggestions become draft purchases grouped by supplier; a draft
// changes stock and finance only when it is posted (purchases module).
package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"slices"
	"sort"
	"strings"
	"time"
	_ "time/tzdata" // Europe/Istanbul without relying on the host zoneinfo.

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	purchasesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// FeatureKey is the plan toggle of reorder suggestions (undefined = on).
const FeatureKey = "stock_reorder.enabled"

// Defaults when the organization has not saved settings.
const (
	DefaultVelocityDays = 30
	DefaultLeadDays     = 3
	DefaultTargetDays   = 14
	// NotifyTime is the local (Europe/Istanbul) time of the daily
	// notification.
	NotifyTime = "09:00"

	businessTimeZone = "Europe/Istanbul"
	notifyMinutes    = 9 * 60
	maxDraftItems    = 200
)

// Velocity windows the settings accept.
var VelocityDayOptions = []int32{7, 14, 30, 60, 90}

var (
	ErrNotFound       = errors.New("stockreorder: not found")
	ErrInvalidRequest = errors.New("stockreorder: invalid request")
	// ErrFeatureDisabled: the organization's plan turns reorder suggestions off.
	ErrFeatureDisabled = entitlements.ErrFeatureDisabled
)

// FeatureChecker reports a plan toggle (entitlements.Service).
type FeatureChecker interface {
	Enabled(ctx context.Context, orgID int64, key string) (bool, error)
}

// Drafter creates draft purchases (purchases use case).
type Drafter interface {
	CreateDraft(ctx context.Context, in purchasesusecase.DraftInput) (purchasesusecase.PurchaseDetail, error)
	CountDrafts(ctx context.Context) (int64, error)
}

// Notifier creates the in-app notification of one member (the notifications
// module adds web and mobile push for members who enabled it).
type Notifier interface {
	NotifyReorder(ctx context.Context, orgID, userID int64, title, body, actionURL string, itemCount int) error
}

type Service struct {
	q        *db.Queries
	drafts   Drafter
	features FeatureChecker
	act      *activity.Recorder
	live     resourceevents.Publisher
	notifier Notifier
	loc      *time.Location
	now      func() time.Time
	log      *slog.Logger
}

func New(q *db.Queries, drafts Drafter, features FeatureChecker, act *activity.Recorder, log *slog.Logger) *Service {
	loc, err := time.LoadLocation(businessTimeZone)
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{q: q, drafts: drafts, features: features, act: act, loc: loc, now: time.Now, log: log}
}

// SetResourceEvents attaches the live publisher (optional).
func (s *Service) SetResourceEvents(pub resourceevents.Publisher) { s.live = pub }

// SetClock replaces the clock (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// SetNotifier attaches the daily notification sender (worker).
func (s *Service) SetNotifier(n Notifier) { s.notifier = n }

// ---------------------------------------------------------------- types

// SupplierLead is a supplier's lead time.
type SupplierLead struct {
	SupplierUUID uuid.UUID `json:"supplier_uuid"`
	SupplierName string    `json:"supplier_name,omitempty"`
	LeadDays     int32     `json:"lead_days"`
}

// Settings are the organization's reorder settings.
type Settings struct {
	VelocityDays  int32          `json:"velocity_days"`
	LeadDays      int32          `json:"lead_days"`
	TargetDays    int32          `json:"target_days"`
	NotifyEnabled bool           `json:"notify_enabled"`
	NotifyTime    string         `json:"notify_time"`
	SupplierLeads []SupplierLead `json:"supplier_lead_days"`
	// VelocityDayOptions are the windows the settings accept.
	VelocityDayOptions []int32 `json:"velocity_day_options"`
}

// SettingsInput updates the settings. SupplierLeads, when not nil, replaces
// every supplier lead time.
type SettingsInput struct {
	VelocityDays  int32          `json:"velocity_days"`
	LeadDays      int32          `json:"lead_days"`
	TargetDays    int32          `json:"target_days"`
	NotifyEnabled bool           `json:"notify_enabled"`
	SupplierLeads []SupplierLead `json:"supplier_lead_days"`
}

// ProductOverrideInput sets per-product values (nil = organization /
// supplier value).
type ProductOverrideInput struct {
	SupplierUUID *uuid.UUID `json:"supplier_uuid"`
	LeadDays     *int32     `json:"lead_days"`
	TargetDays   *int32     `json:"target_days"`
	PackSize     *string    `json:"pack_size"`
}

// ProductOverride is the saved override of a product.
type ProductOverride struct {
	SupplierUUID *uuid.UUID `json:"supplier_uuid"`
	SupplierName *string    `json:"supplier_name,omitempty"`
	LeadDays     *int32     `json:"lead_days"`
	TargetDays   *int32     `json:"target_days"`
	PackSize     *string    `json:"pack_size"`
}

// SupplierRef is the preferred supplier of a suggestion.
type SupplierRef struct {
	UUID uuid.UUID `json:"uuid"`
	Name string    `json:"name"`
	// Source: product (override) | last_purchase.
	Source string `json:"source"`
}

// Inputs explains a suggestion: every value the formula used.
type Inputs struct {
	VelocityDays int32  `json:"velocity_days"`
	ConsumedQty  string `json:"consumed_qty"`
	SoldQty      string `json:"sold_qty"`
	LeadDays     int32  `json:"lead_days"`
	// LeadDaysSource: product | supplier | organization.
	LeadDaysSource string `json:"lead_days_source"`
	TargetDays     int32  `json:"target_days"`
	// TargetDaysSource: product | organization.
	TargetDaysSource string `json:"target_days_source"`
	// DemandQty is velocity × (lead + target).
	DemandQty string `json:"demand_qty"`
	// RawNeed is demand + min − stock − on_order before rounding.
	RawNeed string `json:"raw_need"`
	Formula string `json:"formula"`
}

// Suggestion is one product's reorder suggestion.
type Suggestion struct {
	ProductUUID uuid.UUID `json:"product_uuid"`
	Name        string    `json:"name"`
	SKU         string    `json:"sku"`
	Unit        string    `json:"unit"`
	Currency    string    `json:"currency"`
	Urgency     string    `json:"urgency"`
	Stock       string    `json:"stock"`
	MinStock    string    `json:"min_stock"`
	OnOrder     string    `json:"on_order"`
	// VelocityPerDay is the average daily usage.
	VelocityPerDay string `json:"velocity_per_day"`
	// DaysOfCover is stock / velocity; null when there is no usage.
	DaysOfCover  *string      `json:"days_of_cover"`
	SuggestedQty string       `json:"suggested_qty"`
	PackSize     *string      `json:"pack_size"`
	Packs        *int64       `json:"packs"`
	Supplier     *SupplierRef `json:"supplier"`
	UnitCost     string       `json:"unit_cost"`
	// UnitCostSource: last_purchase | cost_price.
	UnitCostSource  string           `json:"unit_cost_source"`
	EstimatedTotal  string           `json:"estimated_total"`
	LastPurchasedAt *time.Time       `json:"last_purchased_at"`
	Inputs          Inputs           `json:"inputs"`
	Override        *ProductOverride `json:"override"`
}

// Summary counts the organization's reorder situation.
type Summary struct {
	OutOfStock int `json:"out_of_stock"`
	BelowMin   int `json:"below_min"`
	LowCover   int `json:"low_cover"`
	// Urgent = out of stock + below min (nav / dashboard badge).
	Urgent int `json:"urgent"`
	// Suggested counts products with a quantity to order.
	Suggested int `json:"suggested"`
	// Drafts counts open draft purchases.
	Drafts int64 `json:"drafts"`
}

// ListFilters narrow the suggestion list.
type ListFilters struct {
	SupplierUUID string
	// Urgency: out_of_stock | below_min | low_cover (empty = all).
	Urgency string
	Q       string
	// All includes products that need nothing.
	All bool
}

// ListResult is the suggestion list.
type ListResult struct {
	Items       []Suggestion `json:"items"`
	Total       int          `json:"total"`
	Summary     Summary      `json:"summary"`
	Settings    Settings     `json:"settings"`
	GeneratedAt time.Time    `json:"generated_at"`
}

// DraftItem is one product to order.
type DraftItem struct {
	ProductUUID uuid.UUID `json:"product_uuid"`
	Qty         string    `json:"qty"`
	// SupplierUUID overrides the preferred supplier.
	SupplierUUID *uuid.UUID `json:"supplier_uuid"`
	// UnitCost overrides the suggested unit cost.
	UnitCost *string `json:"unit_cost"`
}

// CreateDraftsInput creates draft purchases from selected suggestions.
type CreateDraftsInput struct {
	Items []DraftItem `json:"items"`
	Notes string      `json:"notes"`
}

// CreateDraftsResult lists the drafts (one per supplier).
type CreateDraftsResult struct {
	Drafts []purchasesusecase.PurchaseDetail `json:"drafts"`
}

// ---------------------------------------------------------------- helpers

func (s *Service) orgID(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, errors.New("organization context required")
	}
	return scope.InternalID, nil
}

func (s *Service) requireFeature(ctx context.Context, orgID int64) error {
	if s.features == nil {
		return nil
	}
	on, err := s.features.Enabled(ctx, orgID, FeatureKey)
	if err != nil {
		return err
	}
	if !on {
		return ErrFeatureDisabled
	}
	return nil
}

func (s *Service) record(ctx context.Context, action string, payload map[string]any) {
	if s.act == nil {
		return
	}
	var actorID *int64
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		id := p.UserInternal
		actorID = &id
	}
	s.act.Record(ctx, actorID, action, "stock_reorder", nil, payload, nil)
}

func numRat(n pgtype.Numeric) *big.Rat {
	if !n.Valid {
		return new(big.Rat)
	}
	r, ok := new(big.Rat).SetString(financeusecase.NumericToString(n))
	if !ok {
		return new(big.Rat)
	}
	return r
}

func parseDecimal(raw string) (*big.Rat, bool) {
	r, ok := new(big.Rat).SetString(strings.TrimSpace(strings.ReplaceAll(raw, ",", ".")))
	return r, ok
}

// ---------------------------------------------------------------- settings

func (s *Service) loadSettings(ctx context.Context, orgID int64) (db.StockReorderSetting, error) {
	row, err := s.q.GetStockReorderSettings(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.StockReorderSetting{
			OrganizationID: orgID, VelocityDays: DefaultVelocityDays, LeadDays: DefaultLeadDays,
			TargetDays: DefaultTargetDays, NotifyEnabled: true,
		}, nil
	}
	return row, err
}

// GetSettings returns the settings (defaults when none are saved).
func (s *Service) GetSettings(ctx context.Context) (Settings, error) {
	orgID, err := s.orgID(ctx)
	if err != nil {
		return Settings{}, err
	}
	if err := s.requireFeature(ctx, orgID); err != nil {
		return Settings{}, err
	}
	return s.settings(ctx, orgID)
}

func (s *Service) settings(ctx context.Context, orgID int64) (Settings, error) {
	row, err := s.loadSettings(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	leads, err := s.q.ListStockReorderSupplierSettings(ctx, orgID)
	if err != nil {
		return Settings{}, err
	}
	out := Settings{
		VelocityDays: row.VelocityDays, LeadDays: row.LeadDays, TargetDays: row.TargetDays,
		NotifyEnabled: row.NotifyEnabled, NotifyTime: NotifyTime,
		SupplierLeads:      make([]SupplierLead, 0, len(leads)),
		VelocityDayOptions: VelocityDayOptions,
	}
	for _, l := range leads {
		out.SupplierLeads = append(out.SupplierLeads, SupplierLead{SupplierUUID: l.SupplierUuid, SupplierName: l.SupplierName, LeadDays: l.LeadDays})
	}
	return out, nil
}

func validLead(d int32) bool   { return d >= 0 && d <= 180 }
func validTarget(d int32) bool { return d >= 1 && d <= 365 }

// UpdateSettings saves the settings.
func (s *Service) UpdateSettings(ctx context.Context, in SettingsInput) (Settings, error) {
	orgID, err := s.orgID(ctx)
	if err != nil {
		return Settings{}, err
	}
	if err := s.requireFeature(ctx, orgID); err != nil {
		return Settings{}, err
	}
	if !slices.Contains(VelocityDayOptions, in.VelocityDays) {
		return Settings{}, fmt.Errorf("%w: velocity_days must be one of 7, 14, 30, 60, 90", ErrInvalidRequest)
	}
	if !validLead(in.LeadDays) {
		return Settings{}, fmt.Errorf("%w: lead_days must be between 0 and 180", ErrInvalidRequest)
	}
	if !validTarget(in.TargetDays) {
		return Settings{}, fmt.Errorf("%w: target_days must be between 1 and 365", ErrInvalidRequest)
	}
	type lead struct {
		supplierID int64
		days       int32
	}
	var leads []lead
	if in.SupplierLeads != nil {
		if len(in.SupplierLeads) > 500 {
			return Settings{}, fmt.Errorf("%w: too many supplier lead times", ErrInvalidRequest)
		}
		seen := map[uuid.UUID]bool{}
		for _, l := range in.SupplierLeads {
			if !validLead(l.LeadDays) {
				return Settings{}, fmt.Errorf("%w: supplier lead_days must be between 0 and 180", ErrInvalidRequest)
			}
			if seen[l.SupplierUUID] {
				continue
			}
			seen[l.SupplierUUID] = true
			sup, err := s.q.GetSupplierByUUID(ctx, db.GetSupplierByUUIDParams{Uuid: l.SupplierUUID, OrganizationID: orgID})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return Settings{}, fmt.Errorf("%w: supplier not found", ErrNotFound)
				}
				return Settings{}, err
			}
			leads = append(leads, lead{supplierID: sup.ID, days: l.LeadDays})
		}
	}
	if _, err := s.q.UpsertStockReorderSettings(ctx, db.UpsertStockReorderSettingsParams{
		OrganizationID: orgID, VelocityDays: in.VelocityDays, LeadDays: in.LeadDays,
		TargetDays: in.TargetDays, NotifyEnabled: in.NotifyEnabled,
	}); err != nil {
		return Settings{}, err
	}
	if in.SupplierLeads != nil {
		existing, err := s.q.ListStockReorderSupplierSettings(ctx, orgID)
		if err != nil {
			return Settings{}, err
		}
		for _, e := range existing {
			if !slices.ContainsFunc(leads, func(l lead) bool { return l.supplierID == e.SupplierID }) {
				if err := s.q.DeleteStockReorderSupplierSetting(ctx, db.DeleteStockReorderSupplierSettingParams{
					OrganizationID: orgID, SupplierID: e.SupplierID,
				}); err != nil {
					return Settings{}, err
				}
			}
		}
		for _, l := range leads {
			if err := s.q.UpsertStockReorderSupplierSetting(ctx, db.UpsertStockReorderSupplierSettingParams{
				OrganizationID: orgID, SupplierID: l.supplierID, LeadDays: l.days,
			}); err != nil {
				return Settings{}, err
			}
		}
	}
	s.record(ctx, "tenant.stock_reorder.settings_update", map[string]any{
		"velocity_days": in.VelocityDays, "lead_days": in.LeadDays, "target_days": in.TargetDays,
		"notify_enabled": in.NotifyEnabled,
	})
	resourceevents.Emit(ctx, s.live, resourceevents.TenantStockReorder, resourceevents.ActionUpdated)
	return s.settings(ctx, orgID)
}

func (s *Service) product(ctx context.Context, orgID int64, id uuid.UUID) (db.Product, error) {
	p, err := s.q.GetProductByUUID(ctx, db.GetProductByUUIDParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Product{}, fmt.Errorf("%w: product not found", ErrNotFound)
		}
		return db.Product{}, err
	}
	return db.Product{ID: p.ID, Uuid: p.Uuid, Name: p.Name}, nil
}

// GetProductOverride returns a product's override (nil when none).
func (s *Service) GetProductOverride(ctx context.Context, productUUID uuid.UUID) (*ProductOverride, error) {
	orgID, err := s.orgID(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.requireFeature(ctx, orgID); err != nil {
		return nil, err
	}
	p, err := s.product(ctx, orgID, productUUID)
	if err != nil {
		return nil, err
	}
	row, err := s.q.GetStockReorderProductSetting(ctx, db.GetStockReorderProductSettingParams{OrganizationID: orgID, ProductID: p.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return mapOverride(row.LeadDays, row.TargetDays, row.PackSize, row.SupplierUuid, row.SupplierName), nil
}

// SetProductOverride saves a product's override; all-nil input removes it.
func (s *Service) SetProductOverride(ctx context.Context, productUUID uuid.UUID, in ProductOverrideInput) (*ProductOverride, error) {
	orgID, err := s.orgID(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.requireFeature(ctx, orgID); err != nil {
		return nil, err
	}
	p, err := s.product(ctx, orgID, productUUID)
	if err != nil {
		return nil, err
	}
	params := db.UpsertStockReorderProductSettingParams{OrganizationID: orgID, ProductID: p.ID}
	if in.SupplierUUID != nil && *in.SupplierUUID != uuid.Nil {
		sup, err := s.q.GetSupplierByUUID(ctx, db.GetSupplierByUUIDParams{Uuid: *in.SupplierUUID, OrganizationID: orgID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("%w: supplier not found", ErrNotFound)
			}
			return nil, err
		}
		params.SupplierID = pgtype.Int8{Int64: sup.ID, Valid: true}
	}
	if in.LeadDays != nil {
		if !validLead(*in.LeadDays) {
			return nil, fmt.Errorf("%w: lead_days must be between 0 and 180", ErrInvalidRequest)
		}
		params.LeadDays = pgtype.Int4{Int32: *in.LeadDays, Valid: true}
	}
	if in.TargetDays != nil {
		if !validTarget(*in.TargetDays) {
			return nil, fmt.Errorf("%w: target_days must be between 1 and 365", ErrInvalidRequest)
		}
		params.TargetDays = pgtype.Int4{Int32: *in.TargetDays, Valid: true}
	}
	if in.PackSize != nil && strings.TrimSpace(*in.PackSize) != "" {
		r, ok := parseDecimal(*in.PackSize)
		if !ok || r.Sign() <= 0 {
			return nil, fmt.Errorf("%w: pack_size must be positive", ErrInvalidRequest)
		}
		var n pgtype.Numeric
		if err := n.Scan(r.FloatString(3)); err != nil {
			return nil, fmt.Errorf("%w: pack_size", ErrInvalidRequest)
		}
		params.PackSize = n
	}
	empty := !params.SupplierID.Valid && !params.LeadDays.Valid && !params.TargetDays.Valid && !params.PackSize.Valid
	if empty {
		if err := s.q.DeleteStockReorderProductSetting(ctx, db.DeleteStockReorderProductSettingParams{OrganizationID: orgID, ProductID: p.ID}); err != nil {
			return nil, err
		}
	} else if err := s.q.UpsertStockReorderProductSetting(ctx, params); err != nil {
		return nil, err
	}
	s.record(ctx, "tenant.stock_reorder.product_override", map[string]any{"product_uuid": p.Uuid.String(), "product": p.Name, "cleared": empty})
	resourceevents.Emit(ctx, s.live, resourceevents.TenantStockReorder, resourceevents.ActionUpdated, p.Uuid.String())
	if empty {
		return nil, nil
	}
	return s.GetProductOverride(ctx, productUUID)
}

func mapOverride(lead, target pgtype.Int4, pack pgtype.Numeric, supUUID pgtype.UUID, supName pgtype.Text) *ProductOverride {
	o := &ProductOverride{}
	if lead.Valid {
		v := lead.Int32
		o.LeadDays = &v
	}
	if target.Valid {
		v := target.Int32
		o.TargetDays = &v
	}
	if pack.Valid {
		v := decString(numRat(pack), 3)
		o.PackSize = &v
	}
	if supUUID.Valid {
		id := uuid.UUID(supUUID.Bytes)
		o.SupplierUUID = &id
		if supName.Valid {
			n := supName.String
			o.SupplierName = &n
		}
	}
	return o
}

// ---------------------------------------------------------------- suggestions

// compute builds a suggestion for every candidate row.
func (s *Service) compute(ctx context.Context, orgID int64, set db.StockReorderSetting, productIDs []int64) ([]Suggestion, error) {
	since := s.now().Add(-time.Duration(set.VelocityDays) * 24 * time.Hour)
	rows, err := s.q.ListStockReorderCandidates(ctx, db.ListStockReorderCandidatesParams{
		OrganizationID: orgID,
		Since:          pgtype.Timestamptz{Time: since, Valid: true},
		ProductIds:     productIDs,
	})
	if err != nil {
		return nil, err
	}
	out := make([]Suggestion, 0, len(rows))
	for _, r := range rows {
		out = append(out, buildSuggestion(r, set))
	}
	return out, nil
}

func buildSuggestion(r db.ListStockReorderCandidatesRow, set db.StockReorderSetting) Suggestion {
	lead, leadSrc := set.LeadDays, "organization"
	if r.SupplierLeadDays.Valid {
		lead, leadSrc = r.SupplierLeadDays.Int32, "supplier"
	}
	if r.ProductLeadDays.Valid {
		lead, leadSrc = r.ProductLeadDays.Int32, "product"
	}
	target, targetSrc := set.TargetDays, "organization"
	if r.ProductTargetDays.Valid {
		target, targetSrc = r.ProductTargetDays.Int32, "product"
	}
	var pack *big.Rat
	if r.PackSize.Valid {
		pack = numRat(r.PackSize)
	}
	stock, minStock, onOrder := numRat(r.StockQuantity), numRat(r.MinStockAlert), numRat(r.OnOrderQty)
	res := Compute(FormulaInput{
		Stock: stock, MinStock: minStock, ConsumedQty: numRat(r.ConsumedQty), SoldQty: numRat(r.SoldQty),
		OnOrder: onOrder, PackSize: pack,
		VelocityDays: int(set.VelocityDays), LeadDays: int(lead), TargetDays: int(target),
	})

	sug := Suggestion{
		ProductUUID: r.Uuid, Name: r.Name, SKU: r.Sku, Unit: r.Unit, Currency: r.Currency,
		Urgency: res.Urgency, Stock: decString(stock, 3), MinStock: decString(minStock, 3), OnOrder: decString(onOrder, 3),
		VelocityPerDay: decString(res.Velocity, 3), SuggestedQty: decString(res.Suggested, 3),
		Inputs: Inputs{
			VelocityDays: set.VelocityDays, ConsumedQty: decString(numRat(r.ConsumedQty), 3), SoldQty: decString(numRat(r.SoldQty), 3),
			LeadDays: lead, LeadDaysSource: leadSrc, TargetDays: target, TargetDaysSource: targetSrc,
			DemandQty: decString(res.Demand, 3), RawNeed: decString(res.RawNeed, 3), Formula: FormulaText,
		},
	}
	if res.DaysOfCover != nil {
		v := decString(res.DaysOfCover, 1)
		sug.DaysOfCover = &v
	}
	if pack != nil {
		v := decString(pack, 3)
		sug.PackSize = &v
		if res.Packs != nil {
			n := res.Packs.Int64()
			sug.Packs = &n
		}
	}
	if r.SupplierUuid.Valid {
		src := "last_purchase"
		if r.SupplierIsOverride {
			src = "product"
		}
		sug.Supplier = &SupplierRef{UUID: uuid.UUID(r.SupplierUuid.Bytes), Name: r.SupplierName.String, Source: src}
	}
	cost, costSrc := numRat(r.CostPrice), "cost_price"
	if r.LastUnitCost.Valid {
		cost, costSrc = numRat(r.LastUnitCost), "last_purchase"
	}
	sug.UnitCost, sug.UnitCostSource = cost.FloatString(2), costSrc
	sug.EstimatedTotal = new(big.Rat).Mul(cost, res.Suggested).FloatString(2)
	if r.LastPurchasedAt.Valid {
		t := r.LastPurchasedAt.Time
		sug.LastPurchasedAt = &t
	}
	if r.ProductLeadDays.Valid || r.ProductTargetDays.Valid || r.PackSize.Valid || r.SupplierIsOverride {
		var supUUID pgtype.UUID
		var supName pgtype.Text
		if r.SupplierIsOverride {
			supUUID, supName = r.SupplierUuid, r.SupplierName
		}
		sug.Override = mapOverride(r.ProductLeadDays, r.ProductTargetDays, r.PackSize, supUUID, supName)
	}
	return sug
}

func needsAction(s Suggestion) bool {
	return s.SuggestedQty != "0" || s.Urgency != UrgencyNone
}

func summarize(items []Suggestion) Summary {
	var out Summary
	for _, it := range items {
		switch it.Urgency {
		case UrgencyOutOfStock:
			out.OutOfStock++
		case UrgencyBelowMin:
			out.BelowMin++
		case UrgencyLowCover:
			out.LowCover++
		}
		if it.SuggestedQty != "0" {
			out.Suggested++
		}
	}
	out.Urgent = out.OutOfStock + out.BelowMin
	return out
}

// List returns the reorder suggestions (most urgent first).
func (s *Service) List(ctx context.Context, f ListFilters) (ListResult, error) {
	orgID, err := s.orgID(ctx)
	if err != nil {
		return ListResult{}, err
	}
	if err := s.requireFeature(ctx, orgID); err != nil {
		return ListResult{}, err
	}
	urgency := strings.TrimSpace(f.Urgency)
	if urgency != "" && !slices.Contains(Urgencies, urgency) {
		return ListResult{}, fmt.Errorf("%w: urgency must be out_of_stock, below_min or low_cover", ErrInvalidRequest)
	}
	var supplierFilter *uuid.UUID
	switch raw := strings.TrimSpace(f.SupplierUUID); raw {
	case "":
	case "none":
		nilID := uuid.Nil
		supplierFilter = &nilID
	default:
		id, err := uuid.Parse(raw)
		if err != nil {
			return ListResult{}, fmt.Errorf("%w: invalid supplier_uuid", ErrInvalidRequest)
		}
		supplierFilter = &id
	}
	set, err := s.loadSettings(ctx, orgID)
	if err != nil {
		return ListResult{}, err
	}
	all, err := s.compute(ctx, orgID, set, nil)
	if err != nil {
		return ListResult{}, err
	}
	q := strings.ToLower(strings.TrimSpace(f.Q))
	items := make([]Suggestion, 0, len(all))
	for _, it := range all {
		if !f.All && !needsAction(it) {
			continue
		}
		if urgency != "" && it.Urgency != urgency {
			continue
		}
		if supplierFilter != nil {
			if *supplierFilter == uuid.Nil {
				if it.Supplier != nil {
					continue
				}
			} else if it.Supplier == nil || it.Supplier.UUID != *supplierFilter {
				continue
			}
		}
		if q != "" && !strings.Contains(strings.ToLower(it.Name), q) && !strings.Contains(strings.ToLower(it.SKU), q) {
			continue
		}
		items = append(items, it)
	}
	sort.SliceStable(items, func(i, j int) bool {
		ri, rj := UrgencyRank(items[i].Urgency), UrgencyRank(items[j].Urgency)
		if ri != rj {
			return ri < rj
		}
		ci, cj := coverSortKey(items[i]), coverSortKey(items[j])
		if ci.Cmp(cj) != 0 {
			return ci.Cmp(cj) < 0
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
	summary := summarize(all)
	if s.drafts != nil {
		if n, err := s.drafts.CountDrafts(ctx); err == nil {
			summary.Drafts = n
		}
	}
	settings, err := s.settings(ctx, orgID)
	if err != nil {
		return ListResult{}, err
	}
	return ListResult{Items: items, Total: len(items), Summary: summary, Settings: settings, GeneratedAt: s.now().UTC()}, nil
}

// coverSortKey sorts finite cover ascending, no-usage products last.
func coverSortKey(s Suggestion) *big.Rat {
	if s.DaysOfCover == nil {
		return new(big.Rat).SetInt64(1 << 40)
	}
	r, _ := parseDecimal(*s.DaysOfCover)
	if r == nil {
		return new(big.Rat)
	}
	return r
}

// Summary counts the urgent items (nav badge, dashboard card).
func (s *Service) Summary(ctx context.Context) (Summary, error) {
	orgID, err := s.orgID(ctx)
	if err != nil {
		return Summary{}, err
	}
	if err := s.requireFeature(ctx, orgID); err != nil {
		return Summary{}, err
	}
	set, err := s.loadSettings(ctx, orgID)
	if err != nil {
		return Summary{}, err
	}
	all, err := s.compute(ctx, orgID, set, nil)
	if err != nil {
		return Summary{}, err
	}
	out := summarize(all)
	if s.drafts != nil {
		if n, err := s.drafts.CountDrafts(ctx); err == nil {
			out.Drafts = n
		}
	}
	return out, nil
}

// CreateDrafts turns selected suggestions into draft purchases, one per
// supplier (item supplier, else the suggestion's preferred supplier).
func (s *Service) CreateDrafts(ctx context.Context, in CreateDraftsInput) (CreateDraftsResult, error) {
	orgID, err := s.orgID(ctx)
	if err != nil {
		return CreateDraftsResult{}, err
	}
	if err := s.requireFeature(ctx, orgID); err != nil {
		return CreateDraftsResult{}, err
	}
	if s.drafts == nil {
		return CreateDraftsResult{}, errors.New("stockreorder: drafts are not configured")
	}
	plans, err := s.PlanDrafts(ctx, in)
	if err != nil {
		return CreateDraftsResult{}, err
	}
	out := CreateDraftsResult{Drafts: make([]purchasesusecase.PurchaseDetail, 0, len(plans))}
	for _, p := range plans {
		lines := make([]purchasesusecase.CreateLineInput, 0, len(p.Lines))
		for _, l := range p.Lines {
			qty, cost := l.Qty, l.UnitCost
			lines = append(lines, purchasesusecase.CreateLineInput{ProductUUID: l.ProductUUID, Qty: &qty, UnitCost: &cost})
		}
		d, err := s.drafts.CreateDraft(ctx, purchasesusecase.DraftInput{
			SupplierUUID: p.SupplierUUID, Notes: in.Notes, Currency: p.Currency, Lines: lines, Source: "reorder",
		})
		if err != nil {
			if len(out.Drafts) > 0 {
				s.log.Warn("stock_reorder_drafts_partial", "created", len(out.Drafts), "error", err)
			}
			return out, mapPurchaseErr(err)
		}
		out.Drafts = append(out.Drafts, d)
	}
	uuids := make([]string, 0, len(out.Drafts))
	for _, d := range out.Drafts {
		uuids = append(uuids, d.UUID.String())
	}
	s.record(ctx, "tenant.stock_reorder.drafts_create", map[string]any{"drafts": uuids, "items": len(in.Items)})
	resourceevents.Emit(ctx, s.live, resourceevents.TenantStockReorder, resourceevents.ActionBulk)
	return out, nil
}

// DraftPlanLine is one line of a planned draft.
type DraftPlanLine struct {
	ProductUUID uuid.UUID `json:"product_uuid"`
	Name        string    `json:"name"`
	Unit        string    `json:"unit"`
	Qty         string    `json:"qty"`
	UnitCost    string    `json:"unit_cost"`
	LineTotal   string    `json:"line_total"`
}

// DraftPlan is a draft purchase about to be created (one supplier).
type DraftPlan struct {
	SupplierUUID uuid.UUID       `json:"supplier_uuid"`
	SupplierName string          `json:"supplier_name"`
	Currency     string          `json:"currency"`
	Total        string          `json:"total"`
	Lines        []DraftPlanLine `json:"lines"`
}

// PlanDrafts validates the selection and groups it by supplier without
// writing anything (the AI tool's confirmation preview uses it too).
func (s *Service) PlanDrafts(ctx context.Context, in CreateDraftsInput) ([]DraftPlan, error) {
	orgID, err := s.orgID(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.requireFeature(ctx, orgID); err != nil {
		return nil, err
	}
	if len(in.Items) == 0 {
		return nil, fmt.Errorf("%w: select at least one product", ErrInvalidRequest)
	}
	if len(in.Items) > maxDraftItems {
		return nil, fmt.Errorf("%w: at most %d products", ErrInvalidRequest, maxDraftItems)
	}
	ids := make([]int64, 0, len(in.Items))
	byUUID := map[uuid.UUID]int64{}
	for _, it := range in.Items {
		if _, dup := byUUID[it.ProductUUID]; dup {
			return nil, fmt.Errorf("%w: product listed twice", ErrInvalidRequest)
		}
		p, err := s.product(ctx, orgID, it.ProductUUID)
		if err != nil {
			return nil, err
		}
		byUUID[it.ProductUUID] = p.ID
		ids = append(ids, p.ID)
	}
	set, err := s.loadSettings(ctx, orgID)
	if err != nil {
		return nil, err
	}
	sugs, err := s.compute(ctx, orgID, set, ids)
	if err != nil {
		return nil, err
	}
	sugByUUID := map[uuid.UUID]Suggestion{}
	for _, sg := range sugs {
		sugByUUID[sg.ProductUUID] = sg
	}
	supplierNames := map[uuid.UUID]string{}
	var order []uuid.UUID
	groups := map[uuid.UUID]*DraftPlan{}
	totals := map[uuid.UUID]*big.Rat{}
	for _, it := range in.Items {
		sg, ok := sugByUUID[it.ProductUUID]
		if !ok {
			return nil, fmt.Errorf("%w: product does not track stock or is inactive", ErrInvalidRequest)
		}
		qty, ok := parseDecimal(it.Qty)
		if !ok || qty.Sign() <= 0 {
			return nil, fmt.Errorf("%w: qty of %q must be positive", ErrInvalidRequest, sg.Name)
		}
		cost, _ := parseDecimal(sg.UnitCost)
		if it.UnitCost != nil && strings.TrimSpace(*it.UnitCost) != "" {
			c, ok := parseDecimal(*it.UnitCost)
			if !ok || c.Sign() < 0 {
				return nil, fmt.Errorf("%w: unit_cost of %q must not be negative", ErrInvalidRequest, sg.Name)
			}
			cost = c
		}
		var supUUID uuid.UUID
		switch {
		case it.SupplierUUID != nil && *it.SupplierUUID != uuid.Nil:
			supUUID = *it.SupplierUUID
			if _, ok := supplierNames[supUUID]; !ok {
				sup, err := s.q.GetSupplierByUUID(ctx, db.GetSupplierByUUIDParams{Uuid: supUUID, OrganizationID: orgID})
				if err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						return nil, fmt.Errorf("%w: supplier not found", ErrNotFound)
					}
					return nil, err
				}
				if !sup.IsActive {
					return nil, fmt.Errorf("%w: supplier %q is inactive", ErrInvalidRequest, sup.Name)
				}
				supplierNames[supUUID] = sup.Name
			}
		case sg.Supplier != nil:
			supUUID = sg.Supplier.UUID
			supplierNames[supUUID] = sg.Supplier.Name
		default:
			return nil, fmt.Errorf("%w: choose a supplier for %q", ErrInvalidRequest, sg.Name)
		}
		g, ok := groups[supUUID]
		if !ok {
			g = &DraftPlan{SupplierUUID: supUUID, SupplierName: supplierNames[supUUID], Currency: sg.Currency}
			groups[supUUID] = g
			totals[supUUID] = new(big.Rat)
			order = append(order, supUUID)
		}
		lineTotal := new(big.Rat).Mul(qty, cost)
		totals[supUUID].Add(totals[supUUID], lineTotal)
		g.Lines = append(g.Lines, DraftPlanLine{
			ProductUUID: sg.ProductUUID, Name: sg.Name, Unit: sg.Unit,
			Qty: decString(qty, 3), UnitCost: cost.FloatString(2), LineTotal: lineTotal.FloatString(2),
		})
	}
	out := make([]DraftPlan, 0, len(order))
	for _, id := range order {
		g := groups[id]
		g.Total = totals[id].FloatString(2)
		out = append(out, *g)
	}
	return out, nil
}

func mapPurchaseErr(err error) error {
	switch {
	case errors.Is(err, purchasesusecase.ErrNotFound):
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	case errors.Is(err, purchasesusecase.ErrInvalidRequest), errors.Is(err, purchasesusecase.ErrConflict):
		return fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}
	return err
}
