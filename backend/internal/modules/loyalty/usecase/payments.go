package usecase

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// payment is a resolved PaymentInput.
type payment struct {
	method      string
	account     pgtype.Int8
	accountUUID uuid.UUID
}

func (s *Service) resolvePayment(ctx context.Context, q *db.Queries, org int64, method string, accountUUID *uuid.UUID, currency string) (payment, error) {
	p := payment{method: strings.TrimSpace(method)}
	switch p.method {
	case "cash", "card":
		if accountUUID == nil || *accountUUID == uuid.Nil {
			return p, invalid("finance_account_uuid is required for cash / card")
		}
		fa, err := q.GetFinanceAccountByUUID(ctx, db.GetFinanceAccountByUUIDParams{Uuid: *accountUUID, OrganizationID: org})
		if err != nil {
			if notFound(err) == ErrNotFound {
				return p, invalid("finance account not found")
			}
			return p, err
		}
		if !strings.EqualFold(fa.Currency, currency) {
			return p, invalid("finance account currency must be %s", currency)
		}
		p.account = pgtype.Int8{Int64: fa.ID, Valid: true}
		p.accountUUID = fa.Uuid
	case "cari":
	default:
		return p, invalid("method must be cash, card or cari")
	}
	return p, nil
}

type posted struct {
	financeTx pgtype.Int8
	cariEntry pgtype.Int8
	txUUID    uuid.UUID
}

type postInput struct {
	customerID int64
	amount     pgtype.Numeric
	currency   string
	category   string
	sourceType string
	sourceUUID uuid.UUID
	desc       string
	meta       map[string]any
	day        time.Time
}

// post records the money: income into a finance account (cash / card) or a
// charge on the customer's cari account.
func (s *Service) post(ctx context.Context, q *db.Queries, actor int64, p payment, in postInput) (posted, error) {
	var out posted
	if actor <= 0 {
		return out, invalid("actor required")
	}
	if s.finance == nil || s.cari == nil {
		return out, invalid("payments are not configured")
	}
	meta, _ := json.Marshal(in.meta)
	date := pgtype.Date{Time: in.day, Valid: true}
	if p.method == "cari" {
		ce, err := s.cari.ChargeFromSourceTx(ctx, q, actor, cariusecase.ChargeFromSourceInput{
			CustomerID: in.customerID, Amount: in.amount, Currency: in.currency, EntryDate: date,
			Description: in.desc, SourceType: in.sourceType, SourceUUID: in.sourceUUID, Metadata: meta,
		})
		if err != nil {
			return out, err
		}
		out.cariEntry = pgtype.Int8{Int64: ce.ID, Valid: true}
		return out, nil
	}
	cat, err := s.finance.ResolveCategoryIDByName(ctx, q, in.category, "income")
	if err != nil {
		return out, err
	}
	ft, err := s.finance.PostIncomeFromSourceTx(ctx, q, actor, financeusecase.PostFromSourceInput{
		AccountID: p.account.Int64, CategoryID: cat, Amount: in.amount, Currency: in.currency, TransactionDate: date,
		Description: in.desc, PaymentMethod: p.method, SourceType: in.sourceType, SourceUUID: in.sourceUUID, Metadata: meta,
	})
	if err != nil {
		return out, err
	}
	out.financeTx = pgtype.Int8{Int64: ft.ID, Valid: true}
	out.txUUID = ft.Uuid
	return out, nil
}

// unpost voids what post recorded (refund of an unused package).
func (s *Service) unpost(ctx context.Context, q *db.Queries, actor int64, method, sourceType string, sourceUUID uuid.UUID) (uuid.UUID, error) {
	if s.finance == nil || s.cari == nil {
		return uuid.Nil, invalid("payments are not configured")
	}
	if method == "cari" {
		_, err := s.cari.VoidBySourceTx(ctx, q, actor, sourceType, sourceUUID)
		if err != nil && err != cariusecase.ErrNotFound {
			return uuid.Nil, err
		}
		return uuid.Nil, nil
	}
	ft, err := s.finance.VoidBySourceTx(ctx, q, actor, sourceType, sourceUUID)
	if err != nil {
		if err == financeusecase.ErrNotFound {
			return uuid.Nil, nil
		}
		return uuid.Nil, err
	}
	return ft.Uuid, nil
}

func (s *Service) notifyFinance(ctx context.Context, txUUID, accountUUID uuid.UUID) {
	if s.finance != nil && (txUUID != uuid.Nil || accountUUID != uuid.Nil) {
		s.finance.NotifyIndexed(ctx, txUUID, accountUUID)
	}
}
