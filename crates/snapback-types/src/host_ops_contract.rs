//! Shared host-operation wire/result shapes.
//!
//! Transport execution and validation stay in `host_ops`; schema export and
//! other coordinators consume these language-neutral carriers from the leaf.
//!
//! @ref LLP 0024#result-envelope — CLI and HTTP share one result envelope.
//! @ref LLP 0225#1-ownership-map — coordinator and transport depend on
//!   shared contract/types rather than on each other.

use crate::contract_types::{BranchId, ForkEgressPolicyV1};
use crate::diagnostic::Diagnostic;
use crate::manifest::CtxAnswerLedger;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

pub const HOST_OPS_RESULT_KIND: &str = "hostOpsResult";
pub const HOST_READY_DESCRIPTOR_KIND: &str = "snapbackHostReady";

#[derive(Clone, Deserialize, Serialize, schemars::JsonSchema)]
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
    pub secret_read_tables: Vec<String>,
    #[serde(skip)]
    #[schemars(skip)]
    pub secret_read_rows: usize,
    #[serde(skip)]
    #[schemars(skip)]
    pub secret_read_query: bool,
    /// False when an invocation failed on a path whose error type cannot yet
    /// carry the complete ctx.db dependency witness. HTTP session mode uses
    /// this only to replace the response with a fixed fail-closed diagnostic.
    #[serde(skip)]
    #[schemars(skip)]
    pub secret_read_provenance_complete: bool,
}

impl fmt::Debug for HostOpsResult {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HostOpsResult")
            .field("ok", &self.ok)
            .field("request_id", &"[REDACTED]")
            .field("operation", &"[REDACTED]")
            .field("target", &"[REDACTED]")
            .field("authority", &"[REDACTED]")
            .field("artifacts", &"[REDACTED]")
            .field("data", &"[REDACTED]")
            .field("diagnostic_count", &self.diagnostics.len())
            .field("next_count", &self.next.len())
            .finish_non_exhaustive()
    }
}

impl HostOpsResult {
    pub fn mark_admin_bypass(&mut self, reason: &str) {
        self.authority = authority_admin(reason);
    }
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

// @ref LLP 0224#layered-readiness-not-one-overloaded-boolean — the artifact
//   identity carrier is embedded in the closed readiness fact and receipt, so
//   it is a closed carrier itself: unknown fields are refused everywhere it
//   appears.
#[derive(Clone, Debug, Default, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostOpsArtifacts {
    pub schema_hash: Option<String>,
    pub bundle_hash: Option<String>,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
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
    /// Mechanically derived owner-only per-process impersonation bearer
    /// sibling. Consumers accept this path only when it exactly equals
    /// `<ready-file>.impersonation` and the live startup nonce still matches.
    #[serde(
        rename = "impersonationCapabilityFile",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub impersonation_capability_file: Option<String>,
    /// Owner-only per-process developer-identity capability on the admin-token
    /// anchor ladder. The descriptor advertises only the resolved path, never
    /// the bearer.
    #[serde(
        rename = "devIdentityCapabilityFile",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub dev_identity_capability_file: Option<String>,
    pub diagnostics: Vec<Diagnostic>,
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
        if descriptor.schema_version != crate::manifest::SNAPBACK_SCHEMA_VERSION {
            problems.push(format!(
                "schemaVersion {} is not {}",
                descriptor.schema_version,
                crate::manifest::SNAPBACK_SCHEMA_VERSION
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

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct HostReadyDatabase {
    pub mode: String,
    pub path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedBranchCreateHostInputV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub allowed_functions: Vec<String>,
    pub ttl_ms: i64,
    #[serde(default)]
    pub egress_policy: ForkEgressPolicyV1,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedBranchListHostInputV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedBranchIdHostInputV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub branch_id: BranchId,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedBranchExecuteHostInputV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub branch_id: BranchId,
    pub function: String,
    #[serde(default)]
    pub args: Value,
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
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
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
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
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
