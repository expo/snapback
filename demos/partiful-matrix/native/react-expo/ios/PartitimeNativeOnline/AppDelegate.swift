internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  private var javascriptLoadedObserver: NSObjectProtocol?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    javascriptLoadedObserver = NotificationCenter.default.addObserver(
      forName: NSNotification.Name(rawValue: "RCTJavaScriptDidLoadNotification"),
      object: nil,
      queue: .main
    ) { notification in
      guard let bridge = notification.userInfo?["bridge"] as? RCTBridge else { return }
      let evaluationMs = bridge.performanceLogger.duration(for: .rctplScriptExecution)
      Self.reportNativeLaunchStage(hermesEvaluationMs: evaluationMs)
    }
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  deinit {
    if let javascriptLoadedObserver {
      NotificationCenter.default.removeObserver(javascriptLoadedObserver)
    }
  }

  private static func reportNativeLaunchStage(hermesEvaluationMs: Int64) {
    guard let url = URL(string: "http://127.0.0.1:18764/event") else { return }
    let launchId = "ios-native-\(ProcessInfo.processInfo.processIdentifier)"
    let payload: [String: Any] = [
      "schemaVersion": "partitime.native-event.v1",
      "profileId": "react-expo/ios",
      "capabilityClass": "Online",
      "launchId": launchId,
      "event": "native-launch-stage",
      "details": [
        "definitionVersion": "partitime.native-launch-stage.v1",
        "hermesEvaluationMs": hermesEvaluationMs,
      ],
      "atMs": Int64(Date().timeIntervalSince1970 * 1000),
    ]
    guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = body
    URLSession.shared.dataTask(with: request).resume()
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
