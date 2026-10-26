package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourceevents"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// maxLines caps the lines of one purchase.
const maxLines = 200

// StatusDraft is a purchase that changes neither stock nor finance until it
// is posted (reorder suggestions create drafts).
const StatusDraft = "draft"

// DraftInput creates or replaces a draft purchase.
type DraftInput struct {
	SupplierUUID uuid.UUID         `json:"supplier_uuid"`
	Notes        string            `json:"notes"`
	Currency     string            `json:"currency"`
	Lines        []CreateLineInput `json:"lines"`
	// Source tags the activity entry (e.g. "reorder"); not stored.
	Source string `json:"-"`
}

// PostDraftInput turns a draft into a posted purchase. Lines, when given,
// replace the draft lines (edited quantities / costs); Notes, when given,
// replace the notes.
type PostDraftInput struct {
	Method             string            `json:"method"`
	FinanceAccountUUID uuid.UUID         `json:"finance_account_uuid"`
	PurchasedAt        *string           `json:"purchased_at"`
	Notes              *string           `json:"notes"`
	SupplierUUID       *uuid.UUID        `json:"supplier_uuid"`
	Lines              []CreateLineInput `json:"lines"`
}

// CreateDraft records a draft purchase: no stock change, no finance entry.
func (s *Service) CreateDraft(ctx context.Context, in DraftInput) (PurchaseDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	prep, err := s.prepare(ctx, s.q, orgID, in.SupplierUUID, in.Currency, in.Lines, true)
	if err != nil {
		return PurchaseDetail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	purchase, err := qtx.CreatePurchase(ctx, db.CreatePurchaseParams{
		OrganizationID: orgID,
		SupplierID:     prep.supplier.ID,
		SupplierName:   prep.supplier.Name,
		Status:         StatusDraft,
		Currency:       prep.currency,
		TotalAmount:    prep.totalNum,
		// Placeholder until posting chooses the payment method.
		Method:      "cash",
		Notes:       strings.TrimSpace(in.Notes),
		PurchasedAt: pgtype.Timestamptz{Time: s.now(), Valid: true},
		CreatedBy:   actorID,
	})
	if err != nil {
		return PurchaseDetail{}, err
	}
	if err := insertLines(ctx, qtx, orgID, purchase.ID, prep); err != nil {
		return PurchaseDetail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PurchaseDetail{}, err
	}
	detail, err := s.Get(ctx, purchase.Uuid)
	if err != nil {
		return PurchaseDetail{}, err
	}
	payload := map[string]any{"supplier": prep.supplier.Name, "lines": len(prep.lines), "total": financeusecase.NumericToString(prep.totalNum)}
	if in.Source != "" {
		payload["source"] = in.Source
	}
	s.recordActivity(ctx, "tenant.purchases.draft_create", "purchase", &purchase.Uuid, payload)
	s.live(ctx, resourceevents.TenantPurchases, resourceevents.ActionCreated, purchase.Uuid.String())
	return detail, nil
}

// UpdateDraft replaces the supplier, notes and lines of a draft.
func (s *Service) UpdateDraft(ctx context.Context, id uuid.UUID, in DraftInput) (PurchaseDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	if _, err := s.actorID(ctx); err != nil {
		return PurchaseDetail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	draft, err := s.lockDraft(ctx, qtx, orgID, id)
	if err != nil {
		return PurchaseDetail{}, err
	}
	if in.Currency == "" {
		in.Currency = draft.Currency
	}
	prep, err := s.prepare(ctx, qtx, orgID, in.SupplierUUID, in.Currency, in.Lines, true)
	if err != nil {
		return PurchaseDetail{}, err
	}
	if _, err := qtx.UpdateDraftPurchase(ctx, db.UpdateDraftPurchaseParams{
		ID: draft.ID, OrganizationID: orgID, SupplierID: prep.supplier.ID, SupplierName: prep.supplier.Name,
		Currency: prep.currency, TotalAmount: prep.totalNum, Notes: strings.TrimSpace(in.Notes),
	}); err != nil {
		return PurchaseDetail{}, err
	}
	if err := qtx.DeletePurchaseLines(ctx, db.DeletePurchaseLinesParams{PurchaseID: draft.ID, OrganizationID: orgID}); err != nil {
		return PurchaseDetail{}, err
	}
	if err := insertLines(ctx, qtx, orgID, draft.ID, prep); err != nil {
		return PurchaseDetail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PurchaseDetail{}, err
	}
	detail, err := s.Get(ctx, id)
	if err != nil {
		return PurchaseDetail{}, err
	}
	s.recordActivity(ctx, "tenant.purchases.draft_update", "purchase", &id, map[string]any{"lines": len(prep.lines)})
	s.live(ctx, resourceevents.TenantPurchases, resourceevents.ActionUpdated, id.String())
	return detail, nil
}

// PostDraft posts a draft through the regular purchase flow: stock goes up
// for tracked products and the expense is booked on the finance account.
func (s *Service) PostDraft(ctx context.Context, id uuid.UUID, in PostDraftInput) (PurchaseDetail, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	actorID, err := s.actorID(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	method, err := normalizeMethod(in.Method)
	if err != nil {
		return PurchaseDetail{}, err
	}
	if in.FinanceAccountUUID == uuid.Nil {
		return PurchaseDetail{}, fmt.Errorf("%w: finance_account_uuid is required", ErrInvalidRequest)
	}
	purchasedAt, err := s.parsePurchasedAt(in.PurchasedAt)
	if err != nil {
		return PurchaseDetail{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PurchaseDetail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	draft, err := s.lockDraft(ctx, qtx, orgID, id)
	if err != nil {
		return PurchaseDetail{}, err
	}
	supplierUUID, err := s.draftSupplierUUID(ctx, qtx, orgID, draft, in.SupplierUUID)
	if err != nil {
		return PurchaseDetail{}, err
	}
	lines := in.Lines
	if len(lines) == 0 {
		existing, err := qtx.ListPurchaseLines(ctx, db.ListPurchaseLinesParams{PurchaseID: draft.ID, OrganizationID: orgID})
		if err != nil {
			return PurchaseDetail{}, err
		}
		for _, l := range existing {
			cost := financeusecase.NumericToString(l.UnitCost)
			qty := financeusecase.NumericToString(l.Qty)
			lines = append(lines, CreateLineInput{ProductUUID: l.ProductUuid, UnitCost: &cost, Qty: &qty})
		}
	}
	prep, err := s.prepare(ctx, qtx, orgID, supplierUUID, draft.Currency, lines, false)
	if err != nil {
		return PurchaseDetail{}, err
	}
	fa, err := s.financeAccount(ctx, qtx, orgID, in.FinanceAccountUUID, prep.currency)
	if err != nil {
		return PurchaseDetail{}, err
	}
	notes := draft.Notes
	if in.Notes != nil {
		notes = strings.TrimSpace(*in.Notes)
	}
	posted, err := qtx.PostDraftPurchase(ctx, db.PostDraftPurchaseParams{
		ID: draft.ID, OrganizationID: orgID, SupplierID: prep.supplier.ID, SupplierName: prep.supplier.Name,
		Currency: prep.currency, TotalAmount: prep.totalNum, Method: method,
		FinanceAccountID: pgtype.Int8{Int64: fa.ID, Valid: true}, Notes: notes,
		PurchasedAt: pgtype.Timestamptz{Time: purchasedAt, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PurchaseDetail{}, fmt.Errorf("%w: purchase is not a draft", ErrConflict)
		}
		return PurchaseDetail{}, err
	}
	if err := qtx.DeletePurchaseLines(ctx, db.DeletePurchaseLinesParams{PurchaseID: draft.ID, OrganizationID: orgID}); err != nil {
		return PurchaseDetail{}, err
	}
	ft, err := s.postTx(ctx, qtx, orgID, actorID, posted.ID, posted.Uuid, prep, method, fa.ID, purchasedAt)
	if err != nil {
		return PurchaseDetail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PurchaseDetail{}, err
	}
	s.finance.NotifyIndexed(ctx, ft.Uuid, fa.Uuid)

	detail, err := s.Get(ctx, id)
	if err != nil {
		return PurchaseDetail{}, err
	}
	s.recordActivity(ctx, "tenant.purchases.post_draft", "purchase", &id, map[string]any{
		"method": method, "total": financeusecase.NumericToString(prep.totalNum),
	})
	s.live(ctx, resourceevents.TenantPurchases, resourceevents.ActionUpdated, id.String())
	s.liveMoney(ctx)
	s.publish(ctx, events.PurchasesCreated, map[string]any{"uuid": id.String()})
	s.indexPurchase(ctx, id)
	return detail, nil
}

// DeleteDraft discards a draft (posted purchases are voided instead).
func (s *Service) DeleteDraft(ctx context.Context, id uuid.UUID) error {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return err
	}
	n, err := s.q.DeleteDraftPurchase(ctx, db.DeleteDraftPurchaseParams{Uuid: id, OrganizationID: orgID})
	if err != nil {
		return err
	}
	if n == 0 {
		if _, err := s.q.GetPurchaseByUUID(ctx, db.GetPurchaseByUUIDParams{Uuid: id, OrganizationID: orgID}); err == nil {
			return fmt.Errorf("%w: only draft purchases can be deleted", ErrConflict)
		}
		return ErrNotFound
	}
	s.recordActivity(ctx, "tenant.purchases.draft_delete", "purchase", &id, nil)
	s.live(ctx, resourceevents.TenantPurchases, resourceevents.ActionDeleted, id.String())
	return nil
}

// CountDrafts returns the organization's open drafts.
func (s *Service) CountDrafts(ctx context.Context) (int64, error) {
	orgID, err := s.requireOrgID(ctx)
	if err != nil {
		return 0, err
	}
	return s.q.CountDraftPurchases(ctx, orgID)
}

// lockDraft loads a draft FOR UPDATE: another organization's or a posted
// purchase is not found / a conflict.
func (s *Service) lockDraft(ctx context.Context, qtx *db.Queries, orgID int64, id uuid.UUID) (db.Purchase, error) {
	draft, err := qtx.GetDraftPurchaseForUpdate(ctx, db.GetDraftPurchaseForUpdateParams{Uuid: id, OrganizationID: orgID})
	if err == nil {
		return draft, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return draft, err
	}
	if _, gerr := qtx.GetPurchaseByUUID(ctx, db.GetPurchaseByUUIDParams{Uuid: id, OrganizationID: orgID}); gerr == nil {
		return draft, fmt.Errorf("%w: purchase is not a draft", ErrConflict)
	}
	return draft, ErrNotFound
}

func (s *Service) draftSupplierUUID(ctx context.Context, qtx *db.Queries, orgID int64, draft db.Purchase, override *uuid.UUID) (uuid.UUID, error) {
	if override != nil && *override != uuid.Nil {
		return *override, nil
	}
	row, err := qtx.GetPurchaseByUUID(ctx, db.GetPurchaseByUUIDParams{Uuid: draft.Uuid, OrganizationID: orgID})
	if err != nil {
		return uuid.Nil, err
	}
	return row.SupplierUuid, nil
}
