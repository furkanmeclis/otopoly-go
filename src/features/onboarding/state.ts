/**
 * Onboarding flags and signals (no React Native imports, so the smoke tests can use it; AsyncStorage
 * is stubbed there):
 *  - intro carousel: shown once per device before the first sign-in (`onboarding.intro_seen`),
 *  - first-run sheet: once per user per organization (`onboarding.first_run` → `{ "<user>:<org>": true }`),
 *  - "first-run settled": the push explanation sheet waits for it, so two sheets never open together,
 *  - "deep link replayed": a link opened on entry wins over the first-run sheet for this launch,
 *  - "welcome pending": the dashboard greets a business created a moment ago.
 * Everything counts as seen while the QA tour runs (screenshots must not be covered by sheets).
 */
import { qaTourEnabled } from '@/config/env';
import type { Gate, Permission } from '@/features/auth/permissions';
import { P } from '@/features/auth/permissions';
import { createLogger } from '@/lib/logger';
import { prefs, StorageKeys } from '@/lib/storage';

const log = createLogger('onboarding');

/** Overridable by the smoke tests (the QA tour is a build-time flag). */
let qaTour = qaTourEnabled;
export function setQaTourForTests(on: boolean) {
  qaTour = on;
}

// ─── Intro carousel ────────────────────────────────────────────────────────

export async function loadIntroSeen() {
  if (qaTour) return true;
  return prefs.get<boolean>(StorageKeys.onboardingIntroSeen, false);
}

export async function markIntroSeen() {
  await prefs.set(StorageKeys.onboardingIntroSeen, true);
}

const introResetListeners = new Set<() => void>();

/** The auth provider keeps `introSeen` in state; the diagnostics reset tells it. */
export function subscribeIntroReset(listener: () => void) {
  introResetListeners.add(listener);
  return () => {
    introResetListeners.delete(listener);
  };
}

// ─── First-run sheet ───────────────────────────────────────────────────────

const firstRunId = (userUuid: string, orgSlug: string) => `${userUuid}:${orgSlug}`;

export async function loadFirstRunSeen(userUuid: string, orgSlug: string) {
  if (qaTour) return true;
  const seen = await prefs.get<Record<string, boolean>>(StorageKeys.onboardingFirstRun, {});
  return Boolean(seen[firstRunId(userUuid, orgSlug)]);
}

export async function markFirstRunSeen(userUuid: string, orgSlug: string) {
  const seen = await prefs.get<Record<string, boolean>>(StorageKeys.onboardingFirstRun, {});
  await prefs.set(StorageKeys.onboardingFirstRun, { ...seen, [firstRunId(userUuid, orgSlug)]: true });
}

export type FirstRunItem = {
  key: 'services' | 'staff' | 'jobs' | 'qr' | 'assistant';
  href: '/catalog/services' | '/staff' | '/jobs/new' | '/qr-scan' | '/assistant';
};

/**
 * The 2-3 first steps the sheet suggests for this role. Owners set the business up (services, staff);
 * staff start working (open a job, sign in on the web by QR). Only steps the user may perform.
 */
export function firstRunItems(can: (gate: Permission | Gate) => boolean): FirstRunItem[] {
  const owner: FirstRunItem[] = [
    ...(can({ perm: P.catalogWrite, owner: true }) ? [{ key: 'services', href: '/catalog/services' } as const] : []),
    ...(can({ perm: P.staffWrite, owner: true }) ? [{ key: 'staff', href: '/staff' } as const] : []),
  ];
  const items: FirstRunItem[] = owner.length
    ? [...owner, ...(can(P.jobsWrite) ? [{ key: 'jobs', href: '/jobs/new' } as const] : [])]
    : [
        ...(can(P.jobsWrite) ? [{ key: 'jobs', href: '/jobs/new' } as const] : []),
        { key: 'qr', href: '/qr-scan' } as const,
        ...(can(P.aiUse) ? [{ key: 'assistant', href: '/assistant' } as const] : []),
      ];
  return items.slice(0, 3);
}

// ─── Signals (in memory, this launch only) ────────────────────────────────

let settled = false;
const settleListeners = new Set<() => void>();

/** A new organization session starts: the first-run decision is pending again. */
export function resetFirstRunSettled() {
  settled = false;
}

/** The first-run sheet was closed, or won't be shown this time. */
export function settleFirstRun() {
  if (settled) return;
  settled = true;
  settleListeners.forEach((l) => l());
}

export const isFirstRunSettled = () => settled;

/** Resolves once the first-run sheet is out of the way, or after `timeoutMs` at the latest. */
export function waitForFirstRunSettled(timeoutMs: number) {
  if (settled) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const done = (value: boolean) => {
      clearTimeout(timer);
      settleListeners.delete(listener);
      resolve(value);
    };
    const listener = () => done(true);
    const timer = setTimeout(() => {
      log.warn('First-run settle timed out');
      done(false);
    }, timeoutMs);
    settleListeners.add(listener);
  });
}

let linkReplayed = false;

/** NotificationsHost replayed a deferred deep link on entry. */
export function markDeepLinkReplayed() {
  linkReplayed = true;
}

/** Read once by the first-run host. */
export function takeDeepLinkReplayed() {
  const value = linkReplayed;
  linkReplayed = false;
  return value;
}

let welcomeSlug: string | null = null;

/** The business was created in the app a moment ago (the dashboard shows its welcome title). */
export function setWelcomePending(slug: string | null) {
  welcomeSlug = slug;
}

export const isWelcomePending = (slug: string | null | undefined) => Boolean(slug && welcomeSlug === slug);

// ─── Diagnostics ───────────────────────────────────────────────────────────

/** Diagnostics "Reset onboarding flags": the intro and every first-run sheet show again. */
export async function resetOnboardingFlags() {
  await prefs.remove(StorageKeys.onboardingIntroSeen);
  await prefs.remove(StorageKeys.onboardingFirstRun);
  settled = false;
  linkReplayed = false;
  welcomeSlug = null;
  introResetListeners.forEach((l) => l());
  log.info('Onboarding flags reset');
}
