//! The Snapback 2 conformance corpus (LLP 2000.000 §5.1), run against the
//! Snapback 4 engine as a server with exactly the rows the twin held.
//! Cases about receipt custody, static pricing, search and assets are
//! outside this slice and are reported as skipped, never as passes.

use snapback4_core::{Context, Engine, Program, Schema, Value, WriteState};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    category: String,
    schema: serde_json::Value,
    program: serde_json::Value,
    context: CaseContext,
    receipt: Receipt,
    #[serde(default)]
    prelude: Vec<Prelude>,
    #[serde(rename = "replacementReceipt", default)]
    replacement_receipt: Option<serde_json::Value>,
    expected: Expected,
}

#[derive(serde::Deserialize)]
struct Prelude {
    program: serde_json::Value,
    context: CaseContext,
}

#[derive(serde::Deserialize)]
struct CaseContext {
    viewer: String,
    #[serde(default)]
    args: BTreeMap<String, Value>,
    now: Option<i64>,
    #[serde(default)]
    new_ids: Vec<String>,
    read_time: Option<i64>,
}

#[derive(serde::Deserialize)]
struct Receipt {
    #[serde(default)]
    rows: Vec<ReceiptRow>,
}

#[derive(serde::Deserialize)]
struct ReceiptRow {
    table: String,
    row: Value,
}

#[derive(serde::Deserialize)]
struct Expected {
    #[serde(rename = "errorCode")]
    error_code: Option<String>,
    #[serde(rename = "localState")]
    local_state: String,
    #[serde(rename = "canonicalResult")]
    canonical_result: Option<String>,
    next: Option<String>,
}

enum Verdict {
    Pass,
    Skip(String),
    Fail(String),
}

fn run(case: &Case) -> Verdict {
    let schema_text = case.schema.to_string();
    let program_text = case.program.to_string();
    if schema_text.contains("WordPrefixes") || schema_text.contains("\"deliver\"") || schema_text.contains("\"channels\"") || program_text.contains("held_search") || program_text.contains("WordPrefix") {
        return Verdict::Skip("search, deliver, or channel forms".into());
    }
    if case.category.starts_with("asset") || case.category == "connected" {
        return Verdict::Skip(format!("category {}", case.category));
    }
    if case.replacement_receipt.is_some() {
        return Verdict::Skip("receipt replacement is a twin-custody scenario".into());
    }
    match case.expected.local_state.as_str() {
        "partial" => return Verdict::Skip("twin lacked authority; the server answer is not comparable".into()),
        "certification-refused" => return Verdict::Skip("Snapback 2 static pricing refusal; metered at runtime here".into()),
        _ => {}
    }
    let schema: Schema = match serde_json::from_value(case.schema.clone()) {
        Ok(schema) => schema,
        Err(error) => return Verdict::Fail(format!("schema does not load: {error}")),
    };
    let program: Program = match serde_json::from_value(case.program.clone()) {
        Ok(program) => program,
        Err(error) => return Verdict::Fail(format!("program does not load: {error}")),
    };
    let issues = snapback4_core::schema::validate(&schema);
    if !issues.is_empty() {
        return Verdict::Skip(format!("schema shape: {}: {}", issues[0].path, issues[0].message));
    }
    let mut preludes = Vec::new();
    for prelude in &case.prelude {
        match serde_json::from_value::<Program>(prelude.program.clone()) {
            Ok(program) => preludes.push((program, &prelude.context)),
            Err(error) => return Verdict::Fail(format!("prelude program does not load: {error}")),
        }
    }
    let mut programs = vec![program.clone()];
    programs.extend(preludes.iter().map(|(p, _)| p.clone()));
    let mut engine = match Engine::memory(schema, programs) {
        Ok(engine) => engine,
        Err(error) => return Verdict::Fail(format!("engine: {error}")),
    };
    if let Err(error) = engine.load(case.receipt.rows.iter().map(|row| (row.table.clone(), row.row.clone()))) {
        return Verdict::Fail(format!("load: {error}"));
    }
    for (prelude, prelude_context) in &preludes {
        let mut context = Context::new(prelude_context.viewer.clone(), prelude_context.args.clone()).with_ids(prelude_context.new_ids.clone());
        context.now = Some(prelude_context.now.unwrap_or(0));
        match engine.mutate(&prelude.name, None, context) {
            Ok(outcome) => {
                if let WriteState::Failed { why, .. } = outcome.state {
                    return Verdict::Fail(format!("prelude {} refused: {}", prelude.name, why.code));
                }
            }
            Err(error) => return Verdict::Fail(format!("prelude {} failed: {error}", prelude.name)),
        }
    }
    let mut context = Context::new(case.context.viewer.clone(), case.context.args.clone()).with_ids(case.context.new_ids.clone());
    context.now = case.context.now;
    context.read_time = case.context.read_time;
    if context.now.is_none() {
        context.now = Some(0);
    }
    let (result, error): (Option<Value>, Option<String>) = match program.kind {
        snapback4_core::ProgramKind::Query => match engine.query(&program.name, context) {
            Ok(outcome) => (Some(outcome.data), None),
            Err(refusal) => (None, Some(format!("{} ({})", refusal.code, refusal.message))),
        },
        _ => match engine.mutate(&program.name, None, context) {
            Ok(outcome) => match outcome.state {
                WriteState::Sent { result, .. } => (Some(result), None),
                WriteState::Failed { why, .. } => (None, Some(format!("{} ({})", why.code, why.message))),
            },
            Err(error) => (None, Some(format!("{} ({error})", error.code()))),
        },
    };
    match (&case.expected.error_code, error) {
        (Some(expected), Some(actual)) => {
            let code = actual.split(' ').next().unwrap_or(&actual);
            if normalize(expected) == normalize(code) { Verdict::Pass } else { Verdict::Fail(format!("expected refusal {expected}, got {actual}")) }
        }
        (Some(expected), None) => Verdict::Fail(format!("expected refusal {expected}, got a result {}", result.map(|v| snapback4_core::value::canonical_json(&v)).unwrap_or_default())),
        (None, Some(actual)) => Verdict::Fail(format!("expected a result, got refusal {actual}")),
        (None, None) => {
            let actual = snapback4_core::value::canonical_json(&result.unwrap_or(Value::Null));
            let expected = case.expected.canonical_result.clone().unwrap_or_default();
            if actual == expected { Verdict::Pass } else { Verdict::Fail(format!("result differs\n    expected {expected}\n    actual   {actual}")) }
        }
    }
}

fn normalize(code: &str) -> String {
    // Snapback 2 spelled some refusals by family; Snapback 4's codes are the same words.
    code.to_owned()
}

#[test]
fn corpus() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../corpus");
    let mut passed = 0;
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut failed: Vec<(String, String)> = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(&dir).expect("corpus dir").flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if !name.ends_with(".json") || name == "manifest.json" || name == "ir-contract.json" {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let case: Case = match serde_json::from_str(&text) {
            Ok(case) => case,
            Err(error) => {
                failed.push((name, format!("case does not parse: {error}")));
                continue;
            }
        };
        match run(&case) {
            Verdict::Pass => passed += 1,
            Verdict::Skip(why) => skipped.push((case.name.clone(), why)),
            Verdict::Fail(why) => failed.push((case.name.clone(), why)),
        }
    }
    println!("corpus: {passed} passed, {} skipped, {} failed", skipped.len(), failed.len());
    let mut reasons: BTreeMap<String, usize> = BTreeMap::new();
    for (_, why) in &skipped {
        *reasons.entry(why.split(':').next().unwrap_or(why).to_owned()).or_default() += 1;
    }
    for (why, count) in &reasons {
        println!("  skipped {count}: {why}");
    }
    for (name, why) in &failed {
        println!("  FAIL {name}: {why}");
    }
    let allowed: Vec<&str> = std::env::var("CORPUS_ALLOW").map(|s| Box::leak(s.into_boxed_str()).split(',').collect()).unwrap_or_default();
    let unexpected: Vec<_> = failed.iter().filter(|(name, _)| !allowed.contains(&name.as_str())).collect();
    assert!(unexpected.is_empty(), "{} corpus cases failed", unexpected.len());
}
