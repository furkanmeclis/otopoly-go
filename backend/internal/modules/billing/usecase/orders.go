package usecase

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/pricing"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	platstorage "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxReceiptBytes int64 = 10 << 20

var safeFileRE = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

type quoteResult struct {
	Preview            OrderPreview
	PlanID             int64
	DiscountID         pgtype.Int8
	DiscountCode       string
	LinesJSON          []byte
	CustomFeaturesJSON []byte
}

func (s *Service) PreviewOrder(ctx context.Context, in OrderInput) (OrderPreview, error) {
	scope := orgctx.MustScope(ctx)
	qr, err := s.quoteFor(ctx, s.q, scope.InternalID, in, "", false, true)
	if err != nil {
		return OrderPreview{}, err
	}
	return qr.Preview, nil
}

func (s *Service) CreateOrder(ctx context.Context, in OrderInput) (Order, error) {
	scope := orgctx.MustScope(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	if open, err := qtx.GetOpenOrderForOrg(ctx, scope.InternalID); err == nil {
		return Order{}, OrderOpenError{OrderUUID: open.Uuid}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Order{}, err
	}
	qr, err := s.quoteFor(ctx, qtx, scope.InternalID, in, "", false, false)
	if err != nil {
		return Order{}, err
	}
	settings, err := qtx.GetBillingSettings(ctx)
	if err != nil {
		return Order{}, err
	}
	ref, err := s.uniqueReferenceCode(ctx, qtx)
	if err != nil {
		return Order{}, err
	}
	now := time.Now()
	createdBy := currentUserID(ctx)
	total, err := numericNonNegative(qr.Preview.Total)
	if err != nil {
		return Order{}, err
	}
	status := "pending_payment"
	row, err := qtx.CreateOrder(ctx, db.CreateOrderParams{
		OrganizationID:  scope.InternalID,
		PlanID:          qr.PlanID,
		Period:          qr.Preview.Period,
		Kind:            qr.Preview.Kind,
		Status:          status,
		Channel:         "bank_transfer",
		ReferenceCode:   ref,
		ListPrice:       mustNumeric(qr.Preview.ListPrice),
		ProrationCredit: mustNumeric(qr.Preview.ProrationCredit),
		DiscountCodeID:  qr.DiscountID,
		DiscountCode:    qr.DiscountCode,
		DiscountAmount:  mustNumeric(qr.Preview.DiscountAmount),
		CreditApplied:   mustNumeric(qr.Preview.CreditApplied),
		CreditSurplus:   mustNumeric(qr.Preview.CreditSurplus),
		Total:           total,
		VatRate:         qr.Preview.VATRate,
		VatAmount:       mustNumeric(qr.Preview.VATAmount),
		Lines:           qr.LinesJSON,
		StartsAt:        pgTimeValue(qr.Preview.StartsAt),
		EndsAt:          pgTimeValue(qr.Preview.EndsAt),
		CustomFeatures:  qr.CustomFeaturesJSON,
		ExpiresAt:       pgTimeValue(now.AddDate(0, 0, int(settings.OrderTtlDays))),
		CreatedBy:       createdBy,
	})
	if err != nil {
		return Order{}, err
	}
	if numericString(total) == "0.00" {
		if _, err := s.approveTx(ctx, tx, qtx, row.Uuid, pgtype.Int8{}, "auto-approved zero total"); err != nil {
			return Order{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Order{}, err
	}
	s.recordActivity(ctx, "tenant.billing.order.create", &row.Uuid, map[string]any{"reference_code": ref})
	return s.GetOrder(ctx, row.Uuid)
}

func (s *Service) ListOrders(ctx context.Context, status string, limit, offset int32) ([]Order, int64, error) {
	scope := orgctx.MustScope(ctx)
	limit, offset = normalizeLimitOffset(limit, offset)
	status = normalizeOrderStatus(status)
	rows, err := s.q.ListOrdersForOrg(ctx, db.ListOrdersForOrgParams{
		OrganizationID: scope.InternalID,
		Status:         status,
		Limit:          limit,
		Offset:         offset,
	})
	if err != nil {
		return nil, 0, err
	}
	total, err := s.q.CountOrdersForOrg(ctx, db.CountOrdersForOrgParams{OrganizationID: scope.InternalID, Status: status})
	if err != nil {
		return nil, 0, err
	}
	out := make([]Order, 0, len(rows))
	for _, row := range rows {
		order, err := s.orderFromOrgListRow(ctx, row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, order)
	}
	return out, total, nil
}

func (s *Service) GetOrder(ctx context.Context, id uuid.UUID) (Order, error) {
	scope := orgctx.MustScope(ctx)
	row, err := s.q.GetOrderByUUIDForOrg(ctx, db.GetOrderByUUIDForOrgParams{Uuid: id, OrganizationID: scope.InternalID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Order{}, ErrNotFound
		}
		return Order{}, err
	}
	return s.orderFromOrgRow(ctx, row)
}

func (s *Service) ReportPayment(ctx context.Context, id uuid.UUID, in ReportInput) (Order, error) {
	if s.store == nil {
		return Order{}, fmt.Errorf("%w: storage is not configured", ErrInvalidRequest)
	}
	scope := orgctx.MustScope(ctx)
	if err := validateReceipt(in); err != nil {
		return Order{}, err
	}
	in.ContentType = normalizeContentType(in.ContentType)
	row, err := s.q.GetOrderByUUIDForOrg(ctx, db.GetOrderByUUIDForOrgParams{Uuid: id, OrganizationID: scope.InternalID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Order{}, ErrNotFound
		}
		return Order{}, err
	}
	if !isOpenOrder(row.Status) || !row.ExpiresAt.Time.After(time.Now()) {
		return Order{}, ErrOrderState
	}
	key := receiptObjectKey(scope.UUID, row.Uuid, in.Filename, in.ContentType)
	if err := s.store.Upload(ctx, platstorage.File{
		Body:        in.Body,
		Size:        in.Size,
		ContentType: in.ContentType,
		Filename:    in.Filename,
		Metadata:    map[string]string{"billing-order": row.Uuid.String(), "organization": scope.UUID.String()},
	}, key); err != nil {
		return Order{}, err
	}
	if row.ReceiptObjectKey != "" {
		_ = s.store.Delete(ctx, row.ReceiptObjectKey)
	}
	if _, err := s.q.ReportOrder(ctx, db.ReportOrderParams{
		ReceiptObjectKey:   key,
		ReceiptContentType: in.ContentType,
		ReportNote:         strings.TrimSpace(in.Note),
		Uuid:               id,
	}); err != nil {
		return Order{}, err
	}
	if s.notifier != nil {
		s.notifier.NotifyPlatform(ctx, "Ödeme bildirimi alındı", scope.Name+" ödeme dekontu yükledi.", "/platform/billing/payments")
	}
	return s.GetOrder(ctx, id)
}

func (s *Service) CancelOrder(ctx context.Context, id uuid.UUID) (Order, error) {
	scope := orgctx.MustScope(ctx)
	row, err := s.q.GetOrderByUUIDForOrg(ctx, db.GetOrderByUUIDForOrgParams{Uuid: id, OrganizationID: scope.InternalID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Order{}, ErrNotFound
		}
		return Order{}, err
	}
	if !isOpenOrder(row.Status) {
		return Order{}, ErrOrderState
	}
	if _, err := s.q.SetOrderStatus(ctx, db.SetOrderStatusParams{
		Status:       "cancelled",
		ReviewNote:   "",
		RejectReason: "",
		Uuid:         id,
	}); err != nil {
		return Order{}, err
	}
	return s.GetOrder(ctx, id)
}

func (s *Service) OpenReceipt(ctx context.Context, id uuid.UUID, platform bool) (io.ReadCloser, string, int64, error) {
	var key, ctype string
	if platform {
		row, err := s.q.GetOrderByUUID(ctx, id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, "", 0, ErrNotFound
			}
			return nil, "", 0, err
		}
		key, ctype = row.ReceiptObjectKey, row.ReceiptContentType
	} else {
		scope := orgctx.MustScope(ctx)
		row, err := s.q.GetOrderByUUIDForOrg(ctx, db.GetOrderByUUIDForOrgParams{Uuid: id, OrganizationID: scope.InternalID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, "", 0, ErrNotFound
			}
			return nil, "", 0, err
		}
		key, ctype = row.ReceiptObjectKey, row.ReceiptContentType
	}
	if key == "" || s.store == nil {
		return nil, "", 0, ErrNotFound
	}
	body, size, err := s.store.Download(ctx, key)
	if err != nil {
		return nil, "", 0, ErrNotFound
	}
	return body, ctype, size, nil
}

func (s *Service) ExpireDueOrders(ctx context.Context) (int, error) {
	rows, err := s.q.ExpireDueOrders(ctx)
	if err != nil {
		return 0, err
	}
	return len(rows), nil
}

func (s *Service) quoteFor(ctx context.Context, q *db.Queries, orgID int64, in OrderInput, listPriceOverride string, specialPrice bool, allowDiscountError bool) (quoteResult, error) {
	if in.PlanUUID == uuid.Nil {
		return quoteResult{}, fmt.Errorf("%w: plan_uuid is required", ErrInvalidRequest)
	}
	if in.Period != "monthly" && in.Period != "yearly" {
		return quoteResult{}, fmt.Errorf("%w: period is invalid", ErrInvalidRequest)
	}
	planRow, err := q.GetBillingPlanByUUID(ctx, in.PlanUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return quoteResult{}, ErrPlanUnavailable
		}
		return quoteResult{}, err
	}
	if !planRow.IsActive || planRow.Code == "trial" {
		return quoteResult{}, ErrPlanUnavailable
	}
	plan := mapPlan(planRow)
	featureRows, err := q.ListPlanFeatures(ctx, planRow.ID)
	if err != nil {
		return quoteResult{}, err
	}
	plan.Features = make([]PlanFeatureValue, 0, len(featureRows))
	for _, f := range featureRows {
		plan.Features = append(plan.Features, mapPlanFeature(f))
	}
	opts := customOptions(plan.Features)
	customValues := map[string]int64{}
	if len(in.CustomFeatures) > 0 || len(opts) > 0 {
		if !plan.IsCustomizable || len(opts) == 0 {
			return quoteResult{}, CustomFeaturesError{Field: "custom_features", Message: "plan is not customizable"}
		}
		values, err := pricing.ValidateCustom(opts, in.CustomFeatures)
		if err != nil {
			return quoteResult{}, customFeatureErr(err)
		}
		customValues = values
	}
	settings, err := q.GetBillingSettings(ctx)
	if err != nil {
		return quoteResult{}, err
	}
	var discount *pricing.Discount
	var discountID pgtype.Int8
	var discountCode string
	var discountPreviewErr *DiscountPreviewError
	normalizedCode := strings.ToUpper(strings.TrimSpace(in.DiscountCode))
	if normalizedCode != "" {
		d, err := s.validateDiscount(ctx, q, normalizedCode, orgID, planRow.ID, in.Period, time.Now())
		if err != nil {
			var derr DiscountError
			if allowDiscountError && errors.As(err, &derr) {
				discountPreviewErr = &DiscountPreviewError{Reason: derr.Reason, Message: derr.Message}
			} else {
				return quoteResult{}, err
			}
		} else {
			discountID = pgtype.Int8{Int64: d.ID, Valid: true}
			discountCode = d.Code
			discount = &pricing.Discount{Code: d.Code, Kind: d.Kind, Value: numericString(d.Value)}
		}
	}
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	var current *pricing.Current
	if sub, err := q.GetLiveSubscription(ctx, orgID); err == nil {
		current = &pricing.Current{
			PlanID:        sub.PlanID,
			PlanRank:      numericString(sub.PricePaid),
			Period:        sub.Period,
			Status:        sub.Status,
			StartsAt:      sub.StartsAt.Time,
			EndsAt:        sub.EndsAt.Time,
			PricePaid:     numericString(sub.PricePaid),
			CreditBalance: numericString(sub.CreditBalance),
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return quoteResult{}, err
	}
	listPrice := strings.TrimSpace(listPriceOverride)
	if listPrice != "" {
		if _, err := numericNonNegative(listPrice); err != nil {
			return quoteResult{}, err
		}
	} else if len(opts) > 0 {
		monthly, err := pricing.CustomMonthly(plan.PriceMonthly, opts, customValues)
		if err != nil {
			return quoteResult{}, customFeatureErr(err)
		}
		listPrice = monthly
		if in.Period == "yearly" {
			extra, err := pricing.CustomMonthlyExtra(opts, customValues)
			if err != nil {
				return quoteResult{}, customFeatureErr(err)
			}
			listPrice = pricing.CustomYearly(pricing.YearlyRule{
				Kind:          plan.YearlyPricing,
				FixedPrice:    plan.PriceYearly,
				DiscountValue: plan.YearlyDiscountValue,
			}, extra, plan.PriceMonthly)
		}
	} else {
		listPrice = plan.PriceMonthly
		if in.Period == "yearly" {
			listPrice = YearlyPrice(plan)
		}
	}
	planName := plan.Name
	planLabelFormat := "%s (%s)"
	if len(opts) > 0 {
		planName = customPlanLabel(plan.Name, in.Period, opts, customValues)
		planLabelFormat = "%s"
	} else if specialPrice {
		planName = plan.Name + " (" + periodLabel(in.Period) + ")"
		planLabelFormat = "%s"
	}
	if specialPrice {
		planName += " (özel fiyat)"
	}
	qp, err := pricing.Compute(pricing.Input{
		Now:     time.Now(),
		Loc:     loc,
		Current: current,
		Target: pricing.Target{
			PlanID: planRow.ID, PlanName: planName, PlanRank: plan.PriceMonthly,
			Period: in.Period, ListPrice: listPrice,
		},
		Discount: discount,
		VATRate:  int(settings.VatRate),
		Labels: pricing.Labels{
			Plan:      planLabelFormat,
			Proration: "Kıst iadesi (mevcut %s dönem, %d gün)",
			Discount:  "İndirim kodu %s",
			Credit:    "Alacak bakiyesi",
			Periods:   map[string]string{"monthly": "Aylık", "yearly": "Yıllık"},
		},
	})
	if err != nil {
		return quoteResult{}, err
	}
	customJSON, err := marshalCustomFeatures(customValues)
	if err != nil {
		return quoteResult{}, err
	}
	lines := make([]QuoteLine, 0, len(qp.Lines))
	for _, l := range qp.Lines {
		lines = append(lines, QuoteLine{Kind: l.Kind, Label: l.Label, Amount: l.Amount})
	}
	linesJSON, err := json.Marshal(lines)
	if err != nil {
		return quoteResult{}, err
	}
	var codePtr *string
	if normalizedCode != "" {
		codePtr = &normalizedCode
	}
	preview := OrderPreview{
		Kind: qp.Kind, Plan: PlanRef{UUID: plan.UUID, Code: plan.Code, Name: plan.Name}, Period: in.Period,
		CustomFeatures: customValues, ListPrice: qp.ListPrice, ProrationCredit: qp.ProrationCredit, DiscountCode: codePtr,
		DiscountAmount: qp.DiscountAmount, CreditApplied: qp.CreditApplied, CreditSurplus: qp.CreditSurplus,
		Total: qp.Total, VATRate: settings.VatRate, VATAmount: qp.VATAmount,
		StartsAt: qp.StartsAt, EndsAt: qp.EndsAt, Lines: lines, DiscountError: discountPreviewErr,
	}
	return quoteResult{
		Preview: preview, PlanID: planRow.ID, DiscountID: discountID, DiscountCode: discountCode,
		LinesJSON: linesJSON, CustomFeaturesJSON: customJSON,
	}, nil
}

func customOptions(features []PlanFeatureValue) []pricing.CustomOption {
	opts := []pricing.CustomOption{}
	for _, f := range features {
		if f.Kind != "limit" || f.MinValue == nil || f.MaxValue == nil || f.Step == nil || f.UnitPrice == nil {
			continue
		}
		if *f.Step <= 0 {
			continue
		}
		opts = append(opts, pricing.CustomOption{
			Key: f.Key, Label: defaultString(f.LabelTR, f.Key), Unit: f.Unit,
			Min: *f.MinValue, Max: *f.MaxValue, Step: *f.Step, UnitPrice: *f.UnitPrice,
		})
	}
	return opts
}

func customFeatureErr(err error) error {
	var cerr pricing.CustomError
	if errors.As(err, &cerr) {
		return CustomFeaturesError{Field: cerr.Field, Message: cerr.Message}
	}
	return err
}

func customPlanLabel(planName, period string, opts []pricing.CustomOption, values map[string]int64) string {
	parts := make([]string, 0, len(opts))
	for _, opt := range opts {
		parts = append(parts, fmt.Sprintf("%s %d %s", defaultString(opt.Label, opt.Key), values[opt.Key], opt.Unit))
	}
	return fmt.Sprintf("%s (%s) · %s", planName, periodLabel(period), strings.Join(parts, ", "))
}

func marshalCustomFeatures(values map[string]int64) ([]byte, error) {
	out := make(map[string]string, len(values))
	for key, value := range values {
		out[key] = fmt.Sprintf("%d", value)
	}
	if len(out) == 0 {
		return []byte(`{}`), nil
	}
	return json.Marshal(out)
}

func unmarshalCustomFeatures(raw []byte) map[string]int64 {
	out := map[string]int64{}
	if len(raw) == 0 {
		return out
	}
	var values map[string]any
	if err := json.Unmarshal(raw, &values); err != nil {
		return out
	}
	for key, value := range values {
		switch v := value.(type) {
		case string:
			var n int64
			if _, err := fmt.Sscan(v, &n); err == nil {
				out[key] = n
			}
		case float64:
			out[key] = int64(v)
		}
	}
	return out
}

func (s *Service) uniqueReferenceCode(ctx context.Context, q *db.Queries) (string, error) {
	for i := 0; i < 5; i++ {
		ref := newReferenceCode(rand.Reader)
		exists, err := q.ReferenceCodeExists(ctx, ref)
		if err != nil {
			return "", err
		}
		if !exists {
			return ref, nil
		}
	}
	return "", fmt.Errorf("%w: reference code collision", ErrConflict)
}

func validateReceipt(in ReportInput) error {
	if in.Body == nil || in.Size <= 0 {
		return fmt.Errorf("%w: receipt file is required", ErrInvalidRequest)
	}
	if in.Size > maxReceiptBytes {
		return fmt.Errorf("%w: receipt must be at most 10 MB", ErrInvalidRequest)
	}
	ct := normalizeContentType(in.ContentType)
	switch ct {
	case "application/pdf", "image/jpeg", "image/png", "image/webp":
		return nil
	default:
		return fmt.Errorf("%w: unsupported receipt content type", ErrInvalidRequest)
	}
}

func normalizeContentType(raw string) string {
	ct := strings.ToLower(strings.TrimSpace(raw))
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return ct
}

func receiptObjectKey(orgUUID, orderUUID uuid.UUID, filename, contentType string) string {
	name := safeFileRE.ReplaceAllString(filepath.Base(strings.TrimSpace(filename)), "-")
	if name == "." || name == "" {
		name = "receipt." + receiptExt(normalizeContentType(contentType))
	}
	return fmt.Sprintf("billing/receipts/%s/%s/%d-%s", orgUUID, orderUUID, time.Now().Unix(), name)
}

func receiptExt(contentType string) string {
	switch contentType {
	case "application/pdf":
		return "pdf"
	case "image/jpeg":
		return "jpg"
	case "image/png":
		return "png"
	case "image/webp":
		return "webp"
	default:
		return "bin"
	}
}

func isOpenOrder(status string) bool {
	return status == "pending_payment" || status == "payment_reported"
}

func normalizeOrderStatus(status string) string {
	status = strings.TrimSpace(status)
	if status == "all" {
		return ""
	}
	return status
}

func normalizeLimitOffset(limit, offset int32) (int32, int32) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func periodLabel(period string) string {
	if period == "yearly" {
		return "Yıllık"
	}
	return "Aylık"
}

func currentUserID(ctx context.Context) pgtype.Int8 {
	if p, ok := authctx.PrincipalFrom(ctx); ok && p.UserInternal > 0 {
		return pgtype.Int8{Int64: p.UserInternal, Valid: true}
	}
	return pgtype.Int8{}
}

func mustNumeric(raw string) pgtype.Numeric {
	n, err := numericNonNegative(raw)
	if err != nil {
		panic(err)
	}
	return n
}

func pgTimeValue(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

type orderRecord struct {
	Order               db.BillingOrder
	PlanUUID            uuid.UUID
	PlanCode            string
	PlanName            string
	OrganizationUUID    uuid.UUID
	OrganizationSlug    string
	OrganizationName    string
	IncludeOrganization bool
}

func (s *Service) orderFromOrgRow(ctx context.Context, row db.GetOrderByUUIDForOrgRow) (Order, error) {
	return s.mapOrder(ctx, orderRecord{
		Order: db.BillingOrder{
			ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, PlanID: row.PlanID,
			Period: row.Period, Kind: row.Kind, Status: row.Status, Channel: row.Channel,
			ReferenceCode: row.ReferenceCode, ListPrice: row.ListPrice, ProrationCredit: row.ProrationCredit,
			DiscountCodeID: row.DiscountCodeID, DiscountCode: row.DiscountCode, DiscountAmount: row.DiscountAmount,
			CreditApplied: row.CreditApplied, CreditSurplus: row.CreditSurplus, Total: row.Total,
			VatRate: row.VatRate, VatAmount: row.VatAmount, Lines: row.Lines, StartsAt: row.StartsAt,
			EndsAt: row.EndsAt, ReceiptObjectKey: row.ReceiptObjectKey, ReceiptContentType: row.ReceiptContentType,
			ReportNote: row.ReportNote, ReportedAt: row.ReportedAt, ReviewedAt: row.ReviewedAt,
			RejectReason: row.RejectReason, CustomFeatures: row.CustomFeatures,
			ExpiresAt: row.ExpiresAt, CreatedAt: row.CreatedAt,
		},
		PlanUUID: row.PlanUuid, PlanCode: row.PlanCode, PlanName: row.PlanName,
	})
}

func (s *Service) orderFromOrgListRow(ctx context.Context, row db.ListOrdersForOrgRow) (Order, error) {
	return s.mapOrder(ctx, orderRecord{
		Order: db.BillingOrder{
			ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, PlanID: row.PlanID,
			Period: row.Period, Kind: row.Kind, Status: row.Status, Channel: row.Channel,
			ReferenceCode: row.ReferenceCode, ListPrice: row.ListPrice, ProrationCredit: row.ProrationCredit,
			DiscountCodeID: row.DiscountCodeID, DiscountCode: row.DiscountCode, DiscountAmount: row.DiscountAmount,
			CreditApplied: row.CreditApplied, CreditSurplus: row.CreditSurplus, Total: row.Total,
			VatRate: row.VatRate, VatAmount: row.VatAmount, Lines: row.Lines, StartsAt: row.StartsAt,
			EndsAt: row.EndsAt, ReceiptObjectKey: row.ReceiptObjectKey, ReceiptContentType: row.ReceiptContentType,
			ReportNote: row.ReportNote, ReportedAt: row.ReportedAt, ReviewedAt: row.ReviewedAt,
			RejectReason: row.RejectReason, CustomFeatures: row.CustomFeatures,
			ExpiresAt: row.ExpiresAt, CreatedAt: row.CreatedAt,
		},
		PlanUUID: row.PlanUuid, PlanCode: row.PlanCode, PlanName: row.PlanName,
	})
}

func (s *Service) orderFromAdminRow(ctx context.Context, row db.GetOrderByUUIDRow) (Order, error) {
	return s.mapOrder(ctx, orderRecord{
		Order: db.BillingOrder{
			ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, PlanID: row.PlanID,
			Period: row.Period, Kind: row.Kind, Status: row.Status, Channel: row.Channel,
			ReferenceCode: row.ReferenceCode, ListPrice: row.ListPrice, ProrationCredit: row.ProrationCredit,
			DiscountCodeID: row.DiscountCodeID, DiscountCode: row.DiscountCode, DiscountAmount: row.DiscountAmount,
			CreditApplied: row.CreditApplied, CreditSurplus: row.CreditSurplus, Total: row.Total,
			VatRate: row.VatRate, VatAmount: row.VatAmount, Lines: row.Lines, StartsAt: row.StartsAt,
			EndsAt: row.EndsAt, ReceiptObjectKey: row.ReceiptObjectKey, ReceiptContentType: row.ReceiptContentType,
			ReportNote: row.ReportNote, ReportedAt: row.ReportedAt, ReviewedAt: row.ReviewedAt,
			RejectReason: row.RejectReason, CustomFeatures: row.CustomFeatures,
			ExpiresAt: row.ExpiresAt, CreatedAt: row.CreatedAt,
		},
		PlanUUID: row.PlanUuid, PlanCode: row.PlanCode, PlanName: row.PlanName,
		OrganizationUUID: row.OrganizationUuid, OrganizationSlug: row.OrganizationSlug,
		OrganizationName: row.OrganizationName, IncludeOrganization: true,
	})
}

func (s *Service) orderFromAdminListRow(ctx context.Context, row db.ListOrdersRow) (Order, error) {
	return s.mapOrder(ctx, orderRecord{
		Order: db.BillingOrder{
			ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, PlanID: row.PlanID,
			Period: row.Period, Kind: row.Kind, Status: row.Status, Channel: row.Channel,
			ReferenceCode: row.ReferenceCode, ListPrice: row.ListPrice, ProrationCredit: row.ProrationCredit,
			DiscountCodeID: row.DiscountCodeID, DiscountCode: row.DiscountCode, DiscountAmount: row.DiscountAmount,
			CreditApplied: row.CreditApplied, CreditSurplus: row.CreditSurplus, Total: row.Total,
			VatRate: row.VatRate, VatAmount: row.VatAmount, Lines: row.Lines, StartsAt: row.StartsAt,
			EndsAt: row.EndsAt, ReceiptObjectKey: row.ReceiptObjectKey, ReceiptContentType: row.ReceiptContentType,
			ReportNote: row.ReportNote, ReportedAt: row.ReportedAt, ReviewedAt: row.ReviewedAt,
			RejectReason: row.RejectReason, CustomFeatures: row.CustomFeatures,
			ExpiresAt: row.ExpiresAt, CreatedAt: row.CreatedAt,
		},
		PlanUUID: row.PlanUuid, PlanCode: row.PlanCode, PlanName: row.PlanName,
		OrganizationUUID: row.OrganizationUuid, OrganizationSlug: row.OrganizationSlug,
		OrganizationName: row.OrganizationName, IncludeOrganization: true,
	})
}

func (s *Service) orderFromOrgAdminRow(ctx context.Context, row db.ListOrdersForOrgAdminRow) (Order, error) {
	return s.mapOrder(ctx, orderRecord{
		Order: db.BillingOrder{
			ID: row.ID, Uuid: row.Uuid, OrganizationID: row.OrganizationID, PlanID: row.PlanID,
			Period: row.Period, Kind: row.Kind, Status: row.Status, Channel: row.Channel,
			ReferenceCode: row.ReferenceCode, ListPrice: row.ListPrice, ProrationCredit: row.ProrationCredit,
			DiscountCodeID: row.DiscountCodeID, DiscountCode: row.DiscountCode, DiscountAmount: row.DiscountAmount,
			CreditApplied: row.CreditApplied, CreditSurplus: row.CreditSurplus, Total: row.Total,
			VatRate: row.VatRate, VatAmount: row.VatAmount, Lines: row.Lines, StartsAt: row.StartsAt,
			EndsAt: row.EndsAt, ReceiptObjectKey: row.ReceiptObjectKey, ReceiptContentType: row.ReceiptContentType,
			ReportNote: row.ReportNote, ReportedAt: row.ReportedAt, ReviewedAt: row.ReviewedAt,
			RejectReason: row.RejectReason, CustomFeatures: row.CustomFeatures,
			ExpiresAt: row.ExpiresAt, CreatedAt: row.CreatedAt,
		},
		PlanUUID: row.PlanUuid, PlanCode: row.PlanCode, PlanName: row.PlanName,
		OrganizationUUID: row.OrganizationUuid, OrganizationSlug: row.OrganizationSlug,
		OrganizationName: row.OrganizationName, IncludeOrganization: true,
	})
}

func (s *Service) mapOrder(ctx context.Context, rec orderRecord) (Order, error) {
	row := rec.Order
	var lines []QuoteLine
	if len(row.Lines) > 0 {
		_ = json.Unmarshal(row.Lines, &lines)
	}
	var discountCode *string
	if strings.TrimSpace(row.DiscountCode) != "" {
		v := row.DiscountCode
		discountCode = &v
	}
	var receiptType *string
	if row.ReceiptContentType != "" {
		v := row.ReceiptContentType
		receiptType = &v
	}
	var reportedAt *time.Time
	if row.ReportedAt.Valid {
		v := row.ReportedAt.Time
		reportedAt = &v
	}
	var reviewedAt *time.Time
	if row.ReviewedAt.Valid {
		v := row.ReviewedAt.Time
		reviewedAt = &v
	}
	out := Order{
		UUID: row.Uuid, ReferenceCode: row.ReferenceCode, Kind: row.Kind, Status: row.Status,
		Channel: row.Channel, Plan: PlanRef{UUID: rec.PlanUUID, Code: rec.PlanCode, Name: rec.PlanName},
		Period: row.Period, ListPrice: numericString(row.ListPrice), ProrationCredit: numericString(row.ProrationCredit),
		CustomFeatures: unmarshalCustomFeatures(row.CustomFeatures),
		DiscountCode:   discountCode, DiscountAmount: numericString(row.DiscountAmount),
		CreditApplied: numericString(row.CreditApplied), CreditSurplus: numericString(row.CreditSurplus),
		Total: numericString(row.Total), VATAmount: numericString(row.VatAmount), Lines: lines,
		HasReceipt: row.ReceiptObjectKey != "", ReceiptContentType: receiptType, ReportNote: row.ReportNote,
		ReportedAt: reportedAt, ReviewedAt: reviewedAt, RejectReason: row.RejectReason,
		ExpiresAt: row.ExpiresAt.Time, CreatedAt: row.CreatedAt.Time,
	}
	if rec.IncludeOrganization {
		out.Organization = &OrganizationRef{UUID: rec.OrganizationUUID, Slug: rec.OrganizationSlug, Name: rec.OrganizationName}
	}
	if inv, err := s.q.GetInvoiceByOrder(ctx, row.ID); err == nil {
		v := inv.Uuid
		out.InvoiceUUID = &v
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Order{}, err
	}
	if isOpenOrder(row.Status) {
		settings, err := s.q.GetBillingSettings(ctx)
		if err != nil {
			return Order{}, err
		}
		ins, err := channelFor(row.Channel).Instructions(ctx, row, settings)
		if err != nil {
			return Order{}, err
		}
		out.Instructions = &ins
	}
	return out, nil
}
