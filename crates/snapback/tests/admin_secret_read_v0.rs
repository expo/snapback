//! Adversarial HTTP acceptance for reset-bounded administrative secret reads.

use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext, ServerProfile};
use snapback::admin_secret_read::{
    SECRET_READ_LEASE_HEADER, SecretReadLease, SecretReadLeaseRequest, SecretReadOperator,
    SecretReadScope,
};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerPlan, IbexModule, QueryPlan, SchemaManifest,
    SeedData, TableManifest, ValueExpr,
};
use snapback::server::PolicyAuthMode;
use snapback_server::test_support::axum::body::Body;
use snapback_server::test_support::axum::http::{Request, StatusCode};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;
use tower::ServiceExt;

#[tokio::test]
async fn raw_rows_require_the_derived_table_scope_and_complete_budget() {
    let (app, operator) = sessions_app(ServerProfile::Dev);

    let missing = app
        .clone()
        .oneshot(get("/_snapback/api/data/items"))
        .await
        .unwrap();
    assert_diagnostic(
        missing,
        StatusCode::UNAUTHORIZED,
        "SNAPBACK_ADMIN_SECRET_READ_REQUIRED",
    )
    .await;

    let ordinary_admin = Request::builder()
        .uri("/_snapback/api/data/items")
        .header("x-snapback-admin-token", "ordinary-admin")
        .body(Body::empty())
        .unwrap();
    assert_diagnostic(
        app.clone().oneshot(ordinary_admin).await.unwrap(),
        StatusCode::UNAUTHORIZED,
        "SNAPBACK_ADMIN_SECRET_READ_REQUIRED",
    )
    .await;

    let wrong_scope = operator
        .mint(lease_request(
            [SecretReadScope::FunctionRun("listItems".to_owned())],
            10,
            1_000_000,
        ))
        .unwrap();
    assert_diagnostic(
        app.clone()
            .oneshot(get_with_lease("/_snapback/api/data/items", &wrong_scope))
            .await
            .unwrap(),
        StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED",
    )
    .await;

    let too_few_rows = operator
        .mint(lease_request(
            [SecretReadScope::Table("items".to_owned())],
            1,
            1_000_000,
        ))
        .unwrap();
    assert_diagnostic(
        app.clone()
            .oneshot(get_with_lease("/_snapback/api/data/items", &too_few_rows))
            .await
            .unwrap(),
        StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_ADMIN_SECRET_READ_BUDGET_EXHAUSTED",
    )
    .await;

    let too_few_bytes = operator
        .mint(lease_request(
            [SecretReadScope::Table("items".to_owned())],
            10,
            1,
        ))
        .unwrap();
    assert_diagnostic(
        app.clone()
            .oneshot(get_with_lease("/_snapback/api/data/items", &too_few_bytes))
            .await
            .unwrap(),
        StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_ADMIN_SECRET_READ_BUDGET_EXHAUSTED",
    )
    .await;

    let allowed = operator
        .mint(lease_request(
            [SecretReadScope::Table("items".to_owned())],
            2,
            1_000_000,
        ))
        .unwrap();
    let response = app
        .clone()
        .oneshot(get_with_lease("/_snapback/api/data/items", &allowed))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await["rows"].as_array().unwrap().len(),
        2
    );

    let reusable = operator
        .mint(lease_request(
            [SecretReadScope::Table("items".to_owned())],
            2,
            1_000_000,
        ))
        .unwrap();
    assert_diagnostic(
        app.clone()
            .oneshot(get_with_lease("/_snapback/api/data/notItems", &reusable))
            .await
            .unwrap(),
        StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED",
    )
    .await;
    let response = app
        .oneshot(get_with_lease("/_snapback/api/data/items", &reusable))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await["rows"].as_array().unwrap().len(),
        2
    );
}

#[tokio::test]
async fn direct_and_host_queries_charge_function_plus_declared_and_captured_tables() {
    let (app, operator) = sessions_app(ServerProfile::Dev);

    let function_only = operator
        .mint(lease_request(
            [SecretReadScope::FunctionRun("listItems".to_owned())],
            10,
            1_000_000,
        ))
        .unwrap();
    assert_diagnostic(
        app.clone()
            .oneshot(post_with_lease(
                "/_snapback/api/functions/listItems/run",
                json!({ "args": {} }),
                &function_only,
            ))
            .await
            .unwrap(),
        StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED",
    )
    .await;

    let full = operator
        .mint(lease_request(
            [
                SecretReadScope::FunctionRun("listItems".to_owned()),
                SecretReadScope::Table("items".to_owned()),
            ],
            10,
            1_000_000,
        ))
        .unwrap();
    let response = app
        .clone()
        .oneshot(post_with_lease(
            "/_snapback/api/functions/listItems/run",
            json!({ "args": {} }),
            &full,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["adminBypass"], true);
    assert_eq!(body["rows"].as_array().unwrap().len(), 2);
    assert!(
        body["captured_reads"]
            .as_array()
            .unwrap()
            .iter()
            .any(|dependency| dependency["table"] == "items")
    );

    // Statically declared scopes are admitted before invocation.
    let failing_function_only = operator
        .mint(lease_request(
            [SecretReadScope::FunctionRun("failingItems".to_owned())],
            10,
            1_000_000,
        ))
        .unwrap();
    assert_diagnostic(
        app.clone()
            .oneshot(post_with_lease(
                "/_snapback/api/host-ops",
                json!({ "operation": "function.run", "function": "failingItems" }),
                &failing_function_only,
            ))
            .await
            .unwrap(),
        StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED",
    )
    .await;

    let failing_full = operator
        .mint(lease_request(
            [
                SecretReadScope::FunctionRun("failingItems".to_owned()),
                SecretReadScope::Table("items".to_owned()),
            ],
            10,
            1_000_000,
        ))
        .unwrap();
    let response = app
        .oneshot(post_with_lease(
            "/_snapback/api/host-ops",
            json!({ "operation": "function.run", "function": "failingItems" }),
            &failing_full,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = json_body(response).await;
    assert_eq!(
        body["diagnostic"]["code"],
        "SNAPBACK_ADMIN_SECRET_READ_PROVENANCE_UNAVAILABLE"
    );
    assert!(!body.to_string().contains("SNAPBACK_ARG_MISSING"));
}

#[tokio::test]
async fn under_scoped_function_names_do_not_reveal_existence_before_lookup() {
    let (app, operator) = sessions_app(ServerProfile::Dev);
    let lease = operator
        .mint(lease_request(
            [SecretReadScope::FunctionRun("anotherFunction".to_owned())],
            10,
            1_000_000,
        ))
        .unwrap();
    for name in ["listItems", "doesNotExist"] {
        let mut request = post_with_lease(
            &format!("/_snapback/api/functions/{name}/run"),
            json!({ "args": {} }),
            &lease,
        );
        request.headers_mut().insert(
            snapback_server::test_support::axum::http::header::AUTHORIZATION,
            "Bearer ordinary-admin".parse().unwrap(),
        );
        assert_diagnostic(
            app.clone().oneshot(request).await.unwrap(),
            StatusCode::FORBIDDEN,
            "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED",
        )
        .await;
    }
}

#[tokio::test]
async fn ibex_read_then_throw_never_returns_handler_text_without_complete_provenance() {
    let (app, operator) = sessions_app(ServerProfile::Dev);
    for uri_body in [
        (
            "/_snapback/api/functions/readThenThrow/run",
            json!({ "args": {} }),
        ),
        (
            "/_snapback/api/host-ops",
            json!({ "operation": "function.run", "function": "readThenThrow" }),
        ),
    ] {
        let lease = operator
            .mint(lease_request(
                [
                    SecretReadScope::FunctionRun("readThenThrow".to_owned()),
                    SecretReadScope::Table("items".to_owned()),
                ],
                10,
                1_000_000,
            ))
            .unwrap();
        let response = app
            .clone()
            .oneshot(post_with_lease(uri_body.0, uri_body.1, &lease))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = json_body(response).await;
        assert_eq!(
            body["diagnostic"]["code"],
            "SNAPBACK_ADMIN_SECRET_READ_PROVENANCE_UNAVAILABLE"
        );
        assert!(!body.to_string().contains("HANDLER_SECRET_SENTINEL"));
    }

    let explain_lease = operator
        .mint(lease_request(
            [
                SecretReadScope::FunctionExplain("mutationReadThenThrow".to_owned()),
                SecretReadScope::Table("items".to_owned()),
            ],
            10,
            1_000_000,
        ))
        .unwrap();
    let response = app
        .oneshot(post_with_lease(
            "/_snapback/api/host-ops",
            json!({
                "operation": "function.explain",
                "kind": "mutationDryRun",
                "function": "mutationReadThenThrow"
            }),
            &explain_lease,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = json_body(response).await;
    assert_eq!(
        body["diagnostic"]["code"],
        "SNAPBACK_ADMIN_SECRET_READ_PROVENANCE_UNAVAILABLE"
    );
    assert!(!body.to_string().contains("EXPLAIN_HANDLER_SECRET_SENTINEL"));
}

#[tokio::test]
async fn admin_bypass_runners_refuse_production_on_both_transports() {
    let (app, operator) = sessions_app(ServerProfile::Prod);
    let lease = operator
        .mint(lease_request(
            [
                SecretReadScope::FunctionRun("listItems".to_owned()),
                SecretReadScope::Table("items".to_owned()),
            ],
            10,
            1_000_000,
        ))
        .unwrap();

    assert_diagnostic(
        app.clone()
            .oneshot(post_with_lease(
                "/_snapback/api/functions/listItems/run",
                json!({ "args": {} }),
                &lease,
            ))
            .await
            .unwrap(),
        StatusCode::FORBIDDEN,
        "SNAPBACK_PROFILE_FORBIDS",
    )
    .await;

    let response = app
        .oneshot(post_with_lease(
            "/_snapback/api/host-ops",
            json!({ "operation": "function.run", "function": "listItems" }),
            &lease,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["ok"], false);
    assert_eq!(body["diagnostics"][0]["code"], "SNAPBACK_PROFILE_FORBIDS");
}

fn sessions_app(profile: ServerProfile) -> (snapback::server::SnapbackApp, SecretReadOperator) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut context = ServerContext::from_bound_listener(&listener).unwrap();
    context.profile = profile;
    context.admin_token = Some("ordinary-admin".to_owned());
    let (state, operator) =
        AppState::try_from_snapback_with_secret_read_operator(seeded_snapback(), context)
            .expect("secret read app state");
    (
        snapback::server::app(state.with_policy_auth_mode(PolicyAuthMode::Sessions)),
        operator,
    )
}

fn lease_request(
    scopes: impl IntoIterator<Item = SecretReadScope>,
    row_budget: u64,
    byte_budget: u64,
) -> SecretReadLeaseRequest {
    SecretReadLeaseRequest {
        scopes: scopes.into_iter().collect::<BTreeSet<_>>(),
        ttl: Duration::from_secs(60),
        row_budget,
        byte_budget,
    }
}

fn get(uri: &str) -> Request<Body> {
    Request::builder().uri(uri).body(Body::empty()).unwrap()
}

fn get_with_lease(uri: &str, lease: &SecretReadLease) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header(SECRET_READ_LEASE_HEADER, lease.bearer())
        .body(Body::empty())
        .unwrap()
}

fn post_with_lease(uri: &str, value: Value, lease: &SecretReadLease) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .header(SECRET_READ_LEASE_HEADER, lease.bearer())
        .body(Body::from(value.to_string()))
        .unwrap()
}

async fn assert_diagnostic(
    response: snapback_server::test_support::axum::response::Response,
    status: StatusCode,
    code: &str,
) {
    assert_eq!(response.status(), status);
    assert_eq!(json_body(response).await["diagnostic"]["code"], code);
}

async fn json_body(response: snapback_server::test_support::axum::response::Response) -> Value {
    let bytes =
        snapback_server::test_support::axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn seeded_snapback() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().unwrap();
    snapback
        .apply_schema(SchemaManifest {
            tables: vec![TableManifest {
                name: "items".to_owned(),
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
            }],
            ..SchemaManifest::default()
        })
        .unwrap();
    snapback.load_functions(FunctionManifest {
        functions: vec![
            FunctionDefinition::new(
                "listItems",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            ),
            FunctionDefinition::new(
                "failingItems",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: vec![FilterExpr {
                        field: "title".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::Arg("requiredTitle".to_owned()),
                    }],
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            ),
            FunctionDefinition::new(
                "readThenThrow",
                FunctionKind::Query,
                FunctionRuntime::IbexModule(IbexModule {
                    source: r#"
export async function readThenThrow(ctx, args) {
  await ctx.db.query('items').collect();
  throw new Error('HANDLER_SECRET_SENTINEL');
}
"#
                    .to_owned(),
                    export: "readThenThrow".to_owned(),
                }),
            ),
            FunctionDefinition::new(
                "mutationReadThenThrow",
                FunctionKind::Mutation,
                FunctionRuntime::IbexModule(IbexModule {
                    source: r#"
export async function mutationReadThenThrow(ctx, args) {
  await ctx.db.query('items').collect();
  throw new Error('EXPLAIN_HANDLER_SECRET_SENTINEL');
}
"#
                    .to_owned(),
                    export: "mutationReadThenThrow".to_owned(),
                }),
            ),
        ],
        ..FunctionManifest::default()
    });
    let rows = vec![
        serde_json::from_value(json!({ "_id": "item_1", "title": "one" })).unwrap(),
        serde_json::from_value(json!({ "_id": "item_2", "title": "two" })).unwrap(),
    ];
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([("items".to_owned(), rows)]),
        })
        .unwrap();
    snapback
}
