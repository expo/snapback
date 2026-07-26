import Foundation

// The wire families of LLP 0094 §0A/§0C, decoded tolerantly:
//  - `LiveEnvelope` (durable lane, snake_case, tag `kind`)
//  - `LiveSocketServerFrame` (socket control lane, camelCase, tag `kind`)
//  - `RealtimeEnvelope` (the lane-P drain wrapper, externally tagged)
// Casing is intentionally mixed by lane (LLP 0093 inventory, gotcha 1) and is
// reproduced as-is; unifying it would be a breaking change.

/// One `live_delta` op (`schemas/live.envelope.schema.json`,
/// `LiveDeltaWireOp`): `row` present for add/update, absent for remove.
public struct LiveDeltaOp: Equatable, Sendable {
    public enum Kind: String, Sendable {
        case add, update, remove
    }

    public var op: Kind
    public var id: String
    public var row: JSONValue?

    static func from(_ json: JSONValue) -> LiveDeltaOp? {
        guard let members = json.objectValue,
              let opName = members["op"]?.stringValue,
              let kind = Kind(rawValue: opName),
              let id = members["id"]?.stringValue
        else { return nil }
        return LiveDeltaOp(op: kind, id: id, row: members["row"])
    }
}

/// Decode result carrying the tolerance witness: whether the frame carried
/// members outside the family's current schema (ignored per LLP 0094 §0C.2,
/// surfaced so conformance fixtures can assert `ignore_unknown_fields`).
public struct Decoded<Value> {
    public var value: Value
    public var hadUnknownFields: Bool
}

/// The camelCase snapshot nested inside the otherwise snake_case
/// `authorization_invalidation` durable envelope.
public struct AuthorizationInvalidationSnapshot: Equatable, Sendable {
    public var subscriptionId: String
    public var function: String
    public var version: UInt64
    public var rows: [JSONValue]

    static func from(_ json: JSONValue) -> AuthorizationInvalidationSnapshot? {
        let required: Set<String> = ["subscriptionId", "function", "version", "rows"]
        guard let members = json.objectValue,
              Set(members.keys) == required,
              let subscriptionId = members["subscriptionId"]?.stringValue,
              !subscriptionId.isEmpty,
              let function = members["function"]?.stringValue,
              !function.isEmpty,
              let version = members["version"]?.uint64Value,
              let rows = members["rows"]?.arrayValue
        else { return nil }
        return AuthorizationInvalidationSnapshot(
            subscriptionId: subscriptionId,
            function: function,
            version: version,
            rows: rows
        )
    }
}

public struct AuthorizationVersion: Equatable, Sendable {
    public var incarnation: String
    public var epoch: UInt64

    static func from(_ json: JSONValue) -> AuthorizationVersion? {
        guard let members = json.objectValue,
              Set(members.keys) == Set(["incarnation", "epoch"]),
              let incarnation = members["incarnation"]?.stringValue,
              !incarnation.isEmpty,
              let epoch = members["epoch"]?.uint64Value
        else { return nil }
        return AuthorizationVersion(incarnation: incarnation, epoch: epoch)
    }

}

/// The authenticated connection expectation returned by `POST /connection/open`.
/// Invalidation frames are accepted only inside this issuer/generation and
/// authorization/data stream.
public struct AuthorizationInvalidationConnection: Equatable, Sendable {
    public var protocolVersion: UInt64
    public var issuerId: JSONValue
    public var connectionGeneration: UInt64
    public var authorization: AuthorizationVersion
    public var versionStream: String

    static func from(_ json: JSONValue) -> AuthorizationInvalidationConnection? {
        let required: Set<String> = [
            "protocolVersion", "issuerId", "connectionGeneration",
            "authorization", "versionStream",
        ]
        let optional: Set<String> = ["issuerRetirement"]
        guard let members = json.objectValue,
              required.isSubset(of: Set(members.keys)),
              Set(members.keys).isSubset(of: required.union(optional)),
              let protocolVersion = members["protocolVersion"]?.uint64Value,
              protocolVersion == 1,
              let issuerId = members["issuerId"],
              validIssuerId(issuerId),
              let connectionGeneration = members["connectionGeneration"]?.uint64Value,
              connectionGeneration > 0,
              let authorizationValue = members["authorization"],
              let authorization = AuthorizationVersion.from(authorizationValue),
              let versionStream = members["versionStream"]?.stringValue,
              !versionStream.isEmpty
        else { return nil }
        if let retirement = members["issuerRetirement"],
           retirement != .null,
           !validIssuerRetirement(retirement) {
            return nil
        }
        return AuthorizationInvalidationConnection(
            protocolVersion: protocolVersion,
            issuerId: issuerId,
            connectionGeneration: connectionGeneration,
            authorization: authorization,
            versionStream: versionStream
        )
    }
}

/// The post-commit ticket paired atomically with an authorization snapshot.
/// A client may acknowledge only after the matching snapshot has been applied.
public struct AuthorizationInvalidationResolution: Equatable, Sendable {
    public enum Kind: String, Sendable {
        case snapshot
        case terminalDelete
    }

    public var protocolVersion: UInt64
    public var kind: Kind
    public var scopeId: JSONValue
    public var revision: UInt64
    public var witness: JSONValue
    public var maxDisposition: String
    public var ackToken: String
    public var ownerContinuityId: String?
    public var raw: JSONValue

    static func from(_ json: JSONValue) -> AuthorizationInvalidationResolution? {
        let required: Set<String> = [
            "protocolVersion", "kind", "scopeId", "revision", "witness",
            "maxDisposition", "ackToken",
        ]
        let optional: Set<String> = ["ownerContinuityId"]
        guard let members = json.objectValue,
              required.isSubset(of: Set(members.keys)),
              Set(members.keys).isSubset(of: required.union(optional)),
              let protocolVersion = members["protocolVersion"]?.uint64Value,
              protocolVersion == 1,
              let kindName = members["kind"]?.stringValue,
              let kind = Kind(rawValue: kindName),
              let scopeId = members["scopeId"],
              validInvalidationScope(scopeId),
              let revision = members["revision"]?.uint64Value,
              revision > 0,
              let witness = members["witness"],
              validCompositeWitness(witness),
              let maxDisposition = members["maxDisposition"]?.stringValue,
              ["retain", "quarantine", "delete"].contains(maxDisposition),
              let ackToken = members["ackToken"]?.stringValue,
              !ackToken.isEmpty
        else { return nil }
        let ownerContinuityId = members["ownerContinuityId"]?.stringValue
        if scopeId["kind"]?.stringValue == "subscription",
           ownerContinuityId == nil {
            return nil
        }
        if let owner = members["ownerContinuityId"],
           owner != .null && ownerContinuityId == nil {
            return nil
        }
        return AuthorizationInvalidationResolution(
            protocolVersion: protocolVersion,
            kind: kind,
            scopeId: scopeId,
            revision: revision,
            witness: witness,
            maxDisposition: maxDisposition,
            ackToken: ackToken,
            ownerContinuityId: ownerContinuityId,
            raw: json
        )
    }
}

/// The level-triggered obligation paired with an invalidation resolution.
/// This type is deliberately closed: these members participate in custody
/// and equality, so silently ignoring an unknown member would be unsafe.
public struct AuthorizationInvalidationObligation: Equatable, Sendable {
    public var protocolVersion: UInt64
    public var scopeId: JSONValue
    public var revision: UInt64
    public var maxDisposition: String
    public var witness: JSONValue
    public var retryEpisodeId: String?
    public var ownerContinuityId: String?
    public var raw: JSONValue

    public var subscriptionId: String? {
        scopeId["subscriptionId"]?.stringValue
    }

    public var namespace: JSONValue? {
        scopeId["namespace"]
    }

    public var issuerId: JSONValue? {
        scopeId["issuerId"]
    }

    public var connectionGeneration: UInt64? {
        scopeId["connectionGeneration"]?.uint64Value
    }

    public var authorization: AuthorizationVersion? {
        witness["authorization"].flatMap(AuthorizationVersion.from)
    }

    public var versionStream: String? {
        guard let data = witness["data"], data != .null else { return nil }
        return data["versionStream"]?.stringValue
    }

    public var minimumCommitVersion: UInt64? {
        guard let data = witness["data"], data != .null else { return nil }
        return data["minCommitVersion"]?.uint64Value
    }

    static func from(_ json: JSONValue) -> AuthorizationInvalidationObligation? {
        let required: Set<String> = [
            "protocolVersion", "scopeId", "revision", "maxDisposition",
            "witness", "retryEpisodeId",
        ]
        let optional: Set<String> = ["ownerContinuityId"]
        guard let members = json.objectValue,
              required.isSubset(of: Set(members.keys)),
              Set(members.keys).isSubset(of: required.union(optional)),
              let protocolVersion = members["protocolVersion"]?.uint64Value,
              protocolVersion == 1,
              let scopeId = members["scopeId"],
              validInvalidationScope(scopeId),
              let revision = members["revision"]?.uint64Value,
              revision > 0,
              let maxDisposition = members["maxDisposition"]?.stringValue,
              ["retain", "quarantine", "delete"].contains(maxDisposition),
              let witness = members["witness"],
              validCompositeWitness(witness)
        else { return nil }
        let retryEpisodeId = members["retryEpisodeId"]?.stringValue
        if let retry = members["retryEpisodeId"],
           retry != .null && retryEpisodeId == nil {
            return nil
        }
        let ownerContinuityId = members["ownerContinuityId"]?.stringValue
        if scopeId["kind"]?.stringValue == "subscription",
           ownerContinuityId == nil {
            return nil
        }
        if let owner = members["ownerContinuityId"],
           owner != .null && ownerContinuityId == nil {
            return nil
        }
        return AuthorizationInvalidationObligation(
            protocolVersion: protocolVersion,
            scopeId: scopeId,
            revision: revision,
            maxDisposition: maxDisposition,
            witness: witness,
            retryEpisodeId: retryEpisodeId,
            ownerContinuityId: ownerContinuityId,
            raw: json
        )
    }

    func isSatisfied(by resolution: AuthorizationInvalidationResolution) -> Bool {
        guard protocolVersion == resolution.protocolVersion,
              scopeId == resolution.scopeId,
              revision == resolution.revision,
              maxDisposition == resolution.maxDisposition,
              ownerContinuityId == resolution.ownerContinuityId,
              witness["authorization"] == resolution.witness["authorization"]
        else { return false }
        guard let obligationData = witness["data"], obligationData != .null else {
            return true
        }
        guard let resolutionData = resolution.witness["data"],
              resolutionData != .null,
              obligationData["versionStream"] == resolutionData["versionStream"],
              let obligationFloor = obligationData["minCommitVersion"]?.uint64Value,
              let resolutionFloor = resolutionData["minCommitVersion"]?.uint64Value
        else { return false }
        return resolutionFloor >= obligationFloor
    }
}

public struct AuthorizationInvalidationProjection: Equatable, Sendable {
    public var obligation: AuthorizationInvalidationObligation
    public var resolution: AuthorizationInvalidationResolution?

    static func from(_ json: JSONValue) -> AuthorizationInvalidationProjection? {
        let required: Set<String> = ["obligation"]
        let optional: Set<String> = ["resolution"]
        guard let members = json.objectValue,
              required.isSubset(of: Set(members.keys)),
              Set(members.keys).isSubset(of: required.union(optional)),
              let obligationValue = members["obligation"],
              let obligation = AuthorizationInvalidationObligation.from(obligationValue)
        else { return nil }
        let resolutionValue = members["resolution"].flatMap { $0 == .null ? nil : $0 }
        let resolution = resolutionValue.flatMap(AuthorizationInvalidationResolution.from)
        if resolutionValue != nil && resolution == nil { return nil }
        return AuthorizationInvalidationProjection(
            obligation: obligation,
            resolution: resolution
        )
    }
}

private func validCompositeWitness(_ witness: JSONValue) -> Bool {
    guard let members = witness.objectValue,
          Set(members.keys) == Set(["authorization", "data"]),
          let authorization = members["authorization"]?.objectValue,
          Set(authorization.keys) == Set(["incarnation", "epoch"]),
          authorization["incarnation"]?.stringValue?.isEmpty == false,
          authorization["epoch"]?.uint64Value != nil
    else { return false }
    guard let data = members["data"] else { return false }
    if data == .null { return true }
    guard let dataMembers = data.objectValue,
          Set(dataMembers.keys) == Set(["versionStream", "minCommitVersion"]),
          dataMembers["versionStream"]?.stringValue?.isEmpty == false,
          dataMembers["minCommitVersion"]?.uint64Value != nil
    else { return false }
    return true
}

private func validInvalidationScope(_ scope: JSONValue) -> Bool {
    guard let members = scope.objectValue,
          let kind = members["kind"]?.stringValue
    else { return false }
    switch kind {
    case "subscription":
        let keys: Set<String> = [
            "kind", "issuerId", "namespace", "scopeSequence",
            "connectionGeneration", "subscriptionId",
        ]
        return Set(members.keys) == keys
            && validIssuerId(members["issuerId"])
            && validQueryNamespace(members["namespace"])
            && (members["scopeSequence"]?.uint64Value ?? 0) > 0
            && (members["connectionGeneration"]?.uint64Value ?? 0) > 0
            && members["subscriptionId"]?.stringValue?.isEmpty == false
    case "connection":
        let keys: Set<String> = ["kind", "issuerId", "connectionGeneration"]
        return Set(members.keys) == keys
            && validIssuerId(members["issuerId"])
            && (members["connectionGeneration"]?.uint64Value ?? 0) > 0
    case "clientQuery":
        return Set(members.keys) == Set(["kind", "namespace"])
            && validQueryNamespace(members["namespace"])
    default:
        return false
    }
}

private func validIssuerId(_ value: JSONValue?) -> Bool {
    guard let members = value?.objectValue,
          Set(members.keys) == Set([
              "authorizationIncarnation", "bootSequence", "bootNonce",
          ])
    else { return false }
    return members["authorizationIncarnation"]?.stringValue?.isEmpty == false
        && (members["bootSequence"]?.uint64Value ?? 0) > 0
        && members["bootNonce"]?.stringValue?.isEmpty == false
}

private func validIssuerRetirement(_ value: JSONValue) -> Bool {
    guard let members = value.objectValue,
          Set(members.keys) == Set([
              "currentIssuer", "retireThroughBootSequence",
              "authorizationExpectation", "mac",
          ]),
          let currentIssuer = members["currentIssuer"]?.objectValue,
          Set(currentIssuer.keys) == Set(["issuerId", "keyId", "mac"]),
          validIssuerId(currentIssuer["issuerId"]),
          currentIssuer["keyId"]?.stringValue?.isEmpty == false,
          currentIssuer["mac"]?.stringValue?.isEmpty == false,
          (members["retireThroughBootSequence"]?.uint64Value ?? 0) > 0,
          let authorization = members["authorizationExpectation"],
          AuthorizationVersion.from(authorization) != nil,
          members["mac"]?.stringValue?.isEmpty == false
    else { return false }
    return true
}

private func validQueryNamespace(_ value: JSONValue?) -> Bool {
    guard let members = value?.objectValue,
          Set(members.keys) == Set([
              "clientStoreId", "queryKey", "queryInstanceId",
          ])
    else { return false }
    return members["clientStoreId"]?.stringValue?.isEmpty == false
        && members["queryKey"]?.stringValue?.isEmpty == false
        && (members["queryInstanceId"]?.uint64Value ?? 0) > 0
}

/// The durable-lane fan-out envelope (`live.envelope.schema.json`).
public enum LiveEnvelope: Equatable, Sendable {
    case liveReplace(subscriptionId: String, function: String, version: UInt64, rows: [JSONValue], resume: JSONValue?)
    case liveDelta(subscriptionId: String, function: String, version: UInt64, ops: [LiveDeltaOp], resume: JSONValue?)
    case currentAsOf(subscriptionId: String, function: String, version: UInt64, resume: JSONValue)
    /// `reason` is deliberately an open string (LLP 0095 T-RESYNC): recovery
    /// is identical for every reason, known or not.
    case resyncRequired(subscriptionId: String?, reason: String, clearRetained: Bool, scope: String?, epoch: UInt64?)
    case authorizationInvalidation(
        obligation: AuthorizationInvalidationObligation,
        snapshot: AuthorizationInvalidationSnapshot?,
        resolution: AuthorizationInvalidationResolution?
    )

    public static let knownKinds: Set<String> = [
        "live_replace", "live_delta", "current_as_of", "resync_required",
        "authorization_invalidation",
    ]

    static let knownFields: [String: Set<String>] = [
        "live_replace": ["kind", "subscription_id", "function", "version", "rows", "resume"],
        "live_delta": ["kind", "subscription_id", "function", "version", "ops", "resume"],
        "current_as_of": ["kind", "subscription_id", "function", "version", "resume"],
        "resync_required": ["kind", "subscription_id", "reason", "clear_retained", "scope", "epoch"],
        "authorization_invalidation": ["kind", "obligation", "snapshot", "resolution"],
    ]

    /// Tolerant decode: returns nil only when the object is not a decodable
    /// instance of a *known* kind (missing required members). Unknown kinds
    /// are the caller's dispatch concern (`ServerFrame.decode`).
    public static func from(_ json: JSONValue) -> Decoded<LiveEnvelope>? {
        guard let members = json.objectValue, let kind = members["kind"]?.stringValue else { return nil }
        let extraFields = !Set(members.keys).subtracting(knownFields[kind] ?? []).isEmpty
        func nonNull(_ key: String) -> JSONValue? {
            guard let value = members[key], value != .null else { return nil }
            return value
        }
        switch kind {
        case "live_replace":
            guard let sub = members["subscription_id"]?.stringValue,
                  let function = members["function"]?.stringValue,
                  let version = members["version"]?.uint64Value,
                  let rows = members["rows"]?.arrayValue
            else { return nil }
            return Decoded(value: .liveReplace(subscriptionId: sub, function: function, version: version, rows: rows, resume: nonNull("resume")), hadUnknownFields: extraFields)
        case "live_delta":
            guard let sub = members["subscription_id"]?.stringValue,
                  let function = members["function"]?.stringValue,
                  let version = members["version"]?.uint64Value,
                  let rawOps = members["ops"]?.arrayValue
            else { return nil }
            var ops: [LiveDeltaOp] = []
            for rawOp in rawOps {
                guard let op = LiveDeltaOp.from(rawOp) else { return nil }
                ops.append(op)
            }
            return Decoded(value: .liveDelta(subscriptionId: sub, function: function, version: version, ops: ops, resume: nonNull("resume")), hadUnknownFields: extraFields)
        case "current_as_of":
            guard let sub = members["subscription_id"]?.stringValue,
                  let function = members["function"]?.stringValue,
                  let version = members["version"]?.uint64Value,
                  let resume = nonNull("resume")
            else { return nil }
            return Decoded(value: .currentAsOf(subscriptionId: sub, function: function, version: version, resume: resume), hadUnknownFields: extraFields)
        case "resync_required":
            guard let reason = members["reason"]?.stringValue,
                  let clearRetained = members["clear_retained"]?.boolValue
            else { return nil }
            return Decoded(
                value: .resyncRequired(
                    subscriptionId: nonNull("subscription_id")?.stringValue,
                    reason: reason,
                    clearRetained: clearRetained,
                    scope: nonNull("scope")?.stringValue,
                    epoch: nonNull("epoch")?.uint64Value
                ),
                hadUnknownFields: extraFields
            )
        case "authorization_invalidation":
            guard let rawObligation = members["obligation"],
                  let obligation = AuthorizationInvalidationObligation.from(rawObligation)
            else { return nil }
            let snapshotValue = nonNull("snapshot")
            let resolutionValue = nonNull("resolution")
            let snapshot = snapshotValue.flatMap(AuthorizationInvalidationSnapshot.from)
            let resolution = resolutionValue.flatMap(AuthorizationInvalidationResolution.from)
            // These nested types are closed and action-bearing. A present but
            // undecodable value is not an ignorable unknown-field extension.
            if snapshotValue != nil && snapshot == nil { return nil }
            if resolutionValue != nil && resolution == nil { return nil }
            return Decoded(
                value: .authorizationInvalidation(
                    obligation: obligation,
                    snapshot: snapshot,
                    resolution: resolution
                ),
                hadUnknownFields: extraFields
            )
        default:
            return nil
        }
    }
}

/// Socket control-lane frames (`live.socket-server.schema.json`, camelCase).
public enum LiveSocketServerFrame: Equatable, Sendable {
    case authError(code: String, reason: String, authorityDisposition: String)
    case pong(requestId: String?, serverTimeMs: UInt64)
    case ephemeralAck(requestId: String?, operation: String, body: JSONValue)
    case ephemeralError(requestId: String?, operation: String, diagnostic: JSONValue)
    case senderNonce(nonce: String)
    case ephemeral(message: JSONValue)
    /// A KNOWN kind with a REQUIRED recovery action (LLP 0095 T-DB): the
    /// payload's outbox lease was already released; ignoring it is
    /// non-conformant.
    case durableBytes(payload: [UInt8])

    public static let knownKinds: Set<String> = [
        "auth_error", "pong", "ephemeral_ack", "ephemeral_error",
        "sender_nonce", "ephemeral", "durable_bytes",
    ]

    static let knownFields: [String: Set<String>] = [
        "auth_error": ["kind", "code", "reason", "authorityDisposition"],
        "pong": ["kind", "requestId", "serverTimeMs"],
        // ephemeral_ack flattens its operation-specific result body alongside
        // the envelope members (`additionalProperties: true` in the schema),
        // so extra members are the *result*, not unknown fields.
        "ephemeral_error": ["kind", "requestId", "operation", "diagnostic"],
        "sender_nonce": ["kind", "nonce"],
        "ephemeral": ["kind", "message"],
        "durable_bytes": ["kind", "payload"],
    ]

    public static func from(_ json: JSONValue) -> Decoded<LiveSocketServerFrame>? {
        guard let members = json.objectValue, let kind = members["kind"]?.stringValue else { return nil }
        let extraFields: Bool
        if kind == "ephemeral_ack" {
            extraFields = false
        } else {
            extraFields = !Set(members.keys).subtracting(knownFields[kind] ?? []).isEmpty
        }
        func requestId() -> String? {
            guard let value = members["requestId"], value != .null else { return nil }
            return value.stringValue
        }
        switch kind {
        case "auth_error":
            guard let code = members["code"]?.stringValue,
                  let reason = members["reason"]?.stringValue,
                  let disposition = members["authorityDisposition"]?.stringValue
            else { return nil }
            return Decoded(value: .authError(code: code, reason: reason, authorityDisposition: disposition), hadUnknownFields: extraFields)
        case "pong":
            guard let serverTimeMs = members["serverTimeMs"]?.uint64Value else { return nil }
            return Decoded(value: .pong(requestId: requestId(), serverTimeMs: serverTimeMs), hadUnknownFields: extraFields)
        case "ephemeral_ack":
            guard let operation = members["operation"]?.stringValue else { return nil }
            return Decoded(value: .ephemeralAck(requestId: requestId(), operation: operation, body: json), hadUnknownFields: false)
        case "ephemeral_error":
            guard let operation = members["operation"]?.stringValue,
                  let diagnostic = members["diagnostic"]
            else { return nil }
            return Decoded(value: .ephemeralError(requestId: requestId(), operation: operation, diagnostic: diagnostic), hadUnknownFields: extraFields)
        case "sender_nonce":
            guard let nonce = members["nonce"]?.stringValue else { return nil }
            return Decoded(value: .senderNonce(nonce: nonce), hadUnknownFields: extraFields)
        case "ephemeral":
            guard let message = members["message"] else { return nil }
            return Decoded(value: .ephemeral(message: message), hadUnknownFields: extraFields)
        case "durable_bytes":
            guard let payload = members["payload"]?.byteArrayValue else { return nil }
            return Decoded(value: .durableBytes(payload: payload), hadUnknownFields: extraFields)
        default:
            return nil
        }
    }
}

/// One item of the lane-P drain batch (`realtime.envelope.schema.json`):
/// externally tagged `{"Durable":{"payload":[u8…]}}` / `{"Ephemeral":{…}}`.
/// Durable payloads arrive **wrapped** over the HTTP drain and **unwrapped**
/// over the socket (LLP 0093 gotcha 2); unwrapping is a lane-P obligation.
public enum RealtimeEnvelope: Equatable, Sendable {
    case durable(payload: [UInt8])
    case ephemeral(message: JSONValue)

    public static func from(_ json: JSONValue) -> RealtimeEnvelope? {
        guard let members = json.objectValue else { return nil }
        if let durable = members["Durable"] {
            guard let payload = durable["payload"]?.byteArrayValue else { return nil }
            return .durable(payload: payload)
        }
        if let ephemeral = members["Ephemeral"] {
            return .ephemeral(message: ephemeral)
        }
        return nil
    }
}

/// Unified inbound dispatch for anything received on the durable/socket
/// lanes: both families share the `kind` tag, so a socket client dispatches
/// across both (live.socket-server.schema.json module doc), and a genuinely
/// unknown kind is skipped, never fatal (LLP 0095 tolerance floor).
public enum ServerFrame {
    case durable(Decoded<LiveEnvelope>)
    case socket(Decoded<LiveSocketServerFrame>)
    /// A known kind whose instance was missing required members. Post-cut
    /// this is a T-DB-P-class loss, not an ignorable frame.
    case undecodableKnownKind(kind: String)
    case unknownKind(kind: String)
    case notAnEnvelope

    public static func decode(_ json: JSONValue) -> ServerFrame {
        guard let members = json.objectValue, let kind = members["kind"]?.stringValue else {
            return .notAnEnvelope
        }
        if LiveEnvelope.knownKinds.contains(kind) {
            if let decoded = LiveEnvelope.from(json) { return .durable(decoded) }
            return .undecodableKnownKind(kind: kind)
        }
        if LiveSocketServerFrame.knownKinds.contains(kind) {
            if let decoded = LiveSocketServerFrame.from(json) { return .socket(decoded) }
            return .undecodableKnownKind(kind: kind)
        }
        return .unknownKind(kind: kind)
    }
}

// MARK: - Request/response DTOs (connection-scoped surface)

/// `POST /connection/open` response (`connection.grant.schema.json`).
public struct ConnectionGrant: Sendable {
    public var connectionId: String
    public var connectionToken: String
    public var authorizationInvalidation: AuthorizationInvalidationConnection?

    public static func from(_ json: JSONValue) -> ConnectionGrant? {
        guard let id = json["connectionId"]?.stringValue,
              !id.isEmpty,
              let token = json["connectionToken"]?.stringValue,
              !token.isEmpty
        else { return nil }
        let invalidationValue = json["authorizationInvalidation"].flatMap {
            $0 == .null ? nil : $0
        }
        let invalidation = invalidationValue.flatMap(
            AuthorizationInvalidationConnection.from
        )
        if invalidationValue != nil && invalidation == nil { return nil }
        return ConnectionGrant(connectionId: id, connectionToken: token, authorizationInvalidation: invalidation)
    }
}

/// `snapshot` member of the subscribe output (`QueryOutput`).
public struct QuerySnapshot: Sendable {
    public var version: UInt64
    public var rows: [JSONValue]
    public var cursor: String?

    public static func from(_ json: JSONValue) -> QuerySnapshot? {
        guard let version = json["version"]?.uint64Value,
              let rows = json["rows"]?.arrayValue
        else { return nil }
        let cursor = json["cursor"].flatMap { $0 == .null ? nil : $0.stringValue }
        return QuerySnapshot(version: version, rows: rows, cursor: cursor)
    }
}

/// `POST /live/{name}/subscribe` output (`live.subscribe.output.schema.json`).
/// `receipt` is typed `Option<Receipt>` per LLP 0094 §0D.
public struct LiveSubscribeOutput: Sendable {
    public var subscriptionId: String
    public var snapshot: QuerySnapshot?
    public var receipt: JSONValue?
    public var resume: JSONValue?
    public var resumeRefusal: String?
    public var superseded: String?
    public var supersessionRefusal: String?
    public var authorizationScope: JSONValue?
    public var authorizationInvalidation: AuthorizationInvalidationProjection?

    public static func from(_ json: JSONValue) -> LiveSubscribeOutput? {
        guard let subscriptionId = json["subscription_id"]?.stringValue,
              !subscriptionId.isEmpty
        else { return nil }
        func nonNull(_ key: String) -> JSONValue? {
            guard let value = json[key], value != .null else { return nil }
            return value
        }
        let snapshotValue = nonNull("snapshot")
        let snapshot = snapshotValue.flatMap(QuerySnapshot.from)
        if snapshotValue != nil && snapshot == nil { return nil }
        let authorizationScope = nonNull("authorizationScope")
        if let authorizationScope, !validInvalidationScope(authorizationScope) {
            return nil
        }
        let invalidationValue = nonNull("authorizationInvalidation")
        let invalidation = invalidationValue.flatMap(
            AuthorizationInvalidationProjection.from
        )
        if invalidationValue != nil && invalidation == nil { return nil }
        let resumeRefusalValue = nonNull("resumeRefusal")
        let supersededValue = nonNull("superseded")
        let supersessionRefusalValue = nonNull("supersessionRefusal")
        guard resumeRefusalValue == nil
                || resumeRefusalValue?.stringValue != nil,
              supersededValue == nil || supersededValue?.stringValue != nil,
              supersessionRefusalValue == nil
                || supersessionRefusalValue?.stringValue != nil,
              !(supersededValue != nil && supersessionRefusalValue != nil)
        else { return nil }
        return LiveSubscribeOutput(
            subscriptionId: subscriptionId,
            snapshot: snapshot,
            receipt: nonNull("receipt"),
            resume: nonNull("resume"),
            resumeRefusal: resumeRefusalValue?.stringValue,
            superseded: supersededValue?.stringValue,
            supersessionRefusal: supersessionRefusalValue?.stringValue,
            authorizationScope: authorizationScope,
            authorizationInvalidation: invalidation
        )
    }
}

/// `POST /mutation/{name}` success response (`mutation.output.schema.json`).
public struct MutationResponse: Sendable {
    public var version: UInt64
    public var changedCount: UInt64
    public var result: JSONValue
    public var receipt: JSONValue

    public static func from(_ json: JSONValue) -> MutationResponse? {
        guard let version = json["version"]?.uint64Value,
              let changedCount = json["changed_count"]?.uint64Value,
              let receipt = json["receipt"]
        else { return nil }
        return MutationResponse(version: version, changedCount: changedCount, result: json["result"] ?? .null, receipt: receipt)
    }
}

/// The standard refusal envelope (`error.response.schema.json`).
public struct WireErrorResponse: Sendable {
    public var code: String
    public var severity: String
    public var subsystem: String
    public var message: String
    public var details: JSONValue
    public var receipt: JSONValue?

    public static func from(_ json: JSONValue) -> WireErrorResponse? {
        guard let diagnostic = json["diagnostic"],
              let code = diagnostic["code"]?.stringValue,
              let severity = diagnostic["severity"]?.stringValue,
              let subsystem = diagnostic["subsystem"]?.stringValue,
              let message = diagnostic["message"]?.stringValue
        else { return nil }
        var receipt = json["receipt"]
        if receipt == .null { receipt = nil }
        return WireErrorResponse(
            code: code, severity: severity, subsystem: subsystem, message: message,
            details: diagnostic["details"] ?? .null, receipt: receipt
        )
    }
}
