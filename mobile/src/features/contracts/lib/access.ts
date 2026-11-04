import type { Tone } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';

/** Web `useTenantContractsAccess`: templates + voids are owner-only writes (backend `tOwnerWrite`). */
export function useContractsAccess() {
  const { can, isOwner } = useAuth();
  const canRead = can(P.contractsRead);
  const canWrite = can(P.contractsWrite);
  return { isOwner, canRead, canWrite, canManage: isOwner && canWrite };
}

type T = (key: string, params?: Record<string, string | number>) => string;

export function instanceStatusTone(status: string): Tone {
  switch (status) {
    case 'executed':
      return 'success';
    case 'pending':
    case 'pending_signatures':
      return 'warning';
    case 'voided':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Translated status with the raw value as fallback (same as the web StatusChip label). */
export function instanceStatusLabel(t: T, status: string) {
  const key = `contracts.instances.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

export function signerStatusLabel(t: T, status: string) {
  const key = `contracts.instances.signer_status.${status}`;
  const label = t(key);
  return label === key ? status : label;
}
