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
    case adoptResumeToken = "adopt_resume_token"
    case quarantineRows = "quarantine_rows"
    case applyInvalidationSnapshot = "apply_invalidation_snapshot"
    case applyInvalidationTerminalDelete = "apply_invalidation_terminal_delete"
    case acknowledgeObligation = "acknowledge_obligation"
    case surfaceProtocolDiagnostic = "surface_protocol_diagnostic"
}

/// Per-subscription states (LLP 0095 §1.3).
public enum SubscriptionState: Equatable, Sendable {
    case pending
    case live(version: UInt64)
    case resyncPending
    case terminalDeleted
    case dropped
    case released
}

public struct AppliedAuthorizationInvalidation: Equatable, Sendable {
    public var obligation: JSONValue
    public var resolution: JSONValue
}

public struct SubscriptionEntry: Sendable {
    public var function: String
    public var state: SubscriptionState
    /// Original arguments and store-owned authorization namespace survive
    /// socket/background loss so fresh re-subscribe is semantically exact.
    public var args: JSONValue = .null
    public var authorizationNamespace: JSONValue? = nil
    /// Exact server-issued subscription scope. The subscription id alone is
    /// not custody: issuer, connection generation, namespace, and sequence are
    /// all part of the non-reusable fence.
    public var authorizationScope: JSONValue? = nil
    /// Highest authenticated authorization expectation observed for this
    /// exact scope. It advances even while a newer obligation is unresolved,
    /// so delayed lower-epoch tickets cannot release quarantine.
    public var acceptedAuthorization: AuthorizationVersion? = nil
    public var authorizationVersionStream: String? = nil
    public var authorizationOwnerContinuityId: String? = nil
    public var rows: [String: JSONValue] = [:]
    /// Row order as last replaced; deltas are unordered by contract.
    public var rowOrder: [String] = []
    /// The dev-mode auth identity the subscription was established under.
    /// Retained because unsubscribe/resubscribe must present the same "live
    /// owner" identity (observed: `SNAPBACK_LIVE_RESUME_OWNERSHIP` otherwise;
    /// see issues/20260725-0093-p2-spec-defect-unsubscribe-auth-identity.md).
    public var authUserId: String? = nil
    /// Exact applied obligation/ticket identity. This is an authorization
    /// fence, independent of the ordinary data version: a later
    /// authorization snapshot may validly carry the same data version.
    public var appliedAuthorizationInvalidation: AppliedAuthorizationInvalidation? = nil
    /// Monotone even while rows are quarantined and `state` no longer carries
    /// a live version.
    public var dataVersionHighWater: UInt64? = nil
    /// Highest obligation revision observed for the exact scope, including an
    /// unresolved level-triggered obligation.
    public var invalidationRevisionHighWater: UInt64? = nil
    public var pendingAuthorizationObligation: JSONValue? = nil

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
    /// Post-commit invalidation tickets whose matching snapshots were applied
    /// synchronously by this event. The transport ACKs these afterward.
    public var acknowledgements: [String]
    /// Exact subscriptions whose readable materialization changed even when
    /// the ordinary data-version state did not (equal-version authorization
    /// replacement, quarantine, or terminal delete).
    public var materializationChanges: [String]

    public init(
        actions: [ClientAction],
        resubscribe: [String],
        diagnostics: [String],
        acknowledgements: [String] = [],
        materializationChanges: [String] = []
    ) {
        self.actions = actions
        self.resubscribe = resubscribe
        self.diagnostics = diagnostics
        self.acknowledgements = acknowledgements
        self.materializationChanges = materializationChanges
    }
}

public final class ClientStateMachine {
    public private(set) var phase: ConnectionPhase = .idle
    public private(set) var subscriptions: [String: SubscriptionEntry] = [:]
    /// Whether retained ephemeral overlays exist; the connection-wide
    /// clear-retained transition blanks them (T-OVERFLOW / T-DB / T-DB-P).
    public private(set) var retainedOverlaysCleared = false
    public private(set) var authorizationInvalidationConnection:
        AuthorizationInvalidationConnection?
    /// An ACK token is bound to one exact committed ticket. Retaining that
    /// binding prevents a later scope or revision from reusing the token.
    private var appliedAuthorizationInvalidationsByAckToken:
        [String: AppliedAuthorizationInvalidation] = [:]

    public init() {}

    // MARK: lifecycle bookkeeping driven by the transport client

    public func noteGranted(
        authorizationInvalidation:
            AuthorizationInvalidationConnection? = nil
    ) {
        phase = .granted
        authorizationInvalidationConnection = authorizationInvalidation
    }
    public func noteAttached(poll: Bool) { phase = poll ? .attachedPoll : .attachedLive }
    public func noteClosed() { phase = .closed }
    public func noteGrantLost() {
        // T-GRANT-LOSS (§4.4): recovery re-opens and re-establishes every
        // subscription; retained overlays are void.
        phase = .grantLost
        for (id, entry) in subscriptions
        where entry.state != .released && entry.state != .terminalDeleted {
            subscriptions[id]?.state = .dropped
        }
    }

    /// T-LOSS: socket loss drops the connection's durable subscriptions
    /// server-side; every subscription is DROPPED and re-entry is fresh
    /// subscribe with `supersedes` (T-RECONNECT).
    public func noteSocketLost() -> [String] {
        phase = .recovering
        var toReenter: [String] = []
        for (id, entry) in subscriptions
        where entry.state != .released && entry.state != .terminalDeleted {
            subscriptions[id]?.state = .dropped
            toReenter.append(id)
        }
        return toReenter
    }

    public func registerPending(
        subscriptionId: String,
        function: String,
        args: JSONValue = .null,
        authorizationNamespace: JSONValue? = nil,
        authorizationScope: JSONValue? = nil,
        acceptedAuthorization: AuthorizationVersion? = nil,
        authorizationVersionStream: String? = nil
    ) {
        subscriptions[subscriptionId] = SubscriptionEntry(
            function: function,
            state: .pending,
            args: args,
            authorizationNamespace: authorizationNamespace,
            authorizationScope: authorizationScope,
            acceptedAuthorization: acceptedAuthorization,
            authorizationVersionStream: authorizationVersionStream
        )
    }

    func removeSubscription(id: String) {
        subscriptions.removeValue(forKey: id)
    }

    /// Snapshot-with-subscribe (LLP 0034 §1): the subscribe response carries
    /// the authoritative snapshot; no prime race.
    public func applySnapshot(
        subscriptionId: String,
        function: String,
        snapshot: QuerySnapshot,
        authUserId: String? = nil,
        args: JSONValue? = nil,
        authorizationNamespace: JSONValue? = nil,
        authorizationScope: JSONValue? = nil,
        acceptedAuthorization: AuthorizationVersion? = nil,
        authorizationVersionStream: String? = nil
    ) {
        var entry = subscriptions[subscriptionId] ?? SubscriptionEntry(function: function, state: .pending)
        entry.function = function
        if let authUserId { entry.authUserId = authUserId }
        if let args { entry.args = args }
        if let authorizationNamespace { entry.authorizationNamespace = authorizationNamespace }
        if let authorizationScope { entry.authorizationScope = authorizationScope }
        if let acceptedAuthorization {
            entry.acceptedAuthorization = acceptedAuthorization
        }
        if let authorizationVersionStream {
            entry.authorizationVersionStream = authorizationVersionStream
        }
        entry.state = .live(version: snapshot.version)
        entry.dataVersionHighWater = max(
            entry.dataVersionHighWater ?? 0,
            snapshot.version
        )
        entry.rows = [:]
        entry.rowOrder = []
        for row in snapshot.rows {
            // `_id` is wire row identity. An app field named `id` is ordinary
            // data and may collide across rows without changing membership.
            let id = row["_id"]?.stringValue ?? row["id"]?.stringValue ?? UUID().uuidString
            entry.rows[id] = row
            entry.rowOrder.append(id)
        }
        subscriptions[subscriptionId] = entry
    }

    /// T-UNSUB: explicit release, the only normal demand-release path.
    public func noteReleased(subscriptionId: String) {
        subscriptions[subscriptionId]?.state = .released
    }

    public func noteSuspended(subscriptionIds: [String]) {
        phase = .closed
        for id in subscriptionIds
        where subscriptions[id] != nil
            && subscriptions[id]?.state != .terminalDeleted {
            subscriptions[id]?.state = .dropped
        }
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
            if subscriptions[subscriptionId]?.state == .terminalDeleted {
                return terminalReuseDiagnostic(subscriptionId)
            }
            if subscriptions[subscriptionId]?
                .pendingAuthorizationObligation != nil {
                return authorizationQuarantineDiagnostic(subscriptionId)
            }
            guard admitVersion(subscriptionId, version) else {
                actions.append(.dropStale)
                break
            }
            applySnapshot(subscriptionId: subscriptionId, function: function, snapshot: QuerySnapshot(version: version, rows: rows, cursor: nil))
            actions.append(.replaceRows)
        case .liveDelta(let subscriptionId, let function, let version, let ops, _):
            if subscriptions[subscriptionId]?.state == .terminalDeleted {
                return terminalReuseDiagnostic(subscriptionId)
            }
            if subscriptions[subscriptionId]?
                .pendingAuthorizationObligation != nil {
                return authorizationQuarantineDiagnostic(subscriptionId)
            }
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
            entry.dataVersionHighWater = max(
                entry.dataVersionHighWater ?? 0,
                version
            )
            subscriptions[subscriptionId] = entry
            actions.append(.applyDeltaById)
        case .currentAsOf(let subscriptionId, _, let version, _):
            if subscriptions[subscriptionId]?.state == .terminalDeleted {
                return terminalReuseDiagnostic(subscriptionId)
            }
            if subscriptions[subscriptionId]?
                .pendingAuthorizationObligation != nil {
                return authorizationQuarantineDiagnostic(subscriptionId)
            }
            // Rows stay; version advances (LLP 0091 rung 1). Sent only to a
            // resumeFromToken subscriber.
            if admitVersion(subscriptionId, version), var entry = subscriptions[subscriptionId] {
                entry.state = .live(version: version)
                entry.dataVersionHighWater = max(
                    entry.dataVersionHighWater ?? 0,
                    version
                )
                subscriptions[subscriptionId] = entry
                actions.append(.adoptResumeToken)
            }
        case .resyncRequired(let subscriptionId, _, let clearRetained, _, _):
            if let subscriptionId {
                if subscriptions[subscriptionId]?.state == .terminalDeleted {
                    return terminalReuseDiagnostic(subscriptionId)
                }
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
        // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — snapshot application precedes acknowledgement; foreign and unsatisfied obligations never settle.
        case .authorizationInvalidation(let obligation, let snapshot, let resolution):
            let scopeSubscriptionId = obligation.subscriptionId
            guard let scopeSubscriptionId,
                  var scopedEntry = subscriptions[scopeSubscriptionId],
                  snapshot == nil || snapshot?.subscriptionId == scopeSubscriptionId
            else {
                // The obligation is addressed to a materialization this
                // client does not own (or the attached snapshot contradicts
                // its scope). Never settle another owner's level-triggered
                // obligation.
                diagnostics.append(
                    "authorization invalidation names a foreign, non-subscription, or inconsistent scope"
                )
                return MachineEvent(
                    actions: [.surfaceProtocolDiagnostic, .ignoreFrame],
                    resubscribe: [],
                    diagnostics: diagnostics
                )
            }

            if let custodyProblem = invalidationCustodyProblem(
                obligation,
                entry: scopedEntry
            ) {
                diagnostics.append(custodyProblem)
                return MachineEvent(
                    actions: [.surfaceProtocolDiagnostic, .ignoreFrame],
                    resubscribe: [],
                    diagnostics: diagnostics
                )
            }

            if let resolution,
               let accepted = appliedAuthorizationInvalidationsByAckToken[
                resolution.ackToken
               ],
               accepted != AppliedAuthorizationInvalidation(
                obligation: obligation.raw,
                resolution: resolution.raw
               ) {
                return protocolInvalidationDiagnostic(
                    "authorization invalidation reused an accepted ACK token with changed ticket fields"
                )
            }

            if let resolution,
               scopedEntry.appliedAuthorizationInvalidation
                == AppliedAuthorizationInvalidation(
                    obligation: obligation.raw,
                    resolution: resolution.raw
                ) {
                // Exact redelivery after the apply/delete commit: no data
                // mutation repeats, but the level-triggered ACK does.
                return MachineEvent(
                    actions: [.acknowledgeObligation],
                    resubscribe: [],
                    diagnostics: [],
                    acknowledgements: [resolution.ackToken]
                )
            }

            if scopedEntry.state == .terminalDeleted {
                return terminalReuseDiagnostic(scopeSubscriptionId)
            }

            let previousRevision = scopedEntry.invalidationRevisionHighWater
            let wasCurrentPending = previousRevision == obligation.revision
                && scopedEntry.pendingAuthorizationObligation == obligation.raw
            if let previousRevision, obligation.revision < previousRevision {
                diagnostics.append(
                    "authorization invalidation revision \(obligation.revision) is older than observed revision \(previousRevision)"
                )
                return MachineEvent(
                    actions: [.surfaceProtocolDiagnostic, .ignoreFrame],
                    resubscribe: [],
                    diagnostics: diagnostics
                )
            }
            if let previousRevision,
               obligation.revision == previousRevision,
               !wasCurrentPending {
                // The identical applied pair returned above. Any other
                // obligation at one exact scope/revision is corruption.
                diagnostics.append(
                    "authorization invalidation reused one scope revision with conflicting obligation or resolution content"
                )
                return MachineEvent(
                    actions: [.surfaceProtocolDiagnostic, .ignoreFrame],
                    resubscribe: [],
                    diagnostics: diagnostics
                )
            }

            // Observe the obligation before inspecting its optional proof. A
            // newer unresolved revision is itself the high-water that fences a
            // delayed older resolution.
            scopedEntry.invalidationRevisionHighWater = obligation.revision
            scopedEntry.pendingAuthorizationObligation = obligation.raw
            if scopedEntry.authorizationOwnerContinuityId == nil {
                scopedEntry.authorizationOwnerContinuityId =
                    obligation.ownerContinuityId
            }
            if let authorization = obligation.authorization {
                scopedEntry.acceptedAuthorization = authorization
            }

            guard let resolution else {
                scopedEntry.rows.removeAll()
                scopedEntry.rowOrder.removeAll()
                scopedEntry.state = .resyncPending
                subscriptions[scopeSubscriptionId] = scopedEntry
                actions.append(.quarantineRows)
                diagnostics.append(
                    "authorization invalidation has no satisfying exact resolution; materialization quarantined"
                )
                return MachineEvent(
                    actions: actions,
                    resubscribe: [],
                    diagnostics: diagnostics,
                    materializationChanges: [scopeSubscriptionId]
                )
            }
            guard obligation.isSatisfied(by: resolution) else {
                if wasCurrentPending {
                    return protocolInvalidationDiagnostic(
                        "authorization invalidation resolution does not satisfy the exact pending obligation"
                    )
                }
                return quarantineInvalidation(
                    subscriptionId: scopeSubscriptionId,
                    entry: scopedEntry,
                    diagnostic:
                        "authorization invalidation resolution does not satisfy the exact obligation",
                    surfaceProtocolDiagnostic: true,
                    ignoreFrame: true
                )
            }

            switch resolution.kind {
            case .snapshot:
                guard snapshot != nil else {
                    return quarantineInvalidation(
                        subscriptionId: scopeSubscriptionId,
                        entry: scopedEntry,
                        diagnostic:
                            "snapshot resolution omitted its superseding snapshot",
                        surfaceProtocolDiagnostic: true,
                        ignoreFrame: true
                    )
                }
            case .terminalDelete:
                guard snapshot == nil, resolution.maxDisposition == "delete"
                else {
                    diagnostics.append(
                        "terminalDelete resolution must carry delete disposition and no snapshot"
                    )
                    if wasCurrentPending {
                        return MachineEvent(
                            actions: [
                                .surfaceProtocolDiagnostic, .ignoreFrame,
                            ],
                            resubscribe: [],
                            diagnostics: diagnostics
                        )
                    }
                    return quarantineInvalidation(
                        subscriptionId: scopeSubscriptionId,
                        entry: scopedEntry,
                        diagnostic: diagnostics[0],
                        surfaceProtocolDiagnostic: true,
                        ignoreFrame: true
                    )
                }
            }

            actions.append(.quarantineRows)
            if resolution.kind == .terminalDelete {
                // @ref LLP 0053#dispositions-with-producers-and-meanings — a terminal-delete resolution destroys the readable materialization and persists the exact fence before ACK.
                scopedEntry.rows.removeAll()
                scopedEntry.rowOrder.removeAll()
                scopedEntry.state = .terminalDeleted
                scopedEntry.pendingAuthorizationObligation = nil
                scopedEntry.appliedAuthorizationInvalidation =
                    AppliedAuthorizationInvalidation(
                        obligation: obligation.raw,
                        resolution: resolution.raw
                    )
                subscriptions[scopeSubscriptionId] = scopedEntry
                appliedAuthorizationInvalidationsByAckToken[
                    resolution.ackToken
                ] = scopedEntry.appliedAuthorizationInvalidation
                actions.append(.applyInvalidationTerminalDelete)
            } else {
                guard let snapshot else {
                    preconditionFailure("snapshot kind checked above")
                }
                let obligationFloor = obligation.minimumCommitVersion ?? 0
                let resolutionFloor =
                    resolution.witness["data"]?["minCommitVersion"]?
                    .uint64Value ?? 0
                let requiredFloor = max(
                    scopedEntry.dataVersionHighWater ?? 0,
                    max(obligationFloor, resolutionFloor)
                )
                guard snapshot.version >= requiredFloor,
                      snapshot.function == scopedEntry.function
                else {
                    return quarantineInvalidation(
                        subscriptionId: scopeSubscriptionId,
                        entry: scopedEntry,
                        diagnostic:
                            "authorization snapshot does not cover its data floor/function for \(scopeSubscriptionId)",
                        surfaceProtocolDiagnostic: true
                    )
                }
                // Authorization identity is a separate ordering dimension:
                // equal data versions are admissible for a first-seen exact
                // obligation/resolution pair.
                subscriptions[scopeSubscriptionId] = scopedEntry
                applySnapshot(
                    subscriptionId: snapshot.subscriptionId,
                    function: snapshot.function,
                    snapshot: QuerySnapshot(
                        version: snapshot.version,
                        rows: snapshot.rows,
                        cursor: nil
                    )
                )
                subscriptions[scopeSubscriptionId]?
                    .pendingAuthorizationObligation = nil
                subscriptions[scopeSubscriptionId]?
                    .appliedAuthorizationInvalidation =
                    AppliedAuthorizationInvalidation(
                        obligation: obligation.raw,
                        resolution: resolution.raw
                    )
                appliedAuthorizationInvalidationsByAckToken[
                    resolution.ackToken
                ] = subscriptions[scopeSubscriptionId]?
                    .appliedAuthorizationInvalidation
                actions.append(.applyInvalidationSnapshot)
            }
            actions.append(.acknowledgeObligation)
            return MachineEvent(
                actions: actions,
                resubscribe: [],
                diagnostics: diagnostics,
                acknowledgements: [resolution.ackToken],
                materializationChanges: [scopeSubscriptionId]
            )
        }
        return MachineEvent(actions: actions, resubscribe: resubscribe, diagnostics: diagnostics)
    }

    // MARK: socket-frame ingestion (lane L)

    public func ingestSocket(_ decoded: Decoded<LiveSocketServerFrame>) -> MachineEvent {
        var actions: [ClientAction] = []
        var resubscribe: [String] = []
        var diagnostics: [String] = []
        var materializationChanges: [String] = []
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
            materializationChanges.append(
                contentsOf: event.materializationChanges
            )
            diagnostics.append("durable_bytes: undecodable durable payload; forced connection-wide resync")
        case .authError(let code, let reason, let disposition):
            phase = .terminalAuth
            actions.append(.surfaceTerminalAuth)
            diagnostics.append("terminal auth loss: \(code) (\(reason), \(disposition))")
        case .pong, .senderNonce, .ephemeralAck, .ephemeralError, .ephemeral:
            break // control traffic; no durable-state obligation here
        }
        return MachineEvent(
            actions: actions,
            resubscribe: resubscribe,
            diagnostics: diagnostics,
            materializationChanges: materializationChanges
        )
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
        var acknowledgements: [String] = []
        var materializationChanges: [String] = []
        var sawMalformed = false
        var deliveredRemainder = false
        for item in items {
            guard let envelope = RealtimeEnvelope.from(item) else {
                sawMalformed = true
                let event = undecodablePostCut(context: "malformed drain item")
                merge(event, into: &actions, &resubscribe, &diagnostics)
                materializationChanges.append(
                    contentsOf: event.materializationChanges
                )
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
                    materializationChanges.append(
                        contentsOf: event.materializationChanges
                    )
                    continue
                }
                let event = ingestFrame(inner, postOwnershipCut: true)
                acknowledgements.append(contentsOf: event.acknowledgements)
                materializationChanges.append(
                    contentsOf: event.materializationChanges
                )
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
        // @ref LLP 0095#43-the-poll-lane-analogue-of-fact-2b--symmetric — post-cut malformed drain data finishes in the connection-wide resync equivalence class.
        if sawMalformed {
            // The remainder is still decoded and dispatched so diagnostics,
            // invalidation obligations, and other non-state work are not
            // silently dropped. But no later item in the already-consumed
            // batch can repair the unattributable loss: finish in the same
            // connection-wide resync equivalence class.
            let finalResync = forceConnectionWideResync()
            actions.append(contentsOf: finalResync.actions)
            resubscribe.append(contentsOf: finalResync.resubscribe)
            materializationChanges.append(
                contentsOf: finalResync.materializationChanges
            )
        }
        return MachineEvent(
            actions: dedupe(actions),
            resubscribe: resubscribe,
            diagnostics: diagnostics,
            acknowledgements: acknowledgements,
            materializationChanges: Array(Set(materializationChanges))
        )
    }

    // MARK: shared transitions

    /// The forced-resync equivalence class (LLP 0095 §4.2): every durable
    /// subscription re-enters fresh snapshot-with-subscribe and retained
    /// ephemeral overlays clear.
    public func forceConnectionWideResync() -> MachineEvent {
        var resubscribe: [String] = []
        for (id, entry) in subscriptions
        where entry.state != .released && entry.state != .terminalDeleted {
            subscriptions[id]?.state = .resyncPending
            resubscribe.append(id)
        }
        retainedOverlaysCleared = true
        return MachineEvent(
            actions: [.resubscribeAll, .clearRetainedOverlays],
            resubscribe: resubscribe,
            diagnostics: [],
            materializationChanges: resubscribe
        )
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
        switch entry.state {
        case .live(let held):
            return version > held
        case .pending, .resyncPending:
            return version >= (entry.dataVersionHighWater ?? 0)
        case .terminalDeleted, .dropped, .released:
            return false
        }
    }

    private func invalidationCustodyProblem(
        _ obligation: AuthorizationInvalidationObligation,
        entry: SubscriptionEntry
    ) -> String? {
        guard let heldScope = entry.authorizationScope,
              heldScope == obligation.scopeId
        else {
            return "authorization invalidation scope does not equal the held subscription scope"
        }
        if let heldNamespace = entry.authorizationNamespace,
           heldNamespace != obligation.namespace {
            return "authorization invalidation namespace does not equal the held materialization namespace"
        }
        guard let authorization = obligation.authorization else {
            return "authorization invalidation has no valid authorization witness"
        }
        if let held = entry.acceptedAuthorization {
            guard held.incarnation == authorization.incarnation,
                  authorization.epoch >= held.epoch
            else {
                return "authorization invalidation regressed the authenticated authorization expectation"
            }
        }
        guard obligation.versionStream != nil,
              obligation.minimumCommitVersion != nil
        else {
            return "subscription authorization invalidation omitted its data stream/floor"
        }
        if let heldStream = entry.authorizationVersionStream,
           heldStream != obligation.versionStream {
            return "authorization invalidation names a foreign data version stream"
        }
        if let owner = entry.authorizationOwnerContinuityId,
           owner != obligation.ownerContinuityId {
            return "authorization invalidation names a foreign owner continuity"
        }
        if let connection = authorizationInvalidationConnection {
            guard obligation.protocolVersion == connection.protocolVersion,
                  obligation.issuerId == connection.issuerId,
                  obligation.connectionGeneration
                    == connection.connectionGeneration,
                  authorization == connection.authorization
            else {
                return "authorization invalidation is outside the authenticated connection expectation"
            }
            if obligation.versionStream != connection.versionStream {
                return "authorization invalidation is outside the authenticated connection data stream"
            }
        }
        return nil
    }

    private func quarantineInvalidation(
        subscriptionId: String,
        entry: SubscriptionEntry,
        diagnostic: String,
        surfaceProtocolDiagnostic: Bool,
        ignoreFrame: Bool = false
    ) -> MachineEvent {
        var entry = entry
        entry.rows.removeAll()
        entry.rowOrder.removeAll()
        entry.state = .resyncPending
        subscriptions[subscriptionId] = entry
        var actions: [ClientAction] = [.quarantineRows]
        if surfaceProtocolDiagnostic {
            actions.append(.surfaceProtocolDiagnostic)
        }
        if ignoreFrame {
            actions.append(.ignoreFrame)
        }
        return MachineEvent(
            actions: actions,
            resubscribe: [],
            diagnostics: [diagnostic],
            materializationChanges: [subscriptionId]
        )
    }

    private func terminalReuseDiagnostic(
        _ subscriptionId: String
    ) -> MachineEvent {
        MachineEvent(
            actions: [.surfaceProtocolDiagnostic, .ignoreFrame],
            resubscribe: [],
            diagnostics: [
                "ordinary live frame attempted to resurrect terminal-deleted subscription \(subscriptionId)",
            ]
        )
    }

    private func authorizationQuarantineDiagnostic(
        _ subscriptionId: String
    ) -> MachineEvent {
        MachineEvent(
            actions: [.surfaceProtocolDiagnostic, .ignoreFrame],
            resubscribe: [],
            diagnostics: [
                "ordinary live frame cannot release authorization quarantine for \(subscriptionId)",
            ]
        )
    }

    private func protocolInvalidationDiagnostic(
        _ diagnostic: String
    ) -> MachineEvent {
        MachineEvent(
            actions: [.surfaceProtocolDiagnostic, .ignoreFrame],
            resubscribe: [],
            diagnostics: [diagnostic]
        )
    }

    public func hasTerminalRetiredNamespace(_ namespace: JSONValue) -> Bool {
        subscriptions.values.contains {
            $0.state == .terminalDeleted
                && $0.authorizationNamespace == namespace
        }
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
