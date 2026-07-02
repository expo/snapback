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

use crate::diagnostic::Diagnostic;
use crate::local::LocalSnapback;
use crate::manifest::{
    FunctionKind, FunctionManifest, HandlerInput, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
    SeedData, TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

pub const HOST_OPS_RESULT_KIND: &str = "hostOpsResult";
pub const HOST_READY_DESCRIPTOR_KIND: &str = "snapbackHostReady";

/// Operations this endpoint serves in the first slice.
pub const SERVED_HOST_OPS: [&str; 5] = [
    "app.inspect",
    "app.reset",
    "schema.load",
    "functions.load",
    "function.run",
];

/// Pinned by LLP 0024 but process-lifecycle verbs: the CLI owns them (a
/// running server cannot start itself over its own HTTP surface).
pub const CLI_ONLY_HOST_OPS: [&str; 3] = ["host.start", "host.stop", "host.restart"];

/// Pinned by LLP 0024, not yet built anywhere. Requests return a structured
/// `SNAPBACK_HOST_OP_UNIMPLEMENTED` envelope so aspiration cannot be mistaken
/// for API (the LLP 0032 R4 banner rule, enforced at runtime).
pub const PINNED_UNBUILT_HOST_OPS: [&str; 4] = [
    "schema.reload",
    "functions.reload",
    "function.explain",
    "acceptance.run",
];

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct HostOpsResult {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "resultKind")]
    pub result_kind: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub operation: String,
    pub ok: bool,
    pub target: HostOpsTarget,
    pub authority: Option<HostOpsAuthority>,
    pub artifacts: HostOpsArtifacts,
    pub data: Value,
    pub diagnostics: Vec<Diagnostic>,
    pub next: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct HostOpsTarget {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "appRoot")]
    pub app_root: Option<String>,
    #[serde(rename = "targetProfile")]
    pub target_profile: String,
    #[serde(rename = "serverUrl")]
    pub server_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct HostOpsAuthority {
    pub mode: String,
    #[serde(rename = "actorPrincipal")]
    pub actor_principal: Option<String>,
    #[serde(rename = "effectivePrincipal")]
    pub effective_principal: Option<Value>,
    #[serde(rename = "localDevOnly")]
    pub local_dev_only: bool,
    #[serde(rename = "adminBypass")]
    pub admin_bypass: bool,
    pub scope: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, schemars::JsonSchema)]
pub struct HostOpsArtifacts {
    #[serde(rename = "schemaHash")]
    pub schema_hash: Option<String>,
    #[serde(rename = "bundleHash")]
    pub bundle_hash: Option<String>,
    #[serde(rename = "databaseVersion")]
    pub database_version: Option<u64>,
}

/// The readiness descriptor `snapback start --ready-file <path>` writes once
/// the listener is bound — the LLP 0030 attach/managed handshake (out-of-band
/// so `cargo run` launcher noise on stdout cannot corrupt it).
#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct HostReadyDescriptor {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "descriptorKind")]
    pub descriptor_kind: String,
    #[serde(rename = "startupId")]
    pub startup_id: String,
    pub ready: bool,
    #[serde(rename = "serverUrl")]
    pub server_url: String,
    pub host: String,
    pub port: u16,
    pub pid: u32,
    pub target: HostOpsTarget,
    pub database: HostReadyDatabase,
    #[serde(rename = "startedAtMs")]
    pub started_at_ms: u64,
    #[serde(rename = "adminGated")]
    pub admin_gated: bool,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct HostReadyDatabase {
    pub mode: String,
    pub path: Option<String>,
}

impl HostReadyDescriptor {
    /// Attach-side validation (LLP 0030 §attach): a plugin/CLI must refuse to
    /// treat a file as a Snapback readiness descriptor unless these facts
    /// hold. Returns the structured reasons instead of a bare boolean.
    pub fn validate(value: &Value) -> Result<HostReadyDescriptor, Vec<String>> {
        let mut problems = Vec::new();
        let descriptor: HostReadyDescriptor = match serde_json::from_value(value.clone()) {
            Ok(descriptor) => descriptor,
            Err(error) => return Err(vec![format!("not a readiness descriptor: {error}")]),
        };
        if descriptor.descriptor_kind != HOST_READY_DESCRIPTOR_KIND {
            problems.push(format!(
                "descriptorKind {} is not {HOST_READY_DESCRIPTOR_KIND}",
                descriptor.descriptor_kind
            ));
        }
        if descriptor.schema_version != SNAPBACK_SCHEMA_VERSION {
            problems.push(format!(
                "schemaVersion {} is not {SNAPBACK_SCHEMA_VERSION}",
                descriptor.schema_version
            ));
        }
        if !descriptor.ready {
            problems.push("descriptor is not ready".to_owned());
        }
        if descriptor.pid == 0 {
            problems.push("descriptor has no process id".to_owned());
        }
        if problems.is_empty() {
            Ok(descriptor)
        } else {
            Err(problems)
        }
    }
}

/// One host-ops request. Operation-specific fields are optional and validated
/// per operation; unknown operations fail closed with an envelope.
#[derive(Clone, Debug, Default, Deserialize)]
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
    #[serde(default)]
    pub function: Option<String>,
    #[serde(default)]
    pub args: Option<Value>,
    #[serde(default, rename = "userId")]
    pub user_id: Option<String>,
}

pub fn new_request_id() -> String {
    format!("hop_{}", Uuid::now_v7().simple())
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

/// Execute one served host operation against the local instance and produce
/// the envelope. The HTTP handler and (through HTTP) the CLI both come here,
/// so the projections cannot drift.
pub fn execute_host_op(
    snapback: &mut LocalSnapback,
    request: HostOpsRequest,
    server_url: Option<String>,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();

    let target = |snapback: &LocalSnapback| HostOpsTarget {
        app_id: snapback.loaded_app_id(),
        app_root: None,
        target_profile: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
        server_url: server_url.clone(),
    };
    let artifacts = |snapback: &LocalSnapback| HostOpsArtifacts {
        schema_hash: snapback.loaded_schema_hash(),
        bundle_hash: snapback.loaded_bundle_hash(),
        database_version: snapback.durable_version(),
    };
    let envelope = |snapback: &LocalSnapback,
                    ok: bool,
                    authority: Option<HostOpsAuthority>,
                    data: Value,
                    diagnostics: Vec<Diagnostic>| HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id: request_id.clone(),
        operation: operation.clone(),
        ok,
        target: target(snapback),
        authority,
        artifacts: artifacts(snapback),
        data,
        diagnostics,
        next: Vec::new(),
    };

    match operation.as_str() {
        "app.inspect" => match snapback.inspect() {
            Ok(state) => {
                let runtime_state =
                    serde_json::to_value(&state).unwrap_or_else(|_| Value::Object(Default::default()));
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
            let seed = request.seed.clone();
            match snapback.reset() {
                Ok(()) => {
                    let mut data = serde_json::Map::new();
                    data.insert("resetScope".to_owned(), json!("app"));
                    let mut diagnostics = Vec::new();
                    let mut ok = true;
                    let mut seeded = false;
                    if let Some(seed) = seed {
                        match snapback.seed(seed) {
                            Ok(_) => seeded = true,
                            Err(error) => {
                                ok = false;
                                diagnostics.push(error.diagnostic);
                            }
                        }
                    }
                    data.insert("seeded".to_owned(), json!(seeded));
                    data.insert(
                        "databaseVersion".to_owned(),
                        json!(snapback.durable_version()),
                    );
                    envelope(
                        snapback,
                        ok,
                        authority_admin("host-ops admin write gate"),
                        Value::Object(data),
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
                    let ok = !diagnostics
                        .iter()
                        .any(|diagnostic| diagnostic.severity == crate::diagnostic::DiagnosticSeverity::Error);
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
            let diagnostics = snapback.load_functions(functions);
            let ok = !diagnostics
                .iter()
                .any(|diagnostic| diagnostic.severity == crate::diagnostic::DiagnosticSeverity::Error);
            envelope(
                snapback,
                ok,
                authority_admin("host-ops admin write gate"),
                json!({ "loaded": ok, "functionCount": function_count }),
                diagnostics,
            )
        }
        "function.run" => run_function(snapback, &request, envelope),
        cli_only if CLI_ONLY_HOST_OPS.contains(&cli_only) => envelope(
            snapback,
            false,
            authority_none(),
            Value::Object(Default::default()),
            vec![host_op_diagnostic(
                "SNAPBACK_HOST_OP_CLI_ONLY",
                &operation,
                "this operation manages the host process; use the snapback CLI (a running server cannot start or stop itself over its own HTTP surface)",
            )],
        ),
        pinned if PINNED_UNBUILT_HOST_OPS.contains(&pinned) => envelope(
            snapback,
            false,
            authority_none(),
            Value::Object(Default::default()),
            vec![host_op_diagnostic(
                "SNAPBACK_HOST_OP_UNIMPLEMENTED",
                &operation,
                "this operation is pinned by LLP 0024 but not built yet (LLP 0032 P6 first slice serves app.inspect, app.reset, schema.load, functions.load, function.run)",
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

fn run_function(
    snapback: &mut LocalSnapback,
    request: &HostOpsRequest,
    envelope: impl Fn(&LocalSnapback, bool, Option<HostOpsAuthority>, Value, Vec<Diagnostic>) -> HostOpsResult,
) -> HostOpsResult {
    let authority = authority_dev_user(request.user_id.as_deref());
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
            vec![host_op_diagnostic(
                "SNAPBACK_HOST_OP_FUNCTION_UNKNOWN",
                "function.run",
                &format!("{function} is not in the loaded function manifest"),
            )],
        );
    };
    let (name, kind) = (definition.name.clone(), definition.kind.clone());
    let input = HandlerInput {
        args: request
            .args
            .clone()
            .unwrap_or_else(|| Value::Object(Default::default())),
        auth: crate::manifest::AuthInput {
            principal: None,
            session_id: None,
            user_id: request.user_id.clone(),
        },
        read_set: Vec::new(),
        correlation: None,
    };
    match kind {
        FunctionKind::Query | FunctionKind::LiveQuery => match snapback.invoke_query(&name, input)
        {
            Ok(output) => {
                let result = serde_json::to_value(&output)
                    .unwrap_or_else(|_| Value::Object(Default::default()));
                envelope(snapback, true, authority, json!({ "functionResult": result }), Vec::new())
            }
            Err(error) => envelope(
                snapback,
                false,
                authority,
                Value::Object(Default::default()),
                vec![error.diagnostic],
            ),
        },
        FunctionKind::Mutation => match snapback.invoke_mutation(&name, input) {
            Ok(output) => {
                let commit = serde_json::to_value(&output)
                    .unwrap_or_else(|_| Value::Object(Default::default()));
                envelope(snapback, true, authority, json!({ "mutationCommit": commit }), Vec::new())
            }
            Err(error) => envelope(
                snapback,
                false,
                authority,
                Value::Object(Default::default()),
                vec![error.diagnostic],
            ),
        },
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

fn host_op_diagnostic(code: &str, operation: &str, message: &str) -> Diagnostic {
    Diagnostic::error(code, "host-ops", message).with_details(json!({ "operation": operation }))
}
