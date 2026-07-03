//! DK-7 / LLP 0037: the Rust serde types are the single source of truth for the
//! Snapback-owned shared artifact shapes. The JSON Schemas under `schemas/` are
//! generated from those types (`snapback::schema_export::artifact_schemas`) and
//! committed. These tests are:
//!   1. the drift gate — committed `schemas/*` byte/value-match the schema the
//!      Rust types generate right now (fails CI on an unregenerated type change);
//!   2. the round-trip gate — a representative value of each artifact serializes
//!      via serde_json and validates against the committed schema, proving the
//!      generated schema matches the actual serde representation;
//!   3. the demo-artifact gate — every committed generated demo manifest
//!      validates against the schema and parses back through the runtime struct.
//!
//! Regenerate the committed schemas with:
//!   DYLD_FRAMEWORK_PATH="$PWD/vendor/ibex/ios/Frameworks" \
//!     cargo run --bin snapback-schemagen
//!
//! @ref LLP 0037#decision-ratified-2026-07-02 — generated, committed,
//!   drift-gated schemas instead of hand-synced shape definitions.
//! @ref LLP 0032#decision-docket — DK-7 / P3(c): schemars-derived schemas + Rust drift gate.

use serde_json::{Value, json};
use std::fs;
use std::path::PathBuf;

use snapback::cron::CronInspectState;
use snapback::diagnostic::Diagnostic;
use snapback::ephemeral::EphemeralDiagnostics;
use snapback::local::{InspectState, LiveDeliveryStats, PublicInspect};
use snapback::manifest::{
    CapabilityManifest, FunctionManifest, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
    TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
};
use snapback::runtime::{
    CapabilityState, IbexCliCapability, IbexSubmoduleCapability, RuntimeCapabilities,
};
use snapback::schema_export::{SchemaArtifact, artifact_schemas};
use snapback::storage::StorageInfo;

fn schemas_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("schemas")
}

fn committed(file: &str) -> Value {
    let path = schemas_dir().join(file);
    let text = fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "{file} is missing; regenerate with `cargo run --bin snapback-schemagen` \
             (LLP 0037 / LLP 0032 P3c)"
        )
    });
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("parse committed {file}: {error}"))
}

fn assert_validates(file: &str, value: &Value) {
    let schema = committed(file);
    let validator = jsonschema::validator_for(&schema)
        .unwrap_or_else(|error| panic!("compile committed {file}: {error}"));
    let errors: Vec<String> = validator
        .iter_errors(value)
        .map(|error| format!("  {}: {error}", error.instance_path()))
        .collect();
    assert!(
        errors.is_empty(),
        "a representative value does not validate against the committed {file} — \
         the generated schema does not match the serde representation (schemars/serde \
         mismatch):\n{}",
        errors.join("\n")
    );
}

/// Drift gate: what the Rust types generate now must equal what is committed.
#[test]
fn dk7_committed_schemas_match_rust_types() {
    for SchemaArtifact { file, schema } in artifact_schemas() {
        let on_disk = committed(file);
        assert_eq!(
            on_disk, schema,
            "{file} drifted from the Rust types; regenerate with \
             `cargo run --bin snapback-schemagen` (LLP 0037 / LLP 0032 P3c)"
        );
    }
}

/// Every committed schema file has a corresponding generated artifact and vice
/// versa — a new artifact type without a committed schema (or a stray file) is a
/// failure, not a silent gap.
#[test]
fn dk7_every_artifact_has_a_committed_schema_file() {
    let generated: std::collections::BTreeSet<String> = artifact_schemas()
        .into_iter()
        .map(|a| a.file.to_owned())
        .collect();
    let committed: std::collections::BTreeSet<String> = fs::read_dir(schemas_dir())
        .expect("read schemas/ dir")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".schema.json"))
        .collect();
    assert_eq!(
        generated, committed,
        "schemas/ is out of sync with the generator; regenerate with \
         `cargo run --bin snapback-schemagen`"
    );
}

/// A representative InspectState literal exercising the full runtime/inspect
/// closure (manifests, runtime capabilities, cron, ephemeral, diagnostics).
fn representative_inspect() -> InspectState {
    InspectState {
        artifact_kind: "inspectState".to_owned(),
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
        target: "local".to_owned(),
        storage: StorageInfo {
            sqlite_path: None,
            version: 7,
            tables: vec!["todos".to_owned()],
        },
        runtime: RuntimeCapabilities {
            canonical_engine: "ibex".to_owned(),
            ibex_submodule: IbexSubmoduleCapability {
                present: true,
                path: None,
            },
            ibex_cli: IbexCliCapability {
                available: false,
                path: None,
                version: None,
            },
            host_plan_runtime: true,
            ibex_ctx_db_host_bridge: CapabilityState::Available,
            async_handler_completion: CapabilityState::Available,
            sqlite_lock_held_across_async: CapabilityState::NotYetWired,
        },
        schema: SchemaManifest::default(),
        functions: FunctionManifest::default(),
        capability_manifest: CapabilityManifest::local_v0(vec!["postgres".to_owned()]),
        subscriptions: vec![],
        active_connections: 0,
        reaped_connections: 0,
        live_delivery: LiveDeliveryStats::default(),
        ephemeral: EphemeralDiagnostics::default(),
        cron: CronInspectState {
            artifact_kind: "cronInspectState".to_owned(),
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            jobs: vec![],
            recent_runs: vec![],
            diagnostics: vec![],
        },
        recent_diagnostics: vec![Diagnostic::info("SNAPBACK_READY", "server", "ready")],
        capability_gaps: vec!["postgres".to_owned()],
    }
}

/// Round-trip gate: a representative value of every artifact serializes and
/// validates against its committed schema — the direct proof that the generated
/// schema matches the serde output.
#[test]
fn dk7_representative_values_validate_against_committed_schemas() {
    assert_validates(
        "schema.manifest.schema.json",
        &serde_json::to_value(SchemaManifest::default()).unwrap(),
    );
    assert_validates(
        "functions.manifest.schema.json",
        &serde_json::to_value(FunctionManifest::default()).unwrap(),
    );
    assert_validates(
        "capability.manifest.schema.json",
        &serde_json::to_value(CapabilityManifest::local_v0(vec!["postgres".to_owned()])).unwrap(),
    );
    assert_validates(
        "diagnostic.schema.json",
        &serde_json::to_value(
            Diagnostic::error("SNAPBACK_TEST", "storage", "boom")
                .with_details(json!({ "table": "todos" })),
        )
        .unwrap(),
    );
    assert_validates(
        "storage-info.schema.json",
        &serde_json::to_value(StorageInfo {
            sqlite_path: Some(PathBuf::from("/tmp/app.sqlite")),
            version: 3,
            tables: vec!["todos".to_owned()],
        })
        .unwrap(),
    );
    let inspect = representative_inspect();
    assert_validates(
        "inspect.schema.json",
        &serde_json::to_value(&inspect).unwrap(),
    );
    assert_validates(
        "inspect.public.schema.json",
        &serde_json::to_value(PublicInspect::from(inspect)).unwrap(),
    );
}

const GENERATED_BACKENDS: [&str; 5] = [
    "demos/todo/snapback/generated",
    "demos/todo-v2/snapback/generated",
    "demos/all-aboard/snapback/generated",
    "demos/all-aboard/tests/egress-probe/generated",
    "demos/cursors-web/snapback/generated",
];

/// Demo-artifact gate: every committed generated demo manifest validates against
/// the Rust-derived schema (the codegen output the schema is meant to describe).
#[test]
fn dk7_committed_demo_manifests_validate_against_schemas() {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let pairs = [
        ("schema.manifest.schema.json", "schema.manifest.json"),
        ("functions.manifest.schema.json", "functions.manifest.json"),
        (
            "capability.manifest.schema.json",
            "capability.manifest.json",
        ),
    ];
    for (schema_file, manifest_file) in pairs {
        let schema = committed(schema_file);
        let validator = jsonschema::validator_for(&schema)
            .unwrap_or_else(|error| panic!("compile {schema_file}: {error}"));
        for backend in GENERATED_BACKENDS {
            let path = repo.join(backend).join(manifest_file);
            let text = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
            let manifest: Value = serde_json::from_str(&text)
                .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
            let errors: Vec<String> = validator
                .iter_errors(&manifest)
                .map(|error| format!("  {}: {error}", error.instance_path()))
                .collect();
            assert!(
                errors.is_empty(),
                "{backend}/{manifest_file} does not validate against {schema_file}:\n{}",
                errors.join("\n")
            );
        }
    }
}

/// The committed demo manifests also parse back through the runtime structs and
/// pass their artifact-header validation — the schema and the parser agree.
#[test]
fn dk7_committed_demo_manifests_parse_through_runtime_structs() {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for backend in GENERATED_BACKENDS {
        let dir = repo.join(backend);
        let schema: SchemaManifest = serde_json::from_str(
            &fs::read_to_string(dir.join("schema.manifest.json")).expect("read schema manifest"),
        )
        .unwrap_or_else(|error| panic!("{backend}: schema manifest rejected: {error}"));
        schema.validate_artifact().expect("schema artifact header");
        let functions: FunctionManifest = serde_json::from_str(
            &fs::read_to_string(dir.join("functions.manifest.json"))
                .expect("read functions manifest"),
        )
        .unwrap_or_else(|error| panic!("{backend}: functions manifest rejected: {error}"));
        functions
            .validate_artifact()
            .expect("functions artifact header");
        let _capability: CapabilityManifest = serde_json::from_str(
            &fs::read_to_string(dir.join("capability.manifest.json"))
                .expect("read capability manifest"),
        )
        .unwrap_or_else(|error| panic!("{backend}: capability manifest rejected: {error}"));
    }
}
