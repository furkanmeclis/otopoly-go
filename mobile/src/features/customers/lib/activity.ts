/** Pure helpers of the customer activity timeline (shared by the screen and the smoke test). */
import type { CustomerActivityEntry } from '@/features/customers/services/customers.service';

/** Payload fields that name the record an entry is about, in priority order (same as the web tab). */
const DETAIL_KEYS = ['plate', 'number', 'name', 'title', 'product'] as const;

export function activityDetail(entry: CustomerActivityEntry): string {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  for (const key of DETAIL_KEYS) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

/** Screen an entry opens, or null (vehicles, the customer itself, deletes, unknown kinds). */
export function activityHref(entry: CustomerActivityEntry, cariAccountUuid?: string | null): string | null {
  const id = entry.resource_uuid;
  if (!id || entry.action.endsWith('.delete')) return null;
  switch (entry.subject) {
    case 'job':
      return `/jobs/${id}`;
    case 'sale':
      return `/sales/${id}`;
    case 'quote':
      return `/quotes/${id}`;
    case 'lead':
      return `/leads/${id}`;
    case 'contract':
      return `/contracts/instances/${id}`;
    case 'cari_entry':
      return cariAccountUuid ? `/cari/${cariAccountUuid}` : null;
    default:
      return null;
  }
}
