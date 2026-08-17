import XCTest

final class NativeCustodyProbesUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testShareProbeInvokesCustodyExtension() throws {
    let app = XCUIApplication()
    app.launch()

    let shareButton = app.buttons["probe-share-button"]
    XCTAssertTrue(shareButton.waitForExistence(timeout: 30), "Share probe button did not render")
    shareButton.tap()

    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    // iOS 26 renders the activity sheet in a presentation the classic
    // ActivityListView/sheet queries miss, and labels the extension cell with
    // the containing app's display name. Waiting for the cell itself is both
    // the sheet-appearance proof and the tap target.
    let candidateLabels = ["Custody Probe", "Native Custody Probes"]
    var tapped = false
    for label in candidateLabels where !tapped {
      tapped = tapActivity(named: label, app: app, springboard: springboard)
    }
    XCTAssertTrue(tapped, "No share-extension cell matched \(candidateLabels)")

    Thread.sleep(forTimeInterval: 5)
  }

  private func tapActivity(
    named label: String,
    app: XCUIApplication,
    springboard: XCUIApplication
  ) -> Bool {
    let roots = [app, springboard]
    let exactLabel = NSPredicate(format: "label == %@", label)

    for attempt in 0..<12 {
      for root in roots {
        let candidate = root.descendants(matching: .any).matching(exactLabel).firstMatch
        if candidate.exists && candidate.isHittable {
          candidate.tap()
          return true
        }
      }

      if attempt == 5 {
        for root in roots {
          let more = root.buttons.matching(NSPredicate(format: "label == %@", "More")).firstMatch
          if more.exists && more.isHittable {
            more.tap()
            break
          }
        }
      }

      var scrolled = false
      for root in roots {
        let collection = root.collectionViews.firstMatch
        if collection.exists && collection.isHittable {
          collection.swipeLeft()
          scrolled = true
        }
        let table = root.tables.firstMatch
        if table.exists && table.isHittable {
          table.swipeUp()
          scrolled = true
        }
        let sheet = root.sheets.firstMatch
        if !scrolled && sheet.exists && sheet.isHittable {
          sheet.swipeUp()
          scrolled = true
        }
      }
      if !scrolled {
        RunLoop.current.run(until: Date().addingTimeInterval(0.25))
      }
    }
    return false
  }
}
