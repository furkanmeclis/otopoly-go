package resourceevents

import "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"

// Loyalty and packages: program definitions (campaigns, package definitions,
// subscription plans), packages sold, subscriptions, and a customer's
// loyalty state (stamps, credits, uses; ids are customer uuids).
const (
	TenantLoyaltyPrograms      = "tenant.loyalty.programs"
	TenantLoyaltyPackages      = "tenant.loyalty.packages"
	TenantLoyaltySubscriptions = "tenant.loyalty.subscriptions"
	TenantLoyaltyCustomers     = "tenant.loyalty.customers"
)

func init() {
	for _, r := range []string{TenantLoyaltyPrograms, TenantLoyaltyPackages, TenantLoyaltySubscriptions, TenantLoyaltyCustomers} {
		TenantResources[r] = rbac.PermTenantLoyaltyRead
	}
}
