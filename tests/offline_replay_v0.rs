//! LLP 0043 M1/M2 / ENG-23965: durable client mutation identity, exact
//! ctx-ledger replay, and reconnect-safe exactly-once settlement.

use serde_json::{Value, json};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, CtxAnswerLedger, FunctionManifest, HandlerInput, PermissionScopeExpr,
    SchemaManifest, auth_fingerprint,
};
use std::fs;
use std::path::{Path, PathBuf};

const USER: &str = "user_offline";

fn generated(file: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("demos/todo-v2/snapback/generated")
        .join(file);
    serde_json::from_str(&fs::read_to_string(path).expect("read generated artifact"))
        .expect("parse generated artifact")
}

fn artifacts() -> (SchemaManifest, FunctionManifest) {
    let schema = serde_json::from_value(generated("schema.manifest.json")).expect("schema");
    let mut functions: FunctionManifest =
        serde_json::from_value(generated("functions.manifest.json")).expect("functions");
    let create = functions
        .functions
        .iter_mut()
        .find(|function| function.name == "createTodo")
        .expect("createTodo definition");
    create.permission_epoch_bumps = vec![PermissionScopeExpr::AuthUser];
    if !create
        .required_capabilities
        .iter()
        .any(|capability| capability == "permission_epoch_resync")
    {
        create
            .required_capabilities
            .push("permission_epoch_resync".to_owned());
    }
    (schema, functions)
}

fn configure(mut snapback: LocalSnapback) -> LocalSnapback {
    let (schema, functions) = artifacts();
    snapback.apply_schema(schema).expect("apply schema");
    snapback.load_functions(functions);
    snapback
}

fn memory() -> LocalSnapback {
    configure(LocalSnapback::memory().expect("memory snapback"))
}

fn open(path: &Path) -> LocalSnapback {
    configure(LocalSnapback::open(path).expect("file snapback"))
}

fn input_for(user: &str, args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            principal: Some("user".to_owned()),
            session_id: Some(format!("session:{user}")),
            user_id: Some(user.to_owned()),
        },
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn create_input(user: &str) -> HandlerInput {
    input_for(user, json!({ "title": "offline todo", "priority": "high" }))
}

fn epoch(snapback: &mut LocalSnapback, connection: &str) -> u64 {
    let subscription = snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: connection.to_owned(),
                input: input_for(USER, json!({})),
                supersedes: None,
            },
        )
        .expect("live subscription");
    subscription
        .permission_epochs
        .get(&format!("user:{USER}"))
        .copied()
        .unwrap_or_default()
}

#[test]
fn duplicate_client_identity_is_exactly_once_and_survives_reopen() {
    // Cross-language fixture shared with client-store.mjs.
    assert_eq!(
        auth_fingerprint(&AuthInput {
            principal: Some(USER.to_owned()),
            session_id: None,
            user_id: Some(USER.to_owned()),
        }),
        "fnv1a:2b4ee138e8fc12c8"
    );
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("offline.db");
    let mutation_id = "client:offline:create:1".to_owned();

    let mut snapback = open(&path);
    let invalid_id = snapback
        .invoke_mutation_recording_with_id(
            "createTodo",
            create_input(USER),
            Some("bad/id".to_owned()),
            "test",
        )
        .0
        .expect_err("invalid client mutation ids fail before execution");
    assert_eq!(
        invalid_id.diagnostic.code,
        "SNAPBACK_CLIENT_MUTATION_ID_INVALID"
    );
    let (first, first_receipt) = snapback.invoke_mutation_recording_with_id(
        "createTodo",
        create_input(USER),
        Some(mutation_id.clone()),
        "test",
    );
    let first = first.expect("first commit");
    assert_eq!(first.changed_count, 1);
    assert_eq!(first_receipt["mutationId"], json!(mutation_id));
    let version = snapback.durable_version().expect("version");
    assert_eq!(epoch(&mut snapback, "epoch_after_first"), 1);

    // Same-process retry returns the original wire output but performs no
    // epoch bump, version advance, write, or fan-out side effect.
    let duplicate = snapback
        .invoke_mutation_recording_with_id(
            "createTodo",
            create_input(USER),
            Some(mutation_id.clone()),
            "test",
        )
        .0
        .expect("duplicate result");
    assert_eq!(duplicate, first);
    assert_eq!(snapback.durable_version(), Some(version));
    assert_eq!(epoch(&mut snapback, "epoch_after_duplicate"), 1);
    drop(snapback);

    // The settlement record is in the same file-backed SQLite database as
    // the row, so process/app reload cannot create a ghost duplicate.
    let mut reopened = open(&path);
    let duplicate_after_reopen = reopened
        .invoke_mutation_recording_with_id(
            "createTodo",
            create_input(USER),
            Some(mutation_id.clone()),
            "test",
        )
        .0
        .expect("reopened duplicate result");
    assert_eq!(duplicate_after_reopen, first);
    assert_eq!(reopened.durable_version(), Some(version));
    let rows = reopened
        .invoke_query("listTodos", input_for(USER, json!({})))
        .expect("query")
        .rows;
    assert_eq!(
        rows.len(),
        1,
        "duplicate delivery must not duplicate the row"
    );

    let payload_error = reopened
        .invoke_mutation_recording_with_id(
            "createTodo",
            input_for(
                USER,
                json!({ "title": "different logical mutation", "priority": "high" }),
            ),
            Some(mutation_id.clone()),
            "test",
        )
        .0
        .expect_err("changed payload must not alias an existing identity");
    assert_eq!(
        payload_error.diagnostic.code,
        "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
    );

    let auth_error = reopened
        .invoke_mutation_recording_with_id(
            "createTodo",
            create_input("another_user"),
            Some(mutation_id.clone()),
            "test",
        )
        .0
        .expect_err("changed authority must fail");
    assert_eq!(auth_error.diagnostic.code, "SNAPBACK_AUTH_STALE_RESULT");

    let reuse_error = reopened
        .invoke_mutation_recording_with_id(
            "deleteTodo",
            input_for(USER, json!({ "id": first.result })),
            Some(mutation_id),
            "test",
        )
        .0
        .expect_err("cross-function identity reuse must fail");
    assert_eq!(
        reuse_error.diagnostic.code,
        "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
    );

    // Reset is an intentional destruction of durable application state. Its
    // exactly-once settlements must be destroyed in the same operation, or a
    // fresh mutation could receive an output for a row the reset removed.
    reopened.reset().expect("reset database and settlements");
    let after_reset = reopened
        .invoke_mutation_recording_with_id(
            "createTodo",
            create_input(USER),
            Some("client:offline:create:1".to_owned()),
            "test",
        )
        .0
        .expect("reset releases the old mutation identity");
    assert_eq!(after_reset.changed_count, 1);
    assert_ne!(after_reset.result, first.result);
}

#[test]
fn host_plan_record_and_replay_consume_the_ledger_exactly() {
    let mut recorder = memory();
    let recorded = recorder
        .invoke_mutation("createTodo", create_input(USER))
        .expect("record mutation");
    let ledger = recorded.ctx_ledger.clone().expect("host plan ledger");
    assert_eq!(ledger.ids.len(), 1);
    assert_eq!(recorded.result, json!(ledger.ids[0]));

    let mut replayer = memory();
    let mut replay_input = create_input(USER);
    replay_input.ctx_ledger = Some(ledger.clone());
    let replayed = replayer
        .invoke_mutation("createTodo", replay_input)
        .expect("replay mutation");
    assert_eq!(replayed.result, recorded.result);
    assert_eq!(replayed.ctx_ledger, Some(ledger.clone()));

    let mut exhausted = memory();
    let mut exhausted_input = create_input(USER);
    exhausted_input.ctx_ledger = Some(CtxAnswerLedger {
        ids: Vec::new(),
        ..ledger.clone()
    });
    let error = exhausted
        .invoke_mutation("createTodo", exhausted_input)
        .expect_err("short ledger must fail");
    assert_eq!(error.diagnostic.code, "SNAPBACK_CTX_LEDGER_EXHAUSTED");
    assert_eq!(exhausted.durable_version(), Some(0));

    let mut unused = memory();
    let mut extra_ledger = ledger;
    extra_ledger.ids.push("unused-id".to_owned());
    let mut unused_input = create_input(USER);
    unused_input.ctx_ledger = Some(extra_ledger);
    let error = unused
        .invoke_mutation("createTodo", unused_input)
        .expect_err("unused ledger answers must fail");
    assert_eq!(error.diagnostic.code, "SNAPBACK_CTX_LEDGER_UNUSED_IDS");
    assert_eq!(unused.durable_version(), Some(0));

    let mut invalid = memory();
    let mut invalid_ledger = recorded.ctx_ledger.expect("recorded ledger");
    invalid_ledger.ids[0] = "bad/id".to_owned();
    let mut invalid_input = create_input(USER);
    invalid_input.ctx_ledger = Some(invalid_ledger);
    let error = invalid
        .invoke_mutation("createTodo", invalid_input)
        .expect_err("invalid ledger ids must fail before execution");
    assert_eq!(error.diagnostic.code, "SNAPBACK_CTX_LEDGER_ID_INVALID");
    assert_eq!(invalid.durable_version(), Some(0));
}
