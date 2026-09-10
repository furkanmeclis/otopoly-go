package adapters

import (
	"context"
	"fmt"
	"strings"

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
		{Key: "entry_date", LabelKey: "cari.entry_date", Type: ioengine.ColumnTypeString},
		{Key: "type", LabelKey: "cari.entry_type", Type: ioengine.ColumnTypeEnum},
		{Key: "status", LabelKey: "cari.entry_status", Type: ioengine.ColumnTypeEnum},
		{Key: "amount", LabelKey: "cari.amount", Type: ioengine.ColumnTypeString},
		{Key: "balance_after", LabelKey: "cari.balance_after", Type: ioengine.ColumnTypeString},
		{Key: "description", LabelKey: "cari.description", Type: ioengine.ColumnTypeString},
		{Key: "reference_no", LabelKey: "cari.reference_no", Type: ioengine.ColumnTypeString},
		{Key: "payment_method", LabelKey: "cari.payment_method", Type: ioengine.ColumnTypeString},
		{Key: "customer_name", LabelKey: "cari.customer_name", Type: ioengine.ColumnTypeString},
		{Key: "uuid", LabelKey: "cari.uuid", Type: ioengine.ColumnTypeString},
	}
}

func (a *CariEntriesAdapter) Export(ctx context.Context, query ioengine.ExportQuery, _ i18n.Locale) (ioengine.Dataset, error) {
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
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		ref := ""
		if row.ReferenceNo.Valid {
			ref = row.ReferenceNo.String
		}
		pm := ""
		if row.PaymentMethod.Valid {
			pm = row.PaymentMethod.String
		}
		date := ""
		if row.EntryDate.Valid {
			date = row.EntryDate.Time.Format("2006-01-02")
		}
		out = append(out, map[string]any{
			"entry_date":     date,
			"type":           row.Type,
			"status":         row.Status,
			"amount":         formatNumeric(row.Amount),
			"balance_after":  formatNumeric(row.BalanceAfter),
			"description":    row.Description,
			"reference_no":   ref,
			"payment_method": pm,
			"customer_name":  row.CustomerName,
			"uuid":           row.Uuid.String(),
		})
	}
	return ioengine.Dataset{Resource: ResourceCariEntries, Columns: a.ExportColumns(), Rows: out}, nil
}

func (a *CariEntriesAdapter) ImportSchema() []ioengine.ImportField { return nil }

func (a *CariEntriesAdapter) ApplyRow(_ context.Context, _ map[string]any, _ map[string]any) (ioengine.RowResult, error) {
	return ioengine.RowResult{}, fmt.Errorf("cari entries import is not supported")
}

func (a *CariEntriesAdapter) RevertRow(_ context.Context, _, _ string, _ map[string]any) error {
	return fmt.Errorf("cari entries import is not supported")
}

var (
	_ ioengine.ResourceAdapter = (*CariAccountsAdapter)(nil)
	_ ioengine.ResourceAdapter = (*CariEntriesAdapter)(nil)
)
