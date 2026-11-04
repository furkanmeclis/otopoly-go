/**
 * Native Sign in with Apple (`expo-apple-authentication`) and Google
 * (`react-native-nitro-google-signin`, Android Credential Manager / Google Sign-In SDK on iOS).
 *
 * The native modules are loaded lazily and defensively: a binary built before they were added
 * (or Expo Go for Google) simply reports the provider as unavailable instead of crashing.
 *
 * Nonce: a random raw nonce is generated per attempt, its SHA-256 hex goes to the SDK (so it ends
 * up in the id_token) and the raw value goes to the API, which accepts either form.
 */
import { Platform } from 'react-native';

import { env } from '@/config/env';
import type { NativeOAuthInput } from '@/features/auth/services/passwordless.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth.native');

type AppleModule = typeof import('expo-apple-authentication');
type GoogleModule = typeof import('react-native-nitro-google-signin');
type CryptoModule = typeof import('expo-crypto');

function safeLoad<T>(name: string, load: () => T): T | null {
  try {
    return load();
  } catch (error) {
    log.warn(`${name} native module unavailable`, String((error as Error)?.message ?? error));
    return null;
  }
}

let apple: AppleModule | null | undefined;
let google: GoogleModule | null | undefined;
let crypto: CryptoModule | null | undefined;

/* eslint-disable @typescript-eslint/no-require-imports */
export function appleModule(): AppleModule | null {
  if (Platform.OS !== 'ios') return null;
  apple ??= safeLoad('expo-apple-authentication', () => require('expo-apple-authentication') as AppleModule);
  return apple;
}

function googleModule(): GoogleModule | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  google ??= safeLoad('react-native-nitro-google-signin', () => require('react-native-nitro-google-signin') as GoogleModule);
  return google;
}

function cryptoModule(): CryptoModule | null {
  crypto ??= safeLoad('expo-crypto', () => require('expo-crypto') as CryptoModule);
  return crypto;
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** Client ids the current platform needs for native Google sign-in. */
export function googleConfigured() {
  if (!env.googleWebClientId) return false;
  return Platform.OS === 'android' || (Platform.OS === 'ios' && Boolean(env.googleIosClientId));
}

export async function isAppleAvailable() {
  const mod = appleModule();
  if (!mod) return false;
  try {
    return await mod.isAvailableAsync();
  } catch {
    return false;
  }
}

export function isGoogleAvailable() {
  return googleConfigured() && googleModule() !== null;
}

async function createNonce() {
  const c = cryptoModule();
  if (!c) throw new Error('expo-crypto unavailable');
  const raw = Array.from(c.getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
  const hashed = await c.digestStringAsync(c.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

const isCancel = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  return code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED' || code === 'SIGN_IN_CANCELLED';
};

/** Apple sheet → body for `/v1/auth/oauth/apple/native`, or `null` when the user cancels. */
export async function signInWithAppleNative(): Promise<NativeOAuthInput | null> {
  const mod = appleModule();
  if (!mod) throw new Error('APPLE_UNAVAILABLE');
  const nonce = await createNonce();
  try {
    const cred = await mod.signInAsync({
      requestedScopes: [mod.AppleAuthenticationScope.FULL_NAME, mod.AppleAuthenticationScope.EMAIL],
      nonce: nonce.hashed,
    });
    if (!cred.identityToken) throw new Error('Apple returned no identity token');
    log.info('Apple credential received', { firstSignIn: Boolean(cred.fullName?.givenName), hasCode: Boolean(cred.authorizationCode) });
    return {
      id_token: cred.identityToken,
      nonce: nonce.raw,
      ...(cred.authorizationCode ? { authorization_code: cred.authorizationCode } : {}),
      // Apple sends the name only on the very first sign-in.
      ...(cred.fullName?.givenName ? { given_name: cred.fullName.givenName } : {}),
      ...(cred.fullName?.familyName ? { family_name: cred.fullName.familyName } : {}),
    };
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
}

/** Google (Credential Manager on Android, Google Sign-In on iOS) → body for `/google/native`, or `null` on cancel. */
export async function signInWithGoogleNative(): Promise<NativeOAuthInput | null> {
  const mod = googleModule();
  if (!mod || !googleConfigured()) throw new Error('GOOGLE_UNAVAILABLE');
  const { GoogleOneTapSignIn, isCancelledResponse, isNoSavedCredentialFoundResponse, isSuccessResponse } = mod;
  const nonce = await createNonce();
  try {
    GoogleOneTapSignIn.configure({
      webClientId: env.googleWebClientId!,
      iosClientId: env.googleIosClientId,
      nonce: nonce.hashed,
    });
    if (Platform.OS === 'android') await GoogleOneTapSignIn.checkPlayServices();
    // iOS signIn() returns the cached session's id_token, which carries an earlier attempt's nonce.
    let response = Platform.OS === 'ios' ? await GoogleOneTapSignIn.presentExplicitSignIn() : await GoogleOneTapSignIn.signIn();
    if (isNoSavedCredentialFoundResponse(response)) response = await GoogleOneTapSignIn.createAccount();
    if (isNoSavedCredentialFoundResponse(response)) response = await GoogleOneTapSignIn.presentExplicitSignIn();
    if (isCancelledResponse(response)) return null;
    if (!isSuccessResponse(response) || !response.data.idToken) throw new Error('Google returned no id token');
    log.info('Google credential received');
    return {
      id_token: response.data.idToken,
      nonce: nonce.raw,
      ...(response.data.user.givenName ? { given_name: response.data.user.givenName } : {}),
      ...(response.data.user.familyName ? { family_name: response.data.user.familyName } : {}),
    };
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
}
