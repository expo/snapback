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
}
