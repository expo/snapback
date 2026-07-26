import Foundation

/// The per-client conformance harness LLP 0095 §6 anticipates: replays
/// `schemas/live.wire-fixtures.v1.json` against the §1 abstract state
/// machine as implemented by `ClientStateMachine`, honoring arm × lane tuple
/// routing (§2.2).
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
              (1...2).contains(formatVersion),
              let wireVersion = corpus["wireVersion"]?.stringValue,
              !wireVersion.isEmpty,
              let judgedAgainst = corpus["judgedAgainst"]?.stringValue,
              !judgedAgainst.isEmpty,
              let fixtures = corpus["fixtures"]?.arrayValue
        else {
            throw SnapbackClient.ClientError.undecodableResponse("fixture corpus header")
        }
        var results: [FixtureResult] = []
        var seenNames = Set<String>()
        for fixture in fixtures {
            guard let name = fixture["name"]?.stringValue, !name.isEmpty else {
                if formatVersion >= 2 {
                    throw SnapbackClient.ClientError.undecodableResponse(
                        "format-v2 fixture has no non-empty name"
                    )
                }
                continue
            }
            if formatVersion >= 2, !seenNames.insert(name).inserted {
                throw SnapbackClient.ClientError.undecodableResponse(
                    "format-v2 fixture name is duplicated: \(name)"
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
                        "format-v2 fixture \(name) has no valid tuples"
                    )
                }
                continue
            }
            let tuples = rawTuples.compactMap(\.stringValue)
            if formatVersion >= 2 {
                guard Set(tuples).count == tuples.count,
                      tuples.allSatisfy({ claimableTuples.contains($0) }),
                      fixture["direction"]?.stringValue
                        == "server_to_client",
                      fixture["schemaValid"]?.boolValue != nil,
                      let lane = fixture["lane"]?.stringValue,
                      ["core", "poll", "live"].contains(lane),
                      lane != "poll"
                        || tuples.allSatisfy({ $0.hasPrefix("poll/") }),
                      lane != "live"
                        || tuples.allSatisfy({ $0.hasPrefix("live/") })
                else {
                    throw SnapbackClient.ClientError.undecodableResponse(
                        "format-v2 fixture \(name) has invalid evidence or tuple routing"
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
        let machine = ClientStateMachine()
        var trackedSubscriptions: Set<String> = []

        if let problem = seedGiven(
            fixture["given"],
            lane: tuple.hasPrefix("poll/") ? "poll" : "live",
            formatVersion: formatVersion,
            machine: machine,
            trackedSubscriptions: &trackedSubscriptions
        ) {
            return FixtureResult(name: name, tuple: tuple, passed: false, detail: problem, evaluated: true)
        }

        let initialRows = rowsBySubscription(machine, trackedSubscriptions)
        var cumulativeActions: [ClientAction] = []
        var cumulativeAcknowledgements: [String] = []

        if let steps = fixture["steps"]?.arrayValue {
            guard !steps.isEmpty else {
                return FixtureResult(name: name, tuple: tuple, passed: false, detail: "fixture has empty steps", evaluated: true)
            }
            for (index, step) in steps.enumerated() {
                guard let frame = step["frame"], let expected = step["expect"] else {
                    return FixtureResult(name: name, tuple: tuple, passed: false, detail: "step \(index + 1) has no frame or expect", evaluated: true)
                }
                let before = statesBySubscription(machine, trackedSubscriptions)
                let event = ingest(
                    frame: frame,
                    batchContext: step["batchContext"] ?? fixture["batchContext"],
                    lane: lane,
                    machine: machine
                )
                if let mismatch = judge(
                    expected: expected,
                    event: event,
                    machine: machine,
                    trackedSubscriptions: trackedSubscriptions,
                    statesBefore: before,
                    initialRows: initialRows,
                    label: "step \(index + 1)"
                ) {
                    return FixtureResult(name: name, tuple: tuple, passed: false, detail: mismatch, evaluated: true)
                }
                cumulativeActions.append(contentsOf: event.actions)
                cumulativeAcknowledgements.append(contentsOf: event.acknowledgements)
            }
            if let expected = fixture["expect"] {
                let aggregate = MachineEvent(
                    actions: cumulativeActions,
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
                    initialRows: initialRows,
                    label: "cumulative"
                ) {
                    return FixtureResult(name: name, tuple: tuple, passed: false, detail: mismatch, evaluated: true)
                }
            }
        } else {
            guard let frame = fixture["frame"], let expected = fixture["expect"] else {
                return FixtureResult(name: name, tuple: tuple, passed: false, detail: "fixture has no frame or expect", evaluated: true)
            }
            let before = statesBySubscription(machine, trackedSubscriptions)
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
                initialRows: initialRows,
                label: "fixture"
            ) {
                return FixtureResult(name: name, tuple: tuple, passed: false, detail: mismatch, evaluated: true)
            }
        }

        return FixtureResult(name: name, tuple: tuple, passed: true, detail: "ok", evaluated: true)
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
        var seeds = given?["subscriptions"]?.arrayValue ?? []
        if seeds.isEmpty, let single = given?["subscription"] {
            seeds = [single]
        }
        // Format v1 represented attached connection-wide preconditions
        // without an explicit subscription population. Keep that corpus
        // replayable while format v2 always names the exact population.
        if seeds.isEmpty, given?["connection"] != nil,
           formatVersion < 2 {
            seeds = [
                .object(["id": .string("sub_a"), "state": .string("live"), "version": .int(1)]),
                .object(["id": .string("sub_b"), "state": .string("live"), "version": .int(1)]),
            ]
        }
        if seeds.isEmpty, given?["connection"] != nil,
           formatVersion >= 2 {
            return "format-v2 attached connection has no explicit subscription population"
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
            case "live":
                guard let version = seed["version"]?.uint64Value else {
                    return "\(id): live given is missing version"
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
            default:
                return "\(id): unsupported given state \(state)"
            }
            trackedSubscriptions.insert(id)
        }
        if given?["connection"] != nil {
            machine.noteAttached(poll: lane == "poll")
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
        initialRows: [String: [JSONValue]],
        label: String
    ) -> String? {
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
                default:
                    return "\(label) unhandled transition target \(target)"
                }
            } else if transition["connection"]?.stringValue == "all_subscriptions" {
                guard target == "resync_pending" else {
                    return "\(label) unhandled connection transition target \(target)"
                }
                for id in trackedSubscriptions where machine.subscriptions[id]?.state != .resyncPending {
                    return "\(label) connection-wide: \(id) not resync_pending"
                }
                if expectedActions.contains("clear_retained_overlays"),
                   !machine.retainedOverlaysCleared {
                    return "\(label) retained overlays were not cleared"
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
        return nil
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
