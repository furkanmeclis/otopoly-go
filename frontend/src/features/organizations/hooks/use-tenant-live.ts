"use client";

import { useCallback } from "react";

import type {
  DataTableRealtime,
  ListRealtimeOptions,
} from "@/components/tables";
import { useOptionalTenant } from "@/features/organizations/providers/tenant-provider";
import { RealtimeChannels } from "@/lib/realtime/channels";
import type { ResourceChangedEvent } from "@/lib/realtime/resource-events";
import {
  eventsTouch,
  useResourceEvents,
} from "@/lib/realtime/use-resource-events";
import { useAuth } from "@/providers/auth-provider";

/**
 * Live tenant resources (backend `resourceevents.TenantResources`). Each one
 * is published on `org:{org_uuid}:resource:{name}`; the subscription token
 * is only issued to members holding the resource's read permission.
 */
export const TenantLiveResources = {
  customers: "tenant.customers",
  vehicles: "tenant.vehicles",
  jobs: "tenant.jobs",
  sales: "tenant.sales",
  quotes: "tenant.quotes",
  leads: "tenant.leads",
  purchases: "tenant.purchases",
  suppliers: "tenant.suppliers",
  catalogProducts: "tenant.catalog.products",
  catalogServices: "tenant.catalog.services",
  catalogCategories: "tenant.catalog.categories",
  financeAccounts: "tenant.finance.accounts",
  financeCategories: "tenant.finance.categories",
  financeTransactions: "tenant.finance.transactions",
  cari: "tenant.cari",
  cariEntries: "tenant.cari.entries",
  todos: "tenant.todos",
  contractTemplates: "tenant.contracts",
  contractInstances: "tenant.contracts.instances",
  staff: "tenant.staff",
  calendar: "tenant.calendar",
  loyaltyPrograms: "tenant.loyalty.programs",
  loyaltyPackages: "tenant.loyalty.packages",
  loyaltySubscriptions: "tenant.loyalty.subscriptions",
  loyaltyCustomers: "tenant.loyalty.customers",
} as const;

export type TenantLiveResource =
  (typeof TenantLiveResources)[keyof typeof TenantLiveResources];

/** UUID of the organization of the current `/t/{slug}` shell, if known. */
export function useTenantOrganizationUuid(): string | undefined {
  const tenant = useOptionalTenant();
  const { user } = useAuth();
  const slug = tenant?.slug;
  if (!slug) return undefined;
  return user?.organizations.find((org) => org.slug === slug)?.uuid;
}

/** Live list channel of a tenant resource in the current organization. */
export function useTenantLiveChannel(resource: string): string | undefined {
  const orgUuid = useTenantOrganizationUuid();
  return orgUuid
    ? RealtimeChannels.organizationResource(orgUuid, resource)
    : undefined;
}

/**
 * `useServerListState({ realtime })` option for a tenant DataTable; off until
 * the organization is known.
 */
export function useTenantLiveList(
  resource: string,
): ListRealtimeOptions | undefined {
  const channel = useTenantLiveChannel(resource);
  return channel ? { resource, channel } : undefined;
}

/**
 * DataTable `realtime` prop for tenant tables that do not use
 * `useServerListState` (client-side lists).
 */
export function useTenantLiveTable(
  resource: string,
  refetch: () => unknown,
): DataTableRealtime | undefined {
  const live = useTenantLiveList(resource);
  return live ? { ...live, refetch } : undefined;
}

type LiveRefetchOptions = {
  /** Only refetch for events that may touch this record (detail pages). */
  uuid?: string;
  enabled?: boolean;
};

/**
 * Silent refetch for tenant views that are not a DataTable (boards, card
 * lists, detail pages): one debounced refetch per batch of changes, and one
 * after the realtime connection comes back.
 */
export function useTenantLiveRefetch(
  resources: string | readonly string[],
  refetch: () => unknown,
  { uuid, enabled = true }: LiveRefetchOptions = {},
) {
  const list = typeof resources === "string" ? [resources] : resources;
  const onEvents = useCallback(
    (events: ResourceChangedEvent[], reconnected: boolean) => {
      if (!reconnected && uuid && !eventsTouch(events, uuid)) return;
      try {
        void Promise.resolve(refetch()).catch(() => undefined);
      } catch {
        // Live updates stay fail-soft; the view keeps its own error state.
      }
    },
    [refetch, uuid],
  );
  // Fixed number of hooks: up to three resources per view.
  useTenantResourceEvents(list[0], onEvents, enabled);
  useTenantResourceEvents(list[1], onEvents, enabled);
  useTenantResourceEvents(list[2], onEvents, enabled);
}

function useTenantResourceEvents(
  resource: string | undefined,
  onEvents: (events: ResourceChangedEvent[], reconnected: boolean) => void,
  enabled: boolean,
) {
  const channel = useTenantLiveChannel(resource ?? "");
  useResourceEvents({
    channel: resource ? channel : undefined,
    resource: resource ?? "",
    onEvents,
    enabled: enabled && Boolean(resource),
  });
}
