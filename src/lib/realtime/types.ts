/** Live list updates over Centrifugo (backend `resourceevents`, docs/ARCHITECTURE.md → "Live lists"). */

/** Tenant resources published on `org:{org_uuid}:resource:{resource}` (backend `resourceevents.TenantResources`). */
export const LIVE_RESOURCES = [
  'tenant.customers',
  'tenant.vehicles',
  'tenant.jobs',
  'tenant.sales',
  'tenant.quotes',
  'tenant.leads',
  'tenant.purchases',
  'tenant.suppliers',
  'tenant.catalog.products',
  'tenant.catalog.services',
  'tenant.catalog.categories',
  'tenant.finance.accounts',
  'tenant.finance.categories',
  'tenant.finance.transactions',
  'tenant.cari',
  'tenant.cari.entries',
  'tenant.todos',
  'tenant.contracts',
  'tenant.contracts.instances',
  'tenant.staff',
  'tenant.calendar',
  'tenant.loyalty.programs',
  'tenant.loyalty.packages',
  'tenant.loyalty.subscriptions',
  'tenant.loyalty.customers',
] as const;

export type LiveResource = (typeof LIVE_RESOURCES)[number];

export type ResourceChangeAction = 'created' | 'updated' | 'deleted' | 'bulk';

/** `resource.changed` publication. Events are hints only: the app always refetches over HTTP. */
export type ResourceChangedEvent = {
  resource: string;
  action: ResourceChangeAction;
  /** Changed rows (≤ 200). Empty for `bulk` = unknown set. */
  uuids: string[];
  /** More rows changed than `uuids` lists: treat every row as changed. */
  truncated: boolean;
  at?: string;
};

/**
 * - `idle`: not started (signed out, no organization) or paused in the background.
 * - `unavailable`: the server refused realtime (503 REALTIME_DISABLED, 403, no token); the app works without it.
 */
export type RealtimeState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'unavailable';

export type LiveListener = (events: ResourceChangedEvent[], reconnected: boolean) => void;

export const organizationResourceChannel = (orgUuid: string, resource: string) => `org:${orgUuid}:resource:${resource}`;

/** Transport behind the hub: Centrifugo in live mode, a silent fake in mock mode. */
export interface RealtimeDriver {
  /** Opens (or re-opens after `disconnect`) the connection. Never throws. */
  connect(): void;
  /** Drops the socket but keeps subscriptions, so `connect` resumes them (app in background). */
  disconnect(): void;
  /** Tears everything down (sign-out, organization switch). */
  close(): void;
  /** Subscribes to a channel (token per channel); `onError` reports a refused subscription. Returns the unsubscribe. */
  subscribe(channel: string, onData: (data: unknown) => void, onError?: (error: unknown) => void): () => void;
  onState(listener: (state: RealtimeState) => void): () => void;
}
