// @ref LLP 0201.000#7 — shared backend-neutral Expo 57 / SDK 27 runtime baseline.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');
const marker = '// Clique native runtime baseline scene lifecycle';
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

module.exports = function withCliqueRuntimeScene(config) {
  config = withAppDelegate(config, config => {
    const mod = config.modResults;
    if (mod.contents.includes(marker)) return config;
    if (mod.language !== 'swift' || !mod.contents.includes(legacy) || mod.contents.includes('class SceneDelegate')) {
      throw new Error('clique native scene recipe requires the unmodified Expo 57 Swift lifecycle; migrate a custom UIScene lifecycle manually');
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
      throw new Error('clique native scene recipe refuses an existing UIApplicationSceneManifest; keep the application lifecycle and remove this plugin');
    }
    config.modResults.UIApplicationSceneManifest = manifest;
    return config;
  });
};
