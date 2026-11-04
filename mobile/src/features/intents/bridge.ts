/**
 * Thin, fail-soft wrapper around `expo-app-intents`. Everything is a no-op where App Intents are
 * unavailable (Android, web, Expo Go, iOS builds without the native module), so callers never branch.
 */
import * as AppIntents from 'expo-app-intents';
import { Linking, Platform } from 'react-native';

import type { Gate } from '@/features/auth/permissions';
import { createLogger } from '@/lib/logger';
import { prefs } from '@/lib/storage';

import { CATALOG_KINDS, DONATABLE, donationKey, shouldDonate, type CatalogEntity, type DonationRequest } from './catalog';

const log = createLogger('intents');

let availableCache: boolean | null = null;

export function intentsAvailable() {
  if (availableCache === null) {
    try {
      availableCache = Platform.OS === 'ios' && AppIntents.isAvailable();
    } catch {
      availableCache = false;
    }
    log.info(availableCache ? 'App Intents ready' : 'App Intents unavailable in this runtime');
  }
  return availableCache;
}

// ─── Catalogs ──────────────────────────────────────────────────────────────

const publishing = new Map<string, Promise<void>>();
const lastPublished = new Map<string, string>();
let publishedCustomers = new Set<string>();

/** Replaces a catalog; calls for one kind are serialized so an older list never overwrites a newer one. */
export function publishCatalog(kind: string, entities: CatalogEntity[]) {
  if (!intentsAvailable()) return Promise.resolve();
  const key = JSON.stringify(entities);
  const prev = publishing.get(kind) ?? Promise.resolve();
  const next = prev.then(async () => {
    if (lastPublished.get(kind) === key) return;
    try {
      await AppIntents.setEntityCatalogAsync(kind, entities);
      lastPublished.set(kind, key);
      if (kind === CATALOG_KINDS.customers) publishedCustomers = new Set(entities.map((e) => e.id));
      log.debug('Catalog published', { kind, count: entities.length });
    } catch (error) {
      log.warn('Catalog publish failed', { kind, error });
    }
  });
  publishing.set(kind, next);
  return next;
}

/** Asks iOS to re-read shortcut phrases and parameters (after an organization / role change). */
export async function refreshShortcuts() {
  if (!intentsAvailable()) return;
  try {
    await AppIntents.refreshShortcutsAsync();
  } catch (error) {
    log.debug('Shortcut refresh skipped', error);
  }
}

// ─── Donations ─────────────────────────────────────────────────────────────

const lastDonation = new Map<string, number>();

/** Donates after the user did the action in the app (see `shouldDonate` for the rules). Never throws. */
export async function donateIntent(req: DonationRequest, can: (gate: Gate | undefined) => boolean) {
  if (!intentsAvailable()) return;
  const key = donationKey(req);
  const now = Date.now();
  if (!shouldDonate(req, { can, lastAt: lastDonation.get(key), now, publishedCustomers })) return;
  lastDonation.set(key, now);
  try {
    await AppIntents.donateIntentAsync(req.name, req.customerId ? { customerId: req.customerId } : {});
    log.debug('Intent donated', { name: req.name });
  } catch (error) {
    log.warn('Intent donation failed', { name: req.name, error });
  }
}

/** Forgets every donation (sign-out, organization switch, "clear suggestions"). */
export async function deleteAllDonations() {
  lastDonation.clear();
  if (!intentsAvailable()) return;
  await Promise.all(
    DONATABLE.map((intent) =>
      AppIntents.deleteDonationsAsync({ intent }).catch((error) => log.warn('Donation delete failed', { intent, error })),
    ),
  );
}

/** Sign-out / organization switch: nothing of the previous business stays readable by Siri. */
export async function clearIntentsData(reason: string) {
  if (!intentsAvailable()) return;
  log.info('Clearing Siri data', { reason });
  // Pending invocations stay: a request made while signed out runs after sign-in (routing TTL applies).
  await Promise.all([publishCatalog(CATALOG_KINDS.today, []), publishCatalog(CATALOG_KINDS.customers, []), deleteAllDonations()]);
}

// ─── "Share customer names with Siri" preference ───────────────────────────

const SHARE_KEY = 'intents.share_customers';
let shareCustomers: boolean | null = null;
const shareListeners = new Set<(value: boolean) => void>();

export async function loadShareCustomers() {
  if (shareCustomers === null) shareCustomers = await prefs.get<boolean>(SHARE_KEY, true);
  return shareCustomers;
}

export function setShareCustomers(value: boolean) {
  shareCustomers = value;
  void prefs.set(SHARE_KEY, value);
  for (const listener of shareListeners) listener(value);
}

export function subscribeShareCustomers(listener: (value: boolean) => void) {
  shareListeners.add(listener);
  return () => {
    shareListeners.delete(listener);
  };
}

/** Opens the Shortcuts app (where the Otopoly shortcuts are listed); false when it can't be opened. */
export async function openShortcutsApp() {
  try {
    await Linking.openURL('shortcuts://');
    return true;
  } catch (error) {
    log.warn('Shortcuts app could not be opened', error);
    return false;
  }
}
