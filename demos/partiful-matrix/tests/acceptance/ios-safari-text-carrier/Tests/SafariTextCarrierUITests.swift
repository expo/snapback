import XCTest

final class SafariTextCarrierUITests: XCTestCase {
    func testTypeIntoFocusedSafariControl() throws {
        let environment = ProcessInfo.processInfo.environment
        let text = try XCTUnwrap(
            environment["PARTITIME_IOS_TEXT"],
            "PARTITIME_IOS_TEXT must identify the text to type"
        )

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()

        let candidates = safari.textFields.allElementsBoundByIndex
            + safari.secureTextFields.allElementsBoundByIndex
            + safari.textViews.allElementsBoundByIndex
        let input = try XCTUnwrap(
            candidates.first(where: \.hasKeyboardFocus) ?? candidates.first,
            "Safari must expose a focused text field or text view"
        )
        input.typeText(text)
    }
}
