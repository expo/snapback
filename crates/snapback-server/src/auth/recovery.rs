//! Closed startup posture for a stored-manifest auth table collision.
//!
//! This is intentionally a separate router and state type. It cannot acquire a
//! `LocalSnapback`, load a manifest or bundle, construct the app router, or
//! reach a generic host-operation dispatcher.

// @ref LLP 0057#reachability — a declared physical auth-table collision may expose only typed health and the selected, doubly-gated rescue host operation.

use crate::admin::ServerContext;
use crate::admin_impersonation::{
    IMPERSONATION_CAPABILITY_HEADER, ImpersonationCapabilityRegistry,
};
use crate::auth::rescue::rescue_colliding_table_file;
use crate::auth::wire::RescueCollidingTableRequest;
use crate::contract_types::ServerProfile;
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::host_ops::{
    HOST_OPS_RESULT_KIND, HostOpsArtifacts, HostOpsAuthority, HostOpsResult, HostOpsTarget,
    new_request_id,
};
use crate::manifest::{SNAPBACK_SCHEMA_VERSION, TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX};
use crate::server::{ApiError, EffectPolicy, PolicyAuthMode, RoutePolicy};
use crate::storage::LocalDatabase;
use axum::body::{Body, to_bytes};
use axum::extract::State;
use axum::http::{HeaderMap, Request, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{MethodFilter, on, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const RECOVERY_HOST_OP: &str = "auth.rescueCollidingTable";
const RECOVERY_REQUEST_LIMIT: usize = 4 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthRecoveryHealth {
    pub reason: AuthRecoveryReason,
    pub restart_required: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AuthRecoveryReason {
    TableCollision,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryHealthResponse {
    pub ok: bool,
    pub binary: crate::identity::BinaryIdentity,
    pub auth_recovery: AuthRecoveryHealth,
}

/// State available to the recovery router. Notably absent: `LocalSnapback`,
/// app/read/ephemeral lanes, provider/keyring state, and generic host-ops.
#[derive(Clone)]
pub struct CollisionRecoveryRuntime {
    database_path: Arc<PathBuf>,
    server: Arc<ServerContext>,
    impersonation: ImpersonationCapabilityRegistry,
    maintenance: Arc<Mutex<()>>,
}

impl fmt::Debug for CollisionRecoveryRuntime {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CollisionRecoveryRuntime")
            .field("database_path", &self.database_path)
            .field("server", &self.server)
            .field("impersonation", &self.impersonation)
            .finish_non_exhaustive()
    }
}

impl CollisionRecoveryRuntime {
    /// Validate every reachability condition before the caller binds a
    /// listener. Loopback without a configured/minted token is deliberately
    /// rejected even though embedded ordinary routers retain that old default.
    pub fn new(
        database_path: PathBuf,
        server: ServerContext,
        impersonation: ImpersonationCapabilityRegistry,
    ) -> SnapbackResult<Self> {
        validate_startup_context(&server)?;
        validate_impersonation_registry(&impersonation)?;
        Ok(Self {
            database_path: Arc::new(database_path),
            server: Arc::new(server),
            impersonation,
            maintenance: Arc::new(Mutex::new(())),
        })
    }

    pub(crate) fn server(&self) -> &ServerContext {
        &self.server
    }
}

/// Pin the independently generated recovery capability to this process before
/// listener creation. Runtime construction repeats the check after bind.
pub fn validate_impersonation_registry(
    impersonation: &ImpersonationCapabilityRegistry,
) -> SnapbackResult<()> {
    if impersonation.startup_nonce() != crate::identity::binary_identity().startup_nonce {
        return Err(recovery_unavailable(
            "auth collision recovery received an impersonation registry from another startup",
        ));
    }
    Ok(())
}

/// Validate the concrete address startup already resolved and will bind.
/// Resolving once in the CLI prevents a DNS answer change from splitting the
/// recovery profile check from the actual listener address.
pub fn validate_loopback_bind_ip(address: IpAddr) -> SnapbackResult<()> {
    address.is_loopback().then_some(()).ok_or_else(|| {
        recovery_unavailable("auth collision recovery is restricted to a loopback bind")
    })
}

/// This check is intentionally callable before listener creation. Runtime
/// construction repeats it so no alternate embedding can skip the posture.
pub fn validate_startup_context(server: &ServerContext) -> SnapbackResult<()> {
    if !server.loopback {
        return Err(recovery_unavailable(
            "auth collision recovery is restricted to a loopback bind",
        ));
    }
    if !matches!(server.profile, ServerProfile::Dev | ServerProfile::Test) {
        return Err(recovery_unavailable(
            "auth collision recovery is restricted to dev and test profiles",
        ));
    }
    if server.admin_token.is_none() {
        return Err(recovery_unavailable(
            "auth collision recovery requires a configured or minted AdminWrite credential",
        ));
    }
    let registered = crate::server::host_ops_operation_spec(RECOVERY_HOST_OP, None, false)
        .ok_or_else(|| {
            recovery_unavailable("auth collision rescue is absent from the operation registry")
        })?
        .effective_for(PolicyAuthMode::Dev);
    if registered.path_policy != RoutePolicy::AdminWrite
        || registered.effect_policy != EffectPolicy::ImpersonationCapability
    {
        return Err(recovery_unavailable(
            "auth collision rescue has an unsafe operation-registry policy",
        ));
    }
    Ok(())
}

/// Read-only classification of the ordinary-open failure. Returning `false`
/// means the original open error remains authoritative; stronger catalog
/// failures (including an exact-v1 index collision) are returned directly.
pub fn eligible(database_path: &Path, ordinary_open_error: &SnapbackError) -> SnapbackResult<bool> {
    LocalDatabase::auth_collision_recovery_eligible(database_path, ordinary_open_error)
}

/// Construct the complete recovery surface. No fallback/static/CORS layer is
/// installed, so every unlisted route is an ordinary 404 and the selected
/// carrier has no browser credential path.
fn router(runtime: CollisionRecoveryRuntime) -> Router {
    Router::new()
        // Axum's `get(...)` helper also installs HEAD. Recovery inventory is
        // deliberately literal: only GET health succeeds, so explicitly
        // override Axum's automatic HEAD fallback with a refusal.
        .route(
            "/health",
            on(MethodFilter::GET, recovery_health).on(MethodFilter::HEAD, || async {
                StatusCode::METHOD_NOT_ALLOWED
            }),
        )
        .route("/_snapback/api/host-ops", post(recovery_host_ops))
        .with_state(runtime)
}

/// Serve the closed recovery surface on the exact already-bound listener.
/// The listener's concrete local address is rechecked here, so an embedding
/// cannot pair a loopback-claimed context with a non-loopback socket.
pub async fn serve<F>(
    runtime: CollisionRecoveryRuntime,
    listener: tokio::net::TcpListener,
    shutdown: F,
) -> anyhow::Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    validate_loopback_bind_ip(listener.local_addr()?.ip())?;
    validate_startup_context(runtime.server())?;
    axum::serve(listener, router(runtime))
        .with_graceful_shutdown(shutdown)
        .await?;
    Ok(())
}

async fn recovery_health() -> Json<RecoveryHealthResponse> {
    Json(RecoveryHealthResponse {
        ok: false,
        binary: crate::identity::binary_identity(),
        auth_recovery: AuthRecoveryHealth {
            reason: AuthRecoveryReason::TableCollision,
            restart_required: true,
        },
    })
}

async fn recovery_host_ops(
    State(runtime): State<CollisionRecoveryRuntime>,
    request: Request<Body>,
) -> Result<Response, ApiError> {
    // The exact recovery carrier has one possible effect, so both gates run
    // before any body/operation parsing. This preserves the ordinary selected
    // operation's AdminWrite + ImpersonationCapability composition without
    // making malformed or unknown operations an authority oracle.
    let headers = request.headers();
    crate::admin::authorize_for_mode(runtime.server(), headers, true, PolicyAuthMode::Dev)?;
    runtime
        .impersonation
        .authorize(single_header_value(
            headers,
            IMPERSONATION_CAPABILITY_HEADER,
        ))
        .map_err(ApiError::from)?;

    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
    if !is_json {
        return Err(ApiError::from(SnapbackError::error(
            "SNAPBACK_REQUEST_JSON_INVALID",
            "server",
            "request body was not valid JSON for this operation",
        )));
    }

    let body = to_bytes(request.into_body(), RECOVERY_REQUEST_LIMIT)
        .await
        .map_err(|_| {
            ApiError::from(SnapbackError::error(
                "SNAPBACK_VALUE_TOO_LARGE",
                "server",
                "request body exceeded the recovery host-ops limit",
            ))
        })?;

    let request = serde_json::from_slice::<RecoveryHostOpsRequest>(&body).map_err(|_| {
        ApiError::from(SnapbackError::error(
            "SNAPBACK_REQUEST_JSON_INVALID",
            "server",
            "request body was not valid JSON for this operation",
        ))
    })?;
    let RecoveryHostOpsRequest {
        request_id,
        operation,
        args,
    } = request;
    let request_id = request_id
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(new_request_id);

    let result = if operation != RECOVERY_HOST_OP {
        recovery_result(
            &runtime,
            request_id,
            operation,
            false,
            Value::Object(Default::default()),
            vec![Diagnostic::error(
                "SNAPBACK_HOST_OP_UNKNOWN",
                "host-ops",
                "unknown or unavailable host operation in auth recovery posture",
            )],
        )
    } else {
        let rescue = match args.and_then(|args| match (args.source_table, args.target_table) {
            (Some(source_table), Some(target_table)) => Some(RescueCollidingTableRequest {
                source_table,
                target_table,
            }),
            _ => None,
        }) {
            Some(rescue) => rescue,
            _ => {
                return Ok(no_store_json(recovery_result(
                    &runtime,
                    request_id,
                    operation,
                    false,
                    Value::Object(Default::default()),
                    vec![Diagnostic::error(
                        "SNAPBACK_HOST_OP_INPUT_MISSING",
                        "host-ops",
                        "auth.rescueCollidingTable requires args.sourceTable and args.targetTable",
                    )],
                )));
            }
        };
        let path = runtime.database_path.as_ref().clone();
        let maintenance = runtime.maintenance.clone();
        let outcome = tokio::task::spawn_blocking(move || {
            let _maintenance = maintenance.lock().map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
                    "auth-rescue",
                    "the collision-rescue maintenance gate is unavailable",
                )
            })?;
            rescue_colliding_table_file(&path, &rescue)
        })
        .await;
        match outcome {
            Ok(Ok(outcome)) => {
                let mut data = serde_json::to_value(outcome).unwrap_or_default();
                if let Value::Object(fields) = &mut data {
                    fields.insert("restartRequired".to_owned(), Value::Bool(true));
                }
                recovery_result(&runtime, request_id, operation, true, data, Vec::new())
            }
            Ok(Err(error)) => recovery_result(
                &runtime,
                request_id,
                operation,
                false,
                Value::Object(Default::default()),
                vec![error.diagnostic],
            ),
            Err(_) => recovery_result(
                &runtime,
                request_id,
                operation,
                false,
                Value::Object(Default::default()),
                vec![Diagnostic::error(
                    "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
                    "auth-rescue",
                    "the collision-rescue worker did not complete",
                )],
            ),
        }
    };
    Ok(no_store_json(result))
}

fn recovery_result(
    runtime: &CollisionRecoveryRuntime,
    request_id: String,
    operation: String,
    ok: bool,
    data: Value,
    diagnostics: Vec<Diagnostic>,
) -> HostOpsResult {
    let next = crate::control_catalog::result_next(ok, &operation);
    HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id,
        operation,
        ok,
        target: HostOpsTarget {
            // Recovery deliberately does not accept or project the stored app
            // manifest merely to populate target metadata.
            app_id: String::new(),
            app_root: None,
            target_profile: match runtime.server.profile {
                ServerProfile::Dev => TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
                ServerProfile::Test => "local-test-sqlite-ibex".to_owned(),
                ServerProfile::Demo | ServerProfile::Prod => {
                    unreachable!("recovery runtime construction rejects demo and prod")
                }
            },
            server_url: Some(recovery_server_url(&runtime.server)),
        },
        authority: Some(HostOpsAuthority {
            mode: "devAdminBypass".to_owned(),
            actor_principal: None,
            effective_principal: None,
            local_dev_only: true,
            admin_bypass: true,
            scope: None,
            reason: Some("auth collision-recovery AdminWrite gate".to_owned()),
        }),
        artifacts: HostOpsArtifacts::default(),
        data,
        diagnostics,
        next,
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    }
}

fn recovery_server_url(server: &ServerContext) -> String {
    server
        .host
        .parse::<IpAddr>()
        .map(|address| format!("http://{}", SocketAddr::new(address, server.port)))
        .unwrap_or_else(|_| format!("http://{}:{}", server.host, server.port))
}

fn no_store_json(result: HostOpsResult) -> Response {
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, "no-store")],
        Json(result),
    )
        .into_response()
}

fn single_header_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let first = values.next()?.to_str().ok()?;
    if first.is_empty() || values.next().is_some() {
        return None;
    }
    Some(first)
}

fn recovery_unavailable(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_TABLE_COLLISION", "auth-recovery", message)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecoveryHostOpsRequest {
    operation: String,
    #[serde(default, rename = "requestId")]
    request_id: Option<String>,
    #[serde(default)]
    args: Option<RecoveryRescueArgs>,
}

impl fmt::Debug for RecoveryHostOpsRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RecoveryHostOpsRequest")
            .field("operation", &"[REDACTED]")
            .field(
                "request_id",
                &self.request_id.as_ref().map(|_| "[REDACTED]"),
            )
            .field("has_args", &self.args.is_some())
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoveryRescueArgs {
    #[serde(default)]
    source_table: Option<String>,
    #[serde(default)]
    target_table: Option<String>,
}

impl fmt::Debug for RecoveryRescueArgs {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RecoveryRescueArgs")
            .field(
                "source_table",
                &self.source_table.as_ref().map(|_| "[REDACTED]"),
            )
            .field(
                "target_table",
                &self.target_table.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};
    use crate::manifest::{FieldManifest, FieldType, SchemaManifest, TableManifest};
    use crate::storage::auth_mode::{
        META_AUTH_MODE_STATE, META_CAPABILITY_AWARE_SCHEMA_MANIFEST, META_STAGED_AUTH_MODE_MANIFEST,
    };
    use axum::body::{Body, to_bytes};
    use axum::http::{Method, Request};
    use serde_json::json;
    #[cfg(not(feature = "server-owner"))]
    use snapback_services::test_support::rusqlite::{Connection, OptionalExtension, params};
    use std::collections::BTreeMap;
    use tempfile::TempDir;
    use tower::ServiceExt as _;

    struct FixedRandom(u8);

    impl RandomSource for FixedRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(self.0);
            Ok(())
        }
    }

    #[test]
    fn recovery_request_debug_redacts_every_caller_controlled_string() {
        const SENTINEL: &str = "sbs_RECOVERY_DEBUG_SENTINEL";
        let request = RecoveryHostOpsRequest {
            operation: SENTINEL.to_owned(),
            request_id: Some(SENTINEL.to_owned()),
            args: Some(RecoveryRescueArgs {
                source_table: Some(SENTINEL.to_owned()),
                target_table: Some(SENTINEL.to_owned()),
            }),
        };
        let request_debug = format!("{request:?}");
        let args_debug = format!("{:?}", request.args.as_ref().unwrap());
        assert!(!request_debug.contains(SENTINEL), "{request_debug}");
        assert!(!args_debug.contains(SENTINEL), "{args_debug}");
        assert!(request_debug.contains("[REDACTED]"), "{request_debug}");
        assert!(args_debug.contains("[REDACTED]"), "{args_debug}");
    }

    struct CollisionFixture {
        _directory: TempDir,
        path: PathBuf,
    }

    fn table_manifest(name: &str) -> TableManifest {
        TableManifest {
            name: name.to_owned(),
            fields: vec![FieldManifest {
                name: "id".to_owned(),
                field_type: FieldType::Integer,
                optional: true,
            }],
            indexes: Vec::new(),
            syncable: false,
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
        }
    }

    #[cfg(not(feature = "server-owner"))]
    fn collision_fixture(sources: &[&str], expression_index: bool) -> CollisionFixture {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("collision.sqlite3");
        drop(LocalDatabase::open(&path).unwrap());
        let connection = Connection::open(&path).unwrap();
        for (ordinal, source) in sources.iter().enumerate() {
            connection
                .execute_batch(&format!(
                    "CREATE TABLE {}(id INTEGER); INSERT INTO {}(id) VALUES({});",
                    crate::auth::rescue::quote_identifier(source),
                    crate::auth::rescue::quote_identifier(source),
                    ordinal + 1,
                ))
                .unwrap();
        }
        if expression_index {
            connection
                .execute_batch(&format!(
                    "CREATE INDEX unsupported_expr ON {}(abs(id));",
                    crate::auth::rescue::quote_identifier(sources[0])
                ))
                .unwrap();
        }
        let manifest = SchemaManifest {
            schema_hash: Some("legacy-schema".to_owned()),
            inputs_hash: Some("legacy-inputs".to_owned()),
            tables: sources
                .iter()
                .map(|source| table_manifest(source))
                .collect(),
            ..SchemaManifest::default()
        };
        connection
            .execute(
                "DELETE FROM _snapback_meta WHERE key IN (?1, ?2, ?3)",
                params![
                    META_AUTH_MODE_STATE,
                    META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
                    META_STAGED_AUTH_MODE_MANIFEST,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES('schema_manifest', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![serde_json::to_string(&manifest).unwrap()],
            )
            .unwrap();
        drop(connection);
        CollisionFixture {
            _directory: directory,
            path,
        }
    }

    fn ordinary_open_error(path: &Path) -> SnapbackError {
        LocalDatabase::open(path)
            .err()
            .expect("reserved stored manifest must fail ordinary admission")
    }

    fn server_context(
        profile: ServerProfile,
        loopback: bool,
        admin_token: Option<&str>,
    ) -> ServerContext {
        let mut context = ServerContext::detached();
        context.profile = profile;
        context.loopback = loopback;
        context.host = if loopback { "127.0.0.1" } else { "0.0.0.0" }.to_owned();
        context.port = 4287;
        context.admin_token = admin_token.map(ToOwned::to_owned);
        context
    }

    fn capability(seed: u8) -> (ImpersonationCapabilityRegistry, String) {
        let (registry, operator) = ImpersonationCapabilityRegistry::generate(
            crate::identity::binary_identity().startup_nonce,
            &FixedRandom(seed),
        )
        .unwrap();
        let mut bearer = String::new();
        operator
            .emit_once_to_terminal(|value| {
                bearer = value.to_owned();
                Ok(())
            })
            .unwrap();
        (registry, bearer)
    }

    fn runtime(path: &Path) -> (CollisionRecoveryRuntime, String) {
        let (registry, bearer) = capability(7);
        (
            CollisionRecoveryRuntime::new(
                path.to_path_buf(),
                server_context(ServerProfile::Dev, true, Some("admin-secret")),
                registry,
            )
            .unwrap(),
            bearer,
        )
    }

    fn request(
        method: Method,
        path: &str,
        body: &str,
        admin: Option<&str>,
        impersonation: Option<&str>,
        content_type: Option<&str>,
    ) -> Request<Body> {
        let mut builder = Request::builder().method(method).uri(path);
        if let Some(admin) = admin {
            builder = builder.header("x-snapback-admin-token", admin);
        }
        if let Some(impersonation) = impersonation {
            builder = builder.header(IMPERSONATION_CAPABILITY_HEADER, impersonation);
        }
        if let Some(content_type) = content_type {
            builder = builder.header(header::CONTENT_TYPE, content_type);
        }
        builder.body(Body::from(body.to_owned())).unwrap()
    }

    async fn json_body(response: Response) -> Value {
        serde_json::from_slice(&to_bytes(response.into_body(), 128 * 1024).await.unwrap()).unwrap()
    }

    fn rescue_body(source: &str, target: &str) -> String {
        serde_json::to_string(&json!({
            "operation": RECOVERY_HOST_OP,
            "args": {
                "sourceTable": source,
                "targetTable": target,
            },
        }))
        .unwrap()
    }

    #[derive(Debug, Eq, PartialEq)]
    struct LogicalSnapshot {
        schema: Vec<(String, String, String, Option<String>)>,
        meta: Vec<(String, String)>,
        counts: BTreeMap<String, i64>,
    }

    #[cfg(not(feature = "server-owner"))]
    fn logical_snapshot(path: &Path) -> LogicalSnapshot {
        let connection = Connection::open(path).unwrap();
        let mut statement = connection
            .prepare(
                "SELECT type, name, tbl_name, sql FROM sqlite_schema
                 WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
            )
            .unwrap();
        let schema: Vec<(String, String, String, Option<String>)> = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let mut statement = connection
            .prepare("SELECT key, value FROM _snapback_meta ORDER BY key")
            .unwrap();
        let meta = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let mut counts = BTreeMap::new();
        for (_, name, _, _) in &schema {
            if connection
                .query_row(
                    "SELECT 1 FROM pragma_table_list WHERE schema='main' AND name=?1 AND type='table'",
                    params![name],
                    |_| Ok(()),
                )
                .optional()
                .unwrap()
                .is_some()
            {
                let count = connection
                    .query_row(
                        &format!(
                            "SELECT COUNT(*) FROM {}",
                            crate::auth::rescue::quote_identifier(name)
                        ),
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                counts.insert(name.clone(), count);
            }
        }
        LogicalSnapshot {
            schema,
            meta,
            counts,
        }
    }

    #[tokio::test]
    #[cfg(not(feature = "server-owner"))]
    async fn exact_route_and_method_inventory_has_no_cors_projection() {
        let fixture = collision_fixture(&["_auth_legacy"], false);
        let (runtime, bearer) = runtime(&fixture.path);
        let app = router(runtime);

        let health = app
            .clone()
            .oneshot(request(Method::GET, "/health", "", None, None, None))
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);
        assert!(
            health
                .headers()
                .get("access-control-allow-origin")
                .is_none()
        );
        let health_body = json_body(health).await;
        assert_eq!(health_body["authRecovery"]["reason"], "table-collision");
        assert_eq!(health_body["authRecovery"]["restartRequired"], true);

        let host_ops = app
            .clone()
            .oneshot(request(
                Method::POST,
                "/_snapback/api/host-ops",
                r#"{"operation":"not.available"}"#,
                Some("admin-secret"),
                Some(&bearer),
                Some("application/json"),
            ))
            .await
            .unwrap();
        assert_eq!(host_ops.status(), StatusCode::OK);
        assert!(
            host_ops
                .headers()
                .get("access-control-allow-origin")
                .is_none()
        );

        for (method, path) in [
            (Method::GET, "/"),
            (Method::GET, "/inspect"),
            (Method::POST, "/auth/request-code"),
            (Method::GET, "/_snapback/admin"),
            (Method::GET, "/_snapback/api/health"),
            (Method::POST, "/_snapback/api/schema/load"),
            (Method::GET, "/live/anything/stream"),
        ] {
            let response = app
                .clone()
                .oneshot(request(method, path, "", None, None, None))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
            assert!(
                response
                    .headers()
                    .get("access-control-allow-origin")
                    .is_none()
            );
        }
        for (method, path) in [
            (Method::POST, "/health"),
            (Method::GET, "/_snapback/api/host-ops"),
            (Method::OPTIONS, "/health"),
            (Method::OPTIONS, "/_snapback/api/host-ops"),
            (Method::HEAD, "/health"),
        ] {
            let response = app
                .clone()
                .oneshot(request(method, path, "", None, None, None))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED, "{path}");
            assert!(
                response
                    .headers()
                    .get("access-control-allow-origin")
                    .is_none()
            );
        }
    }

    #[tokio::test]
    #[cfg(not(feature = "server-owner"))]
    async fn admin_and_process_capability_are_non_substitutable_and_precede_parsing() {
        let fixture = collision_fixture(&["_auth_legacy"], false);
        let (runtime, bearer) = runtime(&fixture.path);
        let app = router(runtime);
        let (_, other_bearer) = capability(9);
        let whitespace_bearer = format!(" {bearer} ");
        let valid_body = r#"{"operation":"not.available"}"#;

        for (admin, impersonation, expected, code) in [
            (
                None,
                None,
                StatusCode::UNAUTHORIZED,
                "SNAPBACK_ADMIN_TOKEN_REQUIRED",
            ),
            (
                Some("admin-secret"),
                None,
                StatusCode::FORBIDDEN,
                "SNAPBACK_AUTH_IMPERSONATION_REQUIRED",
            ),
            (
                None,
                Some(bearer.as_str()),
                StatusCode::UNAUTHORIZED,
                "SNAPBACK_ADMIN_TOKEN_REQUIRED",
            ),
            (
                Some("wrong"),
                Some(bearer.as_str()),
                StatusCode::UNAUTHORIZED,
                "SNAPBACK_ADMIN_TOKEN_REQUIRED",
            ),
            (
                Some("admin-secret"),
                Some(other_bearer.as_str()),
                StatusCode::FORBIDDEN,
                "SNAPBACK_AUTH_IMPERSONATION_REQUIRED",
            ),
            (
                Some("admin-secret"),
                Some(whitespace_bearer.as_str()),
                StatusCode::FORBIDDEN,
                "SNAPBACK_AUTH_IMPERSONATION_REQUIRED",
            ),
        ] {
            let response = app
                .clone()
                .oneshot(request(
                    Method::POST,
                    "/_snapback/api/host-ops",
                    valid_body,
                    admin,
                    impersonation,
                    Some("application/json"),
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
            assert_eq!(json_body(response).await["diagnostic"]["code"], code);
        }

        // Even the media-type/body parser is behind both authority gates.
        let pre_parse = app
            .clone()
            .oneshot(request(
                Method::POST,
                "/_snapback/api/host-ops",
                "not json",
                None,
                None,
                Some("text/plain"),
            ))
            .await
            .unwrap();
        assert_eq!(pre_parse.status(), StatusCode::UNAUTHORIZED);

        let accepted = app
            .clone()
            .oneshot(request(
                Method::POST,
                "/_snapback/api/host-ops",
                valid_body,
                Some("admin-secret"),
                Some(&bearer),
                Some("application/json"),
            ))
            .await
            .unwrap();
        assert_eq!(accepted.status(), StatusCode::OK);
        assert_eq!(
            json_body(accepted).await["diagnostics"][0]["code"],
            "SNAPBACK_HOST_OP_UNKNOWN"
        );
    }

    #[tokio::test]
    #[cfg(not(feature = "server-owner"))]
    async fn recovery_carrier_requires_json_content_type_after_authority() {
        let fixture = collision_fixture(&["_auth_legacy"], false);
        let (runtime, bearer) = runtime(&fixture.path);
        let app = router(runtime);
        let body = r#"{"operation":"not.available"}"#;

        for content_type in [None, Some("text/plain"), Some("application/cbor")] {
            let response = app
                .clone()
                .oneshot(request(
                    Method::POST,
                    "/_snapback/api/host-ops",
                    body,
                    Some("admin-secret"),
                    Some(&bearer),
                    content_type,
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(
                json_body(response).await["diagnostic"]["code"],
                "SNAPBACK_REQUEST_JSON_INVALID"
            );
        }
        let response = app
            .oneshot(request(
                Method::POST,
                "/_snapback/api/host-ops",
                body,
                Some("admin-secret"),
                Some(&bearer),
                Some("application/json; charset=utf-8"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    #[cfg(not(feature = "server-owner"))]
    async fn entering_recovery_and_denied_or_unknown_calls_do_not_mutate_state() {
        let fixture = collision_fixture(&["_auth_legacy"], false);
        let before = logical_snapshot(&fixture.path);
        let error = ordinary_open_error(&fixture.path);
        assert!(eligible(&fixture.path, &error).unwrap());
        let (runtime, bearer) = runtime(&fixture.path);
        let app = router(runtime);

        for request in [
            request(Method::GET, "/health", "", None, None, None),
            request(
                Method::POST,
                "/_snapback/api/host-ops",
                r#"{"operation":"not.available"}"#,
                Some("admin-secret"),
                Some(&bearer),
                Some("application/json"),
            ),
            request(
                Method::POST,
                "/_snapback/api/host-ops",
                &rescue_body("_auth_legacy", "legacy_auth"),
                None,
                Some(&bearer),
                Some("application/json"),
            ),
        ] {
            let _ = app.clone().oneshot(request).await.unwrap();
        }
        assert_eq!(logical_snapshot(&fixture.path), before);
        assert!(!crate::auth::keyring::AuthKeyringStore::keyring_path(&fixture.path).exists());
    }

    #[tokio::test]
    #[cfg(not(feature = "server-owner"))]
    async fn successful_repeated_rescue_stays_restart_required() {
        let fixture = collision_fixture(&["_auth_one"], false);
        // The stored-manifest collision is the startup trigger; an additional
        // dormant collision can be rescued through the same still-live router
        // before restart.
        let connection = Connection::open(&fixture.path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE _auth_two(id INTEGER); INSERT INTO _auth_two(id) VALUES(2);",
            )
            .unwrap();
        drop(connection);
        let error = ordinary_open_error(&fixture.path);
        assert!(eligible(&fixture.path, &error).unwrap());
        let (runtime, bearer) = runtime(&fixture.path);
        let app = router(runtime);

        let first = app
            .clone()
            .oneshot(request(
                Method::POST,
                "/_snapback/api/host-ops",
                &rescue_body("_auth_one", "legacy_one"),
                Some("admin-secret"),
                Some(&bearer),
                Some("application/json"),
            ))
            .await
            .unwrap();
        let first = json_body(first).await;
        assert_eq!(first["ok"], true);
        assert_eq!(first["data"]["catalogCollisionCleared"], false);
        assert_eq!(first["data"]["restartRequired"], true);
        assert_eq!(first["target"]["appId"], "");

        let health = app
            .clone()
            .oneshot(request(Method::GET, "/health", "", None, None, None))
            .await
            .unwrap();
        assert_eq!(
            json_body(health).await["authRecovery"]["restartRequired"],
            true
        );
        // Even if the rewritten manifest would now admit an ordinary dev open,
        // this already-bound process does not switch routers or execute app
        // code; the recovery health posture remains fixed until restart.

        let second = app
            .oneshot(request(
                Method::POST,
                "/_snapback/api/host-ops",
                &rescue_body("_auth_two", "legacy_two"),
                Some("admin-secret"),
                Some(&bearer),
                Some("application/json"),
            ))
            .await
            .unwrap();
        let second = json_body(second).await;
        assert_eq!(second["ok"], true);
        assert_eq!(second["data"]["catalogCollisionCleared"], true);
        assert_eq!(second["data"]["restartRequired"], true);
        assert!(LocalDatabase::open(&fixture.path).is_ok());
        let connection = Connection::open(&fixture.path).unwrap();
        for (source, target, expected) in [
            ("_auth_one", "legacy_one", 1_i64),
            ("_auth_two", "legacy_two", 2_i64),
        ] {
            assert!(
                connection
                    .query_row(
                        "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1",
                        params![source],
                        |_| Ok(())
                    )
                    .optional()
                    .unwrap()
                    .is_none()
            );
            assert_eq!(
                connection
                    .query_row(
                        &format!(
                            "SELECT id FROM {}",
                            crate::auth::rescue::quote_identifier(target)
                        ),
                        [],
                        |row| row.get::<_, i64>(0)
                    )
                    .unwrap(),
                expected
            );
        }
    }

    #[tokio::test]
    #[cfg(not(feature = "server-owner"))]
    async fn unsupported_rescue_failure_leaves_source_manifest_and_rows_intact() {
        let fixture = collision_fixture(&["_auth_legacy"], true);
        let before = logical_snapshot(&fixture.path);
        let (runtime, bearer) = runtime(&fixture.path);
        let response = router(runtime)
            .oneshot(request(
                Method::POST,
                "/_snapback/api/host-ops",
                &rescue_body("_auth_legacy", "legacy_auth"),
                Some("admin-secret"),
                Some(&bearer),
                Some("application/json"),
            ))
            .await
            .unwrap();
        let response = json_body(response).await;
        assert_eq!(response["ok"], false);
        assert_eq!(
            response["diagnostics"][0]["code"],
            "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED"
        );
        assert_eq!(logical_snapshot(&fixture.path), before);
    }

    #[tokio::test]
    #[cfg(not(feature = "server-owner"))]
    async fn forbidden_profiles_binds_and_missing_admin_refuse_before_router_creation() {
        let fixture = collision_fixture(&["_auth_legacy"], false);
        for profile in [ServerProfile::Demo, ServerProfile::Prod] {
            let (registry, _) = capability(1);
            assert!(
                CollisionRecoveryRuntime::new(
                    fixture.path.clone(),
                    server_context(profile, true, Some("admin-secret")),
                    registry,
                )
                .is_err()
            );
        }
        let (registry, _) = capability(2);
        assert!(
            CollisionRecoveryRuntime::new(
                fixture.path.clone(),
                server_context(ServerProfile::Dev, false, Some("admin-secret")),
                registry,
            )
            .is_err()
        );
        let (registry, _) = capability(3);
        assert!(
            CollisionRecoveryRuntime::new(
                fixture.path.clone(),
                server_context(ServerProfile::Dev, true, None),
                registry,
            )
            .is_err()
        );
        let (registry, _) = capability(4);
        assert!(
            CollisionRecoveryRuntime::new(
                fixture.path.clone(),
                server_context(ServerProfile::Test, true, Some("admin-secret")),
                registry,
            )
            .is_ok()
        );
        assert!(validate_loopback_bind_ip("0.0.0.0".parse().unwrap()).is_err());
        assert!(validate_loopback_bind_ip("127.0.0.1".parse().unwrap()).is_ok());
    }

    #[tokio::test]
    async fn serving_rechecks_the_concrete_listener_address() {
        let directory = tempfile::tempdir().unwrap();
        let (runtime, _) = runtime(&directory.path().join("app.sqlite3"));
        let listener = tokio::net::TcpListener::bind("0.0.0.0:0").await.unwrap();

        let error = serve(runtime, listener, std::future::pending())
            .await
            .expect_err("a loopback-claimed runtime cannot serve a non-loopback listener");
        assert!(error.to_string().contains("restricted to a loopback bind"));
    }

    #[test]
    #[cfg(not(feature = "server-owner"))]
    fn exact_index_collision_and_non_repairable_manifest_never_enter_recovery() {
        let fixture = collision_fixture(&["_auth_legacy"], false);
        let connection = Connection::open(&fixture.path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE ordinary(id INTEGER);
                 CREATE UNIQUE INDEX _auth_sessions_token_uq ON ordinary(id);",
            )
            .unwrap();
        drop(connection);
        let error = ordinary_open_error(&fixture.path);
        let collision = eligible(&fixture.path, &error).unwrap_err();
        assert_eq!(
            collision.diagnostic.code,
            "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION"
        );

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("absent.sqlite3");
        drop(LocalDatabase::open(&path).unwrap());
        let connection = Connection::open(&path).unwrap();
        let manifest = SchemaManifest {
            tables: vec![table_manifest("_auth_absent")],
            ..SchemaManifest::default()
        };
        connection
            .execute(
                "DELETE FROM _snapback_meta WHERE key IN (?1, ?2, ?3)",
                params![
                    META_AUTH_MODE_STATE,
                    META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
                    META_STAGED_AUTH_MODE_MANIFEST,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES('schema_manifest', ?1)",
                params![serde_json::to_string(&manifest).unwrap()],
            )
            .unwrap();
        drop(connection);
        let error = ordinary_open_error(&path);
        assert!(!eligible(&path, &error).unwrap());
    }

    #[test]
    fn closed_request_pins_normal_host_ops_envelope_and_nested_args() {
        let exact = serde_json::from_str::<RecoveryHostOpsRequest>(
            r#"{"operation":"auth.rescueCollidingTable","requestId":"hop_test","args":{"sourceTable":"_auth_x","targetTable":"x"}}"#,
        )
        .unwrap();
        assert_eq!(exact.operation, RECOVERY_HOST_OP);
        assert_eq!(exact.request_id.as_deref(), Some("hop_test"));
        let args = exact.args.unwrap();
        assert_eq!(args.source_table.as_deref(), Some("_auth_x"));
        assert_eq!(args.target_table.as_deref(), Some("x"));

        for invalid in [
            // Operation args belong under the ordinary `args` carrier.
            r#"{"operation":"auth.rescueCollidingTable","sourceTable":"_auth_x","targetTable":"x"}"#,
            // schemaVersion is not a field in the ordinary HostOpsRequest.
            r#"{"schemaVersion":"snapback.v1","operation":"auth.rescueCollidingTable","args":{"sourceTable":"_auth_x","targetTable":"x"}}"#,
            r#"{"operation":"auth.rescueCollidingTable","args":{"sourceTable":"_auth_x","targetTable":"x"},"extra":1}"#,
            r#"{"operation":"auth.rescueCollidingTable","operation":"auth.rescueCollidingTable"}"#,
            r#"{"operation":"auth.rescueCollidingTable","args":{"sourceTable":"_auth_x","targetTable":"x","extra":1}}"#,
            r#"{"operation":"auth.rescueCollidingTable","args":{"sourceTable":"_auth_x","sourceTable":"_auth_y","targetTable":"x"}}"#,
        ] {
            assert!(
                serde_json::from_str::<RecoveryHostOpsRequest>(invalid).is_err(),
                "unexpectedly accepted {invalid}"
            );
        }

        assert!(
            serde_json::from_str::<RecoveryHostOpsRequest>(
                r#"{"operation":"auth.rescueCollidingTable","args":{"sourceTable":"_auth_x","targetTable":"x"},"args":{}}"#
            )
            .is_err()
        );
    }
}
