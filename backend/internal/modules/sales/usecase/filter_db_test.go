package usecase_test

import (
	"context"
	"errors"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/sales/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

// customer_uuid narrows the sales list (and its total) to one customer of
// the organization; another organization's customer matches nothing.
func TestListSalesByCustomerDB(t *testing.T) {
	fx := dbtest.NewFixtures(t)
	org, other := fx.Organization(), fx.Organization()
	user := fx.User()
	a, b := fx.Customer(org, "A"), fx.Customer(org, "B")
	foreign := fx.Customer(other, "F")
	s1, s2 := fx.Sale(org, a, user), fx.Sale(org, a, user)
	fx.Sale(org, b, user)
	fx.Sale(org, dbtest.Row{}, user)
	fx.Sale(other, foreign, user)

	svc := usecase.New(fx.Pool, db.New(fx.Pool), nil, nil, nil)
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: org.ID, UUID: org.UUID})

	items, total, err := svc.List(ctx, 20, 0, usecase.ListFilters{CustomerUUID: a.UUID.String()})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(items) != 2 {
		t.Fatalf("customer A: total %d, items %d", total, len(items))
	}
	got := map[string]bool{items[0].UUID.String(): true, items[1].UUID.String(): true}
	if !got[s1.UUID.String()] || !got[s2.UUID.String()] {
		t.Fatalf("unexpected sales %v", got)
	}
	if _, total, _ = svc.List(ctx, 20, 0, usecase.ListFilters{}); total != 4 {
		t.Fatalf("unfiltered total = %d, want 4", total)
	}
	if items, total, _ = svc.List(ctx, 20, 0, usecase.ListFilters{CustomerUUID: foreign.UUID.String()}); total != 0 || len(items) != 0 {
		t.Fatalf("foreign customer must match nothing: %d", total)
	}
	if _, _, err = svc.List(ctx, 20, 0, usecase.ListFilters{CustomerUUID: "nope"}); !errors.Is(err, usecase.ErrInvalidRequest) {
		t.Fatalf("invalid uuid: %v", err)
	}
}
