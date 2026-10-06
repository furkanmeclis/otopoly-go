import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { createLogger } from '@/lib/logger';
import { prefs, StorageKeys } from '@/lib/storage';

import { darkTheme, lightTheme, type Theme } from './tokens';

const log = createLogger('theme');

export type ThemeMode = 'system' | 'light' | 'dark';

type ThemeContextValue = {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    prefs.get<ThemeMode>(StorageKeys.themeMode, 'system').then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') setModeState(saved);
    });
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    log.info('Theme mode changed', { mode: next });
    setModeState(next);
    prefs.set(StorageKeys.themeMode, next);
  }, []);

  const scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const value = useMemo(
    () => ({ theme: scheme === 'dark' ? darkTheme : lightTheme, mode, setMode }),
    [scheme, mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

export function useTheme(): Theme {
  return useThemeContext().theme;
}

/**
 * Themed StyleSheet factory. Styles are rebuilt only when the theme changes.
 *
 *   const useStyles = makeStyles((t) => ({ root: { backgroundColor: t.colors.background } }));
 *   const styles = useStyles();
 */
/** Strict RN API dropped StyleSheet.NamedStyles; same shape, kept local. */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

export function makeStyles<T extends NamedStyles<T>>(factory: (theme: Theme) => T) {
  const cache = new WeakMap<Theme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    let styles = cache.get(theme);
    if (!styles) {
      styles = StyleSheet.create(factory(theme));
      cache.set(theme, styles);
    }
    return styles;
  };
}
