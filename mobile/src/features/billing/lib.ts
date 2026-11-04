/**
 * Plan usage helpers (pure — no React Native imports, so the smoke tests can use them).
 *
 * Product rule: the app never sells anything. No prices, purchase links or upgrade wording;
 * the backend emails the tenant owner when a limit is hit.
 */
import type { Tone } from '@/components/ui';
import type { BillingUsageMeter, SubscriptionStatus } from '@/features/billing/types';
import type { AppLocale } from '@/lib/i18n/translate';

/** Plan feature keys the Go API knows (`billing_features`, migration 000064). */
export const PLAN_FEATURES = [
  'jobs.daily',
  'jobs.monthly',
  'staff.count',
  'customers.count',
  'storage.gb',
  'whatsapp.enabled',
  'whatsapp.monthly',
  'ai.enabled',
  'ai.monthly',
  'module.contracts',
  'module.quotes',
  'module.reports',
  'reviews.enabled',
  'reviews.monthly',
  'stock_reorder.enabled',
  'loyalty.enabled',
] as const;
export type PlanFeatureKey = (typeof PLAN_FEATURES)[number];

/** Modules that can be switched off by the plan and show the shared lock state. */
export type LockedModule = 'module.contracts' | 'module.reports' | 'module.quotes' | 'ai.enabled' | 'reviews.enabled' | 'stock_reorder.enabled' | 'loyalty.enabled';

/** Warn from this share of the limit on when the meter doesn't say otherwise. */
export const DEFAULT_WARN_PCT = 80;

export type MeterTone = 'ok' | 'warn' | 'full';

/** Translation-key fragment for a feature key: `jobs.daily` → `jobs_daily`. */
export const featureSlug = (key: string) => key.replace(/[^a-z0-9]+/gi, '_');

/** Server-provided meter label for the active locale (falls back to the key). */
export function meterLabel(meter: { label_tr?: string; label_en?: string; key: string }, locale: AppLocale) {
  return (locale === 'tr' ? meter.label_tr : meter.label_en) || meter.key;
}

export function isUnlimited(limit: number | null | undefined): boolean {
  return limit === null || limit === undefined || limit < 0;
}

/** 0–100 share of the limit used (0 when unlimited). */
export function usagePercent(used: number, limit: number | null | undefined): number {
  if (isUnlimited(limit)) return 0;
  if ((limit as number) <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / (limit as number)) * 100));
}

/** `full` at 100 %, `warn` from `warn_pct` (default 80 %), otherwise `ok`. Unlimited is always `ok`. */
export function usageTone(used: number, limit: number | null | undefined, warnPct: number = DEFAULT_WARN_PCT): MeterTone {
  if (isUnlimited(limit)) return 'ok';
  const lim = limit as number;
  if (used >= lim) return 'full';
  if (lim > 0 && used * 100 >= lim * (warnPct > 0 ? warnPct : DEFAULT_WARN_PCT)) return 'warn';
  return 'ok';
}

export const meterTone = (m: Pick<BillingUsageMeter, 'used' | 'limit' | 'warn_pct'>) => usageTone(m.used, m.limit, m.warn_pct);

export const METER_TONE: Record<MeterTone, Tone> = { ok: 'primary', warn: 'warning', full: 'danger' };

export const STATUS_TONE: Record<SubscriptionStatus, Tone> = {
  trial: 'info',
  active: 'success',
  grace: 'warning',
  read_only: 'danger',
  cancelled: 'danger',
};

/** Reset period of a limit, from the meter or, for a bare error, from the feature key. */
export function featurePeriod(key: string | undefined, meterPeriod?: string): 'day' | 'month' | 'total' {
  if (meterPeriod === 'day' || meterPeriod === 'month') return meterPeriod;
  if (meterPeriod === 'total') return 'total';
  if (key?.endsWith('.daily')) return 'day';
  if (key?.endsWith('.monthly')) return 'month';
  return 'total';
}

/**
 * Translation key for the LIMIT_REACHED dialog body. When the API says `owner_notified: "true"`, owners
 * are told the details went to their e-mail and staff that their manager was informed; otherwise
 * (`"false"`, or an older API without the detail) the neutral variant claims neither.
 * Never mentions buying or upgrading.
 */
export function limitReachedMessageKey(isOwner: boolean, period: 'day' | 'month' | 'total', ownerNotified?: boolean) {
  return `mobile.plan.limit.${isOwner ? 'owner' : 'staff'}_${period}${ownerNotified === true ? '' : '_neutral'}` as const;
}

/**
 * `403 SUBSCRIPTION_READ_ONLY` dialog body: the plan period ended, records can still be viewed.
 * Same tone as the limit dialog; nothing about renewing or buying.
 */
export function readOnlyMessageKey(isOwner: boolean) {
  return `mobile.plan.read_only_dialog.${isOwner ? 'owner' : 'staff'}` as const;
}

/** Translation key for the FEATURE_DISABLED lock state body. */
export function featureLockedMessageKey(isOwner: boolean) {
  return `mobile.plan.locked.${isOwner ? 'owner' : 'staff'}` as const;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Lower-case noun for a limited feature, used inside the limit sentence ("müşteri kaydı"). */
export function limitFeatureNoun(t: Translate, feature: string | undefined) {
  const key = `mobile.plan.feature.${featureSlug(feature ?? 'unknown')}`;
  const text = t(key);
  return text === key ? t('mobile.plan.feature.unknown') : text;
}

/** Sentence-start name of a module the plan can switch off ("Sözleşme modülü"). */
export function moduleName(t: Translate, feature: LockedModule | string) {
  const key = `mobile.plan.module.${featureSlug(feature)}`;
  const text = t(key);
  return text === key ? feature : text;
}

/** Full LIMIT_REACHED dialog body for the viewer's role. */
export function limitReachedMessage(
  t: Translate,
  opts: { isOwner: boolean; feature?: string; used?: number; limit?: number; ownerNotified?: boolean; meterPeriod?: string; formatNumber?: (n: number) => string },
) {
  const num = (n: number | undefined) => (n === undefined ? '—' : opts.formatNumber ? opts.formatNumber(n) : String(n));
  return t(limitReachedMessageKey(opts.isOwner, featurePeriod(opts.feature, opts.meterPeriod), opts.ownerNotified), {
    feature: limitFeatureNoun(t, opts.feature),
    used: num(opts.used),
    limit: num(opts.limit),
  });
}
