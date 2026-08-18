//! The private handler-boundary marker envelopes, single-sourced
//! (LLP 0051 §D4 / LLP 0060 D6 / LLP 0094 §0F item 1).
//!
//! Three private wire families cross the coordinator↔handler boundary on both
//! arms — the local workerd loopback transport (`src/workerd_exec.rs` +
//! `packages/snapback-harness/workerd/handler-server.mjs`) and the Cloudflare
//! arm (`cloudflare/src/coordinator.js` `invokeHandler`/`serveHostCall`, same
//! harness server):
//!
//! 1. the coordinator→handler **invocation request** (`POST /invoke`),
//! 2. the handler→coordinator **response envelope**, and
//! 3. the handler→host **call body** (`POST /_snapback/host-call`).
//!
//! They were the last hand-mirrored wire families outside the schema drift
//! gates (LLP 0094 §0F audit). This module gives them the LLP 0051 §D4
//! treatment: Rust serde authorities, generated committed schemas under
//! `schemas/` (`handler.invoke.input` / `handler.invoke.output` /
//! `handler.host-call.input`), positive/negative instances
//! (`tests/artifact_schemas_v0.rs`), and membership in the shared drift gate.
//! Real produced bytes are validated against the committed schemas on both
//! arms: the local twin leg in `tests/workerd_twin_v0.rs` (workerd-produced
//! envelopes through the capture seam) and the hosted leg in
//! `cloudflare/test/wire-schema-gate.mjs` (Miniflare service-binding capture).
//!
//! Ownership split (frozen): LLP 0060 D6 owns the marker *semantics* —
//! compatibility, service-binding integrity, rollout ordering, and the future
//! `SNAPBACK_AUTH_HANDLER_V1` versioned closed envelope
//! (`protocolVersion`/`deploymentId`/`admissionEpoch`/…), which is **not
//! implemented yet** on any arm. These schemas contract the envelopes **as
//! served today** (the dev-profile invocation seam); evolving them to the D6
//! marker set is 0060's rollout, and lands here as an ordinary schema change
//! through the same gate. Being private is not a hand-mirror exemption
//! (LLP 0051 §D4).
//!
//! Closure posture: all three families are **closed emission** records — both
//! producing arms emit exactly these members, so the schemas set
//! `additionalProperties: false` and the drift gate catches a field added on
//! one arm but not mirrored. The receivers stay tolerant field-pluck decoders
//! (`handler-server.mjs`, `host_call_response`, `InvokeResponse`); closing
//! the decoders is the D6 marker rollout, not this schematization.
//!
//! Transport members that ride *beside* the JSON bodies are deliberately not
//! body fields and not schema members: the invoke capability
//! (`x-snapback-invoke-token`, local only), the host-call capability
//! (`x-snapback-host-token`), and the response-authentication echo
//! (`x-snapback-response-token`, local only) are headers; on the Cloudflare
//! arm the service binding itself is the invocation capability.
//!
//! @ref LLP 0051#d4-finish-dk-7-the-live-envelope-becomes-schema-governed —
//!   the private marker envelopes use the same generated-schema mechanism.
//! @ref LLP 0060#d6-mixed-version-coordinator-to-handler-boundary — field
//!   semantics, compatibility, and rollout stay owned there; this module owns
//!   only the serde/schema authority.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The invocation mode member of the invoke request. The closed set mirrors
/// `IbexInvocationMode` (`src/runtime.rs` `mode_str`) and the coordinator's
/// `invokeHandler(fnName, mode, …)` callers.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum HandlerInvocationMode {
    Query,
    Mutation,
    Action,
}

impl HandlerInvocationMode {
    /// Map the runtime's `mode_str` value onto the wire enum.
    pub fn from_mode_str(mode: &str) -> Option<Self> {
        match mode {
            "query" => Some(Self::Query),
            "mutation" => Some(Self::Mutation),
            "action" => Some(Self::Action),
            _ => None,
        }
    }
}

/// The coordinator→handler invocation request: the JSON body of
/// `POST /invoke` on the handler server. The local arm serializes this type
/// directly (`run_handler_workerd`); the Cloudflare `invokeHandler` composes
/// the same members in JS and is drift-gated against this schema by the
/// hosted capture suite.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HandlerInvokeRequest {
    /// The handler export to invoke (`__snapbackHandlers[export]`).
    pub export: String,
    /// The invocation args, pre-serialized JSON text (string-carried so the
    /// harness hands handler code exactly the bytes the host chose).
    #[serde(rename = "argsJson")]
    pub args_json: String,
    /// The `ctx.auth` payload, pre-serialized JSON text.
    #[serde(rename = "authJson")]
    pub auth_json: String,
    pub mode: HandlerInvocationMode,
    /// Action run metadata (`runId`/`trigger`/`jobName`), pre-serialized JSON
    /// text; `null` for queries and mutations on both arms.
    #[serde(rename = "runJson")]
    pub run_json: Option<String>,
    /// Action secret grants, pre-serialized JSON text; `null` unless the mode
    /// is `action` with granted secrets (grants are action-only, LLP 0036).
    #[serde(rename = "secretsJson")]
    pub secrets_json: Option<String>,
    /// The invocation epoch every ctx host call must echo inside `rawOp`
    /// (`"<epoch>|<op>"`); a mismatch is a stale continuation.
    pub epoch: String,
    /// The per-invocation host-call capability. Emitted only by the
    /// Cloudflare arm (`x-snapback-host-token` on every host call); the local
    /// transport delivers the equivalent capability out-of-band via the
    /// generated workerd config (`SNAPBACK_HOST_TOKEN`), never in this body.
    /// Optional-by-absence: neither arm ever emits an explicit `null`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "String")]
    pub token: Option<String>,
    /// The harness settlement + quiescence deadline (ENG-23605).
    #[serde(rename = "settlementTimeoutMs")]
    pub settlement_timeout_ms: u64,
    /// Host-routing headers the harness echoes onto every host call. The
    /// Cloudflare arm passes `x-snapback-do-id` so the gateway routes the
    /// call back to the invoking coordinator object; the local loopback
    /// transport omits the member (optional-by-absence, never `null`).
    #[serde(
        default,
        rename = "hostHeaders",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(with = "BTreeMap<String, String>")]
    pub host_headers: Option<BTreeMap<String, String>>,
}

/// The handler→coordinator response envelope: the JSON body the handler
/// server answers `POST /invoke` with (`handler-server.mjs` `json(...)`
/// call sites). One of three mutually exclusive shapes, dispatched by the
/// receivers in mirrored order: `fatal` → `didNotSettle` → settled envelope
/// (`src/workerd_exec.rs` / `coordinator.js` `invokeHandler`).
///
/// On the local arm the response additionally proves its origin with the
/// `x-snapback-response-token` header echo before the body is read; that
/// transport-authentication echo is a header, not a body member.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(untagged, deny_unknown_fields)]
pub enum HandlerInvokeResponse {
    /// The harness refused or failed the invocation before settlement
    /// (transport auth, body limits, unknown route, missing deadline
    /// capability). Also carried on non-200 statuses.
    Fatal { fatal: String },
    /// The handler (or its detached work) outlived the settlement deadline;
    /// the invocation failed and committed no writes.
    DidNotSettle {
        #[serde(rename = "didNotSettle")]
        did_not_settle: bool,
        #[serde(rename = "deadlinePhase")]
        deadline_phase: HandlerDeadlinePhase,
        #[serde(rename = "unhandledRejections")]
        unhandled_rejections: Vec<String>,
        #[serde(rename = "rejectionDetectionSupported")]
        rejection_detection_supported: bool,
    },
    /// The invocation settled: `envelope` is the tagged completion envelope
    /// (pre-serialized JSON text; decoded by `parse_handler_output` /
    /// `parseHandlerEnvelope`), plus the unhandled-rejection sweep.
    Settled {
        envelope: String,
        #[serde(rename = "unhandledRejections")]
        unhandled_rejections: Vec<String>,
        #[serde(rename = "rejectionDetectionSupported")]
        rejection_detection_supported: bool,
    },
}

/// Which harness deadline expired (`handler-server.mjs` `deadlineResponse`).
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum HandlerDeadlinePhase {
    Settlement,
    Quiescence,
}

/// The handler→host call body: the JSON body of
/// `POST /_snapback/host-call` (`handler-server.mjs` `hostCall`), the same
/// path on both arms (LLP 0094 §0A.3 — one seam, one path). `rawOp` is
/// `"<epoch>|<op>"`; the epoch prefix is what makes a stale continuation
/// refusable. The host-call capability rides the `x-snapback-host-token`
/// header, not this body.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HandlerHostCallRequest {
    #[serde(rename = "rawOp")]
    pub raw_op: String,
    /// The op arguments, pre-serialized JSON text.
    #[serde(rename = "argsJson")]
    pub args_json: String,
}
