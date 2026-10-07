package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var builtinFeatures = []db.UpsertBuiltinFeatureParams{
	{Key: "jobs.daily", Kind: "limit", Unit: "adet", Period: "day", LabelTr: "Günlük işlem", LabelEn: "Daily jobs", SortOrder: 10},
	{Key: "jobs.monthly", Kind: "limit", Unit: "adet", Period: "month", LabelTr: "Aylık işlem", LabelEn: "Monthly jobs", SortOrder: 20},
	{Key: "staff.count", Kind: "limit", Unit: "kişi", Period: "total", LabelTr: "Personel sayısı", LabelEn: "Staff members", SortOrder: 30},
	{Key: "customers.count", Kind: "limit", Unit: "adet", Period: "total", LabelTr: "Müşteri kaydı", LabelEn: "Customer records", SortOrder: 40},
	{Key: "storage.gb", Kind: "limit", Unit: "GB", Period: "total", LabelTr: "Depolama alanı", LabelEn: "Storage", SortOrder: 50},
	{Key: "whatsapp.enabled", Kind: "toggle", Unit: "", Period: "none", LabelTr: "WhatsApp mesajlaşma", LabelEn: "WhatsApp messaging", SortOrder: 60},
	{Key: "whatsapp.monthly", Kind: "limit", Unit: "mesaj", Period: "month", LabelTr: "Aylık WhatsApp mesajı", LabelEn: "Monthly WhatsApp messages", SortOrder: 61},
	{Key: "whatsapp.own_number", Kind: "toggle", Unit: "", Period: "none", LabelTr: "Kendi WhatsApp numarası", LabelEn: "Own WhatsApp number", SortOrder: 62},
	{Key: "ai.enabled", Kind: "toggle", Unit: "", Period: "none", LabelTr: "Yapay zekâ asistanı", LabelEn: "AI assistant", SortOrder: 70},
	{Key: "ai.monthly", Kind: "limit", Unit: "istek", Period: "month", LabelTr: "Aylık AI isteği", LabelEn: "Monthly AI requests", SortOrder: 71},
	{Key: "module.contracts", Kind: "toggle", Unit: "", Period: "none", LabelTr: "Sözleşme modülü", LabelEn: "Contracts module", SortOrder: 80},
	{Key: "module.quotes", Kind: "toggle", Unit: "", Period: "none", LabelTr: "Teklif ve fırsat modülü", LabelEn: "Quotes & leads module", SortOrder: 90},
	{Key: "module.reports", Kind: "toggle", Unit: "", Period: "none", LabelTr: "Raporlar ve dışa aktarım", LabelEn: "Reports & exports", SortOrder: 100},
}

func (s *Service) EnsureBuiltinFeatures(ctx context.Context) error {
	for _, f := range builtinFeatures {
		if err := s.q.UpsertBuiltinFeature(ctx, f); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) ListFeatures(ctx context.Context, includeInactive bool) ([]Feature, error) {
	rows, err := s.q.ListBillingFeatures(ctx, includeInactive)
	if err != nil {
		return nil, err
	}
	out := make([]Feature, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapFeature(row))
	}
	return out, nil
}

func (s *Service) CreateDisplayFeature(ctx context.Context, in DisplayFeatureInput) (Feature, error) {
	in.Key = strings.TrimSpace(in.Key)
	in.LabelTR = strings.TrimSpace(in.LabelTR)
	in.LabelEN = strings.TrimSpace(in.LabelEN)
	if !featureKeyRE.MatchString(in.Key) || in.LabelTR == "" || in.LabelEN == "" {
		return Feature{}, fmt.Errorf("%w: key, label_tr, and label_en are required", ErrInvalidRequest)
	}
	row, err := s.q.CreateDisplayFeature(ctx, db.CreateDisplayFeatureParams{
		Key: in.Key, LabelTr: in.LabelTR, LabelEn: in.LabelEN, SortOrder: in.SortOrder,
	})
	if err != nil {
		return Feature{}, err
	}
	return mapFeature(row), nil
}

func (s *Service) SetFeatureActive(ctx context.Context, id int64, active bool) error {
	if id <= 0 {
		return fmt.Errorf("%w: feature id is required", ErrInvalidRequest)
	}
	return s.q.UpdateFeatureActive(ctx, db.UpdateFeatureActiveParams{ID: id, IsActive: active})
}

func (s *Service) ListPlans(ctx context.Context, publicOnly bool) ([]Plan, error) {
	rows, err := s.q.ListBillingPlans(ctx, publicOnly)
	if err != nil {
		return nil, err
	}
	out := make([]Plan, 0, len(rows))
	for _, row := range rows {
		p, err := s.hydratePlan(ctx, row)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

func (s *Service) GetPlan(ctx context.Context, id uuid.UUID) (Plan, error) {
	row, err := s.q.GetBillingPlanByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Plan{}, ErrNotFound
		}
		return Plan{}, err
	}
	return s.hydratePlan(ctx, row)
}

func (s *Service) CreatePlan(ctx context.Context, in PlanInput) (Plan, error) {
	params, err := s.createParams(ctx, in)
	if err != nil {
		return Plan{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Plan{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	row, err := qtx.CreateBillingPlan(ctx, params)
	if err != nil {
		return Plan{}, err
	}
	if err := s.replacePlanFeatures(ctx, qtx, row.ID, in.Features); err != nil {
		return Plan{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Plan{}, err
	}
	p, err := s.GetPlan(ctx, row.Uuid)
	if err == nil {
		s.recordActivity(ctx, "platform.billing.plan.create", &p.UUID, map[string]any{"code": p.Code})
	}
	return p, err
}

func (s *Service) UpdatePlan(ctx context.Context, id uuid.UUID, in PlanInput) (Plan, error) {
	params, err := s.updateParams(ctx, id, in)
	if err != nil {
		return Plan{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Plan{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	row, err := qtx.UpdateBillingPlan(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Plan{}, ErrNotFound
		}
		return Plan{}, err
	}
	if err := s.replacePlanFeatures(ctx, qtx, row.ID, in.Features); err != nil {
		return Plan{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Plan{}, err
	}
	p, err := s.GetPlan(ctx, row.Uuid)
	if err == nil {
		s.recordActivity(ctx, "platform.billing.plan.update", &p.UUID, map[string]any{"code": p.Code})
	}
	return p, err
}

func (s *Service) DeletePlan(ctx context.Context, id uuid.UUID) error {
	row, err := s.q.GetBillingPlanByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if row.Code == "trial" {
		return fmt.Errorf("%w: trial plan cannot be deleted", ErrConflict)
	}
	count, err := s.q.CountLiveSubscriptionsByPlan(ctx, row.ID)
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("%w: plan has live subscriptions", ErrConflict)
	}
	if err := s.q.SoftDeleteBillingPlan(ctx, id); err != nil {
		return err
	}
	s.recordActivity(ctx, "platform.billing.plan.delete", &row.Uuid, map[string]any{"code": row.Code})
	return nil
}

func (s *Service) hydratePlan(ctx context.Context, row db.BillingPlan) (Plan, error) {
	p := mapPlan(row)
	rows, err := s.q.ListPlanFeatures(ctx, row.ID)
	if err != nil {
		return Plan{}, err
	}
	for _, f := range rows {
		p.Features = append(p.Features, mapPlanFeature(f))
	}
	p.LiveSubscriptions, err = s.q.CountLiveSubscriptionsByPlan(ctx, row.ID)
	if err != nil {
		return Plan{}, err
	}
	return p, nil
}

func (s *Service) createParams(ctx context.Context, in PlanInput) (db.CreateBillingPlanParams, error) {
	if err := s.validatePlanInput(ctx, in, true); err != nil {
		return db.CreateBillingPlanParams{}, err
	}
	monthly, yearly, discount, err := planNumerics(in)
	if err != nil {
		return db.CreateBillingPlanParams{}, err
	}
	return db.CreateBillingPlanParams{
		Code: strings.TrimSpace(in.Code), Name: strings.TrimSpace(in.Name), Description: strings.TrimSpace(in.Description),
		PriceMonthly: monthly, YearlyPricing: in.YearlyPricing, PriceYearly: yearly, YearlyDiscountValue: discount,
		TrialDays: in.TrialDays, IsPublic: in.IsPublic, IsCustomizable: in.IsCustomizable,
		Badge: strings.TrimSpace(in.Badge), SortOrder: in.SortOrder, IsActive: in.IsActive,
	}, nil
}

func (s *Service) updateParams(ctx context.Context, id uuid.UUID, in PlanInput) (db.UpdateBillingPlanParams, error) {
	if id == uuid.Nil {
		return db.UpdateBillingPlanParams{}, fmt.Errorf("%w: plan uuid is required", ErrInvalidRequest)
	}
	if err := s.validatePlanInput(ctx, in, false); err != nil {
		return db.UpdateBillingPlanParams{}, err
	}
	monthly, yearly, discount, err := planNumerics(in)
	if err != nil {
		return db.UpdateBillingPlanParams{}, err
	}
	return db.UpdateBillingPlanParams{
		Uuid: id, Name: strings.TrimSpace(in.Name), Description: strings.TrimSpace(in.Description),
		PriceMonthly: monthly, YearlyPricing: in.YearlyPricing, PriceYearly: yearly,
		YearlyDiscountValue: discount, TrialDays: in.TrialDays, IsPublic: in.IsPublic,
		IsCustomizable: in.IsCustomizable, Badge: strings.TrimSpace(in.Badge),
		SortOrder: in.SortOrder, IsActive: in.IsActive,
	}, nil
}

func planNumerics(in PlanInput) (pgtype.Numeric, pgtype.Numeric, pgtype.Numeric, error) {
	monthly, err := numericNonNegative(in.PriceMonthly)
	if err != nil {
		return pgtype.Numeric{}, pgtype.Numeric{}, pgtype.Numeric{}, err
	}
	yearly, err := numericNonNegative(in.PriceYearly)
	if err != nil {
		return pgtype.Numeric{}, pgtype.Numeric{}, pgtype.Numeric{}, err
	}
	discount, err := numericNonNegative(in.YearlyDiscountValue)
	if err != nil {
		return pgtype.Numeric{}, pgtype.Numeric{}, pgtype.Numeric{}, err
	}
	return monthly, yearly, discount, nil
}

func (s *Service) validatePlanInput(ctx context.Context, in PlanInput, requireCode bool) error {
	if requireCode && !planCodeRE.MatchString(strings.TrimSpace(in.Code)) {
		return fmt.Errorf("%w: plan code is invalid", ErrInvalidRequest)
	}
	if strings.TrimSpace(in.Name) == "" {
		return fmt.Errorf("%w: plan name is required", ErrInvalidRequest)
	}
	switch in.YearlyPricing {
	case "fixed", "discount_amount", "discount_percent":
	default:
		return fmt.Errorf("%w: yearly_pricing is invalid", ErrInvalidRequest)
	}
	return s.validateFeatureValues(ctx, in.Features, in.IsCustomizable)
}

func (s *Service) validateFeatureValues(ctx context.Context, values []PlanFeatureValue, customizable bool) error {
	features, err := s.q.ListBillingFeatures(ctx, false)
	if err != nil {
		return err
	}
	byKey := make(map[string]db.BillingFeature, len(features))
	for _, f := range features {
		byKey[f.Key] = f
	}
	seen := map[string]struct{}{}
	for _, v := range values {
		f, ok := byKey[v.Key]
		if !ok || !f.IsActive {
			return fmt.Errorf("%w: feature %s is not active", ErrInvalidRequest, v.Key)
		}
		if _, dup := seen[v.Key]; dup {
			return fmt.Errorf("%w: duplicate feature %s", ErrInvalidRequest, v.Key)
		}
		seen[v.Key] = struct{}{}
		if v.Enforcement == "" {
			v.Enforcement = "hard"
		}
		if v.Enforcement != "hard" && v.Enforcement != "soft" {
			return fmt.Errorf("%w: enforcement is invalid", ErrInvalidRequest)
		}
		if v.TolerancePct < 0 || v.TolerancePct > 100 || v.WarnPct < 0 || v.WarnPct > 100 {
			return fmt.Errorf("%w: percentages must be between 0 and 100", ErrInvalidRequest)
		}
		switch f.Kind {
		case "limit":
			if v.ValueInt == nil || *v.ValueInt < 0 {
				return fmt.Errorf("%w: limit features require value_int >= 0", ErrInvalidRequest)
			}
		case "toggle":
			if v.ValueBool == nil {
				return fmt.Errorf("%w: toggle features require value_bool", ErrInvalidRequest)
			}
		case "display":
			if strings.TrimSpace(v.DisplayText) == "" {
				return fmt.Errorf("%w: display features require display_text", ErrInvalidRequest)
			}
		}
		unitPrice, err := optionalNumeric(v.UnitPrice)
		if err != nil {
			return err
		}
		hasCustomFields := v.MinValue != nil || v.MaxValue != nil || v.Step != nil || v.UnitPrice != nil
		if hasCustomFields {
			if !customizable {
				return fmt.Errorf("%w: custom feature settings require customizable plan", ErrInvalidRequest)
			}
			if f.Kind != "limit" {
				return fmt.Errorf("%w: custom feature settings require limit feature", ErrInvalidRequest)
			}
			if v.MinValue == nil || v.MaxValue == nil || v.Step == nil || v.UnitPrice == nil {
				return fmt.Errorf("%w: custom feature settings require min_value, max_value, step, and unit_price", ErrInvalidRequest)
			}
			if *v.MinValue < 0 || *v.MaxValue < *v.MinValue || *v.Step <= 0 {
				return fmt.Errorf("%w: custom feature bounds are invalid", ErrInvalidRequest)
			}
			if (*v.MaxValue-*v.MinValue)%*v.Step != 0 {
				return fmt.Errorf("%w: custom feature range must align with step", ErrInvalidRequest)
			}
			if !unitPrice.Valid {
				return fmt.Errorf("%w: custom feature unit_price is invalid", ErrInvalidRequest)
			}
		}
	}
	return nil
}

func (s *Service) replacePlanFeatures(ctx context.Context, qtx *db.Queries, planID int64, values []PlanFeatureValue) error {
	if err := qtx.DeletePlanFeatures(ctx, planID); err != nil {
		return err
	}
	for _, v := range values {
		enforcement := defaultString(v.Enforcement, "hard")
		warn := v.WarnPct
		if warn == 0 {
			warn = 80
		}
		unitPrice, err := optionalNumeric(v.UnitPrice)
		if err != nil {
			return err
		}
		if err := qtx.InsertPlanFeature(ctx, db.InsertPlanFeatureParams{
			PlanID: planID, ValueInt: pgInt(v.ValueInt), ValueBool: pgBool(v.ValueBool),
			DisplayText: strings.TrimSpace(v.DisplayText), Enforcement: enforcement,
			TolerancePct: v.TolerancePct, WarnPct: warn, MinValue: pgInt(v.MinValue),
			MaxValue: pgInt(v.MaxValue), Step: pgInt(v.Step), UnitPrice: unitPrice,
			FeatureKey: v.Key,
		}); err != nil {
			return err
		}
	}
	return nil
}
