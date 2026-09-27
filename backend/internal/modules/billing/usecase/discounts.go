package usecase

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrDiscountInvalid = errors.New("discount invalid")
	discountCodeRE     = regexp.MustCompile(`^[A-Z0-9_-]{3,40}$`)
)

type DiscountCode struct {
	UUID              uuid.UUID   `json:"uuid"`
	Code              string      `json:"code"`
	Kind              string      `json:"kind"`
	Value             string      `json:"value"`
	PlanUUIDs         []uuid.UUID `json:"plan_uuids"`
	Periods           []string    `json:"periods"`
	StartsAt          *time.Time  `json:"starts_at"`
	EndsAt            *time.Time  `json:"ends_at"`
	MaxUses           *int32      `json:"max_uses"`
	MaxUsesPerOrg     *int32      `json:"max_uses_per_org"`
	FirstPurchaseOnly bool        `json:"first_purchase_only"`
	IsActive          bool        `json:"is_active"`
	Note              string      `json:"note"`
	UsedCount         int64       `json:"used_count"`
	CreatedAt         time.Time   `json:"created_at"`
}

type DiscountInput struct {
	Code              string      `json:"code"`
	Kind              string      `json:"kind"`
	Value             string      `json:"value"`
	PlanUUIDs         []uuid.UUID `json:"plan_uuids"`
	Periods           []string    `json:"periods"`
	StartsAt          *time.Time  `json:"starts_at"`
	EndsAt            *time.Time  `json:"ends_at"`
	MaxUses           *int32      `json:"max_uses"`
	MaxUsesPerOrg     *int32      `json:"max_uses_per_org"`
	FirstPurchaseOnly bool        `json:"first_purchase_only"`
	IsActive          bool        `json:"is_active"`
	Note              string      `json:"note"`
}

type DiscountError struct {
	Reason  string
	Message string
}

func (e DiscountError) Error() string {
	if e.Message == "" {
		return ErrDiscountInvalid.Error()
	}
	return e.Message
}

func (e DiscountError) Unwrap() error {
	return ErrDiscountInvalid
}

func (s *Service) ListDiscountCodes(ctx context.Context, q string, limit, offset int32) ([]DiscountCode, int64, error) {
	q = strings.TrimSpace(q)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.q.ListDiscountCodes(ctx, db.ListDiscountCodesParams{Q: q, Limit: limit, Offset: offset})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountDiscountCodes(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	out := make([]DiscountCode, 0, len(rows))
	for _, row := range rows {
		item := mapDiscountCodeRow(row)
		item.PlanUUIDs, err = s.discountPlanUUIDs(ctx, row.AppliesToPlans)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, item)
	}
	return out, total, nil
}

func (s *Service) GetDiscountCode(ctx context.Context, id uuid.UUID) (DiscountCode, error) {
	row, err := s.q.GetDiscountCodeByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DiscountCode{}, ErrNotFound
		}
		return DiscountCode{}, err
	}
	used, err := s.q.CountDiscountUses(ctx, row.ID)
	if err != nil {
		return DiscountCode{}, err
	}
	out := mapDiscountCode(row, used)
	out.PlanUUIDs, err = s.discountPlanUUIDs(ctx, row.AppliesToPlans)
	if err != nil {
		return DiscountCode{}, err
	}
	return out, nil
}

func (s *Service) CreateDiscountCode(ctx context.Context, in DiscountInput) (DiscountCode, error) {
	params, err := s.discountCreateParams(ctx, in)
	if err != nil {
		return DiscountCode{}, err
	}
	row, err := s.q.CreateDiscountCode(ctx, params)
	if err != nil {
		return DiscountCode{}, err
	}
	out := mapDiscountCode(row, 0)
	out.PlanUUIDs, err = s.discountPlanUUIDs(ctx, row.AppliesToPlans)
	if err != nil {
		return DiscountCode{}, err
	}
	return out, nil
}

func (s *Service) UpdateDiscountCode(ctx context.Context, id uuid.UUID, in DiscountInput) (DiscountCode, error) {
	if id == uuid.Nil {
		return DiscountCode{}, fmt.Errorf("%w: discount uuid is required", ErrInvalidRequest)
	}
	params, err := s.discountUpdateParams(ctx, id, in)
	if err != nil {
		return DiscountCode{}, err
	}
	row, err := s.q.UpdateDiscountCode(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DiscountCode{}, ErrNotFound
		}
		return DiscountCode{}, err
	}
	used, err := s.q.CountDiscountUses(ctx, row.ID)
	if err != nil {
		return DiscountCode{}, err
	}
	out := mapDiscountCode(row, used)
	out.PlanUUIDs, err = s.discountPlanUUIDs(ctx, row.AppliesToPlans)
	if err != nil {
		return DiscountCode{}, err
	}
	return out, nil
}

func (s *Service) DeleteDiscountCode(ctx context.Context, id uuid.UUID) error {
	if id == uuid.Nil {
		return fmt.Errorf("%w: discount uuid is required", ErrInvalidRequest)
	}
	if _, err := s.q.GetDiscountCodeByUUID(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	deleted, err := s.q.DeleteUnusedDiscountCode(ctx, id)
	if err != nil {
		return err
	}
	if deleted > 0 {
		return nil
	}
	return s.q.DeactivateDiscountCode(ctx, id)
}

func (s *Service) validateDiscount(
	ctx context.Context,
	q *db.Queries,
	code string,
	orgID int64,
	planID int64,
	period string,
	now time.Time,
) (*db.BillingDiscountCode, error) {
	normalized := strings.ToUpper(strings.TrimSpace(code))
	row, err := q.GetDiscountCodeByCode(ctx, normalized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, discountErr("not_found")
		}
		return nil, err
	}
	if !row.IsActive {
		return nil, discountErr("inactive")
	}
	if row.StartsAt.Valid && row.StartsAt.Time.After(now) {
		return nil, discountErr("not_started")
	}
	if row.EndsAt.Valid && row.EndsAt.Time.Before(now) {
		return nil, discountErr("expired")
	}
	if len(row.AppliesToPlans) > 0 && !slices.Contains(row.AppliesToPlans, planID) {
		return nil, discountErr("plan")
	}
	if len(row.AppliesToPeriods) > 0 && !slices.Contains(row.AppliesToPeriods, period) {
		return nil, discountErr("period")
	}
	if row.MaxUses.Valid {
		uses, err := q.CountDiscountUses(ctx, row.ID)
		if err != nil {
			return nil, err
		}
		if uses >= int64(row.MaxUses.Int32) {
			return nil, discountErr("max_uses")
		}
	}
	if row.MaxUsesPerOrg.Valid {
		uses, err := q.CountDiscountUsesByOrg(ctx, db.CountDiscountUsesByOrgParams{
			DiscountCodeID: row.ID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, err
		}
		if uses >= int64(row.MaxUsesPerOrg.Int32) {
			return nil, discountErr("max_uses_per_org")
		}
	}
	if row.FirstPurchaseOnly {
		orders, err := q.CountApprovedOrdersForOrg(ctx, orgID)
		if err != nil {
			return nil, err
		}
		if orders > 0 {
			return nil, discountErr("first_purchase_only")
		}
	}
	return &row, nil
}

func (s *Service) discountCreateParams(ctx context.Context, in DiscountInput) (db.CreateDiscountCodeParams, error) {
	code, value, planIDs, err := s.validateDiscountInput(ctx, in)
	if err != nil {
		return db.CreateDiscountCodeParams{}, err
	}
	var createdBy pgtype.Int8
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		createdBy = pgtype.Int8{Int64: p.UserInternal, Valid: true}
	}
	return db.CreateDiscountCodeParams{
		Code:              code,
		Kind:              in.Kind,
		Value:             value,
		AppliesToPlans:    planIDs,
		AppliesToPeriods:  normalizedPeriods(in.Periods),
		StartsAt:          pgTime(in.StartsAt),
		EndsAt:            pgTime(in.EndsAt),
		MaxUses:           pgInt4(in.MaxUses),
		MaxUsesPerOrg:     pgInt4(in.MaxUsesPerOrg),
		FirstPurchaseOnly: in.FirstPurchaseOnly,
		IsActive:          in.IsActive,
		Note:              strings.TrimSpace(in.Note),
		CreatedBy:         createdBy,
	}, nil
}

func (s *Service) discountUpdateParams(ctx context.Context, id uuid.UUID, in DiscountInput) (db.UpdateDiscountCodeParams, error) {
	code, value, planIDs, err := s.validateDiscountInput(ctx, in)
	if err != nil {
		return db.UpdateDiscountCodeParams{}, err
	}
	return db.UpdateDiscountCodeParams{
		Code:              code,
		Kind:              in.Kind,
		Value:             value,
		AppliesToPlans:    planIDs,
		AppliesToPeriods:  normalizedPeriods(in.Periods),
		StartsAt:          pgTime(in.StartsAt),
		EndsAt:            pgTime(in.EndsAt),
		MaxUses:           pgInt4(in.MaxUses),
		MaxUsesPerOrg:     pgInt4(in.MaxUsesPerOrg),
		FirstPurchaseOnly: in.FirstPurchaseOnly,
		IsActive:          in.IsActive,
		Note:              strings.TrimSpace(in.Note),
		Uuid:              id,
	}, nil
}

func (s *Service) validateDiscountInput(ctx context.Context, in DiscountInput) (string, pgtype.Numeric, []int64, error) {
	code, err := normalizeDiscountCode(in.Code)
	if err != nil {
		return "", pgtype.Numeric{}, nil, err
	}
	switch in.Kind {
	case "percent", "amount":
	default:
		return "", pgtype.Numeric{}, nil, fmt.Errorf("%w: discount kind is invalid", ErrInvalidRequest)
	}
	value, err := numericNonNegative(in.Value)
	if err != nil {
		return "", pgtype.Numeric{}, nil, err
	}
	if ratFromNumeric(value).Sign() <= 0 {
		return "", pgtype.Numeric{}, nil, fmt.Errorf("%w: discount value must be positive", ErrInvalidRequest)
	}
	if in.Kind == "percent" && ratFromNumeric(value).Cmp(bigHundred()) > 0 {
		return "", pgtype.Numeric{}, nil, fmt.Errorf("%w: percent discount cannot exceed 100", ErrInvalidRequest)
	}
	if in.StartsAt != nil && in.EndsAt != nil && in.EndsAt.Before(*in.StartsAt) {
		return "", pgtype.Numeric{}, nil, fmt.Errorf("%w: discount end must be after start", ErrInvalidRequest)
	}
	planIDs, err := s.planIDsForUUIDs(ctx, in.PlanUUIDs)
	if err != nil {
		return "", pgtype.Numeric{}, nil, err
	}
	return code, value, planIDs, nil
}

func (s *Service) planIDsForUUIDs(ctx context.Context, ids []uuid.UUID) ([]int64, error) {
	out := make([]int64, 0, len(ids))
	seen := map[int64]struct{}{}
	for _, id := range ids {
		if id == uuid.Nil {
			return nil, fmt.Errorf("%w: plan uuid is required", ErrInvalidRequest)
		}
		plan, err := s.q.GetBillingPlanByUUID(ctx, id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		if _, ok := seen[plan.ID]; ok {
			continue
		}
		seen[plan.ID] = struct{}{}
		out = append(out, plan.ID)
	}
	return out, nil
}

func (s *Service) discountPlanUUIDs(ctx context.Context, ids []int64) ([]uuid.UUID, error) {
	if len(ids) == 0 {
		return []uuid.UUID{}, nil
	}
	rows, err := s.q.ListBillingPlanUUIDsByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]uuid.UUID, len(rows))
	for _, row := range rows {
		byID[row.ID] = row.Uuid
	}
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if planUUID, ok := byID[id]; ok {
			out = append(out, planUUID)
		}
	}
	return out, nil
}

func mapDiscountCode(row db.BillingDiscountCode, used int64) DiscountCode {
	return DiscountCode{
		UUID:              row.Uuid,
		Code:              row.Code,
		Kind:              row.Kind,
		Value:             numericString(row.Value),
		PlanUUIDs:         []uuid.UUID{},
		Periods:           append([]string{}, row.AppliesToPeriods...),
		StartsAt:          timePtr(row.StartsAt),
		EndsAt:            timePtr(row.EndsAt),
		MaxUses:           int32Ptr(row.MaxUses),
		MaxUsesPerOrg:     int32Ptr(row.MaxUsesPerOrg),
		FirstPurchaseOnly: row.FirstPurchaseOnly,
		IsActive:          row.IsActive,
		Note:              row.Note,
		UsedCount:         used,
		CreatedAt:         row.CreatedAt.Time,
	}
}

func mapDiscountCodeRow(row db.ListDiscountCodesRow) DiscountCode {
	return DiscountCode{
		UUID:              row.Uuid,
		Code:              row.Code,
		Kind:              row.Kind,
		Value:             numericString(row.Value),
		PlanUUIDs:         []uuid.UUID{},
		Periods:           append([]string{}, row.AppliesToPeriods...),
		StartsAt:          timePtr(row.StartsAt),
		EndsAt:            timePtr(row.EndsAt),
		MaxUses:           int32Ptr(row.MaxUses),
		MaxUsesPerOrg:     int32Ptr(row.MaxUsesPerOrg),
		FirstPurchaseOnly: row.FirstPurchaseOnly,
		IsActive:          row.IsActive,
		Note:              row.Note,
		UsedCount:         row.UsedCount,
		CreatedAt:         row.CreatedAt.Time,
	}
}

func normalizeDiscountCode(raw string) (string, error) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if !discountCodeRE.MatchString(code) {
		return "", fmt.Errorf("%w: discount code is invalid", ErrInvalidRequest)
	}
	return code, nil
}

func normalizedPeriods(periods []string) []string {
	out := make([]string, 0, len(periods))
	seen := map[string]struct{}{}
	for _, p := range periods {
		p = strings.ToLower(strings.TrimSpace(p))
		if p != "monthly" && p != "yearly" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func discountErr(reason string) DiscountError {
	return DiscountError{Reason: reason, Message: discountMessage(reason)}
}

func discountMessage(reason string) string {
	switch reason {
	case "not_found":
		return "Kod bulunamadı."
	case "inactive":
		return "Kod aktif değil."
	case "not_started":
		return "Kod henüz başlamadı."
	case "expired":
		return "Kodun süresi dolmuş."
	case "plan":
		return "Kod bu plan için geçerli değil."
	case "period":
		return "Kod bu dönem için geçerli değil."
	case "max_uses":
		return "Kodun kullanım hakkı dolmuş."
	case "max_uses_per_org":
		return "Bu kodu daha önce kullandınız."
	case "first_purchase_only":
		return "Kod yalnızca ilk satın alma için geçerli."
	default:
		return "İndirim kodu geçersiz."
	}
}

func pgTime(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func timePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	out := t.Time
	return &out
}

func pgInt4(v *int32) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *v, Valid: true}
}

func int32Ptr(v pgtype.Int4) *int32 {
	if !v.Valid {
		return nil
	}
	out := v.Int32
	return &out
}

func bigHundred() *big.Rat {
	return big.NewRat(100, 1)
}
