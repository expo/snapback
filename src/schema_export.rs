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
use crate::diagnostic::Diagnostic;
use crate::host_ops::{HostOpsResult, HostReadyDescriptor};
use crate::local::{InspectState, PublicInspect};
use crate::manifest::{
    CapabilityManifest, FunctionManifest, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
};
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
        finish(
            "inspect.admin.schema.json",
            schemars::schema_for!(AdminInspect),
        ),
    ]
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
