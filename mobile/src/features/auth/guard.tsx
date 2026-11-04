import type { ReactNode } from 'react';

import { Header, ForbiddenState, Screen } from '@/components/ui';

import { useAuth } from './auth-provider';
import type { Gate, Permission } from './permissions';

/** Renders children only when the gate passes (hides actions the user can't perform). */
export function Can({ gate, children, fallback = null }: { gate: Permission | Gate | undefined; children: ReactNode; fallback?: ReactNode }) {
  return useAuth().can(gate) ? <>{children}</> : <>{fallback}</>;
}

/**
 * Screen-level guard: deep links and stale navigation can reach a screen the user may not see,
 * so every protected route wraps its content in this (same as web `use-tenant-*-access` hooks).
 */
export function RequirePermission({ gate, title, children }: { gate: Permission | Gate; title: string; children: ReactNode }) {
  const { can } = useAuth();
  if (can(gate)) return <>{children}</>;
  return (
    <Screen header={<Header title={title} />}>
      <ForbiddenState />
    </Screen>
  );
}
