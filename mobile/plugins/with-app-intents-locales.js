// Siri / Shortcuts phrases and App Intent titles are translated in app-intents/*.xcstrings (compiled into
// the app target through the inline-modules synchronized group). Xcode only ships the catalog languages
// the project declares, and the Expo template declares `en` + `Base` alone, so the Turkish phrases would
// be dropped and Siri in Turkish would not know them. This adds `tr` to the project's known regions.
const { withXcodeProject } = require('expo/config-plugins');

const REGIONS = ['en', 'tr'];

module.exports = function withAppIntentsLocales(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const objects = project.hash.project.objects.PBXProject;
    for (const key of Object.keys(objects)) {
      if (key.endsWith('_comment')) continue;
      const entry = objects[key];
      const known = Array.isArray(entry.knownRegions) ? entry.knownRegions : [];
      for (const region of REGIONS) if (!known.includes(region)) known.push(region);
      entry.knownRegions = known;
    }
    return cfg;
  });
};
