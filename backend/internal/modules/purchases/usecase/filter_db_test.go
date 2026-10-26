package usecase_test

import (
	"context"
	"errors"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

// supplier_uuid narrows the purchases list (and its total) to one supplier of
// the organization; another organization's supplier matches nothing.
func TestListPurchasesBySupplierDB(t *testing.T) {
	fx := dbtest.NewFixtures(t)
	org, other := fx.Organization(), fx.Organization()
	user := fx.User()
	a, b := fx.Supplier(org, "A"), fx.Supplier(org, "B")
	foreign := fx.Supplier(other, "F")
	p1 := fx.Purchase(org, a, user)
	fx.Purchase(org, b, user)
	fx.Purchase(org, b, user)
	fx.Purchase(other, foreign, user)

	svc := usecase.New(fx.Pool, db.New(fx.Pool), nil, nil)
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: org.ID, UUID: org.UUID})

	items, total, err := svc.List(ctx, 20, 0, usecase.ListFilters{SupplierUUID: a.UUID.String()})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(items) != 1 || items[0].UUID != p1.UUID {
		t.Fatalf("supplier A: total %d, items %+v", total, items)
	}
	if _, total, _ = svc.List(ctx, 20, 0, usecase.ListFilters{SupplierUUID: b.UUID.String()}); total != 2 {
		t.Fatalf("supplier B total = %d", total)
	}
	if _, total, _ = svc.List(ctx, 20, 0, usecase.ListFilters{SupplierUUID: foreign.UUID.String()}); total != 0 {
		t.Fatalf("foreign supplier must match nothing: %d", total)
	}
	if _, _, err = svc.List(ctx, 20, 0, usecase.ListFilters{SupplierUUID: "nope"}); !errors.Is(err, usecase.ErrInvalidRequest) {
		t.Fatalf("invalid uuid: %v", err)
	}
}
