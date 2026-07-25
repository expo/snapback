import Foundation

// The abstract client state machine of LLP 0095 §1, implemented as the
// client core's frame processor. Fixtures from
// `schemas/live.wire-fixtures.v1.json` are judged against this component
// directly ("canonical frames in, expected client state/actions out",
// LLP 0095 §2.1); the networked client (`SnapbackClient.swift`) drives the
// same machine, so the conformance evidence covers the shipping path.

/// The closed action vocabulary of LLP 0095 §1.5. Raw values are the
/// fixture-corpus spellings.
public enum ClientAction: String, Sendable, Hashable {
    case replaceRows = "replace_rows"
    case applyDeltaById = "apply_delta_by_id"
    case dropStale = "drop_stale"
    case resubscribeSubscription = "resubscribe_subscription"
    case resubscribeAll = "resubscribe_all"
    case clearRetainedOverlays = "clear_retained_overlays"
    case unwrapDurable = "unwrap_durable"
    case deliverBatchRemainder = "deliver_batch_remainder"
    case surfaceDecodeDiagnostic = "surface_decode_diagnostic"
    case ignoreFrame = "ignore_frame"
    case ignoreUnknownFields = "ignore_unknown_fields"
    case surfaceTerminalAuth = "surface_terminal_auth"
    case reopenConnection = "reopen_connection"
}

/// Per-subscription states (LLP 0095 §1.3).
public enum SubscriptionState: Equatable, Sendable {
    case pending
    case live(version: UInt64)
    case resyncPending
    case dropped
    case released
}

public struct SubscriptionEntry: Sendable {
    public var function: String
    public var state: SubscriptionState
    public var rows: [String: JSONValue] = [:]
    /// Row order as last replaced; deltas are unordered by contract.
    public var rowOrder: [String] = []
    /// The dev-mode auth identity the subscription was established under.
    /// Retained because unsubscribe/resubscribe must present the same "live
    /// owner" identity (observed: `SNAPBACK_LIVE_RESUME_OWNERSHIP` otherwise;
    /// see issues/20260725-0093-p2-spec-defect-unsubscribe-auth-identity.md).
    public var authUserId: String? = nil

    public var orderedRows: [JSONValue] {
        rowOrder.compactMap { rows[$0] }
    }
}

/// Connection states (LLP 0095 §1.2). The machine tracks only the
/// wire-observable obligations; transport supervision (backoff timing,
/// heartbeats) lives in the client around it.
public enum ConnectionPhase: Equatable, Sendable {
    case idle
    case granted
    case attachedLive
    case attachedPoll
    case recovering
    case terminalAuth
    case grantLost
    case closed
}

public struct MachineEvent: Sendable {
    public var actions: [ClientAction]
    /// Subscriptions the client must re-enter via fresh subscribe (with
    /// `supersedes` where the id survives client-side).
    public var resubscribe: [String]
    public var diagnostics: [String]
}

public final class ClientStateMachine {
    public private(set) var phase: ConnectionPhase = .idle
    public private(set) var subscriptions: [String: SubscriptionEntry] = [:]
    /// Whether retained ephemeral overlays exist; the connection-wide
    /// clear-retained transition blanks them (T-OVERFLOW / T-DB / T-DB-P).
    public private(set) var retainedOverlaysCleared = false

    public init() {}

    // MARK: lifecycle bookkeeping driven by the transport client

    public func noteGranted() { phase = .granted }
    public func noteAttached(poll: Bool) { phase = poll ? .attachedPoll : .attachedLive }
    public func noteClosed() { phase = .closed }
    public func noteGrantLost() {
        // T-GRANT-LOSS (§4.4): recovery re-opens and re-establishes every
        // subscription; retained overlays are void.
        phase = .grantLost
        for id in subscriptions.keys { subscriptions[id]?.state = .dropped }
    }

    /// T-LOSS: socket loss drops the connection's durable subscriptions
    /// server-side; every subscription is DROPPED and re-entry is fresh
    /// subscribe with `supersedes` (T-RECONNECT).
    public func noteSocketLost() -> [String] {
        phase = .recovering
        var toReenter: [String] = []
        for (id, entry) in subscriptions where entry.state != .released {
            subscriptions[id]?.state = .dropped
            toReenter.append(id)
        }
        return toReenter
    }

    public func registerPending(subscriptionId: String, function: String) {
        subscriptions[subscriptionId] = SubscriptionEntry(function: function, state: .pending)
    }

    func removeSubscription(id: String) {
        subscriptions.removeValue(forKey: id)
    }

    /// Snapshot-with-subscribe (LLP 0034 §1): the subscribe response carries
    /// the authoritative snapshot; no prime race.
    public func applySnapshot(subscriptionId: String, function: String, snapshot: QuerySnapshot, authUserId: String? = nil) {
        var entry = subscriptions[subscriptionId] ?? SubscriptionEntry(function: function, state: .pending)
        entry.function = function
        if let authUserId { entry.authUserId = authUserId }
        entry.state = .live(version: snapshot.version)
        entry.rows = [:]
        entry.rowOrder = []
        for row in snapshot.rows {
            let id = row["id"]?.stringValue ?? row["_id"]?.stringValue ?? UUID().uuidString
            entry.rows[id] = row
            entry.rowOrder.append(id)
        }
        subscriptions[subscriptionId] = entry
    }

    /// T-UNSUB: explicit release, the only normal demand-release path.
    public func noteReleased(subscriptionId: String) {
        subscriptions[subscriptionId]?.state = .released
    }

    // MARK: durable-envelope ingestion (both lanes, post-unwrap)

    public func ingestDurable(_ decoded: Decoded<LiveEnvelope>) -> MachineEvent {
        var actions: [ClientAction] = []
        var resubscribe: [String] = []
        var diagnostics: [String] = []
        if decoded.hadUnknownFields {
            // Tolerance floor: unknown fields on known kinds are ignored.
            actions.append(.ignoreUnknownFields)
        }
        switch decoded.value {
        case .liveReplace(let subscriptionId, let function, let version, let rows, _):
            guard admitVersion(subscriptionId, version) else {
                actions.append(.dropStale)
                break
            }
            applySnapshot(subscriptionId: subscriptionId, function: function, snapshot: QuerySnapshot(version: version, rows: rows, cursor: nil))
            actions.append(.replaceRows)
        case .liveDelta(let subscriptionId, let function, let version, let ops, _):
            guard admitVersion(subscriptionId, version) else {
                actions.append(.dropStale)
                break
            }
            var entry = subscriptions[subscriptionId] ?? SubscriptionEntry(function: function, state: .live(version: version))
            for op in ops {
                switch op.op {
                case .add, .update:
                    if entry.rows[op.id] == nil { entry.rowOrder.append(op.id) }
                    entry.rows[op.id] = op.row ?? .null
                case .remove:
                    entry.rows.removeValue(forKey: op.id)
                    entry.rowOrder.removeAll { $0 == op.id }
                }
            }
            entry.state = .live(version: version)
            subscriptions[subscriptionId] = entry
            actions.append(.applyDeltaById)
        case .currentAsOf(let subscriptionId, _, let version, _):
            // Rows stay; version advances (LLP 0091 rung 1). Sent only to a
            // resumeFromToken subscriber.
            if admitVersion(subscriptionId, version), var entry = subscriptions[subscriptionId] {
                entry.state = .live(version: version)
                subscriptions[subscriptionId] = entry
            }
        case .resyncRequired(let subscriptionId, _, let clearRetained, _, _):
            if let subscriptionId {
                // T-RESYNC: subscription-scoped; unknown reasons never change
                // the transition.
                subscriptions[subscriptionId]?.state = .resyncPending
                actions.append(.resubscribeSubscription)
                resubscribe.append(subscriptionId)
            } else {
                // T-OVERFLOW: connection-wide; crosses the lane boundary —
                // retained ephemeral overlays blank too.
                let event = forceConnectionWideResync()
                actions.append(contentsOf: event.actions)
                resubscribe.append(contentsOf: event.resubscribe)
                _ = clearRetained
            }
        case .authorizationInvalidation:
            // Auth profiles are out of the P-2 unauthenticated scope; the
            // envelope is decoded (never crashes) and surfaced.
            diagnostics.append("authorization_invalidation received (auth profile not claimed)")
        }
        return MachineEvent(actions: actions, resubscribe: resubscribe, diagnostics: diagnostics)
    }

    // MARK: socket-frame ingestion (lane L)

    public func ingestSocket(_ decoded: Decoded<LiveSocketServerFrame>) -> MachineEvent {
        var actions: [ClientAction] = []
        var resubscribe: [String] = []
        var diagnostics: [String] = []
        if decoded.hadUnknownFields { actions.append(.ignoreUnknownFields) }
        switch decoded.value {
        case .durableBytes:
            // T-DB: known kind, REQUIRED recovery action. The payload's outbox
            // lease was released at socket handoff — the update is lost. This
            // implementation takes the permitted equivalent of LLP 0095 §4.2:
            // socket bounce with fresh subscribe achieving the forced-resync
            // transition class (every durable subscription re-enters fresh
            // snapshot-with-subscribe; retained overlays clear).
            let event = forceConnectionWideResync()
            actions.append(contentsOf: event.actions)
            resubscribe.append(contentsOf: event.resubscribe)
            diagnostics.append("durable_bytes: undecodable durable payload; forced connection-wide resync")
        case .authError(let code, let reason, let disposition):
            phase = .terminalAuth
            actions.append(.surfaceTerminalAuth)
            diagnostics.append("terminal auth loss: \(code) (\(reason), \(disposition))")
        case .pong, .senderNonce, .ephemeralAck, .ephemeralError, .ephemeral:
            break // control traffic; no durable-state obligation here
        }
        return MachineEvent(actions: actions, resubscribe: resubscribe, diagnostics: diagnostics)
    }

    // MARK: generic dispatch and the drain (lane P)

    /// Dispatch one unwrapped inbound frame across both `kind` families.
    public func ingestFrame(_ json: JSONValue, postOwnershipCut: Bool) -> MachineEvent {
        switch ServerFrame.decode(json) {
        case .durable(let decoded):
            return ingestDurable(decoded)
        case .socket(let decoded):
            return ingestSocket(decoded)
        case .unknownKind(let kind):
            // Tolerance floor: unknown kinds are skipped, never fatal (new
            // kinds are always offer-gated, LLP 0093 D1).
            return MachineEvent(actions: [.ignoreFrame], resubscribe: [], diagnostics: ["skipped unknown envelope kind \(kind)"])
        case .undecodableKnownKind(let kind):
            if postOwnershipCut {
                return undecodablePostCut(context: "undecodable instance of known kind \(kind)")
            }
            return MachineEvent(actions: [.surfaceDecodeDiagnostic], resubscribe: [], diagnostics: ["undecodable instance of known kind \(kind) (pre-cut)"])
        case .notAnEnvelope:
            if postOwnershipCut {
                return undecodablePostCut(context: "non-envelope durable frame")
            }
            return MachineEvent(actions: [.ignoreFrame], resubscribe: [], diagnostics: ["skipped non-envelope frame"])
        }
    }

    /// T-DRAIN: process one acknowledged drain batch
    /// (`GET /outbox/{connection_id}` → JSON array of `RealtimeEnvelope`).
    /// The ownership cut has passed by the time the body is read, so a
    /// malformed item is T-DB-P: surface, force connection-wide resync, and
    /// keep delivering the remainder — nothing per-item aborts the batch.
    public func ingestDrainBatch(_ items: [JSONValue]) -> MachineEvent {
        var actions: [ClientAction] = []
        var resubscribe: [String] = []
        var diagnostics: [String] = []
        var sawMalformed = false
        var deliveredRemainder = false
        for item in items {
            guard let envelope = RealtimeEnvelope.from(item) else {
                sawMalformed = true
                let event = undecodablePostCut(context: "malformed drain item")
                merge(event, into: &actions, &resubscribe, &diagnostics)
                continue
            }
            switch envelope {
            case .durable(let payload):
                guard let inner = try? JSONValue.parse(Data(payload)) else {
                    // T-DB-P: the ownership cut has passed; this loss is
                    // unattributable and unrecoverable, and it must not
                    // abort the remainder of the batch.
                    sawMalformed = true
                    let event = undecodablePostCut(context: "undecodable durable payload in acknowledged batch")
                    merge(event, into: &actions, &resubscribe, &diagnostics)
                    continue
                }
                let event = ingestFrame(inner, postOwnershipCut: true)
                if sawMalformed {
                    // Remainder delivery after a malformed item: the item is
                    // still fully processed (state mutates, resubscribes and
                    // diagnostics propagate) and reported under the batch
                    // obligation `deliver_batch_remainder`.
                    deliveredRemainder = true
                    resubscribe.append(contentsOf: event.resubscribe)
                    diagnostics.append(contentsOf: event.diagnostics)
                } else {
                    actions.append(.unwrapDurable)
                    merge(event, into: &actions, &resubscribe, &diagnostics)
                }
            case .ephemeral(let message):
                if sawMalformed { deliveredRemainder = true }
                diagnostics.append("ephemeral drain message: \(String(describing: message.objectValue?.keys.first ?? "?"))")
            }
        }
        if deliveredRemainder {
            actions.append(.deliverBatchRemainder)
        }
        return MachineEvent(actions: dedupe(actions), resubscribe: resubscribe, diagnostics: diagnostics)
    }

    // MARK: shared transitions

    /// The forced-resync equivalence class (LLP 0095 §4.2): every durable
    /// subscription re-enters fresh snapshot-with-subscribe and retained
    /// ephemeral overlays clear.
    public func forceConnectionWideResync() -> MachineEvent {
        var resubscribe: [String] = []
        for (id, entry) in subscriptions where entry.state != .released {
            subscriptions[id]?.state = .resyncPending
            resubscribe.append(id)
        }
        retainedOverlaysCleared = true
        return MachineEvent(actions: [.resubscribeAll, .clearRetainedOverlays], resubscribe: resubscribe, diagnostics: [])
    }

    private func undecodablePostCut(context: String) -> MachineEvent {
        // T-DB-P: post-cut loss is unattributable and unrecoverable — same
        // transition class as durable_bytes, plus the surfaced diagnostic.
        var event = forceConnectionWideResync()
        event.actions.insert(.surfaceDecodeDiagnostic, at: 0)
        event.diagnostics.append(context)
        return event
    }

    /// Version guard (LLP 0095 §1.3): in LIVE(v), `version <= v` drops.
    private func admitVersion(_ subscriptionId: String, _ version: UInt64) -> Bool {
        guard let entry = subscriptions[subscriptionId] else {
            // Frame for a subscription we do not hold (e.g. already released
            // client-side): drop-stale is the safe posture.
            return false
        }
        if case .live(let held) = entry.state { return version > held }
        // pending/resyncPending: admit; the fresh snapshot supersedes anyway.
        return true
    }

    private func merge(_ event: MachineEvent, into actions: inout [ClientAction], _ resubscribe: inout [String], _ diagnostics: inout [String]) {
        actions.append(contentsOf: event.actions)
        resubscribe.append(contentsOf: event.resubscribe)
        diagnostics.append(contentsOf: event.diagnostics)
    }

    private func dedupe(_ actions: [ClientAction]) -> [ClientAction] {
        var seen = Set<ClientAction>()
        return actions.filter { seen.insert($0).inserted }
    }
}
