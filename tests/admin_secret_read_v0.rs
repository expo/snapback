//! Adversarial HTTP acceptance for reset-bounded administrative secret reads.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext, ServerProfile};
use snapback::admin_secret_read::{
    SECRET_READ_LEASE_HEADER, SecretReadLease, SecretReadLeaseRequest, SecretReadOperator,
    SecretReadScope,
};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerPlan, QueryPlan, SchemaManifest, SeedData,
    TableManifest, ValueExpr,
};
use snapback::server::PolicyAuthMode;
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};
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
        .oneshot(get_with_lease("/_snapback/api/data/items", &allowed))
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

    // The handler-level scope check must replace the failing query's
    // diagnostic too; a valid but under-scoped lease cannot use errors as an
    // application-data oracle.
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
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["ok"], false);
    assert_eq!(body["authority"]["adminBypass"], true);
    assert_eq!(body["diagnostics"][0]["code"], "SNAPBACK_ARG_MISSING");
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

fn sessions_app(profile: ServerProfile) -> (axum::Router, SecretReadOperator) {
    let (state, operator) = AppState::from_snapback_with_secret_read_operator(
        seeded_snapback(),
        ServerContext {
            profile,
            host: "127.0.0.1".to_owned(),
            port: 4287,
            loopback: true,
            pid: std::process::id(),
            started: Instant::now(),
            started_at_ms: 0,
            admin_token: Some("ordinary-admin".to_owned()),
            admin_token_minted: false,
            admin_token_file: None,
            console_credentials: Default::default(),
            admin_dist: None,
        },
    );
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

async fn assert_diagnostic(response: axum::response::Response, status: StatusCode, code: &str) {
    assert_eq!(response.status(), status);
    assert_eq!(json_body(response).await["diagnostic"]["code"], code);
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
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
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    indexed_by: None,
                })),
            ),
            FunctionDefinition::new(
                "failingItems",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table: "items".to_owned(),
                    filters: vec![FilterExpr {
                        field: "title".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::Arg("requiredTitle".to_owned()),
                    }],
                    order: Vec::new(),
                    limit: None,
                    indexed_by: None,
                })),
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
