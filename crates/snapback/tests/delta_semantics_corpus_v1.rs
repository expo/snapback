//! LLP 0309.000 Stage-A executable operator-delta corpus.
//!
//! Normal runs are read-only. `SNAPBACK_FREEZE_DELTA_SEMANTICS=1` rewrites
//! expected verdicts and the per-case hash manifest from the pure reference
//! evaluator after deterministic double evaluation.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};
use snapback_delta_semantics::{
    DeltaSemanticsCase, DeltaSemanticsManifest, DeltaSemanticsManifestCase, evaluate_case,
};

const FORMAT: &str = "snapback.delta-semantics.case.v1";
const CORPUS: &str = "snapback.delta-semantics-v1";
const EVALUATOR: &str = "snapback.delta-semantics.reference.rust.v1";

fn corpus_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("tests")
        .join("conformance")
        .join("delta-semantics-v1")
}

fn sha256(raw: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(raw.as_bytes()))
}

fn pretty(value: &impl serde::Serialize) -> String {
    let mut raw = serde_json::to_string_pretty(value).expect("delta corpus JSON serializes");
    raw.push('\n');
    raw
}

fn case_paths(directory: &Path) -> Vec<PathBuf> {
    let mut paths = std::fs::read_dir(directory)
        .expect("read delta semantics corpus directory")
        .map(|entry| entry.expect("delta corpus entry").path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".case.json"))
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

#[test]
fn delta_semantics_v1_corpus_is_exact_deterministic_and_closed() {
    let directory = corpus_dir();
    let manifest_path = directory.join("corpus.manifest.json");
    let manifest: DeltaSemanticsManifest = serde_json::from_str(
        &std::fs::read_to_string(&manifest_path).expect("read delta semantics manifest"),
    )
    .expect("parse closed delta semantics manifest");
    assert_eq!(
        manifest.artifact_kind,
        "snapback.delta-semantics-corpus-manifest.v1"
    );
    assert_eq!(manifest.corpus, CORPUS);
    assert_eq!(manifest.corpus_format_version, 1);
    assert_eq!(manifest.evaluator_identity, EVALUATOR);
    let loaded_schema_path = "tests/conformance/delta-semantics-v1/case.schema.json";
    assert_eq!(
        manifest.case_schema_path, loaded_schema_path,
        "manifest caseSchemaPath must name the schema loaded by this runner"
    );

    let schema: Value = serde_json::from_str(
        &std::fs::read_to_string(directory.join("case.schema.json"))
            .expect("read delta semantics case schema"),
    )
    .expect("parse delta semantics case schema");
    let validator = jsonschema::validator_for(&schema).expect("compile delta semantics schema");

    let paths = case_paths(&directory);
    assert_eq!(
        paths.len(),
        manifest.cases.len(),
        "manifest/case count drift"
    );
    assert!(
        (60..=120).contains(&paths.len()),
        "LLP 0309.000 expects an order-60-to-120 corpus, found {}",
        paths.len()
    );

    let freeze = std::env::var_os("SNAPBACK_FREEZE_DELTA_SEMANTICS").is_some();
    let mut next_manifest_cases = Vec::with_capacity(paths.len());
    let mut fallback_reasons = BTreeSet::new();
    let mut names = BTreeSet::new();
    let mut read_maintains = Vec::new();
    for path in paths {
        let raw = std::fs::read_to_string(&path).expect("read delta semantics case");
        let mut value: Value = serde_json::from_str(&raw)
            .unwrap_or_else(|error| panic!("{}: JSON parse: {error}", path.display()));
        if !freeze {
            let errors = validator.iter_errors(&value).collect::<Vec<_>>();
            assert!(
                errors.is_empty(),
                "{}: schema errors: {errors:?}",
                path.display()
            );
        }
        let mut case: DeltaSemanticsCase = serde_json::from_value(value.clone())
            .unwrap_or_else(|error| panic!("{}: typed parse: {error}", path.display()));
        assert_eq!(case.format, FORMAT, "{}", case.name);
        assert!(
            names.insert(case.name.clone()),
            "duplicate case {}",
            case.name
        );

        let first = evaluate_case(&case);
        let second = evaluate_case(&case);
        assert_eq!(
            serde_json::to_vec(&first).unwrap(),
            serde_json::to_vec(&second).unwrap(),
            "{} determinism ×2",
            case.name
        );
        let mut reversed = case.clone();
        reversed.read_transcript.0.reverse();
        assert_eq!(
            serde_json::to_vec(&first).unwrap(),
            serde_json::to_vec(&evaluate_case(&reversed)).unwrap(),
            "{} transcript-set order independence",
            case.name
        );
        if case.name.ends_with("-empty-transcript") {
            assert!(
                case.read_transcript.0.is_empty(),
                "{} must be the exact empty-R rerun",
                case.name
            );
            assert_eq!(
                first.get("verdict").and_then(Value::as_str),
                Some("Fallback"),
                "{} read-requiring maintain must fall back without R",
                case.name
            );
        }
        if case.coverage.iter().any(|tag| tag == "read-maintain") {
            assert_eq!(
                first.get("verdict").and_then(Value::as_str),
                Some("Maintain"),
                "{} is tagged as a read-requiring maintain",
                case.name
            );
            read_maintains.push(case.name.clone());
        }
        if let Some(reason) = first.get("reason").and_then(Value::as_str) {
            fallback_reasons.insert(reason.to_owned());
        }
        if freeze {
            case.expected = first;
            value = serde_json::to_value(&case).expect("frozen case serializes");
            let next_raw = pretty(&value);
            std::fs::write(&path, &next_raw)
                .unwrap_or_else(|error| panic!("write {}: {error}", path.display()));
            next_manifest_cases.push(DeltaSemanticsManifestCase {
                name: case.name,
                path: path.file_name().unwrap().to_string_lossy().into_owned(),
                sha256: sha256(&next_raw),
                coverage: case.coverage,
            });
        } else {
            assert_eq!(
                first, case.expected,
                "{} exact reference verdict",
                case.name
            );
            let entry = manifest
                .cases
                .iter()
                .find(|entry| entry.name == case.name)
                .unwrap_or_else(|| panic!("{} absent from manifest", case.name));
            assert_eq!(
                path.file_name().unwrap().to_string_lossy(),
                entry.path,
                "{} path drift",
                case.name
            );
            assert_eq!(sha256(&raw), entry.sha256, "{} sha256", case.name);
            assert_eq!(case.coverage, entry.coverage, "{} coverage tags", case.name);
        }
    }

    for name in read_maintains {
        assert!(
            names.contains(&format!("{name}-empty-transcript")),
            "{name} lacks its exact empty-R rerun"
        );
    }

    if freeze {
        let next = DeltaSemanticsManifest {
            artifact_kind: "snapback.delta-semantics-corpus-manifest.v1".to_owned(),
            corpus: CORPUS.to_owned(),
            corpus_format_version: 1,
            case_schema_path: "tests/conformance/delta-semantics-v1/case.schema.json".to_owned(),
            evaluator_identity: EVALUATOR.to_owned(),
            cases: next_manifest_cases,
        };
        std::fs::write(&manifest_path, pretty(&next)).expect("write delta semantics manifest");
        return;
    }

    let expected_reasons = BTreeSet::from([
        "missing-image".to_owned(),
        "predicate-unanalyzable".to_owned(),
        "rank-undecidable".to_owned(),
        "boundary-displacement".to_owned(),
        "completeness-indeterminate".to_owned(),
        "rekey-unread".to_owned(),
        "scope-unfilled".to_owned(),
        "demand-identity-transition".to_owned(),
        "refusal-transition".to_owned(),
        "support-unproved".to_owned(),
        "scope-unresolved".to_owned(),
        "unique-violation".to_owned(),
        "wire-unaddressable".to_owned(),
    ]);
    assert_eq!(
        fallback_reasons, expected_reasons,
        "closed fallback reason coverage"
    );
}

#[test]
fn delta_semantics_v1_case_envelope_rejects_unknown_fields() {
    let path = case_paths(&corpus_dir()).remove(0);
    let mut value: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    value
        .as_object_mut()
        .unwrap()
        .insert("unknown".to_owned(), Value::Bool(true));
    assert!(serde_json::from_value::<DeltaSemanticsCase>(value).is_err());
}
