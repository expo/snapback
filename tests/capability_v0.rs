// LLP 0032 P2: the capability manifest has one source of truth — the Rust
// core. The committed target manifests are generated from their corresponding
// `CapabilityManifest` declarations and consumed verbatim by publication
// tooling, which asserts — never authors — capabilities. These tests are the
// drift gates on both edges.
//
// Regenerate the committed files with:
//   SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_
//   cargo run --bin snapback-cf-manifest -- --out \
//     cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json
//
// @ref LLP 0037#decision-ratified-2026-07-02 — Rust types are the source of
//   truth for shared artifacts; the committed file is generated, and drift
//   fails CI instead of surfacing at runtime.

use serde_json::Value;
use snapback::local::LocalSnapback;
use snapback::manifest::CapabilityManifest;
use std::fs;
use std::path::PathBuf;

fn committed_manifest_path(file_name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("schemas")
        .join(file_name)
}

fn committed_cloudflare_manifest_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json")
}

fn declared_manifest_json(manifest: CapabilityManifest) -> Value {
    sorted_keys(serde_json::to_value(manifest).expect("serialize declared capability manifest"))
}

fn assert_committed_manifest(file_name: &str, declared: Value) {
    let path = committed_manifest_path(file_name);
    if std::env::var("SNAPBACK_UPDATE_CAPABILITY_MANIFEST").is_ok() {
        let rendered = format!(
            "{}\n",
            serde_json::to_string_pretty(&declared).expect("render declared manifest")
        );
        fs::write(&path, rendered).expect("write committed capability manifest");
    }
    let committed: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "{} is missing; regenerate with SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_",
            path.display()
        )
    }))
    .expect("parse committed capability manifest");
    assert_eq!(
        committed, declared,
        "the committed capability manifest drifted from the server declaration; regenerate with \
         SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_ and re-run codegen for consumers"
    );
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
    assert_committed_manifest(
        "capability.manifest.local-dev-sqlite-ibex.json",
        declared_manifest_json(CapabilityManifest::local_v0_declared()),
    );
    assert_committed_manifest(
        "capability.manifest.remote-service-sqlite-ibex.json",
        declared_manifest_json(CapabilityManifest::remote_service_sqlite_ibex_declared()),
    );
    assert_committed_manifest(
        "capability.manifest.local-dev-sqlite-ibex.outbound-actions.json",
        declared_manifest_json(CapabilityManifest::local_v0_outbound_actions_declared()),
    );
}

#[test]
fn p2_committed_cloudflare_manifest_matches_the_declared_target() {
    let path = committed_cloudflare_manifest_path();
    let committed: Value = serde_json::from_str(&fs::read_to_string(&path).expect(
        "Cloudflare capability manifest is missing; regenerate with cargo run --bin \
             snapback-cf-manifest -- --out \
             cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json",
    ))
    .expect("parse committed Cloudflare capability manifest");
    let declared = sorted_keys(
        serde_json::to_value(CapabilityManifest::cloudflare_do_sqlite_v8_declared())
            .expect("serialize declared Cloudflare capability manifest"),
    );

    assert_eq!(
        sorted_keys(committed),
        declared,
        "the committed Cloudflare capability manifest drifted from its Rust target declaration; \
         regenerate it with cargo run --bin snapback-cf-manifest -- --out \
         cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json"
    );
}

#[test]
fn p2_live_inspect_manifest_matches_committed_modulo_instance_fields() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let inspect = snapback.inspect().expect("inspect");
    let mut live =
        serde_json::to_value(&inspect.capability_manifest).expect("serialize live manifest");
    let declared = declared_manifest_json(CapabilityManifest::local_v0_declared());

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
