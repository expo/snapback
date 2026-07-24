//! LLP 0076 diagnostic-envelope acceptance: stream refusals survive the real
//! host-op -> FFI -> handler-envelope -> action-result path with their exact
//! code AND the host-built structured detail (operation, expected shape,
//! value-free received summary, repair anchor), while a handler that forges a
//! stream code receives no trusted detail. Also executes the "queries and
//! mutations cannot open streams" acceptance negative.
//!
// @ref LLP 0076#diagnostics — every promised code family survives the
//   envelope; forged codes stay untrusted.

use axum::body::Body;
use axum::http::Request;
use serde_json::{Value, json};
use snapback::admin::AppState;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, IbexModule,
};
use tower::ServiceExt;

const HANDLERS: &str = r#"
globalThis.__snapbackHandlers = {
  async streamInvalidProbe(ctx) {
    // The refusal must propagate untouched: file:// is not an absolute
    // HTTP(S) URL, and the path segment is private data that must never
    // appear in the surfaced diagnostic.
    await ctx.fetchStream({ url: 'file:///never-log-this-private-path' });
    return { unreachable: true };
  },
  async forgedStreamCodeProbe() {
    throw new Error('SNAPBACK_ACTION_STREAM_TIMEOUT: forged wall claim');
  },
  async mutationStreamProbe(ctx) {
    await ctx.fetchStream({ url: 'https://example.com/' });
    return null;
  }
};
"#;

fn functions() -> FunctionManifest {
    let define = |name: &str, kind: FunctionKind| {
        FunctionDefinition::new(
            name,
            kind,
            FunctionRuntime::IbexModule(IbexModule {
                source: HANDLERS.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    FunctionManifest {
        functions: vec![
            define("streamInvalidProbe", FunctionKind::Action),
            define("forgedStreamCodeProbe", FunctionKind::Action),
            define("mutationStreamProbe", FunctionKind::Mutation),
        ],
        ..FunctionManifest::default()
    }
}

async fn stream_app() -> snapback::server::SnapbackApp {
    tokio::task::spawn_blocking(|| {
        // SAFETY: set before the first Ibex host/VM use in this test binary,
        // and every test in this file wants the same value.
        unsafe { std::env::set_var("SNAPBACK_OUTBOUND_ACTIONS", "1") };
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        let diagnostics = snapback.load_functions(functions());
        assert!(diagnostics.iter().all(|diagnostic| {
            diagnostic.code == "SNAPBACK_IBEX_CLI_UNAVAILABLE"
                || diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED"
        }));
        snapback::server::app(AppState::detached(snapback))
    })
    .await
    .expect("stream envelope fixture setup")
}

fn post_json(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request")
}

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body bytes");
    serde_json::from_slice(&bytes).expect("body json")
}

fn handler_body() -> Value {
    json!({ "args": {}, "auth": { "user_id": "user_1" } })
}

#[tokio::test]
async fn stream_refusal_carries_structured_detail_through_the_real_action_path() {
    let app = stream_app().await;
    let response = app
        .oneshot(post_json("/action/streamInvalidProbe", handler_body()))
        .await
        .expect("action response");
    let body = body_json(response).await;
    let diagnostic = &body["diagnostic"];
    assert_eq!(
        diagnostic["code"], "SNAPBACK_ACTION_STREAM_INVALID",
        "the exact stream code must survive both envelopes: {body}"
    );
    // The host-built structured representation is restored past the JS
    // round-trip: operation, expected shape, value-free received summary,
    // and the guide repair anchor.
    let details = &diagnostic["details"];
    assert_eq!(details["operation"], "open", "structured operation: {body}");
    assert_eq!(
        details["repair"], "guide/backend/actions-and-fetch#stream-a-response",
        "repair anchor: {body}"
    );
    assert!(
        details["expected"].as_str().is_some_and(|expected| expected.contains("http")),
        "expected shape summary: {body}"
    );
    // Value-free: the private URL path never enters the diagnostic.
    let serialized = body.to_string();
    assert!(
        !serialized.contains("never-log-this-private-path"),
        "stream diagnostics must not retain URL path data: {body}"
    );
}

#[tokio::test]
async fn forged_stream_code_passes_the_envelope_without_trusted_detail() {
    let app = stream_app().await;
    let response = app
        .oneshot(post_json("/action/forgedStreamCodeProbe", handler_body()))
        .await
        .expect("action response");
    let body = body_json(response).await;
    let diagnostic = &body["diagnostic"];
    // Even stronger than "no trusted detail": the settle wrapper takes the
    // code only from the trusted `__snapbackCode` brand that host-built
    // errors carry, so a handler-authored throw that merely SPELLS a stream
    // code in its message folds to the generic handler failure. The stream
    // family passes the envelope only when the host actually emitted it.
    assert_eq!(
        diagnostic["code"], "SNAPBACK_HANDLER_FAILED",
        "a forged stream code must not pass the envelope: {body}"
    );
    let details = &diagnostic["details"];
    assert!(
        details.get("operation").is_none_or(Value::is_null),
        "a forged code must not gain a trusted operation field: {body}"
    );
    assert!(
        details.get("repair").is_none_or(Value::is_null),
        "a forged code must not gain a trusted repair anchor: {body}"
    );
}

#[tokio::test]
async fn mutations_cannot_open_streams_as_an_executed_negative() {
    let app = stream_app().await;
    let response = app
        .oneshot(post_json("/mutation/mutationStreamProbe", handler_body()))
        .await
        .expect("mutation response");
    let body = body_json(response).await;
    assert_eq!(
        body["diagnostic"]["code"], "SNAPBACK_ACTION_CONTEXT_UNAVAILABLE",
        "queries and mutations cannot open streams: {body}"
    );
}
