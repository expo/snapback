import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import SnapbackClient

private final class ReservationStubProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var statuses: [Int] = []
    private(set) static var requestCount = 0

    static func configure(_ configuredStatuses: [Int]) {
        lock.lock()
        statuses = configuredStatuses
        requestCount = 0
        lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        let index = Self.requestCount
        Self.requestCount += 1
        let status = index < Self.statuses.count ? Self.statuses[index] : 200
        Self.lock.unlock()

        let body: Data
        if status == 409 {
            body = Data(
                """
                {"diagnostic":{"code":"SNAPBACK_AUTH_RESERVATION_STALE","severity":"error","subsystem":"auth","message":"reservation stale","details":{}}}
                """.utf8
            )
        } else {
            body = Data(#"{"ok":true}"#.utf8)
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["content-type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private final class GrantRecoveryStubProtocol: URLProtocol, @unchecked Sendable {
    struct SeenRequest: Sendable {
        var path: String
        var connectionToken: String?
        var body: String
    }

    private static let lock = NSLock()
    private static var requestIndex = 0
    private(set) static var seen: [SeenRequest] = []

    static func reset() {
        lock.lock()
        requestIndex = 0
        seen = []
        lock.unlock()
    }

    private static let grantJSON =
        """
        {
          "connectionId":"CONNECTION_ID",
          "connectionToken":"CONNECTION_TOKEN",
          "authorizationInvalidation":{
            "protocolVersion":1,
            "issuerId":{
              "authorizationIncarnation":"0198c7aa-1234-7000-8000-000000000001",
              "bootSequence":1,
              "bootNonce":"AAAAAAAAAAAAAAAAAAAAAA"
            },
            "connectionGeneration":1,
            "authorization":{
              "incarnation":"0198c7aa-1234-7000-8000-000000000001",
              "epoch":1
            },
            "versionStream":"swift-stream"
          }
        }
        """

    private static func grantBody(id: String, token: String) -> Data {
        Data(
            grantJSON
                .replacingOccurrences(of: "CONNECTION_ID", with: id)
                .replacingOccurrences(of: "CONNECTION_TOKEN", with: token)
                .utf8
        )
    }

    private static func subscribeBody(
        request: URLRequest,
        id: String,
        version: Int,
        supersessionRefusal: Bool
    ) -> Data {
        _ = request
        let namespace: [String: Any] = [
            "clientStoreId": "swift_recovery_test",
            "queryKey": "listPrivate:null",
            "queryInstanceId": 1,
        ]
        var response: [String: Any] = [
            "subscription_id": id,
            "snapshot": ["version": version, "rows": []],
            "receipt": NSNull(),
            "resume": NSNull(),
            "authorizationScope": [
                "kind": "subscription",
                "issuerId": [
                    "authorizationIncarnation":
                        "0198c7aa-1234-7000-8000-000000000001",
                    "bootSequence": 1,
                    "bootNonce": "AAAAAAAAAAAAAAAAAAAAAA",
                ],
                "namespace": namespace,
                "scopeSequence": version,
                "connectionGeneration": 1,
                "subscriptionId": id,
            ],
        ]
        if supersessionRefusal {
            response["supersessionRefusal"] =
                "SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN"
        }
        return try! JSONSerialization.data(withJSONObject: response)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        let index = Self.requestIndex
        Self.requestIndex += 1
        Self.seen.append(
            SeenRequest(
                path: request.url?.path ?? "?",
                connectionToken: request.value(
                    forHTTPHeaderField: "x-snapback-connection-token"
                ),
                body: request.httpBody.map {
                    String(decoding: $0, as: UTF8.self)
                } ?? ""
            )
        )
        Self.lock.unlock()

        let status: Int
        let body: Data
        switch index {
        case 0:
            status = 200
            body = Self.grantBody(id: "conn_old", token: "token_old")
        case 1:
            status = 200
            body = Self.subscribeBody(
                request: request,
                id: "sub_old",
                version: 1,
                supersessionRefusal: false
            )
        case 2:
            status = 200
            body = Data(#"{"receipt":null}"#.utf8)
        case 3:
            status = 403
            body = Data(
                #"{"diagnostic":{"code":"SNAPBACK_CONNECTION_TOKEN_INVALID","severity":"error","subsystem":"connection","message":"idle reaper discarded grant","details":{}}}"#.utf8
            )
        case 4:
            status = 200
            body = Self.grantBody(
                id: "conn_fresh",
                token: "token_fresh"
            )
        default:
            status = 200
            body = Self.subscribeBody(
                request: request,
                id: "sub_fresh",
                version: 2,
                supersessionRefusal: true
            )
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["content-type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private final class ResponseQueueStubProtocol: URLProtocol, @unchecked Sendable {
    struct Response {
        var status: Int
        var body: String
    }

    private static let lock = NSLock()
    private static var responses: [Response] = []
    private(set) static var requestCount = 0
    private(set) static var events: [String] = []

    static func configure(_ values: [Response]) {
        lock.lock()
        responses = values
        requestCount = 0
        events = []
        lock.unlock()
    }

    static func record(_ event: String) {
        lock.lock()
        events.append(event)
        lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        Self.lock.lock()
        let index = Self.requestCount
        Self.requestCount += 1
        let response = index < Self.responses.count
            ? Self.responses[index]
            : Response(status: 200, body: #"{"receipt":null}"#)
        Self.events.append(request.url?.path ?? "?")
        Self.lock.unlock()
        client?.urlProtocol(
            self,
            didReceive: HTTPURLResponse(
                url: request.url!,
                statusCode: response.status,
                httpVersion: "HTTP/1.1",
                headerFields: ["content-type": "application/json"]
            )!,
            cacheStoragePolicy: .notAllowed
        )
        client?.urlProtocol(self, didLoad: Data(response.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private let custodyNamespace: JSONValue = .object([
    "clientStoreId": .string("swift_custody_test"),
    "queryKey": .string("listPrivate:null"),
    "queryInstanceId": .int(1),
])

private let custodyGrant =
    """
    {
      "connectionId":"conn_custody",
      "connectionToken":"token_custody",
      "authorizationInvalidation":{
        "protocolVersion":1,
        "issuerId":{
          "authorizationIncarnation":"0198c7aa-1234-7000-8000-000000000001",
          "bootSequence":1,
          "bootNonce":"AAAAAAAAAAAAAAAAAAAAAA"
        },
        "connectionGeneration":1,
        "authorization":{
          "incarnation":"0198c7aa-1234-7000-8000-000000000001",
          "epoch":1
        },
        "versionStream":"swift-stream"
      }
    }
    """

private func custodySubscribeOutput(
    id: String,
    bootNonce: String = "AAAAAAAAAAAAAAAAAAAAAA",
    scopeSequence: Int = 1,
    superseded: String? = nil,
    supersessionRefusal: String? = nil,
    includePendingProjection: Bool = false
) -> String {
    var witness = ""
    if let superseded {
        witness += #","superseded":"\#(superseded)""#
    }
    if let supersessionRefusal {
        witness +=
            #","supersessionRefusal":"\#(supersessionRefusal)""#
    }
    if includePendingProjection {
        witness +=
            """
            ,"authorizationInvalidation":{
              "obligation":{
                "protocolVersion":1,
                "scopeId":{
                  "kind":"subscription",
                  "issuerId":{
                    "authorizationIncarnation":"0198c7aa-1234-7000-8000-000000000001",
                    "bootSequence":1,
                    "bootNonce":"\(bootNonce)"
                  },
                  "namespace":{
                    "clientStoreId":"swift_custody_test",
                    "queryKey":"listPrivate:null",
                    "queryInstanceId":1
                  },
                  "scopeSequence":\(scopeSequence),
                  "connectionGeneration":1,
                  "subscriptionId":"\(id)"
                },
                "revision":1,
                "maxDisposition":"quarantine",
                "witness":{
                  "authorization":{
                    "incarnation":"0198c7aa-1234-7000-8000-000000000001",
                    "epoch":1
                  },
                  "data":{
                    "versionStream":"swift-stream",
                    "minCommitVersion":1
                  }
                },
                "retryEpisodeId":null,
                "ownerContinuityId":"owner_swift"
              }
            }
            """
    }
    return
        """
        {
          "subscription_id":"\(id)",
          "snapshot":{"version":1,"rows":[]},
          "receipt":null,
          "resume":null,
          "authorizationScope":{
            "kind":"subscription",
            "issuerId":{
              "authorizationIncarnation":"0198c7aa-1234-7000-8000-000000000001",
              "bootSequence":1,
              "bootNonce":"\(bootNonce)"
            },
            "namespace":{
              "clientStoreId":"swift_custody_test",
              "queryKey":"listPrivate:null",
              "queryInstanceId":1
            },
            "scopeSequence":\(scopeSequence),
            "connectionGeneration":1,
            "subscriptionId":"\(id)"
          }
          \(witness)
        }
        """
}

private func custodyTerminalFrame(_ subscriptionId: String) -> JSONValue {
    let issuer: JSONValue = .object([
        "authorizationIncarnation":
            .string("0198c7aa-1234-7000-8000-000000000001"),
        "bootSequence": .int(1),
        "bootNonce": .string("AAAAAAAAAAAAAAAAAAAAAA"),
    ])
    let namespace = custodyNamespace
    let scope: JSONValue = .object([
        "kind": .string("subscription"),
        "issuerId": issuer,
        "namespace": namespace,
        "scopeSequence": .int(1),
        "connectionGeneration": .int(1),
        "subscriptionId": .string(subscriptionId),
    ])
    let witness: JSONValue = .object([
        "authorization": .object([
            "incarnation":
                .string("0198c7aa-1234-7000-8000-000000000001"),
            "epoch": .int(1),
        ]),
        "data": .object([
            "versionStream": .string("swift-stream"),
            "minCommitVersion": .int(1),
        ]),
    ])
    return .object([
        "kind": .string("authorization_invalidation"),
        "obligation": .object([
            "protocolVersion": .int(1),
            "scopeId": scope,
            "revision": .int(1),
            "maxDisposition": .string("delete"),
            "witness": witness,
            "retryEpisodeId": .null,
            "ownerContinuityId": .string("owner_swift"),
        ]),
        "snapshot": .null,
        "resolution": .object([
            "protocolVersion": .int(1),
            "kind": .string("terminalDelete"),
            "scopeId": scope,
            "revision": .int(1),
            "witness": witness,
            "maxDisposition": .string("delete"),
            "ackToken": .string("ack_poll_client"),
            "ownerContinuityId": .string("owner_swift"),
        ]),
    ])
}

private func custodySnapshotInvalidationFrame(
    _ subscriptionId: String
) -> JSONValue {
    let issuer: JSONValue = .object([
        "authorizationIncarnation":
            .string("0198c7aa-1234-7000-8000-000000000001"),
        "bootSequence": .int(1),
        "bootNonce": .string("AAAAAAAAAAAAAAAAAAAAAA"),
    ])
    let scope: JSONValue = .object([
        "kind": .string("subscription"),
        "issuerId": issuer,
        "namespace": custodyNamespace,
        "scopeSequence": .int(1),
        "connectionGeneration": .int(1),
        "subscriptionId": .string(subscriptionId),
    ])
    let witness: JSONValue = .object([
        "authorization": .object([
            "incarnation":
                .string("0198c7aa-1234-7000-8000-000000000001"),
            "epoch": .int(1),
        ]),
        "data": .object([
            "versionStream": .string("swift-stream"),
            "minCommitVersion": .int(1),
        ]),
    ])
    return .object([
        "kind": .string("authorization_invalidation"),
        "obligation": .object([
            "protocolVersion": .int(1),
            "scopeId": scope,
            "revision": .int(1),
            "maxDisposition": .string("quarantine"),
            "witness": witness,
            "retryEpisodeId": .null,
            "ownerContinuityId": .string("owner_swift"),
        ]),
        "snapshot": .object([
            "subscriptionId": .string(subscriptionId),
            "function": .string("listPrivate"),
            "version": .int(1),
            "rows": .array([
                .object(["_id": .string("authorized")]),
            ]),
        ]),
        "resolution": .object([
            "protocolVersion": .int(1),
            "kind": .string("snapshot"),
            "scopeId": scope,
            "revision": .int(1),
            "witness": witness,
            "maxDisposition": .string("quarantine"),
            "ackToken": .string("ack_snapshot_client"),
            "ownerContinuityId": .string("owner_swift"),
        ]),
    ])
}

private final class UpdateCollector: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var values: [[JSONValue]] = []

    func append(_ rows: [JSONValue]) {
        lock.lock()
        values.append(rows)
        lock.unlock()
    }
}

final class ClientBehaviorTests: XCTestCase {
    private func client(maxAttempts: Int) -> SnapbackClient {
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [ReservationStubProtocol.self]
        let session = URLSession(configuration: sessionConfiguration)
        var configuration = SnapbackClient.Configuration(
            baseURL: URL(string: "https://snapback.invalid")!
        )
        configuration.sessionBearer = "sbs_native_test"
        configuration.reservationRetryMaxAttempts = maxAttempts
        configuration.reservationRetryJitterMilliseconds = 0...0
        return SnapbackClient(configuration: configuration, session: session)
    }

    private func responseQueueClient() -> SnapbackClient {
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [ResponseQueueStubProtocol.self]
        var configuration = SnapbackClient.Configuration(
            baseURL: URL(string: "https://snapback.invalid")!
        )
        configuration.sessionBearer = "sbs_native_test"
        return SnapbackClient(
            configuration: configuration,
            session: URLSession(configuration: sessionConfiguration)
        )
    }

    func testSessionsGrantRequiresNegotiatedInvalidationExpectation() async {
        ResponseQueueStubProtocol.configure([
            .init(
                status: 200,
                body:
                    #"{"connectionId":"conn","connectionToken":"token"}"#
            ),
        ])
        do {
            _ = try await responseQueueClient().openConnection()
            XCTFail("sessions grant without invalidation expectation passed")
        } catch let SnapbackClient.ClientError.undecodableResponse(detail) {
            XCTAssertTrue(detail.contains("authorization invalidation"))
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testSessionsSubscribeRejectsForeignIssuerScope() async throws {
        ResponseQueueStubProtocol.configure([
            .init(status: 200, body: custodyGrant),
            .init(
                status: 200,
                body: custodySubscribeOutput(
                    id: "sub_foreign",
                    bootNonce: "BBBBBBBBBBBBBBBBBBBBBB"
                )
            ),
            .init(status: 200, body: #"{"receipt":null}"#),
        ])
        let subject = responseQueueClient()
        _ = try await subject.openConnection()
        do {
            _ = try await subject.subscribe(
                function: "listPrivate",
                authorizationNamespace: custodyNamespace
            )
            XCTFail("foreign issuer scope passed subscribe custody")
        } catch let SnapbackClient.ClientError.undecodableResponse(detail) {
            XCTAssertTrue(detail.contains("subscribe output scope"))
        }
        let subscriptions = await subject.machine.subscriptions
        XCTAssertNil(subscriptions["sub_foreign"])
        XCTAssertEqual(ResponseQueueStubProtocol.requestCount, 3)
    }

    func testMissingSupersessionWitnessKeepsPredecessor() async throws {
        ResponseQueueStubProtocol.configure([
            .init(status: 200, body: custodyGrant),
            .init(
                status: 200,
                body: custodySubscribeOutput(id: "sub_predecessor")
            ),
            .init(
                status: 200,
                body: custodySubscribeOutput(id: "sub_unwitnessed")
            ),
            .init(status: 200, body: #"{"receipt":null}"#),
        ])
        let subject = responseQueueClient()
        _ = try await subject.openConnection()
        _ = try await subject.subscribe(
            function: "listPrivate",
            authorizationNamespace: custodyNamespace
        )
        do {
            _ = try await subject.subscribe(
                function: "listPrivate",
                supersedes: "sub_predecessor",
                authorizationNamespace: custodyNamespace
            )
            XCTFail("unwitnessed supersession passed")
        } catch let SnapbackClient.ClientError.undecodableResponse(detail) {
            XCTAssertTrue(detail.contains("supersession witness"))
        }
        let subscriptions = await subject.machine.subscriptions
        XCTAssertEqual(
            subscriptions["sub_predecessor"]?.state,
            .live(version: 1)
        )
        XCTAssertNil(subscriptions["sub_unwitnessed"])
    }

    func testSupersessionRejectsReusedScopeSequence() async throws {
        ResponseQueueStubProtocol.configure([
            .init(status: 200, body: custodyGrant),
            .init(
                status: 200,
                body: custodySubscribeOutput(id: "sub_scope_1")
            ),
            .init(
                status: 200,
                body: custodySubscribeOutput(
                    id: "sub_scope_2",
                    superseded: "sub_scope_1"
                )
            ),
            .init(status: 200, body: #"{"receipt":null}"#),
        ])
        let subject = responseQueueClient()
        _ = try await subject.openConnection()
        _ = try await subject.subscribe(
            function: "listPrivate",
            authorizationNamespace: custodyNamespace
        )
        do {
            _ = try await subject.subscribe(
                function: "listPrivate",
                supersedes: "sub_scope_1",
                authorizationNamespace: custodyNamespace
            )
            XCTFail("reused scope sequence passed")
        } catch let SnapbackClient.ClientError.undecodableResponse(detail) {
            XCTAssertTrue(detail.contains("scope sequence"))
        }
        let subscriptions = await subject.machine.subscriptions
        XCTAssertEqual(subscriptions["sub_scope_1"]?.state, .dropped)
        XCTAssertTrue(
            subscriptions["sub_scope_1"]?.rows.isEmpty == true,
            "a witnessed server retirement cannot leave the predecessor readable"
        )
        XCTAssertNil(subscriptions["sub_scope_2"])
    }

    func testInitialSubscribeProjectionIsQuarantinedBeforeExposure() async throws {
        ResponseQueueStubProtocol.configure([
            .init(status: 200, body: custodyGrant),
            .init(
                status: 200,
                body: custodySubscribeOutput(
                    id: "sub_pending_projection",
                    includePendingProjection: true
                )
            ),
        ])
        let subject = responseQueueClient()
        let collector = UpdateCollector()
        await subject.onUpdate { _, rows in collector.append(rows) }
        _ = try await subject.openConnection()
        let subscription = try await subject.subscribe(
            function: "listPrivate",
            authorizationNamespace: custodyNamespace
        )
        XCTAssertNil(subscription.snapshot)
        let subscriptions = await subject.machine.subscriptions
        XCTAssertEqual(
            subscriptions["sub_pending_projection"]?.state,
            .resyncPending
        )
        XCTAssertEqual(collector.values, [[]])
    }

    func testPollBlankCallbackPrecedesInvalidationAcknowledgement() async throws {
        let frame = custodyTerminalFrame("sub_poll_client")
        let bytes = Array(try frame.encoded())
        let drain = JSONValue.array([
            .object([
                "Durable": .object([
                    "payload": .array(
                        bytes.map { .int(Int64($0)) }
                    ),
                ]),
            ]),
        ])
        ResponseQueueStubProtocol.configure([
            .init(status: 200, body: custodyGrant),
            .init(
                status: 200,
                body: String(decoding: try drain.encoded(), as: UTF8.self)
            ),
            .init(
                status: 200,
                body: #"{"outcome":"discharged"}"#
            ),
        ])
        let subject = responseQueueClient()
        _ = try await subject.openConnection()
        let grant = await subject.machine.authorizationInvalidationConnection!
        await subject.machine.applySnapshot(
            subscriptionId: "sub_poll_client",
            function: "listPrivate",
            snapshot: QuerySnapshot(
                version: 1,
                rows: [.object(["_id": .string("secret")])],
                cursor: nil
            ),
            authorizationNamespace: custodyNamespace,
            authorizationScope:
                custodyTerminalFrame("sub_poll_client")["obligation"]?[
                    "scopeId"
                ],
            acceptedAuthorization: grant.authorization,
            authorizationVersionStream: grant.versionStream
        )
        await subject.onUpdate { _, rows in
            if rows.isEmpty {
                ResponseQueueStubProtocol.record("blank-update")
            }
        }
        _ = try await subject.drainOnce()
        let events = ResponseQueueStubProtocol.events
        let updateIndex = try XCTUnwrap(
            events.firstIndex(of: "blank-update")
        )
        let ackIndex = try XCTUnwrap(
            events.firstIndex(
                of: "/live/authorization-invalidation/acknowledge"
            )
        )
        XCTAssertLessThan(updateIndex, ackIndex)
    }

    func testAcknowledgementRefusalRequarantinesBeforeSurfacing() async throws {
        let frame = custodySnapshotInvalidationFrame("sub_ack_refused")
        let bytes = Array(try frame.encoded())
        let drain = JSONValue.array([
            .object([
                "Durable": .object([
                    "payload": .array(bytes.map { .int(Int64($0)) }),
                ]),
            ]),
        ])
        ResponseQueueStubProtocol.configure([
            .init(status: 200, body: custodyGrant),
            .init(
                status: 200,
                body: String(decoding: try drain.encoded(), as: UTF8.self)
            ),
            .init(
                status: 409,
                body:
                    """
                    {"diagnostic":{"code":"SNAPBACK_AUTH_INVALIDATION_PENDING","severity":"error","subsystem":"auth","message":"newer obligation pending","details":{}}}
                    """
            ),
            .init(
                status: 200,
                body: String(decoding: try drain.encoded(), as: UTF8.self)
            ),
            .init(status: 200, body: #"{"outcome":"discharged"}"#),
        ])
        let subject = responseQueueClient()
        let collector = UpdateCollector()
        _ = try await subject.openConnection()
        let expectation =
            await subject.machine.authorizationInvalidationConnection!
        await subject.machine.applySnapshot(
            subscriptionId: "sub_ack_refused",
            function: "listPrivate",
            snapshot: QuerySnapshot(
                version: 1,
                rows: [.object(["_id": .string("old")])],
                cursor: nil
            ),
            authorizationNamespace: custodyNamespace,
            authorizationScope: frame["obligation"]?["scopeId"],
            acceptedAuthorization: expectation.authorization,
            authorizationVersionStream: expectation.versionStream
        )
        await subject.onUpdate { _, rows in collector.append(rows) }

        do {
            _ = try await subject.drainOnce()
            XCTFail("acknowledgement refusal did not surface")
        } catch let SnapbackClient.ClientError.refusal(error, status) {
            XCTAssertEqual(status, 409)
            XCTAssertEqual(error.code, "SNAPBACK_AUTH_INVALIDATION_PENDING")
        }
        let entry = await subject.machine.subscriptions["sub_ack_refused"]
        XCTAssertEqual(entry?.state, .resyncPending)
        XCTAssertTrue(entry?.rows.isEmpty == true)
        XCTAssertNotNil(entry?.pendingAuthorizationObligation)
        XCTAssertEqual(collector.values.last, [])

        _ = try await subject.drainOnce()
        let recovered =
            await subject.machine.subscriptions["sub_ack_refused"]
        XCTAssertEqual(recovered?.state, .live(version: 1))
        XCTAssertNotNil(recovered?.rows["authorized"])
        XCTAssertNil(recovered?.pendingAuthorizationObligation)
    }

    func testStaleAcknowledgementOutcomeRequarantines() async throws {
        let frame = custodySnapshotInvalidationFrame("sub_ack_stale")
        let bytes = Array(try frame.encoded())
        let drain = JSONValue.array([
            .object([
                "Durable": .object([
                    "payload": .array(bytes.map { .int(Int64($0)) }),
                ]),
            ]),
        ])
        ResponseQueueStubProtocol.configure([
            .init(status: 200, body: custodyGrant),
            .init(
                status: 200,
                body: String(decoding: try drain.encoded(), as: UTF8.self)
            ),
            .init(status: 200, body: #"{"outcome":"stale"}"#),
        ])
        let subject = responseQueueClient()
        _ = try await subject.openConnection()
        let expectation =
            await subject.machine.authorizationInvalidationConnection!
        await subject.machine.applySnapshot(
            subscriptionId: "sub_ack_stale",
            function: "listPrivate",
            snapshot: QuerySnapshot(version: 1, rows: [], cursor: nil),
            authorizationNamespace: custodyNamespace,
            authorizationScope: frame["obligation"]?["scopeId"],
            acceptedAuthorization: expectation.authorization,
            authorizationVersionStream: expectation.versionStream
        )
        _ = try await subject.drainOnce()
        let entry = await subject.machine.subscriptions["sub_ack_stale"]
        XCTAssertEqual(entry?.state, .resyncPending)
        XCTAssertTrue(entry?.rows.isEmpty == true)
        XCTAssertNotNil(entry?.pendingAuthorizationObligation)
    }

    func testPendingInvalidationCannotEscapeThroughSupersession() async throws {
        ResponseQueueStubProtocol.configure([
            .init(status: 200, body: custodyGrant),
            .init(
                status: 200,
                body: custodySubscribeOutput(
                    id: "sub_pending_old",
                    includePendingProjection: true
                )
            ),
            .init(
                status: 200,
                body: custodySubscribeOutput(
                    id: "sub_pending_new",
                    scopeSequence: 2,
                    superseded: "sub_pending_old"
                )
            ),
            .init(status: 200, body: #"{"receipt":null}"#),
        ])
        let subject = responseQueueClient()
        _ = try await subject.openConnection()
        _ = try await subject.subscribe(
            function: "listPrivate",
            authorizationNamespace: custodyNamespace
        )

        do {
            _ = try await subject.subscribe(
                function: "listPrivate",
                supersedes: "sub_pending_old",
                authorizationNamespace: custodyNamespace
            )
            XCTFail("ordinary successor snapshot escaped pending invalidation")
        } catch let SnapbackClient.ClientError.undecodableResponse(detail) {
            XCTAssertTrue(detail.contains("pending authorization invalidation"))
        }
        let subscriptions = await subject.machine.subscriptions
        XCTAssertEqual(subscriptions["sub_pending_old"]?.state, .dropped)
        XCTAssertTrue(subscriptions["sub_pending_old"]?.rows.isEmpty == true)
        XCTAssertNotNil(
            subscriptions["sub_pending_old"]?
                .pendingAuthorizationObligation
        )
        XCTAssertNil(subscriptions["sub_pending_new"])
    }

    func testTerminalAuthFrameBlanksAndInvalidatesGrant() async throws {
        ResponseQueueStubProtocol.configure([
            .init(status: 200, body: custodyGrant),
        ])
        let subject = responseQueueClient()
        _ = try await subject.openConnection()
        await subject.machine.applySnapshot(
            subscriptionId: "sub_terminal_auth",
            function: "listPrivate",
            snapshot: QuerySnapshot(
                version: 1,
                rows: [.object(["_id": .string("secret")])],
                cursor: nil
            ),
            authorizationNamespace: custodyNamespace
        )
        await subject.processSocketFrame(
            try JSONValue.parse(
                """
                {"kind":"auth_error","code":"SNAPBACK_AUTH_SESSION_EXPIRED","reason":"expired","authorityDisposition":"carrier"}
                """
            )
        )
        let connectionId = await subject.connectionId
        let phase = await subject.machine.phase
        XCTAssertNil(connectionId)
        XCTAssertEqual(phase, .terminalAuth)
        let carrierEntry =
            await subject.machine.subscriptions["sub_terminal_auth"]
        XCTAssertEqual(carrierEntry?.state, .dropped)
        XCTAssertTrue(carrierEntry?.rows.isEmpty == true)

        let durable = ClientStateMachine()
        durable.applySnapshot(
            subscriptionId: "sub_durable_delete",
            function: "listPrivate",
            snapshot: QuerySnapshot(
                version: 1,
                rows: [.object(["_id": .string("secret")])],
                cursor: nil
            ),
            authorizationNamespace: custodyNamespace
        )
        let event = durable.ingestFrame(
            try JSONValue.parse(
                """
                {"kind":"auth_error","code":"SNAPBACK_AUTH_STREAM_RESET","reason":"reset","authorityDisposition":"durableDelete"}
                """
            ),
            postOwnershipCut: true
        )
        XCTAssertTrue(event.actions.contains(.surfaceTerminalAuth))
        XCTAssertEqual(
            durable.subscriptions["sub_durable_delete"]?.state,
            .terminalDeleted
        )
        XCTAssertTrue(
            durable.subscriptions["sub_durable_delete"]?.rows.isEmpty == true
        )
        XCTAssertTrue(durable.hasTerminalRetiredNamespace(custodyNamespace))

        let malformed = ClientStateMachine()
        malformed.applySnapshot(
            subscriptionId: "sub_malformed_terminal",
            function: "listPrivate",
            snapshot: QuerySnapshot(
                version: 1,
                rows: [.object(["_id": .string("secret")])],
                cursor: nil
            )
        )
        let malformedEvent = malformed.ingestFrame(
            try JSONValue.parse(
                """
                {"kind":"auth_error","code":"FUTURE_CODE","reason":"future_reason","authorityDisposition":"futureDisposition"}
                """
            ),
            postOwnershipCut: true
        )
        XCTAssertEqual(
            malformed.subscriptions["sub_malformed_terminal"]?.state,
            .dropped
        )
        XCTAssertTrue(
            malformed.subscriptions["sub_malformed_terminal"]?.rows.isEmpty
                == true
        )
        XCTAssertTrue(
            malformedEvent.diagnostics.contains {
                $0.contains("classified as carrier")
            }
        )
    }

    func testReservationStaleEventuallySucceedsWithinBudget() async throws {
        ReservationStubProtocol.configure([409, 409, 200])
        let result = try await client(maxAttempts: 40).request(
            method: "POST",
            path: "/mutation/write",
            body: .object(["args": .object([:])]),
            connectionScoped: false
        )
        XCTAssertEqual(result["ok"]?.boolValue, true)
        XCTAssertEqual(ReservationStubProtocol.requestCount, 3)
    }

    func testReservationStaleExhaustsConfiguredBudget() async {
        ReservationStubProtocol.configure([409, 409, 409, 200])
        do {
            _ = try await client(maxAttempts: 3).request(
                method: "POST",
                path: "/mutation/write",
                body: .object(["args": .object([:])]),
                connectionScoped: false
            )
            XCTFail("expected the configured retry budget to exhaust")
        } catch let SnapbackClient.ClientError.refusal(error, status) {
            XCTAssertEqual(status, 409)
            XCTAssertEqual(error.code, "SNAPBACK_AUTH_RESERVATION_STALE")
        } catch {
            XCTFail("unexpected error: \(error)")
        }
        XCTAssertEqual(ReservationStubProtocol.requestCount, 3)
    }

    func testReservationStaleCodeAtWrongStatusDoesNotRetry() async {
        ReservationStubProtocol.configure([503, 200])
        do {
            _ = try await client(maxAttempts: 40).request(
                method: "POST",
                path: "/mutation/write",
                body: .object(["args": .object([:])]),
                connectionScoped: false
            )
            XCTFail("expected HTTP 503 to surface")
        } catch {
            XCTAssertEqual(ReservationStubProtocol.requestCount, 1)
        }
    }

    func testSessionsModeOmitsLegacyBodyIdentity() async {
        let sessions = client(maxAttempts: 1)
        let sessionsInput = await sessions.handlerInput(
            args: .object(["value": .int(1)]),
            userId: "must-not-cross-the-wire"
        )
        XCTAssertNil(sessionsInput["auth"])

        var devConfiguration = SnapbackClient.Configuration(
            baseURL: URL(string: "https://snapback.invalid")!
        )
        devConfiguration.reservationRetryJitterMilliseconds = 0...0
        let dev = SnapbackClient(configuration: devConfiguration)
        let devInput = await dev.handlerInput(args: .null, userId: "dev-user")
        XCTAssertEqual(devInput["auth"]?["user_id"]?.stringValue, "dev-user")
    }

    func testFailedForegroundResumeRemainsRetryable() async {
        ReservationStubProtocol.configure([503, 503])
        let subject = client(maxAttempts: 1)
        await subject.pauseForBackground()

        for expectedRequestCount in 1...2 {
            do {
                try await subject.resumeAfterForeground()
                XCTFail("expected foreground resume attempt \(expectedRequestCount) to fail")
            } catch {
                XCTAssertEqual(ReservationStubProtocol.requestCount, expectedRequestCount)
            }
        }
    }

    func testForegroundTokenRefusalDiscardsGrantThenFreshResumeSucceeds() async throws {
        GrantRecoveryStubProtocol.reset()
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [GrantRecoveryStubProtocol.self]
        let session = URLSession(configuration: sessionConfiguration)
        var configuration = SnapbackClient.Configuration(
            baseURL: URL(string: "https://snapback.invalid")!
        )
        configuration.sessionBearer = "sbs_native_test"
        let subject = SnapbackClient(configuration: configuration, session: session)

        _ = try await subject.openConnection()
        _ = try await subject.subscribe(
            function: "listPrivate",
            authorizationNamespace: .object([
                "clientStoreId": .string("swift_recovery_test"),
                "queryKey": .string("listPrivate:null"),
                "queryInstanceId": .int(1),
            ])
        )
        await subject.pauseForBackground()

        do {
            try await subject.resumeAfterForeground()
            XCTFail("expected the reaped connection grant to be refused")
        } catch let SnapbackClient.ClientError.refusal(error, status) {
            XCTAssertEqual(status, 403)
            XCTAssertEqual(error.code, "SNAPBACK_CONNECTION_TOKEN_INVALID")
        }
        let refusedConnectionId = await subject.connectionId
        XCTAssertNil(refusedConnectionId)

        try await subject.resumeAfterForeground()
        let freshConnectionId = await subject.connectionId
        XCTAssertEqual(freshConnectionId, "conn_fresh")
        XCTAssertEqual(GrantRecoveryStubProtocol.seen.map(\.path), [
            "/connection/open",
            "/live/listPrivate/subscribe",
            "/live/listPrivate/unsubscribe",
            "/live/listPrivate/subscribe",
            "/connection/open",
            "/live/listPrivate/subscribe",
        ])
        XCTAssertEqual(
            GrantRecoveryStubProtocol.seen[3].connectionToken,
            "token_old"
        )
        XCTAssertNil(GrantRecoveryStubProtocol.seen[4].connectionToken)
        XCTAssertEqual(
            GrantRecoveryStubProtocol.seen[5].connectionToken,
            "token_fresh"
        )
        let recoveredSubscriptions = await subject.machine.subscriptions
        XCTAssertNil(recoveredSubscriptions["sub_old"])
        XCTAssertEqual(recoveredSubscriptions["sub_fresh"]?.state, .live(version: 2))
    }

    func testTerminalDeletePublishesBlankRows() async {
        let subject = client(maxAttempts: 1)
        let collector = UpdateCollector()
        await subject.onUpdate { _, rows in collector.append(rows) }
        await subject.machine.applySnapshot(
            subscriptionId: "sub_blank",
            function: "listPrivate",
            snapshot: QuerySnapshot(
                version: 4,
                rows: [.object(["_id": .string("secret")])],
                cursor: nil
            )
        )
        let scope: JSONValue = .object([
            "kind": .string("subscription"),
            "issuerId": .object([
                "authorizationIncarnation": .string("0198c7aa-1234-7000-8000-000000000001"),
                "bootSequence": .int(1),
                "bootNonce": .string("AAAAAAAAAAAAAAAAAAAAAA"),
            ]),
            "namespace": .object([
                "clientStoreId": .string("swift_test"),
                "queryKey": .string("listPrivate:{}"),
                "queryInstanceId": .int(1),
            ]),
            "scopeSequence": .int(1),
            "connectionGeneration": .int(1),
            "subscriptionId": .string("sub_blank"),
        ])
        let witness: JSONValue = .object([
            "authorization": .object([
                "incarnation": .string("0198c7aa-1234-7000-8000-000000000001"),
                "epoch": .int(3),
            ]),
            "data": .object([
                "versionStream": .string("swift-stream"),
                "minCommitVersion": .int(4),
            ]),
        ])
        await subject.machine.noteGranted(
            authorizationInvalidation: AuthorizationInvalidationConnection(
                protocolVersion: 1,
                issuerId: scope["issuerId"]!,
                connectionGeneration: 1,
                authorization: AuthorizationVersion(
                    incarnation:
                        "0198c7aa-1234-7000-8000-000000000001",
                    epoch: 3
                ),
                versionStream: "swift-stream"
            )
        )
        await subject.machine.applySnapshot(
            subscriptionId: "sub_blank",
            function: "listPrivate",
            snapshot: QuerySnapshot(
                version: 4,
                rows: [.object(["_id": .string("secret")])],
                cursor: nil
            ),
            authorizationNamespace: scope["namespace"],
            authorizationScope: scope,
            acceptedAuthorization: AuthorizationVersion(
                incarnation:
                    "0198c7aa-1234-7000-8000-000000000001",
                epoch: 1
            ),
            authorizationVersionStream: "swift-stream"
        )
        await subject.processSocketFrame(.object([
            "kind": .string("authorization_invalidation"),
            "obligation": .object([
                "protocolVersion": .int(1),
                "scopeId": scope,
                "revision": .int(2),
                "maxDisposition": .string("delete"),
                "witness": witness,
                "retryEpisodeId": .null,
                "ownerContinuityId": .string("owner_swift"),
            ]),
            "snapshot": .null,
            "resolution": .object([
                "protocolVersion": .int(1),
                "kind": .string("terminalDelete"),
                "scopeId": scope,
                "revision": .int(2),
                "witness": witness,
                "maxDisposition": .string("delete"),
                "ackToken": .string("ack_terminal"),
                "ownerContinuityId": .string("owner_swift"),
            ]),
        ]))

        XCTAssertEqual(collector.values, [[]])
        let subscriptions = await subject.machine.subscriptions
        XCTAssertEqual(subscriptions["sub_blank"]?.state, .terminalDeleted)
    }
}
