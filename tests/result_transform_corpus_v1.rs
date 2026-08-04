//! Rust executor for the LLP 0051 D5 `result-transform.v1` extension.
//!
//! The committed JSON cases are the contract. This runner recomputes every
//! TransformHashV1, executes the dormant Rust reference, compares exact JCS
//! outcome bytes, and can emit the machine-readable half of the evidence
//! receipt.
//!
//! @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
//!   one data corpus, typed refusals, pinned identities, exact runtimes.
//! @ref LLP 0166#ship-gate — passing this reference corpus does not wire or
//!   admit local evaluation.

use serde_json::Value;
use sha2::{Digest, Sha256};
use snapback::result_transform::{
    RESULT_TRANSFORM_V1_CORPUS, RESULT_TRANSFORM_V1_CORPUS_FORMAT_VERSION,
    RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID, RESULT_TRANSFORM_V1_PROFILE_VERSION,
    RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID, ResultTransformCorpusCaseV1,
    ResultTransformCorpusManifestV1, canonical_result_transform_json_v1,
    evaluate_result_transform_v1, outcome_value, parse_transform_plan_v1, transform_hash_v1,
};
use std::path::PathBuf;

fn corpus_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("conformance")
        .join("data-tier")
        .join("result-transform-v1")
}

fn sha256(value: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(value.as_bytes()))
}

#[test]
fn result_transform_v1_corpus_is_exact_on_the_rust_reference() {
    let directory = corpus_dir();
    let manifest: ResultTransformCorpusManifestV1 = serde_json::from_str(
        &std::fs::read_to_string(directory.join("corpus.manifest.json"))
            .expect("read result-transform corpus manifest"),
    )
    .expect("parse result-transform corpus manifest through the Rust-owned shape");
    assert_eq!(manifest.corpus, RESULT_TRANSFORM_V1_CORPUS);
    assert_eq!(
        manifest.corpus_format_version,
        RESULT_TRANSFORM_V1_CORPUS_FORMAT_VERSION
    );
    assert_eq!(
        manifest.profile_version,
        RESULT_TRANSFORM_V1_PROFILE_VERSION
    );
    assert_eq!(manifest.extension_of.corpus, "snapback-data-tier");
    assert_eq!(manifest.extension_of.cases, 37);
    assert_eq!(
        manifest.evaluator_identities.rust,
        RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID
    );
    assert_eq!(
        manifest.evaluator_identities.javascript,
        RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID
    );

    let mut paths = std::fs::read_dir(&directory)
        .expect("read result-transform corpus directory")
        .map(|entry| entry.expect("corpus directory entry").path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".case.json"))
        })
        .collect::<Vec<_>>();
    paths.sort();
    assert_eq!(
        paths.len(),
        manifest.cases.len(),
        "manifest/case count drift"
    );
    assert_eq!(
        paths.len(),
        56,
        "the v1 result-transform extension has 56 cases"
    );

    let mut receipt_cases = Vec::with_capacity(paths.len());
    for path in paths {
        let raw = std::fs::read_to_string(&path).expect("read result-transform case");
        assert!(
            !raw.contains("$ANY_"),
            "{}: placeholder remains",
            path.display()
        );
        let case: ResultTransformCorpusCaseV1 = serde_json::from_str(&raw)
            .unwrap_or_else(|error| panic!("{}: case does not parse: {error}", path.display()));
        assert_eq!(case.corpus, RESULT_TRANSFORM_V1_CORPUS, "{}", case.name);
        assert_eq!(
            case.corpus_version, RESULT_TRANSFORM_V1_CORPUS_FORMAT_VERSION,
            "{}",
            case.name
        );
        let entry = manifest
            .cases
            .iter()
            .find(|entry| entry.name == case.name)
            .unwrap_or_else(|| panic!("{} missing from manifest", case.name));
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some(entry.path.as_str()),
            "{} path drift",
            case.name
        );
        assert_eq!(sha256(&raw), entry.sha256, "{} content hash", case.name);
        assert_eq!(
            entry.transform_hash, case.expect.transform_hash,
            "{} manifest transform hash",
            case.name
        );

        let transform_hash = parse_transform_plan_v1(&case.plan)
            .and_then(|plan| transform_hash_v1(&plan))
            .ok();
        assert_eq!(
            transform_hash, case.expect.transform_hash,
            "{} Rust TransformHashV1",
            case.name
        );

        let outcome = outcome_value(evaluate_result_transform_v1(
            &case.plan,
            &case.executing_materialization_key,
            &case.projected_fields,
            &case.base,
            case.client_overlay_rows.as_deref(),
        ));
        assert_eq!(
            outcome, case.expect.outcome,
            "{} structural outcome",
            case.name
        );
        let outcome_jcs = canonical_result_transform_json_v1(&outcome)
            .unwrap_or_else(|error| panic!("{} outcome JCS: {error:?}", case.name));
        let expected_jcs = canonical_result_transform_json_v1(&case.expect.outcome)
            .unwrap_or_else(|error| panic!("{} expected JCS: {error:?}", case.name));
        assert_eq!(
            outcome_jcs, expected_jcs,
            "{} exact outcome bytes",
            case.name
        );

        receipt_cases.push(serde_json::json!({
            "name": case.name,
            "transformHash": transform_hash,
            "outcomeJcs": outcome_jcs,
        }));
    }

    if let Some(path) = std::env::var_os("SNAPBACK_RESULT_TRANSFORM_RUST_OUTCOMES_PATH") {
        let receipt = serde_json::json!({
            "artifactKind": "snapback.result-transform-rust-outcomes.v1",
            "corpus": RESULT_TRANSFORM_V1_CORPUS,
            "corpusFormatVersion": RESULT_TRANSFORM_V1_CORPUS_FORMAT_VERSION,
            "profileVersion": RESULT_TRANSFORM_V1_PROFILE_VERSION,
            "evaluatorIdentity": RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID,
            "cases": receipt_cases,
        });
        let mut rendered = serde_json::to_string_pretty(&receipt).expect("receipt serializes");
        rendered.push('\n');
        std::fs::write(&path, rendered).unwrap_or_else(|error| {
            panic!("failed to write {}: {error}", PathBuf::from(path).display())
        });
    }
}

#[test]
fn result_transform_v1_corpus_shell_is_closed() {
    let path = corpus_dir().join("base-empty-result.case.json");
    let mut value: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    value
        .as_object_mut()
        .expect("case object")
        .insert("unknown".to_owned(), Value::Bool(true));
    let error = serde_json::from_value::<ResultTransformCorpusCaseV1>(value)
        .expect_err("unknown corpus envelope fields refuse");
    assert!(error.to_string().contains("unknown field"));
}
