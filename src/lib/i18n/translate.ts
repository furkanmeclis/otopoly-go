import { catalogs, type AppLocale } from '@/locales';
import { createLogger } from '@/lib/logger';

const log = createLogger('i18n');

export type { AppLocale };
export type TranslateParams = Record<string, string | number>;

export const SUPPORTED_LOCALES = Object.keys(catalogs) as AppLocale[];
export const DEFAULT_LOCALE: AppLocale = 'tr';
export const FALLBACK_LOCALE: AppLocale = 'en';
/** RTL locales reserved for future languages (same as web i18nConfig.rtlLocales). */
export const RTL_LOCALES: readonly string[] = [];

type Dictionary = Record<string, string>;
const dictionaries = catalogs as unknown as Record<AppLocale, Record<string, Dictionary>>;
const reportedMissing = new Set<string>();

export function isSupportedLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as string[]).includes(value);
}

/**
 * Same semantics as the web `translate()`:
 * `ns.key.path` → catalogs[locale][ns]["key.path"], `{{param}}` interpolation, fallback locale, then the key itself.
 */
export function translate(locale: AppLocale, key: string, params?: TranslateParams): string {
  const dot = key.indexOf('.');
  const ns = dot === -1 ? key : key.slice(0, dot);
  const path = dot === -1 ? '' : key.slice(dot + 1);
  const primary = dictionaries[locale]?.[ns]?.[path];
  const fallback = dictionaries[FALLBACK_LOCALE]?.[ns]?.[path];

  if (primary === undefined) {
    const id = `${locale}:${key}`;
    if (!reportedMissing.has(id)) {
      reportedMissing.add(id);
      log.warn(fallback === undefined ? 'Missing translation key' : 'Translation falls back', { locale, key });
    }
  }

  let text = primary ?? fallback ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
  }
  return text;
}

/** `key_one` / `key_other`, like the web `translatePlural()`. */
export function translatePlural(locale: AppLocale, key: string, count: number, params?: TranslateParams) {
  return translate(locale, `${key}_${count === 1 ? 'one' : 'other'}`, { count, ...params });
}

export function hasTranslation(locale: AppLocale, key: string) {
  const dot = key.indexOf('.');
  return dictionaries[locale]?.[key.slice(0, dot)]?.[key.slice(dot + 1)] !== undefined;
}
