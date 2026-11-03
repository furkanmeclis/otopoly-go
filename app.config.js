// Dynamic additions to app.json (Expo passes the static config in as `config`).
//
// Google sign-in on iOS needs the reversed iOS OAuth client id as a URL scheme. It comes from
// EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (.env / EAS / Xcode Cloud environment); app.json keeps a
// placeholder so the config always resolves.
const GOOGLE_PLUGIN = 'react-native-nitro-google-signin';
const EAS_PROJECT_ID = 'a5e4bc16-f23b-4735-bd29-81f3355f02a8';

function updatesChannel() {
  const explicit = process.env.EXPO_UPDATES_CHANNEL?.trim();
  if (explicit) return explicit;
  switch (process.env.EXPO_PUBLIC_APP_ENV) {
    case 'production':
      return 'production';
    case 'preview':
      return 'preview';
    default:
      return 'development';
  }
}

function googleIosUrlScheme() {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (!clientId) return null;
  return `com.googleusercontent.apps.${clientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
}

// Store builds (EXPO_PUBLIC_APP_ENV=production) must never ship the in-app mock, demo accounts or
// the QA tour (App Store 2.1 / 2.3.1, Play "Misleading claims"). src/config/env.ts already forces
// live mode there; this stops a misconfigured Xcode Cloud / EAS workflow before it builds.
function assertStoreConfig() {
  if (process.env.EXPO_PUBLIC_APP_ENV !== 'production') return;
  const problems = [];
  if (process.env.EXPO_PUBLIC_API_MODE && process.env.EXPO_PUBLIC_API_MODE !== 'live') problems.push('EXPO_PUBLIC_API_MODE must be "live"');
  if (process.env.EXPO_PUBLIC_QA_TOUR === '1') problems.push('EXPO_PUBLIC_QA_TOUR must not be set');
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (apiUrl && !/^https:\/\//i.test(apiUrl)) problems.push('EXPO_PUBLIC_API_URL must be an https:// URL');
  if (problems.length) throw new Error(`Store build (EXPO_PUBLIC_APP_ENV=production) misconfigured: ${problems.join('; ')}`);
}

module.exports = ({ config }) => {
  assertStoreConfig();
  const iosUrlScheme = googleIosUrlScheme();
  const channel = updatesChannel();
  const plugins = iosUrlScheme
    ? config.plugins.map((plugin) =>
        plugin === GOOGLE_PLUGIN || (Array.isArray(plugin) && plugin[0] === GOOGLE_PLUGIN) ? [GOOGLE_PLUGIN, { iosUrlScheme }] : plugin,
      )
    : config.plugins;

  return {
    ...config,
    runtimeVersion: {
      policy: 'fingerprint',
    },
    updates: {
      ...config.updates,
      url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      requestHeaders: {
        ...config.updates?.requestHeaders,
        'expo-channel-name': channel,
      },
    },
    extra: {
      ...config.extra,
      ota: {
        channel,
      },
    },
    plugins,
  };
};
