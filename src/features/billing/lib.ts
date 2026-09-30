import type { AppLocale } from '@/lib/i18n/translate';
import type { BillingInvoice, BillingOrder, BillingPlanFeatureValue, BillingSubscription, BillingUsageMeter } from '@/features/billing/types';
import type { Tone } from '@/components/ui';

/** Same helpers as web `features/billing/lib.ts`. */
export function meterLabel(meter: { label_tr?: string; label_en?: string; key: string }, locale: AppLocale) {
  return (locale === 'tr' ? meter.label_tr : meter.label_en) || meter.key;
}

export function meterUnlimited(meter: BillingUsageMeter) {
  return meter.limit === null || meter.limit === undefined || meter.limit < 0;
}

export function meterTone(meter: BillingUsageMeter): 'ok' | 'warn' | 'over' {
  if (meterUnlimited(meter)) return 'ok';
  const limit = meter.limit as number;
  if (meter.used >= limit) return 'over';
  if (limit > 0 && meter.used * 100 >= limit * meter.warn_pct) return 'warn';
  return 'ok';
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** One human line for a plan feature: "Günlük işlem: 50 adet", "Yapay zekâ asistanı: Dahil". */
export function planFeatureLine(f: BillingPlanFeatureValue, locale: AppLocale, t: Translate): string {
  if (f.display_text) return f.display_text;
  const label = (locale === 'tr' ? f.label_tr : f.label_en) || f.key;
  if (f.value_bool !== null && f.value_bool !== undefined) return `${label}: ${f.value_bool ? t('billing.features.on') : t('billing.features.off')}`;
  if (f.value_int !== null && f.value_int !== undefined) {
    const n = new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US').format(f.value_int);
    return `${label}: ${n}${f.unit ? ` ${f.unit}` : ''}`;
  }
  return `${label}: ${t('billing.usage.unlimited')}`;
}

export const STATUS_TONE: Record<BillingSubscription['status'], Tone> = {
  trial: 'info',
  active: 'success',
  grace: 'warning',
  read_only: 'danger',
  cancelled: 'danger',
};

export const ORDER_TONE: Record<BillingOrder['status'], Tone> = {
  pending_payment: 'warning',
  payment_reported: 'info',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
};

export const INVOICE_TONE: Record<BillingInvoice['status'], Tone> = {
  issued: 'success',
  failed: 'warning',
  voided: 'neutral',
};
