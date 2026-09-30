/** Ported from web `features/quotes/lib/quote-ui.ts` + `delivery-error.ts`. */
import type { Tone } from '@/components/ui';
import type { DiscountType, QuoteStatus } from '@/features/quotes/types';

export function quoteStatusTone(status: QuoteStatus | string): Tone {
  switch (status) {
    case 'sent':
    case 'viewed':
      return 'warning';
    case 'accepted':
      return 'success';
    case 'rejected':
    case 'expired':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Stepper order for the happy path. */
export const QUOTE_STEPS: QuoteStatus[] = ['draft', 'sent', 'viewed', 'accepted'];

export const isOpenQuote = (status: QuoteStatus) => status === 'draft' || status === 'sent' || status === 'viewed';

/** Web list row stripe colour per status (jobs board colours). */
export function quoteAccent(status: QuoteStatus): Tone | null {
  switch (status) {
    case 'sent':
      return 'info';
    case 'viewed':
      return 'warning';
    case 'accepted':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return null;
  }
}

/* ---- live totals preview (server recomputes; this only mirrors backend ComputeTotals) ---- */

const ZERO = BigInt(0);

function toCents(raw: string | undefined | null): bigint {
  const s = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (!s || !/^\d*(\.\d*)?$/.test(s)) return ZERO;
  const [i, f = ''] = s.split('.');
  const frac3 = (f + '000').slice(0, 3);
  let cents = BigInt(i || '0') * BigInt(100) + BigInt(frac3.slice(0, 2));
  if (Number(frac3[2]) >= 5) cents += BigInt(1);
  return cents;
}

/** Decimal as a scaled integer with 3 decimals (quantities, rates). */
function toMilli(raw: string | undefined | null): bigint {
  const s = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (!s || !/^\d*(\.\d*)?$/.test(s)) return ZERO;
  const [i, f = ''] = s.split('.');
  return BigInt(i || '0') * BigInt(1000) + BigInt((f + '000').slice(0, 3));
}

function divRound(n: bigint, d: bigint): bigint {
  if (d === ZERO) return ZERO;
  const q = n / d;
  const r = n % d;
  return r * BigInt(2) >= d ? q + BigInt(1) : q;
}

export function centsToString(c: bigint): string {
  const neg = c < ZERO;
  const a = neg ? -c : c;
  const s = `${a / BigInt(100)}.${(a % BigInt(100)).toString().padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

export type DraftLine = { quantity: string; unit_price: string; discount_type: DiscountType; discount_value: string; vat_rate: string };
export type DraftTotals = { lines: { total: string; net: string }[]; subtotal: string; discount: string; vat: string; grand: string };

function discountCents(base: bigint, type: DiscountType, value: string): bigint {
  if (type === 'percent') {
    const d = divRound(base * toMilli(value), BigInt(100_000));
    return d > base ? base : d;
  }
  if (type === 'amount') {
    const d = toCents(value);
    return d > base ? base : d;
  }
  return ZERO;
}

/** Mirrors backend ComputeTotals (half-up, pro-rata quote discount). */
export function computeDraftTotals(lines: DraftLine[], quoteDiscountType: DiscountType, quoteDiscountValue: string, pricesIncludeVat: boolean): DraftTotals {
  const work = lines.map((l) => {
    const sub = divRound(toMilli(l.quantity) * toCents(l.unit_price), BigInt(1000));
    const disc = discountCents(sub, l.discount_type, l.discount_value);
    return { sub, disc, after: sub - disc, share: ZERO, rate: toMilli(l.vat_rate) };
  });
  const sumSub = work.reduce((a, w) => a + w.sub, ZERO);
  const sumDisc = work.reduce((a, w) => a + w.disc, ZERO);
  const sumAfter = work.reduce((a, w) => a + w.after, ZERO);
  const qd = discountCents(sumAfter, quoteDiscountType, quoteDiscountValue);
  if (qd > ZERO && sumAfter > ZERO) {
    let last = -1;
    work.forEach((w, i) => {
      if (w.after > ZERO) last = i;
    });
    let allocated = ZERO;
    for (let i = 0; i < work.length; i++) {
      const w = work[i]!;
      if (w.after === ZERO) continue;
      if (i === last) {
        w.share = qd - allocated;
        break;
      }
      let share = divRound(qd * w.after, sumAfter);
      if (share > w.after) share = w.after;
      w.share = share;
      allocated += share;
    }
  }
  let vat = ZERO;
  let grand = ZERO;
  const out = work.map((w) => {
    const net = w.after - w.share < ZERO ? ZERO : w.after - w.share;
    const v = pricesIncludeVat ? divRound(net * w.rate, BigInt(100_000) + w.rate) : divRound(net * w.rate, BigInt(100_000));
    const total = pricesIncludeVat ? net : net + v;
    vat += v;
    grand += total;
    return { total: centsToString(total), net: centsToString(net) };
  });
  return { lines: out, subtotal: centsToString(sumSub), discount: centsToString(sumDisc + qd), vat: centsToString(vat), grand: centsToString(grand) };
}

/* ---- delivery errors ---- */

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Localized text for a quote delivery error (stable backend prefixes). */
export function deliveryErrorText(error: string | null | undefined, t: Translate) {
  const e = (error ?? '').trim();
  if (e === 'not configured') return t('quotes.send.not_configured');
  if (e.startsWith('whatsapp_not_connected')) return t('quotes.send.wa_not_connected');
  if (e.startsWith('customer_no_phone') || e === 'customer has no phone number') return t('quotes.send.no_phone_error');
  return e;
}

export const isWhatsAppNotConnected = (error: string | null | undefined) => (error ?? '').startsWith('whatsapp_not_connected');

/** Whole days from today to a yyyy-MM-dd date (negative = past). */
export function daysUntil(day: string, today: string): number {
  const [ay, am, ad] = today.split('-').map(Number);
  const [by, bm, bd] = day.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
