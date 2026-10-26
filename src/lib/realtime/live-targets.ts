import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { LiveResource, ResourceChangedEvent } from './types';

/**
 * Which React Query keys a live resource refreshes (key layout: `src/features/queries.ts`).
 *
 * - `own`: the resource's lists, summaries and detail queries. A detail query — the segment after one of
 *   `DETAIL_MARKERS` is a record uuid (`['jobs', 'detail', uuid]`, `['catalog', 'product', uuid]`) — is
 *   refetched only when that uuid is in the batch (or the batch covers every row).
 * - `related`: other views showing derived data (balances, reports, the calendar), always refetched.
 *
 * Invalidation only refetches mounted queries; the rest are marked stale and reload when opened.
 */
type Target = { perm: string; own: QueryKey[]; related?: QueryKey[] };

const CALENDAR: QueryKey = ['calendar'];
const REPORTS: QueryKey = ['reports'];

export const LIVE_TARGETS: Record<LiveResource, Target> = {
  'tenant.customers': { perm: 'tenant.customers.read', own: [['customers']] },
  // Vehicle uuids are not customer uuids: refresh every open customer screen.
  'tenant.vehicles': { perm: 'tenant.customers.read', own: [], related: [['customers']] },
  'tenant.jobs': { perm: 'tenant.jobs.read', own: [['jobs']], related: [REPORTS, CALENDAR] },
  'tenant.sales': { perm: 'tenant.sales.read', own: [['sales']], related: [REPORTS, CALENDAR] },
  'tenant.quotes': { perm: 'tenant.quotes.read', own: [['quotes']], related: [CALENDAR] },
  'tenant.leads': { perm: 'tenant.leads.read', own: [['leads']], related: [CALENDAR] },
  'tenant.purchases': { perm: 'tenant.purchases.read', own: [['purchases']], related: [CALENDAR] },
  'tenant.suppliers': { perm: 'tenant.suppliers.read', own: [['suppliers']] },
  'tenant.catalog.products': {
    perm: 'tenant.catalog.read',
    own: [['catalog', 'products'], ['catalog', 'product']],
    related: [['catalog', 'summary'], ['catalog', 'service-products']],
  },
  'tenant.catalog.services': {
    perm: 'tenant.catalog.read',
    own: [['catalog', 'services'], ['catalog', 'service']],
    related: [['catalog', 'service-products']],
  },
  'tenant.catalog.categories': { perm: 'tenant.catalog.read', own: [['catalog', 'categories'], ['catalog', 'category']] },
  'tenant.finance.accounts': { perm: 'tenant.finance.read', own: [['finance', 'accounts'], ['finance', 'account']], related: [['finance', 'summary']] },
  'tenant.finance.categories': {
    perm: 'tenant.finance.read',
    own: [['finance', 'categories'], ['finance', 'categories-all'], ['finance', 'category']],
  },
  'tenant.finance.transactions': {
    perm: 'tenant.finance.read',
    own: [['finance', 'transactions'], ['finance', 'transaction']],
    related: [['finance', 'summary'], ['finance', 'accounts'], ['finance', 'account'], ['finance', 'category'], REPORTS, CALENDAR],
  },
  'tenant.cari': { perm: 'tenant.cari.read', own: [['cari']] },
  'tenant.cari.entries': { perm: 'tenant.cari.read', own: [], related: [['cari']] },
  'tenant.todos': { perm: 'tenant.todos.read', own: [['todos']], related: [CALENDAR] },
  'tenant.contracts': { perm: 'tenant.contracts.read', own: [['contracts', 'templates']] },
  'tenant.contracts.instances': { perm: 'tenant.contracts.read', own: [['contracts', 'instances']], related: [CALENDAR] },
  'tenant.staff': { perm: 'tenant.staff.read', own: [['staff']] },
};

/** Key segments followed by a record uuid. */
const DETAIL_MARKERS: ReadonlySet<string> = new Set(['detail', 'service', 'product', 'category', 'account', 'transaction']);

const startsWith = (key: QueryKey, prefix: QueryKey) => prefix.length <= key.length && prefix.every((p, i) => key[i] === p);

/** Uuid of a detail query key, or null for lists / summaries. */
export function detailUuid(key: QueryKey): string | null {
  for (let i = 1; i < key.length - 1; i++) {
    if (typeof key[i] === 'string' && DETAIL_MARKERS.has(key[i] as string) && typeof key[i + 1] === 'string') return key[i + 1] as string;
  }
  return null;
}

/** True when a batch covers rows it does not list (bulk without uuids, truncated). */
export const coversEveryRow = (events: ResourceChangedEvent[]) => events.some((e) => e.truncated || (e.action === 'bulk' && e.uuids.length === 0));

/** Whether `key` should be refreshed for this batch of `resource` events. */
export function matchesLive(resource: LiveResource, key: QueryKey, events: ResourceChangedEvent[], refetchAll: boolean): boolean {
  const target = LIVE_TARGETS[resource];
  if (!target) return false;
  if (target.related?.some((p) => startsWith(key, p))) return true;
  if (!target.own.some((p) => startsWith(key, p))) return false;
  const uuid = detailUuid(key);
  if (!uuid || refetchAll || coversEveryRow(events)) return true;
  return events.some((e) => e.uuids.includes(uuid));
}

/** Refreshes every query the batch may have changed. In-flight fetches are reused, not restarted. */
export function invalidateLive(qc: QueryClient, resource: LiveResource, events: ResourceChangedEvent[], refetchAll: boolean) {
  return qc.invalidateQueries({ predicate: (q) => matchesLive(resource, q.queryKey, events, refetchAll) }, { cancelRefetch: false });
}
