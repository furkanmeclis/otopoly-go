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

/**
 * Registers this device for the signed-in user. Never prompts: returns `denied` / `unavailable`
 * when permission isn't granted yet. Safe to call repeatedly (backend upserts by token).
 */
export async function registerPushDevice(): Promise<RegisterResult> {
  const N = notificationsModule();
  if (!N || !pushAvailable()) return 'unavailable';
  const permission = await getPushPermission();
  if (permission !== 'granted') return permission === 'unavailable' ? 'unavailable' : 'denied';
  try {
    const token = await expoPushToken(N);
    if (!token) return 'unavailable';
    const previous = await prefs.get<string | null>(StorageKeys.pushToken, null);
    await pushDevicesService.register({ token, ...deviceInfo() });
    await prefs.set(StorageKeys.pushToken, token);
    if (previous && previous !== token) {
      // Token rotated: drop the stale one so the backend stops sending to it.
      pushDevicesService.unregister(previous).catch(() => {});
    }
    log.info('Push device registered', { platform: Platform.OS });
    return 'registered';
  } catch (error) {
    // Simulators without APNs and devices without Play services end up here.
    log.warn('Push registration failed', error);
    return 'failed';
  }
}

/** Prompts if needed, then registers (used by the explanation sheet and the preferences toggle). */
export async function enablePush(): Promise<RegisterResult> {
  let permission = await getPushPermission();
  if (permission === 'unavailable') return 'unavailable';
  if (permission === 'undetermined') permission = await requestPushPermission();
  if (permission !== 'granted') return permission === 'unavailable' ? 'unavailable' : 'denied';
  return registerPushDevice();
}

/**
 * Removes this device from the signed-in user. Must run while the access token is still valid
 * (logout calls it before clearing the session). Never throws.
 */
export async function unregisterPushDevice() {
  const token = await prefs.get<string | null>(StorageKeys.pushToken, null);
  if (!token) return;
  try {
    await pushDevicesService.unregister(token);
    log.info('Push device unregistered');
  } catch (error) {
    log.warn('Push unregister failed', error);
  } finally {
    await prefs.remove(StorageKeys.pushToken);
  }
}
