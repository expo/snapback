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
//! Casing is preserved from the defining serde type. Most durable-lane
//! envelopes use snake_case fields (`subscription_id`) while socket control
//! frames and receipts use camelCase (`requestId`, `receivedAtMs`). The named
//! exception is the `authorization_invalidation` subtree: its imported
//! obligation, resolution, scope, namespace, and snapshot DTOs are camelCase
//! even though the outer durable envelope is snake_case. Unifying casing would
//! be a breaking wire change for no information gain; generated schemas, not a
//! lane-level mnemonic, are authoritative.
//!
//! @ref LLP 0051#d4-finish-dk-7-the-live-envelope-becomes-schema-governed —
//!   the live envelope kinds, socket family, grants, and receipts become
//!   schema-governed serde types in one module.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::auth::invalidation::{ResolutionTicket, ResyncObligation};
use crate::diagnostic::Diagnostic;
use crate::ephemeral::{
    DeleteRequest, EphemeralMessage, PublishRequest, RealtimeEnvelope, SubscribeRequest,
};
use crate::manifest::SettlementLane;

/// A durable-lane fan-out envelope: what a live-query subscriber receives,
/// unwrapped, on the WebSocket (and wrapped in [`RealtimeEnvelope::Durable`]
/// bytes on the HTTP polling drain).
///
/// `live_replace` is the wire default (whole-result refresh); every row's
/// system `_id` member is its durable identity and occupies the same string
/// space as [`LiveDeltaWireOp::id`]. `live_delta` is the DK-3 op-log fast path
/// for the analyzable unordered subset;
/// `resync_required` tells the client its subscription (or, connection-wide,
/// its whole outbox) can no longer be trusted and it must re-snapshot.
///
/// @ref LLP 0093#d1--the-protocol-document-and-wire-v1 — optional fields on
///   existing server-to-client envelopes are compatible within wire v1.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LiveEnvelope {
    /// Whole-result refresh for one subscription.
    LiveReplace {
        /// Name of the immutable non-`normal` network profile snapshot that
        /// delayed this frame. Absent for the identity profile.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(pattern(r"^[A-Za-z0-9._-]+$"))]
        network_profile: Option<String>,
        subscription_id: String,
        function: String,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        version: u64,
        rows: Vec<Value>,
        /// Refreshed resume token for `rqsEligible` subscriptions — an
        /// ignorable optional addition (old decoders drop it; LLP 0091 §0B.2).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resume: Option<ResumeWire>,
    },
    /// Op-log delta (DK-3 / LLP 0008): only the rows that entered/left/changed
    /// the subscription's result. Unordered by contract — ordered queries fall
    /// back to `live_replace`.
    LiveDelta {
        /// Name of the immutable non-`normal` network profile snapshot that
        /// delayed this frame. Absent for the identity profile.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(pattern(r"^[A-Za-z0-9._-]+$"))]
        network_profile: Option<String>,
        subscription_id: String,
        function: String,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        version: u64,
        ops: Vec<LiveDeltaWireOp>,
        /// Refreshed resume token for `rqsEligible` subscriptions — an
        /// ignorable optional addition (old decoders drop it; LLP 0091 §0B.2).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resume: Option<ResumeWire>,
    },
    /// Rowless acknowledgement that the subscription's held rows are current
    /// as of `version`. The original rung-1 resume answer carries a fresh
    /// token; scheduler convergence watermarks use the same additive envelope
    /// without one.
    ///
    /// @ref LLP 0200#21-settlement-is-decoupled-from-subscriber-work — skip
    ///   and no-change dispositions advance the per-subscription watermark.
    CurrentAsOf {
        /// Name of the immutable non-`normal` network profile snapshot that
        /// delayed this frame. Absent for the identity profile.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(pattern(r"^[A-Za-z0-9._-]+$"))]
        network_profile: Option<String>,
        subscription_id: String,
        function: String,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        version: u64,
        /// Fresh token minted at `version` for an RQS-capable subscription.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resume: Option<ResumeWire>,
    },
    /// Level-triggered authorization invalidation for one auth-scoped live
    /// query. The optional snapshot and resolution are one atomic wire frame;
    /// their presence never discharges the server obligation. Only the exact
    /// post-commit ACK token does that.
    AuthorizationInvalidation {
        /// Name of the immutable non-`normal` network profile snapshot that
        /// delayed this frame. Absent for the identity profile.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(pattern(r"^[A-Za-z0-9._-]+$"))]
        network_profile: Option<String>,
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
        /// Name of the immutable non-`normal` network profile snapshot that
        /// delayed this frame. Absent for the identity profile.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(pattern(r"^[A-Za-z0-9._-]+$"))]
        network_profile: Option<String>,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subscription_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scope: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        epoch: Option<u64>,
        clear_retained: bool,
    },
}

impl LiveEnvelope {
    pub fn authorization_invalidation(
        obligation: ResyncObligation,
        resolution: Option<ResolutionTicket>,
        snapshot: Option<AuthorizationInvalidationSnapshot>,
    ) -> Self {
        Self::AuthorizationInvalidation {
            network_profile: None,
            obligation: Box::new(obligation),
            resolution: resolution.map(Box::new),
            snapshot,
        }
    }

    /// Attach the admission-snapshot marker at the socket serialization cut.
    ///
    /// @ref LLP 0167#honesty-requirements — the marker names the same
    ///   immutable profile snapshot that supplied the frame deadline.
    pub fn with_network_profile(mut self, profile_name: String) -> Self {
        let marker = match &mut self {
            Self::LiveReplace {
                network_profile, ..
            }
            | Self::LiveDelta {
                network_profile, ..
            }
            | Self::CurrentAsOf {
                network_profile, ..
            }
            | Self::AuthorizationInvalidation {
                network_profile, ..
            }
            | Self::ResyncRequired {
                network_profile, ..
            } => network_profile,
        };
        *marker = Some(profile_name);
        self
    }

    pub fn network_profile(&self) -> Option<&str> {
        match self {
            Self::LiveReplace {
                network_profile, ..
            }
            | Self::LiveDelta {
                network_profile, ..
            }
            | Self::CurrentAsOf {
                network_profile, ..
            }
            | Self::AuthorizationInvalidation {
                network_profile, ..
            }
            | Self::ResyncRequired {
                network_profile, ..
            } => network_profile.as_deref(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationSnapshot {
    pub subscription_id: String,
    pub function: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
    pub rows: Vec<Value>,
}

/// The RQS resume object (LLP 0091 §0B.1): the opaque server-authenticated
/// token plus its clear, client-advisory `meta` copy. `meta` repeats every
/// identity field the LLP 0090 D3 channel arbitration compares and is never
/// an admission input — admission decodes the token itself. Exported as
/// `live.resume-token.schema.json`, named distinctly from the reattach
/// operation's `live.resume.*` schemas (LLP 0091 §0B.4).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
pub struct ResumeWire {
    /// `tokenWire` (`sbrt1.` envelope, ≤ 1 KiB — LLP 0091 §0A.1).
    pub token: String,
    pub meta: ResumeMeta,
}

/// Clear advisory copy of the token's identity fields (LLP 0091 §0B.1). The
/// client's digest-kind signal is `content_digest`'s self-describing prefix.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResumeMeta {
    pub app: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
    pub content_digest: String,
    pub generation: String,
    pub version_stream: String,
    pub query_artifact: String,
    pub args_hash: String,
}

/// The optional `resumeFromToken` wrapper on the subscribe input (LLP 0091
/// §0B.4): token resume is not a new route. The wrapper carries the rung-2
/// `membershipWitness` (LLP 0091 rung-2 amendment, rollout step 5a).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
pub struct ResumeFromToken {
    pub resume: ResumeWire,
    /// Rung-2 membership witness (LLP 0090 D1.3): present only when the
    /// client holds an `mset1` result within the size cap. Its absence never
    /// refuses the resume — rung 1 and rung 3 remain available.
    #[serde(
        default,
        rename = "membershipWitness",
        skip_serializing_if = "Option::is_none"
    )]
    pub membership_witness: Option<MembershipWitnessWire>,
}

/// The rung-2 membership witness (LLP 0091 rung-2 amendment / LLP 0090 Q7):
/// exact `(rowId, oldRowHash)` pairs for every row the client holds at the
/// token's version, in ascending UTF-16 code-unit order of `id` (the JCS
/// member order), with an explicit `count`. The keyed-leaf aggregate of these
/// pairs must equal the token's MAC-bound `contentDigest` root before any
/// replay is admitted; any decode ambiguity refuses to rung 3 and can never
/// suppress a removal.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
pub struct MembershipWitnessWire {
    /// Must equal `entries.len()` — an explicit count makes truncation a
    /// detectable decode failure rather than a silent smaller witness.
    pub count: u32,
    pub entries: Vec<MembershipWitnessEntry>,
}

/// One held row in the witness: the wire row id (the same string
/// [`LiveDeltaWireOp::id`] carries) and the base64url (no pad) encoding of
/// the 32-byte LLP 0091 §0A.2 row hash the client holds for it.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
pub struct MembershipWitnessEntry {
    pub id: String,
    #[serde(rename = "oldRowHash")]
    pub old_row_hash: String,
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
    /// First successful frame on a sender-constrained browser socket. Browser
    /// code cannot read the upgrade response headers, so this repeats the
    /// already-committed successor nonce in-band before application delivery.
    ///
    /// @ref LLP 0077#author-decisions--2026-07-23 — the custody queue releases
    /// only after this observable successor is durably installed.
    SenderNonce { nonce: String },
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
        #[serde(rename = "authorityDisposition")]
        authority_disposition: LiveAuthorityDisposition,
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

/// Whether a terminal frame ends only the presented carrier or reflects a
/// durable authority deletion. Clients may replace an expired/evicted carrier,
/// but must delete local durable authority state after `durableDelete`.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum LiveAuthorityDisposition {
    Carrier,
    DurableDelete,
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

/// The hosted kit-socket **in-band request grammar** (LLP 0094 §0A.1 WS-kinds
/// row, §0F item 2): the `type`-tagged frames `validateLiveSocketFrame`
/// (`cloudflare/src/coordinator.js`) accepts on an authenticated kit stream —
/// `subscribe` / `unsubscribe` / `ping`. This Rust type is the schema
/// authority for that JS validator (LLP 0051 §D4 — a hand-mirrored JS family
/// gets a Rust serde authority); the Rust server itself does not decode this
/// family (durable lifecycle is HTTP-only on the local arm), and
/// `cloudflare/test/wire-schema-gate.mjs` proves the served validator's
/// verdicts against the committed schema over a shared corpus.
///
/// The closure mirrors the validator exactly: closed frames
/// (`deny_unknown_fields`), a closed `resumeFromToken` wrapper, but an
/// **open** `resume` object of which only `token` is transport-validated, and
/// a shape-unvalidated `membershipWitness` (accepted for wire compatibility;
/// rung 2 deferred on this arm). The in-band reply grammar has its own
/// [`KitSocketReplyFrame`] authority below.
///
/// @ref LLP 0094#0a1-app-data-routes-root — the WS-kinds row: request grammar
///   inside wire v1, paired with the separately governed kit reply grammar.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum KitSocketRequestFrame {
    /// In-band durable subscribe. `args` must be a JSON object; `supersedes`
    /// when present is a non-empty prior subscription id; `resumeFromToken`
    /// rides the subscribe frame (LLP 0091 §0B.4 — token resume is not a new
    /// operation).
    Subscribe {
        #[schemars(length(min = 1))]
        name: String,
        args: Map<String, Value>,
        /// Optional-by-absence: the served validator rejects an explicit
        /// `null`, so the schema keeps the member non-nullable.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(with = "String", length(min = 1))]
        supersedes: Option<String>,
        /// Optional-by-absence (explicit `null` rejects, as above).
        #[serde(
            default,
            rename = "resumeFromToken",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(with = "KitSocketResumeFromToken")]
        resume_from_token: Option<KitSocketResumeFromToken>,
    },
    Unsubscribe {
        #[serde(rename = "subscriptionId")]
        #[schemars(length(min = 1))]
        subscription_id: String,
    },
    Ping {
        /// Optional-by-absence (explicit `null` rejects, as above).
        #[serde(default, rename = "requestId", skip_serializing_if = "Option::is_none")]
        #[schemars(with = "String")]
        request_id: Option<String>,
    },
}

/// The kit-socket subscribe frame's `resumeFromToken` wrapper **as served by
/// the hosted validator**: exactly the members `resume` and
/// `membershipWitness`, with `membershipWitness` accepted at any shape
/// (`isValidResumeFromToken`, `coordinator.js`). Distinct from the typed
/// [`ResumeFromToken`] the local HTTP subscribe input decodes — the hosted
/// transport check is deliberately weaker, and this schema records the served
/// contract, not an aspiration.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct KitSocketResumeFromToken {
    pub resume: KitSocketResumeEnvelope,
    #[serde(
        default,
        rename = "membershipWitness",
        skip_serializing_if = "Option::is_none"
    )]
    pub membership_witness: Option<Value>,
}

/// The `resume` member as transport-validated on the hosted kit socket: an
/// open object whose `token` is a 1–1024 byte string (the LLP 0091 §0A.1
/// `sbrt1.` cap); other members (`meta`, …) pass through untouched.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
pub struct KitSocketResumeEnvelope {
    #[schemars(length(min = 1, max = 1024))]
    pub token: String,
}

/// The hosted kit-socket **in-band reply grammar** (LLP 0094 §0A.1 WS-kinds
/// row, §0C.6 item 6, §0F item 2), after the 2026-07-27 convergence to kit
/// dialect. This is deliberately distinct from [`LiveEnvelope`] and
/// [`LiveSocketServerFrame`]: the hosted in-band subscribe surface adds
/// `snapshot` and `error`, while its heartbeat `pong` does not carry the local
/// control frame's `serverTimeMs`.
///
/// The outer frames are closed and reproduce the served casing exactly:
/// snapshot/current-as-of data members are snake_case, while the established
/// `requestId` and `resumeRefusal` members remain camelCase. An unsubscribe is
/// intentionally absent because it deletes session-scoped demand without a
/// reply frame. The proof socket's `type`-tagged replies remain outside wire
/// v1 and outside this authority.
///
/// @ref LLP 0094#0f--remaining-hand-mirrored-frames-llp-0051-d4 — item 2:
///   kit replies are schema-governed; the proof-socket reply framing remains
///   exempt.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum KitSocketReplyFrame {
    /// Answer to the kit-socket application heartbeat. `requestId` is echoed
    /// exactly when it was present on the request.
    Pong {
        #[serde(default, rename = "requestId", skip_serializing_if = "Option::is_none")]
        #[schemars(with = "String")]
        request_id: Option<String>,
    },
    /// Rung-1 answer: the caller's retained rows are current at `version`.
    CurrentAsOf {
        subscription_id: String,
        function: String,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        version: u64,
        resume: ResumeWire,
    },
    /// Successful fresh or rung-3 subscribe answer.
    Snapshot {
        subscription_id: String,
        function: String,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        version: u64,
        rows: Vec<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(with = "ResumeWire")]
        resume: Option<ResumeWire>,
        /// Per-cause `SNAPBACK_RESUME_*` observability code when a presented
        /// token was refused and the subscribe fell back to a fresh snapshot.
        #[serde(
            default,
            rename = "resumeRefusal",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(with = "String")]
        resume_refusal: Option<String>,
    },
    /// A subscribe failure. The shared full [`Diagnostic`] shape is the same
    /// one committed for kit HTTP error envelopes.
    Error { diagnostic: Diagnostic },
}

/// The `GET /outbox/{connection_id}` drain response body (LLP 0094 §0A.5): a
/// **bare JSON array** of [`RealtimeEnvelope`] — not NDJSON, no object
/// wrapper, possibly empty. The local `drain_outbox` (`src/server.rs`) serves
/// this type directly; the hosted arm's declared-empty drain (`[]`,
/// `coordinator.js` kit outbox arm) is governed by the same schema. An
/// admitted-but-unknown/reaped connection answers in-band with the
/// synthesized single-element `resync_required { reason:
/// "unknown_or_reaped", clear_retained: true }` batch rather than an HTTP
/// error; there is no client acknowledgement step (the LLP 0059 ownership
/// cut rides the response handoff).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(transparent)]
pub struct OutboxDrainOutput(pub Vec<RealtimeEnvelope>);

fn nullable_storage_version_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Option<u64>>()
}

/// How settlement treated one client-captured application value. Divergence
/// remains visible in the claimed/authoritative pair rather than becoming a
/// fourth disposition.
///
/// @ref LLP 0133#receipts — settlement receipts carry labeled claims, while
///   fan-out projections omit their values entirely.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SettlementClaimDisposition {
    Accepted,
    AcceptedBoundedSkew,
    ReDerived,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementClaim {
    pub field_or_slot: String,
    pub claimed: Value,
    pub authoritative: Value,
    pub disposition: SettlementClaimDisposition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skew_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SettlementIdMapDisposition {
    Mapped,
    Unmapped,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementIdMapEntry {
    pub speculative: String,
    pub authoritative: Option<String>,
    pub site: String,
    pub occurrence: u32,
    pub disposition: SettlementIdMapDisposition,
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
    #[schemars(extend(
        "allOf" = [{
            "if": {
                "properties": { "outcome": { "const": "confirmed" } },
                "required": ["outcome"]
            },
            "then": {
                "properties": { "snapshotVersion": { "type": "integer" } }
            }
        }]
    ))]
    Mutation {
        #[serde(rename = "mutationId")]
        mutation_id: String,
        mutation: String,
        outcome: MutationReceiptOutcome,
        /// Server-observed settlement policy. Safe to retain in fan-out.
        #[serde(rename = "settlementLane", default)]
        settlement_lane: SettlementLane,
        /// Private settlement evidence. `None` is the fan-out projection;
        /// the submitting authority's direct response always carries `Some`.
        #[serde(
            default,
            rename = "claimLedger",
            skip_serializing_if = "Option::is_none"
        )]
        claim_ledger: Option<Vec<SettlementClaim>>,
        /// Private lane-L id reconciliation. `Some([])` is the explicit
        /// no-mints map; `None` means this is lane Q or a fan-out projection.
        #[serde(default, rename = "idMap", skip_serializing_if = "Option::is_none")]
        id_map: Option<Vec<SettlementIdMapEntry>>,
        /// The diagnostic CODE only — messages may embed argument values
        /// (§3.3 privacy). `null` on confirmed mutations.
        #[serde(rename = "rollbackReason")]
        rollback_reason: Option<String>,
        /// `null` means EXPLICITLY unknown (an IbexModule handler without a
        /// declared write set) — distinct from `[]`, no tables.
        #[serde(rename = "affectedTables")]
        affected_tables: Option<Vec<String>>,
        /// `null` only when the rejected invocation could not safely read the
        /// durable cursor; never fabricate zero from a storage failure.
        #[serde(rename = "snapshotVersion")]
        #[schemars(required, schema_with = "nullable_storage_version_schema")]
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        snapshot_version: Option<u64>,
        /// Jobs this confirmed mutation durably enqueued in its own
        /// transaction (LLP 0070 first slice; 0127 decision 7's
        /// mutation-side association). Bounded facts only — jobId, action,
        /// availableAtMs; never argument values. Omitted when empty, and a
        /// rejected mutation never carries one: the receipt proves what was
        /// scheduled with the write, and its absence on a rejection is the
        /// inspectable rollback-schedules-nothing evidence.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        enqueues: Vec<crate::jobs::JobEnqueueFact>,
        /// Private sequence evidence for the submitting authority. The value
        /// discloses prior allocation count, so fan-out projection strips it.
        /// @ref LLP 0135#17-allocation-authority-and-information-flow — effect
        ///   receipts carry the full counter/scope/incarnation/value tuple
        ///   only on the submitter's receipt.
        #[serde(
            default,
            rename = "sequenceAllocations",
            skip_serializing_if = "Vec::is_empty"
        )]
        sequence_allocations: Vec<crate::storage::SequenceAllocationFact>,
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
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
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

    /// Project a receipt across the subscriber-visible global ring. Claim
    /// values are authority-private even when the lane itself is public.
    ///
    /// @ref LLP 0133#receipts — claimed values never cross the fan-out
    ///   boundary to another subscriber.
    pub fn into_fanout_value(mut self) -> Value {
        if let Self::Mutation {
            claim_ledger,
            id_map,
            sequence_allocations,
            ..
        } = &mut self
        {
            *claim_ledger = None;
            *id_map = None;
            sequence_allocations.clear();
        }
        self.into_value()
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
            network_profile: None,
            subscription_id: "sub_1".into(),
            function: "listTodos".into(),
            version: 7,
            rows: vec![json!({ "_id": "a" })],
            resume: None,
        };
        assert_eq!(
            serde_json::to_vec(&replace).unwrap(),
            br#"{"kind":"live_replace","subscription_id":"sub_1","function":"listTodos","version":7,"rows":[{"_id":"a"}]}"#,
            "normal keeps the pre-marker bytes exactly"
        );
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
        let profiled = replace
            .clone()
            .with_network_profile("fixture-slow".to_owned());
        assert_eq!(profiled.network_profile(), Some("fixture-slow"));
        assert_eq!(
            serde_json::to_vec(&profiled).unwrap(),
            br#"{"kind":"live_replace","network_profile":"fixture-slow","subscription_id":"sub_1","function":"listTodos","version":7,"rows":[{"_id":"a"}]}"#
        );

        let delta = LiveEnvelope::LiveDelta {
            network_profile: None,
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
            resume: None,
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
            network_profile: None,
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

        // The rung-1 answer (LLP 0091 §0B.2): mandatory fresh token, no rows.
        let resume = ResumeWire {
            token: "sbrt1.sbrq_x.e30.e30".into(),
            meta: ResumeMeta {
                app: "app_1".into(),
                version: 9,
                content_digest: "mset1:aa".into(),
                generation: "gen1:bb".into(),
                version_stream: "stream-1".into(),
                query_artifact: "sha256:cc".into(),
                args_hash: "sha256:dd".into(),
            },
        };
        let current_as_of = LiveEnvelope::CurrentAsOf {
            network_profile: None,
            subscription_id: "sub_1".into(),
            function: "listTodos".into(),
            version: 9,
            resume: Some(resume.clone()),
        };
        assert_eq!(
            serde_json::to_value(&current_as_of).unwrap(),
            json!({
                "kind": "current_as_of",
                "subscription_id": "sub_1",
                "function": "listTodos",
                "version": 9,
                "resume": {
                    "token": "sbrt1.sbrq_x.e30.e30",
                    "meta": {
                        "app": "app_1",
                        "version": 9,
                        "contentDigest": "mset1:aa",
                        "generation": "gen1:bb",
                        "versionStream": "stream-1",
                        "queryArtifact": "sha256:cc",
                        "argsHash": "sha256:dd",
                    },
                },
            })
        );
        let convergence_watermark = LiveEnvelope::CurrentAsOf {
            network_profile: None,
            subscription_id: "sub_1".into(),
            function: "listTodos".into(),
            version: 10,
            resume: None,
        };
        let encoded = serde_json::to_value(&convergence_watermark).unwrap();
        assert!(encoded.get("resume").is_none());
        assert_eq!(
            serde_json::from_value::<LiveEnvelope>(encoded).unwrap(),
            convergence_watermark
        );

        // A refreshed-token replace round-trips, and a decoder without the
        // field (None) reads the same frame minus `resume` — the old-decoder
        // tolerance case is exercised by the schema's non-required field.
        let refreshed = LiveEnvelope::LiveReplace {
            network_profile: None,
            subscription_id: "sub_1".into(),
            function: "listTodos".into(),
            version: 9,
            rows: vec![],
            resume: Some(resume),
        };
        let encoded = serde_json::to_value(&refreshed).unwrap();
        assert_eq!(encoded["resume"]["meta"]["contentDigest"], "mset1:aa");
        assert_eq!(
            serde_json::from_value::<LiveEnvelope>(encoded).unwrap(),
            refreshed
        );

        // Connection-wide overflow: no subscription fields at all.
        let overflow = LiveEnvelope::ResyncRequired {
            network_profile: None,
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
    fn resume_from_token_witness_wire_shape_is_preserved() {
        let with_witness = ResumeFromToken {
            resume: ResumeWire {
                token: "sbrt1.sbrq_x.e30.e30".into(),
                meta: ResumeMeta {
                    app: "app_1".into(),
                    version: 5,
                    content_digest: "mset1:aa".into(),
                    generation: "gen1:bb".into(),
                    version_stream: "stream-1".into(),
                    query_artifact: "sha256:cc".into(),
                    args_hash: "sha256:dd".into(),
                },
            },
            membership_witness: Some(MembershipWitnessWire {
                count: 1,
                entries: vec![MembershipWitnessEntry {
                    id: "a".into(),
                    old_row_hash: "h".repeat(43),
                }],
            }),
        };
        let encoded = serde_json::to_value(&with_witness).unwrap();
        assert_eq!(encoded["membershipWitness"]["count"], 1);
        assert_eq!(encoded["membershipWitness"]["entries"][0]["id"], "a");
        assert!(
            encoded["membershipWitness"]["entries"][0]["oldRowHash"]
                .as_str()
                .is_some()
        );
        assert_eq!(
            serde_json::from_value::<ResumeFromToken>(encoded).unwrap(),
            with_witness
        );
        // Witness-less wrappers (rung 1/3 resumes, pre-5a clients) omit the
        // field entirely and still decode.
        let without: ResumeFromToken = serde_json::from_value(json!({
            "resume": serde_json::to_value(&with_witness.resume).unwrap(),
        }))
        .unwrap();
        assert!(without.membership_witness.is_none());
        assert!(
            !serde_json::to_value(&without)
                .unwrap()
                .as_object()
                .unwrap()
                .contains_key("membershipWitness")
        );
    }

    #[test]
    fn socket_server_frame_wire_shapes_are_preserved() {
        let terminal = LiveSocketServerFrame::AuthError {
            code: LiveAuthErrorCode::SessionExpired,
            reason: LiveAuthErrorReason::Expired,
            authority_disposition: LiveAuthorityDisposition::Carrier,
        };
        assert_eq!(
            serde_json::to_value(&terminal).unwrap(),
            json!({
                "kind": "auth_error",
                "code": "SNAPBACK_AUTH_SESSION_EXPIRED",
                "reason": "expired",
                "authorityDisposition": "carrier",
            })
        );

        let scoped_token_terminal = LiveSocketServerFrame::AuthError {
            code: LiveAuthErrorCode::ScopedTokenInvalid,
            reason: LiveAuthErrorReason::Revoked,
            authority_disposition: LiveAuthorityDisposition::DurableDelete,
        };
        assert_eq!(
            serde_json::to_value(&scoped_token_terminal).unwrap(),
            json!({
                "kind": "auth_error",
                "code": "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                "reason": "revoked",
                "authorityDisposition": "durableDelete",
            })
        );

        assert!(
            serde_json::from_value::<LiveSocketServerFrame>(json!({
                "kind": "auth_error",
                "code": "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                "reason": "revoked",
                "authorityDisposition": "durable_delete",
            }))
            .is_err(),
            "the authority disposition is a closed camel-case wire enum"
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
            settlement_lane: SettlementLane::ReplayAccept,
            claim_ledger: Some(vec![SettlementClaim {
                field_or_slot: "runtime.now".into(),
                claimed: json!(7),
                authoritative: json!(7),
                disposition: SettlementClaimDisposition::Accepted,
                skew_ms: None,
            }]),
            id_map: None,
            rollback_reason: None,
            affected_tables: Some(vec!["todos".into()]),
            snapshot_version: Some(9),
            // Empty enqueues stay off the wire: the pinned shape below is
            // unchanged for every mutation that scheduled nothing.
            enqueues: Vec::new(),
            sequence_allocations: Vec::new(),
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
                "settlementLane": "replay-accept",
                "claimLedger": [{
                    "fieldOrSlot": "runtime.now",
                    "claimed": 7,
                    "authoritative": 7,
                    "disposition": "accepted"
                }],
                "rollbackReason": null,
                "affectedTables": ["todos"],
                "snapshotVersion": 9,
                "transport": "http",
                "correlation": null,
                "receivedAtMs": 1,
            })
        );

        let fanout = Receipt::Mutation {
            mutation_id: "mut_private".into(),
            mutation: "addTodo".into(),
            outcome: MutationReceiptOutcome::Confirmed,
            settlement_lane: SettlementLane::ReplayAccept,
            claim_ledger: Some(vec![SettlementClaim {
                field_or_slot: "runtime.id[0]".into(),
                claimed: json!("private-id"),
                authoritative: json!("private-id"),
                disposition: SettlementClaimDisposition::Accepted,
                skew_ms: None,
            }]),
            id_map: Some(vec![SettlementIdMapEntry {
                speculative: "private-id".into(),
                authoritative: Some("authoritative-id".into()),
                site: "plan/steps/0/insert/row-id".into(),
                occurrence: 0,
                disposition: SettlementIdMapDisposition::Mapped,
            }]),
            rollback_reason: None,
            affected_tables: Some(vec!["todos".into()]),
            snapshot_version: Some(9),
            enqueues: Vec::new(),
            sequence_allocations: Vec::new(),
            transport: "http".into(),
            correlation: Value::Null,
            received_at_ms: 1,
        }
        .into_fanout_value();
        assert_eq!(fanout["settlementLane"], "replay-accept");
        assert!(
            fanout.get("claimLedger").is_none(),
            "subscriber fan-out omits the private claim ledger"
        );
        assert!(
            fanout.get("idMap").is_none(),
            "subscriber fan-out omits private id reconciliation"
        );
        assert!(!fanout.to_string().contains("authoritative-id"));

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
