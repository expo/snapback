import XCTest
@testable import SnapbackClient

private let invalidationTestIncarnation =
    "0198c7aa-1234-7000-8000-000000000001"
private let invalidationTestIssuer: JSONValue = .object([
    "authorizationIncarnation": .string(invalidationTestIncarnation),
    "bootSequence": .int(1),
    "bootNonce": .string("AAAAAAAAAAAAAAAAAAAAAA"),
])
private let invalidationTestNamespace: JSONValue = .object([
    "clientStoreId": .string("swift_test"),
    "queryKey": .string("listPrivate:{}"),
    "queryInstanceId": .int(1),
])

private func invalidationTestScope(_ subscriptionId: String) -> JSONValue {
    .object([
        "kind": .string("subscription"),
        "issuerId": invalidationTestIssuer,
        "namespace": invalidationTestNamespace,
        "scopeSequence": .int(1),
        "connectionGeneration": .int(1),
        "subscriptionId": .string(subscriptionId),
    ])
}

private func seedInvalidationCustody(
    _ machine: ClientStateMachine,
    subscriptionId: String,
    function: String = "listPrivate",
    version: UInt64 = 4,
    rows: [JSONValue] = [],
    acceptedEpoch: UInt64 = 1,
    expectedEpoch: UInt64
) {
    let accepted = AuthorizationVersion(
        incarnation: invalidationTestIncarnation,
        epoch: acceptedEpoch
    )
    machine.noteGranted(
        authorizationInvalidation: AuthorizationInvalidationConnection(
            protocolVersion: 1,
            issuerId: invalidationTestIssuer,
            connectionGeneration: 1,
            authorization: AuthorizationVersion(
                incarnation: invalidationTestIncarnation,
                epoch: expectedEpoch
            ),
            versionStream: "swift-stream"
        )
    )
    machine.applySnapshot(
        subscriptionId: subscriptionId,
        function: function,
        snapshot: QuerySnapshot(
            version: version,
            rows: rows,
            cursor: nil
        ),
        authorizationNamespace: invalidationTestNamespace,
        authorizationScope: invalidationTestScope(subscriptionId),
        acceptedAuthorization: accepted,
        authorizationVersionStream: "swift-stream"
    )
}

private func invalidationTestWitness(
    epoch: Int64,
    floor: Int64
) -> JSONValue {
    .object([
        "authorization": .object([
            "incarnation": .string(invalidationTestIncarnation),
            "epoch": .int(epoch),
        ]),
        "data": .object([
            "versionStream": .string("swift-stream"),
            "minCommitVersion": .int(floor),
        ]),
    ])
}

private func invalidationTestObligation(
    subscriptionId: String,
    revision: Int64,
    epoch: Int64,
    floor: Int64,
    maxDisposition: String = "quarantine"
) -> JSONValue {
    .object([
        "protocolVersion": .int(1),
        "scopeId": invalidationTestScope(subscriptionId),
        "revision": .int(revision),
        "maxDisposition": .string(maxDisposition),
        "witness": invalidationTestWitness(epoch: epoch, floor: floor),
        "retryEpisodeId": .null,
        "ownerContinuityId": .string("owner_swift"),
    ])
}

private func invalidationTestFrame(
    subscriptionId: String,
    revision: Int64,
    epoch: Int64,
    floor: Int64,
    snapshotVersion: Int64? = nil,
    terminalDelete: Bool = false,
    ackToken: String = "ack_test"
) -> JSONValue {
    let disposition = terminalDelete ? "delete" : "quarantine"
    let obligation = invalidationTestObligation(
        subscriptionId: subscriptionId,
        revision: revision,
        epoch: epoch,
        floor: floor,
        maxDisposition: disposition
    )
    var members: [String: JSONValue] = [
        "kind": .string("authorization_invalidation"),
        "obligation": obligation,
    ]
    if let snapshotVersion {
        members["snapshot"] = .object([
            "subscriptionId": .string(subscriptionId),
            "function": .string("listPrivate"),
            "version": .int(snapshotVersion),
            "rows": .array([
                .object(["_id": .string("authorized")]),
            ]),
        ])
    } else {
        members["snapshot"] = .null
    }
    if terminalDelete || snapshotVersion != nil {
        members["resolution"] = .object([
            "protocolVersion": .int(1),
            "kind": .string(
                terminalDelete ? "terminalDelete" : "snapshot"
            ),
            "scopeId": invalidationTestScope(subscriptionId),
            "revision": .int(revision),
            "witness": invalidationTestWitness(epoch: epoch, floor: floor),
            "maxDisposition": .string(disposition),
            "ackToken": .string(ackToken),
            "ownerContinuityId": .string("owner_swift"),
        ])
    }
    return .object(members)
}

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
        let corpus = try JSONValue.parse(data)
        let expectedEvaluations = corpus["fixtures"]?.arrayValue?
            .reduce(into: 0) { count, fixture in
                count += fixture["tuples"]?.arrayValue?.compactMap(
                    \.stringValue
                ).filter {
                    ["poll/local", "live/local"].contains($0)
                }.count ?? 0
            } ?? 0
        XCTAssertEqual(result.formatVersion, 2)
        XCTAssertEqual(result.wireVersion, "snapback.v1")
        XCTAssertEqual(
            result.judgedAgainst,
            "LLP 0095 §1 (abstract client state machine)"
        )
        XCTAssertEqual(result.evaluatedCount, expectedEvaluations)
        XCTAssertEqual(result.skippedCount, 0)
        XCTAssertTrue(result.failures.isEmpty)
        for fixture in result.results {
            XCTAssertTrue(
                fixture.passed,
                "\(fixture.name) [\(fixture.tuple ?? "unrouted")]: \(fixture.detail)"
            )
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

    func testFormatV2RejectsNamelessAndTuplelessFixtures() throws {
        func corpus(_ fixtures: String) -> Data {
            Data(
                """
                {
                  "artifactKind":"liveWireFixtureCorpus",
                  "formatVersion":2,
                  "wireVersion":"snapback.v1",
                  "judgedAgainst":"LLP 0095 §1 (abstract client state machine)",
                  "fixtures":\(fixtures)
                }
                """.utf8
            )
        }
        let malformed = [
            #"[{"tuples":["live/local"],"direction":"server_to_client","schemaValid":true,"lane":"core"}]"#,
            #"[{"name":"missing-tuples","direction":"server_to_client","schemaValid":true,"lane":"core"}]"#,
            #"[{"name":"empty-tuples","tuples":[],"direction":"server_to_client","schemaValid":true,"lane":"core"}]"#,
            #"[{"name":"invalid-tuples","tuples":[7],"direction":"server_to_client","schemaValid":true,"lane":"core"}]"#,
            #"[{"name":"unknown-tuple","tuples":["poll/hosted"],"direction":"server_to_client","schemaValid":true,"lane":"poll"}]"#,
            #"[{"name":"duplicate-tuple","tuples":["live/local","live/local"],"direction":"server_to_client","schemaValid":true,"lane":"core"}]"#,
            #"[{"name":"wrong-lane","tuples":["live/local"],"direction":"server_to_client","schemaValid":true,"lane":"poll"}]"#,
        ]
        let harness = FixtureHarness()
        for fixtures in malformed {
            XCTAssertThrowsError(
                try harness.run(corpusData: corpus(fixtures))
            )
        }
        XCTAssertThrowsError(
            try FixtureHarness(claimedTuples: ["poll/hosted"]).run(
                corpusData: corpus("[]")
            )
        )
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

    func testWireIdentityUsesUnderscoreIdWhenApplicationIdCollides() {
        let machine = ClientStateMachine()
        machine.applySnapshot(
            subscriptionId: "s_identity",
            function: "f",
            snapshot: QuerySnapshot(
                version: 1,
                rows: [
                    .object(["_id": .string("row_a"), "id": .string("same")]),
                    .object(["_id": .string("row_b"), "id": .string("same")]),
                ],
                cursor: nil
            )
        )
        XCTAssertEqual(machine.subscriptions["s_identity"]?.rows.count, 2)
        XCTAssertNotNil(machine.subscriptions["s_identity"]?.rows["row_a"])
        XCTAssertNotNil(machine.subscriptions["s_identity"]?.rows["row_b"])
    }

    func testAuthorizationInvalidationAtEqualDataVersionAppliesBeforeAckAndDuplicateAcksAgain() throws {
        let machine = ClientStateMachine()
        seedInvalidationCustody(
            machine,
            subscriptionId: "sub_auth",
            rows: [
                .object([
                    "id": .string("old"), "value": .string("old"),
                ]),
            ],
            expectedEpoch: 2
        )
        let frame = try JSONValue.parse(
            """
            {
              "kind": "authorization_invalidation",
              "obligation": {
                "protocolVersion": 1,
                "scopeId": {
                  "kind": "subscription",
                  "issuerId": {
                    "authorizationIncarnation": "0198c7aa-1234-7000-8000-000000000001",
                    "bootSequence": 1,
                    "bootNonce": "AAAAAAAAAAAAAAAAAAAAAA"
                  },
                  "namespace": {
                    "clientStoreId": "swift_test",
                    "queryKey": "listPrivate:{}",
                    "queryInstanceId": 1
                  },
                  "scopeSequence": 1,
                  "connectionGeneration": 1,
                  "subscriptionId": "sub_auth"
                },
                "revision": 1,
                "maxDisposition": "quarantine",
                "witness": {
                  "authorization": {
                    "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                    "epoch": 2
                  },
                  "data": {"versionStream": "swift-stream", "minCommitVersion": 4}
                },
                "retryEpisodeId": null,
                "ownerContinuityId": "owner_swift"
              },
              "snapshot": {
                "subscriptionId": "sub_auth",
                "function": "listPrivate",
                "version": 4,
                "rows": [{"id": "new", "value": "new"}]
              },
              "resolution": {
                "protocolVersion": 1,
                "kind": "snapshot",
                "scopeId": {
                  "kind": "subscription",
                  "issuerId": {
                    "authorizationIncarnation": "0198c7aa-1234-7000-8000-000000000001",
                    "bootSequence": 1,
                    "bootNonce": "AAAAAAAAAAAAAAAAAAAAAA"
                  },
                  "namespace": {
                    "clientStoreId": "swift_test",
                    "queryKey": "listPrivate:{}",
                    "queryInstanceId": 1
                  },
                  "scopeSequence": 1,
                  "connectionGeneration": 1,
                  "subscriptionId": "sub_auth"
                },
                "revision": 1,
                "witness": {
                  "authorization": {
                    "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                    "epoch": 2
                  },
                  "data": {"versionStream": "swift-stream", "minCommitVersion": 4}
                },
                "maxDisposition": "quarantine",
                "ackToken": "ack_auth_4",
                "ownerContinuityId": "owner_swift"
              }
            }
            """
        )

        let applied = machine.ingestFrame(frame, postOwnershipCut: true)
        XCTAssertEqual(
            applied.actions,
            [.quarantineRows, .applyInvalidationSnapshot, .acknowledgeObligation]
        )
        XCTAssertEqual(applied.acknowledgements, ["ack_auth_4"])
        XCTAssertEqual(
            machine.subscriptions["sub_auth"]?.orderedRows,
            [.object(["id": .string("new"), "value": .string("new")])]
        )
        XCTAssertEqual(
            machine.subscriptions["sub_auth"]?
                .invalidationRevisionHighWater,
            1
        )
        XCTAssertEqual(
            machine.subscriptions["sub_auth"]?.acceptedAuthorization?.epoch,
            2
        )
        XCTAssertNil(
            machine.subscriptions["sub_auth"]?
                .pendingAuthorizationObligation
        )

        let duplicate = machine.ingestFrame(frame, postOwnershipCut: true)
        XCTAssertEqual(
            duplicate.actions,
            [.acknowledgeObligation]
        )
        XCTAssertEqual(duplicate.acknowledgements, ["ack_auth_4"])
        XCTAssertEqual(
            machine.subscriptions["sub_auth"]?.orderedRows,
            [.object(["id": .string("new"), "value": .string("new")])]
        )
    }

    func testTerminalDeleteDestroysRowsBeforeAckAndNeverResubscribes() throws {
        let machine = ClientStateMachine()
        seedInvalidationCustody(
            machine,
            subscriptionId: "sub_auth",
            rows: [.object(["_id": .string("secret")])],
            expectedEpoch: 3
        )
        let frame = try JSONValue.parse(
            """
            {
              "kind": "authorization_invalidation",
              "obligation": {
                "protocolVersion": 1,
                "scopeId": {
                  "kind": "subscription",
                  "issuerId": {
                    "authorizationIncarnation": "0198c7aa-1234-7000-8000-000000000001",
                    "bootSequence": 1,
                    "bootNonce": "AAAAAAAAAAAAAAAAAAAAAA"
                  },
                  "namespace": {
                    "clientStoreId": "swift_test",
                    "queryKey": "listPrivate:{}",
                    "queryInstanceId": 1
                  },
                  "scopeSequence": 1,
                  "connectionGeneration": 1,
                  "subscriptionId": "sub_auth"
                },
                "revision": 2,
                "maxDisposition": "delete",
                "witness": {
                  "authorization": {
                    "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                    "epoch": 3
                  },
                  "data": {"versionStream": "swift-stream", "minCommitVersion": 4}
                },
                "retryEpisodeId": null,
                "ownerContinuityId": "owner_swift"
              },
              "snapshot": null,
              "resolution": {
                "protocolVersion": 1,
                "kind": "terminalDelete",
                "scopeId": {
                  "kind": "subscription",
                  "issuerId": {
                    "authorizationIncarnation": "0198c7aa-1234-7000-8000-000000000001",
                    "bootSequence": 1,
                    "bootNonce": "AAAAAAAAAAAAAAAAAAAAAA"
                  },
                  "namespace": {
                    "clientStoreId": "swift_test",
                    "queryKey": "listPrivate:{}",
                    "queryInstanceId": 1
                  },
                  "scopeSequence": 1,
                  "connectionGeneration": 1,
                  "subscriptionId": "sub_auth"
                },
                "revision": 2,
                "witness": {
                  "authorization": {
                    "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                    "epoch": 3
                  },
                  "data": {"versionStream": "swift-stream", "minCommitVersion": 4}
                },
                "maxDisposition": "delete",
                "ackToken": "ack_terminal",
                "ownerContinuityId": "owner_swift"
              }
            }
            """
        )

        let applied = machine.ingestFrame(frame, postOwnershipCut: true)
        XCTAssertEqual(
            applied.actions,
            [.quarantineRows, .applyInvalidationTerminalDelete, .acknowledgeObligation]
        )
        XCTAssertEqual(applied.acknowledgements, ["ack_terminal"])
        XCTAssertTrue(applied.resubscribe.isEmpty)
        XCTAssertEqual(machine.subscriptions["sub_auth"]?.state, .terminalDeleted)
        XCTAssertEqual(machine.subscriptions["sub_auth"]?.orderedRows, [])

        let duplicate = machine.ingestFrame(frame, postOwnershipCut: true)
        XCTAssertEqual(duplicate.actions, [.acknowledgeObligation])
        XCTAssertEqual(duplicate.acknowledgements, ["ack_terminal"])
        XCTAssertTrue(duplicate.resubscribe.isEmpty)
        XCTAssertEqual(machine.subscriptions["sub_auth"]?.state, .terminalDeleted)

        let ordinaryFrames = [
            #"{"kind":"live_replace","subscription_id":"sub_auth","function":"listPrivate","version":5,"rows":[]}"#,
            #"{"kind":"live_delta","subscription_id":"sub_auth","function":"listPrivate","version":5,"ops":[]}"#,
            #"{"kind":"current_as_of","subscription_id":"sub_auth","function":"listPrivate","version":5,"resume":{}}"#,
            #"{"kind":"resync_required","subscription_id":"sub_auth","reason":"ordinary_resync","clear_retained":false}"#,
        ]
        for raw in ordinaryFrames {
            let rejected = machine.ingestFrame(
                try JSONValue.parse(raw),
                postOwnershipCut: true
            )
            XCTAssertEqual(
                rejected.actions,
                [.surfaceProtocolDiagnostic, .ignoreFrame]
            )
            XCTAssertEqual(
                machine.subscriptions["sub_auth"]?.state,
                .terminalDeleted
            )
        }
        XCTAssertTrue(machine.noteSocketLost().isEmpty)
        XCTAssertTrue(machine.forceConnectionWideResync().resubscribe.isEmpty)
        machine.noteGrantLost()
        machine.noteSuspended(subscriptionIds: ["sub_auth"])
        machine.noteReleased(subscriptionId: "sub_auth")
        machine.removeSubscription(id: "sub_auth")
        XCTAssertFalse(
            machine.applySnapshot(
                subscriptionId: "sub_auth",
                function: "listPrivate",
                snapshot: QuerySnapshot(
                    version: 6,
                    rows: [.object(["_id": .string("resurrected")])],
                    cursor: nil
                )
            )
        )
        XCTAssertFalse(
            machine.registerPending(
                subscriptionId: "sub_auth",
                function: "listPrivate"
            )
        )
        XCTAssertEqual(
            machine.subscriptions["sub_auth"]?.state,
            .terminalDeleted
        )
        XCTAssertTrue(machine.subscriptions["sub_auth"]?.rows.isEmpty == true)
    }

    func testPendingAuthorizationObligationBlocksEveryOrdinaryDataFrame() throws {
        let machine = ClientStateMachine()
        seedInvalidationCustody(
            machine,
            subscriptionId: "sub_pending",
            version: 10,
            rows: [.object(["_id": .string("secret")])],
            expectedEpoch: 2
        )
        let pending = machine.ingestFrame(
            invalidationTestFrame(
                subscriptionId: "sub_pending",
                revision: 2,
                epoch: 2,
                floor: 12
            ),
            postOwnershipCut: true
        )
        XCTAssertEqual(pending.actions, [.quarantineRows])
        XCTAssertEqual(
            machine.subscriptions["sub_pending"]?
                .invalidationRevisionHighWater,
            2
        )

        let ordinaryFrames = [
            #"{"kind":"live_replace","subscription_id":"sub_pending","function":"listPrivate","version":13,"rows":[{"_id":"leak"}]}"#,
            #"{"kind":"live_delta","subscription_id":"sub_pending","function":"listPrivate","version":13,"ops":[{"op":"add","id":"leak","row":{"_id":"leak"}}]}"#,
            #"{"kind":"current_as_of","subscription_id":"sub_pending","function":"listPrivate","version":13,"resume":{}}"#,
        ]
        for raw in ordinaryFrames {
            let rejected = machine.ingestFrame(
                try JSONValue.parse(raw),
                postOwnershipCut: true
            )
            XCTAssertEqual(
                rejected.actions,
                [.surfaceProtocolDiagnostic, .ignoreFrame]
            )
            XCTAssertEqual(
                machine.subscriptions["sub_pending"]?.state,
                .resyncPending
            )
            XCTAssertEqual(
                machine.subscriptions["sub_pending"]?
                    .invalidationRevisionHighWater,
                2
            )
            XCTAssertTrue(
                machine.subscriptions["sub_pending"]?.rows.isEmpty == true
            )
        }
    }

    func testPollDrainPropagatesInvalidationMaterializationChangeBeforeAck() throws {
        let machine = ClientStateMachine()
        seedInvalidationCustody(
            machine,
            subscriptionId: "sub_poll",
            rows: [.object(["_id": .string("secret")])],
            expectedEpoch: 2
        )
        let frame = invalidationTestFrame(
            subscriptionId: "sub_poll",
            revision: 1,
            epoch: 2,
            floor: 4,
            terminalDelete: true,
            ackToken: "ack_poll"
        )
        let payload = Array(try frame.encoded())
        let event = machine.ingestDrainBatch([
            .object([
                "Durable": .object([
                    "payload": .array(
                        payload.map { .int(Int64($0)) }
                    ),
                ]),
            ]),
        ])
        XCTAssertEqual(event.acknowledgements, ["ack_poll"])
        XCTAssertEqual(event.materializationChanges, ["sub_poll"])
        XCTAssertEqual(
            machine.subscriptions["sub_poll"]?.state,
            .terminalDeleted
        )
        XCTAssertTrue(
            event.actions.firstIndex(of: .applyInvalidationTerminalDelete)!
                < event.actions.firstIndex(of: .acknowledgeObligation)!
        )
    }

    func testAppliedInvalidationAdmitsNewerObligationBeforeRejectingReusedAckToken() {
        let machine = ClientStateMachine()
        seedInvalidationCustody(
            machine,
            subscriptionId: "sub_order",
            expectedEpoch: 2
        )
        let scope = invalidationTestScope("sub_order")
        func frame(revision: Int64, epoch: Int64, row: String, ack: String) -> JSONValue {
            let witness: JSONValue = .object([
                "authorization": .object([
                    "incarnation": .string("0198c7aa-1234-7000-8000-000000000001"),
                    "epoch": .int(epoch),
                ]),
                "data": .object([
                    "versionStream": .string("swift-stream"),
                    "minCommitVersion": .int(4),
                ]),
            ])
            let obligation: JSONValue = .object([
                "protocolVersion": .int(1),
                "scopeId": scope,
                "revision": .int(revision),
                "maxDisposition": .string("quarantine"),
                "witness": witness,
                "retryEpisodeId": .null,
                "ownerContinuityId": .string("owner_swift"),
            ])
            let resolution: JSONValue = .object([
                "protocolVersion": .int(1),
                "kind": .string("snapshot"),
                "scopeId": scope,
                "revision": .int(revision),
                "witness": witness,
                "maxDisposition": .string("quarantine"),
                "ackToken": .string(ack),
                "ownerContinuityId": .string("owner_swift"),
            ])
            return .object([
                "kind": .string("authorization_invalidation"),
                "obligation": obligation,
                "snapshot": .object([
                    "subscriptionId": .string("sub_order"),
                    "function": .string("listPrivate"),
                    "version": .int(4),
                    "rows": .array([.object(["_id": .string(row)])]),
                ]),
                "resolution": resolution,
            ])
        }

        let first = machine.ingestFrame(
            frame(
                revision: 1,
                epoch: 2,
                row: "authorized_1",
                ack: "ack_shared"
            ),
            postOwnershipCut: true
        )
        XCTAssertEqual(first.acknowledgements, ["ack_shared"])

        let reusedToken = machine.ingestFrame(
            frame(
                revision: 2,
                epoch: 2,
                row: "wrong_ticket",
                ack: "ack_shared"
            ),
            postOwnershipCut: true
        )
        XCTAssertTrue(
            reusedToken.actions.contains(.surfaceProtocolDiagnostic)
        )
        XCTAssertTrue(reusedToken.acknowledgements.isEmpty)
        XCTAssertEqual(
            machine.subscriptions["sub_order"]?.state,
            .resyncPending
        )
        XCTAssertEqual(
            machine.subscriptions["sub_order"]?
                .invalidationRevisionHighWater,
            2
        )
        XCTAssertEqual(
            machine.subscriptions["sub_order"]?
                .pendingAuthorizationObligation?["revision"]?.uint64Value,
            2
        )
        XCTAssertTrue(
            machine.subscriptions["sub_order"]?.rows.isEmpty == true
        )

        let older = machine.ingestFrame(
            frame(revision: 1, epoch: 1, row: "stale", ack: "ack_1"),
            postOwnershipCut: true
        )
        XCTAssertEqual(older.actions, [.surfaceProtocolDiagnostic, .ignoreFrame])
        XCTAssertTrue(older.acknowledgements.isEmpty)
        XCTAssertTrue(machine.subscriptions["sub_order"]?.rows.isEmpty == true)
        XCTAssertNil(machine.subscriptions["sub_order"]?.rows["stale"])

        let conflicting = machine.ingestFrame(
            frame(revision: 2, epoch: 99, row: "conflict", ack: "ack_conflict"),
            postOwnershipCut: true
        )
        XCTAssertEqual(conflicting.actions, [.surfaceProtocolDiagnostic, .ignoreFrame])
        XCTAssertTrue(conflicting.acknowledgements.isEmpty)
        XCTAssertTrue(machine.subscriptions["sub_order"]?.rows.isEmpty == true)
        XCTAssertNil(machine.subscriptions["sub_order"]?.rows["conflict"])
    }

    func testOlderAcknowledgementFailurePreservesNewerPendingObligation() {
        let machine = ClientStateMachine()
        seedInvalidationCustody(
            machine,
            subscriptionId: "sub_ack_race",
            expectedEpoch: 2
        )
        let applied = machine.ingestFrame(
            invalidationTestFrame(
                subscriptionId: "sub_ack_race",
                revision: 1,
                epoch: 2,
                floor: 4,
                snapshotVersion: 4,
                ackToken: "ack_old"
            ),
            postOwnershipCut: true
        )
        XCTAssertEqual(applied.acknowledgements, ["ack_old"])

        let pending = machine.ingestFrame(
            invalidationTestFrame(
                subscriptionId: "sub_ack_race",
                revision: 2,
                epoch: 2,
                floor: 5
            ),
            postOwnershipCut: true
        )
        XCTAssertTrue(pending.actions.contains(.quarantineRows))

        _ = machine.noteAuthorizationAcknowledgementUndischarged(
            ackToken: "ack_old",
            diagnostic: "late acknowledgement refusal"
        )
        let entry = machine.subscriptions["sub_ack_race"]
        XCTAssertEqual(entry?.state, .resyncPending)
        XCTAssertEqual(entry?.invalidationRevisionHighWater, 2)
        XCTAssertEqual(
            entry?.pendingAuthorizationObligation?["revision"]?.uint64Value,
            2
        )
        XCTAssertEqual(
            entry?.pendingAuthorizationObligation?["witness"]?["data"]?[
                "minCommitVersion"
            ]?.uint64Value,
            5
        )
        XCTAssertTrue(entry?.rows.isEmpty == true)
    }
}
