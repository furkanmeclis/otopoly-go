package usecase_test

import (
	"context"
	"errors"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/dbtest"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/authctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

func tenantCtx(org dbtest.Row, user dbtest.Row, perms ...string) context.Context {
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: org.ID, UUID: org.UUID})
	return authctx.WithPrincipal(ctx, authctx.Principal{UserID: user.UUID, UserInternal: user.ID, Permissions: perms})
}

// The customer feed returns events of the customer and every related record,
// newest first, filtered by the caller's read permissions and scoped to the
// organization.
func TestCustomerActivityFeedDB(t *testing.T) {
	fx := dbtest.NewFixtures(t)
	org, other := fx.Organization(), fx.Organization()
	user := fx.User()
	cust := fx.Customer(org, "Ayşe")
	veh := fx.Vehicle(org, cust)
	job := fx.Job(org, cust, veh, user)
	contract := fx.Contract(org, job, user)
	sale := fx.Sale(org, cust, user)
	quote := fx.Quote(org, cust)
	lead := fx.Lead(org, cust)
	entry := fx.CariEntry(org, cust, user)

	// Noise: another customer of the same org and another organization.
	cust2 := fx.Customer(org, "Mehmet")
	job2 := fx.Job(org, cust2, fx.Vehicle(org, cust2), user)
	fx.Activity(org, user, "jobs.create", "jobs.job", job2.UUID)
	fx.Activity(org, user, "tenant.customer.create", "customer", cust2.UUID)
	fx.Activity(other, user, "tenant.customer.update", "customer", cust.UUID)

	fx.Activity(org, user, "tenant.customer.create", "customer", cust.UUID)
	fx.Activity(org, user, "tenant.customer.vehicle_add", "customer_vehicle", veh.UUID)
	fx.Activity(org, user, "jobs.create", "jobs.job", job.UUID)
	fx.Activity(org, user, "tenant.contract_instance.create", "contract_instance", contract.UUID)
	fx.Activity(org, user, "tenant.sales.create", "sale", sale.UUID)
	fx.Activity(org, user, "tenant.quote.create", "quote", quote.UUID)
	fx.Activity(org, dbtest.Row{}, "tenant.lead.create", "lead", lead.UUID)
	fx.Activity(org, user, "cari.charge", "cari.entry", entry.UUID)

	svc := usecase.New(fx.Pool, db.New(fx.Pool), nil)
	all := tenantCtx(org, user,
		rbac.PermTenantCustomersRead, rbac.PermTenantJobsRead, rbac.PermTenantContractsRead,
		rbac.PermTenantSalesRead, rbac.PermTenantQuotesRead, rbac.PermTenantLeadsRead, rbac.PermTenantCariRead)

	items, total, err := svc.ListActivity(all, cust.UUID, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 8 || len(items) != 8 {
		t.Fatalf("total = %d, items = %d, want 8", total, len(items))
	}
	wantSubjects := []string{"cari_entry", "lead", "quote", "sale", "contract", "job", "vehicle", "customer"}
	for i, s := range wantSubjects {
		if items[i].Subject != s {
			t.Fatalf("item %d subject = %q (%s), want %q", i, items[i].Subject, items[i].Action, s)
		}
	}
	if items[1].Actor != nil || items[0].Actor == nil || items[0].Actor.UUID != user.UUID {
		t.Fatalf("actors: %+v / %+v", items[0].Actor, items[1].Actor)
	}
	if items[7].ResourceUUID == nil || *items[7].ResourceUUID != cust.UUID {
		t.Fatalf("resource uuid = %v", items[7].ResourceUUID)
	}

	page, total, err := svc.ListActivity(all, cust.UUID, 3, 3)
	if err != nil {
		t.Fatal(err)
	}
	if total != 8 || len(page) != 3 || page[0].Subject != "sale" {
		t.Fatalf("page 2: total %d, %d items, first %+v", total, len(page), page)
	}

	// Only customers.read: the customer and its vehicles.
	onlyCustomers := tenantCtx(org, user, rbac.PermTenantCustomersRead)
	items, total, err = svc.ListActivity(onlyCustomers, cust.UUID, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(items) != 2 || items[0].Subject != "vehicle" || items[1].Subject != "customer" {
		t.Fatalf("customers-only feed: total %d %+v", total, items)
	}

	// Contracts need jobs.read too.
	contractsOnly := tenantCtx(org, user, rbac.PermTenantCustomersRead, rbac.PermTenantContractsRead)
	if _, total, err = svc.ListActivity(contractsOnly, cust.UUID, 20, 0); err != nil || total != 2 {
		t.Fatalf("contracts without jobs.read: total %d err %v", total, err)
	}

	// Another organization's customer answers not found.
	if _, _, err := svc.ListActivity(tenantCtx(other, user, rbac.PermTenantCustomersRead), cust.UUID, 20, 0); !errors.Is(err, usecase.ErrNotFound) {
		t.Fatalf("cross-org: %v", err)
	}
}
