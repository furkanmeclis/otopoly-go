package tools

import (
	"context"
	"encoding/json"
	"math/big"
	"strings"

	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// ---------------------------------------------------------------- categories (read)

// ListFinanceCategories lists income / expense categories.
type ListFinanceCategories struct{ finance FinanceWriter }

var financeCategoriesSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"type":             map[string]any{"type": "string", "enum": []string{"income", "expense"}, "description": "Only income or only expense categories (default both)."},
		"include_inactive": map[string]any{"type": "boolean", "description": "Also list passive categories (default false)."},
	},
	"additionalProperties": false,
}

// Spec implements Tool.
func (ListFinanceCategories) Spec() Spec {
	return Spec{
		Name: "list_finance_categories",
		Description: "List the finance categories (gelir/gider kategorileri) with their type and whether they are system categories that a module books into automatically " +
			"(Hizmet Geliri = job payments, Ürün Satışı = product sales, Cari Tahsilat = cari collections, Stok Alımı = purchases). Use the names with record_finance_entry.",
		InputSchema: financeCategoriesSchema,
		Permissions: []string{rbac.PermTenantFinanceRead},
		Feature:     FeatureChat,
		Kind:        KindRead,
	}
}

func systemCategory(name, kind string) (financeusecase.SystemCategory, bool) {
	for _, c := range financeusecase.SystemCategories() {
		if c.Kind == kind && strings.EqualFold(c.Name, name) {
			return c, true
		}
	}
	return financeusecase.SystemCategory{}, false
}

// Run implements Tool.
func (t ListFinanceCategories) Run(ctx context.Context, _ Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Type            string `json:"type"`
		IncludeInactive bool   `json:"include_inactive"`
	}
	if err := Decode(financeCategoriesSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	var active *bool
	if !in.IncludeInactive {
		v := true
		active = &v
	}
	cats, err := t.finance.ListCategories(ctx, in.Type, active)
	if err != nil {
		return userError(err)
	}
	type item struct {
		UUID       string `json:"uuid"`
		Name       string `json:"name"`
		Type       string `json:"type"`
		Active     bool   `json:"active"`
		System     bool   `json:"system"`
		AutoSource string `json:"auto_source,omitempty"`
	}
	items := make([]item, 0, len(cats))
	for _, c := range cats {
		it := item{UUID: c.UUID.String(), Name: DataText(c.Name, maxNameChars), Type: c.Kind, Active: c.IsActive}
		if sc, ok := systemCategory(c.Name, c.Kind); ok {
			it.System, it.AutoSource = true, sc.AutoSource
		}
		items = append(items, it)
	}
	return JSONResult(map[string]any{
		"categories": items,
		"note":       "auto_source categories are filled by their module (service_job, product_sale, cari_payment, purchase); to collect a job use record_job_payment, a cari balance record_cari_payment.",
	}, "ai.tool_summary.categories_found", map[string]any{"count": len(items)}), nil
}

// ---------------------------------------------------------------- void entry

// VoidFinanceEntry voids (reverses) a manual finance entry or cari entry.
type VoidFinanceEntry struct {
	finance FinanceWriter
	cari    CariWriter
}

var voidEntrySchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"transaction_uuid": map[string]any{"type": "string", "format": "uuid", "description": "Finance transaction uuid (transaction_uuid from record_finance_entry / create_finance_transfer, finance_transaction_uuid from record_cari_payment)."},
		"cari_entry_uuid":  map[string]any{"type": "string", "format": "uuid", "description": "Cari ledger entry uuid (entry_uuid from record_cari_payment / record_cari_charge)."},
	},
	"additionalProperties": false,
}

type voidEntryInput struct {
	TransactionUUID string `json:"transaction_uuid,omitempty"`
	CariEntryUUID   string `json:"cari_entry_uuid,omitempty"`
}

// Spec implements Tool.
func (VoidFinanceEntry) Spec() Spec {
	return Spec{
		Name: "void_finance_entry",
		Description: "Propose voiding (iptal/ters kayıt) a wrong manual entry: an income, expense or transfer on a cash/bank account, or a cari charge/collection. " +
			"The balances are reversed. Entries created by a document are refused: a job payment is undone with cancel_job, a product sale or purchase in the panel. " +
			"Shows a confirmation card.",
		InputSchema:          voidEntrySchema,
		Permissions:          []string{rbac.PermTenantFinanceWrite, rbac.PermTenantFinanceRead},
		OrgRoles:             []string{"owner"},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

func sourceRefusal(sourceType string, detail *financeusecase.SourceDetail) error {
	switch sourceType {
	case financeusecase.SourceServiceJob:
		if detail != nil {
			return inputErr("this entry is the payment of job %s (%s); undo it with cancel_job job_uuid=%s, not by voiding the entry", detail.Plate, detail.Title, detail.UUID)
		}
		return inputErr("this entry is a job payment; undo it with cancel_job, not by voiding the entry")
	case financeusecase.SourceProductSale:
		return inputErr("this entry belongs to a product sale; cancel the sale in Satışlar instead")
	case financeusecase.SourcePurchase:
		return inputErr("this entry belongs to a stock purchase; cancel the purchase in Alımlar instead")
	}
	return inputErr("this entry was created by %s; change that record instead", sourceType)
}

// voidPlan is what void_finance_entry will reverse.
type voidPlan struct {
	tx       *financeusecase.Transaction // finance path
	cari     *cariusecase.EntryInfo      // cari path (cari entry or the collection behind a cari_payment transaction)
	accounts []financeusecase.Account
}

func (t VoidFinanceEntry) plan(ctx context.Context, env Env, in voidEntryInput) (voidPlan, error) {
	var p voidPlan
	txID, txErr := uuid.Parse(strings.TrimSpace(in.TransactionUUID))
	ceID, ceErr := uuid.Parse(strings.TrimSpace(in.CariEntryUUID))
	if (txErr == nil) == (ceErr == nil) {
		return p, inputErr("pass exactly one of transaction_uuid or cari_entry_uuid")
	}
	needCari := func() error {
		if t.cari == nil || !env.Principal.HasPermission(rbac.PermTenantCariWrite) {
			return inputErr("voiding a cari entry needs the cari write permission")
		}
		return nil
	}
	if txErr == nil {
		tx, err := t.finance.GetTransaction(ctx, txID)
		if err != nil {
			return p, proposalError(err)
		}
		if tx.Status == "void" {
			return p, inputErr("transaction %s is already void", tx.UUID)
		}
		if !financeusecase.IsManualSource(tx.SourceType) {
			if *tx.SourceType == financeusecase.SourceCariPayment && tx.SourceUUID != nil {
				if err := needCari(); err != nil {
					return p, err
				}
				ceID = *tx.SourceUUID
			} else {
				return p, sourceRefusal(*tx.SourceType, tx.SourceDetail)
			}
		} else {
			p.tx = &tx
		}
	}
	if p.tx == nil {
		if err := needCari(); err != nil {
			return p, err
		}
		e, err := t.cari.GetEntry(ctx, ceID)
		if err != nil {
			return p, proposalError(err)
		}
		if e.Status == "void" {
			return p, inputErr("cari entry %s is already void", e.UUID)
		}
		if e.SourceType != "" {
			return p, sourceRefusal(e.SourceType, nil)
		}
		p.cari = &e
	}
	accs, err := activeAccounts(ctx, t.finance)
	if err != nil {
		return p, err
	}
	p.accounts = accs
	return p, nil
}

func findAccount(accs []financeusecase.Account, id uuid.UUID) (financeusecase.Account, bool) {
	for _, a := range accs {
		if a.UUID == id {
			return a, true
		}
	}
	return financeusecase.Account{}, false
}

// Propose implements ActionTool.
func (t VoidFinanceEntry) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in voidEntryInput
	if err := decodeInput(voidEntrySchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	p, err := t.plan(ctx, env, in)
	if err != nil {
		return Proposal{}, err
	}
	var fields []Field
	var warnings []string
	var norm voidEntryInput
	var title, amount string
	if p.tx != nil {
		tx := *p.tx
		norm.TransactionUUID = tx.UUID.String()
		title, amount = tx.AccountName, FormatMoney(tx.Amount, tx.Currency)
		fields = append(fields, Field{Key: "entry_type", ValueKey: "ai.confirm.values." + tx.Type})
		if tx.CategoryName != nil {
			fields = append(fields, Field{Key: "category", Value: *tx.CategoryName})
		}
		fields = append(fields, Field{Key: "finance_account", Value: tx.AccountName}, Field{Key: "date", Value: tx.TransactionDate})
		fields = append(fields, descriptionField(tx.Description)...)
		if a, ok := findAccount(p.accounts, tx.AccountUUID); ok {
			delta := ratOf(tx.Amount)
			if tx.Type == "income" || tx.Type == "transfer" {
				delta.Neg(delta)
			}
			after := balanceAfter(a.CurrentBalance, delta)
			fields = append(fields, Field{Key: "account_balance_after", Value: FormatMoney(after, a.Currency)})
			if ratOf(after).Sign() < 0 {
				warnings = append(warnings, "negative_balance")
			}
		}
	} else {
		e := *p.cari
		norm.CariEntryUUID = e.UUID.String()
		title, amount = e.CustomerName, FormatMoney(e.Amount, "TRY")
		fields = append(fields,
			Field{Key: "customer", Value: e.CustomerName},
			Field{Key: "entry_type", ValueKey: "ai.confirm.values.cari_" + e.Type},
			Field{Key: "date", Value: e.EntryDate})
		fields = append(fields, descriptionField(e.Description)...)
		if e.FinanceAccountName != nil {
			fields = append(fields, Field{Key: "finance_account", Value: *e.FinanceAccountName})
		}
		if acc, err := t.cari.Get(ctx, e.AccountUUID); err == nil {
			amount = FormatMoney(e.Amount, acc.Currency)
			fields = append(fields, Field{Key: "balance_before", Value: FormatMoney(acc.Balance, acc.Currency)})
			// A voided collection puts the amount back on the balance; a voided
			// charge takes it off (adjustments depend on their direction).
			if e.Type == "payment" || e.Type == "charge" || e.Type == "opening" {
				delta := ratOf(e.Amount)
				if e.Type != "payment" {
					delta.Neg(delta)
				}
				fields = append(fields, Field{Key: "balance_after", Value: FormatMoney(balanceAfter(acc.Balance, delta), acc.Currency)})
			}
		}
	}
	return Proposal{
		Input:   mustJSON(norm),
		Preview: Preview{Action: "void_finance_entry", Title: title, Amount: amount, Fields: fields, Warnings: warnings},
	}, nil
}

// Run implements Tool.
func (t VoidFinanceEntry) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in voidEntryInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	p, err := t.plan(ctx, env, in)
	if err != nil {
		if ie, ok := AsInputError(err); ok {
			return ErrorResult("Not executed: " + ie.Msg), nil
		}
		return Result{}, err
	}
	out := map[string]any{"done": true}
	if p.tx != nil {
		tx, err := t.finance.VoidTransaction(ctx, env.Principal.UserInternal, p.tx.UUID, nil)
		if err != nil {
			return execError(err)
		}
		out["transaction_uuid"], out["status"], out["type"] = tx.UUID.String(), tx.Status, p.tx.Type
		out["reversed_amount"] = FormatMoney(p.tx.Amount, p.tx.Currency)
		balances := map[string]string{}
		if accs, err := activeAccounts(ctx, t.finance); err == nil {
			for _, id := range []*uuid.UUID{&p.tx.AccountUUID, p.tx.CounterAccountUUID} {
				if id == nil {
					continue
				}
				if a, ok := findAccount(accs, *id); ok {
					balances[a.Name] = FormatMoney(a.CurrentBalance, a.Currency)
				}
			}
		}
		out["account_balances"] = balances
		res := JSONResult(out, "ai.tool_summary.entry_voided", map[string]any{"amount": FormatMoney(p.tx.Amount, p.tx.Currency)})
		res.Link = &Link{Kind: "finance_account", UUID: p.tx.AccountUUID.String()}
		return res, nil
	}
	e, err := t.cari.VoidEntry(ctx, p.cari.UUID)
	if err != nil {
		return execError(err)
	}
	out["cari_entry_uuid"], out["status"], out["type"] = e.UUID.String(), e.Status, p.cari.Type
	cur := "TRY"
	if acc, err := t.cari.Get(ctx, p.cari.AccountUUID); err == nil {
		cur = acc.Currency
		out["cari_balance"] = FormatMoney(acc.Balance, acc.Currency)
	}
	out["reversed_amount"] = FormatMoney(p.cari.Amount, cur)
	if p.cari.FinanceTransactionUUID != nil {
		out["voided_finance_transaction_uuid"] = p.cari.FinanceTransactionUUID.String()
		if p.cari.FinanceAccountUUID != nil {
			if accs, err := activeAccounts(ctx, t.finance); err == nil {
				if a, ok := findAccount(accs, *p.cari.FinanceAccountUUID); ok {
					out["account_balances"] = map[string]string{a.Name: FormatMoney(a.CurrentBalance, a.Currency)}
				}
			}
		}
	}
	res := JSONResult(out, "ai.tool_summary.entry_voided", map[string]any{"amount": FormatMoney(p.cari.Amount, cur)})
	res.Link = &Link{Kind: "cari", UUID: p.cari.AccountUUID.String()}
	return res, nil
}

// ---------------------------------------------------------------- update entry

// UpdateFinanceEntry corrects a manual income or expense in place.
type UpdateFinanceEntry struct{ finance FinanceWriter }

var updateEntrySchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"transaction_uuid": map[string]any{"type": "string", "format": "uuid", "description": "transaction_uuid from record_finance_entry."},
		"category":         map[string]any{"type": "string", "maxLength": 100, "description": "New category name or uuid (same type; see list_finance_categories)."},
		"finance_account":  map[string]any{"type": "string", "maxLength": 100, "description": "Move the entry to this cash/bank account (same currency)."},
		"amount":           map[string]any{"type": "number", "minimum": 0.01, "description": "Corrected amount."},
		"date":             map[string]any{"type": "string", "format": "date"},
		"description":      map[string]any{"type": "string", "maxLength": 300},
	},
	"required":             []string{"transaction_uuid"},
	"additionalProperties": false,
}

type updateEntryInput struct {
	TransactionUUID string   `json:"transaction_uuid"`
	Category        string   `json:"category,omitempty"`
	FinanceAccount  string   `json:"finance_account,omitempty"`
	Amount          *float64 `json:"amount,omitempty"`
	Date            string   `json:"date,omitempty"`
	Description     *string  `json:"description,omitempty"`
}

// Spec implements Tool.
func (UpdateFinanceEntry) Spec() Spec {
	return Spec{
		Name: "update_finance_entry",
		Description: "Propose correcting a manual income/expense entry (category, account, amount, date or description). Account balances are moved accordingly. " +
			"Entries created by jobs, sales, purchases or cari collections and transfers cannot be changed (void them or cancel the source). Shows a confirmation card.",
		InputSchema:          updateEntrySchema,
		Permissions:          []string{rbac.PermTenantFinanceWrite, rbac.PermTenantFinanceRead},
		OrgRoles:             []string{"owner"},
		Feature:              FeatureActions,
		Kind:                 KindWrite,
		RequiresConfirmation: true,
	}
}

type updatePlan struct {
	tx       financeusecase.Transaction
	upd      financeusecase.UpdateTransactionInput
	from, to financeusecase.Account
	category string
	amount   string
	fields   []Field
	warnings []string
}

func (t UpdateFinanceEntry) plan(ctx context.Context, env Env, in *updateEntryInput) (updatePlan, error) {
	var p updatePlan
	id, _ := uuid.Parse(in.TransactionUUID)
	tx, err := t.finance.GetTransaction(ctx, id)
	if err != nil {
		return p, proposalError(err)
	}
	p.tx = tx
	switch {
	case tx.Status != "posted":
		return p, inputErr("transaction %s is %s and cannot be changed", tx.UUID, tx.Status)
	case !financeusecase.IsManualSource(tx.SourceType):
		if *tx.SourceType == financeusecase.SourceCariPayment {
			return p, inputErr("this entry is a cari collection; void it (void_finance_entry) and record it again with record_cari_payment")
		}
		return p, sourceRefusal(*tx.SourceType, tx.SourceDetail)
	case tx.Type != "income" && tx.Type != "expense":
		return p, inputErr("transfers cannot be changed; void it (void_finance_entry) and create a new one")
	}
	accounts, err := activeAccounts(ctx, t.finance)
	if err != nil {
		return p, err
	}
	from, ok := findAccount(accounts, tx.AccountUUID)
	if !ok {
		return p, inputErr("the entry's account is not active any more")
	}
	p.from, p.to = from, from
	changed := false
	if strings.TrimSpace(in.FinanceAccount) != "" {
		to, err := resolveAccount(accounts, in.FinanceAccount, tx.Currency, "", "finance_account")
		if err != nil {
			return p, err
		}
		p.to = to
		in.FinanceAccount = to.UUID.String()
		if to.UUID != from.UUID {
			p.upd.AccountUUID = &to.UUID
			changed = true
		}
	}
	active := true
	cats, err := t.finance.ListCategories(ctx, tx.Type, &active)
	if err != nil {
		return p, err
	}
	p.category = ""
	if tx.CategoryName != nil {
		p.category = *tx.CategoryName
	}
	if strings.TrimSpace(in.Category) != "" {
		cat, err := resolveCategory(cats, in.Category)
		if err != nil {
			return p, err
		}
		in.Category = cat.UUID.String()
		if tx.CategoryUUID == nil || *tx.CategoryUUID != cat.UUID {
			p.upd.CategoryUUID = &cat.UUID
			p.category = cat.Name
			changed = true
		}
	}
	p.amount = tx.Amount
	if in.Amount != nil {
		a, err := ParseAmount(*in.Amount)
		if err != nil {
			return p, err
		}
		v := a.Float()
		in.Amount = &v
		if ratOf(a.String()).Cmp(ratOf(tx.Amount)) != 0 {
			s := a.String()
			p.upd.Amount, p.amount = &s, s
			changed = true
		}
	}
	if strings.TrimSpace(in.Date) != "" {
		d, err := dateOrToday(env, in.Date)
		if err != nil {
			return p, err
		}
		in.Date = d
		if d != tx.TransactionDate {
			p.upd.TransactionDate = &d
			changed = true
		}
	}
	if in.Description != nil {
		d := trimmed(*in.Description, 300)
		in.Description = &d
		if d != tx.Description {
			p.upd.Description = &d
			changed = true
		}
	}
	if !changed {
		return p, inputErr("nothing to change: pass category, finance_account, amount, date or description with a new value")
	}
	sign := func(v string) *big.Rat {
		r := ratOf(v)
		if tx.Type == "expense" {
			r.Neg(r)
		}
		return r
	}
	fromAfter := balanceAfter(from.CurrentBalance, new(big.Rat).Neg(sign(tx.Amount)))
	if p.to.UUID == from.UUID {
		fromAfter = balanceAfter(fromAfter, sign(p.amount))
	}
	p.fields = []Field{
		{Key: "entry_type", ValueKey: "ai.confirm.values." + tx.Type},
		{Key: "category", Value: changeText(firstNonBlank(derefStr(tx.CategoryName), "—"), p.category)},
		{Key: "finance_account", Value: changeText(from.Name, p.to.Name)},
		{Key: "amount", Value: changeText(FormatMoney(tx.Amount, tx.Currency), FormatMoney(p.amount, tx.Currency))},
		{Key: "date", Value: changeText(tx.TransactionDate, firstNonBlank(derefStr(p.upd.TransactionDate), tx.TransactionDate))},
		{Key: "from_balance_after", Value: FormatMoney(fromAfter, from.Currency)},
	}
	if p.to.UUID != from.UUID {
		p.fields = append(p.fields, Field{Key: "to_balance_after", Value: FormatMoney(balanceAfter(p.to.CurrentBalance, sign(p.amount)), p.to.Currency)})
	}
	if p.upd.Description != nil {
		p.fields = append(p.fields, Field{Key: "description", Value: *p.upd.Description})
	}
	if ratOf(fromAfter).Sign() < 0 {
		p.warnings = append(p.warnings, "negative_balance")
	}
	return p, nil
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func changeText(from, to string) string {
	if from == to {
		return to
	}
	return from + " → " + to
}

// Propose implements ActionTool.
func (t UpdateFinanceEntry) Propose(ctx context.Context, env Env, raw json.RawMessage) (Proposal, error) {
	var in updateEntryInput
	if err := decodeInput(updateEntrySchema, raw, &in); err != nil {
		return Proposal{}, err
	}
	p, err := t.plan(ctx, env, &in)
	if err != nil {
		return Proposal{}, err
	}
	return Proposal{
		Input: mustJSON(in),
		Preview: Preview{
			Action: "update_finance_entry", Title: firstNonBlank(p.category, p.tx.AccountName), Amount: FormatMoney(p.amount, p.tx.Currency),
			Fields: p.fields, Warnings: p.warnings,
		},
	}, nil
}

// Run implements Tool.
func (t UpdateFinanceEntry) Run(ctx context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in updateEntryInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ErrorResult("invalid stored input"), nil
	}
	p, err := t.plan(ctx, env, &in)
	if err != nil {
		if ie, ok := AsInputError(err); ok {
			return ErrorResult("Not executed: " + ie.Msg), nil
		}
		return Result{}, err
	}
	tx, err := t.finance.UpdateTransaction(ctx, env.Principal.UserInternal, p.tx.UUID, p.upd, nil)
	if err != nil {
		return execError(err)
	}
	out := map[string]any{
		"done": true, "transaction_uuid": tx.UUID.String(), "type": tx.Type, "amount": FormatMoney(tx.Amount, tx.Currency),
		"finance_account": tx.AccountName, "date": tx.TransactionDate,
	}
	if tx.CategoryName != nil {
		out["category"] = *tx.CategoryName
	}
	balances := map[string]string{}
	if accs, err := activeAccounts(ctx, t.finance); err == nil {
		for _, id := range []uuid.UUID{p.from.UUID, p.to.UUID} {
			if a, ok := findAccount(accs, id); ok {
				balances[a.Name] = FormatMoney(a.CurrentBalance, a.Currency)
			}
		}
	}
	out["account_balances"] = balances
	res := JSONResult(out, "ai.tool_summary.entry_updated", map[string]any{"amount": FormatMoney(tx.Amount, tx.Currency)})
	res.Link = &Link{Kind: "finance_account", UUID: tx.AccountUUID.String()}
	return res, nil
}
