//! The client-visible live wire, single-sourced (LLP 0051 D4 / ENG-23891).
//!
//! Every envelope a client can receive on the live surfaces — the durable
//! fan-out lane, the WebSocket control lane, the HTTP polling drain — and
//! every message a client can send on the live socket is defined here as a
//! serde type with a `schemars` derive. `schema_export::artifact_schemas`
//! generates committed JSON Schemas from these types and
//! `tests/artifact_schemas_v0.rs` drift-gates them, so a wire-shape change
//! that skips regeneration is a test failure, not a silent hand-mirror drift
//! (the same DK-7 fail-closed posture `functions.manifest` has). The JS kit
//! pins its dispatch to the same schemas via
//! `demos/_kit/tests/live-wire-schema.mjs`.
//!
//! Casing is preserved from the pre-typed wire, which is mixed by lane:
//! durable-lane envelopes use snake_case fields (`subscription_id`), the
//! socket control lane and receipts use camelCase (`requestId`,
//! `receivedAtMs`). Unifying casing would be a breaking wire change for no
//! information gain; the schemas document what is actually sent.
//!
//! @ref LLP 0051#d4-finish-dk-7-the-live-envelope-becomes-schema-governed —
//!   the live envelope kinds, socket family, grants, and receipts become
//!   schema-governed serde types in one module.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::auth::invalidation::{ResolutionTicket, ResyncObligation};
use crate::diagnostic::Diagnostic;
use crate::ephemeral::{DeleteRequest, EphemeralMessage, PublishRequest, SubscribeRequest};

/// A durable-lane fan-out envelope: what a live-query subscriber receives,
/// unwrapped, on the WebSocket (and wrapped in [`RealtimeEnvelope::Durable`]
/// bytes on the HTTP polling drain).
///
/// `live_replace` is the wire default (whole-result refresh); `live_delta` is
/// the DK-3 op-log fast path for the analyzable unordered subset;
/// `resync_required` tells the client its subscription (or, connection-wide,
/// its whole outbox) can no longer be trusted and it must re-snapshot.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LiveEnvelope {
    /// Whole-result refresh for one subscription.
    LiveReplace {
        subscription_id: String,
        function: String,
        version: u64,
        rows: Vec<Value>,
    },
    /// Op-log delta (DK-3 / LLP 0008): only the rows that entered/left/changed
    /// the subscription's result. Unordered by contract — ordered queries fall
    /// back to `live_replace`.
    LiveDelta {
        subscription_id: String,
        function: String,
        version: u64,
        ops: Vec<LiveDeltaWireOp>,
    },
    /// Level-triggered authorization invalidation for one auth-scoped live
    /// query. The optional snapshot and resolution are one atomic wire frame;
    /// their presence never discharges the server obligation. Only the exact
    /// post-commit ACK token does that.
    AuthorizationInvalidation {
        obligation: Box<ResyncObligation>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resolution: Option<Box<ResolutionTicket>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        snapshot: Option<AuthorizationInvalidationSnapshot>,
    },
    /// The subscription (or the whole connection, when `subscription_id` is
    /// absent — outbox overflow) must re-snapshot. Known reasons today:
    /// `reset`, `auth_deployment_activated`, `outbox_overflow`, `permission_epoch_changed`,
    /// `live_delta_failed`, `live_refresh_failed`, `live_serialize_failed`,
    /// `permission_resync_serialize_failed`. A string, not an enum: the
    /// recovery is identical for every reason and new reasons must not break
    /// deployed decoders.
    ResyncRequired {
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subscription_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scope: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        epoch: Option<u64>,
        clear_retained: bool,
    },
}

impl LiveEnvelope {
    pub(crate) fn authorization_invalidation(
        obligation: ResyncObligation,
        resolution: Option<ResolutionTicket>,
        snapshot: Option<AuthorizationInvalidationSnapshot>,
    ) -> Self {
        Self::AuthorizationInvalidation {
            obligation: Box::new(obligation),
            resolution: resolution.map(Box::new),
            snapshot,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationSnapshot {
    pub subscription_id: String,
    pub function: String,
    pub version: u64,
    pub rows: Vec<Value>,
}

/// One `live_delta` op: the row is present for add/update and absent for
/// remove.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
pub struct LiveDeltaWireOp {
    pub op: LiveDeltaOpKind,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row: Option<Value>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum LiveDeltaOpKind {
    Add,
    Update,
    Remove,
}

/// A control-lane frame the server sends on the live WebSocket (the durable
/// lane's [`LiveEnvelope`] payloads arrive on the same socket, unwrapped —
/// a socket client dispatches on `kind` across both families).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LiveSocketServerFrame {
    /// Terminal authority loss for the exact socket/grant generation. The
    /// frame intentionally carries no authority identifier; a client applies
    /// it only to the capture that owns this socket and then treats close code
    /// 4401 as terminal rather than reconnectable.
    ///
    /// @ref LLP 0059#typed-terminal-auth-error — terminal live closure is a
    ///   closed, identifier-free wire event.
    AuthError {
        code: LiveAuthErrorCode,
        reason: LiveAuthErrorReason,
    },
    /// Answer to a client `ping` (LLP 0034 D1 liveness probe).
    Pong {
        #[serde(rename = "requestId")]
        request_id: Option<String>,
        #[serde(rename = "serverTimeMs")]
        server_time_ms: u64,
    },
    /// Success acknowledgment for a socket-carried ephemeral operation. The
    /// operation-specific result body (`message`, `outcome`, `removed`, ...)
    /// is flattened alongside the envelope fields.
    EphemeralAck {
        #[serde(rename = "requestId")]
        request_id: Option<String>,
        operation: String,
        #[serde(flatten)]
        body: Map<String, Value>,
    },
    /// Failure for a socket-carried operation (including undecodable frames,
    /// where `request_id` is unknown and `operation` is `decode`).
    EphemeralError {
        #[serde(rename = "requestId")]
        request_id: Option<String>,
        operation: String,
        diagnostic: Diagnostic,
    },
    /// An ephemeral-lane room message (presence/cursors), wrapped so the
    /// socket dispatch stays on `kind`.
    Ephemeral { message: EphemeralMessage },
    /// Fallback for a durable payload that was not valid UTF-8 (should not
    /// happen — durable payloads are serialized JSON — but the lane must
    /// never drop a message silently).
    DurableBytes { payload: Vec<u8> },
}

/// Closed terminal classes understood by item-5 clients. Later invalidation
/// dispositions must revise the schema instead of smuggling new strings into
/// this family.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
pub enum LiveAuthErrorCode {
    #[serde(rename = "SNAPBACK_AUTH_SESSION_EXPIRED")]
    SessionExpired,
    #[serde(rename = "SNAPBACK_AUTH_STREAM_RESET")]
    StreamReset,
    #[serde(rename = "SNAPBACK_AUTH_MODE_PENDING")]
    ModePending,
    #[serde(rename = "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID")]
    ScopedTokenInvalid,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum LiveAuthErrorReason {
    Expired,
    Revoked,
    Reset,
    Restore,
    Downgrade,
    ModeTransition,
}

/// A message a client sends on the live WebSocket. Tagged with `type` (not
/// `kind`) — the client→server family predates the typed wire and deployed
/// clients send it this way.
///
/// The exhaustive registration of these variants as app-data operations is
/// enforced by `live_socket_operation_name` in `src/server.rs`.
///
/// @ref LLP 0031#enforcement — every accepted socket variant must be a
///   registered app-data operation.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LiveSocketClientMessage {
    EphemeralSubscribe {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: SubscribeRequest,
    },
    EphemeralPublish {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: PublishRequest,
    },
    EphemeralDelete {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: DeleteRequest,
    },
    /// Stop observing a room (ENG-22527 item 3 / SECURITY). Carried over the
    /// shared live socket rather than a public HTTP route so the socket's
    /// connection identity binds the requester: a participant cannot evict
    /// another connection's subscription by asserting its id.
    EphemeralUnsubscribe {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: SubscribeRequest,
    },
    /// Application-level liveness probe (LLP 0034 D1, Exact LLP 0284 §2.2).
    /// Stateless: no connection state is read or touched.
    Ping {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
    },
}

/// A retention-ring receipt (LLP 0034 §3.2): connectionless facts about
/// mutations and subscription lifecycle, served by the receipts snapshot and
/// echoed in live-subscribe/unsubscribe outputs. Privacy (§3.3): receipts
/// carry opaque ids, versions, table names, and reasons — never row data or
/// argument values.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Receipt {
    /// One mutation invocation: confirmed or rejected, with the write
    /// surface that fan-out used.
    Mutation {
        #[serde(rename = "mutationId")]
        mutation_id: String,
        mutation: String,
        outcome: MutationReceiptOutcome,
        /// The diagnostic CODE only — messages may embed argument values
        /// (§3.3 privacy). `null` on confirmed mutations.
        #[serde(rename = "rollbackReason")]
        rollback_reason: Option<String>,
        /// `null` means EXPLICITLY unknown (an IbexModule handler without a
        /// declared write set) — distinct from `[]`, no tables.
        #[serde(rename = "affectedTables")]
        affected_tables: Option<Vec<String>>,
        #[serde(rename = "snapshotVersion")]
        snapshot_version: u64,
        transport: String,
        /// Adapter-supplied opaque correlation, echoed verbatim (capped).
        correlation: Value,
        #[serde(rename = "receivedAtMs")]
        received_at_ms: u64,
    },
    /// Subscription lifecycle: established / disposed, on both the durable
    /// live-query lane and the ephemeral room lane (`lane: "ephemeral"`,
    /// which carries `bindingId`/`collection` instead of `subscriptionId`).
    Subscription {
        event: SubscriptionReceiptEvent,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(
            default,
            rename = "subscriptionId",
            skip_serializing_if = "Option::is_none"
        )]
        subscription_id: Option<String>,
        #[serde(
            default,
            rename = "supersededBy",
            skip_serializing_if = "Option::is_none"
        )]
        superseded_by: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        lane: Option<String>,
        #[serde(default, rename = "bindingId", skip_serializing_if = "Option::is_none")]
        binding_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        collection: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        removed: Option<bool>,
        /// The subscription's routing/scope args (REQUIRED — LLP 0034 §3.2).
        scope: Value,
        /// `null` when no storage read is safe at the emission site (the
        /// disconnect teardown path) — the honest "unknown at death" value.
        #[serde(rename = "snapshotVersion")]
        snapshot_version: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        correlation: Option<Value>,
        #[serde(rename = "receivedAtMs")]
        received_at_ms: u64,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MutationReceiptOutcome {
    Confirmed,
    Rejected,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SubscriptionReceiptEvent {
    Established,
    Disposed,
}

impl Receipt {
    /// Receipts cross the ring/output boundary as `serde_json::Value` (the
    /// rings predate the typed wire). Infallible: these types contain no
    /// non-string-keyed maps.
    pub fn into_value(self) -> Value {
        serde_json::to_value(&self).expect("receipt serializes to JSON")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn live_envelope_wire_shapes_are_preserved() {
        // The exact pre-typed wire bytes (field names and casing) — a change
        // here is a breaking protocol change, not a refactor.
        let replace = LiveEnvelope::LiveReplace {
            subscription_id: "sub_1".into(),
            function: "listTodos".into(),
            version: 7,
            rows: vec![json!({ "_id": "a" })],
        };
        assert_eq!(
            serde_json::to_value(&replace).unwrap(),
            json!({
                "kind": "live_replace",
                "subscription_id": "sub_1",
                "function": "listTodos",
                "version": 7,
                "rows": [{ "_id": "a" }],
            })
        );

        let delta = LiveEnvelope::LiveDelta {
            subscription_id: "sub_1".into(),
            function: "listTodos".into(),
            version: 8,
            ops: vec![
                LiveDeltaWireOp {
                    op: LiveDeltaOpKind::Add,
                    id: "b".into(),
                    row: Some(json!({ "_id": "b" })),
                },
                LiveDeltaWireOp {
                    op: LiveDeltaOpKind::Remove,
                    id: "a".into(),
                    row: None,
                },
            ],
        };
        assert_eq!(
            serde_json::to_value(&delta).unwrap(),
            json!({
                "kind": "live_delta",
                "subscription_id": "sub_1",
                "function": "listTodos",
                "version": 8,
                "ops": [
                    { "op": "add", "id": "b", "row": { "_id": "b" } },
                    { "op": "remove", "id": "a" },
                ],
            })
        );

        let scoped_resync = LiveEnvelope::ResyncRequired {
            reason: "permission_epoch_changed".into(),
            subscription_id: Some("sub_1".into()),
            scope: Some("user:alice".into()),
            epoch: Some(3),
            clear_retained: true,
        };
        assert_eq!(
            serde_json::to_value(&scoped_resync).unwrap(),
            json!({
                "kind": "resync_required",
                "reason": "permission_epoch_changed",
                "subscription_id": "sub_1",
                "scope": "user:alice",
                "epoch": 3,
                "clear_retained": true,
            })
        );

        // Connection-wide overflow: no subscription fields at all.
        let overflow = LiveEnvelope::ResyncRequired {
            reason: "outbox_overflow".into(),
            subscription_id: None,
            scope: None,
            epoch: None,
            clear_retained: true,
        };
        assert_eq!(
            serde_json::to_value(&overflow).unwrap(),
            json!({
                "kind": "resync_required",
                "reason": "outbox_overflow",
                "clear_retained": true,
            })
        );
    }

    #[test]
    fn socket_server_frame_wire_shapes_are_preserved() {
        let terminal = LiveSocketServerFrame::AuthError {
            code: LiveAuthErrorCode::SessionExpired,
            reason: LiveAuthErrorReason::Expired,
        };
        assert_eq!(
            serde_json::to_value(&terminal).unwrap(),
            json!({
                "kind": "auth_error",
                "code": "SNAPBACK_AUTH_SESSION_EXPIRED",
                "reason": "expired",
            })
        );

        let scoped_token_terminal = LiveSocketServerFrame::AuthError {
            code: LiveAuthErrorCode::ScopedTokenInvalid,
            reason: LiveAuthErrorReason::Revoked,
        };
        assert_eq!(
            serde_json::to_value(&scoped_token_terminal).unwrap(),
            json!({
                "kind": "auth_error",
                "code": "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                "reason": "revoked",
            })
        );

        let pong = LiveSocketServerFrame::Pong {
            request_id: Some("r1".into()),
            server_time_ms: 123,
        };
        assert_eq!(
            serde_json::to_value(&pong).unwrap(),
            json!({ "kind": "pong", "requestId": "r1", "serverTimeMs": 123 })
        );

        let mut body = Map::new();
        body.insert("outcome".to_owned(), json!({ "entry_version": 1 }));
        let ack = LiveSocketServerFrame::EphemeralAck {
            request_id: None,
            operation: "publish".into(),
            body,
        };
        assert_eq!(
            serde_json::to_value(&ack).unwrap(),
            json!({
                "kind": "ephemeral_ack",
                "requestId": null,
                "operation": "publish",
                "outcome": { "entry_version": 1 },
            })
        );
    }

    #[test]
    fn client_messages_accept_both_request_id_spellings() {
        let camel: LiveSocketClientMessage =
            serde_json::from_str(r#"{"type":"ping","requestId":"a"}"#).unwrap();
        let snake: LiveSocketClientMessage =
            serde_json::from_str(r#"{"type":"ping","request_id":"a"}"#).unwrap();
        assert_eq!(camel, snake);
    }

    #[test]
    fn receipt_wire_shapes_are_preserved() {
        let mutation = Receipt::Mutation {
            mutation_id: "mut_1".into(),
            mutation: "addTodo".into(),
            outcome: MutationReceiptOutcome::Confirmed,
            rollback_reason: None,
            affected_tables: Some(vec!["todos".into()]),
            snapshot_version: 9,
            transport: "http".into(),
            correlation: Value::Null,
            received_at_ms: 1,
        };
        assert_eq!(
            mutation.into_value(),
            json!({
                "kind": "mutation",
                "mutationId": "mut_1",
                "mutation": "addTodo",
                "outcome": "confirmed",
                "rollbackReason": null,
                "affectedTables": ["todos"],
                "snapshotVersion": 9,
                "transport": "http",
                "correlation": null,
                "receivedAtMs": 1,
            })
        );

        let disposed = Receipt::Subscription {
            event: SubscriptionReceiptEvent::Disposed,
            reason: Some("disconnected".into()),
            subscription_id: Some("sub_1".into()),
            superseded_by: None,
            lane: None,
            binding_id: None,
            collection: None,
            removed: None,
            scope: json!({}),
            snapshot_version: None,
            correlation: None,
            received_at_ms: 2,
        };
        assert_eq!(
            disposed.into_value(),
            json!({
                "kind": "subscription",
                "event": "disposed",
                "reason": "disconnected",
                "subscriptionId": "sub_1",
                "scope": {},
                "snapshotVersion": null,
                "receivedAtMs": 2,
            })
        );
    }
}
