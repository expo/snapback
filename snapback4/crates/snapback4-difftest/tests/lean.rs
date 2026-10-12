//! The engine against the Lean model (LLP 3000.035 §5.2): the emitter covers
//! the generated corpus with named exceptions, the comparison's canonical
//! forms and signatures, and, with the model built, a fixed-seed campaign and
//! the retained findings. Tests that need `quarry-oracle` skip loudly when it
//! is not built; `SNAPBACK4_REQUIRE_LEAN=1` makes its absence a failure.
use serde_json::json;
use snapback4_difftest::{
    campaign, execute,
    lean::{self, Canon},
    oracle::{Oracle, Verdict},
    shrink,
};
use std::collections::BTreeSet;

/// Open signatures, classified in `cases/found/lean--*/DIAGNOSIS.md`: OPEN C2
/// (a filled page's `next`) and OPEN W4 (a hidden clash on an absent upsert's
/// insert arm). A new one fails the fixed-seed run: diagnose it first.
const CLASSIFIED: [&str; 4] = [
    // C2
    "lean--continuation-next--next~no-next",
    "lean--next--next~no-next",
    // W4
    "lean--code--E_RULE~NOT_FOUND",
    "lean--prelude-code--E_RULE~NOT_FOUND",
];
/// Resolved findings kept as regressions: each now replays as a pass.
/// - OPEN C9: a cursorless filled page has no `next` (a model defect, fixed).
/// - OPEN R2: the unnamed update rule judged only the next image, an engine
///   defect (security) fixed 2026-10-08 (`b2036dd821`); the widened shapes
///   reached it under eight more signatures.
/// - OPEN E4: the model refused field access on a null base, a model defect
///   (`why E_FIELD`), fixed 2026-10-08.
/// - OPEN C8: a readable grant decides the page (LLP 3000.036 §12.1); the
///   model gained the arm 2026-10-12, and a stale oracle build showed it
///   again on a merged tree (now refreshed by `lean::refresh`).
const RESOLVED: [&str; 24] = [
    // C9
    "lean--next--no-next~next",
    // R2
    "lean--kind--committed~NOT_FOUND",
    "lean--kind--committed~E_RULE",
    "lean--code--E_CONSTRAINT~NOT_FOUND",
    "lean--code--E_OVERFLOW~NOT_FOUND",
    "lean--code--REQUIRED~NOT_FOUND",
    "lean--prelude-code--E_CONSTRAINT~E_RULE",
    "lean--prelude-code--E_CONSTRAINT~NOT_FOUND",
    "lean--prelude-code--REQUIRED~NOT_FOUND",
    "lean--prelude-kind--committed~E_RULE",
    "lean--prelude-kind--committed~NOT_FOUND",
    // E4
    "lean--code--E_CONSTRAINT~E_MODEL_TYPE",
    "lean--code--E_OVERFLOW~E_MODEL_TYPE",
    "lean--code--E_RULE~E_MODEL_TYPE",
    "lean--code--NOT_FOUND~E_MODEL_TYPE",
    "lean--code--REQUIRED~E_MODEL_TYPE",
    "lean--kind--committed~E_MODEL_TYPE",
    "lean--prelude-code--E_CONSTRAINT~E_MODEL_TYPE",
    "lean--prelude-code--E_OVERFLOW~E_MODEL_TYPE",
    "lean--prelude-code--E_RULE~E_MODEL_TYPE",
    "lean--prelude-code--NOT_FOUND~E_MODEL_TYPE",
    "lean--prelude-code--REQUIRED~E_MODEL_TYPE",
    "lean--prelude-kind--committed~E_MODEL_TYPE",
    // C8
    "lean--complete--complete~incomplete",
];

fn model_built() -> bool {
    // A stale `.lake` build is another model (a merge left one, 2026-10-12).
    lean::refresh().unwrap_or_else(|e| panic!("{e}"));
    let path = lean::oracle_path();
    if path.is_file() {
        return true;
    }
    if std::env::var_os("SNAPBACK4_REQUIRE_LEAN").is_some() {
        panic!("SNAPBACK4_REQUIRE_LEAN is set but {} is missing: cd snapback4/lean && lake build", path.display());
    }
    eprintln!("SKIPPED (Lean oracle not built at {}): cd snapback4/lean && lake build", path.display());
    false
}

#[test]
fn the_emitter_covers_the_generated_corpus_with_named_exceptions() {
    let mut supported = 0;
    let mut reasons = BTreeSet::new();
    for seed in 0..3000 {
        let case = lean::generate(seed);
        let source = case.program.source();
        execute::compile(&source).unwrap_or_else(|e| panic!("seed {seed} does not compile: {e}"));
        let module = match lean::module(&source) {
            Ok(m) => m,
            // Only expiry is outside the model at the schema level (the campaign drops int ranges).
            Err(r) => {
                assert_eq!(r, "table-expiry", "seed {seed}");
                reasons.insert(r);
                continue;
            }
        };
        match module.program("run") {
            Ok(_) => {
                supported += 1;
                module.store(&case.rows).unwrap();
                module.tag_args("run", &case.args).unwrap();
                module.program("observe").ok();
            }
            Err(u) => {
                reasons.insert(u.reason);
            }
        }
    }
    // Outside it: the unpaged aggregates, page projections (`shape`), the
    // loop of a prefetch-reachable fold, and expiry, which the model leaves out.
    assert_eq!(reasons, ["call-max", "call-min", "call-sum", "loop", "shape", "table-expiry"].map(String::from).into());
    assert!(supported > 2000, "{supported}");
}

#[test]
fn canonical_values_and_signatures() {
    use snapback4_core::Value;
    let row: Value = Value::Row([("id".to_string(), Value::Id("r0".into())), ("n".to_string(), Value::Int(-3)), ("t".to_string(), Value::String("é".into()))].into_iter().collect());
    assert_eq!(
        lean::engine_value(&Value::Array(vec![row, Value::Null, Value::Bool(true)])),
        json!({"arr": [{"row": {"id": {"id": "r0"}, "n": {"int": "-3"}, "t": {"text": "é"}}}, {"null": null}, {"bool": true}]})
    );
    // The model's rows are ordered pairs; the comparison is by field.
    assert_eq!(
        lean::model_value(&json!({"arr": [{"row": [["t", {"text": "é"}], ["id", {"id": "r0"}], ["n", {"int": "-3"}]]}]})),
        json!({"arr": [{"row": {"id": {"id": "r0"}, "n": {"int": "-3"}, "t": {"text": "é"}}}]})
    );
    // An id never equals the same text (OPEN V1).
    assert_ne!(lean::engine_value(&Value::Id("x".into())), lean::model_value(&json!({"text": "x"})));
    let answer = |next| Canon { kind: "answer".into(), code: None, data: Some(json!({"arr": []})), complete: Some(true), next };
    assert_eq!(lean::differ(&answer(true), &answer(true)), None);
    assert_eq!(lean::signature("next", &answer(false), &answer(true)), "lean--next--no-next~next");
    let refused = Canon { kind: "refused".into(), code: Some("E_RULE".into()), data: None, complete: None, next: false };
    let committed = Canon { kind: "committed".into(), code: None, data: Some(json!({"bool": true})), complete: None, next: false };
    assert_eq!(lean::differ(&committed, &refused), Some("kind"));
    assert_eq!(lean::signature("kind", &committed, &refused), "lean--kind--committed~E_RULE");
    let mut other = refused.clone();
    other.code = Some("NOT_FOUND".into());
    assert_eq!(lean::differ(&refused, &other), Some("code"));
    // A model answer the harness cannot read is never a verdict.
    assert_eq!(lean::model_canon(&json!({"kind": "error"})).kind, "error");
}

#[test]
fn fixed_seed_campaign_against_the_model() {
    if !model_built() {
        return;
    }
    let out = std::env::temp_dir().join(format!("quarry-lean-smoke-{}", std::process::id()));
    let report = lean::run_bounded(0, 400, &out, None).unwrap();
    std::fs::remove_dir_all(&out).ok();
    let counts = &report.by_oracle["lean"];
    assert_eq!(counts.attempted, 400);
    assert!(report.generator_errors.is_empty(), "{:?}", report.generator_errors);
    assert!(counts.passed + counts.disagreeing >= 280, "{counts:?}");
    for signature in counts.signatures.keys() {
        assert!(CLASSIFIED.contains(&signature.as_str()), "unclassified Lean disagreement {signature}: shrink, diagnose and record it under cases/found/");
    }
    // Pages continued on both sides' own cursors were compared.
    assert!(report.store_stats["lean-continued-reads"] > 10);
}

#[test]
fn retained_lean_findings_still_reproduce() {
    if !model_built() {
        return;
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("cases/found");
    let mut seen = BTreeSet::new();
    for entry in std::fs::read_dir(&root).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_str().unwrap().to_owned();
        if !name.starts_with("lean--") {
            continue;
        }
        assert!(path.join("DIAGNOSIS.md").is_file(), "{name} has no DIAGNOSIS.md");
        let artifact: shrink::Artifact = serde_json::from_slice(&std::fs::read(path.join("case.json")).unwrap()).unwrap();
        assert!(matches!(artifact.finding.oracle, Oracle::Lean));
        match shrink::replay(&path).unwrap() {
            Verdict::Pass if RESOLVED.contains(&name.as_str()) => {}
            Verdict::Disagree(f) if CLASSIFIED.contains(&name.as_str()) => assert_eq!(f.signature, name),
            other => panic!("{name} changed ({other:?}): diagnose, update its DIAGNOSIS.md and this test"),
        }
        seen.insert(name);
    }
    assert_eq!(seen, CLASSIFIED.iter().chain(&RESOLVED).map(|s| s.to_string()).collect::<BTreeSet<_>>());
}

#[test]
fn isolated_lean_workers_agree_with_serial_counts() {
    if !model_built() {
        return;
    }
    let root = std::env::temp_dir().join(format!("quarry-lean-workers-{}", std::process::id()));
    let executable = std::path::Path::new(env!("CARGO_BIN_EXE_snapback4-difftest"));
    let mut one = serde_json::to_value(campaign::parallel_command(0, 24, 1, &root.join("one"), executable, "run-lean", None).unwrap()).unwrap();
    let mut two = serde_json::to_value(campaign::parallel_command(0, 24, 3, &root.join("two"), executable, "run-lean", None).unwrap()).unwrap();
    for name in ["seconds", "slowest_case_seconds", "slowest_case_seed"] {
        one.as_object_mut().unwrap().remove(name);
        two.as_object_mut().unwrap().remove(name);
    }
    assert_eq!(one, two);
    std::fs::remove_dir_all(root).unwrap();
}
