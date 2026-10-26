/**
 * What the app shares with Siri / Shortcuts, and when it donates. Pure (no React Native imports) so the
 * rules are covered by `scripts/smoke/intents.smoke.ts`.
 *
 * Privacy: the device keeps these catalogs in UserDefaults and Siri reads them while the app is closed,
 * so they hold the minimum — today's counts and collected total (when the member can see them), and the
 * names + plates of recently served customers (no phone, e-mail, balance or notes). Everything is wiped
 * on sign-out and on organization switch.
 */
import type { Gate } from '@/features/auth/permissions';

import { INTENT_GATES, normalizePlate, type ShortcutName } from './routing';

/** Kinds read by app-intents/OtopolySupport.swift (`OtopolyCatalog`). */
export const CATALOG_KINDS = { today: 'otopoly.today', customers: 'otopoly.customer' } as const;

export type CatalogEntity = { id: string; title: string; subtitle?: string; synonyms?: string[]; metadata?: Record<string, string> };

// ─── Today's summary ───────────────────────────────────────────────────────

export type TodayFigures = { inProgress: number; ready: number; delivered: number; collected: string };

type TodayJob = { status: string; delivered_at?: string | null };

/**
 * Same counts as the dashboard "Bugün" tiles and the widget: open jobs by status, delivered since
 * yesterday (the list carries open jobs over), `collected` already formatted ('' = hidden).
 */
export function todayFigures(jobs: TodayJob[], yesterday: string, collected: string): TodayFigures {
  return {
    inProgress: jobs.filter((j) => j.status === 'in_progress').length,
    ready: jobs.filter((j) => j.status === 'ready').length,
    delivered: jobs.filter((j) => j.status === 'delivered' && (j.delivered_at ?? '').slice(0, 10) >= yesterday).length,
    collected,
  };
}

/** The single `today` record Siri answers "Bugün kaç araç var?" from. */
export function todayRecord(input: { org: string; date: string; updated: string; figures: TodayFigures | null }): CatalogEntity {
  const { org, date, updated, figures } = input;
  return {
    id: 'today',
    // A record needs a non-blank title; the organization name is what Siri reads out first.
    title: org.trim() || 'Otopoly',
    metadata: figures
      ? {
          state: 'ok',
          date,
          updated,
          inProgress: String(figures.inProgress),
          ready: String(figures.ready),
          delivered: String(figures.delivered),
          collected: figures.collected,
        }
      : { state: 'noAccess', date, updated },
  };
}

// ─── Customers ─────────────────────────────────────────────────────────────

export type JobLike = { customer_uuid: string; customer_name: string; plate: string; started_at?: string | null };

/** Siri disambiguates by speech; past this many names it gets slower, and the catalog lives in UserDefaults. */
export const CUSTOMER_CATALOG_LIMIT = 40;

/**
 * Most frequently / recently served customers from recent jobs: name as the title, plates as the
 * subtitle and as synonyms (so "34 ABC 12" resolves the owner too).
 */
export function customerCatalog(jobs: JobLike[], limit = CUSTOMER_CATALOG_LIMIT): CatalogEntity[] {
  const byId = new Map<string, { name: string; plates: string[]; count: number; last: number }>();
  for (const job of jobs) {
    const id = job.customer_uuid?.trim();
    const name = job.customer_name?.trim();
    if (!id || !name) continue;
    const at = job.started_at ? new Date(job.started_at).getTime() || 0 : 0;
    const entry = byId.get(id) ?? { name, plates: [], count: 0, last: 0 };
    entry.count += 1;
    entry.last = Math.max(entry.last, at);
    const plate = job.plate?.trim();
    if (plate && !entry.plates.some((p) => normalizePlate(p) === normalizePlate(plate))) entry.plates.push(plate);
    byId.set(id, entry);
  }
  return [...byId.entries()]
    .sort(([, a], [, b]) => b.count - a.count || b.last - a.last || a.name.localeCompare(b.name, 'tr'))
    .slice(0, limit)
    .map(([id, c]) => {
      const plates = c.plates.slice(0, 3);
      return {
        id,
        title: c.name,
        ...(plates.length ? { subtitle: plates.join(' · ') } : {}),
        synonyms: [...new Set(plates.flatMap((p) => [p, normalizePlate(p)]))],
      };
    });
}

// ─── Donations ─────────────────────────────────────────────────────────────

/** Intents the app donates (registered in app-intents/AppIntentsSetup.swift). Free text is never donated. */
export const DONATABLE = ['todaySummary', 'newJob', 'readyJobs', 'qrLogin', 'calendarToday', 'openCustomer'] as const;
export type DonatableName = (typeof DONATABLE)[number];

/** One donation per intent (and customer) in this window is plenty for Siri to learn the habit. */
export const DONATION_INTERVAL_MS = 6 * 60 * 60_000;

export type DonationRequest = { name: DonatableName; customerId?: string };

export const donationKey = (req: DonationRequest) => (req.customerId ? `${req.name}:${req.customerId}` : req.name);

/**
 * Whether to donate now: the member may use the intent, it was not donated recently, and an
 * `openCustomer` donation refers to a customer Siri can resolve (published in the catalog).
 */
export function shouldDonate(
  req: DonationRequest,
  ctx: { can: (gate: Gate | undefined) => boolean; lastAt?: number; now: number; publishedCustomers: ReadonlySet<string> },
) {
  if (!(DONATABLE as readonly string[]).includes(req.name)) return false;
  if (!ctx.can(INTENT_GATES[req.name as ShortcutName])) return false;
  if (req.name === 'openCustomer' && (!req.customerId || !ctx.publishedCustomers.has(req.customerId))) return false;
  if (req.name !== 'openCustomer' && req.customerId) return false;
  return ctx.lastAt === undefined || ctx.now - ctx.lastAt >= DONATION_INTERVAL_MS;
}

/** Shortcuts shown on the settings card for this member (same gates as routing). */
export function availableShortcuts(can: (gate: Gate | undefined) => boolean): ShortcutName[] {
  return (Object.keys(INTENT_GATES) as ShortcutName[]).filter((name) => can(INTENT_GATES[name]));
}
