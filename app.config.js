// Dynamic additions to app.json (Expo passes the static config in as `config`).
//
// Google sign-in on iOS needs the reversed iOS OAuth client id as a URL scheme. It comes from
// EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (.env / EAS / Xcode Cloud environment); app.json keeps a
// placeholder so the config always resolves.
const GOOGLE_PLUGIN = 'react-native-nitro-google-signin';

function googleIosUrlScheme() {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (!clientId) return null;
  return `com.googleusercontent.apps.${clientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
}

module.exports = ({ config }) => {
  const iosUrlScheme = googleIosUrlScheme();
  if (!iosUrlScheme) return config;
  return {
    ...config,
    plugins: config.plugins.map((plugin) =>
      plugin === GOOGLE_PLUGIN || (Array.isArray(plugin) && plugin[0] === GOOGLE_PLUGIN) ? [GOOGLE_PLUGIN, { iosUrlScheme }] : plugin,
    ),
  };
};
