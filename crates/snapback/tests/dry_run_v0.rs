//! LLP 0051 D8 (Increment 4, ENG-23896): `mutationDryRun` — execute-and-
//! discard on the buffered substrate with ctx-answer ledgers, served as
//! `function.explain` kind `mutationDryRun`. Fidelity is the commit path
//! itself with the final COMMIT swapped for ROLLBACK, so both tiers answer
//! with evidence: the IR tier (todo-v2, all HostPlan) and the Ibex tier
//! (todo, IbexModule).

use serde_json::{Value, json};
use snapback::host_ops::{HostOpsRequest, execute_host_op};
use snapback::local::LocalSnapback;
use snapback::manifest::{AuthInput, HandlerInput, ReadDependency};
use std::fs;
use std::path::PathBuf;

fn generated(demo: &str, file: &str) -> Value {
    let path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("demos")
        .join(demo)
        .join("snapback/generated")
        .join(file);
    serde_json::from_str(&fs::read_to_string(path).expect("read generated artifact"))
        .expect("parse generated artifact")
}

fn envelope(snapback: &mut LocalSnapback, body: Value) -> Value {
    let request: HostOpsRequest = serde_json::from_value(body).expect("host-ops request parses");
    let result = execute_host_op(snapback, request, Some("http://127.0.0.1:0".to_owned()));
    serde_json::to_value(&result).expect("envelope serializes")
}

fn loaded(demo: &str) -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let schema = envelope(
        &mut snapback,
        json!({ "operation": "schema.load", "schema": generated(demo, "schema.manifest.json") }),
    );
    assert_eq!(schema["ok"], json!(true), "schema.load: {schema}");
    let functions = envelope(
        &mut snapback,
        json!({ "operation": "functions.load", "functions": generated(demo, "functions.manifest.json") }),
    );
    assert_eq!(functions["ok"], json!(true), "functions.load: {functions}");
    snapback
}

fn dry_run(snapback: &mut LocalSnapback, function: &str, args: Value) -> Value {
    envelope(
        snapback,
        json!({
            "operation": "function.explain",
            "kind": "mutationDryRun",
            "function": function,
            "args": args,
            "userId": "user_dryrun",
        }),
    )
}

fn database_version(snapback: &mut LocalSnapback) -> Value {
    envelope(snapback, json!({ "operation": "app.inspect" }))["artifacts"]["databaseVersion"]
        .clone()
}

fn rows_of(snapback: &mut LocalSnapback, query: &str) -> Vec<Value> {
    let run = envelope(
        snapback,
        json!({ "operation": "function.run", "function": query, "userId": "user_dryrun" }),
    );
    assert_eq!(run["ok"], json!(true), "query run: {run}");
    run["data"]["functionResult"]["rows"]
        .as_array()
        .cloned()
        .expect("query rows")
}

#[test]
fn ir_dry_run_predicts_writes_and_discards_them() {
    let mut snapback = loaded("todo-v2");
    let version_before = database_version(&mut snapback);

    let explained = dry_run(
        &mut snapback,
        "createTodo",
        json!({ "title": "buy milk", "priority": "p2" }),
    );
    assert_eq!(explained["ok"], json!(true), "explain: {explained}");
    let report = &explained["data"]["dryRun"];
    assert_eq!(report["kind"], json!("mutationDryRun"));
    assert_eq!(report["tier"], json!("hostPlan"));
    assert_eq!(report["wouldCommit"], json!(true), "report: {report}");
    assert_eq!(report["denied"], json!(false));
    assert_eq!(report["sideEffects"], json!([]));
    // No client baseline and no plan reads: staleness was not checked.
    assert_eq!(report["readSetValidation"], json!("notChecked"));
    assert_eq!(report["snapshotVersion"], version_before);

    // Exact predicted writes: one todos insert whose id IS the ledger answer.
    assert_eq!(report["predictedWrites"].as_array().map(Vec::len), Some(1));
    let predicted = &report["predictedWrites"][0];
    assert_eq!(predicted["table"], json!("todos"));
    assert_eq!(predicted["op"], json!("insert"));
    let ledger_ids = report["deterministicInputs"]["ids"]
        .as_array()
        .cloned()
        .expect("ledger ids");
    assert_eq!(ledger_ids.len(), 1);
    assert_eq!(&ledger_ids[0], &predicted["id"]);
    assert!(report["deterministicInputs"]["now"].as_u64().unwrap_or(0) > 0);
    // The write set carries the row the insert would have produced.
    assert_eq!(report["writeSet"][0]["row"]["title"], json!("buy milk"));

    // propose → simulate → inspect writes → commit: the envelope points at
    // the commit step.
    assert_eq!(explained["next"][0]["operation"], json!("function.run"));

    // And it was a DRY run: nothing durable moved.
    assert_eq!(rows_of(&mut snapback, "listTodosOnce"), Vec::<Value>::new());
    assert_eq!(database_version(&mut snapback), version_before);
}

#[test]
fn ir_dry_run_then_commit_matches_prediction() {
    let mut snapback = loaded("todo-v2");
    let explained = dry_run(
        &mut snapback,
        "createTodo",
        json!({ "title": "ship it", "priority": "p1" }),
    );
    let predicted = explained["data"]["dryRun"]["predictedWrites"][0].clone();
    assert_eq!(predicted["table"], json!("todos"));
    assert_eq!(predicted["op"], json!("insert"));

    let committed = envelope(
        &mut snapback,
        json!({
            "operation": "function.run",
            "function": "createTodo",
            "args": { "title": "ship it", "priority": "p1" },
            "userId": "user_dryrun",
        }),
    );
    assert_eq!(committed["ok"], json!(true), "commit: {committed}");
    let rows = rows_of(&mut snapback, "listTodosOnce");
    assert_eq!(rows.len(), 1, "exactly the committed row: {rows:?}");
    assert_eq!(rows[0]["title"], json!("ship it"));
}

#[test]
fn ir_dry_run_missed_patch_predicts_zero_writes() {
    let mut snapback = loaded("todo-v2");
    let explained = dry_run(
        &mut snapback,
        "editTitle",
        json!({ "id": "todo_missing", "title": "renamed" }),
    );
    assert_eq!(explained["ok"], json!(true), "explain: {explained}");
    let report = &explained["data"]["dryRun"];
    // A patch that matches no row commits zero changes — same answer the
    // commit path gives (ChangedCount 0), now knowable without committing.
    assert_eq!(report["wouldCommit"], json!(true));
    assert_eq!(report["predictedWrites"], json!([]));
    assert_eq!(report["result"], json!(0));
}

#[test]
fn ibex_dry_run_records_ledger_and_discards() {
    let mut snapback = loaded("todo");
    let version_before = database_version(&mut snapback);

    let explained = dry_run(&mut snapback, "createTodo", json!({ "title": "ibex milk" }));
    assert_eq!(explained["ok"], json!(true), "explain: {explained}");
    let report = &explained["data"]["dryRun"];
    assert_eq!(report["tier"], json!("ibexModule"));
    assert_eq!(report["wouldCommit"], json!(true));
    assert_eq!(report["predictedWrites"][0]["table"], json!("todos"));
    assert_eq!(report["predictedWrites"][0]["op"], json!("insert"));
    // The handler ran for real under a recording ctx: the buffered insert's
    // row id is a ledger answer (one ordered generatedIds sequence).
    let ledger_ids = report["deterministicInputs"]["ids"]
        .as_array()
        .cloned()
        .expect("ibex ledger ids");
    assert!(!ledger_ids.is_empty(), "ledger records generated ids");

    // Discarded: no durable row, no version bump.
    assert_eq!(rows_of(&mut snapback, "listTodosOnce"), Vec::<Value>::new());
    assert_eq!(database_version(&mut snapback), version_before);
}

#[test]
fn stale_client_read_set_reports_stale_not_committed() {
    let mut snapback = loaded("todo-v2");
    // A client baseline that claims a row exists at version 7 when it never
    // existed: the same SNAPBACK_MUTATION_CONFLICT a real commit raises,
    // reported as evidence instead of an error envelope.
    let input = HandlerInput {
        args: json!({ "id": "todo_missing", "title": "renamed" }),
        auth: AuthInput {
            principal: None,
            session_id: None,
            user_id: Some("user_dryrun".to_owned()),
            ..AuthInput::default()
        },
        read_set: vec![ReadDependency {
            table: "todos".to_owned(),
            id: "todo_missing".to_owned(),
            version: 7,
        }],
        correlation: None,
        ctx_ledger: None,
    };
    let outcome = snapback
        .dry_run_mutation("editTitle", input)
        .expect("dry-run attempt");
    assert!(!outcome.would_commit);
    assert!(!outcome.denied);
    assert_eq!(outcome.read_set_validation, "stale");
    assert_eq!(
        outcome.failure.expect("failure diagnostic").code,
        "SNAPBACK_MUTATION_CONFLICT"
    );
}

#[test]
fn dry_run_rejects_non_mutations_and_unknown_functions() {
    let mut snapback = loaded("todo-v2");
    let query = dry_run(&mut snapback, "listTodosOnce", json!({}));
    assert_eq!(query["ok"], json!(false));
    assert_eq!(
        query["diagnostics"][0]["code"],
        json!("SNAPBACK_FUNCTION_KIND_MISMATCH")
    );

    let unknown = dry_run(&mut snapback, "nope", json!({}));
    assert_eq!(unknown["ok"], json!(false));
}

#[test]
fn inspect_reports_the_dry_run_capability() {
    let mut snapback = loaded("todo-v2");
    let inspect = envelope(&mut snapback, json!({ "operation": "app.inspect" }));
    assert_eq!(
        inspect["data"]["runtimeState"]["runtime"]["mutationDryRun"],
        json!(true),
        "mutationDryRun capability is the honest wire marker until the LLP 0042 catalog lands"
    );
}
