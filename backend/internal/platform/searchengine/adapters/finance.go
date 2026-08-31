package adapters

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	SpecFinanceAccounts     = "tenant_finance_accounts"
	SpecFinanceCategories   = "tenant_finance_categories"
	SpecFinanceTransactions = "tenant_finance_transactions"
)

// TenantDocID builds a globally unique Meilisearch document id for tenant entities.
func TenantDocID(orgUUID, entityUUID uuid.UUID) string {
	return orgUUID.String() + "_" + entityUUID.String()
}

func parseTenantDocID(id string) (orgUUID, entityUUID uuid.UUID, err error) {
	parts := strings.SplitN(strings.TrimSpace(id), "_", 2)
	if len(parts) != 2 {
		return uuid.Nil, uuid.Nil, fmt.Errorf("tenant search: invalid document id")
	}
	orgUUID, err = uuid.Parse(parts[0])
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("tenant search: invalid organization id")
	}
	entityUUID, err = uuid.Parse(parts[1])
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("tenant search: invalid entity id")
	}
	return orgUUID, entityUUID, nil
}

func tenantFinanceHref(slug, segment, entityUUID string) string {
	return fmt.Sprintf("/t/%s/finance/%s/%s", slug, segment, entityUUID)
}

func formatBalanceSubtitle(balance, currency, accountType string) string {
	balance = strings.TrimSpace(balance)
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if balance == "" {
		balance = "0.00"
	}
	if currency == "" {
		currency = "TRY"
	}
	subtitle := fmt.Sprintf("%s %s", balance, currency)
	if accountType = strings.TrimSpace(accountType); accountType != "" {
		subtitle += " · " + accountType
	}
	return subtitle
}

func numericToDisplay(n pgtype.Numeric) string {
	if !n.Valid || n.Int == nil {
		return "0.00"
	}
	rat := new(big.Rat).SetInt(n.Int)
	if n.Exp != 0 {
		ten := big.NewRat(10, 1)
		if n.Exp > 0 {
			for i := int32(0); i < n.Exp; i++ {
				rat.Mul(rat, ten)
			}
		} else {
			for i := int32(0); i > n.Exp; i-- {
				rat.Quo(rat, ten)
			}
		}
	}
	f, _ := rat.Float64()
	return fmt.Sprintf("%.2f", f)
}

// FinanceAccountsAdapter indexes tenant cash/bank accounts.
type FinanceAccountsAdapter struct {
	q *db.Queries
}

func NewFinanceAccounts(q *db.Queries) *FinanceAccountsAdapter {
	return &FinanceAccountsAdapter{q: q}
}

func (a *FinanceAccountsAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:           SpecFinanceAccounts,
		LabelKey:     "search.specs_tenant_finance_accounts",
		Permission:   rbac.PermTenantFinanceRead,
		Icon:         "wallet",
		TenantScoped: true,
		Searchable:   []string{"title", "subtitle", "keywords", "name", "bank_name", "iban", "type", "currency"},
		Filterable:   []string{"organization_slug"},
	}
}

func (a *FinanceAccountsAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListFinanceAccountsForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, a.documentFromRow(row))
	}
	return out, nil
}

func (a *FinanceAccountsAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	orgUUID, entityUUID, err := parseTenantDocID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetFinanceAccountForSearch(ctx, db.GetFinanceAccountForSearchParams{
		Uuid: entityUUID, Uuid_2: orgUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("finance accounts search: not found")
		}
		return searchengine.Document{}, err
	}
	return a.documentFromRow(db.ListFinanceAccountsForSearchRow(row)), nil
}

func (a *FinanceAccountsAdapter) documentFromRow(row db.ListFinanceAccountsForSearchRow) searchengine.Document {
	keywords := []string{row.Type, row.Currency}
	if row.BankName.Valid && strings.TrimSpace(row.BankName.String) != "" {
		keywords = append(keywords, row.BankName.String)
	}
	if row.Iban.Valid && strings.TrimSpace(row.Iban.String) != "" {
		keywords = append(keywords, row.Iban.String)
	}
	if row.IsDefault {
		keywords = append(keywords, "default")
	}
	return searchengine.Document{
		ID:               TenantDocID(row.OrganizationUuid, row.Uuid),
		Spec:             SpecFinanceAccounts,
		Title:            row.Name,
		Subtitle:         formatBalanceSubtitle(numericToDisplay(row.CurrentBalance), row.Currency, row.Type),
		Keywords:         keywords,
		Href:             tenantFinanceHref(row.OrganizationSlug, "accounts", row.Uuid.String()),
		Icon:             "wallet",
		OrganizationSlug: row.OrganizationSlug,
	}
}

// FinanceCategoriesAdapter indexes tenant income/expense categories.
type FinanceCategoriesAdapter struct {
	q *db.Queries
}

func NewFinanceCategories(q *db.Queries) *FinanceCategoriesAdapter {
	return &FinanceCategoriesAdapter{q: q}
}

func (a *FinanceCategoriesAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:           SpecFinanceCategories,
		LabelKey:     "search.specs_tenant_finance_categories",
		Permission:   rbac.PermTenantFinanceRead,
		Icon:         "tags",
		TenantScoped: true,
		Searchable:   []string{"title", "subtitle", "keywords", "name", "kind"},
		Filterable:   []string{"organization_slug"},
	}
}

func (a *FinanceCategoriesAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListFinanceCategoriesForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, a.documentFromRow(row))
	}
	return out, nil
}

func (a *FinanceCategoriesAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	orgUUID, entityUUID, err := parseTenantDocID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetFinanceCategoryForSearch(ctx, db.GetFinanceCategoryForSearchParams{
		Uuid: entityUUID, Uuid_2: orgUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("finance categories search: not found")
		}
		return searchengine.Document{}, err
	}
	return a.documentFromRow(db.ListFinanceCategoriesForSearchRow(row)), nil
}

func (a *FinanceCategoriesAdapter) documentFromRow(row db.ListFinanceCategoriesForSearchRow) searchengine.Document {
	return searchengine.Document{
		ID:               TenantDocID(row.OrganizationUuid, row.Uuid),
		Spec:             SpecFinanceCategories,
		Title:            row.Name,
		Subtitle:         row.Kind,
		Keywords:         []string{row.Kind},
		Href:             tenantFinanceHref(row.OrganizationSlug, "categories", row.Uuid.String()),
		Icon:             "tags",
		OrganizationSlug: row.OrganizationSlug,
	}
}

// FinanceTransactionsAdapter indexes tenant ledger entries.
type FinanceTransactionsAdapter struct {
	q *db.Queries
}

func NewFinanceTransactions(q *db.Queries) *FinanceTransactionsAdapter {
	return &FinanceTransactionsAdapter{q: q}
}

func (a *FinanceTransactionsAdapter) Spec() searchengine.Spec {
	return searchengine.Spec{
		ID:           SpecFinanceTransactions,
		LabelKey:     "search.specs_tenant_finance_transactions",
		Permission:   rbac.PermTenantFinanceRead,
		Icon:         "receipt",
		TenantScoped: true,
		Searchable:   []string{"title", "subtitle", "keywords", "description", "reference_no", "type", "account_name"},
		Filterable:   []string{"organization_slug"},
	}
}

func (a *FinanceTransactionsAdapter) ListAll(ctx context.Context) ([]searchengine.Document, error) {
	rows, err := a.q.ListFinanceTransactionsForSearch(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]searchengine.Document, 0, len(rows))
	for _, row := range rows {
		out = append(out, a.documentFromRow(row))
	}
	return out, nil
}

func (a *FinanceTransactionsAdapter) Document(ctx context.Context, id string) (searchengine.Document, error) {
	orgUUID, entityUUID, err := parseTenantDocID(id)
	if err != nil {
		return searchengine.Document{}, err
	}
	row, err := a.q.GetFinanceTransactionForSearch(ctx, db.GetFinanceTransactionForSearchParams{
		Uuid: entityUUID, Uuid_2: orgUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return searchengine.Document{}, fmt.Errorf("finance transactions search: not found")
		}
		return searchengine.Document{}, err
	}
	return a.documentFromRow(db.ListFinanceTransactionsForSearchRow(row)), nil
}

func (a *FinanceTransactionsAdapter) documentFromRow(row db.ListFinanceTransactionsForSearchRow) searchengine.Document {
	title := strings.TrimSpace(row.Description)
	if title == "" {
		title = row.Type
	}
	subtitle := fmt.Sprintf("%s %s · %s · %s",
		numericToDisplay(row.Amount),
		row.Currency,
		row.Type,
		row.AccountName,
	)
	keywords := []string{row.Type, row.Status, row.AccountName}
	if row.ReferenceNo.Valid && strings.TrimSpace(row.ReferenceNo.String) != "" {
		keywords = append(keywords, row.ReferenceNo.String)
	}
	return searchengine.Document{
		ID:               TenantDocID(row.OrganizationUuid, row.Uuid),
		Spec:             SpecFinanceTransactions,
		Title:            title,
		Subtitle:         subtitle,
		Keywords:         keywords,
		Href:             tenantFinanceHref(row.OrganizationSlug, "transactions", row.Uuid.String()),
		Icon:             "receipt",
		OrganizationSlug: row.OrganizationSlug,
	}
}

var (
	_ searchengine.Adapter = (*FinanceAccountsAdapter)(nil)
	_ searchengine.Adapter = (*FinanceCategoriesAdapter)(nil)
	_ searchengine.Adapter = (*FinanceTransactionsAdapter)(nil)
)
