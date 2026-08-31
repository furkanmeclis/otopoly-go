package handler

// TODO(finance): OpenAPI — add full request/response schemas for account/category detail,
// balance snapshot, and enrich EnvelopeFinanceTransaction (counter account, metadata, created_by).

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/resourcemeta"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/apiquery"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
	"github.com/google/uuid"
)

type Handler struct {
	svc *financeusecase.Service
}

func New(svc *financeusecase.Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) AccountsMeta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, resourcemeta.TenantFinanceAccounts())
}

func (h *Handler) ListAccounts(w http.ResponseWriter, r *http.Request) {
	q := apiquery.Parse(r.URL.Query())
	var isActive *bool
	if v := r.URL.Query().Get("is_active"); v != "" {
		b := v == "true"
		isActive = &b
	}
	items, total, err := h.svc.ListAccounts(r.Context(), q.Limit, q.Offset, q.Q, isActive)
	if err != nil {
		response.InternalErr(w, r, err, "failed to list accounts")
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) CreateAccount(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name           string  `json:"name"`
		Type           string  `json:"type"`
		Currency       string  `json:"currency"`
		OpeningBalance string  `json:"opening_balance"`
		IsDefault      bool    `json:"is_default"`
		BankName       *string `json:"bank_name"`
		IBAN           *string `json:"iban"`
		Notes          string  `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	item, err := h.svc.CreateAccount(r.Context(), financeusecase.CreateAccountInput{
		Name: body.Name, Type: body.Type, Currency: body.Currency,
		OpeningBalance: body.OpeningBalance, IsDefault: body.IsDefault,
		BankName: body.BankName, IBAN: body.IBAN, Notes: body.Notes,
	})
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) GetAccount(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	item, err := h.svc.GetAccount(r.Context(), id)
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) PatchAccount(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	var body struct {
		Name      *string `json:"name"`
		Type      *string `json:"type"`
		IsDefault *bool   `json:"is_default"`
		IsActive  *bool   `json:"is_active"`
		BankName  *string `json:"bank_name"`
		IBAN      *string `json:"iban"`
		Notes     *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	item, err := h.svc.PatchAccount(r.Context(), id, financeusecase.PatchAccountInput{
		Name: body.Name, Type: body.Type, IsDefault: body.IsDefault, IsActive: body.IsActive,
		BankName: body.BankName, IBAN: body.IBAN, Notes: body.Notes,
	})
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	if err := h.svc.DeleteAccount(r.Context(), id); err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"deleted": true})
}

func (h *Handler) AccountBalance(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	limit := parseRecentLimit(r)
	account, recent, err := h.svc.AccountBalance(r.Context(), id, limit)
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{
		"account":             account,
		"recent_transactions": recent,
	})
}

func (h *Handler) AccountDetail(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	item, err := h.svc.AccountDetail(r.Context(), id, parseRecentLimit(r))
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) GetCategory(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	item, err := h.svc.GetCategory(r.Context(), id)
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) CategoryDetail(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	item, err := h.svc.CategoryDetail(r.Context(), id, parseRecentLimit(r))
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	var isActive *bool
	if v := r.URL.Query().Get("is_active"); v != "" {
		b := v == "true"
		isActive = &b
	}
	items, err := h.svc.ListCategories(r.Context(), r.URL.Query().Get("kind"), isActive)
	if err != nil {
		response.InternalErr(w, r, err, "failed to list categories")
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name       string     `json:"name"`
		Kind       string     `json:"kind"`
		ParentUUID *uuid.UUID `json:"parent_uuid"`
		SortOrder  int32      `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	item, err := h.svc.CreateCategory(r.Context(), financeusecase.CreateCategoryInput{
		Name: body.Name, Kind: body.Kind, ParentUUID: body.ParentUUID, SortOrder: body.SortOrder,
	})
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) PatchCategory(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	var body struct {
		Name       *string    `json:"name"`
		ParentUUID *uuid.UUID `json:"parent_uuid"`
		SortOrder  *int32     `json:"sort_order"`
		IsActive   *bool      `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	item, err := h.svc.PatchCategory(r.Context(), id, financeusecase.PatchCategoryInput{
		Name: body.Name, ParentUUID: body.ParentUUID, SortOrder: body.SortOrder, IsActive: body.IsActive,
	})
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	if err := h.svc.DeleteCategory(r.Context(), id); err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, map[string]bool{"deleted": true})
}

func (h *Handler) TransactionsMeta(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, r, http.StatusOK, resourcemeta.TenantFinanceTransactions())
}

func (h *Handler) ListTransactions(w http.ResponseWriter, r *http.Request) {
	q := apiquery.Parse(r.URL.Query())
	filters := financeusecase.TransactionFilters{
		Type: r.URL.Query().Get("type"), Status: r.URL.Query().Get("status"),
		Currency: r.URL.Query().Get("currency"), DateFrom: r.URL.Query().Get("date_from"),
		DateTo: r.URL.Query().Get("date_to"), Q: q.Q,
	}
	if v := r.URL.Query().Get("account_uuid"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			filters.AccountUUID = &id
		}
	}
	if v := r.URL.Query().Get("category_uuid"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			filters.CategoryUUID = &id
		}
	}
	items, total, err := h.svc.ListTransactions(r.Context(), q.Limit, q.Offset, filters)
	if err != nil {
		response.InternalErr(w, r, err, "failed to list transactions")
		return
	}
	response.JSON(w, r, http.StatusOK, apiquery.NewPage(items, total, q.Limit, q.Offset))
}

func (h *Handler) CreateTransaction(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	var body struct {
		Type            string     `json:"type"`
		AccountUUID     uuid.UUID  `json:"account_uuid"`
		CategoryUUID    *uuid.UUID `json:"category_uuid"`
		Amount          string     `json:"amount"`
		TransactionDate string     `json:"transaction_date"`
		Description     string     `json:"description"`
		ReferenceNo     *string    `json:"reference_no"`
		PaymentMethod   string     `json:"payment_method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	item, err := h.svc.CreateTransaction(r.Context(), p.UserInternal, financeusecase.CreateTransactionInput{
		Type: body.Type, AccountUUID: body.AccountUUID, CategoryUUID: body.CategoryUUID,
		Amount: body.Amount, TransactionDate: body.TransactionDate, Description: body.Description,
		ReferenceNo: body.ReferenceNo, PaymentMethod: body.PaymentMethod,
	}, r)
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) GetTransaction(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	item, err := h.svc.GetTransaction(r.Context(), id)
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) VoidTransaction(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	id, err := uuid.Parse(r.PathValue("uuid"))
	if err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid uuid")
		return
	}
	item, err := h.svc.VoidTransaction(r.Context(), p.UserInternal, id, r)
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func (h *Handler) CreateTransfer(w http.ResponseWriter, r *http.Request) {
	p := authctx.MustPrincipal(r.Context())
	var body struct {
		FromAccountUUID uuid.UUID `json:"from_account_uuid"`
		ToAccountUUID   uuid.UUID `json:"to_account_uuid"`
		Amount          string    `json:"amount"`
		TransactionDate string    `json:"transaction_date"`
		Description     string    `json:"description"`
		ReferenceNo     *string   `json:"reference_no"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.BadRequest(w, r, response.CodeValidationError, "Invalid JSON body")
		return
	}
	item, err := h.svc.CreateTransfer(r.Context(), p.UserInternal, financeusecase.CreateTransferInput{
		FromAccountUUID: body.FromAccountUUID, ToAccountUUID: body.ToAccountUUID,
		Amount: body.Amount, TransactionDate: body.TransactionDate,
		Description: body.Description, ReferenceNo: body.ReferenceNo,
	}, r)
	if err != nil {
		writeFinanceErr(w, r, err)
		return
	}
	response.JSON(w, r, http.StatusCreated, item)
}

func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	dateFrom := q.Get("date_from")
	dateTo := q.Get("date_to")
	if dateFrom == "" {
		now := time.Now().UTC()
		dateFrom = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	}
	if dateTo == "" {
		dateTo = time.Now().UTC().Format("2006-01-02")
	}
	item, err := h.svc.Summary(r.Context(), dateFrom, dateTo, q.Get("currency"))
	if err != nil {
		response.InternalErr(w, r, err, "failed to load summary")
		return
	}
	response.JSON(w, r, http.StatusOK, item)
}

func writeFinanceErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, financeusecase.ErrNotFound):
		response.NotFound(w, r, "Resource not found")
	case errors.Is(err, financeusecase.ErrConflict):
		response.Conflict(w, r, response.CodeConflict, err.Error())
	case errors.Is(err, financeusecase.ErrCurrencyMismatch):
		response.Error(w, r, http.StatusBadRequest, "CURRENCY_MISMATCH", "Accounts must share the same currency")
	case errors.Is(err, financeusecase.ErrInvalidRequest):
		response.ValidationError(w, r, []response.Detail{{Message: err.Error()}})
	default:
		response.InternalErr(w, r, err, "finance operation failed")
	}
}

func parseRecentLimit(r *http.Request) int32 {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return 10
	}
	n, err := strconv.ParseInt(raw, 10, 32)
	if err != nil || n <= 0 {
		return 10
	}
	if n > 50 {
		return 50
	}
	return int32(n)
}
