/**
 * Tenant access states (web `TenantRouteGuard`), pure so the smoke tests can use them.
 *   denied    — no membership in the organization
 *   expired   — `access_ends_at` passed or status `expired`
 *   suspended — status `suspended` (the web folds it into "expired"; mobile says "paused")
 * Copy is neutral: the owner is told the details were e-mailed, staff to ask their manager.
 * Nothing about buying, renewing or upgrading.
 */
export type TenantAccess = 'denied' | 'expired' | 'suspended';

/** Why a membership can't be opened (null = usable). */
export function orgBlock(org: { status?: string | null; access_ends_at?: string | null }, now = Date.now()): Exclude<TenantAccess, 'denied'> | null {
  if (org.status === 'suspended') return 'suspended';
  if (org.status === 'expired') return 'expired';
  if (org.access_ends_at && new Date(org.access_ends_at).getTime() <= now) return 'expired';
  return null;
}

/** Translation keys per state and role. */
export function accessCopyKeys(state: TenantAccess, isOwner: boolean) {
  switch (state) {
    case 'denied':
      return { title: 'organizations.access.denied_title', body: 'organizations.access.denied_description' } as const;
    case 'expired':
      return { title: 'organizations.access.expired_title', body: isOwner ? 'mobile.access.expired_owner' : 'mobile.access.expired_staff' } as const;
    default:
      return { title: 'mobile.access.suspended_title', body: isOwner ? 'mobile.access.suspended_owner' : 'mobile.access.suspended_staff' } as const;
  }
}
