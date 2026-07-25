import XCTest
@testable import SnapbackClient

/// Replays the committed conformance corpus
/// (`schemas/live.wire-fixtures.v1.json`) against the LLP 0095 §1 state
/// machine, honoring tuple routing (§2.2). Every fixture the corpus routes
/// to a claimed tuple must pass; failures are either client bugs or
/// fixture/spec defects (which get tickets, not skips).
final class FixtureConformanceTests: XCTestCase {
    static func corpusURL() -> URL {
        if let override = ProcessInfo.processInfo.environment["SNAPBACK_REPO_ROOT"] {
            return URL(fileURLWithPath: override).appending(path: "schemas/live.wire-fixtures.v1.json")
        }
        // …/clients/swift/SnapbackClient/Tests/SnapbackClientTests/<file> → repo root.
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }
        return url.appending(path: "schemas/live.wire-fixtures.v1.json")
    }

    func testCorpusPasses() throws {
        let data = try Data(contentsOf: Self.corpusURL())
        let harness = FixtureHarness(claimedTuples: ["poll/local", "live/local"])
        let result = try harness.run(corpusData: data)
        XCTAssertEqual(result.wireVersion, "snapback.v1")
        XCTAssertGreaterThanOrEqual(result.evaluatedCount, 10, "corpus should carry at least the seeded fixtures")
        for fixture in result.results {
            XCTAssertTrue(fixture.passed, "\(fixture.name): \(fixture.detail)")
        }
    }

    /// The corpus must never route `poll/hosted` (unclaimable, LLP 0095
    /// §2.2); mirrored client-side so a corpus regression is caught here too.
    func testNoPollHostedTuples() throws {
        let data = try Data(contentsOf: Self.corpusURL())
        let corpus = try JSONValue.parse(data)
        for fixture in corpus["fixtures"]?.arrayValue ?? [] {
            let tuples = fixture["tuples"]?.arrayValue?.compactMap { $0.stringValue } ?? []
            XCTAssertFalse(tuples.contains("poll/hosted"), "\(fixture["name"]?.stringValue ?? "?") claims poll/hosted")
        }
    }
}

/// Decoder-tolerance unit coverage beyond the corpus: the Codable-free
/// decode layer must skip-not-crash by construction (LLP 0094 §0C.2).
final class TolerantDecodingTests: XCTestCase {
    func testUnknownSocketKindIsDispatchedAsUnknown() throws {
        let json = try JSONValue.parse(#"{"kind":"quantum_ack_v7","stuff":[1,2,3]}"#)
        guard case .unknownKind(let kind) = ServerFrame.decode(json) else {
            return XCTFail("expected unknownKind dispatch")
        }
        XCTAssertEqual(kind, "quantum_ack_v7")
    }

    func testKnownKindMissingMembersIsUndecodableNotUnknown() throws {
        // The known-kind/unknown-kind distinction T-DB-P turns on.
        let json = try JSONValue.parse(#"{"kind":"live_replace"}"#)
        guard case .undecodableKnownKind(let kind) = ServerFrame.decode(json) else {
            return XCTFail("expected undecodableKnownKind dispatch")
        }
        XCTAssertEqual(kind, "live_replace")
    }

    func testResyncReasonIsAnOpenString() throws {
        let json = try JSONValue.parse(#"{"kind":"resync_required","reason":"reason_invented_in_2031","clear_retained":false,"subscription_id":"s1"}"#)
        let machine = ClientStateMachine()
        machine.applySnapshot(subscriptionId: "s1", function: "f", snapshot: QuerySnapshot(version: 7, rows: [], cursor: nil))
        let event = machine.ingestFrame(json, postOwnershipCut: true)
        XCTAssertEqual(event.actions, [.resubscribeSubscription])
        XCTAssertEqual(machine.subscriptions["s1"]?.state, .resyncPending)
    }

    func testRequestIdAliasIsClientToServerOnly() throws {
        // Server frames emit `requestId` (no alias); the snake alias exists
        // only on the client→server family (LLP 0093 gotcha 6). A pong with
        // `request_id` therefore decodes with the alias member treated as an
        // unknown field, not as the requestId.
        let json = try JSONValue.parse(#"{"kind":"pong","serverTimeMs":12,"request_id":"x"}"#)
        guard let decoded = LiveSocketServerFrame.from(json) else {
            return XCTFail("pong should decode")
        }
        XCTAssertTrue(decoded.hadUnknownFields)
        guard case .pong(let requestId, let serverTimeMs) = decoded.value else {
            return XCTFail("expected pong")
        }
        XCTAssertNil(requestId)
        XCTAssertEqual(serverTimeMs, 12)
    }

    func testDurableBytesForcesResyncEquivalenceClass() throws {
        let machine = ClientStateMachine()
        machine.applySnapshot(subscriptionId: "s1", function: "f", snapshot: QuerySnapshot(version: 1, rows: [], cursor: nil))
        let json = try JSONValue.parse(#"{"kind":"durable_bytes","payload":[255,254]}"#)
        let event = machine.ingestFrame(json, postOwnershipCut: true)
        XCTAssertEqual(Set(event.actions), [.resubscribeAll, .clearRetainedOverlays])
        XCTAssertEqual(event.resubscribe, ["s1"])
        XCTAssertTrue(machine.retainedOverlaysCleared)
    }

    func testVersionGuardDropsEqualAndOlder() throws {
        let machine = ClientStateMachine()
        machine.applySnapshot(subscriptionId: "s1", function: "f", snapshot: QuerySnapshot(version: 10, rows: [], cursor: nil))
        for version in [9, 10] {
            let json = try JSONValue.parse(#"{"kind":"live_replace","subscription_id":"s1","function":"f","version":\#(version),"rows":[{"id":"r"}]}"#)
            let event = machine.ingestFrame(json, postOwnershipCut: true)
            XCTAssertEqual(event.actions, [.dropStale], "version \(version)")
        }
        let json = try JSONValue.parse(#"{"kind":"live_replace","subscription_id":"s1","function":"f","version":11,"rows":[{"id":"r"}]}"#)
        XCTAssertEqual(machine.ingestFrame(json, postOwnershipCut: true).actions, [.replaceRows])
        XCTAssertEqual(machine.subscriptions["s1"]?.state, .live(version: 11))
    }
}
