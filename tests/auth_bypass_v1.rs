//! Cross-lane acceptance for the ENG-24595 session-bypass closure.

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext, ServerProfile};
use snapback::admin_secret_read::{
    SECRET_READ_LEASE_HEADER, SecretReadLease, SecretReadLeaseRequest, SecretReadScope,
};
use snapback::local::LocalSnapback;
use snapback::manifest::{FieldManifest, FieldType, SchemaManifest, SeedData, TableManifest};
use snapback::server::PolicyAuthMode;
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};
use tower::ServiceExt;

const MASTER: &str = "master-admin";
const ROW_SENTINEL: &str = "PRIVATE_ROW_SENTINEL_MUST_NOT_ESCAPE";

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
            assert!(!encoded.contains(ROW_SENTINEL), "{header} {uri}: {encoded}");
        }
    }

    let inspect = operator
        .mint(lease([SecretReadScope::AdminInspect], 10, 1_000_000))
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(get_with_lease("/_snapback/api/inspect", &inspect))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );

    let receipts = operator
        .mint(lease([SecretReadScope::Receipts], 10, 1_000_000))
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(get_with_lease("/_snapback/api/receipts", &receipts))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );

    let rows = operator
        .mint(lease(
            [SecretReadScope::Table("items".to_owned())],
            1,
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
    assert_ne!(failed.status(), StatusCode::OK);

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
    axum::Router,
    snapback::admin_secret_read::SecretReadOperator,
) {
    let (state, operator) = AppState::from_snapback_with_secret_read_operator(
        seeded_snapback(),
        ServerContext {
            host: "127.0.0.1".to_owned(),
            port: 4287,
            loopback: true,
            profile: ServerProfile::Dev,
            pid: std::process::id(),
            started: Instant::now(),
            started_at_ms: 0,
            admin_token: Some(MASTER.to_owned()),
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
                ],
            )]),
        })
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

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
