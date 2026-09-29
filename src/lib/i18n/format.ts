import type { AppLocale } from './translate';

const INTL_LOCALE: Record<AppLocale, string> = { tr: 'tr-TR', en: 'en-US' };

/** API amounts are decimal strings ("1250.00"); never trust them to be numbers. */
export function toNumber(value: string | number | null | undefined): number {
  if (value == null || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export type Formatters = ReturnType<typeof createFormatters>;

export function createFormatters(locale: AppLocale) {
  const tag = INTL_LOCALE[locale];
  const moneyCache = new Map<string, Intl.NumberFormat>();

  const moneyFormatter = (currency: string, compact: boolean) => {
    const key = `${currency}:${compact}`;
    let f = moneyCache.get(key);
    if (!f) {
      f = new Intl.NumberFormat(tag, {
        style: 'currency',
        currency: currency || 'TRY',
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : 2,
        minimumFractionDigits: compact ? 0 : 2,
      });
      moneyCache.set(key, f);
    }
    return f;
  };

  return {
    locale: tag,
    money(value: string | number | null | undefined, currency = 'TRY') {
      return moneyFormatter(currency, false).format(toNumber(value));
    },
    moneyCompact(value: string | number | null | undefined, currency = 'TRY') {
      return moneyFormatter(currency, true).format(toNumber(value));
    },
    number(value: string | number | null | undefined, maxFractionDigits = 2) {
      return new Intl.NumberFormat(tag, { maximumFractionDigits: maxFractionDigits }).format(toNumber(value));
    },
    percent(value: number) {
      return new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 1 }).format(value);
    },
    date(value: string | Date | null | undefined, style: 'short' | 'medium' | 'long' = 'medium') {
      if (!value) return '—';
      const d = typeof value === 'string' ? new Date(value) : value;
      if (Number.isNaN(d.getTime())) return '—';
      const opts: Intl.DateTimeFormatOptions =
        style === 'short'
          ? { day: 'numeric', month: 'short' }
          : style === 'long'
            ? { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }
            : { day: 'numeric', month: 'short', year: 'numeric' };
      return new Intl.DateTimeFormat(tag, opts).format(d);
    },
    time(value: string | Date | null | undefined) {
      if (!value) return '—';
      const d = typeof value === 'string' ? new Date(value) : value;
      if (Number.isNaN(d.getTime())) return '—';
      return new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }).format(d);
    },
    dateTime(value: string | Date | null | undefined) {
      if (!value) return '—';
      const d = typeof value === 'string' ? new Date(value) : value;
      if (Number.isNaN(d.getTime())) return '—';
      return new Intl.DateTimeFormat(tag, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    },
    /** "5 dk önce" style relative time. */
    relative(value: string | Date | null | undefined) {
      if (!value) return '—';
      const d = typeof value === 'string' ? new Date(value) : value;
      const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
      const abs = Math.abs(diffSec);
      if (abs < 60) return rtf.format(diffSec, 'second');
      if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
      if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
      return this.date(d);
    },
    /** Elapsed "1s 25dk" style duration from minutes. */
    duration(totalMinutes: number) {
      const m = Math.max(0, Math.floor(totalMinutes));
      const h = Math.floor(m / 60);
      const rest = m % 60;
      if (locale === 'tr') return h ? `${h} sa ${rest} dk` : `${rest} dk`;
      return h ? `${h}h ${rest}m` : `${rest}m`;
    },
  };
}
