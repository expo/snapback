//! Cross-lane acceptance for the ENG-24595 session-bypass closure.

use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext, ServerProfile};
use snapback::admin_secret_read::{
    SECRET_READ_LEASE_HEADER, SecretReadLease, SecretReadLeaseRequest, SecretReadScope,
};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    ConfigEntryDefinition, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition,
    FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule,
    QueryPlan, SchemaManifest, SeedData, TableManifest, ValueExpr,
};
use snapback::server::PolicyAuthMode;
use snapback_server::test_support::axum::body::{Body, to_bytes};
use snapback_server::test_support::axum::http::{Request, StatusCode};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;
use tower::ServiceExt;

const MASTER: &str = "master-admin";
const ROW_SENTINEL: &str = "PRIVATE_ROW_SENTINEL_MUST_NOT_ESCAPE";
const INSPECT_SOURCE_SENTINEL: &str = "INSPECT_SOURCE_SENTINEL_MUST_NOT_ESCAPE";
const INSPECT_DIAGNOSTIC_SENTINEL: &str = "INSPECT_DIAGNOSTIC_SENTINEL_MUST_NOT_ESCAPE";
const RECEIPT_CORRELATION_SENTINEL: &str = "RECEIPT_CORRELATION_SENTINEL_MUST_NOT_ESCAPE";
const RECEIPT_SCOPE_SENTINEL: &str = "RECEIPT_SCOPE_SENTINEL_MUST_NOT_ESCAPE";
const RUNNER_QUERY_ARG_SENTINEL: &str = "RUNNER_QUERY_ARG_SENTINEL_MUST_NOT_ESCAPE";

const RESPONSE_SENTINELS: [&str; 6] = [
    ROW_SENTINEL,
    INSPECT_SOURCE_SENTINEL,
    INSPECT_DIAGNOSTIC_SENTINEL,
    RECEIPT_CORRELATION_SENTINEL,
    RECEIPT_SCOPE_SENTINEL,
    RUNNER_QUERY_ARG_SENTINEL,
];

#[tokio::test]
async fn console_and_admin_credentials_cannot_substitute_for_secret_read() {
    let (app, operator) = sessions_app();
    let wrong_carrier = app
        .clone()
        .oneshot(post_json(
            "/_snapback/api/console/credential",
            json!({}),
            Some(("authorization", "Bearer master-admin")),
        ))
        .await
        .unwrap();
    assert_eq!(wrong_carrier.status(), StatusCode::UNAUTHORIZED);

    let minted = app
        .clone()
        .oneshot(post_json(
            "/_snapback/api/console/credential",
            json!({}),
            Some(("x-snapback-admin-token", MASTER)),
        ))
        .await
        .unwrap();
    assert_eq!(minted.status(), StatusCode::OK);
    let console = json_body(minted).await["credential"]
        .as_str()
        .unwrap()
        .to_owned();

    // The outer AdminWrite gate accepts the derived console credential, but
    // sliding renewal is dev-policy-only. A dev Authorization spelling cannot
    // combine with it to cross the sessions boundary.
    let combined_wrong_carriers = app
        .clone()
        .oneshot(post_json_with_headers(
            "/_snapback/api/console/credential",
            json!({}),
            &[
                ("x-snapback-console-credential", console.as_str()),
                ("authorization", "Bearer master-admin"),
            ],
        ))
        .await
        .unwrap();
    assert_diagnostic(
        combined_wrong_carriers,
        StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_CONSOLE_RENEWAL_UNAVAILABLE",
    )
    .await;

    for (header, credential) in [
        ("x-snapback-admin-token", MASTER),
        ("x-snapback-console-credential", console.as_str()),
        ("authorization", "Bearer master-admin"),
    ] {
        for uri in [
            "/_snapback/api/inspect",
            "/_snapback/api/receipts",
            "/_snapback/api/data/items",
        ] {
            let response = app
                .clone()
                .oneshot(get_with_header(uri, header, credential))
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::UNAUTHORIZED,
                "{header} {uri}"
            );
            let encoded = json_body(response).await.to_string();
            assert_no_response_sentinel(&encoded, &format!("{header} {uri}"));
        }

        let response = app
            .clone()
            .oneshot(post_json(
                "/_snapback/api/functions/queryByValue/run",
                json!({ "args": { "needle": RUNNER_QUERY_ARG_SENTINEL } }),
                Some((header, credential)),
            ))
            .await
            .unwrap();
        let expected = if header == "authorization" {
            // Authorization is not an admissible coarse carrier in sessions,
            // so branch selection never runs.
            "SNAPBACK_ADMIN_TOKEN_REQUIRED"
        } else {
            // Ordinary/derived admin admits branch selection but cannot
            // substitute for the query branch's secret-read lease.
            "SNAPBACK_ADMIN_SECRET_READ_REQUIRED"
        };
        assert_diagnostic(response, StatusCode::UNAUTHORIZED, expected).await;
    }

    let inspect = operator
        .mint(lease([SecretReadScope::AdminInspect], 10, 1_000_000))
        .unwrap();
    let response = app
        .clone()
        .oneshot(get_with_lease("/_snapback/api/inspect", &inspect))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let inspect_body = json_body(response).await;
    let source = inspect_body["functions"]["functions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|function| function["name"] == "sourceSentinel")
        .and_then(|function| function["runtime"]["IbexModule"]["source"].as_str())
        .expect("gated inspect retains handler source");
    assert!(source.contains(INSPECT_SOURCE_SENTINEL), "{inspect_body}");
    let diagnostic = inspect_body["recentDiagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .find(|diagnostic| diagnostic["code"] == "SNAPBACK_CONFIG_REQUIRED_MISSING")
        .expect("fixture records a sensitive diagnostic");
    assert!(
        diagnostic["message"]
            .as_str()
            .is_some_and(|message| message.contains(INSPECT_DIAGNOSTIC_SENTINEL)),
        "{diagnostic}"
    );
    assert!(
        diagnostic["details"]["entries"]
            .as_array()
            .is_some_and(|entries| entries
                .iter()
                .any(|entry| entry == INSPECT_DIAGNOSTIC_SENTINEL)),
        "{diagnostic}"
    );

    let receipts = operator
        .mint(lease([SecretReadScope::Receipts], 10, 1_000_000))
        .unwrap();
    let response = app
        .clone()
        .oneshot(get_with_lease("/_snapback/api/receipts", &receipts))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let receipts_body = json_body(response).await;
    assert!(
        receipts_body["global"]
            .as_array()
            .unwrap()
            .iter()
            .any(|receipt| receipt["correlation"]["probe"] == RECEIPT_CORRELATION_SENTINEL),
        "{receipts_body}"
    );
    assert!(
        receipts_body["connections"]["receipt_connection"]
            .as_array()
            .unwrap()
            .iter()
            .any(|receipt| receipt["scope"]["probe"] == RECEIPT_SCOPE_SENTINEL),
        "{receipts_body}"
    );

    let runner = operator
        .mint(lease(
            [
                SecretReadScope::FunctionRun("queryByValue".to_owned()),
                SecretReadScope::Table("items".to_owned()),
            ],
            10,
            1_000_000,
        ))
        .unwrap();
    let response = app
        .clone()
        .oneshot(post_json(
            "/_snapback/api/functions/queryByValue/run",
            json!({ "args": { "needle": RUNNER_QUERY_ARG_SENTINEL } }),
            Some((SECRET_READ_LEASE_HEADER, runner.bearer())),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let runner_body = json_body(response).await;
    assert!(
        runner_body.to_string().contains(RUNNER_QUERY_ARG_SENTINEL),
        "{runner_body}"
    );

    let rows = operator
        .mint(lease(
            [SecretReadScope::Table("items".to_owned())],
            10,
            1_000_000,
        ))
        .unwrap();
    let response = app
        .oneshot(get_with_lease("/_snapback/api/data/items", &rows))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(json_body(response).await.to_string().contains(ROW_SENTINEL));
}

#[tokio::test]
async fn only_a_committed_reset_invalidates_existing_leases() {
    let (app, operator) = sessions_app();
    let lease = operator
        .mint(lease(
            [SecretReadScope::Table("items".to_owned())],
            10,
            1_000_000,
        ))
        .unwrap();

    assert_eq!(
        app.clone()
            .oneshot(get_with_lease("/_snapback/api/data/items", &lease))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );

    let failed = app
        .clone()
        .oneshot(post_json(
            "/_snapback/api/app/reset",
            json!({
                "seed": {
                    "tables": {
                        "not_in_the_schema": [{ "_id": "bad" }]
                    }
                }
            }),
            Some(("x-snapback-admin-token", MASTER)),
        ))
        .await
        .unwrap();
    assert_diagnostic(failed, StatusCode::NOT_FOUND, "SNAPBACK_UNKNOWN_TABLE").await;

    let after_failed = app
        .clone()
        .oneshot(get_with_lease("/_snapback/api/data/items", &lease))
        .await
        .unwrap();
    assert_eq!(after_failed.status(), StatusCode::OK);
    assert!(
        json_body(after_failed)
            .await
            .to_string()
            .contains(ROW_SENTINEL)
    );

    let committed = app
        .clone()
        .oneshot(post_json(
            "/_snapback/api/app/reset",
            json!({}),
            Some(("x-snapback-admin-token", MASTER)),
        ))
        .await
        .unwrap();
    assert_eq!(committed.status(), StatusCode::OK);

    let stale = app
        .oneshot(get_with_lease("/_snapback/api/data/items", &lease))
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json_body(stale).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_SECRET_READ_REQUIRED"
    );
}

fn sessions_app() -> (
    snapback::server::SnapbackApp,
    snapback::admin_secret_read::SecretReadOperator,
) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut context = ServerContext::from_bound_listener(&listener).unwrap();
    context.profile = ServerProfile::Dev;
    context.admin_token = Some(MASTER.to_owned());
    let (state, operator) =
        AppState::try_from_snapback_with_secret_read_operator(seeded_snapback(), context)
            .expect("auth bypass app state");
    (
        snapback::server::app(state.with_policy_auth_mode(PolicyAuthMode::Sessions)),
        operator,
    )
}

fn seeded_snapback() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().unwrap();
    snapback
        .apply_schema(SchemaManifest {
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields: vec![FieldManifest {
                    name: "value".to_owned(),
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
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![
                    serde_json::from_value(json!({
                        "_id": "item_private",
                        "value": ROW_SENTINEL,
                    }))
                    .unwrap(),
                    serde_json::from_value(json!({
                        "_id": "item_runner_arg",
                        "value": RUNNER_QUERY_ARG_SENTINEL,
                    }))
                    .unwrap(),
                ],
            )]),
        })
        .unwrap();
    snapback.load_functions(FunctionManifest {
        functions: vec![
            FunctionDefinition::new(
                "queryByValue",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: vec![FilterExpr {
                        field: "value".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::Arg("needle".to_owned()),
                    }],
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            ),
            FunctionDefinition::new(
                "scopeItems",
                FunctionKind::LiveQuery,
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
                "sourceSentinel",
                FunctionKind::Query,
                FunctionRuntime::IbexModule(IbexModule {
                    source: format!(
                        "export const sourceSentinel = async () => {{ /* {INSPECT_SOURCE_SENTINEL} */ return []; }};"
                    ),
                    export: "sourceSentinel".to_owned(),
                }),
            ),
        ],
        config: vec![ConfigEntryDefinition {
            name: INSPECT_DIAGNOSTIC_SENTINEL.to_owned(),
            description: None,
            purpose: None,
            secret: true,
            required: true,
            pool: false,
            probe: None,
            how_to_get: None,
            acquisition: None,
            default: None,
            source_span: None,
        }],
        ..FunctionManifest::default()
    });

    let mut receipt_input = HandlerInput {
        args: json!({}),
        ..HandlerInput::default()
    };
    receipt_input.correlation = Some(json!({ "probe": RECEIPT_CORRELATION_SENTINEL }));
    let _ = snapback.invoke_mutation_recording("missingReceiptMutation", receipt_input);

    snapback
        .subscribe_live(
            "scopeItems",
            LiveSubscribeInput {
                connection_id: "receipt_connection".to_owned(),
                input: HandlerInput {
                    args: json!({ "probe": RECEIPT_SCOPE_SENTINEL }),
                    ..HandlerInput::default()
                },
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .unwrap();
    snapback
}

fn lease(
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

fn get_with_header(uri: &str, header: &str, value: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header(header, value)
        .body(Body::empty())
        .unwrap()
}

fn get_with_lease(uri: &str, lease: &SecretReadLease) -> Request<Body> {
    get_with_header(uri, SECRET_READ_LEASE_HEADER, lease.bearer())
}

fn post_json(uri: &str, body: Value, header: Option<(&str, &str)>) -> Request<Body> {
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json");
    if let Some((name, value)) = header {
        request = request.header(name, value);
    }
    request.body(Body::from(body.to_string())).unwrap()
}

fn post_json_with_headers(uri: &str, body: Value, headers: &[(&str, &str)]) -> Request<Body> {
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json");
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    request.body(Body::from(body.to_string())).unwrap()
}

async fn assert_diagnostic(
    response: snapback_server::test_support::axum::response::Response,
    status: StatusCode,
    code: &str,
) {
    assert_eq!(response.status(), status);
    let body = json_body(response).await;
    assert_eq!(body["diagnostic"]["code"], code, "{body}");
    assert_no_response_sentinel(&body.to_string(), code);
}

fn assert_no_response_sentinel(encoded: &str, context: &str) {
    for sentinel in RESPONSE_SENTINELS {
        assert!(
            !encoded.contains(sentinel),
            "{context} leaked {sentinel}: {encoded}"
        );
    }
}

async fn json_body(response: snapback_server::test_support::axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
