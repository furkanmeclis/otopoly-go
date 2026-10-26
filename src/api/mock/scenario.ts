/**
 * Demo-only plan scenario for the in-app mock (switched from the diagnostics screen).
 * Kept free of mock DB imports so the diagnostics screen can read it without loading the mock.
 *
 *   normal            — comfortable usage, every module on
 *   near_limit        — several meters at ≥ 80 % (warning tone), writes still succeed
 *   at_limit          — jobs / customers / staff / WhatsApp full; creates answer 409 LIMIT_REACHED
 *   feature_disabled  — contracts, reports, the assistant and reorder suggestions are off; 403 FEATURE_DISABLED
 *   quotes_disabled   — the quotes & leads module (`module.quotes`) is off; 403 FEATURE_DISABLED
 *   read_only         — the plan period ended: every tenant write answers 403 SUBSCRIPTION_READ_ONLY
 *
 * A second, independent switch sets the organization's access state (web `TenantRouteGuard`):
 *   normal · expired (`access_ends_at` passed) · suspended · removed (no membership)
 */
import { prefs, StorageKeys } from '@/lib/storage';

export const PLAN_SCENARIOS = ['normal', 'near_limit', 'at_limit', 'feature_disabled', 'quotes_disabled', 'read_only'] as const;
export type PlanScenario = (typeof PLAN_SCENARIOS)[number];

let current: PlanScenario = 'normal';
const listeners = new Set<() => void>();

export const getPlanScenario = () => current;

export function setPlanScenario(next: PlanScenario) {
  if (next === current) return;
  current = next;
  prefs.set(StorageKeys.demoPlanScenario, next).catch(() => {});
  listeners.forEach((l) => l());
}

export function subscribePlanScenario(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadPlanScenario() {
  const saved = await prefs.get<string>(StorageKeys.demoPlanScenario, 'normal');
  current = (PLAN_SCENARIOS as readonly string[]).includes(saved) ? (saved as PlanScenario) : 'normal';
  listeners.forEach((l) => l());
  return current;
}

// ─── Organization access state ─────────────────────────────────────────────

export const ACCESS_SCENARIOS = ['normal', 'expired', 'suspended', 'removed'] as const;
export type AccessScenario = (typeof ACCESS_SCENARIOS)[number];

let access: AccessScenario = 'normal';
const accessListeners = new Set<() => void>();

export const getAccessScenario = () => access;

export function setAccessScenario(next: AccessScenario) {
  if (next === access) return;
  access = next;
  prefs.set(StorageKeys.demoAccessScenario, next).catch(() => {});
  accessListeners.forEach((l) => l());
}

export function subscribeAccessScenario(listener: () => void) {
  accessListeners.add(listener);
  return () => {
    accessListeners.delete(listener);
  };
}

export async function loadAccessScenario() {
  const saved = await prefs.get<string>(StorageKeys.demoAccessScenario, 'normal');
  access = (ACCESS_SCENARIOS as readonly string[]).includes(saved) ? (saved as AccessScenario) : 'normal';
  accessListeners.forEach((l) => l());
  return access;
}
