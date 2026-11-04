import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createLogger } from '@/lib/logger';
import { prefs, StorageKeys } from '@/lib/storage';

import { createFormatters, type Formatters } from './format';
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  RTL_LOCALES,
  translate,
  translatePlural,
  type AppLocale,
  type TranslateParams,
} from './translate';

const log = createLogger('i18n');

type LocaleContextValue = {
  locale: AppLocale;
  isRTL: boolean;
  /** Persists the choice; the auth layer also pushes it to the backend profile. */
  setLocale: (locale: AppLocale) => void;
  t: (key: string, params?: TranslateParams) => string;
  tp: (key: string, count: number, params?: TranslateParams) => string;
  fmt: Formatters;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Module-level mirror so non-React code (API client headers, toasts) can read the active locale.
let currentLocale: AppLocale = DEFAULT_LOCALE;
export const getCurrentLocale = () => currentLocale;

function deviceLocale(): AppLocale {
  try {
    const code = getLocales()[0]?.languageCode;
    return isSupportedLocale(code) ? code : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(deviceLocale);

  useEffect(() => {
    prefs.get<string | null>(StorageKeys.locale, null).then((saved) => {
      if (isSupportedLocale(saved)) setLocaleState(saved);
    });
  }, []);

  useEffect(() => {
    currentLocale = locale;
  }, [locale]);

  const setLocale = useCallback((next: AppLocale) => {
    log.info('Locale changed', { locale: next });
    setLocaleState(next);
    prefs.set(StorageKeys.locale, next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      isRTL: RTL_LOCALES.includes(locale),
      setLocale,
      t: (key, params) => translate(locale, key, params),
      tp: (key, count, params) => translatePlural(locale, key, count, params),
      fmt: createFormatters(locale),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used inside LocaleProvider');
  return ctx;
}

/** Shorthand for components that only need `t`. */
export function useT() {
  return useLocale().t;
}
