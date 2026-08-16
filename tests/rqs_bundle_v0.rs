//! Acceptance for LLP 0090 rollout step 2 — the snapshot bundle endpoint
//! (`POST /app/bundle`, read + register modes) against the LLP 0092 §0D
//! contract and the LLP 0031 dated pending-registration-owner amendment:
//! the per-entry closed union, the single-commit cut, coded limit/mode/param
//! refusals, anonymous refusals, idempotency replay validity (rotate-on-
//! retry, sender/scope mismatch, expiry), distinct concurrent boots,
//! attach-deadline reaping, and no stranded state on partial failure.

fn test_detached_app_state(snapback: snapback::local::LocalSnapback) -> snapback::admin::AppState {
    snapback::admin::AppState::try_detached(snapback).expect("detached test app state")
}

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use snapback::admin::AppState;
use snapback::bundle::{BundleQuerySpec, BundleRouteEntry, RoutesManifest};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthRequirement, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionArgsContract,
    FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan,
    IbexModule, IndexManifest, MutationPlan, MutationStep, QueryPlan, ResultObjectFieldContract,
    ResultValueContract, ReturnValue, SchemaManifest, TableManifest, ValueExpr,
};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tokio::net::TcpListener;
use tower::ServiceExt;

fn bundle_schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("rqs-bundle-v0".to_owned()),
        tables: vec![
            TableManifest {
                name: "posts".to_owned(),
                fields: vec![FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                }],
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
            },
            TableManifest {
                name: "todos".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "title".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: vec![IndexManifest {
                    name: "by_user".to_owned(),
                    fields: vec!["userId".to_owned()],
                    unique: false,
                    where_applicable: false,
                }],
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
            },
        ],
        ..SchemaManifest::default()
    }
}

fn bundle_functions() -> FunctionManifest {
    // An rqsEligible query: public, declared authority-independent, HostPlan,
    // unordered — the interim step-1 predicate marks it `mset1`-eligible.
    let mut list_posts = FunctionDefinition::new(
        "listPosts",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "posts".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    );
    list_posts.auth_requirement = Some(AuthRequirement::Public);
    list_posts.authority_independent = true;
    // The LLP 0092 §0C.2 closed-inputs proof: `rqsEligible` derivation
    // requires the complete `singleTable` read summary codegen always emits.
    list_posts.read_set_summary = snapback::manifest::DependencySummary {
        primary_table: Some("posts".to_owned()),
        tables: vec!["posts".to_owned()],
        mode: Some("singleTable".to_owned()),
        auth_scope_field: None,
    };

    FunctionManifest {
        bundle_hash: Some("rqs-bundle-functions-v0".to_owned()),
        functions: vec![
            list_posts,
            FunctionDefinition::new(
                "listTodos",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "todos".to_owned(),
                    filters: vec![FilterExpr {
                        field: "userId".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::AuthUserId,
                    }],
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: Some("by_user".to_owned()),
                })),
            ),
            FunctionDefinition::new(
                "createPost",
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
                    steps: vec![MutationStep::Insert {
                        table: "posts".to_owned(),
                        values: BTreeMap::from([(
                            "title".to_owned(),
                            ValueExpr::Arg("title".to_owned()),
                        )]),
                        bind_id_as: Some("postId".to_owned()),
                    }],
                    return_value: Some(ReturnValue::Binding("postId".to_owned())),
                })),
            ),
            FunctionDefinition::new(
                "createTodo",
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
                    steps: vec![MutationStep::Insert {
                        table: "todos".to_owned(),
                        values: BTreeMap::from([
                            ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                            ("userId".to_owned(), ValueExpr::AuthUserId),
                        ]),
                        bind_id_as: Some("todoId".to_owned()),
                    }],
                    return_value: Some(ReturnValue::Binding("todoId".to_owned())),
                })),
            ),
        ],
        ..FunctionManifest::default()
    }
}

fn configured_memory() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("in-memory instance");
    snapback.apply_schema(bundle_schema()).expect("schema");
    let diagnostics = snapback.load_functions(bundle_functions());
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"),
        "unexpected load diagnostics: {diagnostics:?}"
    );
    snapback
}

fn nested_args_contract_hash(contract: &FunctionArgsContract) -> String {
    let value = serde_json::to_value(contract).expect("args contract serializes");
    let canonical = snapback::rqs::jcs(&value).expect("args contract is canonical");
    let mut hash = Sha256::new();
    hash.update(b"snapback:function-args:v2\n");
    hash.update(canonical.as_bytes());
    format!("sha256:{:x}", hash.finalize())
}

fn nested_bundle_function() -> FunctionDefinition {
    let contract = FunctionArgsContract {
        fields: vec![ResultObjectFieldContract {
            name: "context".to_owned(),
            required: true,
            value: ResultValueContract::Object {
                fields: vec![
                    ResultObjectFieldContract {
                        name: "boardId".to_owned(),
                        required: true,
                        value: ResultValueContract::String { max_bytes: 256 },
                    },
                    ResultObjectFieldContract {
                        name: "count".to_owned(),
                        required: false,
                        value: ResultValueContract::Integer {
                            min: -9_007_199_254_740_991,
                            max: 9_007_199_254_740_991,
                        },
                    },
                ],
                allow_extra: false,
            },
        }],
    };
    let mut function = FunctionDefinition::new(
        "nestedContext",
        FunctionKind::Query,
        FunctionRuntime::IbexModule(IbexModule {
            source: r#"
globalThis.__snapbackHandlers = {
  nestedContext(_ctx, args) {
    return [{
      boardId: args.context.boardId,
      count: args.context.count === undefined ? null : args.context.count,
    }];
  },
};
"#
            .to_owned(),
            export: "nestedContext".to_owned(),
        }),
    );
    function.args_contract_hash = Some(nested_args_contract_hash(&contract));
    function.args_contract = Some(contract);
    function.required_capabilities = vec!["args_contract_v1".to_owned()];
    function
}

fn nested_bundle_routes() -> RoutesManifest {
    let route = |route: &str, args: Value| BundleRouteEntry {
        route: route.to_owned(),
        queries: vec![BundleQuerySpec {
            function: "nestedContext".to_owned(),
            args,
        }],
        persist: None,
        register_group_eligible: false,
        mixed_group_eligible: false,
        mixed_profile: None,
    };
    RoutesManifest {
        format_version: 1,
        app: "nested-bundle".to_owned(),
        routes: vec![
            route(
                "/board/:boardId",
                json!({ "context": { "boardId": { "$param": "boardId" } } }),
            ),
            route(
                "/count/:count",
                json!({
                    "context": {
                        "boardId": "fixed",
                        "count": { "$param": "count" }
                    }
                }),
            ),
        ],
    }
}

fn nested_configured_memory() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("in-memory instance");
    let mut schema = bundle_schema();
    schema.app_id = "nested-bundle".to_owned();
    schema.schema_hash = Some("nested-bundle-schema-v1".to_owned());
    snapback.apply_schema(schema).expect("nested schema");
    let functions = FunctionManifest {
        app_id: "nested-bundle".to_owned(),
        bundle_hash: Some("nested-bundle-functions-v1".to_owned()),
        acknowledged_experimental_capabilities: vec!["args_contract_v1".to_owned()],
        functions: vec![nested_bundle_function()],
        ..FunctionManifest::default()
    };
    let diagnostics = snapback.load_functions(functions);
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"),
        "unexpected nested function diagnostics: {diagnostics:?}"
    );
    snapback
        .install_routes_manifest(nested_bundle_routes())
        .expect("nested routes manifest");
    snapback
}

fn input(args: Value, user_id: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: snapback::manifest::AuthInput {
            user_id: Some(user_id.to_owned()),
            ..Default::default()
        },
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

async fn app_with_seeded_state() -> (AppState, AppState) {
    let snapback = tokio::task::spawn_blocking(|| {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = configured_memory();
        snapback
            .invoke_mutation("createPost", input(json!({ "title": "hello" }), "user_1"))
            .expect("seed post");
        snapback
            .invoke_mutation("createTodo", input(json!({ "title": "mine" }), "user_1"))
            .expect("seed todo");
        snapback
    })
    .await
    .expect("setup");
    let state = test_detached_app_state(snapback);
    (state.clone(), state)
}

fn post_json(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request")
}

fn entry(route: &str, queries: Value) -> Value {
    json!({ "route": route, "queries": queries })
}

fn bundle_body(
    mode: Option<&str>,
    key: Option<&str>,
    route: &str,
    queries: Value,
    user: Option<&str>,
) -> Value {
    let mut body = json!({
        "route": route,
        "params": {},
        "devManifestEntry": entry(route, queries),
    });
    if let Some(mode) = mode {
        body["mode"] = json!(mode);
    }
    if let Some(key) = key {
        body["idempotencyKey"] = json!(key);
    }
    if let Some(user) = user {
        body["auth"] = json!({ "user_id": user });
    }
    body
}

async fn send(app: &AppState, request: Request<Body>) -> (StatusCode, Value) {
    let response = snapback::server::app(app.clone())
        .oneshot(request)
        .await
        .expect("response");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

fn diagnostic_code(body: &Value) -> &str {
    body["diagnostic"]["code"].as_str().unwrap_or("")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nested_route_params_reach_ibex_handler_and_decode_integer() {
    let snapback = tokio::task::spawn_blocking(|| {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        nested_configured_memory()
    })
    .await
    .expect("nested setup");
    let app = test_detached_app_state(snapback);

    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            json!({
                "route": "/board/:boardId",
                "params": { "boardId": "wall" },
                "auth": { "user_id": "user_1" }
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "nested string bundle: {body}");
    assert_eq!(
        body["entries"][0]["args"],
        json!({ "context": { "boardId": "wall" } })
    );
    assert_eq!(body["entries"][0]["rows"][0]["boardId"], "wall");

    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            json!({
                "route": "/count/:count",
                "params": { "count": "42" },
                "auth": { "user_id": "user_1" }
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "nested integer bundle: {body}");
    assert_eq!(body["entries"][0]["args"]["context"]["count"], 42);
    assert_eq!(body["entries"][0]["rows"][0]["count"], 42);

    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            json!({
                "route": "/count/:count",
                "params": { "count": "not-decimal" },
                "auth": { "user_id": "user_1" }
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_PARAMS_INVALID");
}

/// Decode a drained outbox body: durable envelopes carry their payload as
/// serialized bytes.
fn drained_payloads(body: &Value) -> String {
    let mut decoded = String::new();
    if let Some(envelopes) = body.as_array() {
        for envelope in envelopes {
            if let Some(bytes) = envelope["Durable"]["payload"].as_array() {
                let raw: Vec<u8> = bytes
                    .iter()
                    .filter_map(|byte| byte.as_u64().map(|value| value as u8))
                    .collect();
                decoded.push_str(&String::from_utf8_lossy(&raw));
                decoded.push('\n');
            }
        }
    }
    decoded
}

fn both_queries() -> Value {
    json!([
        { "function": "listPosts", "args": {} },
        { "function": "listTodos", "args": {} },
    ])
}

const KEY_A: &str = "AAAAAAAAAAAAAAAAAAAAAA";
const KEY_B: &str = "BBBBBBBBBBBBBBBBBBBBBB";

/// Read mode: one shared commit, manifest-order entries, and the closed
/// per-entry union — `resume` present iff `rqsEligible`, explicitly `null`
/// otherwise; no registration fields; no connection (LLP 0092 §0D.1).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_mode_returns_closed_union_at_one_commit() {
    let (app, _state) = app_with_seeded_state().await;
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(Some("read"), None, "/home", both_queries(), Some("user_1")),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "read bundle: {body}");
    assert!(body["commitVersion"].is_u64());
    assert!(
        body["generation"]
            .as_str()
            .unwrap_or("")
            .starts_with("gen1:")
    );
    assert!(!body["versionStream"].as_str().unwrap_or("").is_empty());
    assert!(body.get("connection").is_none(), "read mode mints nothing");
    let entries = body["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 2);
    // Eligible entry: rows + resume token minted at the shared commit.
    assert_eq!(entries[0]["function"], "listPosts");
    assert_eq!(entries[0]["rows"].as_array().expect("rows").len(), 1);
    let resume = &entries[0]["resume"];
    assert!(
        resume["token"].as_str().unwrap_or("").starts_with("sbrt1."),
        "eligible entry carries a resume token: {resume}"
    );
    assert_eq!(resume["meta"]["version"], body["commitVersion"]);
    assert_eq!(resume["meta"]["generation"], body["generation"]);
    // Auth-scoped entry: rows without token, resume explicitly null.
    assert_eq!(entries[1]["function"], "listTodos");
    assert_eq!(entries[1]["rows"].as_array().expect("rows").len(), 1);
    assert!(entries[1]["resume"].is_null(), "non-eligible entry is null");
    for bundle_entry in entries {
        assert!(bundle_entry.get("subscriptionId").is_none());
        assert!(bundle_entry.get("authorization").is_none());
    }
}

/// Every request-shape refusal is per-cause coded with the LLP 0092 §0D.1
/// advisory status mapping.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bundle_refusals_are_coded() {
    let (app, _state) = app_with_seeded_state().await;
    let queries_one = json!([{ "function": "listPosts", "args": {} }]);

    // Unknown mode.
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("write"),
                None,
                "/home",
                queries_one.clone(),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_MODE_INVALID");

    // Connection negotiation is register-only.
    let mut read_with_protocol = bundle_body(
        Some("read"),
        None,
        "/home",
        queries_one.clone(),
        Some("user_1"),
    );
    read_with_protocol["authInvalidationProtocol"] = json!(1);
    let (status, body) = send(&app, post_json("/app/bundle", read_with_protocol)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_MODE_INVALID");

    // Per-child namespaces are meaningful only with an exact protocol-1
    // connection negotiation.
    let mut register_without_protocol = bundle_body(
        Some("register"),
        Some(KEY_A),
        "/home",
        queries_one.clone(),
        Some("user_1"),
    );
    register_without_protocol["authorizationNamespaces"] = json!([{
        "clientStoreId": "store-a",
        "queryKey": "listPosts:{}",
        "queryInstanceId": 1
    }]);
    let (status, body) = send(&app, post_json("/app/bundle", register_without_protocol)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_MODE_INVALID");

    // Idempotency key in read mode.
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("read"),
                Some(KEY_A),
                "/home",
                queries_one.clone(),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_MODE_INVALID");

    let mut register_protocol1 = bundle_body(
        Some("register"),
        Some(KEY_B),
        "/home",
        queries_one.clone(),
        Some("user_1"),
    );
    register_protocol1["authInvalidationProtocol"] = json!(1);
    register_protocol1["authorizationNamespaces"] = json!([null]);
    let (status, body) = send(&app, post_json("/app/bundle", register_protocol1)).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the exact protocol-1 namespace negotiation is admitted: {body}",
    );

    // No served route manifest and no inline dev entry.
    let mut body_no_entry = bundle_body(
        Some("read"),
        None,
        "/home",
        queries_one.clone(),
        Some("user_1"),
    );
    body_no_entry
        .as_object_mut()
        .unwrap()
        .remove("devManifestEntry");
    let (status, body) = send(&app, post_json("/app/bundle", body_no_entry)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_ROUTE_UNKNOWN");

    // Unknown function.
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("read"),
                None,
                "/home",
                json!([{ "function": "nope", "args": {} }]),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_ENTRY_INVALID");

    // Params not covering the pattern.
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("read"),
                None,
                "/board/:boardId",
                json!([{ "function": "listPosts", "args": { "board": { "$param": "boardId" } } }]),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_PARAMS_INVALID");

    // Query-count limit (33 > 32).
    let many: Vec<Value> = (0..33)
        .map(|_| json!({ "function": "listPosts", "args": {} }))
        .collect();
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("read"),
                None,
                "/home",
                Value::Array(many),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_LIMIT_QUERIES");

    // Anonymous read: fail-closed until the cluster-0C publicInline fact
    // exists — no route is publicInline-class yet (LLP 0092 §0D.1).
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(Some("read"), None, "/home", queries_one.clone(), None),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_NOT_PUBLIC");

    // Anonymous register refuses to read mode — explicit, never a silent
    // mode substitution (LLP 0092 §0D.2; 0090 step-2 acceptance).
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                queries_one.clone(),
                None,
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        diagnostic_code(&body),
        "SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL"
    );

    // Register mode with a non-live function is entry-invalid.
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                json!([{ "function": "createPost", "args": {} }]),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_ENTRY_INVALID");
}

/// The single-commit invariant: a mutation racing between bundle queries
/// never tears the bundle — every entry observes one commit cut and the
/// response's `commitVersion` matches the rows served (LLP 0090 D1.2). On
/// the local arm the cut is the instance's exclusive borrow; this proves it
/// observably under a genuinely racing writer.
#[test]
fn bundle_cut_is_single_commit_under_racing_mutations() {
    let snapback = configured_memory();
    let shared = Arc::new(Mutex::new(snapback));
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(0);
    let (done_tx, done_rx) = std::sync::mpsc::sync_channel(0);
    let writer = {
        let shared = Arc::clone(&shared);
        thread::spawn(move || {
            for count in 0..25_u32 {
                // Rendezvous before every attempt so the reader and writer
                // genuinely contend for the cut without allowing an
                // unbounded reacquire loop to starve either thread.
                ready_tx.send(()).expect("signal racing mutation");
                let mut snapback = shared.lock().expect("writer lock");
                snapback
                    .invoke_mutation(
                        "createPost",
                        input(json!({ "title": format!("racer {count}") }), "user_1"),
                    )
                    .expect("racing mutation");
                drop(snapback);
                done_tx.send(()).expect("complete racing mutation");
            }
        })
    };

    let route_entry: snapback::bundle::BundleRouteEntry = serde_json::from_value(entry(
        "/home",
        json!([
            { "function": "listPosts", "args": {} },
            { "function": "listPosts", "args": {} },
        ]),
    ))
    .expect("entry");
    let auth = snapback::manifest::AuthInput {
        user_id: Some("user_1".to_owned()),
        ..Default::default()
    };
    for _ in 0..25 {
        ready_rx.recv().expect("await racing mutation");
        let mut snapback = shared.lock().expect("bundle lock");
        let response = snapback
            .app_bundle_read_dev(&route_entry, &BTreeMap::new(), "/home", &auth)
            .expect("bundle");
        drop(snapback);
        // Both evaluations of the same query inside one bundle must agree
        // exactly, no matter how the writer interleaves between requests.
        assert_eq!(
            response.entries[0].rows, response.entries[1].rows,
            "a racing commit tore the bundle cut"
        );
        let minted = response.entries[0]
            .resume
            .as_ref()
            .expect("eligible entry mints resume");
        assert_eq!(minted.meta.version, response.commit_version);
        done_rx.recv().expect("join racing mutation");
    }
    writer.join().expect("writer");
}

/// Register mode: pending-registration owner minted atomically with the
/// snapshot cut — the response snapshot IS the fresh snapshot (no duplicate
/// `LiveReplace` queued behind it), the registrations are live at the same
/// cut (a later mutation fans out), and the connection grant works.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn register_mode_registers_at_the_cut_with_no_duplicate_snapshot() {
    let (app, state) = app_with_seeded_state().await;
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                both_queries(),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "register bundle: {body}");
    let connection = &body["connection"];
    let connection_id = connection["connectionId"].as_str().expect("connection id");
    let grant = connection["grant"].as_str().expect("grant");
    assert!(connection["attachDeadline"].is_u64());
    let entries = body["entries"].as_array().expect("entries");
    for bundle_entry in entries {
        assert!(
            bundle_entry["subscriptionId"].as_str().is_some(),
            "register entries carry subscription ids"
        );
    }
    // Closed union holds in register mode too.
    assert!(entries[0]["resume"]["token"].is_string());
    assert!(entries[1]["resume"].is_null());
    assert_eq!(state.bundle_pending.pending_len(), 1);

    // No duplicate fresh snapshot: the outbox holds no live_replace for the
    // registrations whose snapshot rode the response.
    let drained = send(
        &app,
        Request::builder()
            .uri(format!("/outbox/{connection_id}?connection_token={grant}"))
            .body(Body::empty())
            .expect("drain"),
    )
    .await;
    assert_eq!(drained.0, StatusCode::OK);
    assert!(
        !drained_payloads(&drained.1).contains("live_replace"),
        "registration queued a duplicate fresh snapshot: {}",
        drained.1
    );

    // The registrations are live: a mutation after the bundle fans out.
    let (status, _mutated) = send(
        &app,
        post_json(
            "/mutation/createPost",
            json!({ "args": { "title": "after-bundle" }, "auth": { "user_id": "user_1" } }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let drained = send(
        &app,
        Request::builder()
            .uri(format!("/outbox/{connection_id}?connection_token={grant}"))
            .body(Body::empty())
            .expect("drain"),
    )
    .await;
    assert!(
        drained_payloads(&drained.1).contains("after-bundle"),
        "armed registration did not receive fan-out: {}",
        drained.1
    );
}

/// Lost-response retry: the same idempotency key returns the same
/// registration set under the same connection identity with a freshly
/// rotated grant secret; the superseded secret and subscriptions are gone
/// (LLP 0031 amendment rotate-on-retry).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn register_retry_same_key_supersedes_with_rotated_secret() {
    let (app, state) = app_with_seeded_state().await;
    let request = || {
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                both_queries(),
                Some("user_1"),
            ),
        )
    };
    let (status, first) = send(&app, request()).await;
    assert_eq!(status, StatusCode::OK);
    let (status, second) = send(&app, request()).await;
    assert_eq!(status, StatusCode::OK, "retry: {second}");

    // Same connection identity, rotated secret.
    assert_eq!(
        first["connection"]["connectionId"],
        second["connection"]["connectionId"]
    );
    assert_ne!(
        first["connection"]["grant"], second["connection"]["grant"],
        "a possibly-exposed grant secret must never be re-returned verbatim"
    );
    // Same registration set shape (superseded, not duplicated): still one
    // pending owner, and exactly one live subscription per entry.
    assert_eq!(state.bundle_pending.pending_len(), 1);
    let (status, inspect) = send(
        &app,
        Request::builder()
            .uri("/inspect")
            .body(Body::empty())
            .expect("inspect"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let subscriptions = inspect["subscriptions"].as_array().expect("subscriptions");
    assert_eq!(
        subscriptions.len(),
        2,
        "supersession must not leave duplicate registrations: {subscriptions:?}"
    );

    // The old secret is dead: a live operation presenting it is refused.
    let connection_id = second["connection"]["connectionId"].as_str().unwrap();
    let old_grant = first["connection"]["grant"].as_str().unwrap();
    let (status, _refused) = send(
        &app,
        Request::builder()
            .method("POST")
            .uri("/live/listPosts/subscribe")
            .header("content-type", "application/json")
            .header("x-snapback-connection-token", old_grant)
            .body(Body::from(
                json!({ "connection_id": connection_id, "input": { "args": {}, "auth": { "user_id": "user_1" } } })
                    .to_string(),
            ))
            .expect("subscribe"),
    )
    .await;
    assert!(
        status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN,
        "rotated-away grant secret must be refused, got {status}"
    );
}

/// A pre-upgrade wire-version refusal must not consume the pending owner.
/// The same idempotency key remains retryable instead of stranding armed
/// demand after a failed socket handshake.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refused_socket_preflight_leaves_pending_bundle_replayable() {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;

    let (app, state) = app_with_seeded_state().await;
    let request = || {
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                both_queries(),
                Some("user_1"),
            ),
        )
    };
    let (status, first) = send(&app, request()).await;
    assert_eq!(status, StatusCode::OK, "register bundle: {first}");
    let connection_id = first["connection"]["connectionId"]
        .as_str()
        .expect("connection id")
        .to_owned();
    let grant = first["connection"]["grant"]
        .as_str()
        .expect("connection grant")
        .to_owned();

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let address = listener.local_addr().expect("listener address");
    let server_app = snapback::server::app(state.clone());
    let server = tokio::spawn(async move {
        server_app
            .bind(listener)
            .expect("bind app")
            .serve()
            .await
            .expect("serve app");
    });
    let mut upgrade = format!("ws://{address}/live/{connection_id}/stream")
        .into_client_request()
        .expect("websocket request");
    upgrade.headers_mut().insert(
        "x-snapback-connection-token",
        grant.parse().expect("grant header"),
    );
    let refusal = tokio_tungstenite::connect_async(upgrade)
        .await
        .expect_err("offerless socket must refuse");
    let status = match refusal {
        tokio_tungstenite::tungstenite::Error::Http(response) => response.status(),
        other => panic!("expected HTTP refusal, got {other:?}"),
    };
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        state.bundle_pending.pending_len(),
        1,
        "wire refusal must not consume the pending-registration owner",
    );

    let (status, replay) = send(&app, request()).await;
    assert_eq!(status, StatusCode::OK, "pending retry: {replay}");
    assert_eq!(
        replay["connection"]["connectionId"], first["connection"]["connectionId"],
        "the refused attach leaves the original pending owner replayable",
    );
    server.abort();
}

/// Two concurrent same-user boots hold distinct keys and produce distinct
/// registration sets (LLP 0092 §0D.3).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_concurrent_boots_produce_distinct_sets() {
    let (app, state) = app_with_seeded_state().await;
    let boot = |key: &'static str| {
        let app = app.clone();
        async move {
            send(
                &app,
                post_json(
                    "/app/bundle",
                    bundle_body(
                        Some("register"),
                        Some(key),
                        "/home",
                        both_queries(),
                        Some("user_1"),
                    ),
                ),
            )
            .await
        }
    };
    let (first, second) = tokio::join!(boot(KEY_A), boot(KEY_B));
    assert_eq!(first.0, StatusCode::OK, "boot A: {}", first.1);
    assert_eq!(second.0, StatusCode::OK, "boot B: {}", second.1);
    assert_ne!(
        first.1["connection"]["connectionId"], second.1["connection"]["connectionId"],
        "distinct boots must own distinct connections"
    );
    let ids = |body: &Value| -> Vec<String> {
        body["entries"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|entry| entry["subscriptionId"].as_str().map(str::to_owned))
            .collect()
    };
    let first_ids = ids(&first.1);
    for id in ids(&second.1) {
        assert!(!first_ids.contains(&id), "boots shared a registration");
    }
    assert_eq!(state.bundle_pending.pending_len(), 2);
}

/// Replay-validity tuple enforcement: a different sender identity presenting
/// a known key refuses SENDER_MISMATCH; the same sender out of scope refuses
/// SCOPE_MISMATCH (LLP 0092 §0D.3).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn replay_tuple_mismatches_are_refused() {
    let (app, _state) = app_with_seeded_state().await;
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                both_queries(),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "first boot: {body}");

    // Different sender identity (another dev user), same key.
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                both_queries(),
                Some("user_2"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        diagnostic_code(&body),
        "SNAPBACK_BUNDLE_IDEMPOTENCY_SENDER_MISMATCH"
    );

    // Same sender, different manifest entry scope.
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/other",
                json!([{ "function": "listPosts", "args": {} }]),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        diagnostic_code(&body),
        "SNAPBACK_BUNDLE_IDEMPOTENCY_SCOPE_MISMATCH"
    );
}

/// Attach-deadline expiry reaps cleanly: demand disarmed (no subscriptions
/// remain), the grant is invalidated, and the key's replay validity ends
/// with IDEMPOTENCY_EXPIRED (LLP 0092 §0D.4; LLP 0031 amendment).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attach_deadline_expiry_reaps_cleanly() {
    // Process-global knob: the assertions below never read it back, and the
    // other register tests assert only loose deadline facts, so parallel
    // execution stays sound.
    unsafe { std::env::set_var("SNAPBACK_BUNDLE_ATTACH_GRACE_MS", "0") };
    let (app, state) = app_with_seeded_state().await;
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                both_queries(),
                Some("user_1"),
            ),
        ),
    )
    .await;
    unsafe { std::env::remove_var("SNAPBACK_BUNDLE_ATTACH_GRACE_MS") };
    assert_eq!(status, StatusCode::OK, "register: {body}");
    let connection_id = body["connection"]["connectionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let grant = body["connection"]["grant"].as_str().unwrap().to_owned();
    assert_eq!(state.bundle_pending.pending_len(), 1);

    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    let reaped = snapback::server::sweep_pending_bundle_owners(&state);
    assert_eq!(reaped, 1, "the expired owner must be reaped");
    assert_eq!(state.bundle_pending.pending_len(), 0);
    // Cleanup runs on spawned tasks; wait briefly for the topology purge.
    let mut disarmed = false;
    for _ in 0..100 {
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        let (_, inspect) = send(
            &app,
            Request::builder()
                .uri("/inspect")
                .body(Body::empty())
                .expect("inspect"),
        )
        .await;
        if inspect["subscriptions"]
            .as_array()
            .is_some_and(Vec::is_empty)
        {
            disarmed = true;
            break;
        }
    }
    assert!(disarmed, "a reaped boot must leave no armed demand");

    // The minted grant is invalidated.
    let (status, _refused) = send(
        &app,
        Request::builder()
            .method("POST")
            .uri("/live/listPosts/subscribe")
            .header("content-type", "application/json")
            .header("x-snapback-connection-token", grant.as_str())
            .body(Body::from(
                json!({ "connection_id": connection_id, "input": { "args": {}, "auth": { "user_id": "user_1" } } })
                    .to_string(),
            ))
            .expect("subscribe"),
    )
    .await;
    assert!(
        status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN,
        "a reaped grant must be unusable, got {status}"
    );

    // Replay validity ended: the key now refuses EXPIRED.
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                both_queries(),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        diagnostic_code(&body),
        "SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED"
    );
}

/// Atomic failure strands nothing: a register bundle whose second entry
/// fails leaves no subscriptions, no pending owner, no grant — and the same
/// key may start a fresh boot attempt (LLP 0031 amendment: a failed bundle
/// mints nothing).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_register_bundle_strands_no_server_state() {
    let (app, state) = app_with_seeded_state().await;
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                json!([
                    { "function": "listPosts", "args": {} },
                    { "function": "missingQuery", "args": {} },
                ]),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_ENTRY_INVALID");
    assert_eq!(state.bundle_pending.pending_len(), 0);
    let mut clean = false;
    for _ in 0..100 {
        let (_, inspect) = send(
            &app,
            Request::builder()
                .uri("/inspect")
                .body(Body::empty())
                .expect("inspect"),
        )
        .await;
        if inspect["subscriptions"]
            .as_array()
            .is_some_and(Vec::is_empty)
        {
            clean = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(clean, "a failed bundle must strand no registrations");

    // The abandoned key admits a fresh attempt.
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some(KEY_A),
                "/home",
                both_queries(),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "fresh attempt: {body}");
}

/// Pending-owner bounds: at most 8 pending owners per authority
/// (LLP 0092 §0D.4).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pending_capacity_per_authority_is_bounded() {
    let (app, _state) = app_with_seeded_state().await;
    let keys = [
        "CAAAAAAAAAAAAAAAAAAAAA",
        "CBAAAAAAAAAAAAAAAAAAAA",
        "CCAAAAAAAAAAAAAAAAAAAA",
        "CDAAAAAAAAAAAAAAAAAAAA",
        "CEAAAAAAAAAAAAAAAAAAAA",
        "CFAAAAAAAAAAAAAAAAAAAA",
        "CGAAAAAAAAAAAAAAAAAAAA",
        "CHAAAAAAAAAAAAAAAAAAAA",
    ];
    for key in keys {
        let (status, body) = send(
            &app,
            post_json(
                "/app/bundle",
                bundle_body(
                    Some("register"),
                    Some(key),
                    "/home",
                    json!([{ "function": "listPosts", "args": {} }]),
                    Some("user_1"),
                ),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "boot {key}: {body}");
    }
    let (status, body) = send(
        &app,
        post_json(
            "/app/bundle",
            bundle_body(
                Some("register"),
                Some("CIAAAAAAAAAAAAAAAAAAAA"),
                "/home",
                json!([{ "function": "listPosts", "args": {} }]),
                Some("user_1"),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(diagnostic_code(&body), "SNAPBACK_BUNDLE_PENDING_CAPACITY");
}

/// Per-authority bundle request rate (60/min) refuses coded.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn per_authority_rate_limit_is_coded() {
    let (app, _state) = app_with_seeded_state().await;
    let queries = json!([{ "function": "listPosts", "args": {} }]);
    let mut limited = None;
    for _ in 0..61 {
        let (status, body) = send(
            &app,
            post_json(
                "/app/bundle",
                bundle_body(
                    Some("read"),
                    None,
                    "/home",
                    queries.clone(),
                    Some("user_rate"),
                ),
            ),
        )
        .await;
        if status == StatusCode::TOO_MANY_REQUESTS {
            limited = Some(body);
            break;
        }
        assert_eq!(status, StatusCode::OK);
    }
    let limited = limited.expect("the 61st request inside one minute must be limited");
    assert_eq!(diagnostic_code(&limited), "SNAPBACK_BUNDLE_RATE_LIMITED");
}
