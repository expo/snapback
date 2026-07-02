// LLP 0032 P3(c) / LLP 0037: the Rust types are the single source of truth
// for the shared artifact shapes. JSON Schemas are generated from them and
// committed under schemas/; these tests are the drift gate (committed schema
// == schema derived from the types) and the validation gate (every committed
// generated demo manifest validates against its schema and parses through the
// runtime structs).
//
// Regenerate the committed schemas with:
//   SNAPBACK_UPDATE_ARTIFACT_SCHEMAS=1 cargo test p3_
//
// @ref LLP 0037#decision-ratified-2026-07-02 — generated, committed,
//   drift-gated schemas instead of hand-synced shape definitions.

use serde_json::Value;
use snapback::host_ops::{HostOpsResult, HostReadyDescriptor};
use snapback::manifest::{CapabilityManifest, FunctionManifest, SchemaManifest};
use std::fs;
use std::path::PathBuf;

fn schemas_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("schemas")
}

/// (committed schema file, demo manifest file validated against it — None for
/// shapes that have no per-demo artifact, derived schema).
fn artifact_schemas() -> Vec<(&'static str, Option<&'static str>, Value)> {
    vec![
        (
            "schema.manifest.schema.json",
            Some("schema.manifest.json"),
            serde_json::to_value(schemars::schema_for!(SchemaManifest)).expect("schema schema"),
        ),
        (
            "functions.manifest.schema.json",
            Some("functions.manifest.json"),
            serde_json::to_value(schemars::schema_for!(FunctionManifest))
                .expect("functions schema"),
        ),
        (
            "capability.manifest.schema.json",
            Some("capability.manifest.json"),
            serde_json::to_value(schemars::schema_for!(CapabilityManifest))
                .expect("capability schema"),
        ),
        (
            "host-ops.result.schema.json",
            None,
            serde_json::to_value(schemars::schema_for!(HostOpsResult))
                .expect("host-ops result schema"),
        ),
        (
            "host-ready.schema.json",
            None,
            serde_json::to_value(schemars::schema_for!(HostReadyDescriptor))
                .expect("host-ready schema"),
        ),
    ]
}

// serde_json runs with preserve_order in this workspace; sort keys so the
// committed files are stable regardless of derive/field order churn.
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

#[test]
fn p3_committed_artifact_schemas_match_the_rust_types() {
    for (file, _manifest, derived) in artifact_schemas() {
        let derived = sorted_keys(derived);
        let path = schemas_dir().join(file);
        if std::env::var("SNAPBACK_UPDATE_ARTIFACT_SCHEMAS").is_ok() {
            let rendered = format!(
                "{}\n",
                serde_json::to_string_pretty(&derived).expect("render schema")
            );
            fs::write(&path, rendered).expect("write committed schema");
        }
        let committed: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap_or_else(
            |_| {
                panic!(
                    "{file} is missing; regenerate with SNAPBACK_UPDATE_ARTIFACT_SCHEMAS=1 \
                     cargo test p3_"
                )
            },
        ))
        .expect("parse committed schema");
        assert_eq!(
            committed, derived,
            "{file} drifted from the Rust types; regenerate with \
             SNAPBACK_UPDATE_ARTIFACT_SCHEMAS=1 cargo test p3_"
        );
    }
}

const GENERATED_BACKENDS: [&str; 5] = [
    "demos/todo/snapback/generated",
    "demos/todo-v2/snapback/generated",
    "demos/all-aboard/snapback/generated",
    "demos/all-aboard/tests/egress-probe/generated",
    "demos/cursors-web/snapback/generated",
];

#[test]
fn p3_committed_demo_manifests_validate_against_the_schemas() {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let validators: Vec<(&str, jsonschema::Validator)> = artifact_schemas()
        .into_iter()
        .filter_map(|(file, manifest_file, schema)| {
            let validator = jsonschema::validator_for(&schema)
                .unwrap_or_else(|error| panic!("compile {file}: {error}"));
            manifest_file.map(|manifest_file| (manifest_file, validator))
        })
        .collect();

    for backend in GENERATED_BACKENDS {
        for (manifest_file, validator) in &validators {
            let path = repo.join(backend).join(manifest_file);
            let manifest: Value = serde_json::from_str(
                &fs::read_to_string(&path)
                    .unwrap_or_else(|error| panic!("read {}: {error}", path.display())),
            )
            .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
            let errors: Vec<String> = validator
                .iter_errors(&manifest)
                .map(|error| format!("{}: {error}", error.instance_path()))
                .collect();
            assert!(
                errors.is_empty(),
                "{backend}/{manifest_file} does not validate against the Rust-derived schema:\n{}",
                errors.join("\n")
            );
        }
    }
}

#[test]
fn p3_committed_demo_manifests_parse_through_the_runtime_structs() {
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
