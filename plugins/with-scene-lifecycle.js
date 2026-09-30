// iOS 27 refuses to launch apps that have not adopted the UIScene life cycle
// (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption → EXC_BREAKPOINT at launch).
// Expo SDK 57 ships `ExpoAppSceneDelegate` for this, but the prebuild template still uses the
// window-in-AppDelegate setup. This plugin switches the generated project over:
//   1. Info.plist declares a scene manifest pointing at EXExpoAppSceneDelegate.
//   2. AppDelegate provides the React Native factory and stops creating its own window;
//      the scene delegate creates the window and starts React Native into it.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const WINDOW_BLOCK = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('with-scene-lifecycle: expected a Swift AppDelegate');
    }
    let src = cfg.modResults.contents;
    if (src.includes('ExpoReactNativeFactoryProvider')) return cfg;

    const declaration = 'class AppDelegate: ExpoAppDelegate {';
    if (!src.includes(declaration) || !WINDOW_BLOCK.test(src)) {
      throw new Error('with-scene-lifecycle: AppDelegate template changed; update the plugin patterns');
    }
    src = src.replace(declaration, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    src = src.replace(
      WINDOW_BLOCK,
      '\n    // The window and React Native start-up live in ExpoAppSceneDelegate (UIScene life cycle).\n'
    );
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneAppDelegate(withSceneManifest(config));
};
