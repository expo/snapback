import XCTest

final class PartitimeSwiftUIUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testFeedDetailAndRSVP() throws {
        let environment = ProcessInfo.processInfo.environment
        let backend = environment["PARTITIME_TEST_BACKEND"] ?? "sqlite"
        let gateway = environment["PARTITIME_GATEWAY_ORIGIN"] ?? "http://127.0.0.1:4460"
        let app = XCUIApplication()
        app.launchArguments = ["--backend", backend, "--gateway", gateway]
        app.launch()

        XCTAssertTrue(element("partitime-feed", in: app).waitForExistence(timeout: 15))
        XCTAssertTrue(element("event-title-event_sunset", in: app).waitForExistence(timeout: 15))
        XCTAssertEqual(element("matrix-label", in: app).label, "SWIFTUI · \(backend.uppercased())")

        let open = element("open-event_swim", in: app)
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()

        XCTAssertTrue(element("partitime-event", in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(element("event-title", in: app).waitForExistence(timeout: 10))
        let going = element("rsvp-going", in: app)
        XCTAssertTrue(going.waitForExistence(timeout: 10))
        let wasGoing = element("my-rsvp-going", in: app).exists
        let targetButton = wasGoing ? element("rsvp-maybe", in: app) : going
        let targetStatus = wasGoing ? "my-rsvp-maybe" : "my-rsvp-going"
        targetButton.tap()
        XCTAssertTrue(element(targetStatus, in: app).waitForExistence(timeout: 15))
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[identifier]
    }
}
