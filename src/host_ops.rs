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
    CtxAnswerLedger, FunctionKind, FunctionManifest, HandlerInput, SNAPBACK_SCHEMA_VERSION,
    SchemaManifest, SeedData, TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use uuid::Uuid;

pub const HOST_OPS_RESULT_KIND: &str = "hostOpsResult";
pub const HOST_READY_DESCRIPTOR_KIND: &str = "snapbackHostReady";

/// Operations this endpoint serves in the first slice.
pub const SERVED_HOST_OPS: [&str; 6] = [
    "app.inspect",
    "app.reset",
    "schema.load",
    "functions.load",
    "function.run",
    "function.explain",
];

/// Pinned by LLP 0024 but process-lifecycle verbs: the CLI owns them (a
/// running server cannot start itself over its own HTTP surface).
pub const CLI_ONLY_HOST_OPS: [&str; 3] = ["host.start", "host.stop", "host.restart"];

/// Pinned by LLP 0024, not yet built anywhere. Requests return a structured
/// `SNAPBACK_HOST_OP_UNIMPLEMENTED` envelope so aspiration cannot be mistaken
/// for API (the LLP 0032 R4 banner rule, enforced at runtime).
pub const PINNED_UNBUILT_HOST_OPS: [&str; 3] =
    ["schema.reload", "functions.reload", "acceptance.run"];

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
    /// Request-local charging facts consumed by the HTTP secret-read gate;
    /// never part of the host-ops wire envelope or generated schema.
    #[serde(skip)]
    #[schemars(skip)]
    pub(crate) secret_read_tables: Vec<String>,
    #[serde(skip)]
    #[schemars(skip)]
    pub(crate) secret_read_rows: usize,
    #[serde(skip)]
    #[schemars(skip)]
    pub(crate) secret_read_query: bool,
    /// False when an invocation failed on a path whose error type cannot yet
    /// carry the complete ctx.db dependency witness. HTTP session mode uses
    /// this only to replace the response with a fixed fail-closed diagnostic.
    #[serde(skip)]
    #[schemars(skip)]
    pub(crate) secret_read_provenance_complete: bool,
}

impl HostOpsResult {
    pub(crate) fn mark_admin_bypass(&mut self, reason: &str) {
        self.authority = authority_admin(reason);
    }
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
    /// The writing server's per-process boot id (`/health` →
    /// `binary.startupNonce`). `snapback stop` matches it against the live
    /// server before signaling `pid`, so a stale descriptor (crash, Ctrl-C)
    /// never routes a signal to a reused PID (ENG-23366). Optional only for
    /// descriptors written by older binaries, which `stop` treats as
    /// unverifiable and refuses.
    #[serde(
        rename = "startupNonce",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub startup_nonce: Option<String>,
    pub target: HostOpsTarget,
    pub database: HostReadyDatabase,
    #[serde(rename = "startedAtMs")]
    pub started_at_ms: u64,
    #[serde(rename = "adminGated")]
    pub admin_gated: bool,
    /// Where the serve path persisted its auto-minted admin token
    /// (ENG-23443), when it minted one. Tooling that can read this 0600 file
    /// is already local admin (LLP 0036 D3); a browser page is not.
    #[serde(
        rename = "adminTokenFile",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub admin_token_file: Option<String>,
    /// Owner-only root used exclusively by ready-file CLI tooling to produce
    /// one-shot secret-read mint proofs. The descriptor carries only this
    /// mechanically validated sibling path, never the root bytes.
    #[serde(
        rename = "secretReadRootFile",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub secret_read_root_file: Option<String>,
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
    /// `function.explain` only: the explanation kind (LLP 0024 v0 kinds;
    /// `mutationDryRun` is the served one).
    #[serde(default)]
    pub kind: Option<String>,
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
    execute_host_op_with_profile(
        snapback,
        request,
        server_url,
        crate::admin::ServerProfile::Dev,
    )
}

/// Execute with the serving environment's profile. HTTP passes the real
/// [`ServerProfile`]; the legacy in-process helper above deliberately models
/// the trusted local-dev embedding posture.
pub fn execute_host_op_with_profile(
    snapback: &mut LocalSnapback,
    request: HostOpsRequest,
    server_url: Option<String>,
    profile: crate::admin::ServerProfile,
) -> HostOpsResult {
    let request_id = request.request_id.clone().unwrap_or_else(new_request_id);
    let operation = request.operation.clone();

    let target = |snapback: &LocalSnapback| HostOpsTarget {
        app_id: snapback.loaded_app_id(),
        app_root: None,
        target_profile: match profile {
            crate::admin::ServerProfile::Dev => TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            other => format!("local-{}-sqlite-ibex", other.as_str()),
        },
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
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    };

    let profile_requirement =
        crate::admin::operation_profile_requirement(&operation, request.user_id.is_some());
    if let Some(diagnostic) =
        crate::admin::operation_profile_diagnostic(profile, &operation, profile_requirement)
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
            let seed = request.seed.clone();
            let seed_requested = seed.is_some();
            match snapback.reset_with_seed(seed) {
                Ok(seeded_output) => {
                    let mut data = serde_json::Map::new();
                    data.insert("resetScope".to_owned(), json!("app"));
                    data.insert("seeded".to_owned(), json!(seed_requested));
                    if let Some(output) = seeded_output {
                        data.insert(
                            "seedCommit".to_owned(),
                            serde_json::to_value(output).unwrap_or_default(),
                        );
                    }
                    data.insert(
                        "databaseVersion".to_owned(),
                        json!(snapback.durable_version()),
                    );
                    envelope(
                        snapback,
                        true,
                        authority_admin("host-ops admin write gate"),
                        Value::Object(data),
                        Vec::new(),
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
            let diagnostics = snapback.load_functions(functions);
            let ok = !diagnostics.iter().any(|diagnostic| {
                diagnostic.severity == crate::diagnostic::DiagnosticSeverity::Error
            });
            envelope(
                snapback,
                ok,
                authority_admin("host-ops admin write gate"),
                json!({ "loaded": ok, "functionCount": function_count }),
                diagnostics,
            )
        }
        "function.run" => run_function(snapback, &request, envelope),
        "function.explain" => explain_function(snapback, &request, envelope),
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

fn run_function(
    snapback: &mut LocalSnapback,
    request: &HostOpsRequest,
    envelope: impl Fn(
        &LocalSnapback,
        bool,
        Option<HostOpsAuthority>,
        Value,
        Vec<Diagnostic>,
    ) -> HostOpsResult,
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
    let declared_reads = snapback.function_declared_read_tables(&name);
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
        ctx_ledger: None,
    };
    match kind {
        FunctionKind::Query | FunctionKind::LiveQuery => {
            match snapback.invoke_query_with_dependencies(&name, input) {
                Ok(invocation) => {
                    let rows = invocation.output.rows.len();
                    let mut tables: BTreeSet<String> = declared_reads.into_iter().collect();
                    tables.extend(
                        invocation
                            .read_dependencies
                            .iter()
                            .filter_map(|dependency| dependency.table.clone()),
                    );
                    let result = serde_json::to_value(&invocation.output)
                        .unwrap_or_else(|_| Value::Object(Default::default()));
                    let mut response = envelope(
                        snapback,
                        true,
                        authority,
                        json!({ "functionResult": result }),
                        Vec::new(),
                    );
                    response.secret_read_tables = tables.into_iter().collect();
                    response.secret_read_rows = rows;
                    response.secret_read_query = true;
                    response
                }
                Err(error) => {
                    let mut response = envelope(
                        snapback,
                        false,
                        authority,
                        Value::Object(Default::default()),
                        vec![error.diagnostic],
                    );
                    response.secret_read_tables = declared_reads;
                    response.secret_read_query = true;
                    response.secret_read_provenance_complete = false;
                    response
                }
            }
        }
        FunctionKind::Mutation => match snapback.invoke_mutation(&name, input) {
            Ok(output) => {
                let commit = serde_json::to_value(&output)
                    .unwrap_or_else(|_| Value::Object(Default::default()));
                envelope(
                    snapback,
                    true,
                    authority,
                    json!({ "mutationCommit": commit }),
                    Vec::new(),
                )
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

/// The `function.explain` / `mutationDryRun` wire report (LLP 0024 §Dry-Run,
/// LLP 0051 D8 / Increment 4). Rides `HostOpsResult.data.dryRun`; the
/// committed schema is `schemas/dry-run.report.schema.json` (DK-7). This is
/// the shape the Exact-side Acto dry-run operation (LLP 0329 E-D) consumes.
///
/// Mutations cannot touch secrets by construction (secret access is
/// action-only), so the report is presentable to agents without a redaction
/// pass. `ok: true` on the envelope means the dry-run RAN and this report is
/// authoritative evidence — a `wouldCommit: false` report is still a
/// successful explanation.
#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct DryRunReport {
    /// The explanation kind — always `mutationDryRun` here.
    pub kind: String,
    /// The function the dry-run executed.
    pub function: String,
    /// Which execution tier answered: `hostPlan` (IR) or `ibexModule`.
    pub tier: String,
    /// Whether the identical commit path would have committed.
    #[serde(rename = "wouldCommit")]
    pub would_commit: bool,
    /// True when a permission-class pre-execution gate rejected the mutation.
    pub denied: bool,
    /// Structured reason when `denied`.
    #[serde(rename = "denialReason", skip_serializing_if = "Option::is_none")]
    pub denial_reason: Option<Diagnostic>,
    /// Table/id/op/field summaries of the discarded writes — safe to expose.
    #[serde(rename = "predictedWrites")]
    pub predicted_writes: Vec<DryRunWriteSummary>,
    /// Read dependencies captured during execution.
    #[serde(rename = "readSet")]
    pub read_set: Vec<DryRunRead>,
    /// The discarded writes, row-granular with resulting values.
    #[serde(rename = "writeSet")]
    pub write_set: Vec<DryRunWrite>,
    /// `valid` | `stale` | `notChecked` | `unsupported` (LLP 0024 §Dry-Run).
    #[serde(rename = "readSetValidation")]
    pub read_set_validation: String,
    /// The recorded ctx-answer ledger (LLP 0051 D1) — literally the
    /// deterministic answers this execution consumed.
    #[serde(
        rename = "deterministicInputs",
        skip_serializing_if = "Option::is_none"
    )]
    pub deterministic_inputs: Option<CtxAnswerLedger>,
    /// Always empty for queries/mutations (LLP 0024); future actions need a
    /// separate contract.
    #[serde(rename = "sideEffects")]
    pub side_effects: Vec<Value>,
    /// The handler's return value.
    pub result: Value,
    /// The database version the dry-run evaluated against.
    #[serde(rename = "snapshotVersion")]
    pub snapshot_version: u64,
    /// Report-scoped diagnostics: the would-be commit failure when
    /// `wouldCommit` is false, plus advisory notes.
    pub diagnostics: Vec<Diagnostic>,
}

/// One predicted write, summarized (no row values).
#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct DryRunWriteSummary {
    pub table: String,
    pub id: String,
    /// `insert` | `update` | `delete`.
    pub op: String,
    #[serde(
        rename = "changedFields",
        default,
        skip_serializing_if = "Vec::is_empty"
    )]
    pub changed_fields: Vec<String>,
}

/// One discarded write with the row value it would have produced.
#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct DryRunWrite {
    pub table: String,
    pub id: String,
    /// `insert` | `update` | `delete`.
    pub op: String,
    /// The row after the write (absent for deletes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row: Option<Value>,
}

/// One captured read dependency, projected to the camelCase wire (LLP 0032
/// P8 casing rule).
#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct DryRunRead {
    /// `row` | `missingRow` | `query` | `auth` | `permission`.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicate: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    #[serde(rename = "resultCount", skip_serializing_if = "Option::is_none")]
    pub result_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary: Option<Value>,
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
        let (code, message) = if EXPLAIN_KINDS.contains(&kind.as_str()) {
            (
                "SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED",
                format!(
                    "explain kind {kind} is pinned by LLP 0024 but not built yet (mutationDryRun is served)"
                ),
            )
        } else {
            (
                "SNAPBACK_EXPLAIN_KIND_UNKNOWN",
                format!("unknown explain kind {kind}"),
            )
        };
        return envelope(
            snapback,
            false,
            authority,
            Value::Object(Default::default()),
            vec![
                Diagnostic::error(code, "host-ops", &message)
                    .with_details(json!({ "operation": "function.explain", "kind": kind })),
            ],
        );
    }
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
        ctx_ledger: None,
    };
    let declared_secret_reads = snapback.function_declared_read_tables(&function);
    match snapback.dry_run_mutation(&function, input) {
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

fn host_op_diagnostic(code: &str, operation: &str, message: &str) -> Diagnostic {
    Diagnostic::error(code, "host-ops", message).with_details(json!({ "operation": operation }))
}
