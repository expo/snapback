import XCTest

// @ref LLP 0201#d3--independent-quality-gate — prototype observations are not calibration passes.
// Uses the frozen IDs. Tab labels below are a disclosed, Grok-specific navigation adapter.
final class NativeProbe: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "dev.snapback.np2.cal30")
    func node(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    func emit(_ name: String, _ fields: [String: Any] = [:]) {
        var row = fields
        row["event"] = name
        row["at"] = ISO8601DateFormatter().string(from: Date())
        let data = try! JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
        print("NP2_EVENT " + String(data: data, encoding: .utf8)!)
    }
    func snapshot(_ name: String) {
        let rows = app.descendants(matching: .any).allElementsBoundByIndex.filter { $0.identifier.hasPrefix("sm-") }.map {
            ["id": $0.identifier, "label": $0.label, "value": String(describing: $0.value ?? ""), "hittable": String($0.isHittable)]
        }
        emit(name, ["nodes": rows, "tree": app.debugDescription])
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    func tapTab(_ label: String) {
        let button = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 15), "missing tab: " + label)
        if button.exists { button.tap() }
    }
    func openBob() {
        tapTab("Chats")
        let chat = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ AND value == %@", "sm-chats-item", "dm:bob")).firstMatch
        XCTAssertTrue(chat.waitForExistence(timeout: 20), "missing stable chat identity")
        snapshot("chat-list")
        if chat.exists { chat.tap() }
        XCTAssertTrue(node("sm-convo-input").waitForExistence(timeout: 20))
    }
    func test01Prime() {
        continueAfterFailure = false
        app.launch()
        snapshot("launch")
        let email = node("sm-auth-email")
        XCTAssertTrue(email.waitForExistence(timeout: 20))
        email.tap(); email.typeText("alice@example.com")
        let password = node("sm-auth-password")
        password.tap(); password.typeText("NP2-fixture-only-20261004")
        node("sm-auth-submit").tap()
        openBob()
        snapshot("online-conversation")
        let media = node("sm-convo-media")
        if media.waitForExistence(timeout: 10) && media.isHittable {
            media.tap(); snapshot("online-ordinary-viewer")
            if node("sm-media-viewer-close").exists { node("sm-media-viewer-close").tap() }
        }
        let once = node("sm-convo-viewonce")
        if once.exists && once.isHittable {
            once.tap(); snapshot("online-once-viewer")
            if node("sm-media-viewer-close").waitForExistence(timeout: 5) { node("sm-media-viewer-close").tap() }
        }
        snapshot("prime-end")
        app.terminate()
        emit("prime-terminated", ["state": app.state.rawValue])
    }
    func test02Cold() {
        continueAfterFailure = false
        emit("cold-before-launch", ["state": app.state.rawValue])
        app.launch()
        openBob()
        snapshot("cold-conversation")
        let media = node("sm-convo-media")
        if media.exists && media.isHittable {
            media.tap(); snapshot("cold-ordinary-viewer")
            if node("sm-media-viewer-close").exists { node("sm-media-viewer-close").tap() }
        }
        snapshot("cold-once-state")
        if app.navigationBars.buttons.firstMatch.exists { app.navigationBars.buttons.firstMatch.tap() }
        tapTab("Search")
        let search = node("sm-search-input")
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap(); search.typeText("np2needle")
        _ = node("sm-search-result").waitForExistence(timeout: 10)
        snapshot("cold-search")
        if node("sm-search-result").exists { node("sm-search-result").tap(); snapshot("cold-result-tapped") }
        tapTab("Chats")
        openBob()
        for text in ["NP2 queued first 20261004", "NP2 queued second 20261004"] {
            let input = node("sm-convo-input")
            input.tap(); input.typeText(text)
            node("sm-convo-send").tap()
            snapshot(text)
        }
        emit("cold-queue-end")
    }
}
