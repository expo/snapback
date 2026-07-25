import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Clean-room Snapback client core + Lane P (poll/local) + Lane L
/// (live/local), per LLP 0093 D2 / LLP 0094 / LLP 0095.
///
/// Conformance tuples exercised by the proving harness: `poll/local` and
/// `live/local`. `live/hosted` is future work; `poll/hosted` is not claimable
/// (LLP 0095 §2.2).
public actor SnapbackClient {
    public struct Configuration: Sendable {
        public var baseURL: URL
        /// Lane P declared cadence (LLP 0095 §1.2 ATTACHED_POLL: a declared,
        /// bounded cadence with backoff). Default matches the reference
        /// implementation's declared 1.5 s.
        public var pollCadence: Duration = .milliseconds(1500)
        /// Backoff bounds for both lanes (LLP 0093 gotcha 7: 250 ms → 10 s).
        public var backoffFloor: Duration = .milliseconds(250)
        public var backoffCeiling: Duration = .seconds(10)
        /// Lane L liveness numbers (LLP 0034 D0/D1 via LLP 0093 gotcha 7).
        public var heartbeatInterval: Duration = .seconds(5)
        public var freshnessBudget: Duration = .seconds(15)
        /// When true, refuse instead of downgrading on legacy-server
        /// detection (LLP 0094 §0B.6 strict configuration).
        public var strictWireVersion = false

        public init(baseURL: URL) {
            self.baseURL = baseURL
        }
    }

    public enum ClientError: Error, CustomStringConvertible {
        case transport(String)
        case refusal(WireErrorResponse, httpStatus: Int)
        case undecodableResponse(String)
        case invalidState(String)

        public var description: String {
            switch self {
            case .transport(let detail): return "transport: \(detail)"
            case .refusal(let error, let status): return "refusal \(status): \(error.code) — \(error.message)"
            case .undecodableResponse(let detail): return "undecodable response: \(detail)"
            case .invalidState(let detail): return "invalid state: \(detail)"
            }
        }
    }

    public struct Subscription: Sendable {
        public var subscriptionId: String
        public var function: String
        public var snapshot: QuerySnapshot?
        public var receipt: JSONValue?
    }

    static let wireVersionToken = "snapback.v1"
    static let connectionTokenHeader = "x-snapback-connection-token"

    private let configuration: Configuration
    private let session: URLSession
    public let machine = ClientStateMachine()

    private var grant: ConnectionGrant?
    /// LLP 0094 §0B.6: the legacy-server verdict is cached per endpoint for
    /// the process lifetime.
    private var legacyServerVerdict: Bool?
    public private(set) var diagnostics: [String] = []

    private var drainTask: Task<Void, Never>?
    private var socketTask: URLSessionWebSocketTask?
    private var socketReadTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var lastPongAt: ContinuousClock.Instant?
    private var updateHandlers: [@Sendable (String, [JSONValue]) -> Void] = []

    public init(configuration: Configuration) {
        self.configuration = configuration
        self.session = URLSession(configuration: .ephemeral)
    }

    public func onUpdate(_ handler: @escaping @Sendable (String, [JSONValue]) -> Void) {
        updateHandlers.append(handler)
    }

    public var connectionId: String? { grant?.connectionId }

    // MARK: - T-OPEN: POST /connection/open

    /// Opens (or re-opens) the connection grant. Offers
    /// `wireVersion: "snapback.v1"` per LLP 0094 §0B.3; a decode-class
    /// rejection that disappears when the offer member is removed is
    /// legacy-server detection (§0B.6): re-open offerless exactly once per
    /// endpoint, cache the verdict, surface a structured diagnostic.
    @discardableResult
    public func openConnection(previousToken: String? = nil) async throws -> ConnectionGrant {
        var body: [String: JSONValue] = [:]
        if let previousToken { body["previousToken"] = .string(previousToken) }
        if legacyServerVerdict != true {
            body["wireVersion"] = .string(Self.wireVersionToken)
        }
        do {
            let grant = try await postForGrant(body)
            self.grant = grant
            machine.noteGranted()
            return grant
        } catch let ClientError.refusal(error, status) {
            let decodeClass = status == 400 || status == 422
            let unsupported = error.code == "SNAPBACK_WIRE_VERSION_UNSUPPORTED"
            guard decodeClass, !unsupported, legacyServerVerdict == nil, body["wireVersion"] != nil else {
                throw ClientError.refusal(error, httpStatus: status)
            }
            if configuration.strictWireVersion {
                throw ClientError.refusal(error, httpStatus: status)
            }
            // Legacy-server detection: retry offerless exactly once.
            body.removeValue(forKey: "wireVersion")
            let grant = try await postForGrant(body)
            legacyServerVerdict = true
            diagnostics.append("SNAPBACK_CLIENT_WIRE_VERSION_DOWNGRADE: pre-B1 server rejected the wireVersion offer (\(error.code)); reopened as a legacy (implicitly v1-bound) connection")
            self.grant = grant
            machine.noteGranted()
            return grant
        }
    }

    private func postForGrant(_ body: [String: JSONValue]) async throws -> ConnectionGrant {
        let json = try await request(method: "POST", path: "/connection/open", body: .object(body), connectionScoped: false)
        guard let grant = ConnectionGrant.from(json) else {
            throw ClientError.undecodableResponse("connection grant")
        }
        return grant
    }

    // MARK: - T-SUB / T-UNSUB

    /// `POST /live/{function}/subscribe` — snapshot-with-subscribe.
    /// Subscribe is a demand signal with billing-visible side effects
    /// (LLP 0095 T-SUB); callers own explicit release (T-UNSUB).
    public func subscribe(
        function: String,
        args: JSONValue = .null,
        userId: String? = nil,
        supersedes: String? = nil
    ) async throws -> Subscription {
        guard let grant else { throw ClientError.invalidState("subscribe before openConnection") }
        var input: [String: JSONValue] = [:]
        if args != .null { input["args"] = args }
        if let userId { input["auth"] = .object(["user_id": .string(userId)]) }
        var body: [String: JSONValue] = [
            "connection_id": .string(grant.connectionId),
            "input": .object(input),
        ]
        if let supersedes { body["supersedes"] = .string(supersedes) }
        let json = try await request(method: "POST", path: "/live/\(function)/subscribe", body: .object(body), connectionScoped: true)
        guard let output = LiveSubscribeOutput.from(json) else {
            throw ClientError.undecodableResponse("live subscribe output")
        }
        if let supersedes { machine.removeSubscription(id: supersedes) }
        if let snapshot = output.snapshot {
            machine.applySnapshot(subscriptionId: output.subscriptionId, function: function, snapshot: snapshot, authUserId: userId)
            emitUpdate(output.subscriptionId)
        } else {
            machine.registerPending(subscriptionId: output.subscriptionId, function: function)
        }
        return Subscription(subscriptionId: output.subscriptionId, function: function, snapshot: output.snapshot, receipt: output.receipt)
    }

    /// `POST /live/{function}/unsubscribe` — the only *normal* demand
    /// release path (LLP 0095 T-UNSUB; reaping is the crash backstop).
    @discardableResult
    public func unsubscribe(function: String, subscriptionId: String, userId: String? = nil) async throws -> JSONValue? {
        guard let grant else { throw ClientError.invalidState("unsubscribe before openConnection") }
        var members: [String: JSONValue] = [
            "connection_id": .string(grant.connectionId),
            "subscription_id": .string(subscriptionId),
        ]
        // The release must present the establishing auth identity: the
        // server refuses a mismatched "live owner"
        // (SNAPBACK_LIVE_RESUME_OWNERSHIP — observed behavior; spec-defect
        // ticket 20260725-0093-p2-spec-defect-unsubscribe-auth-identity).
        if let owner = userId ?? machine.subscriptions[subscriptionId]?.authUserId {
            members["auth"] = .object(["user_id": .string(owner)])
        }
        let body: JSONValue = .object(members)
        let json = try await request(method: "POST", path: "/live/\(function)/unsubscribe", body: body, connectionScoped: true)
        machine.noteReleased(subscriptionId: subscriptionId)
        let receipt = json["receipt"]
        return receipt == .null ? nil : receipt
    }

    // MARK: - one-shot query / mutation / action

    public func query(_ name: String, args: JSONValue = .null, userId: String? = nil) async throws -> QuerySnapshot {
        let json = try await request(method: "POST", path: "/query/\(name)", body: handlerInput(args: args, userId: userId), connectionScoped: false)
        guard let snapshot = QuerySnapshot.from(json) else {
            throw ClientError.undecodableResponse("query output")
        }
        return snapshot
    }

    public func mutate(_ name: String, args: JSONValue = .null, userId: String? = nil) async throws -> MutationResponse {
        let json = try await request(method: "POST", path: "/mutation/\(name)", body: handlerInput(args: args, userId: userId), connectionScoped: false)
        guard let response = MutationResponse.from(json) else {
            throw ClientError.undecodableResponse("mutation output")
        }
        return response
    }

    public func action(_ name: String, args: JSONValue = .null, userId: String? = nil) async throws -> JSONValue {
        try await request(method: "POST", path: "/action/\(name)", body: handlerInput(args: args, userId: userId), connectionScoped: false)
    }

    private func handlerInput(args: JSONValue, userId: String?) -> JSONValue {
        var input: [String: JSONValue] = [:]
        if args != .null { input["args"] = args }
        if let userId { input["auth"] = .object(["user_id": .string(userId)]) }
        return .object(input)
    }

    // MARK: - Lane P: the outbox drain

    /// One drain poll: `GET /outbox/{connection_id}`. The response body is a
    /// JSON array of `RealtimeEnvelope`; by the time the body is readable the
    /// LLP 0059 ownership cut has been accepted, so batch handling follows
    /// T-DRAIN/T-DB-P.
    @discardableResult
    public func drainOnce() async throws -> MachineEvent {
        guard let grant else { throw ClientError.invalidState("drain before openConnection") }
        let json = try await request(method: "GET", path: "/outbox/\(grant.connectionId)", body: nil, connectionScoped: true)
        guard let items = json.arrayValue else {
            throw ClientError.undecodableResponse("outbox drain batch (expected JSON array)")
        }
        let event = machine.ingestDrainBatch(items)
        diagnostics.append(contentsOf: event.diagnostics)
        for subscriptionId in changedSubscriptions(event) { emitUpdate(subscriptionId) }
        try await performResubscribes(event)
        return event
    }

    /// ATTACHED_POLL: exactly one drain owner per connection, non-overlapping
    /// drains at the declared cadence with backoff (LLP 0095 §1.2).
    public func startDrainLoop() {
        guard drainTask == nil else { return }
        machine.noteAttached(poll: true)
        drainTask = Task { [weak self] in
            guard let self else { return }
            var backoff: Duration? = nil
            while !Task.isCancelled {
                do {
                    _ = try await self.drainOnce()
                    backoff = nil
                    try? await Task.sleep(for: self.configuration.pollCadence)
                } catch {
                    let next = await self.nextBackoff(after: backoff)
                    backoff = next
                    await self.record("drain failed (\(error)); backing off \(next)")
                    try? await Task.sleep(for: next)
                }
            }
        }
    }

    public func stopDrainLoop() {
        drainTask?.cancel()
        drainTask = nil
    }

    // MARK: - Lane L: the live socket

    /// Opens `GET /live/{connection_id}/stream` offering the mandatory
    /// `snapback.v1` wire-version subprotocol (LLP 0094 §0B.4) and the
    /// bearer subprotocol (LLP 0093 D2 core grant carriage; the header
    /// carrier is also set since URLSession permits it).
    public func openLiveStream() async throws {
        guard let grant else { throw ClientError.invalidState("stream before openConnection") }
        guard socketTask == nil else { return }
        var request = URLRequest(url: configuration.baseURL.appending(path: "/live/\(grant.connectionId)/stream"))
        request.setValue(grant.connectionToken, forHTTPHeaderField: Self.connectionTokenHeader)
        // A conformant client MUST offer `snapback.v1` in the upgrade's
        // subprotocol list (LLP 0094 §0B.4); the bearer subprotocol is the
        // browser-class carrier and is offered alongside the header here.
        request.setValue(
            "\(Self.wireVersionToken), snapback.connection-token.\(grant.connectionToken)",
            forHTTPHeaderField: "Sec-WebSocket-Protocol"
        )
        let task = session.webSocketTask(with: request)
        socketTask = task
        task.resume()
        machine.noteAttached(poll: false)
        lastPongAt = ContinuousClock.now
        socketReadTask = Task { [weak self] in
            await self?.socketReadLoop(task)
        }
        heartbeatTask = Task { [weak self] in
            await self?.heartbeatLoop(task)
        }
    }

    public func closeLiveStream() {
        socketReadTask?.cancel()
        heartbeatTask?.cancel()
        socketTask?.cancel(with: .normalClosure, reason: nil)
        socketTask = nil
        socketReadTask = nil
        heartbeatTask = nil
    }

    private func socketReadLoop(_ task: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                let text: String
                switch message {
                case .string(let value): text = value
                case .data(let value): text = String(decoding: value, as: UTF8.self)
                @unknown default: continue
                }
                guard let json = try? JSONValue.parse(text) else {
                    record("undecodable socket frame; ignoring (pre-cut socket text)")
                    continue
                }
                let event = machine.ingestFrame(json, postOwnershipCut: true)
                if case .socket(let decoded) = ServerFrame.decode(json), case .pong = decoded.value {
                    lastPongAt = ContinuousClock.now
                }
                diagnostics.append(contentsOf: event.diagnostics)
                for subscriptionId in changedSubscriptions(event) { emitUpdate(subscriptionId) }
                if event.actions.contains(.resubscribeAll) {
                    // T-DB permitted equivalent: socket bounce + fresh
                    // subscribes (performed by the resubscribe pass below).
                }
                try? await performResubscribes(event)
            } catch {
                if Task.isCancelled { return }
                record("socket lost (\(error)); entering RECOVERING")
                await handleSocketLoss()
                return
            }
        }
    }

    /// T-HB: 5 s application-level ping, 15 s freshness budget; a missed
    /// budget while the socket claims open forces the loss path.
    private func heartbeatLoop(_ task: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            try? await Task.sleep(for: configuration.heartbeatInterval)
            if Task.isCancelled { return }
            let ping = "{\"type\":\"ping\"}"
            try? await task.send(.string(ping))
            if let lastPongAt, ContinuousClock.now - lastPongAt > configuration.freshnessBudget {
                record("freshness budget missed; forcing socket loss path")
                task.cancel(with: .goingAway, reason: nil)
                await handleSocketLoss()
                return
            }
        }
    }

    /// T-LOSS → T-RECONNECT: socket loss drops the connection's durable
    /// subscriptions server-side; reconnect is fresh subscribe with
    /// `supersedes`, never implicit resumption.
    private func handleSocketLoss() async {
        closeLiveStream()
        let dropped = machine.noteSocketLost()
        var backoff: Duration? = nil
        while !Task.isCancelled {
            do {
                try await openLiveStream()
                for subscriptionId in dropped {
                    guard let entry = machine.subscriptions[subscriptionId] else { continue }
                    _ = try await subscribe(function: entry.function, userId: entry.authUserId, supersedes: subscriptionId)
                }
                return
            } catch {
                let next = nextBackoff(after: backoff)
                backoff = next
                record("reconnect failed (\(error)); backing off \(next)")
                try? await Task.sleep(for: next)
            }
        }
    }

    // MARK: - shared plumbing

    private func performResubscribes(_ event: MachineEvent) async throws {
        for subscriptionId in event.resubscribe {
            guard let entry = machine.subscriptions[subscriptionId], entry.state == .resyncPending else { continue }
            _ = try await subscribe(function: entry.function, userId: entry.authUserId, supersedes: subscriptionId)
        }
    }

    private func changedSubscriptions(_ event: MachineEvent) -> [String] {
        guard event.actions.contains(.replaceRows) || event.actions.contains(.applyDeltaById) else { return [] }
        return machine.subscriptions.compactMap { id, entry in
            if case .live = entry.state { return id }
            return nil
        }
    }

    private func emitUpdate(_ subscriptionId: String) {
        guard let entry = machine.subscriptions[subscriptionId] else { return }
        let rows = entry.orderedRows
        for handler in updateHandlers { handler(subscriptionId, rows) }
    }

    private func nextBackoff(after previous: Duration?) -> Duration {
        guard let previous else { return configuration.backoffFloor }
        return min(previous * 2, configuration.backoffCeiling)
    }

    private func record(_ line: String) {
        diagnostics.append(line)
    }

    func request(method: String, path: String, body: JSONValue?, connectionScoped: Bool) async throws -> JSONValue {
        var urlRequest = URLRequest(url: configuration.baseURL.appending(path: path))
        urlRequest.httpMethod = method
        if let body {
            urlRequest.httpBody = try body.encoded()
            urlRequest.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        if connectionScoped, let grant {
            // Conformant grant carriage on connection-authenticated HTTP is
            // the header (LLP 0093 D2; the query fallback is dev-only and a
            // conformant client never sends it — LLP 0095 §4.1).
            urlRequest.setValue(grant.connectionToken, forHTTPHeaderField: Self.connectionTokenHeader)
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch {
            throw ClientError.transport("\(method) \(path): \(error)")
        }
        guard let http = response as? HTTPURLResponse else {
            throw ClientError.transport("\(method) \(path): non-HTTP response")
        }
        let json = (try? JSONValue.parse(data)) ?? .null
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 || http.statusCode == 403,
               let error = WireErrorResponse.from(json),
               error.code == "SNAPBACK_CONNECTION_TOKEN_INVALID" {
                // T-GRANT-LOSS: recovery is re-open + re-establish everything
                // (LLP 0095 §4.4); this client surfaces it to the caller.
                machine.noteGrantLost()
            }
            if let error = WireErrorResponse.from(json) {
                throw ClientError.refusal(error, httpStatus: http.statusCode)
            }
            throw ClientError.transport("\(method) \(path): HTTP \(http.statusCode) with undecodable error body: \(String(decoding: data.prefix(300), as: UTF8.self))")
        }
        return json
    }
}
