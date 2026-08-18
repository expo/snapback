// LLP 0032 P8: the inspect payload is camelCase, consistently — the mixed
// camel/snake/Pascal payload is where the diary-0005 casing bug class lived.
// This test serializes the real admin and public inspect payloads and walks
// every key. Two subtrees are exempt by design and documented here:
//
//   - `schema` and `functions`: the embedded v0 generated artifacts, whose
//     wire shapes (`field_type`, host-plan `indexed_by`, externally-tagged
//     runtime variants, …) are the ratified LLP 0012 v0 artifact pin — their
//     casing is owned by that pin, not by the inspect payload.
//   - `capabilityManifest.capabilityMaturity`: keys are closed capability ids,
//     not payload fields, and intentionally use their registry wire spelling.
// Admin-only `ephemeral.activeRooms[].scope` keys are app data (whatever the
// app's collection declares), not payload keys. The public projection omits
// active room identities entirely.

use serde_json::Value;
use snapback::admin::{AdminInspect, ServerContext};
use snapback::local::{InspectState, LocalSnapback};
use snapback::manifest::{FunctionManifest, SchemaManifest};
use snapback::runtime::IbexCliCapability;
use std::fs;
use std::path::PathBuf;

fn generated(file: &str) -> String {
    let path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("demos/todo/snapback/generated")
        .join(file);
    fs::read_to_string(path).expect("read generated artifact")
}

fn configured_snapback() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let schema: SchemaManifest =
        serde_json::from_str(&generated("schema.manifest.json")).expect("schema manifest");
    let functions: FunctionManifest =
        serde_json::from_str(&generated("functions.manifest.json")).expect("functions manifest");
    snapback.apply_schema(schema).expect("apply schema");
    snapback.load_functions(functions);
    snapback
}

fn missing_external_cli_inspect() -> InspectState {
    let mut inspect = configured_snapback().inspect().expect("inspect");
    inspect.runtime.ibex_cli = IbexCliCapability {
        available: false,
        path: None,
        version: None,
    };
    if !inspect.capability_gaps.iter().any(|gap| gap == "ibex_cli") {
        inspect.capability_gaps.push("ibex_cli".to_owned());
    }
    inspect
}

fn is_camel_case(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() => {}
        _ => return false,
    }
    key.chars().all(|c| c.is_ascii_alphanumeric())
}

fn exempt(path: &str) -> bool {
    // The embedded v0 artifacts keep their ratified pinned shapes.
    path.starts_with(".schema.") || path == ".schema"
        || path.starts_with(".functions.") || path == ".functions"
        // Closed capability ids are dynamic map keys, not payload fields.
        || path.starts_with(".capabilityManifest.capabilityMaturity.")
        // App-declared scope field names are data, not payload keys.
        || path.contains(".scope.")
        // LLP 0058 capability registry ids (`relational_query_v1`, …) are
        // pinned snake_case identifiers; the maturity dimension keys its map
        // by id, so those keys are data, not payload field names. The map
        // was empty between LLP 0076's acceptance (bounded_response_stream_v1
        // went stable) and the LLP 0080/0081 experimental ids landing.
        || path.contains(".capabilityMaturity.")
}

fn walk(value: &Value, path: &str, offenders: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, inner) in map {
                let key_path = format!("{path}.{key}");
                if !exempt(&key_path) && !is_camel_case(key) {
                    offenders.push(key_path.clone());
                }
                walk(inner, &key_path, offenders);
            }
        }
        Value::Array(items) => {
            for item in items {
                walk(item, &format!("{path}[]"), offenders);
            }
        }
        _ => {}
    }
}

#[test]
fn p8_admin_inspect_payload_is_camel_case() {
    let mut snapback = configured_snapback();
    let inspect = snapback.inspect().expect("inspect");
    let admin = AdminInspect::assemble(inspect, &ServerContext::detached());
    let payload = serde_json::to_value(&admin).expect("serialize admin inspect");

    let mut offenders = Vec::new();
    walk(&payload, "", &mut offenders);
    assert!(
        offenders.is_empty(),
        "non-camelCase keys in the admin inspect payload:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn p8_public_inspect_payload_is_camel_case() {
    let mut snapback = configured_snapback();
    let public = snapback::local::PublicInspect::from(snapback.inspect().expect("inspect"));
    let payload = serde_json::to_value(&public).expect("serialize public inspect");

    let mut offenders = Vec::new();
    walk(&payload, "", &mut offenders);
    assert!(
        offenders.is_empty(),
        "non-camelCase keys in the public inspect payload:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn p8_diagnostic_severity_serializes_lowercase() {
    // The LLP 0012 diagnostic family is lowercase on the JS side; the Rust
    // serialization drifted PascalCase until P8. Old spellings still parse.
    let severity = snapback::diagnostic::DiagnosticSeverity::Error;
    assert_eq!(
        serde_json::to_value(&severity).unwrap(),
        Value::String("error".into())
    );
    let parsed: snapback::diagnostic::DiagnosticSeverity =
        serde_json::from_value(Value::String("Error".into())).expect("old spelling parses");
    assert_eq!(parsed, snapback::diagnostic::DiagnosticSeverity::Error);
}

#[test]
fn p8_missing_external_cli_stays_a_camel_case_capability_fact() {
    let inspect = missing_external_cli_inspect();
    let admin = serde_json::to_value(AdminInspect::assemble(
        inspect.clone(),
        &ServerContext::detached(),
    ))
    .expect("serialize admin inspect");
    let public = serde_json::to_value(snapback::local::PublicInspect::from(inspect))
        .expect("serialize public inspect");

    for (name, payload) in [("admin", admin), ("public", public)] {
        assert_eq!(payload["runtime"]["ibexCli"]["available"], false, "{name}");
        assert!(
            payload["capabilityGaps"]
                .as_array()
                .is_some_and(|gaps| gaps.iter().any(|gap| gap == "ibex_cli")),
            "{name}: {payload}"
        );
        assert!(
            payload["recentDiagnostics"]
                .as_array()
                .is_some_and(|diagnostics| diagnostics
                    .iter()
                    .all(|diagnostic| { diagnostic["code"] != "SNAPBACK_IBEX_CLI_UNAVAILABLE" })),
            "{name}: {payload}"
        );
    }
}
