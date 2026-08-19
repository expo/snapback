use serde_json::Value;
use snapback::admin::AppState;
use snapback::local::LocalSnapback;
use snapback::server::app;
use snapback_server::test_support::axum::body::{Body, to_bytes};
use snapback_server::test_support::axum::http::{Request, StatusCode};
use tower::ServiceExt;

#[tokio::test]
async fn local_unknown_route_returns_versioned_api_error_with_registry_candidates() {
    let response = app(AppState::try_detached(
        LocalSnapback::memory().expect("in-memory unknown-route server"),
    )
    .expect("detached unknown-route app state"))
    .oneshot(
        Request::builder()
            .uri("/qurey/missing")
            .body(Body::empty())
            .expect("unknown-route request"),
    )
    .await
    .expect("unknown-route response");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body: Value = serde_json::from_slice(
        &to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read unknown-route response"),
    )
    .expect("unknown-route JSON");
    assert_eq!(body["formatVersion"], "snapback.error-response.v1");
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_ROUTE_UNKNOWN");
    assert_eq!(body["diagnostic"]["details"]["path"], "unrecognized");
    assert!(
        body["diagnostic"]["details"]["candidatePaths"]
            .as_array()
            .expect("candidate paths")
            .iter()
            .any(|candidate| candidate == "/query/{name}"),
        "the nearest registered query route should be suggested"
    );
}
