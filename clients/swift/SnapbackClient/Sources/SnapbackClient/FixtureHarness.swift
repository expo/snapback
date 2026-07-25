import Foundation

/// The per-client conformance harness LLP 0095 §6 anticipates: replays
/// `schemas/live.wire-fixtures.v1.json` against the §1 abstract state
/// machine as implemented by `ClientStateMachine`, honoring arm × lane tuple
/// routing (§2.2).
public struct FixtureHarness {
    public struct FixtureResult: Sendable {
        public var name: String
        public var passed: Bool
        public var detail: String
    }

    public struct CorpusResult: Sendable {
        public var wireVersion: String
        public var judgedAgainst: String
        public var results: [FixtureResult]
        public var evaluatedCount: Int { results.count }
        public var failures: [FixtureResult] { results.filter { !$0.passed } }
    }

    /// The tuples this client claims (LLP 0093 D2 order: `poll/local` first,
    /// then `live/local`; `live/hosted` is not yet claimed by this client).
    public var claimedTuples: Set<String>

    public init(claimedTuples: Set<String> = ["poll/local", "live/local"]) {
        self.claimedTuples = claimedTuples
    }

    public func run(corpusData: Data) throws -> CorpusResult {
        let corpus = try JSONValue.parse(corpusData)
        guard corpus["artifactKind"]?.stringValue == "liveWireFixtureCorpus",
              corpus["formatVersion"]?.uint64Value == 1,
              let fixtures = corpus["fixtures"]?.arrayValue
        else {
            throw SnapbackClient.ClientError.undecodableResponse("fixture corpus header")
        }
        var results: [FixtureResult] = []
        for fixture in fixtures {
            guard let name = fixture["name"]?.stringValue else { continue }
            guard let tuples = fixture["tuples"]?.arrayValue?.compactMap({ $0.stringValue }) else { continue }
            // §2.2: fixtures are evaluated per claimed tuple; a fixture whose
            // tuples do not intersect the claim set is out of scope.
            guard tuples.contains(where: { claimedTuples.contains($0) }) else {
                results.append(FixtureResult(name: name, passed: true, detail: "skipped: no claimed tuple (\(tuples.joined(separator: ",")))"))
                continue
            }
            results.append(evaluate(name: name, fixture: fixture))
        }
        return CorpusResult(
            wireVersion: corpus["wireVersion"]?.stringValue ?? "?",
            judgedAgainst: corpus["judgedAgainst"]?.stringValue ?? "?",
            results: results
        )
    }

    func evaluate(name: String, fixture: JSONValue) -> FixtureResult {
        guard let frame = fixture["frame"] else {
            return FixtureResult(name: name, passed: false, detail: "fixture has no frame")
        }
        let lane = fixture["lane"]?.stringValue ?? "core"
        let machine = ClientStateMachine()
        var trackedSubscriptions: Set<String> = []

        // Build the `given` state (§1 preconditions).
        if let givenSub = fixture["given"]?["subscription"] {
            guard let id = givenSub["id"]?.stringValue,
                  let state = givenSub["state"]?.stringValue
            else {
                return FixtureResult(name: name, passed: false, detail: "undecodable given.subscription")
            }
            machine.registerPending(subscriptionId: id, function: "fixtureFunction")
            if state == "live", let version = givenSub["version"]?.uint64Value {
                machine.applySnapshot(subscriptionId: id, function: "fixtureFunction", snapshot: QuerySnapshot(version: version, rows: [], cursor: nil))
            }
            trackedSubscriptions.insert(id)
        } else if fixture["given"]?["connection"] != nil {
            // "attached" with unspecified subscriptions: hold two live
            // subscriptions so connection-wide transitions are observable.
            for id in ["sub_a", "sub_b"] {
                machine.applySnapshot(subscriptionId: id, function: "fixtureFunction", snapshot: QuerySnapshot(version: 1, rows: [], cursor: nil))
                trackedSubscriptions.insert(id)
            }
            machine.noteAttached(poll: lane == "poll")
        }

        // Feed the frame through the lane-appropriate ingestion path.
        let event: MachineEvent
        switch lane {
        case "poll":
            var batch: [JSONValue] = [frame]
            if let context = fixture["batchContext"]?.arrayValue {
                batch.append(contentsOf: context)
            }
            event = machine.ingestDrainBatch(batch)
        default:
            // core / live: the frame arrives unwrapped (socket framing); the
            // drain lane re-covers wrapped delivery via its own fixtures.
            event = machine.ingestFrame(frame, postOwnershipCut: true)
        }

        // Judge `expect.actions` (set comparison over the closed vocabulary).
        let expectedActions = Set(fixture["expect"]?["actions"]?.arrayValue?.compactMap { $0.stringValue } ?? [])
        let actualActions = Set(event.actions.map(\.rawValue))
        if expectedActions != actualActions {
            return FixtureResult(name: name, passed: false, detail: "actions mismatch: expected \(expectedActions.sorted()) got \(actualActions.sorted())")
        }

        // Judge `expect.transitions`.
        for transition in fixture["expect"]?["transitions"]?.arrayValue ?? [] {
            guard let target = transition["to"]?.stringValue else {
                return FixtureResult(name: name, passed: false, detail: "transition without target state")
            }
            if let subscriptionId = transition["subscription"]?.stringValue {
                guard let entry = machine.subscriptions[subscriptionId] else {
                    return FixtureResult(name: name, passed: false, detail: "expected subscription \(subscriptionId) missing")
                }
                switch target {
                case "live":
                    guard case .live(let version) = entry.state,
                          transition["version"]?.uint64Value == nil || transition["version"]?.uint64Value == version
                    else {
                        return FixtureResult(name: name, passed: false, detail: "\(subscriptionId): expected live(\(transition["version"]?.uint64Value.map(String.init) ?? "any")) got \(entry.state)")
                    }
                case "resync_pending":
                    guard entry.state == .resyncPending else {
                        return FixtureResult(name: name, passed: false, detail: "\(subscriptionId): expected resync_pending got \(entry.state)")
                    }
                default:
                    return FixtureResult(name: name, passed: false, detail: "unhandled transition target \(target)")
                }
            } else if transition["connection"]?.stringValue == "all_subscriptions" {
                for id in trackedSubscriptions {
                    guard machine.subscriptions[id]?.state == .resyncPending else {
                        return FixtureResult(name: name, passed: false, detail: "connection-wide: \(id) not resync_pending")
                    }
                }
                if target == "resync_pending", !machine.retainedOverlaysCleared,
                   expectedActions.contains("clear_retained_overlays") {
                    return FixtureResult(name: name, passed: false, detail: "retained overlays were not cleared")
                }
            } else {
                return FixtureResult(name: name, passed: false, detail: "unhandled transition shape")
            }
        }

        // No expected transitions ⇒ the machine must not have moved anything.
        if (fixture["expect"]?["transitions"]?.arrayValue ?? []).isEmpty {
            for id in trackedSubscriptions {
                if machine.subscriptions[id]?.state == .resyncPending {
                    return FixtureResult(name: name, passed: false, detail: "\(id) transitioned without an expected transition")
                }
            }
        }

        return FixtureResult(name: name, passed: true, detail: "ok")
    }
}
