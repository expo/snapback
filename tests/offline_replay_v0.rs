//! LLP 0043 M1/M2 / ENG-23965: durable client mutation identity, exact
//! ctx-ledger replay, and reconnect-safe exactly-once settlement.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, CtxAnswerLedger, FunctionManifest, HandlerInput, MutationRequest,
    PORTABLE_TIMESTAMP_MAX_MS, PermissionScopeExpr, SchemaManifest, auth_fingerprint,
};
use std::fs;
use std::path::{Path, PathBuf};
use tower::ServiceExt;

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

fn post_json(path: &str, value: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header("content-type", "application/json")
        .body(Body::from(value.to_string()))
        .expect("request")
}

fn post_json_admin(path: &str, value: Value, token: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header("content-type", "application/json")
        .header("x-snapback-admin-token", token)
        .body(Body::from(value.to_string()))
        .expect("admin request")
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response bytes");
    serde_json::from_slice(&bytes).expect("response json")
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
        "sha256:86461827557b6998a5a62a63791d835495afd03cb573055d83bd5be048cc082a"
    );
    assert_eq!(
        auth_fingerprint(&AuthInput {
            principal: Some("é".to_owned()),
            session_id: Some("会话".to_owned()),
            user_id: Some("👩🏽‍💻".to_owned()),
        }),
        "sha256:d858de49d9f97b29fb3066058e41b05b98918c82255b1a19e97331dc61e34e3d"
    );
    assert_ne!(
        auth_fingerprint(&AuthInput::default()),
        auth_fingerprint(&AuthInput {
            principal: Some(String::new()),
            session_id: None,
            user_id: Some(String::new()),
        })
    );
    assert_eq!(
        auth_fingerprint(&AuthInput {
            principal: Some("a".repeat(131_072)),
            session_id: None,
            user_id: None,
        }),
        "sha256:a7b4c457a7a1c988d351e99d3c48213a82145129cf9e3132c1981ca01f420ef0"
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
    let first_receipt = first_receipt.into_value();
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

#[tokio::test]
async fn current_mutation_id_cannot_be_acknowledged_by_its_own_request() {
    let app = snapback::server::router(memory());
    let mutation_id = "cm_overlap_1".to_owned();
    let request = |acknowledged_client_mutation_ids| MutationRequest {
        input: create_input(USER),
        client_mutation_id: Some(mutation_id.clone()),
        acknowledged_client_mutation_ids,
    };

    let first = app
        .clone()
        .oneshot(post_json(
            "/mutation/createTodo",
            serde_json::to_value(request(Vec::new())).unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let first = response_json(first).await;

    let overlap = app
        .clone()
        .oneshot(post_json(
            "/mutation/createTodo",
            serde_json::to_value(request(vec![mutation_id.clone()])).unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(overlap.status(), StatusCode::BAD_REQUEST);
    let overlap = response_json(overlap).await;
    assert_eq!(
        overlap["diagnostic"]["code"],
        "SNAPBACK_CLIENT_MUTATION_ACK_OVERLAP"
    );

    let replay = app
        .oneshot(post_json(
            "/mutation/createTodo",
            serde_json::to_value(request(Vec::new())).unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(
        response_json(replay).await["result"],
        first["result"],
        "overlap rejection must leave the retained settlement intact"
    );
}

#[tokio::test]
async fn standalone_ack_reclaims_a_final_result_and_is_auth_bound() {
    let app = snapback::server::router(memory());
    let mutation_id = "cm_standalone_ack_1".to_owned();
    let request = MutationRequest {
        input: create_input(USER),
        client_mutation_id: Some(mutation_id.clone()),
        acknowledged_client_mutation_ids: Vec::new(),
    };
    let first = app
        .clone()
        .oneshot(post_json(
            "/mutation/createTodo",
            serde_json::to_value(&request).unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let first = response_json(first).await;

    let wrong_auth = app
        .clone()
        .oneshot(post_json(
            "/client-mutations/acknowledge",
            json!({
                "auth": create_input("another_user").auth,
                "clientMutationIds": [mutation_id],
            }),
        ))
        .await
        .unwrap();
    assert_eq!(wrong_auth.status(), StatusCode::OK);
    assert_eq!(response_json(wrong_auth).await["acknowledged"], json!(0));

    let still_replayed = app
        .clone()
        .oneshot(post_json(
            "/mutation/createTodo",
            serde_json::to_value(&request).unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(still_replayed).await["result"],
        first["result"]
    );

    let correct_auth = app
        .clone()
        .oneshot(post_json(
            "/client-mutations/acknowledge",
            json!({
                "auth": create_input(USER).auth,
                "clientMutationIds": [mutation_id],
            }),
        ))
        .await
        .unwrap();
    assert_eq!(correct_auth.status(), StatusCode::OK);
    assert_eq!(response_json(correct_auth).await["acknowledged"], json!(1));

    let after_reclaim = app
        .oneshot(post_json(
            "/mutation/createTodo",
            serde_json::to_value(request).unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(after_reclaim.status(), StatusCode::OK);
    assert_ne!(
        response_json(after_reclaim).await["result"],
        first["result"],
        "once ACKed, the opaque id is available for a fresh settlement"
    );
}

#[tokio::test]
async fn admin_purge_is_gated_explicit_and_auth_selective() {
    const TOKEN: &str = "offline-purge-secret";
    let mut context = ServerContext::detached();
    context.admin_token = Some(TOKEN.to_owned());
    let app = snapback::server::app(AppState::from_snapback(memory(), context));
    let user_id = "cm_admin_purge_user".to_owned();
    let other_id = "cm_admin_purge_other".to_owned();
    let user_request = MutationRequest {
        input: create_input(USER),
        client_mutation_id: Some(user_id.clone()),
        acknowledged_client_mutation_ids: Vec::new(),
    };
    let other_request = MutationRequest {
        input: create_input("another_user"),
        client_mutation_id: Some(other_id),
        acknowledged_client_mutation_ids: Vec::new(),
    };
    let first_user = response_json(
        app.clone()
            .oneshot(post_json(
                "/mutation/createTodo",
                serde_json::to_value(&user_request).unwrap(),
            ))
            .await
            .unwrap(),
    )
    .await;
    let first_other = response_json(
        app.clone()
            .oneshot(post_json(
                "/mutation/createTodo",
                serde_json::to_value(&other_request).unwrap(),
            ))
            .await
            .unwrap(),
    )
    .await;

    let denied = app
        .clone()
        .oneshot(post_json(
            "/_snapback/api/client-mutations/purge",
            json!({ "auth": create_input(USER).auth }),
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);

    let missing_selector = app
        .clone()
        .oneshot(post_json_admin(
            "/_snapback/api/client-mutations/purge",
            json!({}),
            TOKEN,
        ))
        .await
        .unwrap();
    assert_eq!(missing_selector.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(missing_selector).await["diagnostic"]["code"],
        "SNAPBACK_CLIENT_MUTATION_PURGE_SELECTOR_INVALID"
    );

    let targeted = app
        .clone()
        .oneshot(post_json_admin(
            "/_snapback/api/client-mutations/purge",
            json!({ "auth": create_input(USER).auth }),
            TOKEN,
        ))
        .await
        .unwrap();
    assert_eq!(targeted.status(), StatusCode::OK);
    assert_eq!(response_json(targeted).await["purged"], json!(1));

    let new_user = response_json(
        app.clone()
            .oneshot(post_json(
                "/mutation/createTodo",
                serde_json::to_value(&user_request).unwrap(),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_ne!(new_user["result"], first_user["result"]);
    let replayed_other = response_json(
        app.clone()
            .oneshot(post_json(
                "/mutation/createTodo",
                serde_json::to_value(&other_request).unwrap(),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(replayed_other["result"], first_other["result"]);

    let global = app
        .oneshot(post_json_admin(
            "/_snapback/api/client-mutations/purge",
            json!({ "all": true }),
            TOKEN,
        ))
        .await
        .unwrap();
    assert_eq!(global.status(), StatusCode::OK);
    assert_eq!(response_json(global).await["purged"], json!(2));
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

#[test]
fn host_plan_replay_timestamp_is_portable_and_persisted_exactly() {
    let mut recorder = memory();
    let recorded = recorder
        .invoke_mutation("createTodo", create_input(USER))
        .expect("record host plan");
    let mut ledger = recorded.ctx_ledger.expect("host plan ledger");
    ledger.now = PORTABLE_TIMESTAMP_MAX_MS;

    let mut accepted = memory();
    let mut accepted_input = create_input(USER);
    accepted_input.ctx_ledger = Some(ledger.clone());
    let output = accepted
        .invoke_mutation("createTodo", accepted_input)
        .expect("maximum portable timestamp");
    assert_eq!(
        output.ctx_ledger.as_ref().map(|value| value.now),
        Some(ledger.now)
    );
    let rows = accepted
        .invoke_query("listTodos", input_for(USER, json!({})))
        .expect("query persisted host-plan row")
        .rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["_createdAt"], json!(PORTABLE_TIMESTAMP_MAX_MS));
    assert_eq!(rows[0]["_updatedAt"], json!(PORTABLE_TIMESTAMP_MAX_MS));

    let mut rejected = memory();
    ledger.now = PORTABLE_TIMESTAMP_MAX_MS + 1;
    let mut rejected_input = create_input(USER);
    rejected_input.ctx_ledger = Some(ledger);
    let error = rejected
        .invoke_mutation("createTodo", rejected_input)
        .expect_err("timestamp beyond the portable bound");
    assert_eq!(error.diagnostic.code, "SNAPBACK_TIMESTAMP_OUT_OF_RANGE");
    assert_eq!(rejected.durable_version(), Some(0));
}
