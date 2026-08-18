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
use snapback::manifest::{CapabilityManifest, CapabilityMaturity, TargetCapabilityId};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn committed_manifest_path(file_name: &str) -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("schemas")
        .join(file_name)
}

fn committed_cloudflare_manifest_path() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json")
}

fn committed_maturity_registry_path() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("tests/acceptance/capability-maturity.experimental.json")
}

fn committed_capability_registry_path() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join("tests/acceptance/capability-registry.ids.json")
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

// @ref LLP 0134#9-acceptance — A1 compares canonical emissions, never Rust or
// JavaScript source text. Rust remains runtime authority; the committed full
// registry and experimental arrays are reviewable projections used by the
// history-aware transition checker.
#[test]
fn capability_maturity_registry_matches_codegen_canonical_emission() {
    let mut registered_ids: Vec<&str> = TargetCapabilityId::ALL
        .into_iter()
        .map(TargetCapabilityId::as_str)
        .collect();
    registered_ids.sort_unstable();
    let registered_canonical =
        serde_json::to_string(&registered_ids).expect("emit Rust capability registry");

    let mut rust_ids: Vec<&str> = TargetCapabilityId::ALL
        .into_iter()
        .filter(|id| id.maturity() != CapabilityMaturity::Stable)
        .map(TargetCapabilityId::as_str)
        .collect();
    rust_ids.sort_unstable();
    let rust_canonical = serde_json::to_string(&rust_ids).expect("emit Rust maturity registry");
    println!("[maturity-registry] rust={rust_canonical}");

    let projection_path = committed_maturity_registry_path();
    let registry_projection_path = committed_capability_registry_path();
    if std::env::var("SNAPBACK_UPDATE_MATURITY_REGISTRY").is_ok() {
        fs::write(
            &registry_projection_path,
            format!("{registered_canonical}\n"),
        )
        .expect("write committed capability registry projection");
        fs::write(&projection_path, format!("{rust_canonical}\n"))
            .expect("write committed maturity registry projection");
    }
    assert_eq!(
        fs::read_to_string(&registry_projection_path)
            .expect("read committed capability registry projection")
            .trim_end(),
        registered_canonical,
        "the full history-check registry projection drifted; regenerate with \
         SNAPBACK_UPDATE_MATURITY_REGISTRY=1 cargo test \
         capability_maturity_registry_matches_codegen_canonical_emission",
    );
    assert_eq!(
        fs::read_to_string(&projection_path)
            .expect("read committed maturity registry projection")
            .trim_end(),
        rust_canonical,
        "the history-check projection drifted; regenerate with \
         SNAPBACK_UPDATE_MATURITY_REGISTRY=1 cargo test \
         capability_maturity_registry_matches_codegen_canonical_emission",
    );

    let output = Command::new("node")
        .args([
            "--input-type=module",
            "--eval",
            "import { experimentalTargetCapabilityIdsCanonicalJson as emit } from \
             './packages/snapback-codegen/index.mjs'; process.stdout.write(emit());",
        ])
        .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .output()
        .expect("run codegen maturity emitter");
    assert!(
        output.status.success(),
        "codegen maturity emitter failed: {}",
        String::from_utf8_lossy(&output.stderr),
    );
    let codegen_canonical = String::from_utf8(output.stdout).expect("codegen emits UTF-8");
    println!("[maturity-registry] codegen={codegen_canonical}");
    assert_eq!(codegen_canonical, rust_canonical);
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
fn agent_safe_publication_is_exact_for_every_generated_target_projection() {
    for manifest in [
        CapabilityManifest::local_v0_declared(),
        CapabilityManifest::remote_service_sqlite_ibex_declared(),
        CapabilityManifest::local_v0_outbound_actions_declared(),
        CapabilityManifest::cloudflare_do_sqlite_v8_declared(),
    ] {
        let profile = manifest.target_profile_id.clone();
        let value = serde_json::to_value(&manifest).expect("serialize target manifest");
        assert_eq!(value["agentSafe"]["schemaVersion"], "agentSafe.v1");
        assert_eq!(value["agentSafe"]["target"]["aggregate"]["core"], "Missing");
        assert_eq!(
            value["agentSafe"]["appEffective"]["aggregate"]["core"],
            "Missing"
        );
        assert_eq!(
            value["agentSafe"]["target"]["envelope"]["migration"],
            "Missing"
        );
        let storage_supported = manifest
            .supported_capabilities
            .contains(&TargetCapabilityId::AgentSafeStorageV1);
        let storage_gap = manifest
            .capability_gaps
            .iter()
            .any(|gap| gap == "agent_safe_storage_v1");
        assert_ne!(
            storage_supported, storage_gap,
            "{profile} storage support/GAP drifted"
        );
        if profile != "local-dev-sqlite-ibex" {
            assert!(
                !storage_supported,
                "{profile} inherited local-only storage support"
            );
        }
        for path in [
            ["ordinaryMutation", "hostPlan"],
            ["ordinaryMutation", "ibexBuffered"],
            ["hostChildMutation", "hostPlan"],
            ["hostChildMutation", "ibexBuffered"],
        ] {
            assert_eq!(
                value["agentSafe"]["target"]["envelope"][path[0]][path[1]],
                if storage_supported {
                    "Covered"
                } else {
                    "Missing"
                },
                "{profile} widened or omitted an envelope component",
            );
        }
        assert_eq!(
            value["agentSafe"]["target"]["explanation"]["scopedFacts"]
                .as_array()
                .expect("scoped explanation facts")
                .len(),
            if storage_supported { 2 } else { 0 },
            "{profile} explanation publication drifted",
        );
        assert!(
            manifest
                .capability_gaps
                .iter()
                .any(|gap| gap == "agent_safe_derived_deployment_fork_v1"),
            "{profile} omitted the derived-deployment GAP",
        );
        assert!(
            !manifest
                .supported_capabilities
                .contains(&TargetCapabilityId::AgentSafeDerivedDeploymentForkV1)
        );
    }
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
