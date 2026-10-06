import XCTest
import Foundation

// @ref LLP 0201.000#4 — external UI actions and native trees, with no app success callback.
final class NativeDriver: XCTestCase {
  var application: XCUIApplication!
  let endpoint = "http://127.0.0.1:49492"
  func request(_ method: String, _ path: String, _ body: [String: Any]? = nil) throws -> [String: Any] {
    var req = URLRequest(url: URL(string: endpoint + path)!); req.httpMethod = method; req.timeoutInterval = 35
    if let body = body { req.httpBody = try JSONSerialization.data(withJSONObject: body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    let done = DispatchSemaphore(value: 0)
    var result: Result<Data, Error>!
    URLSession.shared.dataTask(with: req) { data, _, error in
      if let error = error { result = .failure(error) } else { result = .success(data ?? Data()) }; done.signal()
    }.resume()
    guard done.wait(timeout: .now() + 40) == .success else { throw NSError(domain:"NI", code: 1) }
    return try JSONSerialization.jsonObject(with: result.get()) as! [String: Any]
  }
  func target(_ selector: [String: Any]) -> XCUIElement {
    var query = application.descendants(matching: .any)
    if let parent = selector["parent"] as? [String: Any] { query = target(parent).descendants(matching: .any) }
    let id = selector["id"] as! String
    var result = query.matching(identifier: id)
    if let value = selector["value"] as? String { result = result.matching(NSPredicate(format: "value == %@", value)) }
    return result.firstMatch
  }
  func snapshot(_ node: XCUIElementSnapshot, _ bounds: CGRect, _ depth: Int = 0) -> [String: Any] {
    let frame = node.frame
    var result: [String: Any] = ["id": node.identifier, "label": node.label, "value": node.value as? String ?? "",
      "type": node.elementType.rawValue, "enabled": node.isEnabled, "hittable": !frame.isEmpty && frame.intersects(bounds),
      "frame": ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]]
    if depth < 15 { result["children"] = node.children.map { snapshot($0, bounds.intersection(frame), depth + 1) } }
    return result
  }
  func testCommands() throws {
    continueAfterFailure = false
    executionTimeAllowance = 3600
    var stopping = false
    while !stopping {
      let command = try request("GET", "/next")
      if command["op"] as? String == "idle" { continue }
      var answer: [String: Any] = ["serial": command["serial"]!]
      let op = command["op"] as! String
      switch op {
      case "attach": application = XCUIApplication(bundleIdentifier: command["bundleId"] as! String)
      case "launch":
        application.launchArguments = command["args"] as? [String] ?? []
        application.launch(); answer["state"] = application.state.rawValue
      case "terminate": application.terminate(); answer["state"] = application.state.rawValue
      case "state": answer["state"] = application.state.rawValue
      case "tree":
        let state = application.state
        answer["state"] = state.rawValue
        if state == .notRunning || state == .unknown { answer["error"] = "application-not-running" }
        else {
          let captured = try application.snapshot()
          answer["tree"] = snapshot(captured, captured.frame)
          if command["screenshot"] as? Bool == true { answer["png"] = application.screenshot().pngRepresentation.base64EncodedString() }
        }
      case "tap", "type":
        let element = target(command["selector"] as! [String: Any])
        if !element.waitForExistence(timeout: 2) || !element.isHittable { answer["error"] = "selector-not-hittable" }
        else { element.tap(); if op == "type" { for character in command["text"] as! String { element.typeText(String(character)) } } }
      case "scroll":
        let scroll = application.scrollViews.firstMatch
        if scroll.exists { if command["direction"] as? String == "down" { scroll.swipeDown() } else { scroll.swipeUp() } }
        else { answer["error"] = "no-scroll-view" }
      case "stop": stopping = true
      default: answer["error"] = "unknown-command"
      }
      _ = try request("POST", "/result", answer)
    }
  }
}
