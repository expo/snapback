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
    // Format-v3 additions (LLP 0095 §1.5). `retry_unchanged` and
    // `replay_queued_mutations` are forbidden-only anti-obligations: they
    // deliberately have no case here because a conformant client never
    // emits them.
    case surfaceCapabilityDiagnostic = "surface_capability_diagnostic"
    case establishLiveSocket = "establish_live_socket"
    case sendPing = "send_ping"
    case forceSocketLoss = "force_socket_loss"
    case attemptReconnect = "attempt_reconnect"
    case deleteLocalDurableAuthority = "delete_local_durable_authority"
    case settleClientMutation = "settle_client_mutation"
    case discardDuplicateSettlement = "discard_duplicate_settlement"
    case suspendPredecessorQueue = "suspend_predecessor_queue"
    case fenceRetainedRows = "fence_retained_rows"
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

/// The client's replayable queued-mutation state (LLP 0096 §2.3): retained
/// under the exact authority instance that accepted its entries.
public struct ReplayQueueState: Equatable, Sendable {
    public var authorityInstance: String
    public var pendingClientMutationIds: [String]
    public var suspended: Bool
}

/// An authorized retained read held under a signed lease (LLP 0059 via
/// LLP 0096 §2.4): retention exists only while the exact lease is current.
public struct RetainedReadEntry: Sendable {
    public var queryKey: String
    public var queryInstanceId: UInt64
    public var rows: [JSONValue]
    public var leaseExpiresAtServerMs: UInt64
    public var fenced: Bool
}

/// The client's standing recovery obligations while `RECOVERING`
/// (T-RECONNECT): bounded-backoff reconnect, then per-subscription fresh
/// subscribe. An established predecessor re-enters with `supersedes`; a
/// never-established (in-flight at loss) subscription re-enters with no
/// supersession assumption (LLP 0095 §1.4 T-LOSS).
public struct RecoveryPlan: Sendable {
    public var actions: [ClientAction]
    public var supersession: [String: String]
}

final class ClientStateMachine {
    static let historyLimit = 1_024

    public private(set) var phase: ConnectionPhase = .idle
    public private(set) var subscriptions: [String: SubscriptionEntry] = [:]
    /// Whether retained ephemeral overlays exist; the connection-wide
    /// clear-retained transition blanks them (T-OVERFLOW / T-DB / T-DB-P).
    public private(set) var retainedOverlaysCleared = false
    public private(set) var authorizationInvalidationConnection:
        AuthorizationInvalidationConnection?
    /// Set by a `durableDelete` terminal authority disposition: local durable
    /// authority state has been deleted (`LiveAuthorityDisposition`,
    /// `crates/snapback/src/live_wire.rs`).
    public private(set) var localDurableAuthorityDeleted = false
    /// Settled client mutations by `clientMutationId`: the durable ordered
    /// queue redelivers idempotently (LLP 0043), so a settlement applies to
    /// the client's queue entry exactly once.
    public private(set) var clientMutationSettlements: [String: UInt64] = [:]
    private var clientMutationSettlementOrder: [String] = []
    public private(set) var replayQueue: ReplayQueueState?
    public private(set) var retainedReads: [String: RetainedReadEntry] = [:]
    /// An ACK token is bound to one exact committed ticket. Retaining that
    /// binding prevents a later scope or revision from reusing the token.
    private var appliedAuthorizationInvalidationsByAckToken:
        [String: AppliedAuthorizationInvalidation] = [:]
    private var appliedAuthorizationInvalidationAckTokenOrder: [String] = []
    public private(set) var lastSnapshotDiagnostics: [String] = []

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
    /// T-GRANT-LOSS (LLP 0095 §1.4/§4.4): a refused grant's server state —
    /// subscriptions, outbox, retained continuity — is gone. Recovery
    /// re-opens the connection and re-establishes EVERY subscription;
    /// retained overlays are void. Grant-refresh-only recovery would
    /// resurrect the fake-healthy-handle defect class.
    @discardableResult
    public func noteGrantLost() -> MachineEvent {
        phase = .grantLost
        var changed: [String] = []
        for (id, entry) in subscriptions
        where entry.state != .released && entry.state != .terminalDeleted {
            subscriptions[id]?.state = .resyncPending
            changed.append(id)
        }
        retainedOverlaysCleared = true
        return MachineEvent(
            actions: [
                .reopenConnection, .resubscribeAll, .clearRetainedOverlays,
            ],
            resubscribe: changed,
            diagnostics: [],
            materializationChanges: changed
        )
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

    @discardableResult
    public func registerPending(
        subscriptionId: String,
        function: String,
        args: JSONValue = .null,
        authorizationNamespace: JSONValue? = nil,
        authorizationScope: JSONValue? = nil,
        acceptedAuthorization: AuthorizationVersion? = nil,
        authorizationVersionStream: String? = nil
    ) -> Bool {
        lastSnapshotDiagnostics = []
        // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — terminal retirement is one-way for the exact materialization instance.
        guard subscriptions[subscriptionId]?.state != .terminalDeleted else {
            return false
        }
        subscriptions[subscriptionId] = SubscriptionEntry(
            function: function,
            state: .pending,
            args: args,
            authorizationNamespace: authorizationNamespace,
            authorizationScope: authorizationScope,
            acceptedAuthorization: acceptedAuthorization,
            authorizationVersionStream: authorizationVersionStream
        )
        return true
    }

    func removeSubscription(id: String) {
        guard subscriptions[id]?.state != .terminalDeleted else { return }
        subscriptions.removeValue(forKey: id)
        pruneAuthorizationInvalidationAckTokens(subscriptionId: id)
    }

    /// Snapshot-with-subscribe (LLP 0034 §1): the subscribe response carries
    /// the authoritative snapshot; no prime race.
    @discardableResult
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
    ) -> Bool {
        // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — terminal retirement is one-way for the exact materialization instance.
        guard subscriptions[subscriptionId]?.state != .terminalDeleted else {
            return false
        }
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
        let decodedRows = decodeSnapshotRows(
            snapshot.rows,
            subscriptionId: subscriptionId
        )
        lastSnapshotDiagnostics = decodedRows.diagnostics
        entry.rows = decodedRows.rows
        entry.rowOrder = decodedRows.order
        subscriptions[subscriptionId] = entry
        return true
    }

    private func decodeSnapshotRows(
        _ rows: [JSONValue],
        subscriptionId: String
    ) -> (
        rows: [String: JSONValue],
        order: [String],
        diagnostics: [String]
    ) {
        var decoded: [String: JSONValue] = [:]
        var order: [String] = []
        var diagnostics: [String] = []
        for (index, row) in rows.enumerated() {
            // `_id` is wire row identity. An app field named `id` is ordinary
            // data and may collide across rows without changing membership.
            guard let id = row["_id"]?.stringValue else {
                diagnostics.append(
                    "undecodable snapshot row \(index) for \(subscriptionId): missing string _id"
                )
                continue
            }
            decoded[id] = row
            order.append(id)
        }
        return (decoded, order, diagnostics)
    }

    /// T-UNSUB: explicit release, the only normal demand-release path.
    public func noteReleased(subscriptionId: String) {
        guard subscriptions[subscriptionId]?.state != .terminalDeleted else {
            return
        }
        subscriptions[subscriptionId]?.state = .released
        pruneAuthorizationInvalidationAckTokens(
            subscriptionId: subscriptionId
        )
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
        case .liveReplace(let subscriptionId, let function, let version, let rows, _, _):
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
            if !lastSnapshotDiagnostics.isEmpty {
                actions.append(.surfaceDecodeDiagnostic)
                diagnostics.append(contentsOf: lastSnapshotDiagnostics)
            }
            actions.append(.replaceRows)
        case .liveDelta(let subscriptionId, let function, let version, let ops, _, _):
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
        case .currentAsOf(let subscriptionId, _, let version, _, _):
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
        case .resyncRequired(let subscriptionId, _, let clearRetained, _, _, _):
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
        case .authorizationInvalidation(let obligation, let snapshot, let resolution, _):
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
               scopedEntry.appliedAuthorizationInvalidation
                == AppliedAuthorizationInvalidation(
                    obligation: obligation.raw,
                    resolution: resolution.raw
                ),
               !(scopedEntry.state == .resyncPending
                    && scopedEntry.pendingAuthorizationObligation
                        == obligation.raw) {
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

            // Resolution corruption cannot prevent a valid newer obligation
            // from advancing its high-water and quarantining the rows. Token
            // validation deliberately follows obligation admission.
            if let resolution,
               let accepted = appliedAuthorizationInvalidationsByAckToken[
                resolution.ackToken
               ],
               accepted != AppliedAuthorizationInvalidation(
                obligation: obligation.raw,
                resolution: resolution.raw
               ) {
                return quarantineInvalidation(
                    subscriptionId: scopeSubscriptionId,
                    entry: scopedEntry,
                    diagnostic:
                        "authorization invalidation reused an accepted ACK token with changed ticket fields",
                    surfaceProtocolDiagnostic: true,
                    ignoreFrame: true
                )
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
                let applied = AppliedAuthorizationInvalidation(
                    obligation: obligation.raw,
                    resolution: resolution.raw
                )
                scopedEntry.appliedAuthorizationInvalidation = applied
                subscriptions[scopeSubscriptionId] = scopedEntry
                rememberAuthorizationInvalidation(
                    applied,
                    ackToken: resolution.ackToken
                )
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
                if !lastSnapshotDiagnostics.isEmpty {
                    actions.append(.surfaceDecodeDiagnostic)
                    diagnostics.append(contentsOf: lastSnapshotDiagnostics)
                }
                subscriptions[scopeSubscriptionId]?
                    .pendingAuthorizationObligation = nil
                let applied = AppliedAuthorizationInvalidation(
                    obligation: obligation.raw,
                    resolution: resolution.raw
                )
                subscriptions[scopeSubscriptionId]?
                    .appliedAuthorizationInvalidation = applied
                rememberAuthorizationInvalidation(
                    applied,
                    ackToken: resolution.ackToken
                )
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
            var event = noteTerminalAuth(
                code: code,
                reason: reason,
                disposition: disposition
            )
            if decoded.hadUnknownFields {
                event.actions.insert(.ignoreUnknownFields, at: 0)
            }
            return event
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

    // @ref LLP 0096#22-authlive--auth-scoped-live--invalidation-acknowledge — acknowledgement refusal retains quarantine; stale is never discharge evidence.
    /// An acknowledgement refusal or `outcome: "stale"` is not release
    /// evidence. Reinstall the exact applied obligation as pending and blank
    /// its materialization before surfacing the refusal. A later level-
    /// triggered redelivery may reapply the exact snapshot and ACK it again.
    public func noteAuthorizationAcknowledgementUndischarged(
        ackToken: String,
        diagnostic: String
    ) -> MachineEvent {
        guard let applied =
                appliedAuthorizationInvalidationsByAckToken[ackToken],
              let subscriptionId =
                applied.obligation["scopeId"]?["subscriptionId"]?.stringValue
        else {
            return MachineEvent(
                actions: [.surfaceProtocolDiagnostic],
                resubscribe: [],
                diagnostics: [
                    "\(diagnostic); no local materialization owns ACK token \(ackToken)",
                ]
            )
        }
        guard var entry = subscriptions[subscriptionId] else {
            return MachineEvent(
                actions: [.surfaceProtocolDiagnostic],
                resubscribe: [],
                diagnostics: [diagnostic]
            )
        }
        if entry.state == .terminalDeleted {
            // The destructive fence is already the safest terminal state.
            return MachineEvent(
                actions: [.surfaceProtocolDiagnostic],
                resubscribe: [],
                diagnostics: [diagnostic]
            )
        }
        let appliedRevision =
            applied.obligation["revision"]?.uint64Value ?? 0
        let pendingRevision =
            entry.pendingAuthorizationObligation?["revision"]?.uint64Value
        let observedRevision =
            entry.invalidationRevisionHighWater ?? 0
        let newerPending =
            pendingRevision.map { $0 > appliedRevision } ?? false
        if observedRevision > appliedRevision,
           !newerPending {
            // A late failure for an older ACK cannot roll back a newer
            // admitted resolution. The newer revision owns row state.
            return MachineEvent(
                actions: [.surfaceProtocolDiagnostic],
                resubscribe: [],
                diagnostics: [diagnostic]
            )
        }
        entry.rows.removeAll()
        entry.rowOrder.removeAll()
        entry.state = .resyncPending
        if !newerPending {
            entry.pendingAuthorizationObligation = applied.obligation
        }
        subscriptions[subscriptionId] = entry
        return MachineEvent(
            actions: [.quarantineRows, .surfaceProtocolDiagnostic],
            resubscribe: [],
            diagnostics: [diagnostic],
            materializationChanges: [subscriptionId]
        )
    }

    /// Once a subscribe response proves that its predecessor was retired, a
    /// later malformed successor cannot leave that predecessor readable. Keep
    /// the desired subscription spec for a retry, but blank and drop the
    /// extinct server scope.
    public func noteSupersededPredecessorDisposed(
        subscriptionId: String,
        diagnostic: String
    ) -> MachineEvent {
        guard var entry = subscriptions[subscriptionId],
              entry.state != .released,
              entry.state != .terminalDeleted
        else {
            return MachineEvent(
                actions: [.surfaceProtocolDiagnostic],
                resubscribe: [],
                diagnostics: [diagnostic]
            )
        }
        entry.rows.removeAll()
        entry.rowOrder.removeAll()
        entry.state = .dropped
        subscriptions[subscriptionId] = entry
        return MachineEvent(
            actions: [.quarantineRows, .surfaceProtocolDiagnostic],
            resubscribe: [],
            diagnostics: [diagnostic],
            materializationChanges: [subscriptionId]
        )
    }

    // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — substitute resync inherits the complete pending witness and disposition.
    /// LLP 0053 requires a substitute resync to inherit the complete pending
    /// authorization witness and maximum disposition. Scope identity changes
    /// on the fresh subscribe, but the authorization/data/retry evidence may
    /// not be weakened or silently forgotten.
    public func successorInvalidationInheritanceProblem(
        predecessorSubscriptionId: String,
        successor: AuthorizationInvalidationObligation?
    ) -> String? {
        guard let predecessor = subscriptions[predecessorSubscriptionId]?
            .pendingAuthorizationObligation
        else { return nil }
        guard let successor else {
            return "successor subscribe omitted the predecessor's pending authorization invalidation"
        }
        guard predecessor["witness"]?["authorization"]
                == successor.witness["authorization"]
        else {
            return "successor subscribe changed the pending authorization witness"
        }
        let predecessorData = predecessor["witness"]?["data"]
        if let predecessorData, predecessorData != .null {
            guard let successorData = successor.witness["data"],
                  successorData != .null,
                  predecessorData["versionStream"]
                    == successorData["versionStream"],
                  let predecessorFloor =
                    predecessorData["minCommitVersion"]?.uint64Value,
                  let successorFloor =
                    successorData["minCommitVersion"]?.uint64Value,
                  successorFloor >= predecessorFloor
            else {
                return "successor subscribe weakened the pending data witness"
            }
        }
        let rank = ["retain": 0, "quarantine": 1, "delete": 2]
        guard let predecessorDisposition =
                predecessor["maxDisposition"]?.stringValue,
              let predecessorRank = rank[predecessorDisposition],
              let successorRank = rank[successor.maxDisposition],
              successorRank >= predecessorRank
        else {
            return "successor subscribe weakened the pending disposition"
        }
        if let predecessorEpisode =
            predecessor["retryEpisodeId"]?.stringValue,
           successor.retryEpisodeId != predecessorEpisode {
            return "successor subscribe changed the pending retry episode"
        }
        return nil
    }

    // @ref LLP 0059#typed-terminal-auth-error — carrier ends only the presented credential (durable authority survives) while durableDelete compare-and-deletes local durable authority state; neither is reconnectable with the presented credential.
    /// Terminal authority loss (T-AUTH-TERM): the connection enters
    /// `TERMINAL_AUTH` and is never reconnectable with the presented
    /// credential. The `authorityDisposition` axis is independent of the
    /// diagnostic reason: `carrier` retains local durable authority state (a
    /// fresh credential may open a fresh connection); `durableDelete`
    /// additionally deletes matching local durable authority state.
    /// Subscription materializations do not transition here — the terminal
    /// connection phase already fences every use of this connection
    /// (fixtures `auth.live.terminal_auth_carrier_disposition` /
    /// `auth.live.terminal_auth_durable_delete_disposition`).
    @discardableResult
    public func noteTerminalAuth(
        code: String,
        reason: String,
        disposition: String
    ) -> MachineEvent {
        phase = .terminalAuth
        let durableDelete = disposition == "durableDelete"
        var actions: [ClientAction] = [.surfaceTerminalAuth]
        if durableDelete {
            localDurableAuthorityDeleted = true
            authorizationInvalidationConnection = nil
            appliedAuthorizationInvalidationsByAckToken = [:]
            appliedAuthorizationInvalidationAckTokenOrder = []
            actions.append(.deleteLocalDurableAuthority)
        }
        let recognized = ["carrier", "durableDelete"].contains(disposition)
        let effectiveDisposition = durableDelete ? "durableDelete" : "carrier"
        var diagnostics = [
            "terminal auth loss: \(code) (\(reason), \(effectiveDisposition))",
        ]
        let recognizedCodes = [
            "SNAPBACK_AUTH_SESSION_EXPIRED",
            "SNAPBACK_AUTH_STREAM_RESET",
            "SNAPBACK_AUTH_MODE_PENDING",
            "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
        ]
        let recognizedReasons = [
            "expired", "revoked", "reset", "restore", "downgrade",
            "mode_transition",
        ]
        if !recognizedCodes.contains(code) {
            diagnostics.append(
                "unrecognized terminal auth code \(code); classified fail-closed"
            )
        }
        if !recognizedReasons.contains(reason) {
            diagnostics.append(
                "unrecognized terminal auth reason \(reason); classified fail-closed"
            )
        }
        if !recognized {
            diagnostics.append(
                "unrecognized terminal authority disposition \(disposition); classified as carrier"
            )
        }
        return MachineEvent(
            actions: actions,
            resubscribe: [],
            diagnostics: diagnostics
        )
    }

    // MARK: format-v3 lifecycle surface (requests, replay queue, leases)

    /// The refusal codes that classify as a structured capability diagnostic
    /// (LLP 0064-style): the repair is changing the offer/preconditions,
    /// never blind unchanged retry.
    private static let capabilityRefusalCodes: Set<String> = [
        "SNAPBACK_WIRE_VERSION_UNSUPPORTED",
        "SNAPBACK_WIRE_VERSION_REQUIRED",
        "SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED",
        "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
        "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED",
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
        "SNAPBACK_CONNECTION_SOCKET_REQUIRED",
    ]

    // @ref LLP 0095#21-artifact-and-format — client_to_server judgment: the client's obligations on processing the server's answer to its own request.
    /// Process the server's answer (refusal or acceptance) to a request this
    /// client sent. This is the client half the format-v3 `client_to_server`
    /// fixtures judge.
    public func processRequestAnswer(
        method: String,
        route: String,
        body: JSONValue?,
        refusalCode: String?,
        responseStatus: UInt64?
    ) -> MachineEvent {
        if let refusalCode {
            if refusalCode == "SNAPBACK_CONNECTION_TOKEN_INVALID" {
                var event = noteGrantLost()
                event.diagnostics.append(
                    "\(refusalCode) on \(method) \(route): re-open and re-establish everything (T-GRANT-LOSS)"
                )
                return event
            }
            if Self.capabilityRefusalCodes.contains(refusalCode) {
                var actions: [ClientAction] = [.surfaceCapabilityDiagnostic]
                if refusalCode == "SNAPBACK_CONNECTION_SOCKET_REQUIRED" {
                    // T-SUB on the hosted arm: socketless HTTP cannot arm
                    // hosted demand; the repair is establishing the managed
                    // socket first (LLP 0090).
                    actions.append(.establishLiveSocket)
                }
                if refusalCode == "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                   route.hasSuffix("/authorization-invalidation/acknowledge") {
                    // The acknowledge routes consult the OPEN-TIME binding
                    // (LLP 0096 §2.2): the per-request header cannot
                    // substitute, so discharge requires re-opening a
                    // correctly negotiated connection.
                    actions.append(.reopenConnection)
                }
                return MachineEvent(
                    actions: actions,
                    resubscribe: [],
                    diagnostics: [
                        "\(refusalCode) refused \(method) \(route); unchanged retry cannot succeed",
                    ]
                )
            }
            return MachineEvent(
                actions: [.surfaceProtocolDiagnostic],
                resubscribe: [],
                diagnostics: [
                    "unclassified refusal \(refusalCode) for \(method) \(route)",
                ]
            )
        }
        if let responseStatus, (200..<300).contains(responseStatus),
           let clientMutationId = body?["clientMutationId"]?.stringValue {
            return noteMutationSettled(clientMutationId: clientMutationId)
        }
        return MachineEvent(actions: [], resubscribe: [], diagnostics: [])
    }

    /// LLP 0043 settlement idempotence: the durable ordered queue redelivers
    /// under the retained `clientMutationId`; the client resolves its queue
    /// entry exactly once and discards duplicate settlements.
    @discardableResult
    public func noteMutationSettled(clientMutationId: String) -> MachineEvent {
        if clientMutationSettlements[clientMutationId] != nil {
            return MachineEvent(
                actions: [.discardDuplicateSettlement],
                resubscribe: [],
                diagnostics: [
                    "duplicate settlement for \(clientMutationId) discarded; queue entry already resolved",
                ]
            )
        }
        clientMutationSettlements[clientMutationId] = 1
        clientMutationSettlementOrder.append(clientMutationId)
        if clientMutationSettlementOrder.count > Self.historyLimit {
            let evicted = clientMutationSettlementOrder.removeFirst()
            clientMutationSettlements.removeValue(forKey: evicted)
        }
        return MachineEvent(
            actions: [.settleClientMutation],
            resubscribe: [],
            diagnostics: []
        )
    }

    public func seedReplayQueue(
        authorityInstance: String,
        pendingClientMutationIds: [String]
    ) {
        replayQueue = ReplayQueueState(
            authorityInstance: authorityInstance,
            pendingClientMutationIds: pendingClientMutationIds,
            suspended: false
        )
    }

    // @ref LLP 0096#23-authreplay--authority-descriptors--queued-replay — a queue retained under a predecessor authority instance suspends and is never replayed under successor authority.
    /// LLP 0096 §2.3: on authority-instance mismatch the predecessor's
    /// retained replay queue suspends. Resumption requires re-establishing
    /// the original authority or explicit user-mediated abandonment; silent
    /// replay under the new principal is the defect class this fences.
    @discardableResult
    public func noteAuthorityInstanceChanged(to successor: String) -> MachineEvent {
        guard var queue = replayQueue,
              queue.authorityInstance != successor,
              !queue.suspended
        else {
            return MachineEvent(actions: [], resubscribe: [], diagnostics: [])
        }
        queue.suspended = true
        replayQueue = queue
        return MachineEvent(
            actions: [.suspendPredecessorQueue],
            resubscribe: [],
            diagnostics: [
                "replay queue retained under predecessor authority \(queue.authorityInstance) suspended; never replayed under \(successor)",
            ]
        )
    }

    public func seedRetainedRead(
        queryKey: String,
        queryInstanceId: UInt64,
        rows: [JSONValue],
        leaseExpiresAtServerMs: UInt64
    ) {
        retainedReads[queryKey] = RetainedReadEntry(
            queryKey: queryKey,
            queryInstanceId: queryInstanceId,
            rows: rows,
            leaseExpiresAtServerMs: leaseExpiresAtServerMs,
            fenced: false
        )
    }

    /// The earliest virtual instant at which an unfenced retained read is
    /// past its lease (`expiresAtServerMs + 1`).
    public var nextRetainedReadFenceDeadlineMs: UInt64? {
        retainedReads.values
            .filter { !$0.fenced }
            .map { $0.leaseExpiresAtServerMs + 1 }
            .min()
    }

    /// LLP 0059's transition table (cited by LLP 0096 §2.4): retention
    /// exists only under a current exact signed lease. At expiry — with no
    /// wire event — the retained material is fenced; rows are unreadable at
    /// any instant past `expiresAtServerMs`.
    @discardableResult
    public func fenceExpiredRetainedReads(nowServerMs: UInt64) -> MachineEvent {
        var fencedKeys: [String] = []
        for (key, var entry) in retainedReads
        where !entry.fenced && nowServerMs > entry.leaseExpiresAtServerMs {
            entry.rows.removeAll()
            entry.fenced = true
            retainedReads[key] = entry
            fencedKeys.append(key)
        }
        guard !fencedKeys.isEmpty else {
            return MachineEvent(actions: [], resubscribe: [], diagnostics: [])
        }
        return MachineEvent(
            actions: [.fenceRetainedRows],
            resubscribe: [],
            diagnostics: fencedKeys.sorted().map {
                "authorized lease expired for \($0); retained rows fenced"
            }
        )
    }

    /// The standing recovery obligations while `RECOVERING`, including the
    /// per-subscription supersession classification T-RECONNECT requires.
    public func standingRecoveryPlan() -> RecoveryPlan? {
        guard phase == .recovering else { return nil }
        var supersession: [String: String] = [:]
        for (id, entry) in subscriptions where entry.state == .dropped {
            // A subscription that never established (still in flight at the
            // loss) resolves DROPPED without a supersession assumption; an
            // established one re-enters with `supersedes`.
            supersession[id] = entry.dataVersionHighWater != nil
                ? "fresh_subscribe_with_supersedes"
                : "fresh_subscribe_without_supersession_assumption"
        }
        var actions: [ClientAction] = [.attemptReconnect]
        if !supersession.isEmpty { actions.append(.resubscribeAll) }
        return RecoveryPlan(actions: actions, supersession: supersession)
    }

    var appliedAuthorizationInvalidationCount: Int {
        appliedAuthorizationInvalidationsByAckToken.count
    }

    private func rememberAuthorizationInvalidation(
        _ invalidation: AppliedAuthorizationInvalidation,
        ackToken: String
    ) {
        if appliedAuthorizationInvalidationsByAckToken[ackToken] == nil {
            appliedAuthorizationInvalidationAckTokenOrder.append(ackToken)
        }
        appliedAuthorizationInvalidationsByAckToken[ackToken] = invalidation
        if appliedAuthorizationInvalidationAckTokenOrder.count
            > Self.historyLimit {
            let evicted =
                appliedAuthorizationInvalidationAckTokenOrder.removeFirst()
            appliedAuthorizationInvalidationsByAckToken.removeValue(
                forKey: evicted
            )
        }
    }

    private func pruneAuthorizationInvalidationAckTokens(
        subscriptionId: String
    ) {
        let removed = Set(
            appliedAuthorizationInvalidationsByAckToken.compactMap {
                ackToken, invalidation in
                invalidation.obligation["scopeId"]?["subscriptionId"]?
                    .stringValue == subscriptionId ? ackToken : nil
            }
        )
        guard !removed.isEmpty else { return }
        for ackToken in removed {
            appliedAuthorizationInvalidationsByAckToken.removeValue(
                forKey: ackToken
            )
        }
        appliedAuthorizationInvalidationAckTokenOrder.removeAll {
            removed.contains($0)
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
