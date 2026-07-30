import Foundation

/// The per-client conformance harness LLP 0095 §6 anticipates: replays
/// `schemas/live.wire-fixtures.v1.json` (format v3) against the §1 abstract
/// state machine as implemented by `ClientStateMachine`, honoring arm × lane
/// tuple routing (§2.2) and the §2.1 judgment rules 1–4, including the
/// rule-4 virtual-time interval judgment via `VirtualTransportSupervisor`.
public struct FixtureHarness {
    public struct FixtureResult: Sendable {
        public var name: String
        public var tuple: String?
        public var passed: Bool
        public var detail: String
        public var evaluated: Bool
    }

    public struct CorpusResult: Sendable {
        public var formatVersion: UInt64
        public var wireVersion: String
        public var judgedAgainst: String
        public var results: [FixtureResult]
        public var evaluatedCount: Int { results.filter(\.evaluated).count }
        public var skippedCount: Int { results.filter { !$0.evaluated }.count }
        public var failures: [FixtureResult] { results.filter { !$0.passed } }
    }

    /// The tuples this client claims (LLP 0093 D2 order: `poll/local` first,
    /// then `live/local`; `live/hosted` is not yet claimed by this client).
    public var claimedTuples: Set<String>

    public init(claimedTuples: Set<String> = ["poll/local", "live/local"]) {
        self.claimedTuples = claimedTuples
    }

    public func run(corpusData: Data) throws -> CorpusResult {
        let claimableTuples: Set<String> = [
            "poll/local", "live/local", "live/hosted",
        ]
        guard claimedTuples.isSubset(of: claimableTuples) else {
            throw SnapbackClient.ClientError.undecodableResponse(
                "fixture harness claims an unknown or unclaimable tuple"
            )
        }
        let corpus = try JSONValue.parse(corpusData)
        guard corpus["artifactKind"]?.stringValue == "liveWireFixtureCorpus",
              let formatVersion = corpus["formatVersion"]?.uint64Value,
              (1...3).contains(formatVersion),
              let wireVersion = corpus["wireVersion"]?.stringValue,
              !wireVersion.isEmpty,
              let judgedAgainst = corpus["judgedAgainst"]?.stringValue,
              !judgedAgainst.isEmpty,
              let fixtures = corpus["fixtures"]?.arrayValue
        else {
            throw SnapbackClient.ClientError.undecodableResponse("fixture corpus header")
        }
        // Format v3 grows a three-direction enum; a v2 corpus stays
        // server_to_client-only (the version bump exists precisely so a v2
        // judgment is never applied to the new classes).
        let allowedDirections: Set<String> = formatVersion >= 3
            ? ["server_to_client", "client_to_server", "client_lifecycle"]
            : ["server_to_client"]
        var results: [FixtureResult] = []
        var seenNames = Set<String>()
        for fixture in fixtures {
            guard let name = fixture["name"]?.stringValue, !name.isEmpty else {
                if formatVersion >= 2 {
                    throw SnapbackClient.ClientError.undecodableResponse(
                        "format-v\(formatVersion) fixture has no non-empty name"
                    )
                }
                continue
            }
            if formatVersion >= 2, !seenNames.insert(name).inserted {
                throw SnapbackClient.ClientError.undecodableResponse(
                    "format-v\(formatVersion) fixture name is duplicated: \(name)"
                )
            }
            guard let rawTuples = fixture["tuples"]?.arrayValue,
                  !rawTuples.isEmpty,
                  rawTuples.allSatisfy({
                      guard let tuple = $0.stringValue else { return false }
                      return !tuple.isEmpty
                  })
            else {
                if formatVersion >= 2 {
                    throw SnapbackClient.ClientError.undecodableResponse(
                        "format-v\(formatVersion) fixture \(name) has no valid tuples"
                    )
                }
                continue
            }
            let tuples = rawTuples.compactMap(\.stringValue)
            if formatVersion >= 2 {
                guard Set(tuples).count == tuples.count,
                      tuples.allSatisfy({ claimableTuples.contains($0) }),
                      let direction = fixture["direction"]?.stringValue,
                      allowedDirections.contains(direction),
                      fixture["schemaValid"]?.boolValue != nil,
                      let lane = fixture["lane"]?.stringValue,
                      ["core", "poll", "live"].contains(lane),
                      lane != "poll"
                        || tuples.allSatisfy({ $0.hasPrefix("poll/") }),
                      lane != "live"
                        || tuples.allSatisfy({ $0.hasPrefix("live/") })
                else {
                    throw SnapbackClient.ClientError.undecodableResponse(
                        "format-v\(formatVersion) fixture \(name) has invalid evidence or tuple routing"
                    )
                }
            }
            // §2.2: fixtures are evaluated per claimed tuple; a fixture whose
            // tuples do not intersect the claim set is out of scope.
            let routedTuples = tuples.filter { claimedTuples.contains($0) }
            guard !routedTuples.isEmpty else {
                results.append(FixtureResult(name: name, tuple: nil, passed: true, detail: "skipped: no claimed tuple (\(tuples.joined(separator: ",")))", evaluated: false))
                continue
            }
            for tuple in routedTuples {
                results.append(
                    evaluate(
                        name: name,
                        tuple: tuple,
                        formatVersion: formatVersion,
                        fixture: fixture
                    )
                )
            }
        }
        return CorpusResult(
            formatVersion: formatVersion,
            wireVersion: wireVersion,
            judgedAgainst: judgedAgainst,
            results: results
        )
    }

    func evaluate(
        name: String,
        tuple: String,
        formatVersion: UInt64,
        fixture: JSONValue
    ) -> FixtureResult {
        let lane = fixture["lane"]?.stringValue ?? "core"
        let direction = fixture["direction"]?.stringValue ?? "server_to_client"
        let machine = ClientStateMachine()
        var trackedSubscriptions: Set<String> = []

        func fail(_ detail: String) -> FixtureResult {
            FixtureResult(name: name, tuple: tuple, passed: false, detail: detail, evaluated: true)
        }
        // Honest-interim rule (issues/20260730-swift-fixture-harness-format-v3.md):
        // a fixture whose judgment is not implemented is a skip, never a pass.
        func skip(_ detail: String) -> FixtureResult {
            FixtureResult(name: name, tuple: tuple, passed: true, detail: "skipped: \(detail)", evaluated: false)
        }

        if let problem = seedGiven(
            fixture["given"],
            lane: tuple.hasPrefix("poll/") ? "poll" : "live",
            formatVersion: formatVersion,
            machine: machine,
            trackedSubscriptions: &trackedSubscriptions
        ) {
            return fail(problem)
        }

        // §2.1 rule 4: a `clock: "virtual"` fixture's harness holds a
        // virtual clock starting at 0; timer state seeds from `given`.
        var supervisor: VirtualTransportSupervisor?
        if fixture["clock"]?.stringValue == "virtual" {
            supervisor = VirtualTransportSupervisor(
                machine: machine,
                lastServerActivityMs: fixture["given"]?["connection"]?[
                    "lastServerActivityVirtualMs"
                ]?.uint64Value,
                socketLostAtMs: fixture["given"]?["connection"]?[
                    "socketLostAtVirtualMs"
                ]?.uint64Value
            )
        }

        let initialRows = rowsBySubscription(machine, trackedSubscriptions)
        var cumulativeActions: [ClientAction] = []
        var cumulativeAcknowledgements: [String] = []

        if let steps = fixture["steps"]?.arrayValue {
            guard !steps.isEmpty else {
                return fail("fixture has empty steps")
            }
            for (index, step) in steps.enumerated() {
                let label = "step \(index + 1)"
                guard let expected = step["expect"] else {
                    return fail("\(label) has no expect")
                }
                let before = statesBySubscription(machine, trackedSubscriptions)
                let phaseBefore = machine.phase
                var emissions: [VirtualTransportSupervisor.TimedAction]?
                let event: MachineEvent
                if let frame = step["frame"] {
                    guard direction == "server_to_client" else {
                        return fail("\(label) carries a frame outside server_to_client")
                    }
                    event = ingest(
                        frame: frame,
                        batchContext: step["batchContext"] ?? fixture["batchContext"],
                        lane: lane,
                        machine: machine
                    )
                    // Any server frame is liveness evidence for the
                    // freshness budget (the pong is the guaranteed one).
                    supervisor?.noteServerActivity()
                } else if step["request"] != nil {
                    guard direction == "client_to_server" else {
                        return fail("\(label) carries a request outside client_to_server")
                    }
                    switch processRequestUnit(step, machine: machine) {
                    case .malformed(let detail):
                        return fail("\(label): \(detail)")
                    case .event(let requestEvent):
                        event = requestEvent
                    }
                } else if let advance = step["advanceVirtualTimeMs"]?.uint64Value {
                    guard let supervisor, advance > 0 else {
                        return fail("\(label) advances virtual time without a positive amount and clock: virtual")
                    }
                    let outcome = supervisor.advance(byMs: advance)
                    emissions = outcome.emissions
                    event = outcome.event
                } else if let lifecycleEvent = step["event"] {
                    switch lifecycleEvent["kind"]?.stringValue {
                    case "socket_lost":
                        // T-LOSS: the loss itself emits no actions; the
                        // transitions and the standing recovery plan are the
                        // judged obligations.
                        let dropped = machine.noteSocketLost()
                        event = MachineEvent(
                            actions: [],
                            resubscribe: dropped,
                            diagnostics: []
                        )
                    case "authority_instance_changed":
                        guard let successor = lifecycleEvent["to"]?.stringValue
                        else {
                            return fail("\(label) authority_instance_changed without a successor")
                        }
                        event = machine.noteAuthorityInstanceChanged(
                            to: successor
                        )
                    default:
                        return skip("unimplemented lifecycle event kind \(lifecycleEvent["kind"]?.stringValue ?? "?")")
                    }
                } else {
                    return fail("\(label) carries none of frame/request/advanceVirtualTimeMs/event")
                }
                if let mismatch = judge(
                    expected: expected,
                    event: event,
                    machine: machine,
                    trackedSubscriptions: trackedSubscriptions,
                    statesBefore: before,
                    phaseBefore: phaseBefore,
                    initialRows: initialRows,
                    emissions: emissions,
                    label: label
                ) {
                    return fail(mismatch)
                }
                cumulativeActions.append(contentsOf: event.actions)
                cumulativeAcknowledgements.append(contentsOf: event.acknowledgements)
            }
            if let expected = fixture["expect"] {
                // The top-level expect is the cumulative/final judgment after
                // all steps (§2.1 rule 1). A clockless fixture that finishes
                // RECOVERING has had no clock under which to run its timers,
                // so its standing recovery plan (T-RECONNECT: bounded-backoff
                // reconnect, then fresh subscribes) is judged as the final
                // obligations; under a virtual clock the timers themselves
                // own recovery pacing and only emitted actions are judged.
                var planActions: [ClientAction] = []
                if supervisor == nil, machine.phase == .recovering,
                   let plan = machine.standingRecoveryPlan() {
                    planActions = plan.actions
                }
                let aggregate = MachineEvent(
                    actions: cumulativeActions + planActions,
                    resubscribe: [],
                    diagnostics: [],
                    acknowledgements: cumulativeAcknowledgements
                )
                if let mismatch = judge(
                    expected: expected,
                    event: aggregate,
                    machine: machine,
                    trackedSubscriptions: trackedSubscriptions,
                    statesBefore: nil,
                    phaseBefore: nil,
                    initialRows: initialRows,
                    emissions: nil,
                    label: "cumulative"
                ) {
                    return fail(mismatch)
                }
            }
        } else if fixture["request"] != nil {
            guard direction == "client_to_server" else {
                return fail("fixture carries a request outside client_to_server")
            }
            guard let expected = fixture["expect"] else {
                return fail("fixture has no expect")
            }
            let before = statesBySubscription(machine, trackedSubscriptions)
            let phaseBefore = machine.phase
            switch processRequestUnit(fixture, machine: machine) {
            case .malformed(let detail):
                return fail(detail)
            case .event(let event):
                if let mismatch = judge(
                    expected: expected,
                    event: event,
                    machine: machine,
                    trackedSubscriptions: trackedSubscriptions,
                    statesBefore: before,
                    phaseBefore: phaseBefore,
                    initialRows: initialRows,
                    emissions: nil,
                    label: "fixture"
                ) {
                    return fail(mismatch)
                }
            }
        } else {
            guard let frame = fixture["frame"], let expected = fixture["expect"] else {
                return fail("fixture has no frame or expect")
            }
            guard direction == "server_to_client" else {
                return fail("fixture carries a frame outside server_to_client")
            }
            let before = statesBySubscription(machine, trackedSubscriptions)
            let phaseBefore = machine.phase
            let event = ingest(
                frame: frame,
                batchContext: fixture["batchContext"],
                lane: lane,
                machine: machine
            )
            if let mismatch = judge(
                expected: expected,
                event: event,
                machine: machine,
                trackedSubscriptions: trackedSubscriptions,
                statesBefore: before,
                phaseBefore: phaseBefore,
                initialRows: initialRows,
                emissions: nil,
                label: "fixture"
            ) {
                return fail(mismatch)
            }
        }

        return FixtureResult(name: name, tuple: tuple, passed: true, detail: "ok", evaluated: true)
    }

    private enum RequestOutcome {
        case event(MachineEvent)
        case malformed(String)
    }

    /// A `client_to_server` unit (fixture or step): the harness plays the
    /// server, answering the pinned request with its pinned refusal or
    /// response, and the client's processing of that answer is judged.
    private func processRequestUnit(
        _ container: JSONValue,
        machine: ClientStateMachine
    ) -> RequestOutcome {
        guard let request = container["request"],
              let method = request["method"]?.stringValue,
              let route = request["route"]?.stringValue
        else {
            return .malformed("client_to_server unit lacks request method/route")
        }
        let refusal = container["refusal"]
        let response = container["response"]
        guard (refusal != nil) != (response != nil) else {
            return .malformed("client_to_server unit must pin exactly one of refusal/response")
        }
        if let refusal {
            guard refusal["status"]?.uint64Value != nil,
                  let code = refusal["code"]?.stringValue,
                  code.hasPrefix("SNAPBACK_")
            else {
                return .malformed("refusal lacks a status and SNAPBACK_* code")
            }
            return .event(
                machine.processRequestAnswer(
                    method: method,
                    route: route,
                    body: request["body"],
                    refusalCode: code,
                    responseStatus: nil
                )
            )
        }
        guard let status = response?["status"]?.uint64Value else {
            return .malformed("response lacks a status")
        }
        return .event(
            machine.processRequestAnswer(
                method: method,
                route: route,
                body: request["body"],
                refusalCode: nil,
                responseStatus: status
            )
        )
    }

    private func seedGiven(
        _ given: JSONValue?,
        lane: String,
        formatVersion: UInt64,
        machine: ClientStateMachine,
        trackedSubscriptions: inout Set<String>
    ) -> String? {
        var connectionExpectation:
            AuthorizationInvalidationConnection?
        if let rawExpectation = given?["authorizationExpectation"] {
            guard var members = rawExpectation.objectValue else {
                return "authorizationExpectation is not an object"
            }
            members["protocolVersion"] = members["protocolVersion"] ?? .int(1)
            guard let parsed = AuthorizationInvalidationConnection.from(
                .object(members)
            ) else {
                return "authorizationExpectation is not a valid connection expectation"
            }
            connectionExpectation = parsed
            machine.noteGranted(authorizationInvalidation: parsed)
        }
        if let queue = given?["replayQueue"] {
            guard let authorityInstance =
                    queue["authorityInstance"]?.stringValue
            else {
                return "replayQueue without an authorityInstance"
            }
            machine.seedReplayQueue(
                authorityInstance: authorityInstance,
                pendingClientMutationIds: queue["pending"]?.arrayValue?
                    .compactMap { $0["clientMutationId"]?.stringValue } ?? []
            )
        }
        if let retained = given?["retainedRead"] {
            guard let queryKey = retained["queryKey"]?.stringValue,
                  let expires =
                    retained["lease"]?["expiresAtServerMs"]?.uint64Value
            else {
                return "retainedRead without a queryKey and lease expiry"
            }
            machine.seedRetainedRead(
                queryKey: queryKey,
                queryInstanceId:
                    retained["queryInstanceId"]?.uint64Value ?? 0,
                rows: retained["rows"]?.arrayValue ?? [],
                leaseExpiresAtServerMs: expires
            )
        }
        let connectionState = given?["connection"] != nil
            ? (given?["connection"]?["state"]?.stringValue ?? "attached")
            : nil
        var seeds = given?["subscriptions"]?.arrayValue ?? []
        if seeds.isEmpty, let single = given?["subscription"] {
            seeds = [single]
        }
        // Format v1 represented attached connection-wide preconditions
        // without an explicit subscription population. Format v2+ names the
        // exact population for the populated connection states; the v3
        // pre-population states (idle/granted) have no subscriptions to pin
        // by construction (§2.1 rule 3).
        if seeds.isEmpty, connectionState != nil, formatVersion < 2 {
            seeds = [
                .object(["id": .string("sub_a"), "state": .string("live"), "version": .int(1)]),
                .object(["id": .string("sub_b"), "state": .string("live"), "version": .int(1)]),
            ]
        }
        if seeds.isEmpty, let connectionState,
           ["attached", "recovering"].contains(connectionState),
           formatVersion >= 2 {
            return "format-v\(formatVersion) populated connection has no explicit subscription population"
        }
        for seed in seeds {
            guard let id = seed["id"]?.stringValue,
                  let state = seed["state"]?.stringValue
            else {
                return "undecodable given subscription"
            }
            let authorizationNamespace = seed["authorizationNamespace"]
            let inferredFunction = authorizationNamespace?["queryKey"]?
                .stringValue.flatMap {
                    $0.split(separator: ":", maxSplits: 1)
                        .first.map(String.init)
                }
            let function = seed["function"]?.stringValue
                ?? inferredFunction
                ?? "fixtureFunction"
            let rows = seed["rows"]?.arrayValue ?? []
            let authorizationScope = seed["authorizationScope"]
            let acceptedAuthorization = seed["acceptedAuthorization"]
                .flatMap(AuthorizationVersion.from)
            if authorizationScope != nil {
                guard validFixtureAuthorizationScope(authorizationScope),
                      authorizationScope?["subscriptionId"]?.stringValue == id,
                      authorizationScope?["namespace"]
                        == authorizationNamespace,
                      let acceptedAuthorization,
                      let connectionExpectation,
                      authorizationScope?["issuerId"]
                        == connectionExpectation.issuerId,
                      authorizationScope?["connectionGeneration"]?
                        .uint64Value
                        == connectionExpectation.connectionGeneration,
                      acceptedAuthorization.incarnation
                        == connectionExpectation.authorization.incarnation,
                      acceptedAuthorization.epoch
                        <= connectionExpectation.authorization.epoch
                else {
                    return "\(id): incomplete authorization custody in given state"
                }
            }
            machine.registerPending(
                subscriptionId: id,
                function: function,
                authorizationNamespace: authorizationNamespace,
                authorizationScope: authorizationScope,
                acceptedAuthorization: acceptedAuthorization,
                authorizationVersionStream:
                    connectionExpectation?.versionStream
            )
            switch state {
            case "pending":
                break
            case "live", "dropped", "resync_pending":
                guard let version = seed["version"]?.uint64Value else {
                    return "\(id): \(state) given is missing version"
                }
                machine.applySnapshot(
                    subscriptionId: id,
                    function: function,
                    snapshot: QuerySnapshot(version: version, rows: rows, cursor: nil),
                    authorizationNamespace: authorizationNamespace,
                    authorizationScope: authorizationScope,
                    acceptedAuthorization: acceptedAuthorization,
                    authorizationVersionStream:
                        connectionExpectation?.versionStream
                )
                if state == "dropped" {
                    // Dropped populations exist only behind a lost socket;
                    // the RECOVERING connection handler below performs the
                    // organic T-LOSS drop.
                    guard connectionState == "recovering" else {
                        return "\(id): dropped given outside a recovering connection"
                    }
                }
                if state == "resync_pending" {
                    // Enter the resync obligation through the real ingest
                    // path rather than poking internal state.
                    _ = machine.ingestFrame(
                        .object([
                            "kind": .string("resync_required"),
                            "subscription_id": .string(id),
                            "reason": .string("fixture_given_seed"),
                            "clear_retained": .bool(false),
                        ]),
                        postOwnershipCut: true
                    )
                }
            default:
                return "\(id): unsupported given state \(state)"
            }
            trackedSubscriptions.insert(id)
        }
        if let connectionState {
            switch connectionState {
            case "idle":
                break
            case "granted":
                if machine.phase == .idle { machine.noteGranted() }
            case "attached":
                machine.noteAttached(poll: lane == "poll")
            case "recovering":
                machine.noteAttached(poll: false)
                _ = machine.noteSocketLost()
            default:
                return "unsupported given connection state \(connectionState)"
            }
        }
        return nil
    }

    private func ingest(
        frame: JSONValue,
        batchContext: JSONValue?,
        lane: String,
        machine: ClientStateMachine
    ) -> MachineEvent {
        if lane == "poll" {
            var batch = [frame]
            batch.append(contentsOf: batchContext?.arrayValue ?? [])
            return machine.ingestDrainBatch(batch)
        }
        return machine.ingestFrame(frame, postOwnershipCut: true)
    }

    private func judge(
        expected: JSONValue,
        event: MachineEvent,
        machine: ClientStateMachine,
        trackedSubscriptions: Set<String>,
        statesBefore: [String: SubscriptionState]?,
        phaseBefore: ConnectionPhase?,
        initialRows: [String: [JSONValue]],
        emissions: [VirtualTransportSupervisor.TimedAction]?,
        label: String
    ) -> String? {
        // §2.1 rule 1 (and rule 4 over an advance interval): actions are an
        // exact, unordered set — no omissions, no extras; timer actions may
        // repeat within an interval without changing the set.
        let expectedActions = Set(expected["actions"]?.arrayValue?.compactMap(\.stringValue) ?? [])
        let actualActions = Set(event.actions.map(\.rawValue))
        if expectedActions != actualActions {
            return "\(label) actions mismatch: expected \(expectedActions.sorted()) got \(actualActions.sorted())"
        }

        if let ordered = expected["orderedActions"]?.arrayValue?.compactMap(\.stringValue) {
            let actual = event.actions.map(\.rawValue)
            if ordered != actual {
                return "\(label) ordered actions mismatch: expected \(ordered) got \(actual)"
            }
        }
        let forbidden = Set(expected["forbiddenActions"]?.arrayValue?.compactMap(\.stringValue) ?? [])
        let forbiddenSeen = forbidden.intersection(actualActions)
        if !forbiddenSeen.isEmpty {
            return "\(label) emitted forbidden actions \(forbiddenSeen.sorted())"
        }
        // §2.1 rule 4: expect.pacing bounds the spacing of consecutive
        // emissions of the named action inside the advance interval.
        if let pacing = expected["pacing"] {
            guard let action = pacing["action"]?.stringValue,
                  let maxIntervalMs = pacing["maxIntervalMs"]?.uint64Value
            else {
                return "\(label) malformed pacing expectation"
            }
            guard let emissions else {
                return "\(label) pacing expectation outside a virtual-time advance step"
            }
            let times = emissions
                .filter { $0.action.rawValue == action }
                .map(\.atMs)
            for (earlier, later) in zip(times, times.dropFirst())
            where later - earlier > maxIntervalMs {
                return "\(label) pacing violation for \(action): consecutive emissions \(later - earlier) ms apart exceed \(maxIntervalMs) ms"
            }
        }
        if let ackToken = expected["ackToken"]?.stringValue,
           event.acknowledgements != [ackToken] {
            return "\(label) acknowledgement mismatch: expected [\(ackToken)] got \(event.acknowledgements)"
        }
        if let mustPrecedeAck = expected["acknowledgeAfter"]?.stringValue {
            guard let applyIndex = event.actions.map(\.rawValue).firstIndex(of: mustPrecedeAck),
                  let ackIndex = event.actions.firstIndex(of: .acknowledgeObligation),
                  applyIndex < ackIndex
            else {
                return "\(label) did not acknowledge after \(mustPrecedeAck)"
            }
        }

        let transitions = expected["transitions"]?.arrayValue ?? []
        for transition in transitions {
            guard let target = transition["to"]?.stringValue else {
                return "\(label) transition without target state"
            }
            if let subscriptionId = transition["subscription"]?.stringValue {
                guard let entry = machine.subscriptions[subscriptionId] else {
                    return "\(label) expected subscription \(subscriptionId) missing"
                }
                switch target {
                case "live":
                    guard case .live(let version) = entry.state,
                          transition["version"]?.uint64Value == nil
                            || transition["version"]?.uint64Value == version
                    else {
                        return "\(label) \(subscriptionId): expected live(\(transition["version"]?.uint64Value.map(String.init) ?? "any")) got \(entry.state)"
                    }
                    if let expectedEpoch =
                        transition["authorizationEpoch"]?.uint64Value,
                       entry.acceptedAuthorization?.epoch != expectedEpoch {
                        let actualEpoch = entry.acceptedAuthorization.map {
                            String($0.epoch)
                        } ?? "nil"
                        return "\(label) \(subscriptionId): expected authorization epoch \(expectedEpoch) got \(actualEpoch)"
                    }
                case "resync_pending":
                    guard entry.state == .resyncPending else {
                        return "\(label) \(subscriptionId): expected resync_pending got \(entry.state)"
                    }
                    if transition["rows"]?.stringValue == "retained_unreadable",
                       !entry.rows.isEmpty {
                        return "\(label) \(subscriptionId): quarantined rows remain readable"
                    }
                    if let pendingRevision =
                        transition["pendingRevision"]?.uint64Value,
                       entry.invalidationRevisionHighWater
                        != pendingRevision {
                        return "\(label) \(subscriptionId): expected pending revision \(pendingRevision) got \(entry.invalidationRevisionHighWater.map(String.init) ?? "nil")"
                    }
                    if let pendingFloor =
                        transition["pendingWitnessFloor"]?.uint64Value,
                       entry.pendingAuthorizationObligation?["witness"]?[
                        "data"
                       ]?["minCommitVersion"]?.uint64Value != pendingFloor {
                        return "\(label) \(subscriptionId): expected pending witness floor \(pendingFloor)"
                    }
                case "terminal_deleted":
                    guard entry.state == .terminalDeleted else {
                        return "\(label) \(subscriptionId): expected terminal_deleted got \(entry.state)"
                    }
                    if transition["rows"]?.stringValue == "destroyed",
                       !entry.rows.isEmpty {
                        return "\(label) \(subscriptionId): terminal-deleted rows were not destroyed"
                    }
                case "dropped":
                    guard entry.state == .dropped else {
                        return "\(label) \(subscriptionId): expected dropped got \(entry.state)"
                    }
                default:
                    return "\(label) unhandled transition target \(target)"
                }
            } else if transition["connection"]?.stringValue == "all_subscriptions" {
                switch target {
                case "resync_pending":
                    for id in trackedSubscriptions where machine.subscriptions[id]?.state != .resyncPending {
                        return "\(label) connection-wide: \(id) not resync_pending"
                    }
                    if expectedActions.contains("clear_retained_overlays"),
                       !machine.retainedOverlaysCleared {
                        return "\(label) retained overlays were not cleared"
                    }
                case "dropped":
                    for id in trackedSubscriptions where machine.subscriptions[id]?.state != .dropped {
                        return "\(label) connection-wide: \(id) not dropped"
                    }
                default:
                    return "\(label) unhandled connection transition target \(target)"
                }
            } else if transition["connection"]?.stringValue == "state" {
                guard phaseMatches(target, machine.phase) else {
                    return "\(label) expected connection state \(target) got \(machine.phase)"
                }
            } else if let authorityInstance = transition["replayQueue"]?.stringValue {
                guard target == "suspended" else {
                    return "\(label) unhandled replayQueue transition target \(target)"
                }
                guard let queue = machine.replayQueue,
                      queue.authorityInstance == authorityInstance,
                      queue.suspended
                else {
                    return "\(label) replay queue \(authorityInstance) is not suspended"
                }
            } else if let queryKey = transition["retainedRead"]?.stringValue {
                guard target == "fenced" else {
                    return "\(label) unhandled retainedRead transition target \(target)"
                }
                guard let retained = machine.retainedReads[queryKey],
                      retained.fenced,
                      retained.rows.isEmpty
                else {
                    return "\(label) retained read \(queryKey) is not fenced with unreadable rows"
                }
            } else {
                return "\(label) unhandled transition shape"
            }
        }

        if let statesBefore {
            let statesAfter = statesBySubscription(machine, trackedSubscriptions)
            var actuallyTransitioned = Set(trackedSubscriptions.filter {
                statesBefore[$0] != statesAfter[$0]
            })
            actuallyTransitioned.formUnion(event.materializationChanges)
            var expectedToTransition: Set<String> = []
            for transition in transitions {
                if let id = transition["subscription"]?.stringValue {
                    expectedToTransition.insert(id)
                } else if transition["connection"]?.stringValue == "all_subscriptions" {
                    expectedToTransition.formUnion(trackedSubscriptions)
                }
            }
            if actuallyTransitioned != expectedToTransition {
                let extras = actuallyTransitioned.subtracting(expectedToTransition).sorted()
                let missing = expectedToTransition.subtracting(actuallyTransitioned).sorted()
                return "\(label) transition population mismatch: extra \(extras), missing \(missing)"
            }
            if transitions.isEmpty, statesBefore != statesAfter {
                return "\(label) changed subscription state without an expected transition"
            }
        }
        if let phaseBefore {
            let expectsPhaseChange = transitions.contains {
                $0["connection"]?.stringValue == "state"
            }
            if !expectsPhaseChange, machine.phase != phaseBefore {
                return "\(label) changed connection phase to \(machine.phase) without an expected transition"
            }
        }
        if expected["rows"]?.stringValue == "unchanged",
           rowsBySubscription(machine, trackedSubscriptions) != initialRows {
            return "\(label) changed rows that were required to remain unchanged"
        }
        if let identity = expected["rowIdentity"],
           let member = identity["member"]?.stringValue,
           let deltaId = identity["deltaId"]?.stringValue,
           let finalTitle = identity["finalTitle"]?.stringValue {
            let matchedEntry = trackedSubscriptions.compactMap {
                machine.subscriptions[$0]
            }.first { $0.rows[deltaId] != nil }
            let matched = matchedEntry?.rows[deltaId]
            guard matched?[member]?.stringValue == deltaId,
                  matched?["title"]?.stringValue == finalTitle
            else {
                return "\(label) did not preserve \(member) identity \(deltaId) through the delta"
            }
            if let finalIds = identity["finalIds"]?.arrayValue?.compactMap(\.stringValue),
               Set(matchedEntry?.rows.keys ?? [:].keys) != Set(finalIds) {
                return "\(label) final row ids do not exactly match \(finalIds.sorted())"
            }
        }
        // T-RECONNECT supersession plan: the established predecessor
        // re-enters with `supersedes`; a never-established one re-enters
        // without a supersession assumption.
        if let supersession = expected["supersession"]?.objectValue {
            guard let plan = machine.standingRecoveryPlan() else {
                return "\(label) expected a supersession plan but the client is not recovering"
            }
            var expectedPlan: [String: String] = [:]
            for (id, value) in supersession {
                guard let kind = value.stringValue else {
                    return "\(label) malformed supersession expectation for \(id)"
                }
                expectedPlan[id] = kind
            }
            if plan.supersession != expectedPlan {
                return "\(label) supersession plan mismatch: expected \(expectedPlan) got \(plan.supersession)"
            }
        }
        // LLP 0043 settlement idempotence witness.
        if let settlement = expected["settlement"] {
            guard let clientMutationId =
                    settlement["clientMutationId"]?.stringValue
            else {
                return "\(label) malformed settlement expectation"
            }
            if settlement["appliedOnce"]?.boolValue == true,
               machine.clientMutationSettlements[clientMutationId] != 1 {
                return "\(label) settlement for \(clientMutationId) was not applied exactly once"
            }
        }
        return nil
    }

    private func phaseMatches(_ target: String, _ phase: ConnectionPhase) -> Bool {
        switch target {
        case "idle": return phase == .idle
        case "granted": return phase == .granted
        case "attached": return phase == .attachedLive || phase == .attachedPoll
        case "recovering": return phase == .recovering
        case "terminal_auth": return phase == .terminalAuth
        case "grant_lost": return phase == .grantLost
        case "closed": return phase == .closed
        default: return false
        }
    }

    private func statesBySubscription(
        _ machine: ClientStateMachine,
        _ ids: Set<String>
    ) -> [String: SubscriptionState] {
        Dictionary(uniqueKeysWithValues: ids.compactMap { id in
            machine.subscriptions[id].map { (id, $0.state) }
        })
    }

    private func rowsBySubscription(
        _ machine: ClientStateMachine,
        _ ids: Set<String>
    ) -> [String: [JSONValue]] {
        Dictionary(uniqueKeysWithValues: ids.compactMap { id in
            machine.subscriptions[id].map { (id, $0.orderedRows) }
        })
    }

    private func validFixtureAuthorizationScope(
        _ scope: JSONValue?
    ) -> Bool {
        guard let members = scope?.objectValue,
              Set(members.keys) == Set([
                  "kind", "issuerId", "namespace", "scopeSequence",
                  "connectionGeneration", "subscriptionId",
              ]),
              members["kind"]?.stringValue == "subscription",
              (members["scopeSequence"]?.uint64Value ?? 0) > 0,
              (members["connectionGeneration"]?.uint64Value ?? 0) > 0,
              members["subscriptionId"]?.stringValue?.isEmpty == false,
              let namespace = members["namespace"]?.objectValue,
              Set(namespace.keys) == Set([
                  "clientStoreId", "queryKey", "queryInstanceId",
              ]),
              namespace["clientStoreId"]?.stringValue?.isEmpty == false,
              namespace["queryKey"]?.stringValue?.isEmpty == false,
              (namespace["queryInstanceId"]?.uint64Value ?? 0) > 0
        else { return false }
        return true
    }
}
