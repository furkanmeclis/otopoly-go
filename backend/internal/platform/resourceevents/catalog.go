package resourceevents

import (
	"context"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
)

// Live tenant resources. Names match the io / bulk engine and resource meta
// slugs where those exist. Each event is published on
// org:{org_uuid}:resource:{name}; subscribing needs the listed permission in
// that organization.
const (
	TenantCustomers           = "tenant.customers"
	TenantVehicles            = "tenant.vehicles"
	TenantJobs                = "tenant.jobs"
	TenantSales               = "tenant.sales"
	TenantQuotes              = "tenant.quotes"
	TenantLeads               = "tenant.leads"
	TenantPurchases           = "tenant.purchases"
	TenantSuppliers           = "tenant.suppliers"
	TenantCatalogProducts     = "tenant.catalog.products"
	TenantCatalogServices     = "tenant.catalog.services"
	TenantCatalogCategories   = "tenant.catalog.categories"
	TenantFinanceAccounts     = "tenant.finance.accounts"
	TenantFinanceCategories   = "tenant.finance.categories"
	TenantFinanceTransactions = "tenant.finance.transactions"
	TenantCari                = "tenant.cari"
	TenantCariEntries         = "tenant.cari.entries"
	TenantTodos               = "tenant.todos"
	TenantContracts           = "tenant.contracts"
	TenantContractInstances   = "tenant.contracts.instances"
	TenantStaff               = "tenant.staff"
)

// TenantResources maps every live tenant resource to its read permission.
var TenantResources = map[string]string{
	TenantCustomers:           rbac.PermTenantCustomersRead,
	TenantVehicles:            rbac.PermTenantCustomersRead,
	TenantJobs:                rbac.PermTenantJobsRead,
	TenantSales:               rbac.PermTenantSalesRead,
	TenantQuotes:              rbac.PermTenantQuotesRead,
	TenantLeads:               rbac.PermTenantLeadsRead,
	TenantPurchases:           rbac.PermTenantPurchasesRead,
	TenantSuppliers:           rbac.PermTenantSuppliersRead,
	TenantCatalogProducts:     rbac.PermTenantCatalogRead,
	TenantCatalogServices:     rbac.PermTenantCatalogRead,
	TenantCatalogCategories:   rbac.PermTenantCatalogRead,
	TenantFinanceAccounts:     rbac.PermTenantFinanceRead,
	TenantFinanceCategories:   rbac.PermTenantFinanceRead,
	TenantFinanceTransactions: rbac.PermTenantFinanceRead,
	TenantCari:                rbac.PermTenantCariRead,
	TenantCariEntries:         rbac.PermTenantCariRead,
	TenantTodos:               rbac.PermTenantTodosRead,
	TenantContracts:           rbac.PermTenantContractsRead,
	TenantContractInstances:   rbac.PermTenantContractsRead,
	TenantStaff:               rbac.PermTenantStaffRead,
}

// RegisterTenantResources declares every live tenant resource in reg.
func RegisterTenantResources(reg *Registry) {
	for resource, perm := range TenantResources {
		reg.Register(resource, perm)
	}
}

// Emit publishes through pub when it is set (nil-safe helper for modules).
func Emit(ctx context.Context, pub Publisher, resource, action string, uuids ...string) {
	if pub == nil {
		return
	}
	pub.Publish(ctx, resource, action, uuids...)
}
