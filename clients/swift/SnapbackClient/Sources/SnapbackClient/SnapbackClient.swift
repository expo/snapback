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
        // @ref LLP 0096#51-external-session-bearer-adoption-non-sender-bound — exact auth offers make an externally brokered bearer a supported protocol-client custody mode.
        /// A session bearer obtained from Snapback's email-code provider or a
        /// trusted external identity broker. Native custody is ordinary bearer
        /// custody; it does not claim LLP 0077 browser sender-constraint.
        public var sessionBearer: String? = nil
        /// Exact `SNAPBACK_AUTH_RESERVATION_STALE` (HTTP 409) retry budget.
        /// Contended native writes observed during Partitime required more
        /// than eight attempts; forty short-jitter attempts converged 40/40.
        public var reservationRetryMaxAttempts = 40
        public var reservationRetryJitterMilliseconds: ClosedRange<UInt64> = 20...80
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
        public var authorizationNamespace: JSONValue?
    }

    public struct EphemeralRepublisherToken: Sendable {
        fileprivate let id: UUID
        fileprivate let collection: String
    }

    public typealias EphemeralRepublisher = @Sendable () async throws -> JSONValue?
    public typealias EphemeralPublisher = @Sendable (JSONValue) async throws -> Void

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
    private let clientStoreId = "swift_" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
    private var nextQueryInstanceId: UInt64 = 1
    private var isPausedForBackground = false
    private var resumeSubscriptionIds: [String] = []
    private var resumeLiveAfterForeground = false
    private var resumePollAfterForeground = false
    private var ephemeralRepublishers: [String: [UUID: EphemeralRepublisher]] = [:]
    private var ephemeralRepublisherGeneration: UInt64 = 0

    public init(configuration: Configuration, session: URLSession? = nil) {
        self.configuration = configuration
        self.session = session ?? URLSession(configuration: .ephemeral)
    }

    public func onUpdate(_ handler: @escaping @Sendable (String, [JSONValue]) -> Void) {
        updateHandlers.append(handler)
    }

    /// Register application-owned presence production for a successor
    /// ephemeral authority. The callback receives no authority or credential
    /// facts and is invoked only after a fresh empty successor snapshot.
    ///
    /// @ref LLP 0105#complete-carriers-and-remaining-exact-assignments —
    /// Swift shares the bounded, generation-fenced, acknowledgement-owned
    /// republisher lifecycle with the first-party JavaScript arms.
    public func registerEphemeralRepublisher(
        collection: String,
        callback: @escaping EphemeralRepublisher
    ) throws -> EphemeralRepublisherToken {
        guard !collection.isEmpty else {
            throw ClientError.invalidState("ephemeral republisher collection is empty")
        }
        var registrations = ephemeralRepublishers[collection] ?? [:]
        guard registrations.count < 64 else {
            throw ClientError.invalidState("SNAPBACK_EPHEMERAL_REPUBLISHER_LIMIT")
        }
        let id = UUID()
        registrations[id] = callback
        ephemeralRepublishers[collection] = registrations
        return EphemeralRepublisherToken(id: id, collection: collection)
    }

    public func unregisterEphemeralRepublisher(_ token: EphemeralRepublisherToken) {
        ephemeralRepublishers[token.collection]?[token.id] = nil
        if ephemeralRepublishers[token.collection]?.isEmpty == true {
            ephemeralRepublishers[token.collection] = nil
        }
    }

    /// Transport integration calls this after it has cleared the predecessor
    /// overlay and established an empty snapshot under a changed authority.
    public func republishEphemeralAfterAuthorityChange(
        collection: String,
        freshSnapshotIsEmpty: Bool,
        publish: @escaping EphemeralPublisher
    ) async throws {
        guard freshSnapshotIsEmpty else { return }
        ephemeralRepublisherGeneration &+= 1
        let generation = ephemeralRepublisherGeneration
        let callbacks = Array((ephemeralRepublishers[collection] ?? [:]).values)
        for callback in callbacks {
            guard generation == ephemeralRepublisherGeneration else {
                throw ClientError.invalidState("SNAPBACK_EPHEMERAL_REPUBLISHER_STALE")
            }
            if let value = try await callback() {
                guard generation == ephemeralRepublisherGeneration else {
                    throw ClientError.invalidState("SNAPBACK_EPHEMERAL_REPUBLISHER_STALE")
                }
                // A successful return is the acknowledgement boundary; the
                // transport publisher must throw for any negative/missing ack.
                try await publish(value)
            }
        }
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
        if configuration.sessionBearer != nil {
            body["authInvalidationProtocol"] = .int(1)
        }
        if legacyServerVerdict != true {
            body["wireVersion"] = .string(Self.wireVersionToken)
        }
        do {
            let grant = try await postForGrant(body)
            self.grant = grant
            machine.noteGranted(
                authorizationInvalidation: grant.authorizationInvalidation
            )
            return grant
        } catch let ClientError.refusal(error, status) {
            let decodeClass =
                status == 400
                && error.code == "SNAPBACK_REQUEST_JSON_INVALID"
            guard decodeClass, legacyServerVerdict == nil, body["wireVersion"] != nil else {
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
            machine.noteGranted(
                authorizationInvalidation: grant.authorizationInvalidation
            )
            return grant
        }
    }

    private func postForGrant(_ body: [String: JSONValue]) async throws -> ConnectionGrant {
        let json = try await request(method: "POST", path: "/connection/open", body: .object(body), connectionScoped: false)
        guard let grant = ConnectionGrant.from(json) else {
            throw ClientError.undecodableResponse("connection grant")
        }
        if configuration.sessionBearer != nil,
           grant.authorizationInvalidation == nil {
            throw ClientError.undecodableResponse(
                "sessions connection grant omitted the negotiated authorization invalidation expectation"
            )
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
        supersedes: String? = nil,
        authorizationNamespace: JSONValue? = nil
    ) async throws -> Subscription {
        guard let grant else { throw ClientError.invalidState("subscribe before openConnection") }
        var input: [String: JSONValue] = [:]
        if args != .null { input["args"] = args }
        if configuration.sessionBearer == nil, let userId {
            input["auth"] = .object(["user_id": .string(userId)])
        }
        var body: [String: JSONValue] = [
            "connection_id": .string(grant.connectionId),
            "input": .object(input),
        ]
        let namespace = try resolvedAuthorizationNamespace(
            function: function,
            args: args,
            supplied: authorizationNamespace
        )
        if let namespace,
           machine.hasTerminalRetiredNamespace(namespace) {
            throw ClientError.invalidState(
                "terminally retired authorization namespace cannot be reused; allocate a new queryInstanceId"
            )
        }
        if let namespace { body["authorizationNamespace"] = namespace }
        if let supersedes { body["supersedes"] = .string(supersedes) }
        let json = try await request(method: "POST", path: "/live/\(function)/subscribe", body: .object(body), connectionScoped: true)
        guard let output = LiveSubscribeOutput.from(json) else {
            throw ClientError.undecodableResponse("live subscribe output")
        }
        // @ref LLP 0059#typed-terminal-auth-error — durable authority deletion is a terminal publication fence, including across actor reentrancy.
        // The request above is an actor reentrancy point. A durable terminal
        // invalidation may retire the namespace while the subscribe is in
        // flight, so validate custody again before admitting its response.
        if let namespace,
           machine.hasTerminalRetiredNamespace(namespace) {
            _ = try? await unsubscribe(
                function: function,
                subscriptionId: output.subscriptionId,
                userId: userId
            )
            machine.removeSubscription(id: output.subscriptionId)
            throw ClientError.invalidState(
                "terminally retired authorization namespace cannot be reused; allocate a new queryInstanceId"
            )
        }
        if machine.subscriptions[output.subscriptionId]?.state
            == .terminalDeleted {
            _ = try? await unsubscribe(
                function: function,
                subscriptionId: output.subscriptionId,
                userId: userId
            )
            throw ClientError.undecodableResponse(
                "subscribe response attempted to reuse a terminal-deleted subscription id"
            )
        }
        var predecessorDisposalWitnessed = false
        if let supersedes {
            let retired = output.superseded == supersedes
                && output.supersessionRefusal == nil
            let alreadyAbsent = output.superseded == nil
                && output.supersessionRefusal
                    == "SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN"
            guard retired || alreadyAbsent else {
                _ = try? await unsubscribe(
                    function: function,
                    subscriptionId: output.subscriptionId,
                    userId: userId
                )
                throw ClientError.undecodableResponse(
                    "live subscribe supersession witness for \(supersedes)"
                )
            }
            predecessorDisposalWitnessed = true
        }
        if configuration.sessionBearer != nil {
            guard let expectation = grant.authorizationInvalidation,
                  let scope = output.authorizationScope,
                  scope["kind"]?.stringValue == "subscription",
                  scope["subscriptionId"]?.stringValue
                    == output.subscriptionId,
                  scope["namespace"] == namespace,
                  scope["issuerId"] == expectation.issuerId,
                  scope["connectionGeneration"]?.uint64Value
                    == expectation.connectionGeneration
            else {
                throw await rejectedSubscribeOutput(
                    function: function,
                    successorSubscriptionId: output.subscriptionId,
                    userId: userId,
                    predecessorSubscriptionId: supersedes,
                    predecessorDisposalWitnessed:
                        predecessorDisposalWitnessed,
                    detail: "auth/live subscribe output scope"
                )
            }
            if let supersedes,
               let previousScope =
                machine.subscriptions[supersedes]?.authorizationScope,
               previousScope["issuerId"] == scope["issuerId"],
               previousScope["connectionGeneration"]
                == scope["connectionGeneration"],
               previousScope["namespace"] == scope["namespace"],
               let previousSequence =
                previousScope["scopeSequence"]?.uint64Value,
               let nextSequence = scope["scopeSequence"]?.uint64Value,
               nextSequence <= previousSequence {
                throw await rejectedSubscribeOutput(
                    function: function,
                    successorSubscriptionId: output.subscriptionId,
                    userId: userId,
                    predecessorSubscriptionId: supersedes,
                    predecessorDisposalWitnessed:
                        predecessorDisposalWitnessed,
                    detail:
                        "auth/live supersession did not advance the scope sequence"
                )
            }
        }
        if let supersedes,
           let inheritanceProblem =
            machine.successorInvalidationInheritanceProblem(
                predecessorSubscriptionId: supersedes,
                successor: output.authorizationInvalidation?.obligation
            ) {
            throw await rejectedSubscribeOutput(
                function: function,
                successorSubscriptionId: output.subscriptionId,
                userId: userId,
                predecessorSubscriptionId: supersedes,
                predecessorDisposalWitnessed:
                    predecessorDisposalWitnessed,
                detail: inheritanceProblem
            )
        }
        let acceptedAuthorization =
            grant.authorizationInvalidation?.authorization
        let versionStream =
            grant.authorizationInvalidation?.versionStream
        let installed: Bool
        if let snapshot = output.snapshot {
            installed = machine.applySnapshot(
                subscriptionId: output.subscriptionId,
                function: function,
                snapshot: snapshot,
                authUserId: userId,
                args: args,
                authorizationNamespace: namespace,
                authorizationScope: output.authorizationScope,
                acceptedAuthorization: acceptedAuthorization,
                authorizationVersionStream: versionStream
            )
        } else {
            installed = machine.registerPending(
                subscriptionId: output.subscriptionId,
                function: function,
                args: args,
                authorizationNamespace: namespace,
                authorizationScope: output.authorizationScope,
                acceptedAuthorization: acceptedAuthorization,
                authorizationVersionStream: versionStream
            )
        }
        guard installed else {
            throw await rejectedSubscribeOutput(
                function: function,
                successorSubscriptionId: output.subscriptionId,
                userId: userId,
                predecessorSubscriptionId: supersedes,
                predecessorDisposalWitnessed:
                    predecessorDisposalWitnessed,
                detail:
                    "subscribe response crossed terminal retirement"
            )
        }
        if let projection = output.authorizationInvalidation {
            let invalidationSnapshot: AuthorizationInvalidationSnapshot?
            if projection.resolution?.kind == .snapshot,
               let snapshot = output.snapshot {
                invalidationSnapshot = AuthorizationInvalidationSnapshot(
                    subscriptionId: output.subscriptionId,
                    function: function,
                    version: snapshot.version,
                    rows: snapshot.rows
                )
            } else {
                invalidationSnapshot = nil
            }
            let event = machine.ingestDurable(
                Decoded(
                    value: .authorizationInvalidation(
                        obligation: projection.obligation,
                        snapshot: invalidationSnapshot,
                        resolution: projection.resolution
                    ),
                    hadUnknownFields: false
                )
            )
            diagnostics.append(contentsOf: event.diagnostics)
            if event.actions.contains(.surfaceProtocolDiagnostic)
                || event.actions.contains(.ignoreFrame) {
                throw await rejectedSubscribeOutput(
                    function: function,
                    successorSubscriptionId: output.subscriptionId,
                    userId: userId,
                    predecessorSubscriptionId: supersedes,
                    predecessorDisposalWitnessed:
                        predecessorDisposalWitnessed,
                    detail: "auth/live subscribe invalidation projection"
                )
            }
            for subscriptionId in changedSubscriptions(event) {
                emitUpdate(subscriptionId)
            }
            do {
                try await performAcknowledgements(event)
            } catch {
                // The subscribe itself and its local apply/delete commit
                // succeeded. Keep the exact scope and its reinstalled pending
                // obligation so level-triggered redelivery can recover; tearing
                // it down here would forget the quarantine or terminal fence.
                diagnostics.append(
                    "auth/live subscribe invalidation acknowledgement remains pending: \(error)"
                )
            }
        } else if output.snapshot != nil {
            emitUpdate(output.subscriptionId)
        }
        if let supersedes, supersedes != output.subscriptionId {
            machine.removeSubscription(id: supersedes)
        }
        let exposedSnapshot: QuerySnapshot?
        if let entry = machine.subscriptions[output.subscriptionId],
           case .live(let version) = entry.state {
            exposedSnapshot = QuerySnapshot(
                version: version,
                rows: entry.orderedRows,
                cursor: output.snapshot?.cursor
            )
        } else {
            exposedSnapshot = nil
        }
        return Subscription(
            subscriptionId: output.subscriptionId,
            function: function,
            snapshot: exposedSnapshot,
            receipt: output.receipt,
            authorizationNamespace: namespace
        )
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
        if configuration.sessionBearer == nil,
           let owner = userId ?? machine.subscriptions[subscriptionId]?.authUserId {
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

    func handlerInput(args: JSONValue, userId: String?) -> JSONValue {
        var input: [String: JSONValue] = [:]
        if args != .null { input["args"] = args }
        if configuration.sessionBearer == nil, let userId {
            input["auth"] = .object(["user_id": .string(userId)])
        }
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
        try await performAcknowledgements(event)
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
            liveStreamProtocols(grant),
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
                await processSocketFrame(json)
            } catch {
                if Task.isCancelled { return }
                if task.closeCode.rawValue == 4401 {
                    let event = machine.noteTerminalAuth(
                        code: "SNAPBACK_AUTH_SESSION_EXPIRED",
                        reason: "expired",
                        disposition: "carrier"
                    )
                    diagnostics.append(
                        "close-only 4401 terminal signal classified as carrier"
                    )
                    applyDiagnosticEvent(event)
                    grant = nil
                    stopDrainLoop()
                    closeLiveStream()
                    return
                }
                record("socket lost (\(error)); entering RECOVERING")
                await handleSocketLoss()
                return
            }
        }
    }

    /// One socket delivery after UTF-8/JSON decode. Internal so the callback
    /// boundary can be regression-tested without manufacturing a WebSocket;
    /// shipping socket delivery uses this exact path.
    func processSocketFrame(_ json: JSONValue) async {
        let event = machine.ingestFrame(json, postOwnershipCut: true)
        if case .socket(let decoded) = ServerFrame.decode(json),
           case .pong = decoded.value {
            lastPongAt = ContinuousClock.now
        }
        diagnostics.append(contentsOf: event.diagnostics)
        // Publication changes, including terminal blanking, are observable
        // before the post-commit invalidation ACK.
        for subscriptionId in changedSubscriptions(event) {
            emitUpdate(subscriptionId)
        }
        if event.actions.contains(.surfaceTerminalAuth) {
            grant = nil
            stopDrainLoop()
            closeLiveStream()
            return
        }
        try? await performAcknowledgements(event)
        if event.actions.contains(.resubscribeAll) {
            // T-DB permitted equivalent: socket bounce + fresh subscribes
            // (performed by the resubscribe pass below).
        }
        try? await performResubscribes(event)
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
        guard machine.phase != .terminalAuth else { return }
        if isPausedForBackground { return }
        let dropped = machine.noteSocketLost()
        var backoff: Duration? = nil
        while !Task.isCancelled {
            do {
                try await openLiveStream()
                for subscriptionId in dropped {
                    guard let entry = machine.subscriptions[subscriptionId] else { continue }
                    _ = try await subscribe(
                        function: entry.function,
                        args: entry.args,
                        userId: entry.authUserId,
                        supersedes: subscriptionId,
                        authorizationNamespace: entry.authorizationNamespace
                    )
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
            _ = try await subscribe(
                function: entry.function,
                args: entry.args,
                userId: entry.authUserId,
                supersedes: subscriptionId,
                authorizationNamespace: entry.authorizationNamespace
            )
        }
    }

    /// Acknowledge only invalidation resolutions whose snapshots the state
    /// machine already applied. The server obligation remains level-triggered
    /// until this post-apply boundary succeeds.
    private func performAcknowledgements(_ event: MachineEvent) async throws {
        for ackToken in event.acknowledgements {
            _ = try await acknowledgeAuthorizationInvalidation(
                ackToken: ackToken
            )
        }
    }

    @discardableResult
    public func acknowledgeAuthorizationInvalidation(ackToken: String) async throws -> String {
        guard let grant else {
            let error = ClientError.invalidState(
                "authorization acknowledgement before openConnection"
            )
            applyDiagnosticEvent(
                machine.noteAuthorizationAcknowledgementUndischarged(
                    ackToken: ackToken,
                    diagnostic:
                        "authorization acknowledgement failed: \(error)"
                )
            )
            throw error
        }
        let json: JSONValue
        do {
            json = try await request(
                method: "POST",
                path: "/live/authorization-invalidation/acknowledge",
                body: .object([
                    "connectionId": .string(grant.connectionId),
                    "ackToken": .string(ackToken),
                ]),
                connectionScoped: true
            )
        } catch {
            applyDiagnosticEvent(
                machine.noteAuthorizationAcknowledgementUndischarged(
                    ackToken: ackToken,
                    diagnostic:
                        "authorization acknowledgement failed: \(error)"
                )
            )
            throw error
        }
        guard let outcome = AuthorizationInvalidationAckOutcome.from(json)
        else {
            let error = ClientError.undecodableResponse(
                "authorization acknowledgement output"
            )
            applyDiagnosticEvent(
                machine.noteAuthorizationAcknowledgementUndischarged(
                    ackToken: ackToken,
                    diagnostic:
                        "authorization acknowledgement failed: \(error)"
                )
            )
            throw error
        }
        if outcome == .stale {
            applyDiagnosticEvent(
                machine.noteAuthorizationAcknowledgementUndischarged(
                    ackToken: ackToken,
                    diagnostic:
                        "authorization acknowledgement outcome was stale"
                )
            )
        }
        return outcome.rawValue
    }

    // @ref LLP 0064#5-host-lifecycle — hosts translate lifecycle once at the provider boundary, never per view.
    /// Platform-neutral mobile lifecycle hook. iOS/SwiftUI hosts call this
    /// from the background/inactive transition. It releases demand before
    /// quiescing transports and retains only the desired subscription specs.
    public func pauseForBackground() async {
        guard !isPausedForBackground else { return }
        isPausedForBackground = true
        resumeLiveAfterForeground = socketTask != nil
        resumePollAfterForeground = drainTask != nil
        resumeSubscriptionIds = machine.subscriptions.compactMap {
            (id, entry) -> String? in
            switch entry.state {
            case .released, .terminalDeleted: return nil
            default: return id
            }
        }
        for id in resumeSubscriptionIds {
            guard let entry = machine.subscriptions[id] else { continue }
            _ = try? await unsubscribe(
                function: entry.function,
                subscriptionId: id,
                userId: entry.authUserId
            )
        }
        stopDrainLoop()
        closeLiveStream()
        machine.noteSuspended(subscriptionIds: resumeSubscriptionIds)
    }

    /// Platform-neutral foreground hook. Re-attaches the selected lane and
    /// enters every desired query through fresh snapshot-with-subscribe.
    public func resumeAfterForeground() async throws {
        guard isPausedForBackground else { return }
        isPausedForBackground = false
        let desired = resumeSubscriptionIds
        do {
            if grant == nil { _ = try await openConnection() }
            if resumeLiveAfterForeground { try await openLiveStream() }
            for id in desired {
                guard let entry = machine.subscriptions[id] else { continue }
                _ = try await subscribe(
                    function: entry.function,
                    args: entry.args,
                    userId: entry.authUserId,
                    supersedes: id,
                    authorizationNamespace: entry.authorizationNamespace
                )
            }
            if resumePollAfterForeground { startDrainLoop() }
            resumeSubscriptionIds = []
            resumeLiveAfterForeground = false
            resumePollAfterForeground = false
        } catch {
            // A foreground attempt can fail after some fresh subscriptions
            // landed. Return to a truly paused, retryable state: retire any
            // partial demand, quiesce transports, and retain the current ids
            // (new or old) as the next attempt's supersession set.
            let partial: [String] = machine.subscriptions.compactMap {
                (id, entry) -> String? in
                switch entry.state {
                case .released, .terminalDeleted: return nil
                default: return id
                }
            }
            for id in partial {
                guard let entry = machine.subscriptions[id] else { continue }
                _ = try? await unsubscribe(
                    function: entry.function,
                    subscriptionId: id,
                    userId: entry.authUserId
                )
            }
            stopDrainLoop()
            closeLiveStream()
            machine.noteSuspended(subscriptionIds: partial)
            resumeSubscriptionIds = partial
            isPausedForBackground = true
            throw error
        }
    }

    private func changedSubscriptions(_ event: MachineEvent) -> [String] {
        var changed = Set(event.materializationChanges)
        guard event.actions.contains(.replaceRows)
                || event.actions.contains(.applyDeltaById)
                || event.actions.contains(.applyInvalidationSnapshot)
        else { return Array(changed) }
        changed.formUnion(machine.subscriptions.compactMap { id, entry in
            if case .live = entry.state { return id }
            return nil
        })
        return Array(changed)
    }

    private func emitUpdate(_ subscriptionId: String) {
        guard let entry = machine.subscriptions[subscriptionId] else { return }
        let rows = entry.orderedRows
        for handler in updateHandlers { handler(subscriptionId, rows) }
    }

    private func applyDiagnosticEvent(_ event: MachineEvent) {
        diagnostics.append(contentsOf: event.diagnostics)
        for subscriptionId in event.materializationChanges {
            emitUpdate(subscriptionId)
        }
    }

    private func rejectedSubscribeOutput(
        function: String,
        successorSubscriptionId: String,
        userId: String?,
        predecessorSubscriptionId: String?,
        predecessorDisposalWitnessed: Bool,
        detail: String
    ) async -> ClientError {
        _ = try? await unsubscribe(
            function: function,
            subscriptionId: successorSubscriptionId,
            userId: userId
        )
        machine.removeSubscription(id: successorSubscriptionId)
        if predecessorDisposalWitnessed,
           let predecessorSubscriptionId,
           predecessorSubscriptionId != successorSubscriptionId {
            applyDiagnosticEvent(
                machine.noteSupersededPredecessorDisposed(
                    subscriptionId: predecessorSubscriptionId,
                    diagnostic:
                        "server retired predecessor \(predecessorSubscriptionId), but successor was rejected: \(detail)"
                )
            )
        }
        return .undecodableResponse(detail)
    }

    private func nextBackoff(after previous: Duration?) -> Duration {
        guard let previous else { return configuration.backoffFloor }
        return min(previous * 2, configuration.backoffCeiling)
    }

    private func record(_ line: String) {
        diagnostics.append(line)
    }

    func request(
        method: String,
        path: String,
        body: JSONValue?,
        connectionScoped: Bool,
        reservationAttempt: Int = 0
    ) async throws -> JSONValue {
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
        if configuration.sessionBearer != nil {
            urlRequest.setValue("1", forHTTPHeaderField: "x-snapback-auth-client-protocol")
            if path.starts(with: "/live/") || path.starts(with: "/ephemeral/") {
                urlRequest.setValue("1", forHTTPHeaderField: "x-snapback-auth-invalidation-protocol")
            }
            if !connectionScoped, let bearer = configuration.sessionBearer {
                urlRequest.setValue("Bearer \(bearer)", forHTTPHeaderField: "authorization")
            }
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
                // (LLP 0095 §4.4). Discard the refused grant immediately:
                // retaining it would make a foreground retry present the
                // same reaped/expired token forever.
                grant = nil
                stopDrainLoop()
                closeLiveStream()
                machine.noteGrantLost()
                diagnostics.append(
                    "SNAPBACK_CONNECTION_TOKEN_INVALID: discarded refused grant; next recovery opens a fresh connection"
                )
            }
            if let error = WireErrorResponse.from(json) {
                if Self.shouldRetryReservation(
                    status: http.statusCode,
                    code: error.code,
                    attempt: reservationAttempt,
                    maximumAttempts: configuration.reservationRetryMaxAttempts
                ) {
                    let range = configuration.reservationRetryJitterMilliseconds
                    let jitter = range.lowerBound <= range.upperBound
                        ? UInt64.random(in: range)
                        : 0
                    try? await Task.sleep(for: .milliseconds(jitter))
                    return try await request(
                        method: method,
                        path: path,
                        body: body,
                        connectionScoped: connectionScoped,
                        reservationAttempt: reservationAttempt + 1
                    )
                }
                throw ClientError.refusal(error, httpStatus: http.statusCode)
            }
            throw ClientError.transport("\(method) \(path): HTTP \(http.statusCode) with undecodable error body: \(String(decoding: data.prefix(300), as: UTF8.self))")
        }
        return json
    }

    static func shouldRetryReservation(
        status: Int,
        code: String,
        attempt: Int,
        maximumAttempts: Int
    ) -> Bool {
        status == 409
            && code == "SNAPBACK_AUTH_RESERVATION_STALE"
            && maximumAttempts > 0
            && attempt + 1 < maximumAttempts
    }

    private func resolvedAuthorizationNamespace(
        function: String,
        args: JSONValue,
        supplied: JSONValue?
    ) throws -> JSONValue? {
        guard configuration.sessionBearer != nil else { return supplied }
        if let supplied { return supplied }
        guard nextQueryInstanceId <= UInt64(Int64.max) else {
            throw ClientError.invalidState("authorization namespace counter exhausted")
        }
        let id = nextQueryInstanceId
        nextQueryInstanceId += 1
        let encoded = (try? args.encoded()).map { String(decoding: $0, as: UTF8.self) } ?? "null"
        return .object([
            "clientStoreId": .string(clientStoreId),
            "queryKey": .string("\(function):\(encoded)"),
            "queryInstanceId": .int(Int64(id)),
        ])
    }

    private func liveStreamProtocols(_ grant: ConnectionGrant) -> String {
        var values = [
            Self.wireVersionToken,
            "snapback.connection-token.\(grant.connectionToken)",
        ]
        if configuration.sessionBearer != nil {
            values.append("snapback.auth-client.1")
            values.append("snapback.auth-invalidation.1")
        }
        return values.joined(separator: ", ")
    }
}
