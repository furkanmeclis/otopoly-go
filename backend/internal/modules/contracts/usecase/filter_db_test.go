package usecase_test

import (
	"context"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/contracts/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

// customer_uuid lists the contracts on that customer's jobs only.
func TestListContractInstancesByCustomerDB(t *testing.T) {
	fx := dbtest.NewFixtures(t)
	org, other := fx.Organization(), fx.Organization()
	user := fx.User()
	a, b := fx.Customer(org, "A"), fx.Customer(org, "B")
	jobA1 := fx.Job(org, a, fx.Vehicle(org, a), user)
	jobA2 := fx.Job(org, a, fx.Vehicle(org, a), user)
	jobB := fx.Job(org, b, fx.Vehicle(org, b), user)
	c1, c2 := fx.Contract(org, jobA1, user), fx.Contract(org, jobA2, user)
	fx.Contract(org, jobB, user)
	foreign := fx.Customer(other, "F")
	fx.Contract(other, fx.Job(other, foreign, fx.Vehicle(other, foreign), user), user)

	svc := usecase.New(fx.Pool, db.New(fx.Pool), nil, nil, nil, nil, "")
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: org.ID, UUID: org.UUID})

	items, total, err := svc.ListInstances(ctx, 20, 0, usecase.InstanceFilters{CustomerUUID: &a.UUID})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(items) != 2 {
		t.Fatalf("customer A: total %d items %d", total, len(items))
	}
	got := map[string]bool{items[0].UUID.String(): true, items[1].UUID.String(): true}
	if !got[c1.UUID.String()] || !got[c2.UUID.String()] {
		t.Fatalf("unexpected contracts %v", got)
	}
	if _, total, _ = svc.ListInstances(ctx, 20, 0, usecase.InstanceFilters{}); total != 3 {
		t.Fatalf("unfiltered total = %d, want 3", total)
	}
	if _, total, _ = svc.ListInstances(ctx, 20, 0, usecase.InstanceFilters{CustomerUUID: &foreign.UUID}); total != 0 {
		t.Fatalf("foreign customer must match nothing: %d", total)
	}
}
