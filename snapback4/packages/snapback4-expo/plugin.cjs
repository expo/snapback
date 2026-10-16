// @ref LLP 3000.030#13 — one published lifecycle for reference and generated Expo 57.0.30 apps; preserve existing plugin configs.
const { withAppDelegate, withInfoPlist, withDangerousMod } = require('expo/config-plugins');
const marker = '// Snapback4 starter scene lifecycle';
const legacy = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;
const scene = `
${marker}
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene,
      let app = UIApplication.shared.delegate as? AppDelegate,
      let factory = app.reactNativeFactory else { return }
    let window = UIWindow(windowScene: scene)
    self.window = window
    app.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)
    for context in connectionOptions.urlContexts {
      _ = app.application(UIApplication.shared, open: context.url, options: [:])
    }
    for activity in connectionOptions.userActivities {
      _ = app.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
  }
  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in contexts { _ = app.application(UIApplication.shared, open: context.url, options: [:]) }
  }
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = app.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;
// @ref LLP 3000.030#13 — Swift's version alone does not identify the SDK's C++ modules (expo/expo#50365).
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const cacheMarker = '# Snapback4: bind ExpoModulesJSI slices to the selected Xcode SDK';
function withJsiSdkCache(config) {
  return withDangerousMod(config, ['ios', config => {
    const app = createRequire(path.join(config.modRequest.projectRoot, 'package.json'));
    const core = createRequire(app.resolve('expo-modules-core/package.json'));
    const script = path.join(path.dirname(core.resolve('expo-modules-jsi/package.json')), 'apple/scripts/build-xcframework.sh');
    const source = fs.readFileSync(script, 'utf8');
    if (source.includes(cacheMarker)) return config;
    const anchor = '    echo "TOOLCHAIN_VERSION=$(xcrun swiftc --version 2>/dev/null || true)"';
    if (source.split(anchor).length !== 2) {
      throw new Error('snapback4-expo/plugin cannot patch this ExpoModulesJSI cache script; use the qualified Expo 57.0.30 toolchain');
    }
    fs.writeFileSync(script, source.replace(anchor, anchor + '\n    ' + cacheMarker + '\n    echo "XCODE_VERSION=$(xcodebuild -version)"'));
    return config;
  }]);
}
module.exports = function withStarterScene(config) {
  config = withJsiSdkCache(config);
  config = withAppDelegate(config, config => {
    const mod = config.modResults;
    if (mod.contents.includes(marker)) return config;
    if (mod.language !== 'swift' || !mod.contents.includes(legacy) || mod.contents.includes('class SceneDelegate')) {
      throw new Error('snapback4-expo/plugin requires the Expo 57 Swift starter; migrate custom UIScene lifecycle manually and remove this plugin');
    }
    mod.contents = mod.contents.replace(legacy, '') + scene;
    return config;
  });
  return withInfoPlist(config, config => {
    const manifest = { UIApplicationSupportsMultipleScenes: false, UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate' }],
    } };
    const existing = config.modResults.UIApplicationSceneManifest;
    if (existing && JSON.stringify(existing) !== JSON.stringify(manifest)) {
      throw new Error('snapback4-expo/plugin refuses a custom UIApplicationSceneManifest; keep its own lifecycle and remove this plugin');
    }
    config.modResults.UIApplicationSceneManifest = manifest;
    return config;
  });
};
