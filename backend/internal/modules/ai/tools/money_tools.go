package tools

import (
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"strings"

	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// Narrow write-side service interfaces (satisfied by the module use cases).
type (
	CariWriter interface {
		Get(ctx context.Context, id uuid.UUID) (cariusecase.AccountDetail, error)
		CreatePayment(ctx context.Context, accountUUID uuid.UUID, in cariusecase.PaymentInput) (cariusecase.Entry, error)
		CreateCharge(ctx context.Context, accountUUID uuid.UUID, in cariusecase.ChargeInput) (cariusecase.Entry, error)
	}
	FinanceWriter interface {
		FinanceReader
		ListCategories(ctx context.Context, kind string, isActive *bool) ([]financeusecase.Category, error)
		CreateTransaction(ctx context.Context, actorID int64, in financeusecase.CreateTransactionInput, req *http.Request) (financeusecase.Transaction, error)
		CreateTransfer(ctx context.Context, actorID int64, in financeusecase.CreateTransferInput, req *http.Request) (financeusecase.Transaction, error)
	}
)

// ---------------------------------------------------------------- shared

func activeAccounts(ctx context.Context, fin FinanceReader) ([]financeusecase.Account, error) {
	active := true
	rows, _, err := fin.ListAccounts(ctx, 100, 0, "", &active)
	return rows, err
}

// preferredAccountType maps a payment method to the account type it usually lands in.
func preferredAccountType(method string) string {
	if method == "cash" || method == "" {
		return "cash"
	}
	return "bank"
}

// resolveAccount finds an active finance account by uuid or name; with an
// empty ref it picks the default account of the preferred type.
func resolveAccount(accounts []financeusecase.Account, ref, currency, preferType, field string) (financeusecase.Account, error) {
	var pool []financeusecase.Account
	for _, a := range accounts {
		if currency == "" || strings.EqualFold(a.Currency, currency) {
			pool = append(pool, a)
		}
	}
	if len(pool) == 0 {
		return financeusecase.Account{}, inputErr("no active cash/bank account in %s; create one in Finans first", firstNonBlank(currency, "this currency"))
	}
	name := func(a financeusecase.Account) string { return a.Name }
	ref = strings.TrimSpace(ref)
	if ref != "" {
		if id, err := uuid.Parse(ref); err == nil {
			for _, a := range pool {
				if a.UUID == id {
					return a, nil
				}
			}
			return financeusecase.Account{}, inputErr("%s %s not found; available: %s", field, ref, names(pool, name, 10))
		}
		if a, _, ok := matchByName(ref, pool, name); ok {
			return a, nil
		}
		return financeusecase.Account{}, inputErr("%s %q not found or ambiguous; available: %s", field, ref, names(pool, name, 10))
	}
	var typed []financeusecase.Account
	for _, a := range pool {
		if a.Type == preferType {
			typed = append(typed, a)
		}
	}
	for _, a := range typed {
		if a.IsDefault {
			return a, nil
		}
	}
	if len(typed) == 1 {
		return typed[0], nil
	}
	if len(typed) == 0 {
		for _, a := range pool {
			if a.IsDefault {
				return a, nil
			}
		}
		if len(pool) == 1 {
			return pool[0], nil
		}
	}
	return financeusecase.Account{}, inputErr("several accounts match; pass %s (one of: %s)", field, names(pool, name, 10))
}

func accountOptions(accounts []financeusecase.Account, currency string) []Option {
	out := []Option{}
	for _, a := range accounts {
		if currency == "" || strings.EqualFold(a.Currency, currency) {
			out = append(out, Option{Value: a.UUID.String(), Label: a.Name})
		}
	}
	return out
}

func firstNonBlank(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func balanceAfter(balance string, delta *big.Rat) string {
	r := ratOf(balance)
	return r.Add(r, delta).FloatString(2)
}

func descriptionField(desc string) []Field {
	if strings.TrimSpace(desc) == "" {
		return nil
	}
	return []Field{{Key: "description", Value: desc}}
}

// ---------------------------------------------------------------- cari payment

// RecordCariPayment records a collection (tahsilat) on a customer's cari account.
type RecordCariPayment struct {
	cari    CariWriter
	finance FinanceReader
}

var cariPaymentSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"cari_account_uuid": map[string]any{"type": "string", "format": "uuid", "description": "cari_account_uuid from search_customers."},
		"amount":            map[string]any{"type": "number", "minimum": 0.01, "description": "Amount received, e.g. 20000."},
		"payment_method":    map[string]any{"type": "string", "enum": paymentMethodValues, "description": "cash (nakit, default), card (kart/POS), transfer (havale/EFT), other."},
		"finance_account":   map[string]any{"type": "string", "maxLength": 100, "description": "Cash/bank account name or uuid the money went into. Omit to use the default cash register for cash, the bank account otherwise."},
		"date":              map[string]any{"type": "string", "format": "date", "description": "Default today."},
		"description":       map[string]any{"type": "string", "maxLength": 300},
	},
	"required":             []string{"cari_account_uuid", "amount"},
	"additionalProperties": false,
}

type cariPaymentInput struct {
	AccountUUID    string  `json:"cari_account_uuid"`
	Amount         float64 `json:"amount"`
	PaymentMethod  string  `json:"payment_method,omitempty"`
	FinanceAccount string  `json:"finance_account,omitempty"`
	Date           string  `json:"date,omitempty"`
	Description    string  `json:"description,omitempty"`
}

// Spec implements Tool.
func (RecordCariPayment) Spec() Spec {
	return Spec{
		Name: "record_cari_payment",
		Description: "Propose recording money received from a customer against their cari (receivable) balance (cari tahsilat). " +
			"Use when the customer has an open balance (> 0); otherwise propose record_finance_entry (income). Shows a confirmation card; nothing changes until the user approves.",
		InputSchema:          cariPaymentSchema,
		Permissions:          []string{rbac.PermTenantCariWrite, rbac.PermTenantCariRead, rbac.PermTenantFinanceRead},
		OrgRoles:             []string{"owner"},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// Propose implements ActionTool.
func (t RecordCariPayment) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in cariPaymentInput
	if err := decodeInput(cariPaymentSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	amount, err := ParseAmount(in.Amount)
	if err != nil {
		return Proposal{}, err
	}
	id, _ := uuid.Parse(in.AccountUUID)
	acc, err := t.cari.Get(ctx, id)
	if err != nil {
		return Proposal{}, proposalError(err)
	}
	if in.PaymentMethod == "" {
		in.PaymentMethod = "cash"
	}
	accounts, err := activeAccounts(ctx, t.finance)
	if err != nil {
		return Proposal{}, err
	}
	fa, err := resolveAccount(accounts, in.FinanceAccount, acc.Currency, preferredAccountType(in.PaymentMethod), "finance_account")
	if err != nil {
		return Proposal{}, err
	}
	if in.Date, err = dateOrToday(env, in.Date); err != nil {
		return Proposal{}, err
	}
	in.FinanceAccount = fa.UUID.String()
	in.Amount = amount.Float()
	in.Description = trimmed(in.Description, 300)

	after := balanceAfter(acc.Balance, new(big.Rat).Neg(amount.Rat()))
	var warnings []string
	if ratOf(acc.Balance).Sign() <= 0 {
		warnings = append(warnings, "no_open_balance")
	} else if amount.Rat().Cmp(ratOf(acc.Balance)) > 0 {
		warnings = append(warnings, "exceeds_balance")
	}
	fields := []Field{
		{Key: "customer", Value: acc.CustomerName},
		{Key: "payment_method", ValueKey: "ai.confirm.values." + in.PaymentMethod},
		{Key: "finance_account", Value: fa.Name},
		{Key: "date", Value: in.Date},
		{Key: "balance_before", Value: FormatMoney(acc.Balance, acc.Currency)},
		{Key: "balance_after", Value: FormatMoney(after, acc.Currency)},
	}
	fields = append(fields, descriptionField(in.Description)...)
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "record_cari_payment", Title: acc.CustomerName, Amount: FormatMoney(amount.String(), acc.Currency),
			Fields: fields, Warnings: warnings,
			Edit: []EditField{
				{Key: "amount", Type: "money", Value: amount.String(), Required: true},
				{Key: "payment_method", Type: "select", Value: in.PaymentMethod, Options: methodOptions(paymentMethodValues), Required: true},
				{Key: "finance_account", Type: "select", Value: in.FinanceAccount, Options: accountOptions(accounts, acc.Currency), Required: true},
				{Key: "date", Type: "date", Value: in.Date, Required: true},
				{Key: "description", Type: "text", Value: in.Description},
			},
		},
	}, nil
}

// Run implements Tool (executes the confirmed, normalized input).
func (t RecordCariPayment) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in cariPaymentInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	amount, err := ParseAmount(in.Amount)
	if err != nil {
		return ErrorResult(err.Error()), nil
	}
	accID, _ := uuid.Parse(in.AccountUUID)
	faID, _ := uuid.Parse(in.FinanceAccount)
	entry, err := t.cari.CreatePayment(ctx, accID, cariusecase.PaymentInput{
		Amount: amount.String(), EntryDate: in.Date, Description: in.Description,
		PaymentMethod: in.PaymentMethod, FinanceAccountUUID: faID,
	})
	if err != nil {
		return execError(err)
	}
	acc, err := t.cari.Get(ctx, accID)
	cur, name := "TRY", ""
	if err == nil {
		cur, name = acc.Currency, acc.CustomerName
	}
	account := ""
	if entry.FinanceAccountName != nil {
		account = *entry.FinanceAccountName
	}
	res := JSONResult(map[string]any{
		"done": true, "entry_uuid": entry.UUID.String(), "customer": name,
		"amount": FormatMoney(entry.Amount, cur), "finance_account": account,
		"new_balance": FormatMoney(entry.BalanceAfter, cur),
	}, "ai.tool_summary.payment_recorded", map[string]any{"amount": FormatMoney(entry.Amount, cur), "name": name})
	res.Link = &Link{Kind: "cari", UUID: accID.String()}
	return res, nil
}

// ---------------------------------------------------------------- cari charge

// RecordCariCharge adds a charge (borçlandırma) to a customer's cari account.
type RecordCariCharge struct{ cari CariWriter }

var cariChargeSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"cari_account_uuid": map[string]any{"type": "string", "format": "uuid", "description": "cari_account_uuid from search_customers."},
		"amount":            map[string]any{"type": "number", "minimum": 0.01},
		"description":       map[string]any{"type": "string", "minLength": 1, "maxLength": 300, "description": "What the charge is for."},
		"date":              map[string]any{"type": "string", "format": "date", "description": "Default today."},
	},
	"required":             []string{"cari_account_uuid", "amount", "description"},
	"additionalProperties": false,
}

type cariChargeInput struct {
	AccountUUID string  `json:"cari_account_uuid"`
	Amount      float64 `json:"amount"`
	Description string  `json:"description"`
	Date        string  `json:"date,omitempty"`
}

// Spec implements Tool.
func (RecordCariCharge) Spec() Spec {
	return Spec{
		Name:                 "record_cari_charge",
		Description:          "Propose charging a customer's cari account (borçlandırma: the customer owes more, e.g. work done on credit). Shows a confirmation card.",
		InputSchema:          cariChargeSchema,
		Permissions:          []string{rbac.PermTenantCariWrite, rbac.PermTenantCariRead},
		OrgRoles:             []string{"owner"},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// Propose implements ActionTool.
func (t RecordCariCharge) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in cariChargeInput
	if err := decodeInput(cariChargeSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	amount, err := ParseAmount(in.Amount)
	if err != nil {
		return Proposal{}, err
	}
	id, _ := uuid.Parse(in.AccountUUID)
	acc, err := t.cari.Get(ctx, id)
	if err != nil {
		return Proposal{}, proposalError(err)
	}
	if in.Date, err = dateOrToday(env, in.Date); err != nil {
		return Proposal{}, err
	}
	in.Amount = amount.Float()
	in.Description = trimmed(in.Description, 300)
	after := balanceAfter(acc.Balance, amount.Rat())
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "record_cari_charge", Title: acc.CustomerName, Amount: FormatMoney(amount.String(), acc.Currency),
			Fields: []Field{
				{Key: "customer", Value: acc.CustomerName},
				{Key: "description", Value: in.Description},
				{Key: "date", Value: in.Date},
				{Key: "balance_before", Value: FormatMoney(acc.Balance, acc.Currency)},
				{Key: "balance_after", Value: FormatMoney(after, acc.Currency)},
			},
			Edit: []EditField{
				{Key: "amount", Type: "money", Value: amount.String(), Required: true},
				{Key: "description", Type: "text", Value: in.Description, Required: true},
				{Key: "date", Type: "date", Value: in.Date, Required: true},
			},
		},
	}, nil
}

// Run implements Tool.
func (t RecordCariCharge) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in cariChargeInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	amount, err := ParseAmount(in.Amount)
	if err != nil {
		return ErrorResult(err.Error()), nil
	}
	accID, _ := uuid.Parse(in.AccountUUID)
	entry, err := t.cari.CreateCharge(ctx, accID, cariusecase.ChargeInput{Amount: amount.String(), EntryDate: in.Date, Description: in.Description})
	if err != nil {
		return execError(err)
	}
	cur, name := "TRY", ""
	if acc, err := t.cari.Get(ctx, accID); err == nil {
		cur, name = acc.Currency, acc.CustomerName
	}
	res := JSONResult(map[string]any{
		"done": true, "entry_uuid": entry.UUID.String(), "customer": name,
		"amount": FormatMoney(entry.Amount, cur), "new_balance": FormatMoney(entry.BalanceAfter, cur),
	}, "ai.tool_summary.charge_recorded", map[string]any{"amount": FormatMoney(entry.Amount, cur), "name": name})
	res.Link = &Link{Kind: "cari", UUID: accID.String()}
	return res, nil
}

// ---------------------------------------------------------------- finance entry

// RecordFinanceEntry records an income or expense on a cash/bank account.
type RecordFinanceEntry struct{ finance FinanceWriter }

var financeEntrySchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"type":            map[string]any{"type": "string", "enum": []string{"income", "expense"}},
		"amount":          map[string]any{"type": "number", "minimum": 0.01},
		"finance_account": map[string]any{"type": "string", "maxLength": 100, "description": "Cash/bank account name or uuid. Omit for the default account matching payment_method."},
		"category":        map[string]any{"type": "string", "maxLength": 100, "description": "Category name (required for expense, e.g. Kira, Maaş, Malzeme, Genel Gider; income defaults to Diğer Gelir)."},
		"payment_method":  map[string]any{"type": "string", "enum": paymentMethodValues, "description": "Default cash."},
		"date":            map[string]any{"type": "string", "format": "date", "description": "Default today."},
		"description":     map[string]any{"type": "string", "maxLength": 300},
	},
	"required":             []string{"type", "amount"},
	"additionalProperties": false,
}

type financeEntryInput struct {
	Type           string  `json:"type"`
	Amount         float64 `json:"amount"`
	FinanceAccount string  `json:"finance_account,omitempty"`
	Category       string  `json:"category,omitempty"`
	PaymentMethod  string  `json:"payment_method,omitempty"`
	Date           string  `json:"date,omitempty"`
	Description    string  `json:"description,omitempty"`
}

// Spec implements Tool.
func (RecordFinanceEntry) Spec() Spec {
	return Spec{
		Name: "record_finance_entry",
		Description: "Propose an income (gelir) or expense (gider) entry on a cash register or bank account. " +
			"Use for money not tied to a customer's open cari balance. Shows a confirmation card.",
		InputSchema:          financeEntrySchema,
		Permissions:          []string{rbac.PermTenantFinanceWrite, rbac.PermTenantFinanceRead},
		OrgRoles:             []string{"owner"},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

func resolveCategory(cats []financeusecase.Category, ref string) (financeusecase.Category, error) {
	name := func(c financeusecase.Category) string { return c.Name }
	if id, err := uuid.Parse(strings.TrimSpace(ref)); err == nil {
		for _, c := range cats {
			if c.UUID == id {
				return c, nil
			}
		}
	}
	if c, _, ok := matchByName(ref, cats, name); ok {
		return c, nil
	}
	return financeusecase.Category{}, inputErr("category %q not found or ambiguous; available: %s", ref, names(cats, name, 15))
}

// Propose implements ActionTool.
func (t RecordFinanceEntry) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in financeEntryInput
	if err := decodeInput(financeEntrySchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	amount, err := ParseAmount(in.Amount)
	if err != nil {
		return Proposal{}, err
	}
	if in.PaymentMethod == "" {
		in.PaymentMethod = "cash"
	}
	accounts, err := activeAccounts(ctx, t.finance)
	if err != nil {
		return Proposal{}, err
	}
	fa, err := resolveAccount(accounts, in.FinanceAccount, "", preferredAccountType(in.PaymentMethod), "finance_account")
	if err != nil {
		return Proposal{}, err
	}
	active := true
	cats, err := t.finance.ListCategories(ctx, in.Type, &active)
	if err != nil {
		return Proposal{}, err
	}
	ref := strings.TrimSpace(in.Category)
	if ref == "" {
		if in.Type == "expense" {
			return Proposal{}, inputErr("category is required for an expense; available: %s", names(cats, func(c financeusecase.Category) string { return c.Name }, 15))
		}
		ref = "Diğer Gelir"
	}
	cat, err := resolveCategory(cats, ref)
	if err != nil {
		return Proposal{}, err
	}
	if in.Date, err = dateOrToday(env, in.Date); err != nil {
		return Proposal{}, err
	}
	in.FinanceAccount, in.Category, in.Amount = fa.UUID.String(), cat.UUID.String(), amount.Float()
	in.Description = trimmed(in.Description, 300)
	delta := amount.Rat()
	if in.Type == "expense" {
		delta.Neg(delta)
	}
	catOpts := make([]Option, 0, len(cats))
	for _, c := range cats {
		catOpts = append(catOpts, Option{Value: c.UUID.String(), Label: c.Name})
	}
	var warnings []string
	after := balanceAfter(fa.CurrentBalance, delta)
	if ratOf(after).Sign() < 0 {
		warnings = append(warnings, "negative_balance")
	}
	fields := []Field{
		{Key: "entry_type", ValueKey: "ai.confirm.values." + in.Type},
		{Key: "category", Value: cat.Name},
		{Key: "finance_account", Value: fa.Name},
		{Key: "payment_method", ValueKey: "ai.confirm.values." + in.PaymentMethod},
		{Key: "date", Value: in.Date},
		{Key: "account_balance_after", Value: FormatMoney(after, fa.Currency)},
	}
	fields = append(fields, descriptionField(in.Description)...)
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "record_finance_entry", Title: cat.Name, Amount: FormatMoney(amount.String(), fa.Currency),
			Fields: fields, Warnings: warnings,
			Edit: []EditField{
				{Key: "amount", Type: "money", Value: amount.String(), Required: true},
				{Key: "category", Type: "select", Value: in.Category, Options: catOpts, Required: true},
				{Key: "finance_account", Type: "select", Value: in.FinanceAccount, Options: accountOptions(accounts, ""), Required: true},
				{Key: "payment_method", Type: "select", Value: in.PaymentMethod, Options: methodOptions(paymentMethodValues), Required: true},
				{Key: "date", Type: "date", Value: in.Date, Required: true},
				{Key: "description", Type: "text", Value: in.Description},
			},
		},
	}, nil
}

// Run implements Tool.
func (t RecordFinanceEntry) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in financeEntryInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	amount, err := ParseAmount(in.Amount)
	if err != nil {
		return ErrorResult(err.Error()), nil
	}
	faID, _ := uuid.Parse(in.FinanceAccount)
	catID, err := uuid.Parse(in.Category)
	var catPtr *uuid.UUID
	if err == nil {
		catPtr = &catID
	}
	tx, err := t.finance.CreateTransaction(ctx, env.Principal.UserInternal, financeusecase.CreateTransactionInput{
		Type: in.Type, AccountUUID: faID, CategoryUUID: catPtr, Amount: amount.String(),
		TransactionDate: in.Date, Description: in.Description, PaymentMethod: in.PaymentMethod,
	}, nil)
	if err != nil {
		return execError(err)
	}
	out := map[string]any{
		"done": true, "transaction_uuid": tx.UUID.String(), "type": tx.Type,
		"amount": FormatMoney(tx.Amount, tx.Currency), "finance_account": tx.AccountName,
	}
	if tx.CategoryName != nil {
		out["category"] = *tx.CategoryName
	}
	if accs, err := activeAccounts(ctx, t.finance); err == nil {
		for _, a := range accs {
			if a.UUID == faID {
				out["account_balance"] = FormatMoney(a.CurrentBalance, a.Currency)
			}
		}
	}
	res := JSONResult(out, "ai.tool_summary.finance_recorded", map[string]any{"amount": FormatMoney(tx.Amount, tx.Currency), "account": tx.AccountName})
	res.Link = &Link{Kind: "finance_account", UUID: faID.String()}
	return res, nil
}

// ---------------------------------------------------------------- transfer

// CreateFinanceTransfer moves money between two cash/bank accounts (virman).
type CreateFinanceTransfer struct{ finance FinanceWriter }

var transferSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"from_account": map[string]any{"type": "string", "minLength": 1, "maxLength": 100, "description": "Source account name or uuid."},
		"to_account":   map[string]any{"type": "string", "minLength": 1, "maxLength": 100, "description": "Destination account name or uuid."},
		"amount":       map[string]any{"type": "number", "minimum": 0.01},
		"date":         map[string]any{"type": "string", "format": "date", "description": "Default today."},
		"description":  map[string]any{"type": "string", "maxLength": 300},
	},
	"required":             []string{"from_account", "to_account", "amount"},
	"additionalProperties": false,
}

type transferInput struct {
	From        string  `json:"from_account"`
	To          string  `json:"to_account"`
	Amount      float64 `json:"amount"`
	Date        string  `json:"date,omitempty"`
	Description string  `json:"description,omitempty"`
}

// Spec implements Tool.
func (CreateFinanceTransfer) Spec() Spec {
	return Spec{
		Name:                 "create_finance_transfer",
		Description:          "Propose a transfer (virman) between two of the organization's cash/bank accounts (same currency). Shows a confirmation card.",
		InputSchema:          transferSchema,
		Permissions:          []string{rbac.PermTenantFinanceWrite, rbac.PermTenantFinanceRead},
		OrgRoles:             []string{"owner"},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

// Propose implements ActionTool.
func (t CreateFinanceTransfer) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in transferInput
	if err := decodeInput(transferSchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	amount, err := ParseAmount(in.Amount)
	if err != nil {
		return Proposal{}, err
	}
	accounts, err := activeAccounts(ctx, t.finance)
	if err != nil {
		return Proposal{}, err
	}
	from, err := resolveAccount(accounts, in.From, "", "", "from_account")
	if err != nil {
		return Proposal{}, err
	}
	to, err := resolveAccount(accounts, in.To, from.Currency, "", "to_account")
	if err != nil {
		return Proposal{}, err
	}
	if from.UUID == to.UUID {
		return Proposal{}, inputErr("from_account and to_account must differ")
	}
	if in.Date, err = dateOrToday(env, in.Date); err != nil {
		return Proposal{}, err
	}
	in.From, in.To, in.Amount = from.UUID.String(), to.UUID.String(), amount.Float()
	in.Description = trimmed(in.Description, 300)
	fromAfter := balanceAfter(from.CurrentBalance, new(big.Rat).Neg(amount.Rat()))
	var warnings []string
	if ratOf(fromAfter).Sign() < 0 {
		warnings = append(warnings, "negative_balance")
	}
	fields := []Field{
		{Key: "from_account", Value: from.Name},
		{Key: "to_account", Value: to.Name},
		{Key: "date", Value: in.Date},
		{Key: "from_balance_after", Value: FormatMoney(fromAfter, from.Currency)},
		{Key: "to_balance_after", Value: FormatMoney(balanceAfter(to.CurrentBalance, amount.Rat()), to.Currency)},
	}
	fields = append(fields, descriptionField(in.Description)...)
	opts := accountOptions(accounts, from.Currency)
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "create_finance_transfer", Title: from.Name + " → " + to.Name, Amount: FormatMoney(amount.String(), from.Currency),
			Fields: fields, Warnings: warnings,
			Edit: []EditField{
				{Key: "amount", Type: "money", Value: amount.String(), Required: true},
				{Key: "from_account", Type: "select", Value: in.From, Options: opts, Required: true},
				{Key: "to_account", Type: "select", Value: in.To, Options: opts, Required: true},
				{Key: "date", Type: "date", Value: in.Date, Required: true},
				{Key: "description", Type: "text", Value: in.Description},
			},
		},
	}, nil
}

// Run implements Tool.
func (t CreateFinanceTransfer) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in transferInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	amount, err := ParseAmount(in.Amount)
	if err != nil {
		return ErrorResult(err.Error()), nil
	}
	fromID, _ := uuid.Parse(in.From)
	toID, _ := uuid.Parse(in.To)
	tx, err := t.finance.CreateTransfer(ctx, env.Principal.UserInternal, financeusecase.CreateTransferInput{
		FromAccountUUID: fromID, ToAccountUUID: toID, Amount: amount.String(), TransactionDate: in.Date, Description: in.Description,
	}, nil)
	if err != nil {
		return execError(err)
	}
	to := ""
	if tx.CounterAccountName != nil {
		to = *tx.CounterAccountName
	}
	res := JSONResult(map[string]any{
		"done": true, "transaction_uuid": tx.UUID.String(), "amount": FormatMoney(tx.Amount, tx.Currency),
		"from_account": tx.AccountName, "to_account": to,
	}, "ai.tool_summary.transfer_recorded", map[string]any{"amount": FormatMoney(tx.Amount, tx.Currency)})
	res.Link = &Link{Kind: "finance_account", UUID: fromID.String()}
	return res, nil
}
