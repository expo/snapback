import XCTest

// @ref LLP 0063#sequence — ordinary Safari is observed by one XCUITest owner;
// no SafariDriver session may coexist with an attended physical run.
@MainActor
final class PartitimeAttendedUITests: XCTestCase {
    private let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")

    private struct Environment {
        let baseURL: String
        let arm: String
        let operatorName: String
        let title: String
        let location: String
        let wall: String
        let reducedWall: String
    }

    private func environment() throws -> Environment {
        let values = ProcessInfo.processInfo.environment
        guard values["PARTITIME_ATTENDED_RUN"] == "1" else {
            throw XCTSkip("Set PARTITIME_ATTENDED_RUN=1 only for an attended physical-device run")
        }
        let baseURL = try XCTUnwrap(
            values["PARTITIME_BASE_URL"],
            "PARTITIME_BASE_URL must identify the device-reachable isolated fixture"
        )
        let arm = try XCTUnwrap(values["PARTITIME_ARM"], "PARTITIME_ARM must be react or contract")
        XCTAssertTrue(["react", "contract"].contains(arm), "PARTITIME_ARM must be react or contract")
        return Environment(
            baseURL: baseURL,
            arm: arm,
            operatorName: values["PARTITIME_OPERATOR"] ?? "Charlie Cheever",
            title: values["PARTITIME_EXPECTED_TITLE"] ?? "Keyboard Picnic",
            location: values["PARTITIME_EXPECTED_LOCATION"] ?? "Dolores Park",
            wall: values["PARTITIME_EXPECTED_WALL"] ?? "Keyboard picnic",
            reducedWall: values["PARTITIME_EXPECTED_REDUCED_WALL"] ?? "Reduced motion status"
        )
    }

    private func waitUntil(
        timeout: TimeInterval,
        _ predicate: () -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if predicate() {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.20))
        } while Date() < deadline
        return false
    }

    private func firstExisting(
        _ candidates: [XCUIElement],
        timeout: TimeInterval = 20
    ) -> XCUIElement? {
        guard waitUntil(timeout: timeout, {
            candidates.contains(where: \.exists)
        }) else {
            return nil
        }
        return candidates.first(where: \.exists)
    }

    private func openRoute(_ url: String) {
        let host = XCUIApplication()
        host.launchEnvironment["PARTITIME_OPEN_URL"] = url
        host.launch()
        safari.activate()
        XCTAssertTrue(
            safari.wait(for: .runningForeground, timeout: 15),
            "ordinary Mobile Safari must reach the foreground"
        )
    }

    private func attachSafariState(_ name: String, environment: Environment) {
        let screenshot = XCTAttachment(screenshot: safari.screenshot())
        screenshot.name = "\(environment.arm)-\(name)-screenshot"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let tree = XCTAttachment(string: safari.debugDescription)
        tree.name = "\(environment.arm)-\(name)-accessibility-tree"
        tree.lifetime = .keepAlways
        add(tree)

        let identity = XCTAttachment(
            string: "arm=\(environment.arm)\noperator=\(environment.operatorName)\nurl=\(environment.baseURL)\n"
        )
        identity.name = "\(environment.arm)-\(name)-identity"
        identity.lifetime = .keepAlways
        add(identity)
    }

    private func value(_ element: XCUIElement) -> String {
        String(describing: element.value ?? "")
    }

    private func eventRoute(_ environment: Environment) -> String {
        "\(environment.baseURL)/events/event_sunset/?user=eve"
    }

    func testManualCreateTextObservation() throws {
        let environment = try environment()
        openRoute("\(environment.baseURL)/?user=eve")

        let create = try XCTUnwrap(
            firstExisting([
                safari.buttons["+ Make something happen"],
                safari.buttons["create-event"],
            ], timeout: 30),
            "Partitime must expose the create-event trigger"
        )
        create.tap()

        let title = try XCTUnwrap(
            firstExisting([
                safari.textFields["Event title"],
                safari.textFields["event-title"],
            ]),
            "Partitime must expose Event title"
        )
        title.tap()
        XCTAssertTrue(
            waitUntil(timeout: 300) { self.value(title) == environment.title },
            "the operator must type the exact title with the physical iPhone keyboard"
        )

        let location = try XCTUnwrap(
            firstExisting([
                safari.textFields["Location"],
                safari.textFields["event-location"],
            ]),
            "Partitime must expose Location"
        )
        location.tap()
        XCTAssertTrue(
            waitUntil(timeout: 300) { self.value(location) == environment.location },
            "the operator must type the exact location with the physical iPhone keyboard"
        )

        let submit = try XCTUnwrap(
            firstExisting([
                safari.buttons["Send the invite"],
                safari.buttons["Send the invite ↗"],
                safari.buttons["create-event-submit"],
            ]),
            "Partitime must expose the create submitter"
        )
        submit.tap()
        XCTAssertTrue(
            safari.staticTexts[environment.title].waitForExistence(timeout: 20),
            "the exact attended title must reach the created-event outcome"
        )
        attachSafariState("manual-create-text", environment: environment)
    }

    func testManualRsvpSpaceObservation() throws {
        let environment = try environment()
        openRoute(eventRoute(environment))

        let going = try XCTUnwrap(
            firstExisting([
                safari.buttons["Going"],
                safari.radioButtons["Going"],
                safari.buttons["rsvp-going"],
            ], timeout: 30),
            "Partitime must expose the Going RSVP control"
        )
        let before = String(describing: going.value ?? going.isSelected)
        going.tap()
        going.typeText(" ")
        XCTAssertTrue(
            waitUntil(timeout: 20) {
                String(describing: going.value ?? going.isSelected) != before
            },
            "XCUITest must focus the RSVP control and activate it with a native Space key"
        )
        attachSafariState("manual-rsvp-space", environment: environment)
    }

    func testManualWallKeyboardObservation() throws {
        let environment = try environment()
        openRoute(eventRoute(environment))

        let field = try XCTUnwrap(
            firstExisting([
                safari.textFields["Message"],
                safari.textFields["Message from Eve"],
                safari.textFields["wall-message"],
            ], timeout: 30),
            "Partitime must expose the wall message field"
        )
        field.tap()

        var pendingSeen = false
        let completed = waitUntil(timeout: 300) {
            if self.safari.staticTexts["Sending…"].exists {
                pendingSeen = true
            }
            let typed = self.value(field) == environment.wall
            let settled = self.safari.staticTexts[environment.wall].exists
            return typed || settled
        }
        XCTAssertTrue(completed, "the operator must type the exact wall value")
        XCTAssertTrue(
            waitUntil(timeout: 300) {
                if self.safari.staticTexts["Sending…"].exists {
                    pendingSeen = true
                }
                return self.safari.staticTexts[environment.wall].exists
            },
            "the operator must submit the wall value with the physical keyboard Return key"
        )
        XCTAssertTrue(pendingSeen, "the physical run must witness the pending Sending state")
        attachSafariState("manual-wall-keyboard", environment: environment)
    }

    func testManualReducedMotionWallObservation() throws {
        let environment = try environment()
        let host = XCUIApplication()
        host.launch()
        XCTAssertTrue(
            host.staticTexts["Reduce Motion enabled"].waitForExistence(timeout: 10),
            "system Reduce Motion must be enabled before the attended run"
        )

        openRoute(eventRoute(environment))
        let field = try XCTUnwrap(
            firstExisting([
                safari.textFields["Message"],
                safari.textFields["Message from Eve"],
                safari.textFields["wall-message"],
            ], timeout: 30),
            "Partitime must expose the reduced-motion wall field"
        )
        field.tap()

        var pendingSeen = false
        XCTAssertTrue(
            waitUntil(timeout: 300) {
                if self.safari.staticTexts["Sending…"].exists {
                    pendingSeen = true
                }
                return self.safari.staticTexts[environment.reducedWall].exists
            },
            "the operator must type and submit the reduced-motion value with the physical keyboard"
        )
        XCTAssertTrue(pendingSeen, "the reduced-motion physical run must witness Sending")
        attachSafariState("manual-reduced-motion-wall", environment: environment)
    }
}
