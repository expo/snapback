use crate::admin::AppState;
use crate::diagnostic::{Diagnostic, SnapbackError};
use crate::ephemeral::{DeleteRequest, EphemeralCollection, PublishRequest, SubscribeRequest};
use crate::local::{InspectState, LiveResumeInput, LiveSubscribeInput, LocalSnapback};
use crate::manifest::{FunctionManifest, HandlerInput, SchemaManifest, SeedData};
use crate::runtime::CapabilityState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderValue, Method, Request, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router, body::Body};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tokio::time::{Duration, interval};

pub type SharedSnapback = Arc<Mutex<LocalSnapback>>;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub target: String,
    pub sqlite_version: u64,
    pub ibex_available: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DiagnosticsResponse {
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ErrorResponse {
    pub diagnostic: Diagnostic,
}

/// The v0 core routes. These remain as compatibility aliases while
/// `/_snapback/*` becomes the long-term admin namespace.
///
/// @ref LLP 0003#agent-and-test-surface — the local core exposes inspect, reset, load, and invocation endpoints.
/// @ref LLP 0017#serving-model — current local routes continue as v0 aliases beside the reserved `/_snapback/*` namespace.
fn core_routes() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/inspect", get(inspect))
        .route("/admin/schema", post(apply_schema))
        .route("/admin/functions", post(load_functions))
        .route("/admin/reset", post(reset))
        .route("/admin/seed", post(seed))
        .route("/query/{name}", post(invoke_query))
        .route("/mutation/{name}", post(invoke_mutation))
        .route("/live/{name}/subscribe", post(subscribe_live))
        .route("/live/{name}/resume", post(resume_live))
        .route("/live/{connection_id}/stream", get(stream_live))
        .route("/outbox/{connection_id}", get(drain_outbox))
        .route(
            "/ephemeral/collections",
            post(register_ephemeral_collection),
        )
        .route(
            "/ephemeral/collections/ensure",
            post(ensure_ephemeral_collections),
        )
        .route("/ephemeral/publish", post(publish_ephemeral))
        .route("/ephemeral/subscribe", post(subscribe_ephemeral))
        .route("/ephemeral/delete", post(delete_ephemeral))
        .route("/ephemeral/cleanup", post(cleanup_ephemeral))
        .route("/connections/{connection_id}/disconnect", post(disconnect))
}

/// The full Snapback HTTP surface: v0 core routes plus the `/_snapback/*` admin
/// namespace and packaged web console, served from one server.
///
/// @ref LLP 0017#serving-model — the admin API and console are served by the
/// same server that owns the instance.
pub fn app(state: AppState) -> Router {
    core_routes()
        .merge(crate::admin::admin_routes())
        .with_state(state)
        .layer(middleware::from_fn(local_dev_cors))
}

/// Backwards-compatible entry point: build the full app with a detached
/// (loopback, address-unknown) server context.
pub fn router(state: SharedSnapback) -> Router {
    app(AppState::detached(state))
}

async fn local_dev_cors(request: Request<Body>, next: Next) -> Response {
    // @ref LLP 0025#demo-shape — web-only demos may be served by an ordinary
    // static/Vite origin while talking to the local Snapback server.
    let allowed_origin = loopback_origin(request.headers().get(header::ORIGIN));
    if request.method() == Method::OPTIONS {
        return with_cors_headers(StatusCode::NO_CONTENT.into_response(), allowed_origin);
    }
    with_cors_headers(next.run(request).await, allowed_origin)
}

fn with_cors_headers(mut response: Response, allowed_origin: Option<HeaderValue>) -> Response {
    let headers = response.headers_mut();
    if let Some(origin) = allowed_origin {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type, authorization, x-snapback-admin-token"),
    );
    response
}

fn loopback_origin(origin: Option<&HeaderValue>) -> Option<HeaderValue> {
    let origin = origin?.to_str().ok()?;
    let allowed = [
        "http://127.0.0.1:",
        "https://127.0.0.1:",
        "http://localhost:",
        "https://localhost:",
        "http://[::1]:",
        "https://[::1]:",
    ];
    allowed
        .iter()
        .any(|prefix| origin.starts_with(prefix))
        .then(|| HeaderValue::from_str(origin).ok())
        .flatten()
}

async fn health(State(state): State<SharedSnapback>) -> Result<Json<HealthResponse>, ApiError> {
    let mut snapback = state.lock().await;
    let inspect = snapback.inspect()?;
    Ok(Json(HealthResponse {
        ok: true,
        target: inspect.target,
        sqlite_version: inspect.storage.version,
        ibex_available: inspect.runtime.ibex_cli.available
            || inspect.runtime.ibex_ctx_db_host_bridge == CapabilityState::Available,
    }))
}

async fn inspect(State(state): State<SharedSnapback>) -> Result<Json<InspectState>, ApiError> {
    let mut snapback = state.lock().await;
    Ok(Json(snapback.inspect()?))
}

async fn apply_schema(
    State(state): State<SharedSnapback>,
    Json(manifest): Json<SchemaManifest>,
) -> Result<Json<DiagnosticsResponse>, ApiError> {
    let mut snapback = state.lock().await;
    Ok(Json(DiagnosticsResponse {
        diagnostics: snapback.apply_schema(manifest)?,
    }))
}

async fn load_functions(
    State(state): State<SharedSnapback>,
    Json(manifest): Json<FunctionManifest>,
) -> Json<DiagnosticsResponse> {
    let mut snapback = state.lock().await;
    Json(DiagnosticsResponse {
        diagnostics: snapback.load_functions(manifest),
    })
}

async fn reset(State(state): State<SharedSnapback>) -> Result<StatusCode, ApiError> {
    let mut snapback = state.lock().await;
    snapback.reset()?;
    Ok(StatusCode::NO_CONTENT)
}

async fn seed(
    State(state): State<SharedSnapback>,
    Json(seed): Json<SeedData>,
) -> Result<Json<crate::manifest::MutationOutput>, ApiError> {
    let mut snapback = state.lock().await;
    Ok(Json(snapback.seed(seed)?))
}

async fn invoke_query(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<HandlerInput>,
) -> Result<Json<crate::manifest::QueryOutput>, ApiError> {
    let snapback = state.lock().await;
    Ok(Json(snapback.invoke_query(&name, input)?))
}

async fn invoke_mutation(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<HandlerInput>,
) -> Result<Json<crate::manifest::MutationOutput>, ApiError> {
    let mut snapback = state.lock().await;
    Ok(Json(snapback.invoke_mutation(&name, input)?))
}

async fn subscribe_live(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<LiveSubscribeInput>,
) -> Result<Json<crate::local::LiveSubscribeOutput>, ApiError> {
    let mut snapback = state.lock().await;
    Ok(Json(snapback.subscribe_live(&name, input)?))
}

async fn resume_live(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<LiveResumeInput>,
) -> Result<Json<crate::local::LiveResumeOutput>, ApiError> {
    let mut snapback = state.lock().await;
    Ok(Json(snapback.resume_live(&name, input)?))
}

async fn stream_live(
    State(state): State<SharedSnapback>,
    Path(connection_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| live_stream(socket, state, connection_id))
}

async fn live_stream(socket: WebSocket, state: SharedSnapback, connection_id: String) {
    let (mut sender, mut receiver) = socket.split();
    let mut ticks = interval(Duration::from_millis(25));

    // @ref LLP 0020#phase-4-upgrade-realtime-from-v0-outbox-to-app-grade-live-delivery — WebSocket push is a transport over the existing ordered live queue; deterministic drain stays available for tests.
    'stream: loop {
        tokio::select! {
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(Message::Text(text))) => {
                        let response = handle_live_socket_text(&state, &text).await;
                        if sender.send(Message::Text(response.into())).await.is_err() {
                            break 'stream;
                        }
                    }
                    Some(Ok(Message::Binary(_))) | Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                }
            }
            _ = ticks.tick() => {
                let messages = {
                    let mut snapback = state.lock().await;
                    snapback.drain_live_stream(&connection_id)
                };
                for message in messages {
                    if sender.send(Message::Text(message.into())).await.is_err() {
                        break 'stream;
                    }
                }
            }
        }
    }

    let mut snapback = state.lock().await;
    snapback.disconnect(&connection_id, now_millis());
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum LiveSocketClientMessage {
    EphemeralSubscribe {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: SubscribeRequest,
    },
    EphemeralPublish {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: PublishRequest,
    },
    EphemeralDelete {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: DeleteRequest,
    },
}

async fn handle_live_socket_text(state: &SharedSnapback, text: &str) -> String {
    let message = match serde_json::from_str::<LiveSocketClientMessage>(text) {
        Ok(message) => message,
        Err(error) => {
            return socket_error(
                None,
                "decode",
                Diagnostic::error(
                    "SNAPBACK_WEBSOCKET_MESSAGE_INVALID",
                    "realtime",
                    "WebSocket message could not be decoded",
                )
                .with_details(json!({ "error": error.to_string() })),
            );
        }
    };

    match message {
        LiveSocketClientMessage::EphemeralSubscribe {
            request_id,
            request,
        } => {
            let outcome = {
                let mut snapback = state.lock().await;
                snapback.subscribe_ephemeral(request, now_millis())
            };
            match outcome {
                Ok(message) => socket_ack(request_id, "subscribe", json!({ "message": message })),
                Err(error) => {
                    socket_error(request_id, "subscribe", diagnostic_from_ephemeral(error))
                }
            }
        }
        LiveSocketClientMessage::EphemeralPublish {
            request_id,
            request,
        } => {
            let outcome = {
                let mut snapback = state.lock().await;
                snapback.publish_ephemeral(request, now_millis())
            };
            match outcome {
                Ok(outcome) => socket_ack(request_id, "publish", json!({ "outcome": outcome })),
                Err(error) => socket_error(request_id, "publish", diagnostic_from_ephemeral(error)),
            }
        }
        LiveSocketClientMessage::EphemeralDelete {
            request_id,
            request,
        } => {
            let outcome = {
                let mut snapback = state.lock().await;
                snapback.delete_ephemeral(request, now_millis())
            };
            match outcome {
                Ok(message) => socket_ack(request_id, "delete", json!({ "message": message })),
                Err(error) => socket_error(request_id, "delete", diagnostic_from_ephemeral(error)),
            }
        }
    }
}

fn socket_ack(request_id: Option<String>, operation: &str, mut body: Value) -> String {
    let mut envelope = json!({
        "kind": "ephemeral_ack",
        "requestId": request_id,
        "operation": operation,
    });
    merge_json_object(&mut envelope, body.take());
    serde_json::to_string(&envelope)
        .unwrap_or_else(|_| "{\"kind\":\"ephemeral_error\",\"operation\":\"serialize\"}".to_owned())
}

fn socket_error(request_id: Option<String>, operation: &str, diagnostic: Diagnostic) -> String {
    serde_json::to_string(&json!({
        "kind": "ephemeral_error",
        "requestId": request_id,
        "operation": operation,
        "diagnostic": diagnostic,
    }))
    .unwrap_or_else(|_| "{\"kind\":\"ephemeral_error\",\"operation\":\"serialize\"}".to_owned())
}

fn merge_json_object(target: &mut Value, source: Value) {
    let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) else {
        return;
    };
    for (key, value) in source {
        target.insert(key.clone(), value.clone());
    }
}

async fn drain_outbox(
    State(state): State<SharedSnapback>,
    Path(connection_id): Path<String>,
) -> Json<Vec<crate::ephemeral::RealtimeEnvelope>> {
    let mut snapback = state.lock().await;
    Json(snapback.drain_outbox(&connection_id))
}

async fn register_ephemeral_collection(
    State(state): State<SharedSnapback>,
    Json(collection): Json<EphemeralCollection>,
) -> StatusCode {
    let mut snapback = state.lock().await;
    snapback.register_ephemeral_collection(collection);
    StatusCode::NO_CONTENT
}

#[derive(Debug, Deserialize)]
struct EnsureEphemeralCollectionsInput {
    #[serde(default)]
    collections: Vec<EphemeralCollection>,
    #[serde(
        default,
        rename = "ephemeralCollections",
        alias = "ephemeral_collections"
    )]
    ephemeral_collections: Vec<EphemeralCollection>,
}

impl EnsureEphemeralCollectionsInput {
    fn into_collections(self) -> Vec<EphemeralCollection> {
        if self.collections.is_empty() {
            self.ephemeral_collections
        } else {
            self.collections
        }
    }
}

async fn ensure_ephemeral_collections(
    State(state): State<SharedSnapback>,
    Json(input): Json<EnsureEphemeralCollectionsInput>,
) -> Result<Json<crate::ephemeral::CollectionEnsureOutcome>, ApiError> {
    let mut snapback = state.lock().await;
    snapback
        .ensure_ephemeral_collections(input.into_collections())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn publish_ephemeral(
    State(state): State<SharedSnapback>,
    Json(request): Json<PublishRequest>,
) -> Result<Json<crate::ephemeral::PublishOutcome>, ApiError> {
    let mut snapback = state.lock().await;
    snapback
        .publish_ephemeral(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn subscribe_ephemeral(
    State(state): State<SharedSnapback>,
    Json(request): Json<SubscribeRequest>,
) -> Result<Json<crate::ephemeral::EphemeralMessage>, ApiError> {
    let mut snapback = state.lock().await;
    snapback
        .subscribe_ephemeral(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn delete_ephemeral(
    State(state): State<SharedSnapback>,
    Json(request): Json<DeleteRequest>,
) -> Result<Json<Option<crate::ephemeral::EphemeralMessage>>, ApiError> {
    let mut snapback = state.lock().await;
    snapback
        .delete_ephemeral(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn cleanup_ephemeral(State(state): State<SharedSnapback>) -> StatusCode {
    let mut snapback = state.lock().await;
    snapback.cleanup_ephemeral(now_millis());
    StatusCode::NO_CONTENT
}

async fn disconnect(
    State(state): State<SharedSnapback>,
    Path(connection_id): Path<String>,
) -> StatusCode {
    let mut snapback = state.lock().await;
    snapback.disconnect(&connection_id, now_millis());
    StatusCode::NO_CONTENT
}

#[derive(Debug)]
pub struct ApiError(SnapbackError);

impl ApiError {
    fn from_ephemeral(error: crate::ephemeral::EphemeralError) -> Self {
        Self(SnapbackError::new(diagnostic_from_ephemeral(error)))
    }
}

fn diagnostic_from_ephemeral(error: crate::ephemeral::EphemeralError) -> Diagnostic {
    let mut diagnostic =
        Diagnostic::error(error.code.diagnostic_code(), "ephemeral", error.message);
    diagnostic.details = json!({ "code": error.code });
    diagnostic
}

impl From<SnapbackError> for ApiError {
    fn from(value: SnapbackError) -> Self {
        Self(value)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0.diagnostic.code.as_str() {
            "SNAPBACK_UNKNOWN_FUNCTION" | "SNAPBACK_UNKNOWN_TABLE" | "SNAPBACK_UNKNOWN_FIELD" => {
                StatusCode::NOT_FOUND
            }
            "SNAPBACK_MUTATION_CONFLICT" => StatusCode::CONFLICT,
            // @ref LLP 0017#security-defaults — admin gating distinguishes "disabled"
            // (forbidden) from "needs the configured token" (unauthorized).
            "SNAPBACK_ADMIN_DISABLED" => StatusCode::FORBIDDEN,
            "SNAPBACK_ADMIN_TOKEN_REQUIRED" => StatusCode::UNAUTHORIZED,
            _ => StatusCode::BAD_REQUEST,
        };
        (
            status,
            Json(ErrorResponse {
                diagnostic: self.0.diagnostic,
            }),
        )
            .into_response()
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
