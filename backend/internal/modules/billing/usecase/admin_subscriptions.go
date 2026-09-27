package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) ListSubscriptionsAdmin(ctx context.Context, status, q string, limit, offset int32) ([]AdminSubscription, int64, error) {
	limit, offset = normalizeLimitOffset(limit, offset)
	status = strings.TrimSpace(status)
	rows, err := s.q.ListSubscriptionsAdmin(ctx, db.ListSubscriptionsAdminParams{
		Status: status, Q: strings.TrimSpace(q), Limit: limit, Offset: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountSubscriptionsAdmin(ctx, db.CountSubscriptionsAdminParams{Status: status, Q: strings.TrimSpace(q)})
	if err != nil {
		return nil, 0, err
	}
	out := make([]AdminSubscription, 0, len(rows))
	for _, row := range rows {
		out = append(out, adminSubscriptionFromList(row))
	}
	return out, total, nil
}

func (s *Service) CreateSubscriptionAdmin(ctx context.Context, in AdminSubscriptionInput) (AdminSubscription, error) {
	if in.OrganizationUUID == uuid.Nil || in.PlanUUID == uuid.Nil {
		return AdminSubscription{}, fmt.Errorf("%w: organization_uuid and plan_uuid are required", ErrInvalidRequest)
	}
	if in.Period != "monthly" && in.Period != "yearly" {
		return AdminSubscription{}, fmt.Errorf("%w: period is invalid", ErrInvalidRequest)
	}
	if !in.EndsAt.After(in.StartsAt) {
		return AdminSubscription{}, fmt.Errorf("%w: ends_at must be after starts_at", ErrInvalidRequest)
	}
	price, err := numericNonNegative(in.PricePaid)
	if err != nil {
		return AdminSubscription{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AdminSubscription{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	org, err := organizationByUUID(ctx, tx, in.OrganizationUUID)
	if err != nil {
		return AdminSubscription{}, err
	}
	plan, err := qtx.GetBillingPlanByUUID(ctx, in.PlanUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AdminSubscription{}, ErrPlanUnavailable
		}
		return AdminSubscription{}, err
	}
	if !plan.IsActive || plan.DeletedAt.Valid {
		return AdminSubscription{}, ErrPlanUnavailable
	}
	if live, err := qtx.GetLiveSubscriptionForUpdate(ctx, org.ID); err == nil {
		if err := qtx.CloseSubscription(ctx, db.CloseSubscriptionParams{ID: live.ID, Note: "replaced by admin subscription"}); err != nil {
			return AdminSubscription{}, err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return AdminSubscription{}, err
	}
	status := "active"
	if plan.Code == "trial" {
		status = "trial"
	}
	sub, err := qtx.CreateSubscriptionWithCredit(ctx, db.CreateSubscriptionWithCreditParams{
		OrganizationID: org.ID,
		PlanID:         plan.ID,
		Period:         in.Period,
		Status:         status,
		StartsAt:       pgTimeValue(in.StartsAt),
		EndsAt:         pgTimeValue(in.EndsAt),
		PricePaid:      price,
		CreditBalance:  mustNumeric("0"),
		Source:         "admin",
		Note:           strings.TrimSpace(in.Note),
		CreatedBy:      currentUserID(ctx),
	})
	if err != nil {
		return AdminSubscription{}, err
	}
	if err := qtx.SetOrganizationAccess(ctx, db.SetOrganizationAccessParams{
		PlanCode:       pgtype.Text{String: plan.Code, Valid: true},
		AccessStartsAt: pgTimeValue(in.StartsAt),
		AccessEndsAt:   pgTimeValue(in.EndsAt),
		ID:             org.ID,
	}); err != nil {
		return AdminSubscription{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminSubscription{}, err
	}
	row, err := s.q.GetSubscriptionByUUID(ctx, sub.Uuid)
	if err != nil {
		return AdminSubscription{}, err
	}
	return adminSubscriptionFromGet(row), nil
}

func (s *Service) UpdateSubscriptionAdmin(ctx context.Context, id uuid.UUID, in AdminSubscriptionPatch) (AdminSubscription, error) {
	current, err := s.q.GetSubscriptionByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AdminSubscription{}, ErrNotFound
		}
		return AdminSubscription{}, err
	}
	if in.EndsAt != nil && !in.EndsAt.After(current.StartsAt.Time) {
		return AdminSubscription{}, fmt.Errorf("%w: ends_at must be after starts_at", ErrInvalidRequest)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AdminSubscription{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	planID := pgtype.Int8{}
	planCode := current.PlanCode
	if in.PlanUUID != nil && *in.PlanUUID != uuid.Nil {
		plan, err := qtx.GetBillingPlanByUUID(ctx, *in.PlanUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return AdminSubscription{}, ErrPlanUnavailable
			}
			return AdminSubscription{}, err
		}
		if !plan.IsActive || plan.DeletedAt.Valid {
			return AdminSubscription{}, ErrPlanUnavailable
		}
		planID = pgtype.Int8{Int64: plan.ID, Valid: true}
		planCode = plan.Code
	}
	endsAt := pgtype.Timestamptz{}
	if in.EndsAt != nil {
		endsAt = pgTimeValue(*in.EndsAt)
	}
	updated, err := qtx.UpdateSubscriptionAdmin(ctx, db.UpdateSubscriptionAdminParams{
		Uuid: id, EndsAt: endsAt, PlanID: planID, Note: strings.TrimSpace(in.Note),
	})
	if err != nil {
		return AdminSubscription{}, err
	}
	if err := qtx.SetOrganizationAccess(ctx, db.SetOrganizationAccessParams{
		PlanCode:       pgtype.Text{String: planCode, Valid: true},
		AccessStartsAt: updated.StartsAt,
		AccessEndsAt:   updated.EndsAt,
		ID:             updated.OrganizationID,
	}); err != nil {
		return AdminSubscription{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminSubscription{}, err
	}
	row, err := s.q.GetSubscriptionByUUID(ctx, id)
	if err != nil {
		return AdminSubscription{}, err
	}
	return adminSubscriptionFromGet(row), nil
}

type orgRow struct {
	ID   int64
	UUID uuid.UUID
	Slug string
	Name string
}

func organizationByUUID(ctx context.Context, tx pgx.Tx, id uuid.UUID) (orgRow, error) {
	var row orgRow
	err := tx.QueryRow(ctx, `SELECT id, uuid, slug, name FROM organizations WHERE uuid = $1`, id).Scan(&row.ID, &row.UUID, &row.Slug, &row.Name)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return orgRow{}, ErrNotFound
		}
		return orgRow{}, err
	}
	return row, nil
}

func adminSubscriptionFromList(row db.ListSubscriptionsAdminRow) AdminSubscription {
	return AdminSubscription{
		UUID:         row.Uuid,
		Organization: OrganizationRef{UUID: row.OrganizationUuid, Slug: row.OrganizationSlug, Name: row.OrganizationName},
		Plan:         PlanRef{UUID: row.PlanUuid, Code: row.PlanCode, Name: row.PlanName},
		Period:       row.Period, Status: row.Status, StartsAt: row.StartsAt.Time, EndsAt: row.EndsAt.Time,
		DaysLeft: daysLeft(row.EndsAt.Time, timeNow()), PricePaid: numericString(row.PricePaid),
		CreditBalance: numericString(row.CreditBalance), Source: row.Source, Note: row.Note, CreatedAt: row.CreatedAt.Time,
	}
}

func adminSubscriptionFromGet(row db.GetSubscriptionByUUIDRow) AdminSubscription {
	return AdminSubscription{
		UUID:         row.Uuid,
		Organization: OrganizationRef{UUID: row.OrganizationUuid, Slug: row.OrganizationSlug, Name: row.OrganizationName},
		Plan:         PlanRef{UUID: row.PlanUuid, Code: row.PlanCode, Name: row.PlanName},
		Period:       row.Period, Status: row.Status, StartsAt: row.StartsAt.Time, EndsAt: row.EndsAt.Time,
		DaysLeft: daysLeft(row.EndsAt.Time, timeNow()), PricePaid: numericString(row.PricePaid),
		CreditBalance: numericString(row.CreditBalance), Source: row.Source, Note: row.Note, CreatedAt: row.CreatedAt.Time,
	}
}

func timeNow() time.Time { return time.Now() }
