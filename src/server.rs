use crate::admin::AppState;
use crate::diagnostic::{Diagnostic, SnapbackError};
use crate::ephemeral::{DeleteRequest, EphemeralCollection, PublishRequest, SubscribeRequest};
use crate::local::{InspectState, LiveSubscribeInput, LocalSnapback};
use crate::manifest::{FunctionManifest, HandlerInput, SchemaManifest, SeedData};
use crate::runtime::CapabilityState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

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
        .route("/outbox/{connection_id}", get(drain_outbox))
        .route(
            "/ephemeral/collections",
            post(register_ephemeral_collection),
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
}

/// Backwards-compatible entry point: build the full app with a detached
/// (loopback, address-unknown) server context.
pub fn router(state: SharedSnapback) -> Router {
    app(AppState::detached(state))
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
        let mut diagnostic = Diagnostic::error(
            format!("SNAPBACK_EPHEMERAL_{:?}", error.code),
            "ephemeral",
            error.message,
        );
        diagnostic.details = json!({ "code": error.code });
        Self(SnapbackError::new(diagnostic))
    }
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
