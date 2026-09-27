package usecase

import (
	"context"
	"errors"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Service) Dashboard(ctx context.Context) (BillingDashboard, error) {
	now := time.Now().UTC()
	counts, err := s.q.BillingSubscriptionStatusCounts(ctx)
	if err != nil {
		return BillingDashboard{}, err
	}
	plans, err := s.q.BillingPlanDistribution(ctx)
	if err != nil {
		return BillingDashboard{}, err
	}
	monthStart, monthEnd := istanbulMonthRange(now)
	approved, err := s.q.BillingApprovedThisMonth(ctx, db.BillingApprovedThisMonthParams{MonthStart: pgTimeValue(monthStart), MonthEnd: pgTimeValue(monthEnd)})
	if err != nil {
		return BillingDashboard{}, err
	}
	orders, err := s.OrdersSummary(ctx)
	if err != nil {
		return BillingDashboard{}, err
	}
	expiring, err := s.q.BillingExpiringCounts(ctx, db.BillingExpiringCountsParams{
		NowAt: pgTimeValue(now), Within7: pgTimeValue(now.AddDate(0, 0, 7)), Within30: pgTimeValue(now.AddDate(0, 0, 30)),
	})
	if err != nil {
		return BillingDashboard{}, err
	}
	conversion, err := s.q.BillingTrialConversion(ctx, pgTimeValue(now.AddDate(0, 0, -90)))
	if err != nil {
		return BillingDashboard{}, err
	}
	discounts, err := s.q.BillingDiscountSummaries(ctx)
	if err != nil {
		return BillingDashboard{}, err
	}
	out := BillingDashboard{
		Counts:            DashboardCounts{Trial: counts.Trial, Active: counts.Active, Grace: counts.Grace, ReadOnly: counts.ReadOnly},
		ApprovedThisMonth: DashboardAmount{Count: approved.Count, Amount: numericString(approved.Amount)},
		Orders:            orders,
		Expiring:          DashboardExpiring{Within7: expiring.Within7, Within30: expiring.Within30},
		TrialConversion:   DashboardTrialConversion{Trials90d: conversion.Trials90d, Converted90d: conversion.Converted90d},
	}
	if conversion.Trials90d > 0 {
		out.TrialConversion.Rate = (float64(conversion.Converted90d) / float64(conversion.Trials90d)) * 100
	}
	for _, row := range plans {
		out.Plans = append(out.Plans, DashboardPlan{Code: row.Code, Name: row.Name, Count: row.Count})
	}
	for _, row := range discounts {
		out.Discounts = append(out.Discounts, DashboardDiscount{
			Code: row.Code, Uses: row.Uses, DiscountTotal: numericString(row.DiscountTotal), Revenue: numericString(row.Revenue),
		})
	}
	return out, nil
}

func (s *Service) SubscriptionDetail(ctx context.Context, id uuid.UUID) (AdminSubscriptionDetail, error) {
	row, err := s.q.GetSubscriptionByUUID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AdminSubscriptionDetail{}, ErrNotFound
		}
		return AdminSubscriptionDetail{}, err
	}
	historyRows, err := s.q.ListSubscriptionHistoryForOrg(ctx, row.OrganizationID)
	if err != nil {
		return AdminSubscriptionDetail{}, err
	}
	orderRows, err := s.q.ListOrdersForOrgAdmin(ctx, row.OrganizationID)
	if err != nil {
		return AdminSubscriptionDetail{}, err
	}
	invoiceRows, err := s.q.ListInvoicesForOrgAdmin(ctx, row.OrganizationID)
	if err != nil {
		return AdminSubscriptionDetail{}, err
	}
	meterRows, err := s.q.ListUsageMetersForOrgAdmin(ctx, row.OrganizationID)
	if err != nil {
		return AdminSubscriptionDetail{}, err
	}
	out := AdminSubscriptionDetail{Subscription: adminSubscriptionFromGet(row)}
	for _, h := range historyRows {
		out.History = append(out.History, adminSubscriptionFromHistory(h))
	}
	for _, orderRow := range orderRows {
		order, err := s.orderFromOrgAdminRow(ctx, orderRow)
		if err != nil {
			return AdminSubscriptionDetail{}, err
		}
		out.Orders = append(out.Orders, order)
	}
	for _, inv := range invoiceRows {
		out.Invoices = append(out.Invoices, invoiceFromOrgAdminRow(inv))
	}
	for _, meter := range meterRows {
		out.Meters = append(out.Meters, AdminUsageMeter{
			Key: meter.FeatureKey, Kind: meter.Kind.String, Unit: meter.Unit.String, Period: meter.Period.String,
			PeriodKey: meter.PeriodKey, Used: meter.Value, LabelTR: meter.LabelTr.String, LabelEN: meter.LabelEn.String,
			UpdatedAt: meter.UpdatedAt.Time,
		})
	}
	return out, nil
}

func istanbulMonthRange(t time.Time) (time.Time, time.Time) {
	loc := istanbulLocation()
	y, m, _ := t.In(loc).Date()
	start := time.Date(y, m, 1, 0, 0, 0, 0, loc)
	return start.UTC(), start.AddDate(0, 1, 0).UTC()
}
