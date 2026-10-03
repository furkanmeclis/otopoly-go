// Our error tracker speaks the Sentry event protocol but has no sentry-cli API, so source maps and
// dSYMs can never be uploaded. @sentry/react-native's Xcode build phases ("Bundle React Native code and
// images" → sentry-xcode.sh, "Upload Debug Symbols to Sentry") try to upload unless
// SENTRY_DISABLE_AUTO_UPLOAD=true, and a failed upload fails the build. Both phases source ios/.xcode.env,
// so this plugin makes "no upload" the default there for every iOS build (local, Xcode Cloud, EAS).
// An explicit SENTRY_DISABLE_AUTO_UPLOAD in the build environment still wins.
// Android: sentry.gradle reads the real environment only — eas.json sets it for EAS builds.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

const LINE = 'export SENTRY_DISABLE_AUTO_UPLOAD="${SENTRY_DISABLE_AUTO_UPLOAD:-true}"';
const MARKER = '# Sentry: no source map / debug symbol upload (plugins/with-sentry-no-upload.js)';

module.exports = function withSentryNoUpload(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, '.xcode.env');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'export NODE_BINARY=$(command -v node)\n';
      if (!current.includes(MARKER)) {
        fs.writeFileSync(file, `${current.replace(/\n*$/, '\n')}\n${MARKER}\n${LINE}\n`);
      }
      return cfg;
    },
  ]);
};
