package adapters

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	ResourceFinanceAccounts     = "tenant.finance.accounts"
	ResourceFinanceCategories   = "tenant.finance.categories"
	ResourceFinanceTransactions = "tenant.finance.transactions"
)

// FinanceAccountsAdapter exports and imports organization cash accounts.
type FinanceAccountsAdapter struct {
	q *db.Queries
}

func NewFinanceAccounts(q *db.Queries) *FinanceAccountsAdapter {
	return &FinanceAccountsAdapter{q: q}
}

func (a *FinanceAccountsAdapter) Resource() string { return ResourceFinanceAccounts }

func (a *FinanceAccountsAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "name", LabelKey: "finance.accounts.name", Type: ioengine.ColumnTypeString},
		{Key: "type", LabelKey: "finance.accounts.type", Type: ioengine.ColumnTypeEnum},
		{Key: "currency", LabelKey: "finance.accounts.currency", Type: ioengine.ColumnTypeString},
		{Key: "opening_balance", LabelKey: "finance.accounts.opening_balance", Type: ioengine.ColumnTypeString},
		{Key: "current_balance", LabelKey: "finance.accounts.current_balance", Type: ioengine.ColumnTypeString},
		{Key: "is_default", LabelKey: "finance.accounts.is_default", Type: ioengine.ColumnTypeBoolean},
		{Key: "is_active", LabelKey: "finance.accounts.is_active", Type: ioengine.ColumnTypeBoolean},
		{Key: "bank_name", LabelKey: "finance.accounts.bank_name", Type: ioengine.ColumnTypeString},
		{Key: "iban", LabelKey: "finance.accounts.iban", Type: ioengine.ColumnTypeString},
		{Key: "notes", LabelKey: "finance.accounts.notes", Type: ioengine.ColumnTypeString},
	}
}

func (a *FinanceAccountsAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	rows, err := a.q.ListFinanceAccountsForExport(ctx, db.ListFinanceAccountsForExportParams{
		OrganizationID: orgID,
		IsActive:       boolArg(query["is_active"]),
		Type:           textArg(query["type"]),
		Currency:       textArg(query["currency"]),
		Q:              textArg(query["q"]),
	})
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		var bank any
		if row.BankName.Valid {
			bank = row.BankName.String
		}
		var iban any
		if row.Iban.Valid {
			iban = row.Iban.String
		}
		out = append(out, map[string]any{
			"name":            row.Name,
			"type":            row.Type,
			"currency":        row.Currency,
			"opening_balance": formatNumeric(row.OpeningBalance),
			"current_balance": formatNumeric(row.CurrentBalance),
			"is_default":      row.IsDefault,
			"is_active":       row.IsActive,
			"bank_name":       bank,
			"iban":            iban,
			"notes":           row.Notes,
		})
	}
	return ioengine.Dataset{Resource: ResourceFinanceAccounts, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *FinanceAccountsAdapter) ImportSchema() []ioengine.ImportField {
	return []ioengine.ImportField{
		{Key: "name", LabelKey: "finance.accounts.name", Type: ioengine.ColumnTypeString, Required: true},
		{Key: "type", LabelKey: "finance.accounts.type", Type: ioengine.ColumnTypeEnum, Required: true},
		{Key: "currency", LabelKey: "finance.accounts.currency", Type: ioengine.ColumnTypeString, DefaultHint: "TRY"},
		{Key: "opening_balance", LabelKey: "finance.accounts.opening_balance", Type: ioengine.ColumnTypeString},
		{Key: "is_default", LabelKey: "finance.accounts.is_default", Type: ioengine.ColumnTypeBoolean},
		{Key: "is_active", LabelKey: "finance.accounts.is_active", Type: ioengine.ColumnTypeBoolean},
		{Key: "bank_name", LabelKey: "finance.accounts.bank_name", Type: ioengine.ColumnTypeString},
		{Key: "iban", LabelKey: "finance.accounts.iban", Type: ioengine.ColumnTypeString},
		{Key: "notes", LabelKey: "finance.accounts.notes", Type: ioengine.ColumnTypeString},
	}
}

func (a *FinanceAccountsAdapter) ApplyRow(ctx context.Context, row map[string]any, defaults map[string]any) (ioengine.RowResult, error) {
	orgID, err := organizationIDFromApply(ctx)
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	name := firstMapped(row, defaults, "name")
	acctType := strings.ToLower(firstMapped(row, defaults, "type"))
	if name == "" || (acctType != "cash" && acctType != "bank") {
		return ioengine.RowResult{OK: false, Error: "name and type (cash|bank) required"}, nil
	}
	_, err = a.q.GetFinanceAccountByName(ctx, db.GetFinanceAccountByNameParams{
		OrganizationID: orgID, Name: name,
	})
	if err == nil {
		return ioengine.RowResult{OK: false, Error: "account already exists"}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ioengine.RowResult{}, err
	}
	currency := strings.ToUpper(firstMapped(row, defaults, "currency"))
	if currency == "" {
		currency = "TRY"
	}
	if len(currency) != 3 {
		return ioengine.RowResult{OK: false, Error: "currency must be 3 letters"}, nil
	}
	opening, err := parseOpeningBalance(firstMapped(row, defaults, "opening_balance"))
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	isDefault := parseBoolDefault(firstMapped(row, defaults, "is_default"), false)
	isActive := parseBoolDefault(firstMapped(row, defaults, "is_active"), true)
	if isDefault {
		if err := a.q.ClearFinanceAccountDefault(ctx, orgID); err != nil {
			return ioengine.RowResult{}, err
		}
	}
	created, err := a.q.CreateFinanceAccount(ctx, db.CreateFinanceAccountParams{
		OrganizationID: orgID,
		Name:           name,
		Type:           acctType,
		Currency:       currency,
		OpeningBalance: opening,
		IsDefault:      isDefault,
		IsActive:       isActive,
		BankName:       optionalText(firstMapped(row, defaults, "bank_name")),
		Iban:           optionalText(strings.ToUpper(firstMapped(row, defaults, "iban"))),
		Notes:          firstMapped(row, defaults, "notes"),
	})
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	return ioengine.RowResult{
		OK: true, EntityType: "finance_account", EntityUUID: created.Uuid.String(), Op: "create",
	}, nil
}

func (a *FinanceAccountsAdapter) RevertRow(ctx context.Context, entityType, entityUUID string, _ map[string]any) error {
	if entityType != "finance_account" {
		return fmt.Errorf("unsupported entity")
	}
	orgID, err := organizationIDFromApply(ctx)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(entityUUID)
	if err != nil {
		return err
	}
	_, err = a.q.SoftDeleteFinanceAccount(ctx, db.SoftDeleteFinanceAccountParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}

// FinanceCategoriesAdapter exports and imports organization categories.
type FinanceCategoriesAdapter struct {
	q *db.Queries
}

func NewFinanceCategories(q *db.Queries) *FinanceCategoriesAdapter {
	return &FinanceCategoriesAdapter{q: q}
}

func (a *FinanceCategoriesAdapter) Resource() string { return ResourceFinanceCategories }

func (a *FinanceCategoriesAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "name", LabelKey: "finance.categories.name", Type: ioengine.ColumnTypeString},
		{Key: "kind", LabelKey: "finance.categories.kind", Type: ioengine.ColumnTypeEnum},
		{Key: "sort_order", LabelKey: "finance.categories.sort_order", Type: ioengine.ColumnTypeString},
		{Key: "is_active", LabelKey: "finance.categories.is_active", Type: ioengine.ColumnTypeBoolean},
	}
}

func (a *FinanceCategoriesAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	rows, err := a.q.ListFinanceCategories(ctx, db.ListFinanceCategoriesParams{
		OrganizationID: orgID,
		Kind:           textArg(query["kind"]),
		IsActive:       boolArg(query["is_active"]),
	})
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, map[string]any{
			"name":       row.Name,
			"kind":       row.Kind,
			"sort_order": row.SortOrder,
			"is_active":  row.IsActive,
		})
	}
	return ioengine.Dataset{Resource: ResourceFinanceCategories, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *FinanceCategoriesAdapter) ImportSchema() []ioengine.ImportField {
	return []ioengine.ImportField{
		{Key: "name", LabelKey: "finance.categories.name", Type: ioengine.ColumnTypeString, Required: true},
		{Key: "kind", LabelKey: "finance.categories.kind", Type: ioengine.ColumnTypeEnum, Required: true},
		{Key: "sort_order", LabelKey: "finance.categories.sort_order", Type: ioengine.ColumnTypeString},
		{Key: "is_active", LabelKey: "finance.categories.is_active", Type: ioengine.ColumnTypeBoolean},
	}
}

func (a *FinanceCategoriesAdapter) ApplyRow(ctx context.Context, row map[string]any, defaults map[string]any) (ioengine.RowResult, error) {
	orgID, err := organizationIDFromApply(ctx)
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	name := firstMapped(row, defaults, "name")
	kind := strings.ToLower(firstMapped(row, defaults, "kind"))
	if name == "" || (kind != "income" && kind != "expense") {
		return ioengine.RowResult{OK: false, Error: "name and kind (income|expense) required"}, nil
	}
	_, err = a.q.GetFinanceCategoryByName(ctx, db.GetFinanceCategoryByNameParams{
		OrganizationID: orgID, Name: name, Kind: kind,
	})
	if err == nil {
		return ioengine.RowResult{OK: false, Error: "category already exists"}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ioengine.RowResult{}, err
	}
	sortOrder := parseInt32Default(firstMapped(row, defaults, "sort_order"), 0)
	created, err := a.q.CreateFinanceCategory(ctx, db.CreateFinanceCategoryParams{
		OrganizationID: orgID,
		ParentID:       pgtype.Int8{},
		Name:           name,
		Kind:           kind,
		SortOrder:      sortOrder,
		IsActive:       parseBoolDefault(firstMapped(row, defaults, "is_active"), true),
	})
	if err != nil {
		return ioengine.RowResult{OK: false, Error: err.Error()}, nil
	}
	return ioengine.RowResult{
		OK: true, EntityType: "finance_category", EntityUUID: created.Uuid.String(), Op: "create",
	}, nil
}

func (a *FinanceCategoriesAdapter) RevertRow(ctx context.Context, entityType, entityUUID string, _ map[string]any) error {
	if entityType != "finance_category" {
		return fmt.Errorf("unsupported entity")
	}
	orgID, err := organizationIDFromApply(ctx)
	if err != nil {
		return err
	}
	id, err := uuid.Parse(entityUUID)
	if err != nil {
		return err
	}
	_, err = a.q.SoftDeleteFinanceCategory(ctx, db.SoftDeleteFinanceCategoryParams{
		Uuid: id, OrganizationID: orgID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}

// FinanceTransactionsAdapter exports organization ledger rows.
type FinanceTransactionsAdapter struct {
	q *db.Queries
}

func NewFinanceTransactions(q *db.Queries) *FinanceTransactionsAdapter {
	return &FinanceTransactionsAdapter{q: q}
}

func (a *FinanceTransactionsAdapter) Resource() string { return ResourceFinanceTransactions }

func (a *FinanceTransactionsAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "transaction_date", LabelKey: "finance.transactions.date", Type: ioengine.ColumnTypeString},
		{Key: "type", LabelKey: "finance.transactions.type", Type: ioengine.ColumnTypeEnum},
		{Key: "amount", LabelKey: "finance.transactions.amount", Type: ioengine.ColumnTypeString},
		{Key: "currency", LabelKey: "finance.transactions.currency", Type: ioengine.ColumnTypeString},
		{Key: "account_name", LabelKey: "finance.transactions.account", Type: ioengine.ColumnTypeString},
		{Key: "category_name", LabelKey: "finance.transactions.category", Type: ioengine.ColumnTypeString},
		{Key: "status", LabelKey: "finance.transactions.status", Type: ioengine.ColumnTypeEnum},
		{Key: "description", LabelKey: "finance.transactions.description", Type: ioengine.ColumnTypeString},
		{Key: "reference_no", LabelKey: "finance.transactions.reference", Type: ioengine.ColumnTypeString},
	}
}

func (a *FinanceTransactionsAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	rows, err := a.q.ListFinanceTransactionsForExport(ctx, db.ListFinanceTransactionsForExportParams{
		OrganizationID: orgID,
		Type:           textArg(query["type"]),
		Status:         textArg(query["status"]),
		AccountUuid:    uuidArg(query["account_uuid"]),
		CategoryUuid:   uuidArg(query["category_uuid"]),
		Currency:       textArg(query["currency"]),
		DateFrom:       dateArg(query["date_from"]),
		DateTo:         dateArg(query["date_to"]),
		Q:              textArg(query["q"]),
	})
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		var category any
		if row.CategoryName.Valid {
			category = row.CategoryName.String
		}
		var ref any
		if row.ReferenceNo.Valid {
			ref = row.ReferenceNo.String
		}
		out = append(out, map[string]any{
			"transaction_date": formatDate(row.TransactionDate),
			"type":             row.Type,
			"amount":           formatNumeric(row.Amount),
			"currency":         row.Currency,
			"account_name":     row.AccountName,
			"category_name":    category,
			"status":           row.Status,
			"description":      row.Description,
			"reference_no":     ref,
		})
	}
	return ioengine.Dataset{Resource: ResourceFinanceTransactions, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *FinanceTransactionsAdapter) ImportSchema() []ioengine.ImportField { return nil }

func (a *FinanceTransactionsAdapter) ApplyRow(_ context.Context, _ map[string]any, _ map[string]any) (ioengine.RowResult, error) {
	return ioengine.RowResult{OK: false, Error: "import not supported"}, nil
}

func (a *FinanceTransactionsAdapter) RevertRow(_ context.Context, _, _ string, _ map[string]any) error {
	return fmt.Errorf("import not supported")
}

func requireOrganizationID(ctx context.Context, query ioengine.ExportQuery) (int64, error) {
	if scope, ok := orgctx.ScopeFrom(ctx); ok && scope.InternalID > 0 {
		return scope.InternalID, nil
	}
	raw := strings.TrimSpace(query[ioengine.QueryOrganizationID])
	if raw == "" {
		return 0, fmt.Errorf("organization context required")
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("organization context required")
	}
	return id, nil
}

func organizationIDFromApply(ctx context.Context) (int64, error) {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || scope.InternalID <= 0 {
		return 0, fmt.Errorf("organization context required")
	}
	return scope.InternalID, nil
}

func firstMapped(row, defaults map[string]any, key string) string {
	if v := strVal(row, key); v != "" {
		return v
	}
	return strVal(defaults, key)
}

func optionalText(s string) pgtype.Text {
	s = strings.TrimSpace(s)
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func parseOpeningBalance(raw string) (pgtype.Numeric, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		var zero pgtype.Numeric
		_ = zero.Scan("0")
		return zero, nil
	}
	var n pgtype.Numeric
	if err := n.Scan(raw); err != nil {
		return pgtype.Numeric{}, fmt.Errorf("invalid opening_balance")
	}
	if n.Valid && n.Int != nil && n.Int.Sign() < 0 {
		return pgtype.Numeric{}, fmt.Errorf("opening_balance must not be negative")
	}
	return n, nil
}

func parseBoolDefault(raw string, def bool) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "true", "1", "yes", "evet":
		return true
	case "false", "0", "no", "hayir", "hayır":
		return false
	default:
		return def
	}
}

func parseInt32Default(raw string, def int32) int32 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return int32(n)
}

func boolArg(s string) pgtype.Bool {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "true", "1", "yes":
		return pgtype.Bool{Bool: true, Valid: true}
	case "false", "0", "no":
		return pgtype.Bool{Bool: false, Valid: true}
	default:
		return pgtype.Bool{}
	}
}

func uuidArg(s string) pgtype.UUID {
	s = strings.TrimSpace(s)
	if s == "" {
		return pgtype.UUID{}
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: id, Valid: true}
}

func dateArg(s string) pgtype.Date {
	s = strings.TrimSpace(s)
	if s == "" {
		return pgtype.Date{}
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return pgtype.Date{}
	}
	return pgtype.Date{Time: t, Valid: true}
}

func formatDate(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format("2006-01-02")
}

func formatNumeric(n pgtype.Numeric) string {
	if !n.Valid || n.Int == nil {
		return "0.00"
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return n.Int.String()
	}
	return strconv.FormatFloat(f.Float64, 'f', 2, 64)
}

var (
	_ ioengine.ResourceAdapter = (*FinanceAccountsAdapter)(nil)
	_ ioengine.ResourceAdapter = (*FinanceCategoriesAdapter)(nil)
	_ ioengine.ResourceAdapter = (*FinanceTransactionsAdapter)(nil)
)
