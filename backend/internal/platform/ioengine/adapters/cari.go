package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/i18n"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	ResourceCari        = "tenant.cari"
	ResourceCariEntries = "tenant.cari.entries"
)

// CariAccountsAdapter exports organization cari account balances.
type CariAccountsAdapter struct {
	q *db.Queries
}

func NewCariAccounts(q *db.Queries) *CariAccountsAdapter {
	return &CariAccountsAdapter{q: q}
}

func (a *CariAccountsAdapter) Resource() string { return ResourceCari }

func (a *CariAccountsAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "customer_name", LabelKey: "cari.customer_name", Type: ioengine.ColumnTypeString},
		{Key: "customer_phone", LabelKey: "cari.customer_phone", Type: ioengine.ColumnTypeString},
		{Key: "customer_kind", LabelKey: "cari.customer_kind", Type: ioengine.ColumnTypeString},
		{Key: "balance", LabelKey: "cari.balance", Type: ioengine.ColumnTypeString},
		{Key: "currency", LabelKey: "cari.currency", Type: ioengine.ColumnTypeString},
		{Key: "is_active", LabelKey: "common.status", Type: ioengine.ColumnTypeBoolean},
		{Key: "uuid", LabelKey: "cari.uuid", Type: ioengine.ColumnTypeString},
	}
}

func (a *CariAccountsAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	params := db.ListCariAccountsForExportParams{OrganizationID: orgID}
	if q := strings.TrimSpace(query["q"]); q != "" {
		params.Q = pgtype.Text{String: q, Valid: true}
	}
	if v := strings.TrimSpace(query["is_active"]); v != "" {
		params.IsActive = pgtype.Bool{Bool: v == "true", Valid: true}
	}
	if v := strings.TrimSpace(query["has_balance"]); v != "" {
		params.HasBalance = pgtype.Bool{Bool: v == "true", Valid: true}
	}
	rows, err := a.q.ListCariAccountsForExport(ctx, params)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, map[string]any{
			"customer_name":  row.CustomerName,
			"customer_phone": row.CustomerPhone,
			"customer_kind":  row.CustomerKind,
			"balance":        formatNumeric(row.Balance),
			"currency":       row.Currency,
			"is_active":      row.IsActive,
			"uuid":           row.Uuid.String(),
		})
	}
	return ioengine.Dataset{Resource: ResourceCari, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *CariAccountsAdapter) ImportSchema() []ioengine.ImportField { return nil }

func (a *CariAccountsAdapter) ApplyRow(_ context.Context, _ map[string]any, _ map[string]any) (ioengine.RowResult, error) {
	return ioengine.RowResult{}, fmt.Errorf("cari accounts import is not supported")
}

func (a *CariAccountsAdapter) RevertRow(_ context.Context, _, _ string, _ map[string]any) error {
	return fmt.Errorf("cari accounts import is not supported")
}

// CariEntriesAdapter exports a single account statement (account_uuid filter required).
type CariEntriesAdapter struct {
	q *db.Queries
}

func NewCariEntries(q *db.Queries) *CariEntriesAdapter {
	return &CariEntriesAdapter{q: q}
}

func (a *CariEntriesAdapter) Resource() string { return ResourceCariEntries }

func (a *CariEntriesAdapter) ExportColumns() []ioengine.Column {
	return []ioengine.Column{
		{Key: "entry_date", LabelKey: "cari.entry_date", Type: ioengine.ColumnTypeString, Weight: 0.9},
		{Key: "type", LabelKey: "cari.entry_type", Type: ioengine.ColumnTypeEnum, Weight: 0.9},
		{Key: "description", LabelKey: "cari.description", Type: ioengine.ColumnTypeString, Weight: 2.6},
		{Key: "debit", LabelKey: "cari.debit", Type: ioengine.ColumnTypeString, AlignRight: true, Weight: 1.1},
		{Key: "credit", LabelKey: "cari.credit", Type: ioengine.ColumnTypeString, AlignRight: true, Weight: 1.1},
		{Key: "balance_after", LabelKey: "cari.balance", Type: ioengine.ColumnTypeString, AlignRight: true, Weight: 1.2},
		{Key: "status", LabelKey: "cari.entry_status", Type: ioengine.ColumnTypeEnum, Weight: 0.8},
	}
}

// Export renders a chronological account statement: charges are debits
// (customer owes more), payments are credits; voided rows are listed but
// excluded from the totals.
func (a *CariEntriesAdapter) Export(ctx context.Context, query ioengine.ExportQuery, locale i18n.Locale) (ioengine.Dataset, error) {
	orgID, err := requireOrganizationID(ctx, query)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	accountUUIDRaw := strings.TrimSpace(query["account_uuid"])
	if accountUUIDRaw == "" {
		return ioengine.Dataset{}, fmt.Errorf("account_uuid is required")
	}
	accountUUID, err := uuid.Parse(accountUUIDRaw)
	if err != nil {
		return ioengine.Dataset{}, fmt.Errorf("invalid account_uuid")
	}
	account, err := a.q.GetCariAccountByUUID(ctx, db.GetCariAccountByUUIDParams{
		Uuid: accountUUID, OrganizationID: orgID,
	})
	if err != nil {
		return ioengine.Dataset{}, err
	}
	params := db.ListCariEntriesForExportParams{
		OrganizationID: orgID,
		AccountID:      account.ID,
	}
	if t := strings.TrimSpace(query["type"]); t != "" {
		params.Type = pgtype.Text{String: t, Valid: true}
	}
	if st := strings.TrimSpace(query["status"]); st != "" {
		params.Status = pgtype.Text{String: st, Valid: true}
	}
	rows, err := a.q.ListCariEntriesForExport(ctx, params)
	if err != nil {
		return ioengine.Dataset{}, err
	}
	loc := i18n.Normalize(string(locale))
	currency := account.Currency
	var totalDebit, totalCredit float64
	out := make([]map[string]any, 0, len(rows))
	stmt := &cariStatement{
		CustomerName:  strings.TrimSpace(account.CustomerName),
		CustomerPhone: strings.TrimSpace(account.CustomerPhone),
		TaxID:         strings.TrimSpace(account.CustomerTaxID),
		TaxOffice:     strings.TrimSpace(account.CustomerTaxOffice),
		Currency:      currency,
		Balance:       numericFloat(account.Balance),
	}
	for _, row := range rows {
		amount := numericFloat(row.Amount)
		debit, credit := "", ""
		isDebit := cariEntryIsDebit(row.Type, row.Metadata)
		if isDebit {
			debit = formatMoney(amount, currency, loc)
		} else {
			credit = formatMoney(amount, currency, loc)
		}
		if row.Status == "posted" {
			if isDebit {
				totalDebit += amount
			} else {
				totalCredit += amount
			}
		}
		date := ""
		if row.EntryDate.Valid {
			date = formatStatementDate(row.EntryDate.Time, loc)
		}
		entry := cariStatementEntry{
			Date: date, Type: row.Type, Description: cariEntryDescription(row, loc),
			Amount: amount, Debit: isDebit, Balance: numericFloat(row.BalanceAfter), Void: row.Status != "posted",
		}
		if row.EntryDate.Valid {
			entry.At = row.EntryDate.Time
		}
		stmt.Entries = append(stmt.Entries, entry)
		out = append(out, map[string]any{
			"entry_date":    date,
			"type":          row.Type,
			"description":   cariEntryDescription(row, loc),
			"debit":         debit,
			"credit":        credit,
			"balance_after": formatMoney(numericFloat(row.BalanceAfter), currency, loc),
			"status":        row.Status,
		})
	}
	customer := strings.TrimSpace(account.CustomerName)
	info := []ioengine.InfoLine{
		{LabelKey: "cari.customer_name", Value: customer},
		{LabelKey: "cari.customer_phone", Value: strings.TrimSpace(account.CustomerPhone)},
	}
	if taxID := strings.TrimSpace(account.CustomerTaxID); taxID != "" {
		if office := strings.TrimSpace(account.CustomerTaxOffice); office != "" {
			taxID = office + " / " + taxID
		}
		info = append(info, ioengine.InfoLine{LabelKey: "cari.customer_tax", Value: taxID})
	}
	info = append(info, ioengine.InfoLine{
		LabelKey: "cari.current_balance",
		Value:    formatMoney(numericFloat(account.Balance), currency, loc),
	})
	totals := map[string]any{
		"description":   i18n.Translate(loc, "cari.totals"),
		"debit":         formatMoney(totalDebit, currency, loc),
		"credit":        formatMoney(totalCredit, currency, loc),
		"balance_after": formatMoney(numericFloat(account.Balance), currency, loc),
	}
	stmt.TotalDebit, stmt.TotalCredit = totalDebit, totalCredit
	return ioengine.Dataset{
		Resource: ResourceCariEntries,
		Columns:  a.ExportColumns(),
		Rows:     out,
		Info:     info,
		Totals:   totals,
		Doc:      stmt,
	}, nil
}

func cariEntryIsDebit(entryType string, metadata []byte) bool {
	switch entryType {
	case "payment":
		return false
	case "adjustment":
		var m map[string]any
		if err := json.Unmarshal(metadata, &m); err == nil {
			if d, _ := m["direction"].(string); d == "decrease" {
				return false
			}
		}
		return true
	default: // charge, opening
		return true
	}
}

func cariEntryDescription(row db.ListCariEntriesForExportRow, loc i18n.Locale) string {
	parts := make([]string, 0, 3)
	if d := strings.TrimSpace(row.Description); d != "" {
		parts = append(parts, d)
	}
	if row.PaymentMethod.Valid && row.PaymentMethod.String != "" {
		parts = append(parts, i18n.Translate(loc, "cari.payment_method."+row.PaymentMethod.String))
	}
	if row.ReferenceNo.Valid && strings.TrimSpace(row.ReferenceNo.String) != "" {
		parts = append(parts, i18n.Translate(loc, "cari.reference_no")+": "+strings.TrimSpace(row.ReferenceNo.String))
	}
	return strings.Join(parts, " · ")
}

func numericFloat(n pgtype.Numeric) float64 {
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return 0
	}
	return f.Float64
}

func formatStatementDate(t time.Time, loc i18n.Locale) string {
	if loc == i18n.LocaleEN {
		return t.Format("2006-01-02")
	}
	return t.Format("02.01.2006")
}

// formatMoney renders 1234.5 as "1.234,50 ₺" (tr) or "₺1,234.50" (en).
func formatMoney(v float64, currency string, loc i18n.Locale) string {
	neg := v < 0
	if neg {
		v = -v
	}
	whole := int64(v)
	cents := int64(math.Round((v - float64(whole)) * 100))
	if cents == 100 {
		whole++
		cents = 0
	}
	thousands, decimal := ".", ","
	if loc == i18n.LocaleEN {
		thousands, decimal = ",", "."
	}
	digits := strconv.FormatInt(whole, 10)
	var b strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteString(thousands)
		}
		b.WriteRune(r)
	}
	num := fmt.Sprintf("%s%s%02d", b.String(), decimal, cents)
	if neg {
		num = "-" + num
	}
	symbol := currencySymbol(currency)
	if loc == i18n.LocaleEN {
		return symbol + num
	}
	return num + " " + symbol
}

func currencySymbol(currency string) string {
	switch strings.ToUpper(strings.TrimSpace(currency)) {
	case "", "TRY":
		return "₺"
	case "USD":
		return "$"
	case "EUR":
		return "€"
	case "GBP":
		return "£"
	default:
		return strings.ToUpper(currency)
	}
}

func (a *CariEntriesAdapter) ImportSchema() []ioengine.ImportField { return nil }

func (a *CariEntriesAdapter) ApplyRow(_ context.Context, _ map[string]any, _ map[string]any) (ioengine.RowResult, error) {
	return ioengine.RowResult{}, fmt.Errorf("cari entries import is not supported")
}

func (a *CariEntriesAdapter) RevertRow(_ context.Context, _, _ string, _ map[string]any) error {
	return fmt.Errorf("cari entries import is not supported")
}

var (
	_ ioengine.ResourceAdapter  = (*CariAccountsAdapter)(nil)
	_ ioengine.ResourceAdapter  = (*CariEntriesAdapter)(nil)
	_ ioengine.DocumentRenderer = (*CariEntriesAdapter)(nil)
)
