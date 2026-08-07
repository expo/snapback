//! LLP 0146 D7's draft remediation-kind discipline, pending OQ6.
//!
//! The test validates data against the checked-in schema and then pins the
//! cross-entry safety rules that JSON Schema cannot express as clearly
//! (unique kinds and the exact machine-applicable set). Nothing here installs
//! a remediation carrier on a wire surface.

use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;

const SCHEMA_PATH: &str = "schemas/remediation-kinds.v0.schema.json";
const REGISTRY_PATH: &str = "schemas/remediation-kinds.v0.registry.json";

fn read_json(path: &str) -> Value {
    serde_json::from_str(
        &fs::read_to_string(path).unwrap_or_else(|error| panic!("read {path}: {error}")),
    )
    .unwrap_or_else(|error| panic!("parse {path}: {error}"))
}

#[test]
fn draft_registry_validates_and_keeps_the_d7_axes_independent() {
    let schema = read_json(SCHEMA_PATH);
    let registry = read_json(REGISTRY_PATH);
    let validator = jsonschema::validator_for(&schema).expect("compile remediation schema");
    let errors = validator
        .iter_errors(&registry)
        .map(|error| error.to_string())
        .collect::<Vec<_>>();
    assert!(errors.is_empty(), "registry schema failures: {errors:#?}");
    assert_eq!(registry["status"], "draft-pending-oq6");

    let kinds = registry["kinds"].as_array().expect("registry kinds");
    let unique = kinds
        .iter()
        .map(|entry| entry["kind"].as_str().expect("kind"))
        .collect::<BTreeSet<_>>();
    assert_eq!(
        unique.len(),
        kinds.len(),
        "remediation kinds must be unique"
    );

    let machine_applicable = kinds
        .iter()
        .filter(|entry| entry["machineApplicable"] == true)
        .map(|entry| entry["kind"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        machine_applicable,
        BTreeSet::from(["fixTypo", "regenerateArtifacts", "replaceIdentifier"]),
    );
    for entry in kinds
        .iter()
        .filter(|entry| entry["machineApplicable"] == true)
    {
        assert_eq!(entry["riskClass"], "mechanical");
        assert_eq!(entry["requiresApproval"], false);
        assert_eq!(entry["authorityEffect"], "none");
        assert_eq!(entry["precondition"]["type"], "artifact-hash");
        assert!(
            entry["precondition"]["required"]
                .as_array()
                .unwrap()
                .iter()
                .any(|field| field == "artifactHash")
        );
    }

    let principal_change = kinds
        .iter()
        .find(|entry| entry["authorityEffect"] == "changes-effective-principal")
        .expect("principal-changing kind");
    assert_eq!(principal_change["requiresApproval"], true);
    assert_eq!(principal_change["machineApplicable"], false);
}

#[test]
fn schema_rejects_stale_hash_free_machine_applicability_and_unapproved_principal_change() {
    let schema = read_json(SCHEMA_PATH);
    let registry = read_json(REGISTRY_PATH);
    let validator = jsonschema::validator_for(&schema).expect("compile remediation schema");

    let mut missing_hash = registry.clone();
    missing_hash["kinds"][0]["precondition"]["required"] = serde_json::json!(["grantableScope"]);
    assert!(validator.iter_errors(&missing_hash).next().is_some());

    let mut unapproved_principal = registry;
    let principal = unapproved_principal["kinds"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|entry| entry["kind"] == "useDifferentPrincipal")
        .unwrap();
    principal["requiresApproval"] = Value::Bool(false);
    assert!(
        validator
            .iter_errors(&unapproved_principal)
            .next()
            .is_some()
    );
}
