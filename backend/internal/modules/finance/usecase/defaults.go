package usecase

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/jackc/pgx/v5/pgtype"
)

type defaultCategory struct {
	Name  string
	Kind  string
	Order int32
}

var defaultCategories = []defaultCategory{
	{Name: "Hizmet Geliri", Kind: "income", Order: 1},
	{Name: "Ürün Satışı", Kind: "income", Order: 2},
	{Name: "Cari Tahsilat", Kind: "income", Order: 3},
	{Name: "Diğer Gelir", Kind: "income", Order: 99},
	{Name: "Maaş", Kind: "expense", Order: 1},
	{Name: "Kira", Kind: "expense", Order: 2},
	{Name: "Malzeme", Kind: "expense", Order: 3},
	{Name: "Stok Alımı", Kind: "expense", Order: 4},
	{Name: "Genel Gider", Kind: "expense", Order: 5},
	{Name: "Diğer Gider", Kind: "expense", Order: 99},
}

// CategoryCariPayment is the seeded income category used for cari collections.
const CategoryCariPayment = "Cari Tahsilat"

// SeedDefaults creates the default cash account and categories for a new organization.
// TODO(finance): Add one-off migration/backfill for organizations registered before finance module
// (default kasa + seed categories + owner finance.write permission).
func SeedDefaults(ctx context.Context, q *db.Queries, organizationID int64) error {
	var zero pgtype.Numeric
	_ = zero.Scan("0")
	if _, err := q.CreateFinanceAccount(ctx, db.CreateFinanceAccountParams{
		OrganizationID: organizationID,
		Name:           "Ana Kasa",
		Type:           "cash",
		Currency:       "TRY",
		OpeningBalance: zero,
		IsDefault:      true,
		IsActive:       true,
		BankName:       pgtype.Text{},
		Iban:           pgtype.Text{},
		Notes:          "",
	}); err != nil {
		return err
	}
	for _, cat := range defaultCategories {
		if _, err := q.CreateFinanceCategory(ctx, db.CreateFinanceCategoryParams{
			OrganizationID: organizationID,
			ParentID:       pgtype.Int8{},
			Name:           cat.Name,
			Kind:           cat.Kind,
			SortOrder:      cat.Order,
			IsActive:       true,
		}); err != nil {
			return err
		}
	}
	return nil
}
