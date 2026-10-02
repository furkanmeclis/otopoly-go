import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { createLogger } from '@/lib/logger';

const log = createLogger('storage');

/** Non-sensitive preferences (theme, locale, UI state). Never throws. */
export const prefs = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch (error) {
      log.warn('Preference read failed', { key, error });
      return fallback;
    }
  },
  async set(key: string, value: unknown) {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      log.warn('Preference write failed', { key, error });
    }
  },
  async remove(key: string) {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      log.warn('Preference remove failed', { key, error });
    }
  },
};

/** Secrets (tokens). Keychain / Keystore backed. Never throws. */
export const secure = {
  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      log.error('Secure read failed', { key, error });
      return null;
    }
  },
  async set(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      log.error('Secure write failed', { key, error });
    }
  },
  async remove(key: string) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      log.warn('Secure delete failed', { key, error });
    }
  },
};

export const StorageKeys = {
  locale: 'app.locale',
  themeMode: 'app.theme_mode',
  session: 'auth.session',
  activeOrg: 'auth.active_org',
  demoMockDb: 'demo.mock_db',
  demoPlanScenario: 'demo.plan_scenario',
  demoAccessScenario: 'demo.access_scenario',
  /** Per-user AI assistant data-sharing consent (`ai.consent.<userUuid>`). */
  aiConsent: 'ai.consent',
  dismissedSetup: 'dashboard.setup_dismissed',
  /** Expo push token last registered with the backend (unregistered on logout). */
  pushToken: 'push.token',
  /** Per-user flag: the in-app push explanation was shown (`push.prompted.<userUuid>`). */
  pushPrompted: 'push.prompted',
} as const;
