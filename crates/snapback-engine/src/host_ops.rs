//! The host-ops first slice (LLP 0032 P6): the LLP 0024 operating surface's
//! in-process operations, served as `POST /_snapback/api/host-ops` and
//! projected by the `snapback` CLI. Every invocation returns exactly one
//! `hostOpsResult` envelope; unimplemented pinned operations return an
//! `ok: false` envelope with a structured diagnostic, never a 404.
//!
//! @ref LLP 0024#result-envelope — one JSON envelope shared by CLI and HTTP;
//!   `diagnostics[]` is the only diagnostic channel.
//! @ref LLP 0037#decision-ratified-2026-07-02 — these Rust types are the
//!   source of truth for `hostOpsResult`; the committed schema in `schemas/`
//!   is generated from them (tests/artifact_schemas_v0.rs).

use crate::auth::invocation::{InvocationSource, PreparedAuthority};
use crate::contract_types::ServerProfile;
use crate::diagnostic::{Diagnostic, SnapbackError};
use crate::local::LocalSnapback;
use crate::manifest::{
    FunctionKind, FunctionManifest, HandlerInput, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
    SeedData, TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
};
use serde::de::{Deserializer, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::fmt;

pub use crate::host_ops_contract::*;

/// MCP mints `maxBytes` plus this fixed-shape outer-envelope allowance. The
/// server measures the actual successful envelope and fails closed if future
/// host metadata ever outgrows it.
pub const TELEMETRY_EXPORT_HOST_ENVELOPE_ALLOWANCE: usize = 64 * 1024;

/// Operations this endpoint serves in the first slice.
///
/// This includes the six `branch.*` operations, the ten `asset.*` operations
/// dispatched inline by the `execute_host_op_with_profile` match arm, the two
/// `debug.networkProfile{Get,Set}` operations dispatched entirely in
/// `src/server.rs` (outside that match arm, via `network_profile_result`),
/// and `debug.live.forceResync` (LLP 0184 §B), dispatched the same way as
/// the `debug.networkProfile*` pair — outside the match arm, gated by
/// `AppState::debug_perturbation_target_authority` rather than
/// `require_operation_profile`. These groups are fully served today; they
/// belong here so `host_op_diagnostic` recognizes their spelling instead of
/// rewriting it to `"unrecognized"` in diagnostics.
pub const SERVED_HOST_OPS: [&str; 49] = [
    "app.inspect",
    "app.readiness.v1",
    "cron.list",
    "app.reset",
    "app.seed.ensure.v1",
    "app.seed.preview.v1",
    "app.seed.reset-install.v1",
    "app.seed.clear.v1",
    "schema.load",
    "functions.load",
    "function.run",
    "function.explain",
    "remediation.apply",
    "auth.mintSession",
    "auth.rehearsal.mint",
    "auth.rehearsal.exercise",
    "auth.rehearsal.revoke",
    "auth.rehearsal.status",
    "auth.rescueCollidingTable",
    "auth.integrationRetire",
    "auth.integrationSuspend",
    "auth.integrationResume",
    "telemetry.stats",
    "telemetry.events",
    "telemetry.export",
    "errors.issues",
    "errors.issue",
    "errors.transition",
    "data.patch.preview",
    "data.patch.apply",
    "branch.create.v1",
    "branch.execute.v1",
    "branch.list.v1",
    "branch.reap.v1",
    "branch.inspect.v1",
    "branch.drop.v1",
    "asset.put",
    "asset.ensureSeedFixture",
    "asset.inspect",
    "asset.list",
    "asset.exportCut",
    "asset.importCut",
    "asset.retry",
    "asset.gcSweep",
    "asset.delete",
    "asset.rotateSigningKey",
    "debug.networkProfileGet",
    "debug.networkProfileSet",
    "debug.live.forceResync",
];

// @ref LLP 0024#core-operation-ids — process lifecycle and trusted ready-file
// coordination are CLI-owned; a running server cannot perform them over its
// own host-ops endpoint.
pub const CLI_ONLY_HOST_OPS: [&str; 4] = ["host.start", "host.stop", "host.restart", "host.wait"];

/// Pinned by LLP 0024, not yet built anywhere. Requests return a structured
/// `SNAPBACK_HOST_OP_UNIMPLEMENTED` envelope so aspiration cannot be mistaken
/// for API (the LLP 0032 R4 banner rule, enforced at runtime).
pub const PINNED_UNBUILT_HOST_OPS: [&str; 3] =
    ["schema.reload", "functions.reload", "acceptance.run"];

/// Fixed per-process bound of the recent-invocations ring below.
///
/// @ref LLP 0042#diagnostics-reading--an-appinspect-extension-not-a-new-operation —
///   the SC-1a non-deferrable minimum pins 128 entries, evicted oldest-first.
pub const RECENT_INVOCATIONS_CAPACITY: usize = 128;

/// One recorded function invocation or artifact-load operation surfaced by
/// `app.inspect` as `data.recentInvocations`.
#[derive(Clone, Debug, Serialize)]
pub struct RecentInvocationEntry {
    pub operation: String,
    #[serde(rename = "functionId", skip_serializing_if = "Option::is_none")]
    pub function_id: Option<String>,
    /// `"ok"` or the failing diagnostic code.
    pub outcome: String,
    /// ISO 8601 UTC start time.
    #[serde(rename = "startedAt")]
    pub started_at: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    pub diagnostics: Vec<Diagnostic>,
    /// D1 declaration/observation conformance for function invocations,
    /// copied from the host-op envelope or computed from the app-data path's
    /// exact captured dependencies.
    // @ref LLP 0146#d1-declarationobservation-conformance — the bounded ring
    //   covers both host-operation and app-data-plane invocations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conformance: Option<serde_json::Value>,
}

/// Bounded, in-memory, most-recent-first ring of recent operations. Shared by
/// every router clone of one server process; never persisted (durable
/// retention is explicitly deferred by the LLP 0042 amendment).
#[derive(Clone, Default)]
pub struct RecentInvocationRing {
    entries: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<RecentInvocationEntry>>>,
}

impl RecentInvocationRing {
    pub fn record(&self, entry: RecentInvocationEntry) {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        entries.push_front(entry);
        entries.truncate(RECENT_INVOCATIONS_CAPACITY);
    }

    pub fn snapshot(&self) -> Vec<RecentInvocationEntry> {
        self.entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .cloned()
            .collect()
    }
}

/// Project one envelope into the ring's `outcome` field: `"ok"`, or the first
/// error/fatal diagnostic code (falling back to the first diagnostic, then a
/// generic `"error"`).
pub fn recent_invocation_outcome(result: &HostOpsResult) -> String {
    if result.ok {
        return "ok".to_owned();
    }
    result
        .diagnostics
        .iter()
        .find(|diagnostic| {
            matches!(
                diagnostic.severity,
                crate::diagnostic::DiagnosticSeverity::Error
                    | crate::diagnostic::DiagnosticSeverity::Fatal
            )
        })
        .or_else(|| result.diagnostics.first())
        .map(|diagnostic| diagnostic.code.clone())
        .unwrap_or_else(|| "error".to_owned())
}

/// Millisecond UNIX time as an ISO 8601 UTC timestamp.
pub fn iso8601_utc_ms(ms: u64) -> String {
    let seconds = (ms / 1_000) as i64;
    let millis = ms % 1_000;
    let days = seconds.div_euclid(86_400);
    let second_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = crate::cron::civil_from_days(days).unwrap_or((1970, 1, 1));
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        second_of_day / 3_600,
        (second_of_day % 3_600) / 60,
        second_of_day % 60,
    )
}

/// The `function.explain` kinds LLP 0024 pins. `mutationDryRun` is served
/// (LLP 0051 D8 / Increment 4); the rest return a structured
/// `SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED` envelope until built.
pub const EXPLAIN_KINDS: [&str; 5] = [
    "queryPlan",
    "permissionAllow",
    "permissionDeny",
    "capabilityGap",
    "mutationDryRun",
];

/// One host-ops request. Operation-specific fields are optional and validated
/// per operation; unknown operations fail closed with an envelope.
#[derive(Clone, Default, Deserialize)]
pub struct HostOpsRequest {
    pub operation: String,
    #[serde(default, rename = "requestId")]
    pub request_id: Option<String>,
    #[serde(default)]
    pub schema: Option<SchemaManifest>,
    #[serde(default)]
    pub functions: Option<FunctionManifest>,
    #[serde(default)]
    pub seed: Option<SeedData>,
    /// Closed operation body for predecessor-unknown families. Versioned seed
    /// operations accept their Rust-owned carrier only here; legacy wrapper
    /// siblings never participate in the request digest.
    #[serde(default, deserialize_with = "deserialize_optional_closed_value")]
    pub input: Option<Value>,
    #[serde(default)]
    pub function: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_closed_value")]
    pub args: Option<Value>,
    #[serde(default, rename = "userId")]
    pub user_id: Option<String>,
    /// `function.explain` only: the explanation kind (LLP 0024 v0 kinds;
    /// `mutationDryRun` is the served one).
    #[serde(default)]
    pub kind: Option<String>,
}

struct ClosedValue(Value);

impl<'de> Deserialize<'de> for ClosedValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct ClosedValueVisitor;

        impl<'de> Visitor<'de> for ClosedValueVisitor {
            type Value = ClosedValue;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a JSON value without duplicate object keys")
            }

            fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
                Ok(ClosedValue(Value::Bool(value)))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
                Ok(ClosedValue(Value::Number(value.into())))
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
                Ok(ClosedValue(Value::Number(value.into())))
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                serde_json::Number::from_f64(value)
                    .map(Value::Number)
                    .map(ClosedValue)
                    .ok_or_else(|| E::custom("non-finite JSON number"))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
                Ok(ClosedValue(Value::String(value.to_owned())))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
                Ok(ClosedValue(Value::String(value)))
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(ClosedValue(Value::Null))
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(ClosedValue(Value::Null))
            }

            fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
            where
                D: Deserializer<'de>,
            {
                ClosedValue::deserialize(deserializer)
            }

            fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                let mut values = Vec::new();
                while let Some(ClosedValue(value)) = sequence.next_element()? {
                    values.push(value);
                }
                Ok(ClosedValue(Value::Array(values)))
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut values = serde_json::Map::new();
                while let Some(key) = map.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(serde::de::Error::custom(format!("duplicate field `{key}`")));
                    }
                    let ClosedValue(value) = map.next_value()?;
                    values.insert(key, value);
                }
                Ok(ClosedValue(Value::Object(values)))
            }
        }

        deserializer.deserialize_any(ClosedValueVisitor)
    }
}

fn deserialize_optional_closed_value<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
where
    D: Deserializer<'de>,
{
    struct OptionalClosedValueVisitor;

    impl<'de> Visitor<'de> for OptionalClosedValueVisitor {
        type Value = Option<Value>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("an optional JSON value without duplicate object keys")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
        where
            D: Deserializer<'de>,
        {
            ClosedValue::deserialize(deserializer).map(|ClosedValue(value)| Some(value))
        }
    }

    deserializer.deserialize_option(OptionalClosedValueVisitor)
}

impl fmt::Debug for HostOpsRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HostOpsRequest")
            .field("operation", &"[REDACTED]")
            .field(
                "request_id",
                &self.request_id.as_ref().map(|_| "[REDACTED]"),
            )
            .field("has_schema", &self.schema.is_some())
            .field("has_functions", &self.functions.is_some())
            .field("has_seed", &self.seed.is_some())
            .field("has_input", &self.input.is_some())
            .field("function", &self.function.as_ref().map(|_| "[REDACTED]"))
            .field("args", &self.args.as_ref().map(|_| "[REDACTED]"))
            .field("user_id", &self.user_id.as_ref().map(|_| "[REDACTED]"))
            .field("kind", &self.kind.as_ref().map(|_| "[REDACTED]"))
            .finish()
    }
}

/// Versioned seed operations admit only the common operation/requestId
/// wrapper plus their closed Rust-owned `input`. In particular, no legacy
/// host-operation sibling may be silently discarded before the seed request
/// digest is computed.
///
/// @ref LLP 0109#162-closed-carriers-and-exact-operation-combinations —
/// seed bodies live only under `HostOpsRequest.input`.
pub fn versioned_seed_wrapper_has_forbidden_siblings(request: &HostOpsRequest) -> bool {
    request.schema.is_some()
        || request.functions.is_some()
        || request.seed.is_some()
        || request.function.is_some()
        || request.args.is_some()
        || request.user_id.is_some()
        || request.kind.is_some()
}

fn managed_branch_wrapper_has_forbidden_siblings(request: &HostOpsRequest) -> bool {
    request.schema.is_some()
        || request.functions.is_some()
        || request.seed.is_some()
        || request.function.is_some()
        || request.args.is_some()
        || request.user_id.is_some()
        || request.kind.is_some()
}

fn host_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

pub fn new_request_id() -> String {
    crate::ids::mint_time_ordered(crate::ids::Kind::HostOperation)
}

fn authority_none() -> Option<HostOpsAuthority> {
    Some(HostOpsAuthority {
        mode: "none".to_owned(),
        actor_principal: None,
        effective_principal: None,
        local_dev_only: true,
        admin_bypass: false,
        scope: None,
        reason: None,
    })
}

fn authority_admin(reason: &str) -> Option<HostOpsAuthority> {
    Some(HostOpsAuthority {
        mode: "devAdminBypass".to_owned(),
        actor_principal: None,
        effective_principal: None,
        local_dev_only: true,
        admin_bypass: true,
        scope: None,
        reason: Some(reason.to_owned()),
    })
}

fn authority_rehearsal() -> Option<HostOpsAuthority> {
    Some(HostOpsAuthority {
        mode: "authRehearsalGrant".to_owned(),
        actor_principal: None,
        effective_principal: None,
        local_dev_only: true,
        admin_bypass: false,
        scope: Some("finiteGrant".to_owned()),
        reason: Some("finite auth rehearsal grant".to_owned()),
    })
}

fn authority_secret_read(scope: &str) -> Option<HostOpsAuthority> {
    Some(HostOpsAuthority {
        mode: "adminSecretRead".to_owned(),
        actor_principal: None,
        effective_principal: None,
        local_dev_only: false,
        admin_bypass: true,
        scope: Some(scope.to_owned()),
        reason: Some("scoped, budgeted secret-read lease".to_owned()),
    })
}

fn authority_dev_user(user_id: Option<&str>) -> Option<HostOpsAuthority> {
    match user_id {
        Some(user_id) => Some(HostOpsAuthority {
            mode: "devUser".to_owned(),
            actor_principal: None,
            effective_principal: Some(json!({ "userId": user_id, "roles": [] })),
            local_dev_only: true,
            admin_bypass: false,
            scope: None,
            reason: None,
        }),
        None => authority_none(),
    }
}

#[allow(clippy::too_many_arguments)]
fn host_ops_result(
    snapback: &LocalSnapback,
    request_id: String,
    operation: String,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    mut ok: bool,
    authority: Option<HostOpsAuthority>,
    data: Value,
    mut diagnostics: Vec<Diagnostic>,
) -> HostOpsResult {
    let database_version = match snapback.durable_version() {
        Ok(version) => Some(version),
        Err(error) => {
            ok = false;
            diagnostics.push(error.diagnostic);
            None
        }
    };
    let next = if ok {
        Vec::new()
    } else {
        crate::control_catalog::refusal_next(&operation)
    };
    HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id,
        operation,
        ok,
        target: HostOpsTarget {
            app_id: snapback.loaded_app_id(),
            app_root: None,
            target_profile: match profile {
                crate::contract_types::ServerProfile::Dev => {
                    TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()
                }
                other => format!("local-{}-sqlite-ibex", other.as_str()),
            },
            server_url,
        },
        authority,
        artifacts: HostOpsArtifacts {
            schema_hash: snapback.loaded_schema_hash(),
            bundle_hash: snapback.loaded_bundle_hash(),
            database_version,
        },
        data,
        diagnostics,
        next,
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    }
}

/// Assemble an auth operator outcome through the same `hostOpsResult`
/// projection as every other served operation. Authentication failures occur
/// before this helper; once admitted, each operation records its exact admin,
/// metadata-read, or finite rehearsal-grant authority on success or failure.
pub fn auth_operator_result(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    outcome: Result<Value, SnapbackError>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();
    let authority_reason = match operation.as_str() {
        "auth.mintSession" => "issuedBy: admin",
        "auth.rehearsal.status" => "auth rehearsal metadata read gate",
        _ => "host-ops auth impersonation gate",
    };
    let uses_rehearsal_authority = operation == "auth.rehearsal.exercise";
    let authority = || {
        if uses_rehearsal_authority {
            authority_rehearsal()
        } else {
            authority_admin(authority_reason)
        }
    };
    match outcome {
        Ok(data) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            true,
            authority(),
            data,
            Vec::new(),
        ),
        Err(error) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            false,
            authority(),
            Value::Object(Default::default()),
            vec![error.diagnostic],
        ),
    }
}

/// Project one finite telemetry query through the ordinary host-ops envelope.
/// The export projection is one declared, bounded page; only HTTP/CLI unfold
/// the same core into a streaming NDJSON response.
pub fn telemetry_query_result(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    outcome: Result<Value, SnapbackError>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();
    let secret_data = matches!(
        operation.as_str(),
        "telemetry.events" | "telemetry.export" | "errors.issue"
    );
    let authority = match operation.as_str() {
        "telemetry.events" | "telemetry.export" | "errors.issue" => {
            authority_secret_read(&operation)
        }
        "errors.issues" => authority_admin("host-ops structural error metadata read gate"),
        "errors.transition" => authority_admin("host-ops error transition admin-write gate"),
        _ => authority_admin("host-ops telemetry aggregate read gate"),
    };
    let mut result = match outcome {
        Ok(data) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            true,
            authority.clone(),
            data,
            Vec::new(),
        ),
        Err(error) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            false,
            authority,
            Value::Object(Default::default()),
            vec![error.diagnostic],
        ),
    };
    // `host_ops_result` can conservatively flip `ok` when target metadata is
    // corrupt. Never retain raw rows behind that failed envelope: the caller
    // must receive either a charged success or a data-empty failure.
    if secret_data && !result.ok {
        result.data = Value::Object(Default::default());
    }
    result
}

/// Project a network-profile read or activation outcome through the ordinary
/// host-ops envelope. Parsing and activation happen in the managed server,
/// where every selector can terminate at `AppState::activate_network_profile`;
/// this helper only stamps the shared DTO around that outcome.
///
/// @ref LLP 0167#authority-one-activation-chokepoint — host-ops is a thin
///   projection over the same activation gate as the dedicated admin route.
pub fn network_profile_result(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    outcome: Result<Value, SnapbackError>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();
    let authority = match operation.as_str() {
        "debug.networkProfileSet" => authority_admin("host-ops network-profile write gate"),
        _ => authority_none(),
    };
    match outcome {
        Ok(data) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            true,
            authority,
            data,
            Vec::new(),
        ),
        Err(error) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            false,
            authority,
            Value::Object(Default::default()),
            vec![error.diagnostic],
        ),
    }
}

/// Project the AppState-aware operational predicate through the ordinary
/// host-ops envelope. A successful evaluation is `ok: true` even when its
/// application-level `ready` predicate is false.
pub fn operational_readiness_result(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    outcome: Result<crate::operational_readiness::OperationalReadinessV1, SnapbackError>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();
    match outcome {
        Ok(readiness) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            true,
            authority_none(),
            json!({ "operationalReadiness": readiness }),
            Vec::new(),
        ),
        Err(error) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            false,
            authority_none(),
            Value::Object(Default::default()),
            vec![error.diagnostic],
        ),
    }
}

/// Project the server-owned data-patch core through the shared LLP 0024
/// envelope. Token comparison/consumption and target classification happen
/// before this presentation helper.
pub fn data_patch_result(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    authority: Option<crate::data_patch::DataPatchAuthorityV1>,
    outcome: Result<Value, SnapbackError>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();
    let envelope_authority = authority.map(|authority| HostOpsAuthority {
        mode: authority.mode,
        actor_principal: authority.actor_principal,
        effective_principal: authority
            .effective_principal
            .and_then(|principal| serde_json::to_value(principal).ok()),
        local_dev_only: authority.local_dev_only,
        admin_bypass: authority.admin_bypass,
        scope: authority.scope,
        reason: authority.reason,
    });
    match outcome {
        Ok(data) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            true,
            envelope_authority,
            data,
            Vec::new(),
        ),
        Err(error) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            false,
            envelope_authority,
            Value::Object(Default::default()),
            vec![error.diagnostic],
        ),
    }
}

/// LLP 0184 §B: `debug.live.forceResync`'s envelope wrapper, the same small
/// shape as [`network_profile_result`] but tagged with its own admin
/// authority annotation.
pub fn force_live_resync_result(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    outcome: Result<Value, SnapbackError>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();
    let authority = authority_admin("host-ops forced-live-resync debug perturbation gate");
    match outcome {
        Ok(data) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            true,
            authority,
            data,
            Vec::new(),
        ),
        Err(error) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            false,
            authority,
            Value::Object(Default::default()),
            vec![error.diagnostic],
        ),
    }
}

pub fn host_op_handler_input(request: &HostOpsRequest) -> HandlerInput {
    HandlerInput {
        args: request
            .args
            .clone()
            .unwrap_or_else(|| Value::Object(Default::default())),
        auth: crate::manifest::AuthInput {
            principal: None,
            session_id: None,
            user_id: request.user_id.clone(),
            ..crate::manifest::AuthInput::default()
        },
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn legacy_host_op_authority(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    profile: ServerProfile,
) -> Result<Option<PreparedAuthority>, SnapbackError> {
    let source = match request.operation.as_str() {
        "function.run" => Some(InvocationSource::HostOperationFunctionRun),
        "function.explain" if request.kind.as_deref() == Some("mutationDryRun") => {
            Some(InvocationSource::HostOperationMutationDryRun)
        }
        _ => None,
    };
    source
        .map(|source| {
            snapback.prepare_legacy_dev_authority(source, profile, &host_op_handler_input(request))
        })
        .transpose()
}

fn require_host_op_authority(
    authority: Option<PreparedAuthority>,
    expected: InvocationSource,
) -> Result<PreparedAuthority, SnapbackError> {
    let authority = authority.ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
            "auth",
            "host operation requires server-prepared managed authority",
        )
    })?;
    if authority.source() != expected {
        return Err(SnapbackError::error(
            "SNAPBACK_INVOCATION_SOURCE_INVALID",
            "auth",
            "server-prepared authority source does not match the host operation",
        ));
    }
    authority.validate_admission("host operation dispatch")?;
    Ok(authority)
}

/// Project an app reset already executed by the server's authorization-stream
/// coordinator through the ordinary host-ops envelope.
pub fn coordinated_reset_result(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    outcome: crate::diagnostic::SnapbackResult<Option<crate::manifest::MutationOutput>>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();
    match outcome {
        Ok(seeded_output) => {
            let mut data = serde_json::Map::new();
            data.insert("resetScope".to_owned(), json!("app"));
            data.insert("seeded".to_owned(), json!(request.seed.is_some()));
            if let Some(output) = seeded_output {
                data.insert(
                    "seedCommit".to_owned(),
                    serde_json::to_value(output).unwrap_or_default(),
                );
            }
            if let Ok(database_version) = snapback.durable_version() {
                data.insert("databaseVersion".to_owned(), json!(database_version));
            }
            host_ops_result(
                snapback,
                request_id,
                operation,
                server_url,
                profile,
                true,
                authority_admin("host-ops admin write gate"),
                Value::Object(data),
                Vec::new(),
            )
        }
        Err(error) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            false,
            authority_admin("host-ops admin write gate"),
            Value::Object(Default::default()),
            vec![error.diagnostic],
        ),
    }
}

pub fn coordinated_versioned_seed_result(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    outcome: crate::diagnostic::SnapbackResult<crate::seed_identity::SeedInstallReceiptV1>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();
    match outcome {
        Ok(receipt) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            true,
            authority_admin("host-ops admin write gate"),
            serde_json::to_value(receipt).unwrap_or(Value::Null),
            Vec::new(),
        ),
        Err(error) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            false,
            authority_admin("host-ops admin write gate"),
            Value::Object(Default::default()),
            vec![error.diagnostic],
        ),
    }
}

/// Project a sessions-mode function activation already executed through the
/// complete-pair provisioning barrier. The dev-mode embedding continues to
/// use the legacy branch below; only the server's sessions path calls this
/// helper, so no raw function swap can bypass durable activation.
pub fn coordinated_functions_load_result(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    function_count: usize,
    outcome: Result<Vec<Diagnostic>, SnapbackError>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();
    match outcome {
        Ok(diagnostics) => {
            let ok = !diagnostics.iter().any(|diagnostic| {
                matches!(
                    diagnostic.severity,
                    crate::diagnostic::DiagnosticSeverity::Error
                        | crate::diagnostic::DiagnosticSeverity::Fatal
                )
            });
            host_ops_result(
                snapback,
                request_id,
                operation,
                server_url,
                profile,
                ok,
                authority_admin("host-ops admin write gate"),
                json!({ "loaded": ok, "functionCount": function_count }),
                diagnostics,
            )
        }
        Err(error) => host_ops_result(
            snapback,
            request_id,
            operation,
            server_url,
            profile,
            false,
            authority_admin("host-ops admin write gate"),
            Value::Object(Default::default()),
            vec![error.diagnostic],
        ),
    }
}

pub fn coordinated_function_run_mutation_result(
    snapback: &LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    outcome: Result<crate::manifest::MutationOutput, SnapbackError>,
    conformance: crate::conformance::DeclarationConformance,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let authority = authority_dev_user(request.user_id.as_deref());
    // @ref LLP 0146#d1-declarationobservation-conformance — the coordinated
    //   settlement seam receives the report already derived in the executing
    //   commit turn. This envelope turn must never rejoin generation-A capture
    //   with whichever same-name declaration is active now.
    match outcome {
        Ok(output) => host_ops_result(
            snapback,
            request_id,
            request.operation.clone(),
            server_url,
            profile,
            true,
            authority,
            json!({
                "mutationCommit": serde_json::to_value(output)
                    .unwrap_or_else(|_| Value::Object(Default::default())),
                "conformance": conformance,
            }),
            Vec::new(),
        ),
        Err(error) => host_ops_result(
            snapback,
            request_id,
            request.operation.clone(),
            server_url,
            profile,
            false,
            authority,
            json!({ "conformance": conformance }),
            vec![error.diagnostic],
        ),
    }
}

/// Execute one served host operation against the local instance and produce
/// the envelope. The HTTP handler and (through HTTP) the CLI both come here,
/// so the projections cannot drift.
pub fn execute_host_op(
    snapback: &mut LocalSnapback,
    request: HostOpsRequest,
    server_url: Option<String>,
) -> HostOpsResult {
    #[cfg(not(feature = "engine-owner"))]
    let served_routes = crate::server::route_registry()
        .iter()
        .map(|route| route.path)
        .collect();
    #[cfg(feature = "engine-owner")]
    let served_routes = Vec::new();
    execute_host_op_with_profile(
        snapback,
        request,
        server_url,
        crate::contract_types::ServerProfile::Dev,
        served_routes,
    )
}

/// Execute with the serving environment's profile. HTTP passes the real
/// [`ServerProfile`]; the legacy in-process helper above deliberately models
/// the trusted local-dev embedding posture.
pub fn execute_host_op_with_profile(
    snapback: &mut LocalSnapback,
    request: HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    served_routes: Vec<&str>,
) -> HostOpsResult {
    let prepared_authority = match legacy_host_op_authority(snapback, &request, profile) {
        Ok(authority) => authority,
        Err(error) => {
            return host_ops_result(
                snapback,
                request.request_id.clone().unwrap_or_else(new_request_id),
                request.operation.clone(),
                server_url,
                profile,
                false,
                authority_none(),
                Value::Object(Default::default()),
                vec![error.diagnostic],
            );
        }
    };
    execute_host_op_with_profile_and_authority(
        snapback,
        request,
        server_url,
        profile,
        prepared_authority,
        served_routes,
    )
}

/// Execute with authority prepared by server middleware under one managed
/// admission lease. Only app-executing host operations consume this value;
/// administrative metadata operations must pass `None`.
#[doc(hidden)]
pub fn execute_host_op_with_profile_and_authority(
    snapback: &mut LocalSnapback,
    request: HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
    prepared_authority: Option<PreparedAuthority>,
    served_routes: Vec<&str>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();

    let envelope = |snapback: &LocalSnapback,
                    ok: bool,
                    authority: Option<HostOpsAuthority>,
                    data: Value,
                    diagnostics: Vec<Diagnostic>| {
        host_ops_result(
            snapback,
            request_id.clone(),
            operation.clone(),
            server_url.clone(),
            profile,
            ok,
            authority,
            data,
            diagnostics,
        )
    };

    let profile_requirement = operation_profile_requirement(&operation, request.user_id.is_some());
    if let Some(diagnostic) = operation_profile_diagnostic(profile, &operation, profile_requirement)
    {
        return envelope(
            snapback,
            false,
            authority_none(),
            Value::Object(Default::default()),
            vec![diagnostic],
        );
    }

    match operation.as_str() {
        "cron.list" => match snapback.inspect_core() {
            Ok(state) => envelope(
                snapback,
                true,
                authority_none(),
                json!({ "cron": crate::cron::CronListState::from(state.cron) }),
                Vec::new(),
            ),
            Err(error) => envelope(
                snapback,
                false,
                authority_none(),
                Value::Object(Default::default()),
                vec![error.diagnostic],
            ),
        },
        "app.inspect" => match snapback.inspect() {
            Ok(state) => {
                let runtime_state = serde_json::to_value(&state)
                    .unwrap_or_else(|_| Value::Object(Default::default()));
                envelope(
                    snapback,
                    true,
                    authority_none(),
                    json!({ "runtimeState": runtime_state }),
                    Vec::new(),
                )
            }
            Err(error) => envelope(
                snapback,
                false,
                authority_none(),
                Value::Object(Default::default()),
                vec![error.diagnostic],
            ),
        },
        "app.reset" => {
            #[cfg(not(test))]
            {
                envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![Diagnostic::error(
                        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                        "auth",
                        "app.reset must execute through the authorization-stream coordinator",
                    )],
                )
            }
            #[cfg(test)]
            {
                let seed = request.seed.clone();
                let outcome = snapback.reset_with_seed(seed);
                coordinated_reset_result(snapback, &request, server_url, profile, outcome)
            }
        }
        "app.seed.ensure.v1" => {
            if versioned_seed_wrapper_has_forbidden_siblings(&request) {
                return envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![host_op_diagnostic(
                        "SNAPBACK_SEED_DECLARATION_INVALID",
                        &operation,
                        "versioned seed host operation accepts its body only under input",
                    )],
                );
            }
            let parsed = request
                .input
                .clone()
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_HOST_OP_INPUT_MISSING",
                        "host-ops",
                        "app.seed.ensure.v1 requires input",
                    )
                })
                .and_then(|value| {
                    serde_json::from_value::<crate::seed_identity::InstallSeedRequestV1>(value)
                        .map_err(|_| {
                            SnapbackError::error(
                                "SNAPBACK_SEED_DECLARATION_INVALID",
                                "seed",
                                "app.seed.ensure.v1 input is not the closed v1 carrier",
                            )
                        })
                });
            match parsed.and_then(|request| snapback.ensure_versioned_seed(request)) {
                Ok(result) => envelope(
                    snapback,
                    true,
                    authority_admin("host-ops admin write gate"),
                    serde_json::to_value(result).unwrap_or(Value::Null),
                    Vec::new(),
                ),
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                ),
            }
        }
        "app.seed.preview.v1" => {
            if versioned_seed_wrapper_has_forbidden_siblings(&request) {
                return envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![host_op_diagnostic(
                        "SNAPBACK_SEED_DECLARATION_INVALID",
                        &operation,
                        "versioned seed host operation accepts its body only under input",
                    )],
                );
            }
            let parsed = request
                .input
                .clone()
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_HOST_OP_INPUT_MISSING",
                        "host-ops",
                        "app.seed.preview.v1 requires input",
                    )
                })
                .and_then(|value| {
                    serde_json::from_value::<crate::seed_identity::SeedPreviewRequestV1>(value)
                        .map_err(|_| {
                            SnapbackError::error(
                                "SNAPBACK_SEED_DECLARATION_INVALID",
                                "seed",
                                "app.seed.preview.v1 input is not the closed v1 carrier",
                            )
                        })
                });
            match parsed.and_then(|request| snapback.preview_versioned_seed(request)) {
                Ok(result) => envelope(
                    snapback,
                    true,
                    authority_admin("host-ops admin write gate"),
                    serde_json::to_value(result).unwrap_or(Value::Null),
                    Vec::new(),
                ),
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                ),
            }
        }
        "app.seed.reset-install.v1" | "app.seed.clear.v1" => envelope(
            snapback,
            false,
            authority_admin("host-ops admin write gate"),
            Value::Object(Default::default()),
            vec![Diagnostic::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                "versioned seed reset must execute through the authorization-stream coordinator",
            )],
        ),
        "branch.create.v1" => {
            let outcome = if managed_branch_wrapper_has_forbidden_siblings(&request) {
                Err(SnapbackError::error(
                    "SNAPBACK_BRANCH_REQUEST_INVALID",
                    "storage",
                    "managed branch host operations accept their closed body only under input",
                ))
            } else {
                request
                    .input
                    .clone()
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_HOST_OP_INPUT_MISSING",
                            "host-ops",
                            "branch.create.v1 requires input",
                        )
                    })
                    .and_then(|value| {
                        serde_json::from_value::<ManagedBranchCreateHostInputV1>(value).map_err(
                            |_| {
                                SnapbackError::error(
                                    "SNAPBACK_BRANCH_REQUEST_INVALID",
                                    "storage",
                                    "branch.create.v1 input is not the closed v1 carrier",
                                )
                            },
                        )
                    })
                    .and_then(|input| {
                        if input.schema_version != 1 {
                            return Err(SnapbackError::error(
                                "SNAPBACK_BRANCH_SCHEMA_VERSION_UNSUPPORTED",
                                "storage",
                                "branch.create.v1 requires schemaVersion 1",
                            ));
                        }
                        snapback.create_operator_in_app_branch_with_policy(
                            input.allowed_functions,
                            input.ttl_ms,
                            host_now_ms(),
                            input.egress_policy,
                        )
                    })
            };
            match outcome {
                Ok(receipt) => envelope(
                    snapback,
                    true,
                    authority_admin("host-ops admin write gate"),
                    json!({ "branch": receipt }),
                    Vec::new(),
                ),
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                ),
            }
        }
        "branch.execute.v1" => {
            let outcome = if managed_branch_wrapper_has_forbidden_siblings(&request) {
                Err(SnapbackError::error(
                    "SNAPBACK_BRANCH_REQUEST_INVALID",
                    "storage",
                    "managed branch host operations accept their closed body only under input",
                ))
            } else if !request
                .request_id
                .as_deref()
                .is_some_and(crate::manifest::replay_opaque_id_is_valid)
            {
                Err(SnapbackError::error(
                    "SNAPBACK_BRANCH_REQUEST_ID_REQUIRED",
                    "storage",
                    "branch.execute.v1 requires a caller-retained replay-stable requestId",
                ))
            } else {
                let stable_request_id = request
                    .request_id
                    .as_deref()
                    .expect("validated stable branch request id");
                request
                    .input
                    .clone()
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_HOST_OP_INPUT_MISSING",
                            "host-ops",
                            "branch.execute.v1 requires input",
                        )
                    })
                    .and_then(|value| {
                        serde_json::from_value::<ManagedBranchExecuteHostInputV1>(value).map_err(
                            |_| {
                                SnapbackError::error(
                                    "SNAPBACK_BRANCH_REQUEST_INVALID",
                                    "storage",
                                    "branch.execute.v1 input is not the closed v1 carrier",
                                )
                            },
                        )
                    })
                    .and_then(|input| {
                        if input.schema_version != 1 {
                            return Err(SnapbackError::error(
                                "SNAPBACK_BRANCH_SCHEMA_VERSION_UNSUPPORTED",
                                "storage",
                                "branch.execute.v1 requires schemaVersion 1",
                            ));
                        }
                        snapback.execute_operator_in_app_branch(
                            &input.branch_id,
                            &input.function,
                            input.args,
                            stable_request_id,
                            host_now_ms(),
                            profile,
                        )
                    })
            };
            match outcome {
                Ok(operation) => envelope(
                    snapback,
                    true,
                    authority_admin("host-ops admin write gate"),
                    json!({ "branchOperation": operation }),
                    Vec::new(),
                ),
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                ),
            }
        }
        "branch.list.v1" => {
            let outcome = if managed_branch_wrapper_has_forbidden_siblings(&request) {
                Err(SnapbackError::error(
                    "SNAPBACK_BRANCH_REQUEST_INVALID",
                    "storage",
                    "managed branch host operations accept their closed body only under input",
                ))
            } else {
                request
                    .input
                    .clone()
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_HOST_OP_INPUT_MISSING",
                            "host-ops",
                            "branch.list.v1 requires input",
                        )
                    })
                    .and_then(|value| {
                        serde_json::from_value::<ManagedBranchListHostInputV1>(value).map_err(
                            |_| {
                                SnapbackError::error(
                                    "SNAPBACK_BRANCH_REQUEST_INVALID",
                                    "storage",
                                    "branch.list.v1 input is not the closed v1 carrier",
                                )
                            },
                        )
                    })
                    .and_then(|input| {
                        if input.schema_version != 1 {
                            return Err(SnapbackError::error(
                                "SNAPBACK_BRANCH_SCHEMA_VERSION_UNSUPPORTED",
                                "storage",
                                "branch.list.v1 requires schemaVersion 1",
                            ));
                        }
                        snapback.list_operator_in_app_branches(host_now_ms())
                    })
            };
            match outcome {
                Ok(branches) => envelope(
                    snapback,
                    true,
                    authority_admin("host-ops admin write gate"),
                    json!({ "branches": branches }),
                    Vec::new(),
                ),
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                ),
            }
        }
        "branch.inspect.v1" | "branch.drop.v1" => {
            let outcome = if managed_branch_wrapper_has_forbidden_siblings(&request) {
                Err(SnapbackError::error(
                    "SNAPBACK_BRANCH_REQUEST_INVALID",
                    "storage",
                    "managed branch host operations accept their closed body only under input",
                ))
            } else {
                request
                    .input
                    .clone()
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_HOST_OP_INPUT_MISSING",
                            "host-ops",
                            "managed branch operation requires input",
                        )
                    })
                    .and_then(|value| {
                        serde_json::from_value::<ManagedBranchIdHostInputV1>(value).map_err(|_| {
                            SnapbackError::error(
                                "SNAPBACK_BRANCH_REQUEST_INVALID",
                                "storage",
                                "managed branch input is not the closed v1 carrier",
                            )
                        })
                    })
                    .and_then(|input| {
                        if input.schema_version != 1 {
                            return Err(SnapbackError::error(
                                "SNAPBACK_BRANCH_SCHEMA_VERSION_UNSUPPORTED",
                                "storage",
                                "managed branch operation requires schemaVersion 1",
                            ));
                        }
                        if operation == "branch.inspect.v1" {
                            snapback.inspect_operator_in_app_branch(&input.branch_id, host_now_ms())
                        } else {
                            snapback.drop_operator_in_app_branch(&input.branch_id, host_now_ms())
                        }
                    })
            };
            match outcome {
                Ok(receipt) => envelope(
                    snapback,
                    true,
                    authority_admin("host-ops admin write gate"),
                    json!({ "branch": receipt }),
                    Vec::new(),
                ),
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                ),
            }
        }
        "branch.reap.v1" => {
            let outcome = if managed_branch_wrapper_has_forbidden_siblings(&request) {
                Err(SnapbackError::error(
                    "SNAPBACK_BRANCH_REQUEST_INVALID",
                    "storage",
                    "managed branch host operations accept their closed body only under input",
                ))
            } else {
                request
                    .input
                    .clone()
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_HOST_OP_INPUT_MISSING",
                            "host-ops",
                            "branch.reap.v1 requires input",
                        )
                    })
                    .and_then(|value| {
                        serde_json::from_value::<ManagedBranchListHostInputV1>(value).map_err(
                            |_| {
                                SnapbackError::error(
                                    "SNAPBACK_BRANCH_REQUEST_INVALID",
                                    "storage",
                                    "branch.reap.v1 input is not the closed v1 carrier",
                                )
                            },
                        )
                    })
                    .and_then(|input| {
                        if input.schema_version != 1 {
                            return Err(SnapbackError::error(
                                "SNAPBACK_BRANCH_SCHEMA_VERSION_UNSUPPORTED",
                                "storage",
                                "branch.reap.v1 requires schemaVersion 1",
                            ));
                        }
                        snapback.reap_expired_operator_in_app_branches(host_now_ms())
                    })
            };
            match outcome {
                Ok(branches) => envelope(
                    snapback,
                    true,
                    authority_admin("host-ops admin write gate"),
                    json!({ "branches": branches }),
                    Vec::new(),
                ),
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                ),
            }
        }
        "schema.load" => {
            let Some(schema) = request.schema.clone() else {
                return envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![host_op_diagnostic(
                        "SNAPBACK_HOST_OP_INPUT_MISSING",
                        &operation,
                        "schema.load requires a `schema` manifest in the request body",
                    )],
                );
            };
            match snapback.apply_schema(schema) {
                Ok(diagnostics) => {
                    let ok = !diagnostics.iter().any(|diagnostic| {
                        diagnostic.severity == crate::diagnostic::DiagnosticSeverity::Error
                    });
                    envelope(
                        snapback,
                        ok,
                        authority_admin("host-ops admin write gate"),
                        json!({ "loaded": ok }),
                        diagnostics,
                    )
                }
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                ),
            }
        }
        "functions.load" => {
            let Some(functions) = request.functions.clone() else {
                return envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![host_op_diagnostic(
                        "SNAPBACK_HOST_OP_INPUT_MISSING",
                        &operation,
                        "functions.load requires a `functions` manifest in the request body",
                    )],
                );
            };
            let function_count = functions.functions.len();
            match snapback.load_functions_in_settled_dev(functions) {
                Ok(diagnostics) => {
                    let ok = !diagnostics.iter().any(|diagnostic| {
                        matches!(
                            diagnostic.severity,
                            crate::diagnostic::DiagnosticSeverity::Error
                                | crate::diagnostic::DiagnosticSeverity::Fatal
                        )
                    });
                    envelope(
                        snapback,
                        ok,
                        authority_admin("host-ops admin write gate"),
                        json!({ "loaded": ok, "functionCount": function_count }),
                        diagnostics,
                    )
                }
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    json!({ "loaded": false, "functionCount": function_count }),
                    vec![error.diagnostic],
                ),
            }
        }
        "remediation.apply" => {
            let outcome = request
                .input
                .clone()
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_HOST_OP_INPUT_MISSING",
                        "remediation",
                        "remediation.apply requires its closed v1 carrier under input",
                    )
                })
                .and_then(|value| {
                    serde_json::from_value::<crate::remediation::RemediationApplyInputV1>(value)
                        .map_err(|_| {
                            SnapbackError::error(
                                "SNAPBACK_REMEDIATION_INPUT_INVALID",
                                "remediation",
                                "remediation.apply input is not the closed v1 carrier",
                            )
                        })
                })
                .and_then(|input| {
                    let surfaces = crate::remediation::ServedSurfacesV1 {
                        functions: snapback.served_function_manifest(),
                        schema: snapback.served_schema_manifest(),
                        catalog_digest: crate::control_catalog::catalog_digest(
                            crate::control_catalog::build_catalog(),
                        )
                        .map(str::to_owned),
                        served_host_ops: &SERVED_HOST_OPS,
                        served_routes,
                    };
                    crate::remediation::apply_remediation(&surfaces, input)
                });
            match outcome {
                Ok(applied) => envelope(
                    snapback,
                    true,
                    authority_none(),
                    serde_json::to_value(applied).unwrap_or(Value::Null),
                    Vec::new(),
                ),
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_none(),
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                ),
            }
        }
        "function.run" => run_function(snapback, &request, prepared_authority, envelope),
        "function.explain" => explain_function(snapback, &request, prepared_authority, envelope),
        // The `snapback assets` operator surface (LLP 0044 §Seeds and agent
        // DX): dev-admitted like function.run, admin-write gated at the
        // route, closed input shapes, no byte samples or bearer material in
        // any envelope.
        "asset.put"
        | "asset.ensureSeedFixture"
        | "asset.inspect"
        | "asset.list"
        | "asset.exportCut"
        | "asset.importCut"
        | "asset.retry"
        | "asset.gcSweep"
        | "asset.delete"
        | "asset.rotateSigningKey" => {
            let outcome = snapback.asset_host_op(
                &operation,
                request.input.as_ref(),
                request.user_id.as_deref(),
                profile,
            );
            match outcome {
                Ok(data) => envelope(
                    snapback,
                    true,
                    authority_admin("host-ops admin write gate"),
                    data,
                    Vec::new(),
                ),
                Err(error) => envelope(
                    snapback,
                    false,
                    authority_admin("host-ops admin write gate"),
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                ),
            }
        }
        "auth.mintSession"
        | "auth.rescueCollidingTable"
        | "auth.integrationRetire"
        | "auth.integrationSuspend"
        | "auth.integrationResume" => envelope(
            snapback,
            false,
            authority_none(),
            Value::Object(Default::default()),
            vec![host_op_diagnostic(
                "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
                &operation,
                "the injected auth operator service is unavailable",
            )],
        ),
        cli_only if CLI_ONLY_HOST_OPS.contains(&cli_only) => {
            let message = cli_only_host_op_message(cli_only);
            envelope(
                snapback,
                false,
                authority_none(),
                Value::Object(Default::default()),
                vec![host_op_diagnostic(
                    "SNAPBACK_HOST_OP_CLI_ONLY",
                    &operation,
                    &message,
                )],
            )
        }
        pinned if PINNED_UNBUILT_HOST_OPS.contains(&pinned) => envelope(
            snapback,
            false,
            authority_none(),
            Value::Object(Default::default()),
            vec![host_op_diagnostic(
                "SNAPBACK_HOST_OP_UNIMPLEMENTED",
                &operation,
                "this operation is pinned by LLP 0024 but not built yet (LLP 0032 P6 first slice serves app.inspect, app.reset, schema.load, functions.load, function.run, function.explain)",
            )],
        ),
        _ => envelope(
            snapback,
            false,
            authority_none(),
            Value::Object(Default::default()),
            vec![host_op_diagnostic(
                "SNAPBACK_HOST_OP_UNKNOWN",
                &operation,
                "unknown host operation",
            )],
        ),
    }
}

/// Managed-server `app.inspect` capture. The caller composes the ephemeral
/// block only after releasing Local, then replaces the placeholder serialized
/// by this envelope. Direct in-process host ops keep using [`LocalSnapback::inspect`].
pub fn execute_host_op_inspect_core(
    snapback: &mut LocalSnapback,
    request: &HostOpsRequest,
    server_url: Option<String>,
    profile: crate::contract_types::ServerProfile,
) -> HostOpsResult {
    debug_assert_eq!(request.operation, "app.inspect");
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    if let Some(diagnostic) = operation_profile_diagnostic(
        profile,
        &request.operation,
        operation_profile_requirement(&request.operation, false),
    ) {
        return host_ops_result(
            snapback,
            request_id,
            request.operation.clone(),
            server_url,
            profile,
            false,
            authority_none(),
            Value::Object(Default::default()),
            vec![diagnostic],
        );
    }
    match snapback.inspect_core() {
        Ok(state) => host_ops_result(
            snapback,
            request_id,
            request.operation.clone(),
            server_url,
            profile,
            true,
            authority_none(),
            json!({
                "runtimeState": serde_json::to_value(state)
                    .unwrap_or_else(|_| Value::Object(Default::default()))
            }),
            Vec::new(),
        ),
        Err(error) => host_ops_result(
            snapback,
            request_id,
            request.operation.clone(),
            server_url,
            profile,
            false,
            authority_none(),
            Value::Object(Default::default()),
            vec![error.diagnostic],
        ),
    }
}

fn run_function(
    snapback: &mut LocalSnapback,
    request: &HostOpsRequest,
    prepared_authority: Option<PreparedAuthority>,
    envelope: impl Fn(
        &LocalSnapback,
        bool,
        Option<HostOpsAuthority>,
        Value,
        Vec<Diagnostic>,
    ) -> HostOpsResult,
) -> HostOpsResult {
    let authority = authority_dev_user(request.user_id.as_deref());
    let prepared_authority = match require_host_op_authority(
        prepared_authority,
        InvocationSource::HostOperationFunctionRun,
    ) {
        Ok(authority) => authority,
        Err(error) => {
            return envelope(
                snapback,
                false,
                authority,
                Value::Object(Default::default()),
                vec![error.diagnostic],
            );
        }
    };
    let Some(function) = request.function.clone() else {
        return envelope(
            snapback,
            false,
            authority,
            Value::Object(Default::default()),
            vec![host_op_diagnostic(
                "SNAPBACK_HOST_OP_INPUT_MISSING",
                "function.run",
                "function.run requires a `function` id or name",
            )],
        );
    };
    let Some(definition) = snapback.function_definition(&function) else {
        return envelope(
            snapback,
            false,
            authority,
            Value::Object(Default::default()),
            vec![
                Diagnostic::error(
                    "SNAPBACK_HOST_OP_FUNCTION_UNKNOWN",
                    "host-ops",
                    "the requested function is not in the served function manifest",
                )
                .with_details(
                    crate::authoring_suggestion::unknown_function_details(
                        snapback.served_function_manifest(),
                        &function,
                        &[],
                    ),
                ),
            ],
        );
    };
    let (name, kind) = (definition.name.clone(), definition.kind.clone());
    let declared_reads = snapback.function_declared_read_tables(&name);
    let input = host_op_handler_input(request);
    match kind {
        FunctionKind::Query | FunctionKind::LiveQuery => {
            if let Err(error) =
                snapback.persist_and_validate_prepared_service_authority(&prepared_authority)
            {
                return envelope(
                    snapback,
                    false,
                    authority,
                    Value::Object(Default::default()),
                    vec![error.diagnostic],
                );
            }
            match snapback.invoke_query_with_dependencies_prepared(&name, input, prepared_authority)
            {
                Ok(invocation) => {
                    let rows = invocation.output.rows.len();
                    let mut tables: BTreeSet<String> = declared_reads.into_iter().collect();
                    tables.extend(
                        invocation
                            .read_dependencies
                            .iter()
                            .filter_map(|dependency| dependency.table.clone()),
                    );
                    // D1 report (LLP 0146 surface 1): the query seam holds an
                    // authoritative capture on success.
                    let conformance = snapback.conformance_for_invocation(
                        &name,
                        &invocation.read_dependencies,
                        &[],
                        crate::conformance::DependencyProvenance::Complete,
                        crate::conformance::DependencyProvenance::Complete,
                    );
                    let result = serde_json::to_value(&invocation.output)
                        .unwrap_or_else(|_| Value::Object(Default::default()));
                    let mut response = envelope(
                        snapback,
                        true,
                        authority,
                        json!({ "functionResult": result, "conformance": conformance }),
                        Vec::new(),
                    );
                    response.secret_read_tables = tables.into_iter().collect();
                    response.secret_read_rows = rows;
                    response.secret_read_query = true;
                    response
                }
                Err(error) => {
                    let conformance = snapback.conformance_for_invocation(
                        &name,
                        &[],
                        &[],
                        crate::conformance::DependencyProvenance::Incomplete,
                        crate::conformance::DependencyProvenance::Incomplete,
                    );
                    let mut response = envelope(
                        snapback,
                        false,
                        authority,
                        json!({ "conformance": conformance }),
                        vec![error.diagnostic],
                    );
                    response.secret_read_tables = declared_reads;
                    response.secret_read_query = true;
                    response.secret_read_provenance_complete = false;
                    response
                }
            }
        }
        FunctionKind::Mutation => {
            let (outcome, capture) = snapback.invoke_mutation_with_authority_and_dependencies(
                &name,
                input,
                prepared_authority,
            );
            match outcome {
                Ok(output) => {
                    let commit = serde_json::to_value(&output)
                        .unwrap_or_else(|_| Value::Object(Default::default()));
                    // @ref LLP 0146#d1-declarationobservation-conformance —
                    //   direct host-op execution retains the same exact commit
                    //   capture as the managed server path.
                    let conformance = snapback.conformance_for_invocation(
                        &name,
                        &capture.reads,
                        &capture.writes,
                        capture.read_provenance,
                        capture.write_provenance,
                    );
                    envelope(
                        snapback,
                        true,
                        authority,
                        json!({ "mutationCommit": commit, "conformance": conformance }),
                        Vec::new(),
                    )
                }
                Err(error) => {
                    let conformance = snapback.conformance_for_invocation(
                        &name,
                        &capture.reads,
                        &capture.writes,
                        capture.read_provenance,
                        capture.write_provenance,
                    );
                    envelope(
                        snapback,
                        false,
                        authority,
                        json!({ "conformance": conformance }),
                        vec![error.diagnostic],
                    )
                }
            }
        }
        FunctionKind::Action => envelope(
            snapback,
            false,
            authority,
            Value::Object(Default::default()),
            vec![host_op_diagnostic(
                "SNAPBACK_HOST_OP_FUNCTION_KIND_UNSUPPORTED",
                "function.run",
                "function.run accepts queries and mutations, never actions (LLP 0024)",
            )],
        ),
    }
}

fn change_op_wire(op: &crate::storage::ChangeOp) -> String {
    match op {
        crate::storage::ChangeOp::Insert => "insert".to_owned(),
        crate::storage::ChangeOp::Update => "update".to_owned(),
        crate::storage::ChangeOp::Delete => "delete".to_owned(),
    }
}

fn read_kind_wire(kind: &crate::storage::CapturedReadKind) -> String {
    // Matches CapturedReadKind's own camelCase serde spelling.
    serde_json::to_value(kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".to_owned())
}

fn dry_run_read_wire(dependency: &crate::storage::CapturedReadDependency) -> DryRunRead {
    DryRunRead {
        kind: read_kind_wire(&dependency.kind),
        table: dependency.table.clone(),
        id: dependency.id.clone(),
        version: dependency.version,
        predicate: dependency.predicate.clone(),
        rows: dependency.rows.clone(),
        field: dependency.field.clone(),
        value: dependency.value.clone(),
        order: dependency.order.clone(),
        limit: dependency.limit,
        result_count: dependency.result_count,
        boundary: dependency.boundary.clone(),
    }
}

/// Serve `function.explain` (LLP 0024). The served kind is `mutationDryRun`
/// (LLP 0051 D8 / Increment 4); the other pinned kinds fail closed with a
/// structured envelope, exactly like pinned-unbuilt operations.
fn explain_function(
    snapback: &mut LocalSnapback,
    request: &HostOpsRequest,
    prepared_authority: Option<PreparedAuthority>,
    envelope: impl Fn(
        &LocalSnapback,
        bool,
        Option<HostOpsAuthority>,
        Value,
        Vec<Diagnostic>,
    ) -> HostOpsResult,
) -> HostOpsResult {
    let authority = authority_dev_user(request.user_id.as_deref());
    let Some(kind) = request.kind.clone() else {
        return envelope(
            snapback,
            false,
            authority,
            Value::Object(Default::default()),
            vec![host_op_diagnostic(
                "SNAPBACK_HOST_OP_INPUT_MISSING",
                "function.explain",
                "function.explain requires a `kind` (LLP 0024 v0 kinds: queryPlan, permissionAllow, permissionDeny, capabilityGap, mutationDryRun)",
            )],
        );
    };
    if kind != "mutationDryRun" {
        let recognized = EXPLAIN_KINDS.contains(&kind.as_str());
        let (code, message) = if recognized {
            (
                "SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED",
                "the requested explain kind is pinned by LLP 0024 but not built yet (mutationDryRun is served)",
            )
        } else {
            (
                "SNAPBACK_EXPLAIN_KIND_UNKNOWN",
                "the requested explain kind is unknown",
            )
        };
        let diagnostic_kind = if recognized {
            kind.as_str()
        } else {
            "unrecognized"
        };
        return envelope(
            snapback,
            false,
            authority,
            Value::Object(Default::default()),
            vec![
                Diagnostic::error(code, "host-ops", message).with_details(
                    json!({ "operation": "function.explain", "kind": diagnostic_kind }),
                ),
            ],
        );
    }
    let prepared_authority = match require_host_op_authority(
        prepared_authority,
        InvocationSource::HostOperationMutationDryRun,
    ) {
        Ok(authority) => authority,
        Err(error) => {
            return envelope(
                snapback,
                false,
                authority,
                Value::Object(Default::default()),
                vec![error.diagnostic],
            );
        }
    };
    let Some(function) = request.function.clone() else {
        return envelope(
            snapback,
            false,
            authority,
            Value::Object(Default::default()),
            vec![host_op_diagnostic(
                "SNAPBACK_HOST_OP_INPUT_MISSING",
                "function.explain",
                "function.explain requires a `function` id or name",
            )],
        );
    };
    let input = host_op_handler_input(request);
    let declared_secret_reads = snapback.function_declared_read_tables(&function);
    match snapback.dry_run_mutation_with_authority(&function, input, prepared_authority) {
        Ok(outcome) => {
            let secret_read_provenance_complete = outcome.failure.is_none();
            let secret_read_rows = outcome
                .read_dependencies
                .iter()
                .map(|dependency| dependency.rows.len())
                .sum::<usize>()
                .saturating_add(outcome.changes.len());
            let mut secret_read_tables: BTreeSet<String> =
                declared_secret_reads.into_iter().collect();
            secret_read_tables.extend(
                outcome
                    .read_dependencies
                    .iter()
                    .filter_map(|dependency| dependency.table.clone()),
            );
            secret_read_tables.extend(outcome.changes.iter().map(|change| change.table.clone()));
            let mut diagnostics = outcome.diagnostics;
            let denial_reason = if outcome.denied {
                outcome.failure.clone()
            } else {
                None
            };
            if let Some(failure) = outcome.failure
                && !outcome.denied
            {
                diagnostics.push(failure);
            }
            let report = DryRunReport {
                kind: "mutationDryRun".to_owned(),
                function: function.clone(),
                tier: outcome.tier.to_owned(),
                would_commit: outcome.would_commit,
                denied: outcome.denied,
                denial_reason,
                predicted_writes: outcome
                    .changes
                    .iter()
                    .map(|change| DryRunWriteSummary {
                        table: change.table.clone(),
                        id: change.id.clone(),
                        op: change_op_wire(&change.op),
                        changed_fields: change.changed_fields.clone(),
                    })
                    .collect(),
                write_set: outcome
                    .changes
                    .iter()
                    .map(|change| DryRunWrite {
                        table: change.table.clone(),
                        id: change.id.clone(),
                        op: change_op_wire(&change.op),
                        row: change.row.clone(),
                    })
                    .collect(),
                read_set: outcome
                    .read_dependencies
                    .iter()
                    .map(dry_run_read_wire)
                    .collect(),
                read_set_validation: outcome.read_set_validation.to_owned(),
                deterministic_inputs: outcome.ledger,
                side_effects: Vec::new(),
                result: outcome.result,
                snapshot_version: outcome.snapshot_version,
                diagnostics,
            };
            let data = json!({
                "dryRun": serde_json::to_value(&report)
                    .unwrap_or_else(|_| Value::Object(Default::default())),
            });
            let mut result = envelope(snapback, true, authority, data, Vec::new());
            result.secret_read_tables = secret_read_tables.into_iter().collect();
            result.secret_read_rows = secret_read_rows;
            result.secret_read_provenance_complete = secret_read_provenance_complete;
            if report.would_commit {
                // propose → simulate → inspect writes → commit (LLP 0051 D8).
                result.next.push(json!({
                    "operation": "function.run",
                    "function": function,
                    "reason": "dry-run predicts this mutation would commit",
                }));
            }
            result
        }
        Err(error) => {
            let mut result = envelope(
                snapback,
                false,
                authority,
                Value::Object(Default::default()),
                vec![error.diagnostic],
            );
            result.secret_read_tables = declared_secret_reads;
            result.secret_read_provenance_complete = false;
            result
        }
    }
}

pub fn host_op_diagnostic(code: &str, operation: &str, message: &str) -> Diagnostic {
    if code == "SNAPBACK_HOST_OP_UNKNOWN" {
        let operations = SERVED_HOST_OPS.to_vec();
        return Diagnostic::error(code, "host-ops", message).with_details(
            crate::authoring_suggestion::unknown_operation_details(
                operation,
                &operations,
                crate::control_catalog::catalog_digest(crate::control_catalog::build_catalog()),
            ),
        );
    }
    let operation = if SERVED_HOST_OPS.contains(&operation)
        || CLI_ONLY_HOST_OPS.contains(&operation)
        || PINNED_UNBUILT_HOST_OPS.contains(&operation)
    {
        operation
    } else {
        "unrecognized"
    };
    Diagnostic::error(code, "host-ops", message).with_details(json!({ "operation": operation }))
}

fn cli_only_host_op_command(operation: &str) -> String {
    crate::control_catalog::cli_projection(operation)
        .map(str::to_owned)
        .unwrap_or_else(|| match operation {
            "host.restart" => "snapback restart --ready-file <path>".to_owned(),
            other => format!("snapback {}", other.strip_prefix("host.").unwrap_or(other)),
        })
}

fn cli_only_host_op_message(operation: &str) -> String {
    let command = cli_only_host_op_command(operation);
    if operation == "host.wait" {
        return format!(
            "this operation coordinates a trusted local ready file and its owner-only receipt; use `{command}`"
        );
    }
    format!(
        "this operation manages the host process; a running server cannot perform it over its own HTTP surface. Use `{command}`"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback_services::test_support::rusqlite;

    #[test]
    fn cli_only_refusals_name_the_catalog_cli_projection() {
        for operation in CLI_ONLY_HOST_OPS {
            let catalog_command = crate::control_catalog::cli_projection(operation)
                .unwrap_or_else(|| panic!("{operation} must have a catalog CLI projection"));
            assert_eq!(cli_only_host_op_command(operation), catalog_command);

            let message = cli_only_host_op_message(operation);
            assert!(message.contains(catalog_command));
        }

        for entry in crate::control_catalog::build_catalog()["entries"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|entry| entry["domain"] == "hostOps")
            .filter(|entry| entry["status"] == "shipped")
            .filter(|entry| matches!(entry["surfaceAccess"].as_str(), Some("native" | "cliOnly")))
        {
            assert!(
                entry
                    .pointer("/projections/cli")
                    .is_some_and(Value::is_string),
                "{} is a shipped CLI-reachable host op without projections.cli",
                entry["operation"]
            );
        }
    }

    #[test]
    fn recent_invocation_ring_is_bounded_and_most_recent_first() {
        let ring = RecentInvocationRing::default();
        for index in 0..(RECENT_INVOCATIONS_CAPACITY + 3) {
            ring.record(RecentInvocationEntry {
                operation: "function.run".to_owned(),
                function_id: Some(format!("app:fn{index}")),
                outcome: "ok".to_owned(),
                started_at: iso8601_utc_ms(index as u64),
                duration_ms: 1,
                diagnostics: Vec::new(),
                conformance: None,
            });
        }
        let snapshot = ring.snapshot();
        assert_eq!(snapshot.len(), RECENT_INVOCATIONS_CAPACITY);
        // Most recent first; the three oldest entries were evicted.
        assert_eq!(
            snapshot[0].function_id.as_deref(),
            Some(format!("app:fn{}", RECENT_INVOCATIONS_CAPACITY + 2).as_str())
        );
        assert_eq!(
            snapshot[RECENT_INVOCATIONS_CAPACITY - 1]
                .function_id
                .as_deref(),
            Some("app:fn3")
        );
    }

    #[test]
    fn recent_invocation_outcome_prefers_the_failing_diagnostic_code() {
        let snapback = LocalSnapback::memory().expect("memory outcome fixture");
        let ok = host_ops_result(
            &snapback,
            "outcome-ok".to_owned(),
            "function.run".to_owned(),
            None,
            ServerProfile::Test,
            true,
            authority_none(),
            Value::Object(Default::default()),
            Vec::new(),
        );
        assert_eq!(recent_invocation_outcome(&ok), "ok");
        let failed = host_ops_result(
            &snapback,
            "outcome-failed".to_owned(),
            "function.run".to_owned(),
            None,
            ServerProfile::Test,
            false,
            authority_none(),
            Value::Object(Default::default()),
            vec![
                Diagnostic::warning("SNAPBACK_SOFT_NOTE", "host-ops", "not the outcome"),
                Diagnostic::error("SNAPBACK_HANDLER_FAILED", "host-ops", "the outcome"),
            ],
        );
        assert_eq!(
            recent_invocation_outcome(&failed),
            "SNAPBACK_HANDLER_FAILED"
        );
    }

    #[test]
    fn iso8601_utc_ms_formats_civil_time() {
        assert_eq!(iso8601_utc_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            iso8601_utc_ms(1_767_225_600_123),
            "2026-01-01T00:00:00.123Z"
        );
    }

    #[test]
    fn host_ops_envelope_reports_a_corrupt_durable_version_without_a_cursor() {
        let dir = tempfile::tempdir().expect("host-ops tempdir");
        let path = dir.path().join("corrupt-version.sqlite3");
        let snapback = LocalSnapback::open(&path).expect("file-backed host-op fixture");
        let raw = rusqlite::Connection::open(&path).expect("open corruption fixture");
        raw.execute(
            "UPDATE _snapback_version SET version = ?1 WHERE id = 1",
            rusqlite::params![rusqlite::types::Value::Real(1.5)],
        )
        .expect("install malformed durable version");
        drop(raw);

        let result = host_ops_result(
            &snapback,
            "corrupt-version".to_owned(),
            "app.inspect".to_owned(),
            None,
            ServerProfile::Test,
            true,
            authority_none(),
            Value::Object(Default::default()),
            Vec::new(),
        );
        assert!(!result.ok);
        assert_eq!(result.artifacts.database_version, None);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| { diagnostic.code == "SNAPBACK_STORAGE_VERSION_CORRUPT" })
        );

        let raw = telemetry_query_result(
            &snapback,
            &HostOpsRequest {
                operation: "telemetry.events".to_owned(),
                ..HostOpsRequest::default()
            },
            None,
            ServerProfile::Test,
            Ok(json!({ "events": [{ "name": "RAW_SENTINEL" }] })),
        );
        assert!(!raw.ok);
        assert_eq!(raw.data, Value::Object(Default::default()));
        assert_eq!(
            raw.authority
                .as_ref()
                .map(|authority| authority.mode.as_str()),
            Some("adminSecretRead")
        );
        assert_eq!(
            raw.authority
                .as_ref()
                .and_then(|authority| authority.scope.as_deref()),
            Some("telemetry.events")
        );
        assert!(
            !serde_json::to_string(&raw)
                .unwrap()
                .contains("RAW_SENTINEL")
        );
    }

    #[test]
    fn host_op_rejects_managed_authority_from_a_different_source_before_lookup() {
        let mut snapback = LocalSnapback::memory().expect("memory host-op fixture");
        let request = HostOpsRequest {
            operation: "function.run".to_owned(),
            function: Some("missing".to_owned()),
            ..HostOpsRequest::default()
        };
        let input = host_op_handler_input(&request);
        let wrong = snapback
            .prepare_legacy_dev_authority(InvocationSource::LocalQuery, ServerProfile::Dev, &input)
            .expect("managed but wrong-source authority");
        let result = execute_host_op_with_profile_and_authority(
            &mut snapback,
            request,
            None,
            ServerProfile::Dev,
            Some(wrong),
            Vec::new(),
        );
        assert_eq!(
            result.diagnostics[0].code,
            "SNAPBACK_INVOCATION_SOURCE_INVALID"
        );
    }

    #[test]
    fn in_process_functions_load_refuses_settled_sessions_without_coordinator() {
        let mut snapback = LocalSnapback::memory().expect("memory host-op fixture");
        let digest = |prefix: &str, byte: char| format!("{prefix}{}", byte.to_string().repeat(64));
        let deployment = crate::auth::mode::DeploymentIdentity {
            schema_version: crate::manifest::SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
            auth_mode: crate::manifest::AuthMode::Sessions,
            app_id: "host-op-sessions".to_owned(),
            schema_hash: digest(crate::auth::mode::SCHEMA_V1_PREFIX, '1'),
            bundle_hash: digest(crate::auth::mode::FUNCTION_V1_PREFIX, '2'),
            inputs_hash: digest(crate::auth::mode::INPUTS_V1_PREFIX, '3'),
        };
        let schema = SchemaManifest {
            schema_version: crate::manifest::SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
            app_id: "host-op-sessions".to_owned(),
            auth: Some(crate::manifest::AuthManifest {
                mode: crate::manifest::AuthMode::Sessions,
                agents: None,
                password_identifier_mode: None,
                password_minimum_length: None,
            }),
            required_capabilities: vec![
                crate::manifest::TargetCapabilityId::AuthSessionsV1.to_string(),
            ],
            schema_hash: Some(deployment.schema_hash.clone()),
            inputs_hash: Some(deployment.inputs_hash.clone()),
            ..SchemaManifest::default()
        };
        snapback
            .auth_database_mut()
            .stage_auth_mode(deployment, schema, None)
            .expect("stage sessions fixture");
        let readiness =
            crate::auth::mode::AuthProgramReadiness::new(true, true, true, true, true, true, true);
        let settled = snapback
            .auth_database_mut()
            .consume_sessions_auth_mode(&readiness)
            .expect("consume sessions fixture");
        snapback
            .synchronize_auth_mode_admission(&settled)
            .expect("publish sessions admission");

        let bypass = crate::manifest::FunctionDefinition::new(
            "rawBypass",
            FunctionKind::Query,
            crate::manifest::FunctionRuntime::HostPlan(crate::manifest::HandlerPlan::Query(
                crate::manifest::QueryPlan {
                    table_visibility: None,
                    table: "missing".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                },
            )),
        );
        let result = execute_host_op(
            &mut snapback,
            HostOpsRequest {
                operation: "functions.load".to_owned(),
                functions: Some(FunctionManifest {
                    functions: vec![bypass],
                    ..FunctionManifest::default()
                }),
                ..HostOpsRequest::default()
            },
            None,
        );
        assert!(!result.ok);
        assert_eq!(
            result.diagnostics[0].code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        assert_eq!(snapback.function_kind("rawBypass"), None);
    }

    #[test]
    fn in_process_dev_functions_load_refuses_closed_precommit_transition() {
        let mut snapback = LocalSnapback::memory().expect("memory host-op fixture");
        let transition = snapback
            .begin_auth_mode_transition()
            .expect("close dev admission before its durable cut");
        let bypass = crate::manifest::FunctionDefinition::new(
            "closedBypass",
            FunctionKind::Query,
            crate::manifest::FunctionRuntime::HostPlan(crate::manifest::HandlerPlan::Query(
                crate::manifest::QueryPlan {
                    table_visibility: None,
                    table: "missing".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                },
            )),
        );
        let result = execute_host_op(
            &mut snapback,
            HostOpsRequest {
                operation: "functions.load".to_owned(),
                functions: Some(FunctionManifest {
                    functions: vec![bypass],
                    ..FunctionManifest::default()
                }),
                ..HostOpsRequest::default()
            },
            None,
        );
        assert!(!result.ok);
        assert_eq!(result.diagnostics[0].code, "SNAPBACK_AUTH_MODE_PENDING");
        assert_eq!(snapback.function_kind("closedBypass"), None);
        drop(transition);
    }

    #[test]
    fn host_ops_debug_redacts_auth_inputs_and_credential_data() {
        const EMAIL_SENTINEL: &str = "debug-email-sentinel@example.com";
        const TOKEN_SENTINEL: &str = "sbs_DEBUG_CREDENTIAL_SENTINEL";

        let request: HostOpsRequest = serde_json::from_value(json!({
            "operation": TOKEN_SENTINEL,
            "requestId": EMAIL_SENTINEL,
            "function": TOKEN_SENTINEL,
            "args": { "email": EMAIL_SENTINEL },
            "userId": TOKEN_SENTINEL,
            "kind": EMAIL_SENTINEL,
        }))
        .expect("parse auth host operation");
        let request_debug = format!("{request:?}");
        assert!(!request_debug.contains(EMAIL_SENTINEL), "{request_debug}");
        assert!(!request_debug.contains(TOKEN_SENTINEL), "{request_debug}");
        assert!(request_debug.contains("[REDACTED]"), "{request_debug}");

        let snapback = LocalSnapback::memory().expect("memory host-ops debug fixture");
        let result = auth_operator_result(
            &snapback,
            &request,
            None,
            crate::contract_types::ServerProfile::Test,
            Ok(json!({
                "tokenType": "Bearer",
                "token": TOKEN_SENTINEL,
            })),
        );
        let result_debug = format!("{result:?}");
        assert!(!result_debug.contains(TOKEN_SENTINEL), "{result_debug}");
        assert!(!result_debug.contains(EMAIL_SENTINEL), "{result_debug}");
        assert!(result_debug.contains("[REDACTED]"), "{result_debug}");
    }

    #[test]
    fn rehearsal_exercise_envelope_never_claims_admin_bypass() {
        let snapback = LocalSnapback::memory().expect("rehearsal authority fixture");
        let result = auth_operator_result(
            &snapback,
            &HostOpsRequest {
                operation: "auth.rehearsal.exercise".to_owned(),
                ..HostOpsRequest::default()
            },
            None,
            crate::contract_types::ServerProfile::Test,
            Ok(json!({})),
        );
        let authority = result.authority.expect("rehearsal authority envelope");
        assert_eq!(authority.mode, "authRehearsalGrant");
        assert!(!authority.admin_bypass);
        assert_eq!(authority.scope.as_deref(), Some("finiteGrant"));
    }

    #[test]
    fn host_ops_args_reject_duplicate_auth_fields_before_value_projection() {
        let error = serde_json::from_str::<HostOpsRequest>(
            r#"{"operation":"auth.mintSession","args":{"email":"first@example.com","email":"second@example.com"}}"#,
        )
        .expect_err("duplicate auth args must not collapse into a Value");
        assert!(
            error.to_string().contains("duplicate field `email`"),
            "{error}"
        );
    }

    #[test]
    fn unknown_operation_diagnostic_does_not_echo_caller_bytes() {
        const SENTINEL: &str = "sbs_DIAGNOSTIC_SMUGGLING_SENTINEL";
        let diagnostic = host_op_diagnostic("SNAPBACK_HOST_OP_UNKNOWN", SENTINEL, "unknown");
        let serialized = serde_json::to_string(&diagnostic).unwrap();
        assert!(!serialized.contains(SENTINEL), "{serialized}");
        assert_eq!(diagnostic.details["operation"], "unrecognized");
    }

    #[test]
    fn unknown_function_and_explain_kind_diagnostics_do_not_echo_caller_bytes() {
        const SENTINEL: &str = "sbs_SELECTOR_SMUGGLING_SENTINEL";
        let mut snapback = LocalSnapback::memory().expect("memory diagnostic fixture");

        for request in [
            HostOpsRequest {
                operation: "function.run".to_owned(),
                function: Some(SENTINEL.to_owned()),
                ..HostOpsRequest::default()
            },
            HostOpsRequest {
                operation: "function.explain".to_owned(),
                kind: Some(SENTINEL.to_owned()),
                ..HostOpsRequest::default()
            },
        ] {
            let result = execute_host_op(&mut snapback, request, None);
            let serialized = serde_json::to_string(&result.diagnostics).unwrap();
            assert!(!serialized.contains(SENTINEL), "{serialized}");
        }
    }

    #[test]
    fn managed_branch_host_ops_are_closed_and_reachable_end_to_end() {
        let directory = tempfile::tempdir().expect("branch host-op tempdir");
        let path = directory.path().join("app.sqlite3");
        let mut snapback = LocalSnapback::open(&path).expect("file-backed branch host-op");
        let schema = SchemaManifest {
            app_id: "branch-host-app".to_owned(),
            schema_hash: Some(format!("sha256:{}", "a".repeat(64))),
            ..SchemaManifest::default()
        };
        assert!(
            snapback
                .apply_schema(schema)
                .expect("load schema")
                .iter()
                .all(|diagnostic| diagnostic.severity
                    != crate::diagnostic::DiagnosticSeverity::Error)
        );
        let action = crate::manifest::FunctionDefinition::new(
            "safeAction",
            FunctionKind::Action,
            crate::manifest::FunctionRuntime::HostPlan(crate::manifest::HandlerPlan::Action(
                crate::manifest::ActionPlan {
                    steps: Vec::new(),
                    return_value: None,
                },
            )),
        );
        let functions = FunctionManifest {
            app_id: "branch-host-app".to_owned(),
            bundle_hash: Some(format!("sha256:{}", "b".repeat(64))),
            functions: vec![action],
            ..FunctionManifest::default()
        };
        assert!(
            snapback
                .load_functions(functions)
                .iter()
                .all(|diagnostic| diagnostic.severity
                    != crate::diagnostic::DiagnosticSeverity::Error)
        );
        snapback
            .initialize_data_version_stream_for_test()
            .expect("initialize canonical stream for direct host-op fixture");

        let create = execute_host_op(
            &mut snapback,
            serde_json::from_value(json!({
                "operation": "branch.create.v1",
                "input": {
                    "schemaVersion": 1,
                    "allowedFunctions": ["safeAction"],
                    "ttlMs": 60_000
                }
            }))
            .expect("closed create request"),
            None,
        );
        assert!(create.ok, "{:?}", create.diagnostics);
        let branch_id = create.data["branch"]["branch"]["branch"]["branch_id"]
            .as_str()
            .expect("server-minted branch id")
            .to_owned();
        assert!(branch_id.starts_with("branch-v1:"));
        assert_eq!(
            create.data["branch"]["branch"]["grant"]["allowedFunctions"],
            json!(["safeAction"])
        );

        let list = execute_host_op(
            &mut snapback,
            serde_json::from_value(json!({
                "operation": "branch.list.v1",
                "input": { "schemaVersion": 1 }
            }))
            .unwrap(),
            None,
        );
        assert!(list.ok, "{:?}", list.diagnostics);
        assert_eq!(list.data["branches"].as_array().unwrap().len(), 1);

        let reap = execute_host_op(
            &mut snapback,
            serde_json::from_value(json!({
                "operation": "branch.reap.v1",
                "input": { "schemaVersion": 1 }
            }))
            .unwrap(),
            None,
        );
        assert!(reap.ok, "{:?}", reap.diagnostics);
        assert!(reap.data["branches"].as_array().unwrap().is_empty());

        let inspect = execute_host_op(
            &mut snapback,
            serde_json::from_value(json!({
                "operation": "branch.inspect.v1",
                "input": { "schemaVersion": 1, "branchId": branch_id }
            }))
            .unwrap(),
            None,
        );
        assert!(inspect.ok, "{:?}", inspect.diagnostics);

        let drop_result = execute_host_op(
            &mut snapback,
            serde_json::from_value(json!({
                "operation": "branch.drop.v1",
                "input": { "schemaVersion": 1, "branchId": branch_id }
            }))
            .unwrap(),
            None,
        );
        assert!(drop_result.ok, "{:?}", drop_result.diagnostics);
        assert_eq!(drop_result.data["branch"]["custodyState"], json!("dropped"));

        let unknown = execute_host_op(
            &mut snapback,
            serde_json::from_value(json!({
                "operation": "branch.create.v1",
                "input": {
                    "schemaVersion": 1,
                    "allowedFunctions": ["safeAction"],
                    "ttlMs": 60_000,
                    "workspacePath": "/tmp/caller-chosen"
                }
            }))
            .unwrap(),
            None,
        );
        assert!(!unknown.ok);
        assert_eq!(
            unknown.diagnostics[0].code,
            "SNAPBACK_BRANCH_REQUEST_INVALID"
        );
    }
}
/// Environment half of an operation's authority tuple. Every transport and
/// alias asks this same policy before invoking the operation core.
///
/// @ref LLP 0024#authority-tuple — dev-user impersonation and destructive
/// operations are profile-bounded capabilities regardless of transport;
/// collision rescue is narrower than the ordinary non-production set.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationProfileRequirement {
    Any,
    NonProd,
    DevOrTest,
}

/// One operation policy table shared by dedicated routes and multiplexed
/// host-ops. `has_dev_user` means the caller selected an app identity rather
/// than presenting hosted app authentication.
pub fn operation_profile_requirement(
    operation: &str,
    has_dev_user: bool,
) -> OperationProfileRequirement {
    match operation {
        // Operational readiness is an authenticated control-plane fact with
        // the same all-profile inspection posture as app.inspect. The active
        // network profile is recorded by the evaluator, never used as a gate.
        "app.inspect" | "app.readiness.v1" => OperationProfileRequirement::Any,
        // @ref LLP 0167#authority-one-activation-chokepoint — reads are
        // available in every profile and writes must reach the network-profile
        // activation gate so its finer hosted/Prod policy and refusal codes
        // remain authoritative. Do not preempt that gate with NonProd here.
        "debug.networkProfileGet" | "debug.networkProfileSet" => OperationProfileRequirement::Any,
        // The dedicated data-patch target classifier owns the stricter
        // local/non-production/primary-instance rule and its availability
        // refusal diagnostic.
        "data.patch.preview" | "data.patch.apply" => OperationProfileRequirement::Any,
        "app.reset"
        | "app.ensure.provision"
        | "app.seed.ensure.v1"
        | "app.seed.preview.v1"
        | "app.seed.reset-install.v1"
        | "app.seed.clear.v1"
        | "schema.load"
        | "functions.load" => OperationProfileRequirement::NonProd,
        // The direct and multiplexed runners are developer/operator bypass
        // surfaces even when they project an anonymous handler input. Hosted
        // production invocation goes through the ordinary app-data gate.
        "function.run" | "auth.mintSession" => OperationProfileRequirement::NonProd,
        // The asset operator surface is developer/operator tooling like the
        // direct runner; hosted production traffic uses the ordinary asset
        // routes.
        "asset.put"
        | "asset.ensureSeedFixture"
        | "asset.inspect"
        | "asset.list"
        | "asset.retry"
        | "asset.delete" => OperationProfileRequirement::NonProd,
        // Frozen LLP 0039 deliberately excludes demo from the below-manifest
        // collision-recovery authority, on both ordinary and recovery servers.
        "auth.rescueCollidingTable" => OperationProfileRequirement::DevOrTest,
        "function.explain" if has_dev_user => OperationProfileRequirement::NonProd,
        _ => OperationProfileRequirement::Any,
    }
}

pub fn operation_profile_diagnostic(
    profile: crate::contract_types::ServerProfile,
    operation: &str,
    requirement: OperationProfileRequirement,
) -> Option<crate::diagnostic::Diagnostic> {
    let allowed = match requirement {
        OperationProfileRequirement::Any => true,
        OperationProfileRequirement::NonProd => profile.allows_provisioning(),
        OperationProfileRequirement::DevOrTest => matches!(
            profile,
            crate::contract_types::ServerProfile::Dev | crate::contract_types::ServerProfile::Test
        ),
    };
    if allowed {
        return None;
    }
    let allowed_profiles = match requirement {
        OperationProfileRequirement::Any => unreachable!("allowed requirements returned above"),
        OperationProfileRequirement::NonProd => "dev|demo|test",
        OperationProfileRequirement::DevOrTest => "dev|test",
    };
    Some(crate::diagnostic::Diagnostic::error(
        "SNAPBACK_PROFILE_FORBIDS",
        "admin",
        format!(
            "{operation} is not available under the '{}' profile; set SNAPBACK_PROFILE={allowed_profiles} to enable it",
            profile.as_str(),
        ),
    ))
}
