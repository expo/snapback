import UIKit

// @ref LLP 0063#sequence — the attended carrier records the physical system
// Reduce Motion fact without treating SafariDriver as an input owner.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let label = UILabel()
        label.accessibilityIdentifier = "reduce-motion-probe"
        label.text = UIAccessibility.isReduceMotionEnabled
            ? "Reduce Motion enabled"
            : "Reduce Motion disabled"
        label.textAlignment = .center

        let controller = UIViewController()
        controller.view.backgroundColor = .systemBackground
        controller.view.addSubview(label)
        label.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: controller.view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: controller.view.centerYAnchor),
        ])

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window

        if let rawURL = ProcessInfo.processInfo.environment["PARTITIME_OPEN_URL"],
           let url = URL(string: rawURL) {
            DispatchQueue.main.async {
                application.open(url)
            }
        }
        return true
    }
}
