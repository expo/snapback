// LLP 0032 P2: the capability manifest has one source of truth — the Rust
// core. The committed schemas/capability.manifest.local-dev-sqlite-ibex.json
// is generated from `CapabilityManifest::local_v0_declared()` and embedded
// verbatim by codegen (packages/snapback-codegen), which asserts — never
// authors — capabilities. These tests are the drift gates on both edges.
//
// Regenerate the committed file with:
//   SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_
//
// @ref LLP 0037#decision-ratified-2026-07-02 — Rust types are the source of
//   truth for shared artifacts; the committed file is generated, and drift
//   fails CI instead of surfacing at runtime.

use serde_json::Value;
use snapback::local::LocalSnapback;
use snapback::manifest::CapabilityManifest;
use std::fs;
use std::path::PathBuf;

fn committed_manifest_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("schemas/capability.manifest.local-dev-sqlite-ibex.json")
}

fn declared_manifest_json() -> Value {
    sorted_keys(
        serde_json::to_value(CapabilityManifest::local_v0_declared())
            .expect("serialize declared capability manifest"),
    )
}

// serde_json runs with preserve_order in this workspace, so sort object keys
// recursively before rendering: the committed file then matches byte-for-byte
// what codegen's stableJson emits into each demo's generated directory.
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
fn p2_committed_capability_manifest_matches_the_declared_server_manifest() {
    let declared = declared_manifest_json();
    let path = committed_manifest_path();
    if std::env::var("SNAPBACK_UPDATE_CAPABILITY_MANIFEST").is_ok() {
        let rendered = format!(
            "{}\n",
            serde_json::to_string_pretty(&declared).expect("render declared manifest")
        );
        fs::write(&path, rendered).expect("write committed capability manifest");
    }
    let committed: Value = serde_json::from_str(&fs::read_to_string(&path).expect(
        "schemas/capability.manifest.local-dev-sqlite-ibex.json is missing; regenerate with \
             SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_",
    ))
    .expect("parse committed capability manifest");
    assert_eq!(
        committed, declared,
        "the committed capability manifest drifted from the server declaration; regenerate with \
         SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_ and re-run codegen for the demos"
    );
}

#[test]
fn p2_live_inspect_manifest_matches_committed_modulo_instance_fields() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let inspect = snapback.inspect().expect("inspect");
    let mut live =
        serde_json::to_value(&inspect.capability_manifest).expect("serialize live manifest");
    let declared = declared_manifest_json();

    // Exactly two fields are instance-live (LLP 0012 §Capability Manifest):
    // `vmLifecycle` reports the DK-4 posture actually in force, and the
    // `ibex_cli` gap appears when the CLI is unavailable. Normalize those two
    // and require byte equality on everything else, so any new divergence
    // between the declaration and the live report fails here.
    let live_object = live.as_object_mut().expect("manifest object");
    let live_vm = live_object
        .insert("vmLifecycle".to_owned(), declared["vmLifecycle"].clone())
        .expect("live vmLifecycle present");
    assert!(
        live_vm == Value::String("fresh-per-invocation".to_owned())
            || live_vm == Value::String("warm-pooled-reset".to_owned()),
        "unexpected live vmLifecycle {live_vm}"
    );
    live_object
        .get_mut("capabilityGaps")
        .expect("capabilityGaps present")
        .as_array_mut()
        .expect("capabilityGaps array")
        .retain(|gap| gap != "ibex_cli");

    assert_eq!(
        live, declared,
        "the live /inspect capability manifest diverged from the committed declaration beyond \
         the two documented instance-live fields"
    );
}
