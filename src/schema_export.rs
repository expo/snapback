//! Generated JSON Schemas for the Snapback-owned shared artifact shapes.
//!
//! The Rust serde types are the single source of truth (LLP 0037, Rust-first).
//! The JSON Schemas committed under `schemas/` are *generated* from those types
//! by [`artifact_schemas`]; nothing is hand-authored. There is exactly one
//! generator and two callers, so the committed files cannot diverge from the
//! checker: the `snapback-schemagen` bin writes the files, and
//! `tests/artifact_schemas_v0.rs` regenerates in-memory and fails on any diff
//! (the CI drift gate LLP 0012 §Versioning requires).
//!
//! Scope fence (LLP 0037): this governs Snapback-owned artifacts only. The
//! Exact-owned `ContractDataManifest` is not derived here.
//!
//! @ref LLP 0037#decision-ratified-2026-07-02 — Rust serde types are the source
//!   of truth; JSON Schemas are generated from them and drift-gated.
//! @ref LLP 0032#decision-docket — DK-7 / P3(c): schemars-derived, committed, drift-gated.

use serde_json::Value;

use crate::admin::AdminInspect;
use crate::data_tier::{DataTierCorpusCase, DataTierCorpusManifest, DataTierProfile};
use crate::diagnostic::Diagnostic;
use crate::ephemeral::RealtimeEnvelope;
use crate::host_ops::{DryRunReport, HostOpsResult, HostReadyDescriptor};
use crate::live_wire::{LiveEnvelope, LiveSocketClientMessage, LiveSocketServerFrame, Receipt};
use crate::local::{
    InspectState, LiveResumeInput, LiveResumeOutput, LiveSubscribeInput, LiveSubscribeOutput,
    LiveUnsubscribeInput, LiveUnsubscribeOutput, PublicInspect,
};
use crate::manifest::{
    CapabilityManifest, FunctionManifest, HandlerInput, MutationAcknowledgementRequest,
    MutationAcknowledgementResponse, MutationRequest, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
};
use crate::server::{ConnectionGrant, ErrorResponse, MutationResponse, OpenConnectionRequest};
use crate::storage::StorageInfo;

/// A generated schema artifact: the committed file name (relative to the
/// repo-root `schemas/` directory) and the JSON Schema derived from a Rust type.
pub struct SchemaArtifact {
    /// File name under `schemas/`, e.g. `schema.manifest.schema.json`.
    pub file: &'static str,
    /// The generated JSON Schema, with sorted keys for a stable committed diff.
    pub schema: Value,
}

/// The single generator for every Snapback-owned committed schema.
///
/// Both the `snapback-schemagen` bin (which writes `schemas/`) and the drift
/// gate in `tests/artifact_schemas_v0.rs` (which compares) call this, so the
/// generated output and the gate can never diverge.
pub fn artifact_schemas() -> Vec<SchemaArtifact> {
    vec![
        finish(
            "schema.manifest.schema.json",
            schemars::schema_for!(SchemaManifest),
        ),
        finish(
            "functions.manifest.schema.json",
            schemars::schema_for!(FunctionManifest),
        ),
        finish(
            "data-tier.profile.schema.json",
            schemars::schema_for!(DataTierProfile),
        ),
        finish(
            "data-tier.corpus.schema.json",
            schemars::schema_for!(DataTierCorpusManifest),
        ),
        finish(
            "data-tier.case.schema.json",
            schemars::schema_for!(DataTierCorpusCase),
        ),
        finish(
            "capability.manifest.schema.json",
            schemars::schema_for!(CapabilityManifest),
        ),
        finish("diagnostic.schema.json", schemars::schema_for!(Diagnostic)),
        finish("inspect.schema.json", schemars::schema_for!(InspectState)),
        finish(
            "inspect.public.schema.json",
            schemars::schema_for!(PublicInspect),
        ),
        finish(
            "storage-info.schema.json",
            schemars::schema_for!(StorageInfo),
        ),
        finish(
            "host-ops.result.schema.json",
            schemars::schema_for!(HostOpsResult),
        ),
        finish(
            "host-ready.schema.json",
            schemars::schema_for!(HostReadyDescriptor),
        ),
        // The mutationDryRun report (LLP 0051 D8 / Increment 4): the
        // function.explain result the Exact-side Acto dry-run wraps. Embeds
        // CtxAnswerLedger, putting the D1 ledger wire shape under the DK-7
        // gate (the ENG-23892 deferral).
        finish(
            "dry-run.report.schema.json",
            schemars::schema_for!(DryRunReport),
        ),
        finish(
            "inspect.admin.schema.json",
            schemars::schema_for!(AdminInspect),
        ),
        // The client-visible live wire (LLP 0051 D4 / ENG-23891): fan-out
        // envelopes, socket control frames both directions, receipts, the
        // HTTP polling wrapper, the connection grant, the error envelope,
        // and the live HTTP operation outputs.
        finish(
            "live.envelope.schema.json",
            schemars::schema_for!(LiveEnvelope),
        ),
        finish(
            "live.socket-server.schema.json",
            schemars::schema_for!(LiveSocketServerFrame),
        ),
        finish(
            "live.socket-client.schema.json",
            schemars::schema_for!(LiveSocketClientMessage),
        ),
        finish("receipt.schema.json", schemars::schema_for!(Receipt)),
        finish(
            "realtime.envelope.schema.json",
            schemars::schema_for!(RealtimeEnvelope),
        ),
        finish(
            "connection.grant.schema.json",
            schemars::schema_for!(ConnectionGrant),
        ),
        finish(
            "connection.open.input.schema.json",
            schemars::schema_for!(OpenConnectionRequest),
        ),
        finish(
            "error.response.schema.json",
            schemars::schema_for!(ErrorResponse),
        ),
        finish(
            "mutation.output.schema.json",
            schemars::schema_for!(MutationResponse),
        ),
        finish(
            "live.subscribe.output.schema.json",
            schemars::schema_for!(LiveSubscribeOutput),
        ),
        finish(
            "live.subscribe.input.schema.json",
            schemars::schema_for!(LiveSubscribeInput),
        ),
        finish(
            "live.resume.output.schema.json",
            schemars::schema_for!(LiveResumeOutput),
        ),
        finish(
            "live.resume.input.schema.json",
            schemars::schema_for!(LiveResumeInput),
        ),
        finish(
            "live.unsubscribe.output.schema.json",
            schemars::schema_for!(LiveUnsubscribeOutput),
        ),
        finish(
            "live.unsubscribe.input.schema.json",
            schemars::schema_for!(LiveUnsubscribeInput),
        ),
        finish(
            "query.input.schema.json",
            schemars::schema_for!(HandlerInput),
        ),
        finish(
            "mutation.input.schema.json",
            schemars::schema_for!(MutationRequest),
        ),
        finish(
            "client-mutation.ack.input.schema.json",
            schemars::schema_for!(MutationAcknowledgementRequest),
        ),
        finish(
            "client-mutation.ack.output.schema.json",
            schemars::schema_for!(MutationAcknowledgementResponse),
        ),
    ]
}

/// Generated public artifact instances owned by the Rust authority. These are
/// committed beside the schemas so a pinned git checkout is sufficient for a
/// non-Rust consumer.
pub fn artifact_instances() -> Vec<SchemaArtifact> {
    vec![SchemaArtifact {
        file: "data-tier.profile.json",
        schema: sorted_keys(
            serde_json::to_value(DataTierProfile::current())
                .expect("data-tier profile serializes to JSON"),
        ),
    }]
}

/// Convert a derived schema to a stable committed value: serialize it, stamp the
/// Snapback schema version onto its `$id`, and sort keys.
fn finish(file: &'static str, schema: impl serde::Serialize) -> SchemaArtifact {
    let mut value = serde_json::to_value(&schema).expect("derived schema serializes to JSON");
    stamp_schema_version(&mut value, file);
    SchemaArtifact {
        file,
        schema: sorted_keys(value),
    }
}

/// Stamp the Snapback schema version onto the schema's top-level `$id` so every
/// committed file carries its version and can be read without a cargo toolchain.
/// A `SNAPBACK_SCHEMA_VERSION` bump therefore shows up as a reviewable diff on
/// every schema and trips the drift gate — the versioning behavior LLP 0037 and
/// LLP 0012 §Versioning call for. The `$id` uses only same-document fragment
/// `$ref`s below it, so setting a base URI does not change validation.
fn stamp_schema_version(value: &mut Value, file: &str) {
    if let Value::Object(map) = value {
        let stem = file.strip_suffix(".schema.json").unwrap_or(file);
        map.insert(
            "$id".to_owned(),
            Value::String(format!(
                "https://schemas.snapback.dev/{SNAPBACK_SCHEMA_VERSION}/{stem}.schema.json"
            )),
        );
    }
}

/// Recursively sort object keys. `serde_json` runs with `preserve_order` in this
/// workspace (a transitive feature), so without this the committed files would
/// churn on derive/field-order changes; sorting makes the output canonical.
fn sorted_keys(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|(a, _), (b, _)| a.cmp(b));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, inner)| (key, sorted_keys(inner)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sorted_keys).collect()),
        other => other,
    }
}
