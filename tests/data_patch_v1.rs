//! LLP 0184 §A: bounded existing-row patch preview/apply over host-ops.

fn test_app_state_from_snapback(
    snapback: snapback::local::LocalSnapback,
    context: snapback::admin::ServerContext,
) -> snapback::admin::AppState {
    snapback::admin::AppState::try_from_snapback(snapback, context).expect("test app state")
}

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext, ServerProfile};
use snapback::admin_impersonation::{
    IMPERSONATION_CAPABILITY_HEADER, ImpersonationCapabilityRegistry,
};
use snapback::auth::crypto::OsRandom;
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, HandlerPlan, MutationPlan, MutationStep, QueryPlan, ReturnValue,
    SchemaManifest, TableManifest, ValueExpr,
};
use std::collections::BTreeMap;
use std::time::Duration;
use tower::ServiceExt as _;

fn schema() -> SchemaManifest {
    SchemaManifest {
        app_id: "data-patch-test".to_owned(),
        schema_hash: Some("sha256:data-patch-schema-v1".to_owned()),
        tables: vec![TableManifest {
            name: "todos".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "completed".to_owned(),
                    field_type: FieldType::Boolean,
                    optional: false,
                },
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    FunctionManifest {
        app_id: "data-patch-test".to_owned(),
        bundle_hash: Some("sha256:data-patch-functions-v1".to_owned()),
        functions: vec![
            FunctionDefinition::new(
                "listTodos",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "todos".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            ),
            FunctionDefinition::new(
                "createTodo",
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                    steps: vec![MutationStep::Insert {
                        table: "todos".to_owned(),
                        values: BTreeMap::from([
                            ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                            (
                                "completed".to_owned(),
                                ValueExpr::Literal(Value::Bool(false)),
                            ),
                            ("userId".to_owned(), ValueExpr::AuthUserId),
                        ]),
                        bind_id_as: Some("todoId".to_owned()),
                    }],
                    return_value: Some(ReturnValue::Binding("todoId".to_owned())),
                })),
            ),
            FunctionDefinition::new(
                "editTitle",
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                    steps: vec![MutationStep::Patch {
                        table: "todos".to_owned(),
                        id: ValueExpr::Arg("id".to_owned()),
                        values: BTreeMap::from([(
                            "title".to_owned(),
                            ValueExpr::Arg("title".to_owned()),
                        )]),
                    }],
                    return_value: Some(ReturnValue::ChangedCount),
                })),
            ),
        ],
        ..FunctionManifest::default()
    }
}

fn handler_input(args: Value, user: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            user_id: Some(user.to_owned()),
            ..Default::default()
        },
        ..Default::default()
    }
}

fn dev_user(user: &str) -> Value {
    json!({
        "mode": "devUser",
        "actorPrincipal": null,
        "effectivePrincipal": { "userId": user, "roles": ["member"] },
        "localDevOnly": true,
        "adminBypass": false,
        "scope": null,
        "reason": null
    })
}

fn admin_bypass(reason: &str) -> Value {
    json!({
        "mode": "devAdminBypass",
        "actorPrincipal": null,
        "effectivePrincipal": null,
        "localDevOnly": true,
        "adminBypass": true,
        "scope": null,
        "reason": reason
    })
}

struct Fixture {
    app: snapback::server::SnapbackApp,
    state: AppState,
    admin_token: String,
    impersonation_capability: String,
    row_id: String,
    row_version: u64,
}

fn fixture(profile: ServerProfile, token_ttl_ms: u64) -> Fixture {
    let mut snapback = LocalSnapback::memory().expect("memory database");
    snapback.apply_schema(schema()).expect("apply schema");
    let diagnostics = snapback.load_functions(functions());
    assert!(
        diagnostics.iter().all(|diagnostic| !matches!(
            diagnostic.severity,
            snapback::diagnostic::DiagnosticSeverity::Error
                | snapback::diagnostic::DiagnosticSeverity::Fatal
        )),
        "function load diagnostics: {diagnostics:?}"
    );
    let created = snapback
        .invoke_mutation(
            "createTodo",
            handler_input(json!({ "title": "before" }), "user-a"),
        )
        .expect("create fixture row");
    let row_id = created.result.as_str().expect("created id").to_owned();
    snapback
        .subscribe_live(
            "listTodos",
            LiveSubscribeInput {
                connection_id: "data-patch-live".to_owned(),
                input: handler_input(json!({}), "user-a"),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("subscribe before patch");

    let admin_token = "data-patch-admin".to_owned();
    let mut context = ServerContext::detached();
    context.profile = profile;
    context.admin_token = Some(admin_token.clone());
    let (registry, operator) =
        ImpersonationCapabilityRegistry::generate(admin_token.clone(), &OsRandom)
            .expect("generate impersonation capability");
    let mut impersonation_capability = None;
    operator
        .emit_once_to_terminal(|value| {
            impersonation_capability = Some(value.to_owned());
            Ok(())
        })
        .expect("capture test capability");
    let state = test_app_state_from_snapback(snapback, context)
        .with_impersonation_capabilities(registry)
        .with_data_patch_token_ttl_ms(token_ttl_ms);
    let app = snapback::server::app(state.clone());
    Fixture {
        app,
        state,
        admin_token,
        impersonation_capability: impersonation_capability.expect("capability"),
        row_id,
        row_version: created.version,
    }
}

fn operation_input(fixture: &Fixture, patch: Value, authority: Value, reason: &str) -> Value {
    json!({
        "table": "todos",
        "rowId": fixture.row_id,
        "expectedVersion": fixture.row_version,
        "patch": patch,
        "authority": authority,
        "reason": reason
    })
}

async fn host_op(fixture: &Fixture, operation: &str, input: Value) -> Value {
    let response = fixture
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_snapback/api/host-ops")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-admin-token", &fixture.admin_token)
                .header(
                    IMPERSONATION_CAPABILITY_HEADER,
                    &fixture.impersonation_capability,
                )
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "operation": operation,
                        "input": input
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .expect("host-op response");
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(
        &to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response bytes"),
    )
    .expect("response json")
}

async fn preview(fixture: &Fixture, input: Value) -> Value {
    host_op(fixture, "data.patch.preview", input).await
}

fn apply_input(preview_input: &Value, preview: &Value) -> Value {
    let mut input = preview_input.clone();
    input.as_object_mut().unwrap().insert(
        "applyToken".to_owned(),
        preview["data"]["applyToken"].clone(),
    );
    input
}

#[tokio::test]
async fn preview_apply_commits_receipt_and_live_notification_then_refuses_reuse() {
    let fixture = fixture(ServerProfile::Test, 60_000);
    let reason = "repair fixture title";
    let input = operation_input(
        &fixture,
        json!({ "title": "after" }),
        dev_user("user-a"),
        reason,
    );
    let previewed = preview(&fixture, input.clone()).await;
    assert_eq!(previewed["ok"], true, "preview: {previewed}");
    assert_eq!(
        previewed["data"]["validated"]["diff"]["before"]["title"],
        "before"
    );
    assert_eq!(
        previewed["data"]["validated"]["diff"]["after"]["title"],
        "after"
    );
    assert_eq!(
        previewed["data"]["validated"]["affectedLiveQueryClasses"][0]["liveFunctions"],
        json!(["listTodos"])
    );
    assert!(
        previewed["data"]["applyToken"]
            .as_str()
            .unwrap()
            .starts_with("sbpat_")
    );

    let applied = host_op(
        &fixture,
        "data.patch.apply",
        apply_input(&input, &previewed),
    )
    .await;
    assert_eq!(applied["ok"], true, "apply: {applied}");
    assert_eq!(applied["data"]["receiptKind"], "dataPatchReceipt.v1");
    assert!(
        applied["data"]["applyTokenId"]
            .as_str()
            .unwrap()
            .starts_with("sha256:")
    );
    assert_ne!(
        applied["data"]["applyTokenId"], previewed["data"]["applyToken"],
        "receipt carries only a non-authorizing token id"
    );
    assert_eq!(
        applied["data"]["catalogDigest"],
        previewed["data"]["catalogDigest"]
    );
    assert_eq!(
        applied["data"]["startupNonce"],
        previewed["data"]["startupNonce"]
    );
    assert_eq!(applied["data"]["authority"], dev_user("user-a"));
    assert_eq!(applied["data"]["reason"], reason);
    assert_eq!(
        applied["data"]["authorizationDisposition"],
        "devUserImpersonation"
    );

    let frames = fixture
        .state
        .snapback
        .lock()
        .await
        .drain_live_stream("data-patch-live");
    assert_eq!(frames.len(), 1, "ordinary live fan-out: {frames:?}");
    let frame: Value = serde_json::from_str(&frames[0]).expect("live frame json");
    assert!(matches!(
        frame["kind"].as_str(),
        Some("live_delta" | "live_replace")
    ));
    assert!(
        frames[0].contains("after"),
        "live frame contains patched row: {frame}"
    );

    let reused = host_op(
        &fixture,
        "data.patch.apply",
        apply_input(&input, &previewed),
    )
    .await;
    assert_eq!(reused["ok"], false);
    assert_eq!(
        reused["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_APPLY_TOKEN_CONSUMED"
    );
}

#[tokio::test]
async fn preview_refuses_stale_unknown_and_invalid_values_with_stable_codes() {
    let fixture = fixture(ServerProfile::Test, 60_000);
    let reason = "validate refusal classes";
    let mut stale = operation_input(
        &fixture,
        json!({ "title": "after" }),
        admin_bypass(reason),
        reason,
    );
    stale["expectedVersion"] = json!(fixture.row_version + 1);
    let stale = preview(&fixture, stale).await;
    assert_eq!(
        stale["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_STALE_VERSION"
    );

    let unknown = preview(
        &fixture,
        operation_input(
            &fixture,
            json!({ "notAField": true }),
            admin_bypass(reason),
            reason,
        ),
    )
    .await;
    assert_eq!(
        unknown["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_UNKNOWN_FIELD"
    );

    let invalid = preview(
        &fixture,
        operation_input(
            &fixture,
            json!({ "completed": "not-a-boolean" }),
            admin_bypass(reason),
            reason,
        ),
    )
    .await;
    assert_eq!(
        invalid["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_VALIDATION_FAILED"
    );

    let reserved = preview(
        &fixture,
        operation_input(
            &fixture,
            json!({ "_version": 999 }),
            admin_bypass(reason),
            reason,
        ),
    )
    .await;
    assert_eq!(
        reserved["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_RESERVED_FIELD"
    );
}

#[tokio::test]
async fn token_binds_impersonated_user_and_patch_without_consuming_on_mismatch() {
    let fixture = fixture(ServerProfile::Test, 60_000);
    let reason = "binding test";
    let input = operation_input(
        &fixture,
        json!({ "title": "bound" }),
        dev_user("user-a"),
        reason,
    );
    let previewed = preview(&fixture, input.clone()).await;
    assert_eq!(previewed["ok"], true, "preview: {previewed}");

    let missing = host_op(&fixture, "data.patch.apply", input.clone()).await;
    assert_eq!(
        missing["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISSING"
    );

    let mut other_user = apply_input(&input, &previewed);
    other_user["authority"] = dev_user("user-b");
    let mismatch = host_op(&fixture, "data.patch.apply", other_user).await;
    assert_eq!(
        mismatch["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISMATCH"
    );

    let mut tampered = apply_input(&input, &previewed);
    tampered["patch"]["title"] = json!("tampered");
    let mismatch = host_op(&fixture, "data.patch.apply", tampered).await;
    assert_eq!(
        mismatch["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISMATCH"
    );

    let exact = host_op(
        &fixture,
        "data.patch.apply",
        apply_input(&input, &previewed),
    )
    .await;
    assert_eq!(
        exact["ok"], true,
        "mismatches did not consume token: {exact}"
    );
}

#[tokio::test]
async fn token_expires_and_same_row_concurrency_is_stale_after_consumption() {
    let expired_fixture = fixture(ServerProfile::Test, 1);
    let reason = "expiry test";
    let input = operation_input(
        &expired_fixture,
        json!({ "title": "too late" }),
        admin_bypass(reason),
        reason,
    );
    let previewed = preview(&expired_fixture, input.clone()).await;
    tokio::time::sleep(Duration::from_millis(5)).await;
    let expired = host_op(
        &expired_fixture,
        "data.patch.apply",
        apply_input(&input, &previewed),
    )
    .await;
    assert_eq!(
        expired["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_APPLY_TOKEN_EXPIRED"
    );

    let fixture = fixture(ServerProfile::Test, 60_000);
    let input = operation_input(
        &fixture,
        json!({ "title": "previewed" }),
        admin_bypass("row race"),
        "row race",
    );
    let previewed = preview(&fixture, input.clone()).await;
    fixture
        .state
        .snapback
        .lock()
        .await
        .invoke_mutation(
            "editTitle",
            handler_input(
                json!({ "id": fixture.row_id, "title": "concurrent" }),
                "user-a",
            ),
        )
        .expect("concurrent same-row mutation");
    let stale = host_op(
        &fixture,
        "data.patch.apply",
        apply_input(&input, &previewed),
    )
    .await;
    assert_eq!(
        stale["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_STALE_VERSION"
    );
}

#[tokio::test]
async fn unrelated_commit_does_not_break_per_row_precondition() {
    let fixture = fixture(ServerProfile::Test, 60_000);
    let reason = "unrelated write";
    let input = operation_input(
        &fixture,
        json!({ "title": "still applies" }),
        admin_bypass(reason),
        reason,
    );
    let previewed = preview(&fixture, input.clone()).await;
    fixture
        .state
        .snapback
        .lock()
        .await
        .invoke_mutation(
            "createTodo",
            handler_input(json!({ "title": "unrelated" }), "user-a"),
        )
        .expect("unrelated row commit");
    let applied = host_op(
        &fixture,
        "data.patch.apply",
        apply_input(&input, &previewed),
    )
    .await;
    assert_eq!(
        applied["ok"], true,
        "per-row CAS ignores global advance: {applied}"
    );
    assert_eq!(
        applied["data"]["authorizationDisposition"],
        "devAdminBypassAdmitted"
    );
    assert_eq!(applied["data"]["appHandlerAuthorizationEvaluated"], false);
}

#[tokio::test]
async fn production_profile_is_a_target_refusal_not_operability_unavailable() {
    let fixture = fixture(ServerProfile::Prod, 60_000);
    let reason = "must refuse production";
    let refused = preview(
        &fixture,
        operation_input(
            &fixture,
            json!({ "title": "no" }),
            admin_bypass(reason),
            reason,
        ),
    )
    .await;
    assert_eq!(refused["ok"], false);
    assert_eq!(
        refused["diagnostics"][0]["code"],
        "SNAPBACK_DATA_PATCH_TARGET_REFUSED"
    );
    assert_eq!(
        refused["diagnostics"][0]["details"]["availability"],
        "refused"
    );
}
