// Widget gallery names and descriptions in English (Turkish is the default in app.json).
//
// iOS: expo-widgets writes `.configurationDisplayName("Otopoly · Bugün")`, a SwiftUI string literal, so
// the widget extension looks it up in Localizable.strings. The translations live in
// assets/locales/{tr,en}.json under ios → "Localizable.strings" (keyed by the Turkish text); Expo writes
// them to Supporting/<lang>.lproj and expo-widgets adds those files to the extension target.
//
// Android: expo-widgets writes the Turkish strings to res/values/expo_widgets.xml; this adds the same
// resource names to res/values-en/ from the same English map, so the widget picker follows the phone
// language. Nothing to do here when the map is missing an entry: the Turkish text stays.
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

// Same naming as expo-widgets plugin/build/android/resourceNames.js.
const toAndroidResourceName = (name) => {
  const r = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return /^[a-z]/.test(r) ? r : `widget_${r}`;
};

const escapeAndroidString = (value) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/^([@?])/, '\\$1')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function widgetsOf(config) {
  for (const plugin of config.plugins ?? []) {
    if (Array.isArray(plugin) && plugin[0] === 'expo-widgets') return plugin[1]?.widgets ?? [];
  }
  return [];
}

function englishMap(projectRoot, config) {
  const file = config.locales?.en;
  if (typeof file !== 'string') return {};
  const json = JSON.parse(fs.readFileSync(path.resolve(projectRoot, file), 'utf8'));
  return json?.ios?.['Localizable.strings'] ?? {};
}

// iOS: Expo adds Supporting/<lang>.lproj/Localizable.strings to the app target too, but the app already
// ships app-intents/Localizable.xcstrings (Siri phrases), and Xcode refuses a .strings table next to an
// .xcstrings table with the same name ("Localizable.xcstrings cannot co-exist..."). Only the widget
// extension needs these strings, so drop them from the main app target's Resources phase.
function withoutAppLocalizableStrings(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const objects = project.hash.project.objects;
    const targets = objects.PBXNativeTarget ?? {};
    const buildFiles = objects.PBXBuildFile ?? {};
    for (const [id, target] of Object.entries(targets)) {
      if (id.endsWith('_comment') || typeof target !== 'object') continue;
      if (String(target.name).replace(/"/g, '') !== appName) continue;
      for (const phaseRef of target.buildPhases ?? []) {
        const phase = objects.PBXResourcesBuildPhase?.[phaseRef.value];
        if (!phase) continue;
        phase.files = (phase.files ?? []).filter((f) => {
          if (!/^Localizable\.strings in Resources$/.test(f.comment ?? '')) return true;
          delete buildFiles[f.value];
          delete buildFiles[`${f.value}_comment`];
          return false;
        });
      }
    }
    return cfg;
  });
}

module.exports = function withWidgetLocales(config) {
  config = withoutAppLocalizableStrings(config);
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      // `android: null` (iOS-only) can arrive as `{}` after config resolution.
      const widgets = widgetsOf(cfg).filter((w) => w.android && Object.keys(w.android).length > 0);
      if (!widgets.length) return cfg;
      const en = englishMap(cfg.modRequest.projectRoot, cfg);
      const lines = [];
      for (const w of widgets) {
        const name = toAndroidResourceName(w.name);
        if (en[w.displayName]) lines.push(`  <string name="${name}_display_name">${escapeAndroidString(en[w.displayName])}</string>`);
        if (en[w.description]) lines.push(`  <string name="${name}_description">${escapeAndroidString(en[w.description])}</string>`);
      }
      if (!lines.length) return cfg;
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/values-en');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'expo_widgets.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${lines.join('\n')}\n</resources>\n`);
      return cfg;
    },
  ]);
};
