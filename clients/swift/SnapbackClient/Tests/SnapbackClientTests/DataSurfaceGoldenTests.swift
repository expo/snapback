import XCTest
@testable import SnapbackClient

/// Phase 0 deliberately admits no Swift data API. It only proves the shared
/// descriptor/refusal bytes can be consumed without inventing another shape.
/// @ref LLP 0255#s9-package-doorway-and-generated-typing
final class DataSurfaceGoldenTests: XCTestCase {
    private static func fixtureURL() -> URL {
        if let root = ProcessInfo.processInfo.environment["SNAPBACK_REPO_ROOT"] {
            return URL(fileURLWithPath: root)
                .appending(path: "schemas/data-surface-swift-phase0-goldens.v1.json")
        }
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }
        return url.appending(path: "schemas/data-surface-swift-phase0-goldens.v1.json")
    }

    func testDescriptorAndRefusalCanonicalBytesMatch() throws {
        let fixture = try JSONValue.parse(Data(contentsOf: Self.fixtureURL()))
        for (valueKey, bytesKey) in [
            ("descriptor", "descriptorCanonical"),
            ("refusal", "refusalCanonical"),
        ] {
            let value = try XCTUnwrap(fixture[valueKey])
            let expected = try XCTUnwrap(fixture[bytesKey]?.stringValue)
            let actual = try JSONSerialization.data(
                withJSONObject: value.rawValue,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
            XCTAssertEqual(actual, Data(expected.utf8), valueKey)
        }
    }
}
