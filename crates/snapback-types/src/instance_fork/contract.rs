//! Fork records and closed enums consumed below the services layer.
//!
//! `DerivedForkRuntime`'s durable refusal implementation intentionally stays
//! in `service`: it writes the fork-local evidence table and is behavior, not
//! a leaf contract.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const APP_ROW_COVERAGE_RECEIPT_FILE: &str = "fork-app-row-coverage-receipt.json";
pub const APP_ROW_COVERAGE_GAP_FILE: &str = "fork-app-row-coverage-gap.v1.json";
pub const APP_ROW_COVERAGE_META_KEY: &str = "instance_fork_app_row_coverage_v1";
pub const WRITER_COVERAGE_GAP_CODE: &str = "SNAPBACK_FORK_WRITER_COVERAGE_GAP";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DerivedForkLineageV1 {
    pub format_version: u32,
    pub fork_id: String,
    pub parent_instance_id: String,
    pub app_id: String,
    pub created_at_ms: u64,
    /// The last parent commit included in the materialized snapshot. Parent
    /// and child can mint equal later version numbers, so this is provenance,
    /// not merely an optimization for the diff reader.
    #[serde(default)]
    pub fork_point_version: u64,
    /// Every product-created v1 fork is finite. `None` exists only for the
    /// lower-level F0a crash corpus, which predates lifecycle packaging.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at_ms: Option<u64>,
    pub promotable: bool,
}

/// Durable evidence that the derived fork's process-owned SQLite writer was
/// armed before any post-fork application commit could run. The identical
/// object lives in the database and beside it; the digest binds the fork
/// point to the exact fork-local journal-authority manifest.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkAppRowCoverageReceiptV1 {
    pub schema_version: String,
    pub profile: String,
    pub fork_id: String,
    pub data_version_stream: String,
    pub fork_point_version: u64,
    pub activation_head_version: u64,
    pub activated_at_ms: u64,
    pub manifest_version: u64,
    pub manifest_digest: String,
    pub covered_lanes: Vec<String>,
    pub uncovered_lanes: Vec<String>,
    pub writer_choke_points: Vec<String>,
    pub receipt_digest: String,
}

#[derive(Clone, Debug)]
pub struct DerivedForkRuntime {
    pub database_path: PathBuf,
    pub lineage: DerivedForkLineageV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EgressFamily {
    Fetch,
    PushSend,
    PushReceipt,
    StreamOpen,
    StreamRead,
    StreamCancel,
    StreamEmit,
    JobsEnqueue,
    JobsDrain,
    CronTick,
    AssetProvider,
    TelemetryExport,
    UnclassifiedHostOperation,
}

impl EgressFamily {
    pub const ALL: [Self; 13] = [
        Self::Fetch,
        Self::PushSend,
        Self::PushReceipt,
        Self::StreamOpen,
        Self::StreamRead,
        Self::StreamCancel,
        Self::StreamEmit,
        Self::JobsEnqueue,
        Self::JobsDrain,
        Self::CronTick,
        Self::AssetProvider,
        Self::TelemetryExport,
        Self::UnclassifiedHostOperation,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fetch => "fetch",
            Self::PushSend => "push_send",
            Self::PushReceipt => "push_receipt",
            Self::StreamOpen => "stream_open",
            Self::StreamRead => "stream_read",
            Self::StreamCancel => "stream_cancel",
            Self::StreamEmit => "stream_emit",
            Self::JobsEnqueue => "jobs_enqueue",
            Self::JobsDrain => "jobs_drain",
            Self::CronTick => "cron_tick",
            Self::AssetProvider => "asset_provider",
            Self::TelemetryExport => "telemetry_export",
            Self::UnclassifiedHostOperation => "unclassified_host_operation",
        }
    }

    /// Classify the complete current Ibex host-op vocabulary. Unknown future
    /// operations deny on a fork until deliberately classified as local.
    pub fn for_derived_host_op(op: &str) -> Option<Self> {
        match op {
            "host.fetch" | "action.externalEffectBegin" => Some(Self::Fetch),
            "push.send" => Some(Self::PushSend),
            "action.streamOpen" => Some(Self::StreamOpen),
            "action.streamRead" => Some(Self::StreamRead),
            "action.streamCancel" => Some(Self::StreamCancel),
            "action.streamEmit" => Some(Self::StreamEmit),
            "jobs.enqueue" => Some(Self::JobsEnqueue),
            "db.query"
            | "db.get"
            | "db.elevated.query"
            | "db.elevated.get"
            | "db.elevated.getMany"
            | "db.elevated.uniqueMany"
            | "db.insert"
            | "db.patch"
            | "db.delete"
            | "sequence.allocate"
            | "assets.attach"
            | "assets.grant"
            | "assets.activate"
            | "assets.revoke"
            | "membership.write"
            | "runtime.now"
            | "runtime.log"
            | "runtime.id"
            // @ref LLP 0043#handler-visible-settlement-identity-2026-08-08 — settlement
            // identity is a read-only projection of this request, not egress
            // or an independently generated effect on a derived fork.
            | "mutation.settlement"
            | "action.metadata"
            | "action.externalEffectInitiated"
            | "action.runMutation"
            | "action.streamAttemptStart"
            | "action.streamAttemptSettle"
            // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions —
            // generated profile admission is a captured local database read,
            // not a derived-fork egress effect.
            | "permissions.allowsRole"
            | "permissions.requireRole"
            | "permissions.deny"
            | "authority.list"
            | "authority.myRole" => None,
            _ => Some(Self::UnclassifiedHostOperation),
        }
    }
}
