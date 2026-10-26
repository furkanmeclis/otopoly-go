/**
 * "Getting started" checklist progress, per user and organization (no React Native imports, so the smoke
 * tests can use it). The backend has no onboarding-progress endpoint, so progress lives on the device
 * (`onboarding.setup.<userUuid>:<orgSlug>`). A step counts as done once the data shows it (first customer,
 * first job…) and stays done even if that record is later deleted; the user can also skip a step, hide the
 * card and bring it back from the menu.
 */
import type { Gate, Permission } from '@/features/auth/permissions';
import { P } from '@/features/auth/permissions';
import { prefs, StorageKeys } from '@/lib/storage';

export type SetupKey = 'services' | 'customer' | 'job' | 'sale' | 'whatsapp' | 'staff' | 'contract';

export type SetupItem = {
  key: SetupKey;
  href: '/catalog/services' | '/customers/form' | '/jobs/new' | '/sales/new' | '/settings/messaging' | '/staff' | '/contracts/templates';
};

export type SetupState = {
  done: Partial<Record<SetupKey, true>>;
  skipped: Partial<Record<SetupKey, true>>;
  dismissed: boolean;
  /** The "all done" card was shown once; afterwards the card stays away. */
  celebrated: boolean;
};

export const EMPTY_SETUP: SetupState = { done: {}, skipped: {}, dismissed: false, celebrated: false };

const ALL: (SetupItem & { gate: Permission | Gate })[] = [
  { key: 'services', href: '/catalog/services', gate: { perm: P.catalogWrite, owner: true } },
  { key: 'customer', href: '/customers/form', gate: P.customersWrite },
  { key: 'job', href: '/jobs/new', gate: P.jobsWrite },
  { key: 'sale', href: '/sales/new', gate: P.salesWrite },
  { key: 'whatsapp', href: '/settings/messaging', gate: { perm: P.messagingWrite, owner: true } },
  { key: 'staff', href: '/staff', gate: { perm: P.staffWrite, owner: true } },
  { key: 'contract', href: '/contracts/templates', gate: P.contractsWrite },
];

/** The steps this user can actually perform, in the suggested order. */
export function setupItems(can: (gate: Permission | Gate) => boolean): SetupItem[] {
  return ALL.filter((i) => can(i.gate)).map(({ key, href }) => ({ key, href }));
}

const storageKey = (userUuid: string, orgSlug: string) => `${StorageKeys.onboardingSetup}.${userUuid}:${orgSlug}`;

export async function loadSetup(userUuid: string, orgSlug: string): Promise<SetupState> {
  const stored = await prefs.get<Partial<SetupState> | null>(storageKey(userUuid, orgSlug), null);
  // Card hidden before progress was stored per user: keep it hidden.
  if (!stored && (await prefs.get<boolean>(`${StorageKeys.dismissedSetup}.${orgSlug}`, false))) return { ...EMPTY_SETUP, dismissed: true };
  return { ...EMPTY_SETUP, ...stored, done: { ...stored?.done }, skipped: { ...stored?.skipped } };
}

export async function saveSetup(userUuid: string, orgSlug: string, state: SetupState) {
  await prefs.set(storageKey(userUuid, orgSlug), state);
  listeners.forEach((l) => l(userUuid, orgSlug));
}

/** Adds what the data shows now; returns the same object when nothing changed (no needless write). */
export function withObserved(state: SetupState, observed: Partial<Record<SetupKey, boolean>>): SetupState {
  const added = (Object.keys(observed) as SetupKey[]).filter((k) => observed[k] && !state.done[k]);
  if (!added.length) return state;
  const done = { ...state.done };
  for (const k of added) done[k] = true;
  return { ...state, done };
}

export const isComplete = (state: SetupState, k: SetupKey) => Boolean(state.done[k] || state.skipped[k]);

/** `{ done, total }` over the given items (skipped steps count as handled). */
export function setupProgress(state: SetupState, items: SetupItem[]) {
  return { done: items.filter((i) => isComplete(state, i.key)).length, total: items.length };
}

type Listener = (userUuid: string, orgSlug: string) => void;
const listeners = new Set<Listener>();

/** Home re-reads the state when the menu brings the card back. */
export function subscribeSetup(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Menu → "Getting started": shows the card again (finished steps stay finished). */
export async function reopenSetup(userUuid: string, orgSlug: string) {
  const state = await loadSetup(userUuid, orgSlug);
  await saveSetup(userUuid, orgSlug, { ...state, dismissed: false, celebrated: false, skipped: {} });
}
