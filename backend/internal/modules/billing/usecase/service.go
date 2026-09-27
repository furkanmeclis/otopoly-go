package usecase

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalidRequest = errors.New("invalid request")
	ErrConflict       = errors.New("conflict")
)

var (
	planCodeRE   = regexp.MustCompile(`^[a-z0-9_-]{2,32}$`)
	featureKeyRE = regexp.MustCompile(`^[a-z0-9_.-]{2,64}$`)
)

type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
	act  *activity.Recorder
	ent  *entitlements.Service
}

func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder, ent *entitlements.Service) *Service {
	return &Service{pool: pool, q: q, act: act, ent: ent}
}

func (s *Service) recordActivity(ctx context.Context, action string, id *uuid.UUID, payload map[string]any) {
	if s.act == nil {
		return
	}
	var actorID *int64
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		v := p.UserInternal
		actorID = &v
	}
	s.act.Record(ctx, actorID, action, "billing.plan", id, payload, nil)
}

func defaultString(v, fallback string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return fallback
	}
	return v
}

func numericNonNegative(raw string) (pgtype.Numeric, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "0"
	}
	var n pgtype.Numeric
	if err := n.Scan(raw); err != nil || !n.Valid {
		return pgtype.Numeric{}, fmt.Errorf("%w: invalid numeric", ErrInvalidRequest)
	}
	if n.Int != nil && n.Int.Sign() < 0 {
		return pgtype.Numeric{}, fmt.Errorf("%w: numeric must be non-negative", ErrInvalidRequest)
	}
	return n, nil
}

func optionalNumeric(raw *string) (pgtype.Numeric, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return pgtype.Numeric{}, nil
	}
	return numericNonNegative(*raw)
}

func numericString(n pgtype.Numeric) string {
	return ratFromNumeric(n).FloatString(2)
}

func ratFromNumeric(n pgtype.Numeric) *big.Rat {
	if !n.Valid || n.Int == nil {
		return new(big.Rat)
	}
	out := new(big.Rat).SetInt(n.Int)
	if n.Exp == 0 {
		return out
	}
	ten := big.NewRat(10, 1)
	if n.Exp > 0 {
		for i := int32(0); i < n.Exp; i++ {
			out.Mul(out, ten)
		}
		return out
	}
	for i := int32(0); i > n.Exp; i-- {
		out.Quo(out, ten)
	}
	return out
}

func parseRat(raw string) (*big.Rat, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "0"
	}
	r, ok := new(big.Rat).SetString(raw)
	if !ok || r.Sign() < 0 {
		return nil, fmt.Errorf("%w: invalid numeric", ErrInvalidRequest)
	}
	return r, nil
}

func YearlyPrice(p Plan) string {
	monthly, err := parseRat(p.PriceMonthly)
	if err != nil {
		return "0.00"
	}
	switch p.YearlyPricing {
	case "fixed":
		yearly, err := parseRat(p.PriceYearly)
		if err != nil {
			return "0.00"
		}
		return yearly.FloatString(2)
	case "discount_amount":
		discount, err := parseRat(p.YearlyDiscountValue)
		if err != nil {
			return "0.00"
		}
		total := new(big.Rat).Mul(monthly, big.NewRat(12, 1))
		total.Sub(total, discount)
		if total.Sign() < 0 {
			return "0.00"
		}
		return total.FloatString(2)
	case "discount_percent":
		pct, err := parseRat(p.YearlyDiscountValue)
		if err != nil {
			return "0.00"
		}
		total := new(big.Rat).Mul(monthly, big.NewRat(12, 1))
		factor := new(big.Rat).Sub(big.NewRat(1, 1), new(big.Rat).Quo(pct, big.NewRat(100, 1)))
		total.Mul(total, factor)
		if total.Sign() < 0 {
			return "0.00"
		}
		return total.FloatString(2)
	default:
		return "0.00"
	}
}

func mapFeature(row db.BillingFeature) Feature {
	return Feature{
		ID: row.ID, Key: row.Key, Kind: row.Kind, Unit: row.Unit, Period: row.Period,
		LabelTR: row.LabelTr, LabelEN: row.LabelEn, SortOrder: row.SortOrder,
		IsBuiltin: row.IsBuiltin, IsActive: row.IsActive,
	}
}

func mapPlan(row db.BillingPlan) Plan {
	p := Plan{
		UUID: row.Uuid, Code: row.Code, Name: row.Name, Description: row.Description,
		PriceMonthly: numericString(row.PriceMonthly), YearlyPricing: row.YearlyPricing,
		PriceYearly: numericString(row.PriceYearly), YearlyDiscountValue: numericString(row.YearlyDiscountValue),
		Currency: row.Currency, TrialDays: row.TrialDays, IsPublic: row.IsPublic,
		IsCustomizable: row.IsCustomizable, IsActive: row.IsActive, Badge: row.Badge,
		SortOrder: row.SortOrder, Features: []PlanFeatureValue{}, internalID: row.ID,
	}
	p.EffectiveYearly = YearlyPrice(p)
	return p
}

func intPtr(v pgtype.Int8) *int64 {
	if !v.Valid {
		return nil
	}
	out := v.Int64
	return &out
}

func boolPtr(v pgtype.Bool) *bool {
	if !v.Valid {
		return nil
	}
	out := v.Bool
	return &out
}

func numericPtr(v pgtype.Numeric) *string {
	if !v.Valid {
		return nil
	}
	out := numericString(v)
	return &out
}

func mapPlanFeature(row db.ListPlanFeaturesRow) PlanFeatureValue {
	return PlanFeatureValue{
		Key: row.Key, ValueInt: intPtr(row.ValueInt), ValueBool: boolPtr(row.ValueBool),
		DisplayText: row.DisplayText, Enforcement: row.Enforcement, TolerancePct: row.TolerancePct,
		WarnPct: row.WarnPct, MinValue: intPtr(row.MinValue), MaxValue: intPtr(row.MaxValue),
		Step: intPtr(row.Step), UnitPrice: numericPtr(row.UnitPrice),
		Kind: row.Kind, Unit: row.Unit, LabelTR: row.LabelTr, LabelEN: row.LabelEn,
	}
}

func pgInt(v *int64) pgtype.Int8 {
	if v == nil {
		return pgtype.Int8{}
	}
	return pgtype.Int8{Int64: *v, Valid: true}
}

func pgBool(v *bool) pgtype.Bool {
	if v == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *v, Valid: true}
}
