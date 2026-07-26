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
        let body: String
        switch index {
        case 0:
            status = 200
            body = #"{"connectionId":"conn_old","connectionToken":"token_old"}"#
        case 1:
            status = 200
            body = #"{"subscription_id":"sub_old","snapshot":{"version":1,"rows":[]},"receipt":null,"resume":null}"#
        case 2:
            status = 200
            body = #"{"receipt":null}"#
        case 3:
            status = 403
            body = #"{"diagnostic":{"code":"SNAPBACK_CONNECTION_TOKEN_INVALID","severity":"error","subsystem":"connection","message":"idle reaper discarded grant","details":{}}}"#
        case 4:
            status = 200
            body = #"{"connectionId":"conn_fresh","connectionToken":"token_fresh"}"#
        default:
            status = 200
            body = #"{"subscription_id":"sub_fresh","snapshot":{"version":2,"rows":[]},"receipt":null,"resume":null}"#
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["content-type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
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
        _ = try await subject.subscribe(function: "listPrivate")
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
