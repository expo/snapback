//! LLP 0076 diagnostic-envelope acceptance: stream refusals survive the real
//! host-op -> FFI -> handler-envelope -> action-result path with their exact
//! code AND the host-built structured detail (operation, expected shape,
//! value-free received summary, repair anchor), while a handler that forges a
//! stream code receives no trusted detail. Also executes the "queries and
//! mutations cannot open streams" acceptance negative.
//!
// @ref LLP 0076#diagnostics — every promised code family survives the
//   envelope; forged codes stay untrusted.

fn test_detached_app_state(snapback: snapback::local::LocalSnapback) -> snapback::admin::AppState {
    snapback::admin::AppState::try_detached(snapback).expect("detached test app state")
}

use axum::body::Body;
use axum::http::Request;
use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    ConfigEntryDefinition, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    IbexModule,
};
use tower::ServiceExt;

const STREAM_SECRET: &str = "stream-secret-value-7f3a";

const HANDLERS: &str = r#"
globalThis.__snapbackHandlers = {
  async secretStreamLeakProbe(ctx) {
    // The worst authored case: the secret rides the URL, a header, AND the
    // handler's own rethrown error text. The staged-value redactor must
    // scrub the envelope; the host diagnostic never carried values at all.
    var key = ctx.secrets.get('streamKey').expose();
    try {
      await ctx.fetchStream({
        url: 'http://127.0.0.1:9/leak?api_key=' + key,
        headers: { authorization: 'Bearer ' + key }
      });
    } catch (error) {
      throw new Error(String(error && error.message) + ' key=' + key);
    }
    return { unreachable: true };
  },
  async secretStreamRefusalProbe(ctx) {
    // The untouched-refusal case: the stream refusal propagates as-is with
    // the secret placed in the request; the surfaced structured diagnostic
    // must stay value-free.
    var key = ctx.secrets.get('streamKey').expose();
    await ctx.fetchStream({
      url: 'http://127.0.0.1:9/refused?api_key=' + key,
      headers: { authorization: 'Bearer ' + key }
    });
    return { unreachable: true };
  },
  async streamInvalidProbe(ctx) {
    // The refusal must propagate untouched: file:// is not an absolute
    // HTTP(S) URL, and the path segment is private data that must never
    // appear in the surfaced diagnostic.
    await ctx.fetchStream({ url: 'file:///never-log-this-private-path' });
    return { unreachable: true };
  },
  async streamSsrfProbe(ctx) {
    await ctx.fetchStream({ url: 'http://169.254.169.254/latest/meta-data/private' });
    return { unreachable: true };
  },
  async fetchSsrfProbe(ctx) {
    await ctx.fetch({ url: 'http://169.254.169.254/latest/meta-data/private' });
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
    let mut leak_probe = define("secretStreamLeakProbe", FunctionKind::Action);
    leak_probe.uses = vec!["streamKey".to_owned()];
    let mut refusal_probe = define("secretStreamRefusalProbe", FunctionKind::Action);
    refusal_probe.uses = vec!["streamKey".to_owned()];
    // Positive admission witness: with egress enabled in this process, the
    // served instance manifest supports the stream capability and the loader
    // admits a stream-requiring artifact (the lib suite carries the
    // egress-disabled negative twin). The acknowledgment below predates the
    // capability's promotion to stable (LLP 0076 Accepted 2026-07-25) and is
    // deliberately retained: a surviving acknowledgment is a no-op, and the
    // unacknowledged twin below witnesses that admission no longer needs it.
    refusal_probe.required_capabilities = vec!["bounded_response_stream_v1".to_owned()];
    FunctionManifest {
        acknowledged_experimental_capabilities: vec!["bounded_response_stream_v1".to_owned()],
        functions: vec![
            define("streamInvalidProbe", FunctionKind::Action),
            define("streamSsrfProbe", FunctionKind::Action),
            define("fetchSsrfProbe", FunctionKind::Action),
            define("forgedStreamCodeProbe", FunctionKind::Action),
            define("mutationStreamProbe", FunctionKind::Mutation),
            leak_probe,
            refusal_probe,
        ],
        config: vec![ConfigEntryDefinition {
            name: "streamKey".to_owned(),
            description: Some("stream secret redaction test entry".to_owned()),
            purpose: None,
            secret: true,
            required: false,
            pool: false,
            probe: None,
            how_to_get: None,
            acquisition: None,
            default: None,
            source_span: None,
        }],
        ..FunctionManifest::default()
    }
}

async fn stream_app() -> snapback::server::SnapbackApp {
    tokio::task::spawn_blocking(|| {
        // SAFETY: set before the first Ibex host/VM use in this test binary,
        // and every test in this file wants the same value.
        unsafe { std::env::set_var("SNAPBACK_OUTBOUND_ACTIONS", "1") };
        unsafe { std::env::set_var("SNAPBACK_OUTBOUND_LOOPBACK", "1") };
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        let diagnostics = snapback.load_functions(functions());
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.code == "SNAPBACK_IBEX_FUNCTIONS_LOADED")
        );
        snapback
            .set_config_entry("streamKey", vec![STREAM_SECRET.to_owned()], false, "test")
            .expect("stage stream secret");
        snapback::server::app(test_detached_app_state(snapback))
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
        details["expected"]
            .as_str()
            .is_some_and(|expected| expected.contains("http")),
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
async fn destination_policy_refusals_survive_both_real_action_fetch_paths() {
    let app = stream_app().await;
    for (function, expected_code) in [
        ("streamSsrfProbe", "SNAPBACK_ACTION_STREAM_SSRF_REFUSED"),
        ("fetchSsrfProbe", "SNAPBACK_HOST_FETCH_SSRF_REFUSED"),
    ] {
        let response = app
            .clone()
            .oneshot(post_json(
                &format!("/action/{function}"),
                handler_body(),
            ))
            .await
            .expect("action response");
        let body = body_json(response).await;
        assert_eq!(
            body["diagnostic"]["code"], expected_code,
            "the host-authored SSRF refusal must survive the handler envelope: {body}"
        );
        let serialized = body.to_string();
        assert!(
            !serialized.contains("169.254.169.254")
                && !serialized.contains("latest/meta-data/private"),
            "destination policy diagnostics must remain value-free: {body}"
        );
    }
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
async fn staged_secret_values_are_scrubbed_from_stream_error_envelopes() {
    // @ref LLP 0036#runtime-exposure-d5-d8 — the staged-value redactor
    // applies to streamed-fetch failures exactly as to ordinary fetch: even
    // a handler that rethrows the refusal with the secret embedded in its
    // own message surfaces only [REDACTED].
    let app = stream_app().await;
    let response = app
        .oneshot(post_json("/action/secretStreamLeakProbe", handler_body()))
        .await
        .expect("leak probe response");
    let body = serde_json::to_string(&body_json(response).await).expect("serialize body");
    assert!(
        !body.contains(STREAM_SECRET),
        "the staged secret must never survive the envelope: {body}"
    );
    assert!(
        body.contains("[REDACTED]"),
        "the redactor must witness the scrub: {body}"
    );
}

#[tokio::test]
async fn untouched_stream_refusals_stay_value_free_with_secrets_in_the_request() {
    let app = stream_app().await;
    let response = app
        .oneshot(post_json(
            "/action/secretStreamRefusalProbe",
            handler_body(),
        ))
        .await
        .expect("refusal probe response");
    let body = body_json(response).await;
    assert_eq!(
        body["diagnostic"]["code"], "SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED",
        "connection refused on a safe method settles failed: {body}"
    );
    let serialized = body.to_string();
    assert!(
        !serialized.contains(STREAM_SECRET),
        "the secret-bearing URL/header must never enter the diagnostic: {body}"
    );
    assert!(
        !serialized.contains("api_key"),
        "URL query structure must not enter the diagnostic: {body}"
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

#[tokio::test]
async fn stable_stream_requirement_admits_without_acknowledgment() {
    // @ref LLP 0058#capability-maturity — promotion regression for LLP 0076's
    // acceptance (2026-07-25): the stream id is stable, so positive presence
    // is the plain compatibility assertion and an artifact that never
    // acknowledged the (former) experimental contract admits cleanly. Before
    // acceptance this exact fixture was refused SNAPBACK_CAPABILITY_UNSUPPORTED;
    // the still-experimental refusal path stays witnessed in the lib suite
    // via `relational_query_v1`.
    let diagnostics = tokio::task::spawn_blocking(|| {
        // SAFETY: same value every test in this binary wants; see stream_app.
        unsafe { std::env::set_var("SNAPBACK_OUTBOUND_ACTIONS", "1") };
        unsafe { std::env::set_var("SNAPBACK_OUTBOUND_LOOPBACK", "1") };
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        let mut unacknowledged = functions();
        unacknowledged
            .acknowledged_experimental_capabilities
            .clear();
        let mut snapback = LocalSnapback::memory().expect("memory snapback");
        snapback.load_functions(unacknowledged)
    })
    .await
    .expect("unacknowledged fixture");
    assert!(
        !diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "SNAPBACK_CAPABILITY_UNSUPPORTED"),
        "stable stream support must admit without acknowledgment: {diagnostics:?}"
    );
}
