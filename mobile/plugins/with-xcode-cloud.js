// Copies the Xcode Cloud custom build scripts into ios/ci_scripts on every prebuild,
// so they survive `expo prebuild --clean` without hand-editing the native folder.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

module.exports = function withXcodeCloud(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const from = path.join(cfg.modRequest.projectRoot, 'scripts', 'xcode-cloud');
      const to = path.join(cfg.modRequest.platformProjectRoot, 'ci_scripts');
      fs.mkdirSync(to, { recursive: true });
      for (const file of fs.readdirSync(from)) {
        if (!file.endsWith('.sh')) continue;
        fs.copyFileSync(path.join(from, file), path.join(to, file));
        fs.chmodSync(path.join(to, file), 0o755);
      }
      return cfg;
    },
  ]);
};
