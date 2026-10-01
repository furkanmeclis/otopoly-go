/**
 * Demo-only plan scenario for the in-app mock (switched from the diagnostics screen).
 * Kept free of mock DB imports so the diagnostics screen can read it without loading the mock.
 *
 *   normal            — comfortable usage, every module on
 *   near_limit        — several meters at ≥ 80 % (warning tone), writes still succeed
 *   at_limit          — jobs / customers / staff / WhatsApp full; creates answer 409 LIMIT_REACHED
 *   feature_disabled  — contracts, reports and the assistant are off; 403 FEATURE_DISABLED
 */
import { prefs, StorageKeys } from '@/lib/storage';

export const PLAN_SCENARIOS = ['normal', 'near_limit', 'at_limit', 'feature_disabled'] as const;
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
