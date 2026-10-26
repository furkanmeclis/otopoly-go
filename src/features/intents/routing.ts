/**
 * Siri / Shortcuts invocations → app navigation. Pure (no React Native imports) so the smoke tests can
 * run it in Node (`scripts/smoke/intents.smoke.ts`).
 *
 * The Swift intents (app-intents/OtopolyIntents.swift) dispatch these names and params; they are a
 * contract with shortcuts users already saved, so keep them stable.
 */
import { P, type Gate } from '@/features/auth/permissions';

export const INTENT_NAMES = ['newJob', 'searchPlate', 'openCustomer', 'readyJobs', 'askAssistant', 'qrLogin', 'calendarToday'] as const;
export type IntentName = (typeof INTENT_NAMES)[number];

/** Parameterless daily summary (answered natively, never dispatched); listed for donations and settings. */
export type ShortcutName = IntentName | 'todaySummary';

/** Same permission the target screen requires, so Siri never opens a screen that answers "no access". */
export const INTENT_GATES: Record<ShortcutName, Gate | undefined> = {
  todaySummary: { perm: P.jobsRead },
  newJob: { perm: P.jobsWrite },
  searchPlate: { perm: P.customersRead },
  openCustomer: { perm: P.customersRead },
  readyJobs: { perm: P.jobsRead },
  askAssistant: { perm: P.aiUse },
  qrLogin: undefined,
  calendarToday: { perm: P.calendarRead },
};

/** An invocation older than this is not acted on (the user asked Siri, then signed in much later). */
export const INVOCATION_TTL_MS = 10 * 60_000;

export type Invocation = { id: string; name: string; params: Record<string, unknown>; createdAt: number };

export type IntentDecision =
  /** Navigate to `href` right away. */
  | { kind: 'route'; href: string; name: IntentName }
  /** Look the plate up first (needs the API), then navigate. */
  | { kind: 'plate'; plate: string; target: 'newJob' | 'search' }
  /** Known intent, but the member's role does not allow it. */
  | { kind: 'denied'; name: IntentName }
  /** Unknown name or unusable params: discard. */
  | { kind: 'invalid' };

/** Backend `NormalizePlate`: upper case, no spaces or dashes ("34 abc-12" → "34ABC12"). */
export function normalizePlate(raw: string) {
  return raw.replace(/[\s-]+/g, '').toUpperCase();
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isIntentName = (name: string): name is IntentName => (INTENT_NAMES as readonly string[]).includes(name);

/** Where an invocation leads for a member who passes `can`. */
export function decideIntent(invocation: Pick<Invocation, 'id' | 'name' | 'params'>, can: (gate: Gate | undefined) => boolean): IntentDecision {
  const { name, params } = invocation;
  if (!isIntentName(name)) return { kind: 'invalid' };
  if (!can(INTENT_GATES[name])) return { kind: 'denied', name };
  switch (name) {
    case 'newJob': {
      const plate = normalizePlate(str(params.plate));
      // Looking a plate up needs customers.read; without it the form still opens empty.
      return plate && can({ perm: P.customersRead }) ? { kind: 'plate', plate, target: 'newJob' } : { kind: 'route', href: '/jobs/new', name };
    }
    case 'searchPlate': {
      const plate = normalizePlate(str(params.plate));
      return plate ? { kind: 'plate', plate, target: 'search' } : { kind: 'route', href: '/customers', name };
    }
    case 'openCustomer': {
      const id = str(params.customerId);
      return /^[A-Za-z0-9-]{1,64}$/.test(id) ? { kind: 'route', href: `/customers/${id}`, name } : { kind: 'invalid' };
    }
    case 'readyJobs':
      return { kind: 'route', href: '/operations?filter=ready', name };
    case 'askAssistant': {
      // Same limit as a typed message would get; the chat screen sends it once (nonce = invocation id).
      const prompt = str(params.prompt).slice(0, 2000);
      const query = prompt ? `prompt=${encodeURIComponent(prompt)}&n=${encodeURIComponent(invocation.id)}` : `n=${encodeURIComponent(invocation.id)}`;
      return { kind: 'route', href: `/assistant/new?${query}`, name };
    }
    case 'qrLogin':
      return { kind: 'route', href: '/qr-scan', name };
    case 'calendarToday':
      return { kind: 'route', href: '/calendar', name };
  }
}

/**
 * Of a pending snapshot, only the newest fresh invocation navigates (replaying an old queue would push
 * screen after screen); everything else is acknowledged and dropped.
 */
export function pickInvocation<T extends Pick<Invocation, 'id' | 'createdAt'>>(pending: T[], now: number, handled: ReadonlySet<string> = new Set()) {
  const fresh = pending.filter((i) => !handled.has(i.id) && now - i.createdAt <= INVOCATION_TTL_MS && i.createdAt <= now + 60_000);
  const run = fresh.reduce<T | null>((best, i) => (!best || i.createdAt >= best.createdAt ? i : best), null);
  return { run, discard: pending.filter((i) => i !== run) };
}

/** A matching customer for a looked-up plate: exactly one hit is unambiguous. */
export type PlateLookup = { customers: { uuid: string }[]; vehicles?: { uuid: string; plate: string }[] };

/** Final href after a plate lookup (`customers` = search results for the plate). */
export function plateHref(target: 'newJob' | 'search', plate: string, lookup: PlateLookup | null) {
  const single = lookup && lookup.customers.length === 1 ? lookup.customers[0] : null;
  if (target === 'search') return single ? `/customers/${single.uuid}` : `/customers?q=${encodeURIComponent(plate)}`;
  if (!single) return '/jobs/new';
  const vehicle = lookup?.vehicles?.find((v) => normalizePlate(v.plate) === plate);
  return vehicle ? `/jobs/new?customer=${single.uuid}&vehicle=${vehicle.uuid}` : `/jobs/new?customer=${single.uuid}`;
}
