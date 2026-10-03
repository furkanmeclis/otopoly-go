/**
 * Expo push: permission, token and device registration (`/v1/push-devices`).
 *
 * The native module is loaded lazily so the app keeps running where push isn't available:
 * Expo Go (remote push was removed from Expo Go on Android and the token would belong to Expo Go,
 * not to Otopoly), web, or a simulator without APNs. Every call here is a graceful no-op there.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { getCurrentLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { prefs, StorageKeys } from '@/lib/storage';

import { pushDevicesService } from './services/push-devices.service';

const log = createLogger('push');

type NotificationsModule = typeof import('expo-notifications');

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let mod: NotificationsModule | null | undefined;

/** The expo-notifications module, or null where it must not be loaded (web, Expo Go on Android). */
export function notificationsModule(): NotificationsModule | null {
  if (mod !== undefined) return mod;
  if (Platform.OS === 'web' || (isExpoGo && Platform.OS === 'android')) {
    mod = null;
    return mod;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: must not load in Expo Go on Android
    mod = require('expo-notifications') as NotificationsModule;
  } catch (error) {
    log.warn('expo-notifications unavailable', error);
    mod = null;
  }
  return mod;
}

/** Whether this build can receive remote push at all. */
export function pushAvailable() {
  return !isExpoGo && (Platform.OS === 'ios' || Platform.OS === 'android') && notificationsModule() !== null;
}

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export async function getPushPermission(): Promise<PushPermission> {
  const N = notificationsModule();
  if (!N || !pushAvailable()) return 'unavailable';
  try {
    const res = await N.getPermissionsAsync();
    if (res.granted || res.ios?.status === N.IosAuthorizationStatus.PROVISIONAL) return 'granted';
    return res.canAskAgain === false || res.status === 'denied' ? 'denied' : 'undetermined';
  } catch (error) {
    log.warn('Permission check failed', error);
    return 'unavailable';
  }
}

async function ensureAndroidChannel(N: NotificationsModule) {
  if (Platform.OS !== 'android') return;
  // Android 13+ only shows the permission prompt once a channel exists.
  await N.setNotificationChannelAsync('default', {
    name: 'Otopoly',
    importance: N.AndroidImportance.HIGH,
  });
}

/** Shows the OS prompt (call only after the in-app explanation). */
export async function requestPushPermission(): Promise<PushPermission> {
  const N = notificationsModule();
  if (!N || !pushAvailable()) return 'unavailable';
  try {
    await ensureAndroidChannel(N);
    const res = await N.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
    return res.granted ? 'granted' : 'denied';
  } catch (error) {
    log.warn('Permission request failed', error);
    return 'unavailable';
  }
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

async function expoPushToken(N: NotificationsModule): Promise<string | null> {
  const id = projectId();
  if (!id) {
    log.warn('No EAS projectId in app config; push disabled');
    return null;
  }
  await ensureAndroidChannel(N);
  const res = await N.getExpoPushTokenAsync({ projectId: id });
  return res.data;
}

function deviceInfo() {
  const version = Constants.expoConfig?.version ?? '';
  const build = Platform.OS === 'ios' ? Constants.expoConfig?.ios?.buildNumber : Constants.expoConfig?.android?.versionCode;
  return {
    platform: Platform.OS as 'ios' | 'android',
    locale: getCurrentLocale(),
    app_version: (build ? `${version} (${build})` : version).slice(0, 32),
    device_name: (Constants.deviceName ?? '').slice(0, 120) || undefined,
  };
}

export type RegisterResult = 'registered' | 'unavailable' | 'denied' | 'failed';

/** Skip re-registering the same token for this long (the backend keeps it until rotation or logout). */
const REREGISTER_AFTER_MS = 12 * 60 * 60 * 1000;
/** After a failed attempt, automatic calls wait this long before trying again. */
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

let inFlight: Promise<RegisterResult> | null = null;
let lastRegistered: { token: string; at: number } | null = null;
let lastFailureAt = 0;

/**
 * Registers this device for the signed-in user. Never prompts: returns `denied` / `unavailable`
 * when permission isn't granted yet. Concurrent calls share one request, and the same token is
 * not sent again within REREGISTER_AFTER_MS. `force` (sign-in, account switch) always sends it.
 */
export function registerPushDevice(options?: { force?: boolean }): Promise<RegisterResult> {
  inFlight ??= doRegister(options?.force ?? false).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRegister(force: boolean): Promise<RegisterResult> {
  const N = notificationsModule();
  if (!N || !pushAvailable()) return 'unavailable';
  if (!force && Date.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS) return 'failed';
  const permission = await getPushPermission();
  if (permission !== 'granted') return permission === 'unavailable' ? 'unavailable' : 'denied';
  try {
    const token = await expoPushToken(N);
    if (!token) return 'unavailable';
    if (!force && lastRegistered?.token === token && Date.now() - lastRegistered.at < REREGISTER_AFTER_MS) {
      return 'registered';
    }
    const previous = await prefs.get<string | null>(StorageKeys.pushToken, null);
    await pushDevicesService.register({ token, ...deviceInfo() });
    await prefs.set(StorageKeys.pushToken, token);
    lastRegistered = { token, at: Date.now() };
    lastFailureAt = 0;
    if (previous && previous !== token) {
      // Token rotated: drop the stale one so the backend stops sending to it.
      pushDevicesService.unregister(previous).catch(() => {});
    }
    log.info('Push device registered', { platform: Platform.OS });
    return 'registered';
  } catch (error) {
    // Simulators without APNs and devices without Play services end up here.
    lastFailureAt = Date.now();
    log.warn('Push registration failed', error);
    return 'failed';
  }
}

let lastDeviceToken: string | null = null;

/**
 * Re-registers only when the native device token really changes. Fetching the Expo token
 * (inside registerPushDevice) fires the push-token event again on iOS; registering on every
 * event looped forever (~200k POST /v1/push-devices on 2026-10-03, phones heating up).
 */
export function onDevicePushTokenChanged(deviceToken: unknown) {
  const value = typeof deviceToken === 'string' ? deviceToken : JSON.stringify(deviceToken ?? null);
  if (value === lastDeviceToken) return;
  const first = lastDeviceToken === null;
  lastDeviceToken = value;
  // The first event of a session is the token we just fetched, not a rotation.
  void registerPushDevice({ force: !first });
}

/** Prompts if needed, then registers (used by the explanation sheet and the preferences toggle). */
export async function enablePush(): Promise<RegisterResult> {
  let permission = await getPushPermission();
  if (permission === 'unavailable') return 'unavailable';
  if (permission === 'undetermined') permission = await requestPushPermission();
  if (permission !== 'granted') return permission === 'unavailable' ? 'unavailable' : 'denied';
  return registerPushDevice({ force: true });
}

/**
 * Removes this device from the signed-in user. Must run while the access token is still valid
 * (logout calls it before clearing the session). Never throws.
 * `localOnly`: the server already revoked the session (account deletion) — only forget the token here.
 */
export async function unregisterPushDevice(options?: { localOnly?: boolean }) {
  lastRegistered = null;
  const token = await prefs.get<string | null>(StorageKeys.pushToken, null);
  if (!token) return;
  if (options?.localOnly) {
    await prefs.remove(StorageKeys.pushToken);
    return;
  }
  try {
    await pushDevicesService.unregister(token);
    log.info('Push device unregistered');
  } catch (error) {
    log.warn('Push unregister failed', error);
  } finally {
    await prefs.remove(StorageKeys.pushToken);
  }
}
