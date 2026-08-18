//! Non-promotable, same-app derived deployment forks.
//!
//! This module is intentionally separate from `branches`: LLP 0097 branches
//! are promotable command logs, while these instances are independently
//! bootable deployments that can never promote into their parent.
//!
//! Durable lifecycle behavior stays together here because its sequencing
//! spans SQLite custody, filesystem publication cuts, registry receipts, and
//! recovery. Splitting those phases further would divide one commit protocol.

use super::contract::*;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use snapback_kernel::instance_fork::{
    CustodyDisposition, CustodyRule, ForkMintReceiptV1, MINT_RECEIPT_FILE, SERVER_EXPIRED_CODE,
    SIDECAR_CUSTODY, STAGING_SENTINEL, TABLE_CUSTODY, inspect_boot, inspect_boot_at,
    server_expired_error,
};

pub const RENEW_INTENT_FILE: &str = "fork-renew-intent.json";
pub const RENEW_RECEIPT_FILE: &str = "fork-renew-receipt.json";
pub const BASE_SNAPSHOT_FILE: &str = "fork-base.sqlite3";
pub const BASE_RECEIPT_FILE: &str = "fork-base-receipt.json";
pub const APP_BINDING_RECEIPT_FILE: &str = "fork-app-binding-receipt.json";
pub const APP_BINDING_INTENT_FILE: &str = ".snapback-fork-app-binding-intent.v1.json";
pub const APP_ROOT_IDENTITY_FILE: &str = "instance-fork-app-identity.v1.json";
pub const REGISTRY_DIRECTORY: &str = ".snapback-fork-registry";
const LINEAGE_META_KEY: &str = "instance_fork_lineage_v1";
const QUARANTINE_META_KEY: &str = "instance_fork_quarantine_v1";
const EGRESS_TABLE: &str = "_snapback_fork_egress_attempts_v1";

pub const RESOURCE_LIMIT_REFUSED_CODE: &str = "SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED";
pub const RENEW_EXPIRED_CODE: &str = "SNAPBACK_FORK_RENEW_EXPIRED";
pub const NET_DIFF_UNAVAILABLE_CODE: &str = "SNAPBACK_FORK_NET_DIFF_UNAVAILABLE";
pub const ASSET_CUT_INCOMPLETE_CODE: &str = "SNAPBACK_FORK_ASSET_CUT_INCOMPLETE";
pub const ASSET_CUT_UNSUPPORTED_CODE: &str = "SNAPBACK_FORK_ASSET_CUT_UNSUPPORTED";
pub const DIFF_ORACLE_MISMATCH_CODE: &str = "SNAPBACK_FORK_DIFF_ORACLE_MISMATCH";
pub const WRITER_COVERAGE_INVALID_CODE: &str = "SNAPBACK_FORK_WRITER_COVERAGE_INVALID";
pub const APP_BINDING_REQUIRED_CODE: &str = "SNAPBACK_FORK_APP_BINDING_REQUIRED";
pub const APP_BINDING_MISMATCH_CODE: &str = "SNAPBACK_FORK_APP_BINDING_MISMATCH";
pub const ADMISSION_TIMEOUT_CODE: &str = "SNAPBACK_FORK_ADMISSION_TIMEOUT";

/// Maximum total lifetime for a managed fork, binding creation through every
/// renewal (LLP 0185 Phase 3 item 6's "configured maximum"; author-ratified
/// 2026-08-05). Requests past it refuse with [`RESOURCE_LIMIT_REFUSED_CODE`]
/// rather than silently extending forever. LLP 0185 OQ1 (whether agent
/// fleets need a different default) stays open until Phase 2b observes real
/// fleets.
pub const MANAGED_FORK_MAX_LIFETIME_MS: u64 = 7 * 86_400_000;

/// LLP 0185 Phase 3 item 7 resource bounds (author-ratified 2026-08-05).
/// The mechanism — deterministic refusal before any staging I/O, with the
/// usage that triggered it in the diagnostic — is the contract; explicit
/// CLI flags override per invocation.
pub const MANAGED_FORK_MAX_COUNT: usize = 16;
pub const MANAGED_FORK_MAX_FORK_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const MANAGED_FORK_MAX_TOTAL_BYTES: u64 = 16 * 1024 * 1024 * 1024;
pub const FORK_DIFF_MAX_ROWS: u64 = 100_000;
pub const FORK_DIFF_MAX_BYTES: u64 = 64 * 1024 * 1024;
pub const FORK_CREATION_ADMISSION_TIMEOUT_MS: u64 = 30_000;
const FORK_CREATION_ADMISSION_POLL_MS: u64 = 10;

#[derive(Clone, Copy, Debug)]
pub struct ForkResourceLimits {
    pub max_forks: usize,
    pub max_fork_bytes: u64,
    pub max_total_bytes: u64,
}

impl Default for ForkResourceLimits {
    fn default() -> Self {
        Self {
            max_forks: MANAGED_FORK_MAX_COUNT,
            max_fork_bytes: MANAGED_FORK_MAX_FORK_BYTES,
            max_total_bytes: MANAGED_FORK_MAX_TOTAL_BYTES,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkResourceUsageV1 {
    pub fork_count: usize,
    pub existing_bytes: u64,
    pub estimated_fork_bytes: u64,
}

/// The invocation identity every lifecycle selector must present. The
/// canonical root prevents two worktrees with the same logical app id from
/// sharing authority merely because they point at one explicit fork root.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpectedForkAppV1 {
    canonical_app_root: PathBuf,
    app_id: String,
}

impl ExpectedForkAppV1 {
    pub fn canonical_app_root(&self) -> &Path {
        &self.canonical_app_root
    }

    pub fn app_id(&self) -> &str {
        &self.app_id
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AppRootIdentityV1 {
    schema_version: String,
    canonical_app_root: String,
    app_id: String,
}

#[cfg(test)]
type JsonBeforeRenameHook = Option<Box<dyn FnOnce(&Path, &Path)>>;

#[cfg(test)]
thread_local! {
    static DIFF_AFTER_HEADER_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
    static JSON_BEFORE_RENAME_HOOK: std::cell::RefCell<JsonBeforeRenameHook> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn install_diff_after_header_hook(hook: impl FnOnce() + 'static) {
    DIFF_AFTER_HEADER_HOOK.with(|slot| {
        assert!(slot.borrow().is_none(), "diff snapshot hook is one-shot");
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

fn run_diff_after_header_hook() {
    #[cfg(test)]
    DIFF_AFTER_HEADER_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

#[cfg(test)]
fn install_json_before_rename_hook(hook: impl FnOnce(&Path, &Path) + 'static) {
    JSON_BEFORE_RENAME_HOOK.with(|slot| {
        assert!(slot.borrow().is_none(), "JSON publication hook is one-shot");
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

fn run_json_before_rename_hook(temporary: &Path, published: &Path) {
    #[cfg(test)]
    JSON_BEFORE_RENAME_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook(temporary, published);
        }
    });

    #[cfg(not(test))]
    let _ = (temporary, published);
}

fn fork_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "instanceFork", message)
}

// @ref LLP 0188#2-integration-point-the-whole-instance-database — persistent
// WAL is connection-local, so every fork backup, scrub, and lifecycle handle
// must preserve the replication owner's journal before it can touch SQLite.
fn configure_fork_connection_wal_lifetime(conn: &Connection) -> SnapbackResult<()> {
    if crate::replication::configured_from_env() {
        crate::replication::configure_connection_wal_lifetime(conn)?;
        conn.execute_batch("PRAGMA wal_autocheckpoint = 0;")?;
    }
    Ok(())
}

fn open_fork_connection(path: &Path) -> SnapbackResult<Connection> {
    let conn = Connection::open(path)?;
    configure_fork_connection_wal_lifetime(&conn)?;
    Ok(conn)
}

fn open_fork_connection_with_flags(path: &Path, flags: OpenFlags) -> SnapbackResult<Connection> {
    let conn = Connection::open_with_flags(path, flags)?;
    configure_fork_connection_wal_lifetime(&conn)?;
    Ok(conn)
}

fn checkpoint_when_fork_owns_wal(conn: &Connection) -> SnapbackResult<()> {
    if !crate::replication::configured_from_env() {
        conn.execute_batch("PRAGMA wal_checkpoint(FULL);")?;
    }
    Ok(())
}

fn canonical_app_root_string(app_root: &Path) -> SnapbackResult<(PathBuf, String)> {
    let canonical = fs::canonicalize(app_root).map_err(|error| {
        fork_error(
            "SNAPBACK_FORK_APP_ROOT_INVALID",
            format!(
                "cannot resolve invoking app root {}: {error}",
                app_root.display()
            ),
        )
    })?;
    let encoded = canonical.to_str().ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_APP_ROOT_INVALID",
            "invoking app root must have a UTF-8 canonical path",
        )
    })?;
    Ok((canonical.clone(), encoded.to_owned()))
}

/// Establish the invoking root's logical identity at create time. Subsequent
/// lifecycle verbs load this independent expected identity rather than
/// trusting the selected registry row to identify its own caller.
pub fn ensure_expected_app(app_root: &Path, app_id: &str) -> SnapbackResult<ExpectedForkAppV1> {
    if app_id.is_empty() {
        return Err(fork_error(
            APP_BINDING_REQUIRED_CODE,
            "fork lifecycle app identity requires a non-empty logical app id",
        ));
    }
    let (canonical_app_root, encoded_root) = canonical_app_root_string(app_root)?;
    let path = canonical_app_root
        .join(".snapback")
        .join(APP_ROOT_IDENTITY_FILE);
    let expected = AppRootIdentityV1 {
        schema_version: "snapback.fork-app-identity.v1".to_owned(),
        canonical_app_root: encoded_root,
        app_id: app_id.to_owned(),
    };
    match fs::read(&path) {
        Ok(bytes) => {
            let recorded: AppRootIdentityV1 = serde_json::from_slice(&bytes).map_err(|error| {
                fork_error(
                    APP_BINDING_REQUIRED_CODE,
                    format!("invoking app-root identity is malformed: {error}"),
                )
            })?;
            if recorded != expected {
                return Err(fork_error(
                    APP_BINDING_MISMATCH_CODE,
                    "invoking app root is already bound to a different canonical root or logical app id",
                )
                .with_details(json!({
                    "expectedAppRoot": expected.canonical_app_root,
                    "expectedAppId": expected.app_id,
                })));
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let directory = path.parent().expect("app identity has a parent");
            fs::create_dir_all(directory)
                .map_err(|error| io_error("create app-root identity directory", error))?;
            install_app_root_identity_sync(&path, &expected)?;
        }
        Err(error) => return Err(io_error("read app-root identity", error)),
    }
    Ok(ExpectedForkAppV1 {
        canonical_app_root,
        app_id: app_id.to_owned(),
    })
}

/// Load the caller-controlled expected identity for every selecting command.
/// Roots created before this binding existed fail closed instead of being
/// grandfathered into cross-root authority.
pub fn load_expected_app(app_root: &Path) -> SnapbackResult<ExpectedForkAppV1> {
    let (canonical_app_root, encoded_root) = canonical_app_root_string(app_root)?;
    let path = canonical_app_root
        .join(".snapback")
        .join(APP_ROOT_IDENTITY_FILE);
    let bytes = fs::read(&path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            fork_error(
                APP_BINDING_REQUIRED_CODE,
                "invoking app root has no lifecycle identity binding; legacy/unbound forks cannot be selected",
            )
        } else {
            io_error("read app-root identity", error)
        }
    })?;
    let recorded: AppRootIdentityV1 = serde_json::from_slice(&bytes).map_err(|error| {
        fork_error(
            APP_BINDING_REQUIRED_CODE,
            format!("invoking app-root identity is malformed: {error}"),
        )
    })?;
    if recorded.schema_version != "snapback.fork-app-identity.v1"
        || recorded.canonical_app_root != encoded_root
        || recorded.app_id.is_empty()
    {
        return Err(fork_error(
            APP_BINDING_MISMATCH_CODE,
            "invoking app-root identity does not match its canonical path",
        ));
    }
    Ok(ExpectedForkAppV1 {
        canonical_app_root,
        app_id: recorded.app_id,
    })
}

/// Revalidate an opaque invoking-app identity against the canonical app-root
/// receipt that created it. External callers cannot construct this value from
/// free-form path/app-id strings, and a stale or replaced receipt fails closed.
fn validate_expected_app(expected: &ExpectedForkAppV1) -> SnapbackResult<()> {
    let recorded = load_expected_app(&expected.canonical_app_root)?;
    if recorded != *expected {
        return Err(fork_error(
            APP_BINDING_MISMATCH_CODE,
            "invoking app identity no longer matches its canonical app-root receipt",
        ));
    }
    Ok(())
}

fn io_error(context: &'static str, error: std::io::Error) -> SnapbackError {
    fork_error("SNAPBACK_FORK_IO_FAILED", format!("{context}: {error}"))
}

fn wall_clock_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| {
            elapsed
                .as_millis()
                .min(crate::manifest::PORTABLE_TIMESTAMP_MAX_MS.into()) as u64
        })
        .unwrap_or(0)
}

/// Reserved Phase-1 admission path for the concrete fork/byte/diff bounds
/// defined by LLP 0185 Phase 3. No limit is invented or enforced here.
pub fn resource_limit_refusal(resource: &str, message: impl Into<String>) -> SnapbackError {
    fork_error(RESOURCE_LIMIT_REFUSED_CODE, message).with_details(json!({ "resource": resource }))
}

fn custody_map() -> BTreeMap<&'static str, CustodyDisposition> {
    TABLE_CUSTODY
        .iter()
        .map(|rule| (rule.name, rule.disposition))
        .collect()
}

pub fn audit_connection(conn: &Connection) -> SnapbackResult<Vec<(String, CustodyDisposition)>> {
    let manifest = custody_map();
    let mut statement = conn.prepare(
        "SELECT name FROM sqlite_schema
         WHERE type = 'table'
           AND (name GLOB '_snapback_*' OR name GLOB '_auth_*')
         ORDER BY name",
    )?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut classified = Vec::with_capacity(names.len());
    for name in names {
        let Some(disposition) = manifest.get(name.as_str()).copied() else {
            return Err(fork_error(
                "SNAPBACK_FORK_CUSTODY_UNCLASSIFIED",
                "a Snapback-owned table has no declared fork custody",
            )
            .with_details(json!({ "table": name })));
        };
        if disposition == CustodyDisposition::Refuse {
            let sql = format!(
                "SELECT EXISTS(SELECT 1 FROM \"{}\" LIMIT 1)",
                name.replace('"', "\"\"")
            );
            let occupied: bool = conn.query_row(&sql, [], |row| row.get(0))?;
            if occupied {
                return Err(fork_error(
                    "SNAPBACK_FORK_CUSTODY_REFUSED",
                    "source state belongs to a fork-incompatible subsystem",
                )
                .with_details(json!({ "table": name })));
            }
        }
        classified.push((name, disposition));
    }
    Ok(classified)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkRegistryEntryV1 {
    pub format_version: u32,
    pub state: String,
    pub destination: String,
    pub lineage: DerivedForkLineageV1,
    pub database_file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ready_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_root: Option<String>,
}

/// Fork-local, digest-bound identity tying lifecycle authority to the app
/// root that invoked creation. This remains separate from lineage because the
/// logical data lineage is portable while lifecycle custody is worktree-local.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkAppBindingReceiptV1 {
    pub schema_version: String,
    pub fork_id: String,
    pub app_id: String,
    pub canonical_app_root: String,
    pub receipt_digest: String,
}

/// A registry row only after it has been re-bound to authoritative evidence
/// inside one real direct-child fork directory. Callers must use these paths
/// instead of joining advisory registry strings themselves.
#[derive(Clone, Debug)]
pub struct ManagedForkTargetV1 {
    pub entry: ForkRegistryEntryV1,
    pub receipt: ForkMintReceiptV1,
    pub app_binding: ForkAppBindingReceiptV1,
    pub destination: PathBuf,
    pub database: PathBuf,
    pub ready_file: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkDiffRowV1 {
    pub version: u64,
    pub table: String,
    pub row_id: String,
    pub operation: String,
    pub post_image: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkDiffCommitBoundaryV1 {
    pub data_version_stream: String,
    pub commit_version: u64,
    /// The emitted range is `(base, head]`: base is `exclusive`, head is
    /// `inclusive`.
    pub version_boundary: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkDiffReceiptV3 {
    pub schema_version: String,
    pub fork_id: String,
    pub app_id: String,
    pub parent_instance_id: String,
    pub fork_point_version: u64,
    pub observed_head_version: u64,
    pub base: ForkDiffCommitBoundaryV1,
    pub head: ForkDiffCommitBoundaryV1,
    pub attribution: String,
    pub rows: Vec<ForkDiffRowV1>,
    pub table_counts: BTreeMap<String, u64>,
    pub coverage: Vec<String>,
    pub omissions: Vec<String>,
    pub receipt_digest: String,
}

/// Evidence binding one retained post-mint base snapshot to its fork
/// (LLP 0185 Phase 4 / LLP 0164's "immutable retained base" substrate,
/// which 0164 delegates as the target's choice, named on the receipt).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkBaseReceiptV1 {
    pub schema_version: String,
    pub fork_id: String,
    pub database_file: String,
    pub sha256: String,
    pub retained_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkNetDiffRowV1 {
    pub table: String,
    pub row_id: String,
    pub operation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_image: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_image: Option<Value>,
}

/// The exact net base-to-head diff — a distinct receipt from the journal
/// `snapback.fork-journal-diff.v3` sequence per the frozen compatibility rules. The
/// row set is computed from the retained base and current head directly (an
/// independent oracle, not the journal), then cross-checked against the
/// folded journal where retention still covers the fork point.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkNetDiffWriterCoverageV1 {
    pub coverage_window: String,
    pub manifest_digest: Option<String>,
    pub covered_lanes: Vec<String>,
    pub uncovered_lanes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkNetDiffReceiptV3 {
    pub schema_version: String,
    pub fork_id: String,
    pub app_id: String,
    pub parent_instance_id: String,
    pub fork_point_version: u64,
    pub observed_head_version: u64,
    pub base: ForkDiffCommitBoundaryV1,
    pub head: ForkDiffCommitBoundaryV1,
    pub substrate: String,
    pub completeness: String,
    pub journal_consistency: String,
    pub writer_coverage: ForkNetDiffWriterCoverageV1,
    pub attribution: String,
    pub rows: Vec<ForkNetDiffRowV1>,
    pub table_counts: BTreeMap<String, u64>,
    pub domains: BTreeMap<String, String>,
    pub receipt_digest: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkRenewReceiptV1 {
    pub schema_version: String,
    pub fork_id: String,
    pub renewed_at_ms: u64,
    pub previous_expires_at_ms: u64,
    pub expires_at_ms: u64,
    pub created_at_ms: u64,
    pub max_lifetime_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkReapReceiptV1 {
    pub schema_version: String,
    pub now_ms: u64,
    pub reaped_fork_ids: Vec<String>,
}

fn fork_app_row_covered_lanes() -> Vec<String> {
    let mut lanes = vec![
        crate::operation_ledger::DERIVED_FORK_ORDINARY_APP_ROW_JOURNAL_LANE_V1.to_owned(),
        crate::operation_ledger::DERIVED_FORK_HOST_CHILD_APP_ROW_JOURNAL_LANE_V1.to_owned(),
    ];
    lanes.sort();
    lanes
}

fn fork_app_row_writer_choke_points() -> Vec<String> {
    let mut writers = crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
        .into_iter()
        .chain(crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    writers.sort();
    writers
}

fn fork_app_row_uncovered_lanes() -> Vec<String> {
    crate::storage::local_target_app_effective_uncovered_lanes_v1()
}

fn fork_app_row_all_lanes() -> Vec<String> {
    fork_app_row_covered_lanes()
        .into_iter()
        .chain(fork_app_row_uncovered_lanes())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn fork_app_row_coverage_digest(receipt: &ForkAppRowCoverageReceiptV1) -> SnapbackResult<String> {
    let body = serde_json::to_vec(&json!({
        "schemaVersion": receipt.schema_version,
        "profile": receipt.profile,
        "forkId": receipt.fork_id,
        "dataVersionStream": receipt.data_version_stream,
        "forkPointVersion": receipt.fork_point_version,
        "activationHeadVersion": receipt.activation_head_version,
        "activatedAtMs": receipt.activated_at_ms,
        "manifestVersion": receipt.manifest_version,
        "manifestDigest": receipt.manifest_digest,
        "coveredLanes": receipt.covered_lanes,
        "uncoveredLanes": receipt.uncovered_lanes,
        "writerChokePoints": receipt.writer_choke_points,
    }))
    .map_err(|error| {
        fork_error(
            WRITER_COVERAGE_INVALID_CODE,
            format!("derived-fork writer coverage could not be digested: {error}"),
        )
    })?;
    use sha2::Digest as _;
    let mut hasher = sha2::Sha256::new();
    hasher.update(b"snapback:derived-fork-app-row-coverage:v1\n");
    hasher.update(body);
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn fork_app_binding_digest(receipt: &ForkAppBindingReceiptV1) -> SnapbackResult<String> {
    use sha2::Digest as _;
    let value = json!({
        "schemaVersion": receipt.schema_version,
        "forkId": receipt.fork_id,
        "appId": receipt.app_id,
        "canonicalAppRoot": receipt.canonical_app_root,
    });
    let canonical = crate::rqs_contract::jcs(&value).map_err(|error| {
        fork_error(
            APP_BINDING_REQUIRED_CODE,
            format!("fork app binding is not canonically digestible: {error:?}"),
        )
    })?;
    let mut digest = sha2::Sha256::new();
    digest.update(b"snapback:fork-app-binding-receipt:v1\n");
    digest.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn fork_diff_receipt_digest<T: Serialize>(
    receipt: &T,
    domain: &'static [u8],
) -> SnapbackResult<String> {
    use sha2::Digest as _;
    let mut value = serde_json::to_value(receipt).map_err(|error| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            format!("fork diff receipt is not serializable: {error}"),
        )
    })?;
    let object = value.as_object_mut().ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            "fork diff receipt digest preimage is not an object",
        )
    })?;
    object.remove("receiptDigest");
    let canonical = crate::rqs_contract::jcs(&value).map_err(|error| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            format!("fork diff receipt is not canonically digestible: {error:?}"),
        )
    })?;
    let mut digest = sha2::Sha256::new();
    digest.update(domain);
    digest.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn journal_diff_receipt_digest(receipt: &ForkDiffReceiptV3) -> SnapbackResult<String> {
    fork_diff_receipt_digest(receipt, b"snapback:fork-journal-diff-receipt:v3\n")
}

fn net_diff_receipt_digest(receipt: &ForkNetDiffReceiptV3) -> SnapbackResult<String> {
    fork_diff_receipt_digest(receipt, b"snapback:fork-net-diff-receipt:v3\n")
}

fn write_fork_app_binding(
    staging: &Path,
    receipt: &ForkMintReceiptV1,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ForkAppBindingReceiptV1> {
    let encoded_root = expected.canonical_app_root.to_str().ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_APP_ROOT_INVALID",
            "invoking app root must have a UTF-8 canonical path",
        )
    })?;
    if expected.app_id != receipt.lineage.app_id {
        return Err(fork_error(
            APP_BINDING_MISMATCH_CODE,
            "source logical app id does not match the invoking app-root identity",
        ));
    }
    let mut binding = ForkAppBindingReceiptV1 {
        schema_version: "snapback.fork-app-binding.v1".to_owned(),
        fork_id: receipt.lineage.fork_id.clone(),
        app_id: receipt.lineage.app_id.clone(),
        canonical_app_root: encoded_root.to_owned(),
        receipt_digest: String::new(),
    };
    binding.receipt_digest = fork_app_binding_digest(&binding)?;
    write_json_sync(&staging.join(APP_BINDING_RECEIPT_FILE), &binding)?;
    Ok(binding)
}

fn write_staging_app_binding(staging: &Path, expected: &ExpectedForkAppV1) -> SnapbackResult<()> {
    let encoded_root = expected.canonical_app_root.to_str().ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_APP_ROOT_INVALID",
            "invoking app root must have a UTF-8 canonical path",
        )
    })?;
    write_json_sync(
        &staging.join(APP_BINDING_INTENT_FILE),
        &AppRootIdentityV1 {
            schema_version: "snapback.fork-app-identity.v1".to_owned(),
            canonical_app_root: encoded_root.to_owned(),
            app_id: expected.app_id.clone(),
        },
    )
}

fn validate_staging_app_binding(
    staging: &Path,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<()> {
    let bytes = fs::read(staging.join(APP_BINDING_INTENT_FILE)).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            fork_error(
                APP_BINDING_REQUIRED_CODE,
                "staged publication has no invoking app-root binding; legacy/unbound recovery is refused",
            )
        } else {
            io_error("read staged app binding", error)
        }
    })?;
    let recorded: AppRootIdentityV1 = serde_json::from_slice(&bytes).map_err(|error| {
        fork_error(
            APP_BINDING_REQUIRED_CODE,
            format!("staged app-root binding is malformed: {error}"),
        )
    })?;
    let expected_root = expected.canonical_app_root.to_str().ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_APP_ROOT_INVALID",
            "invoking app root must have a UTF-8 canonical path",
        )
    })?;
    if recorded.schema_version != "snapback.fork-app-identity.v1"
        || recorded.canonical_app_root != expected_root
        || recorded.app_id != expected.app_id
    {
        return Err(fork_error(
            APP_BINDING_MISMATCH_CODE,
            "staged publication is bound to a different invoking app root or logical app id",
        ));
    }
    Ok(())
}

fn read_fork_app_binding(
    destination: &Path,
    receipt: &ForkMintReceiptV1,
) -> SnapbackResult<ForkAppBindingReceiptV1> {
    let path = destination.join(APP_BINDING_RECEIPT_FILE);
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            fork_error(
                APP_BINDING_REQUIRED_CODE,
                "fork has no app-root binding receipt; legacy/unbound lifecycle selection is refused",
            )
        } else {
            io_error("inspect fork app binding", error)
        }
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(fork_error(
            APP_BINDING_REQUIRED_CODE,
            "fork app-root binding is not a real direct-child file",
        ));
    }
    let binding: ForkAppBindingReceiptV1 = serde_json::from_slice(
        &fs::read(&path).map_err(|error| io_error("read fork app binding", error))?,
    )
    .map_err(|error| {
        fork_error(
            APP_BINDING_REQUIRED_CODE,
            format!("fork app-root binding is malformed: {error}"),
        )
    })?;
    if binding.schema_version != "snapback.fork-app-binding.v1"
        || binding.fork_id != receipt.lineage.fork_id
        || binding.app_id != receipt.lineage.app_id
        || binding.receipt_digest != fork_app_binding_digest(&binding)?
    {
        return Err(fork_error(
            APP_BINDING_MISMATCH_CODE,
            "fork app-root binding does not match the mint receipt identity",
        ));
    }
    Ok(binding)
}

fn writer_coverage_invalid(message: impl Into<String>) -> SnapbackError {
    fork_error(WRITER_COVERAGE_INVALID_CODE, message)
}

fn writer_coverage_gap(message: impl Into<String>) -> SnapbackError {
    fork_error(WRITER_COVERAGE_GAP_CODE, message)
}

fn table_exists(conn: &Connection, name: &str) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1",
            [name],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn delete_table(tx: &Transaction<'_>, name: &str) -> SnapbackResult<()> {
    let sql = format!("DELETE FROM \"{}\"", name.replace('"', "\"\""));
    tx.execute(&sql, [])?;
    Ok(())
}

fn rotate_protected_erasure_generation(tx: &Transaction<'_>) -> SnapbackResult<()> {
    const TABLE: &str = "_snapback_protected_erasure_generation_v1";
    if table_exists(tx, TABLE)? {
        delete_table(tx, TABLE)?;
        tx.execute(
            "INSERT INTO _snapback_protected_erasure_generation_v1(id,generation) VALUES(1,0)",
            [],
        )?;
    }
    Ok(())
}

/// Publish one durable JSON carrier without exposing a truncated final path.
///
/// @ref LLP 0158#design-sketch — fork identity and evidence are authority at
///   non-transactional filesystem boundaries, so visibility follows a synced
///   same-directory temporary file and atomic rename.
fn write_json_sync(path: &Path, value: &impl Serialize) -> SnapbackResult<()> {
    let bytes = serde_json::to_vec(value).map_err(|error| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            format!("fork evidence could not be encoded: {error}"),
        )
    })?;
    replace_bytes_sync(path, &bytes)
}

/// Install the immutable app-root identity exactly once. A synced temporary
/// is hard-linked into the final same-directory name so two first writers
/// cannot both publish different identities successfully; the loser reads and
/// compares the winning complete bytes instead.
///
/// @ref LLP 0158#automation-facing-artifact-inventory-f0b-v1-frozen-2026-08-05
///   — app-root identity is lifecycle authority, so its first publication is
///   compare-and-publish rather than replaceable evidence.
fn install_app_root_identity_sync(path: &Path, expected: &AppRootIdentityV1) -> SnapbackResult<()> {
    let bytes = serde_json::to_vec(expected).map_err(|error| {
        fork_error(
            APP_BINDING_REQUIRED_CODE,
            format!("app-root identity could not be encoded: {error}"),
        )
    })?;
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_PATH_INVALID",
                "app-root identity path needs a UTF-8 file name",
            )
        })?;
    let temporary = directory.join(format!(".{name}.install-{}", Uuid::now_v7()));
    let result = (|| -> SnapbackResult<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| io_error("create app-root identity temporary", error))?;
        file.write_all(&bytes)
            .map_err(|error| io_error("write app-root identity temporary", error))?;
        file.sync_all()
            .map_err(|error| io_error("sync app-root identity temporary", error))?;
        run_json_before_rename_hook(&temporary, path);
        match fs::hard_link(&temporary, path) {
            Ok(()) => {
                fs::remove_file(&temporary)
                    .map_err(|error| io_error("unlink app-root identity temporary", error))?;
                sync_directory(directory)
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                let comparison = match fs::read(path) {
                    Ok(winner) => match serde_json::from_slice::<AppRootIdentityV1>(&winner) {
                        Ok(recorded) if recorded == *expected => Ok(()),
                        Ok(_) => Err(fork_error(
                            APP_BINDING_MISMATCH_CODE,
                            "invoking app root was concurrently bound to a different canonical root or logical app id",
                        )
                        .with_details(json!({
                            "expectedAppRoot": expected.canonical_app_root,
                            "expectedAppId": expected.app_id,
                        }))),
                        Err(error) => Err(fork_error(
                            APP_BINDING_MISMATCH_CODE,
                            format!("winning app-root identity is malformed: {error}"),
                        )),
                    },
                    Err(error) => Err(io_error("read winning app-root identity", error)),
                };
                let cleanup = fs::remove_file(&temporary)
                    .map_err(|error| io_error("unlink losing app-root identity temporary", error))
                    .and_then(|()| sync_directory(directory));
                match comparison {
                    Err(error) => {
                        // A conflicting writer must receive the identity
                        // refusal even if best-effort loser cleanup also
                        // encounters an I/O failure.
                        let _ = cleanup;
                        Err(error)
                    }
                    Ok(()) => cleanup,
                }
            }
            Err(error) => Err(io_error("install app-root identity", error)),
        }
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Replace one already-published JSON carrier without exposing truncated
/// bytes. Renewal uses this for every filesystem carrier; the staging
/// sentinel remains the cross-carrier crash boundary.
fn replace_json_sync(path: &Path, value: &impl Serialize) -> SnapbackResult<()> {
    let bytes = serde_json::to_vec(value).map_err(|error| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            format!("fork evidence could not be encoded: {error}"),
        )
    })?;
    replace_bytes_sync(path, &bytes)
}

fn replace_bytes_sync(path: &Path, bytes: &[u8]) -> SnapbackResult<()> {
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_PATH_INVALID",
                "replacement evidence path needs a UTF-8 file name",
            )
        })?;
    let temporary = directory.join(format!(".{name}.replace-{}", Uuid::now_v7()));
    let result = (|| -> SnapbackResult<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| io_error("create replacement fork evidence", error))?;
        file.write_all(bytes)
            .map_err(|error| io_error("write replacement fork evidence", error))?;
        file.sync_all()
            .map_err(|error| io_error("sync replacement fork evidence", error))?;
        run_json_before_rename_hook(&temporary, path);
        fs::rename(&temporary, path)
            .map_err(|error| io_error("publish replacement fork evidence", error))?;
        sync_directory(directory)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn sync_directory(path: &Path) -> SnapbackResult<()> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("sync fork directory", error))
}

fn sync_file(path: &Path, context: &'static str) -> SnapbackResult<()> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error(context, error))
}

fn sync_sqlite_set(
    database_path: &Path,
    conn: &Connection,
    cut_at: Option<PublicationCut>,
) -> SnapbackResult<()> {
    checkpoint_when_fork_owns_wal(conn)?;
    sync_sqlite_files(database_path, cut_at)
}

fn sync_sqlite_files(database_path: &Path, cut_at: Option<PublicationCut>) -> SnapbackResult<()> {
    for (path, cut) in [
        (
            database_path.to_path_buf(),
            PublicationCut::AfterSqliteDatabaseSync,
        ),
        (
            PathBuf::from(format!("{}-wal", database_path.display())),
            PublicationCut::AfterSqliteWalSync,
        ),
        (
            PathBuf::from(format!("{}-shm", database_path.display())),
            PublicationCut::AfterSqliteShmSync,
        ),
        (
            PathBuf::from(format!("{}-journal", database_path.display())),
            PublicationCut::AfterSqliteJournalSync,
        ),
    ] {
        match File::open(&path).and_then(|file| file.sync_all()) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("sync fork SQLite durability set", error)),
        }
        maybe_cut(cut_at, cut)?;
    }
    sync_directory(database_path.parent().unwrap_or_else(|| Path::new(".")))
}

/// Scrub copied authority and mint all replacement identity inside the clone.
/// The caller must point this at a private staging directory.
///
/// @ref LLP 0158#design-sketch — parent credentials are deleted (hash lookup
/// makes rotation insufficient), while both stream identities and signing
/// authority rotate before the lineage stamp becomes permanent.
pub fn scrub_and_mint(
    database_path: &Path,
    app_id: &str,
    parent_instance_id: &str,
    now_ms: u64,
) -> SnapbackResult<ForkMintReceiptV1> {
    scrub_and_mint_with_cut(
        database_path,
        app_id,
        parent_instance_id,
        now_ms,
        None,
        false,
        None,
    )
}

fn scrub_and_mint_with_cut(
    database_path: &Path,
    app_id: &str,
    parent_instance_id: &str,
    now_ms: u64,
    cut_at: Option<PublicationCut>,
    with_secrets: bool,
    expires_at_ms: Option<u64>,
) -> SnapbackResult<ForkMintReceiptV1> {
    let mut conn = open_fork_connection(database_path)?;
    let classified = audit_connection(&conn)?;
    let fork_point_version = conn.query_row(
        "SELECT version FROM _snapback_version WHERE id=1",
        [],
        |row| row.get::<_, u64>(0),
    )?;
    if conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key=?1",
            [LINEAGE_META_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .is_some()
    {
        return Err(fork_error(
            "SNAPBACK_FORK_NESTED_REFUSED",
            "v1 does not fork an already-derived deployment",
        ));
    }

    let fork_id = Uuid::now_v7().to_string();
    let lineage = DerivedForkLineageV1 {
        format_version: 1,
        fork_id,
        parent_instance_id: parent_instance_id.to_owned(),
        app_id: app_id.to_owned(),
        created_at_ms: now_ms,
        fork_point_version,
        expires_at_ms,
        promotable: false,
    };
    let database_file = database_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_PATH_INVALID",
                "fork database needs a UTF-8 file name",
            )
        })?
        .to_owned();

    let admin_path = snapback_auth::auth::admin_token::admin_token_sibling(database_path);
    let auth_keyring_path = crate::auth::keyring::AuthKeyringStore::keyring_path(database_path);
    let resume_path = database_path.with_file_name(crate::rqs_contract::RESUME_KEYRING_FILE_NAME);
    let operation_detail_path = crate::operation_detail::keyring_path(database_path);
    if admin_path.exists()
        || auth_keyring_path.exists()
        || resume_path.exists()
        || operation_detail_path.exists()
    {
        return Err(fork_error(
            "SNAPBACK_FORK_SIDECAR_COLLISION",
            "fork replacement sidecars must be minted into an empty staging namespace",
        ));
    }
    let admin_token = snapback_auth::auth::admin_token::mint_admin_token();
    crate::secure_file::write_new_owner_only(&admin_path, format!("{admin_token}\n").as_bytes())
        .map_err(|error| io_error("mint fork admin token", error))?;
    sync_file(&admin_path, "sync fork admin token")?;
    maybe_cut(cut_at, PublicationCut::AfterAdminSidecar)?;
    crate::auth::keyring::AuthKeyringStore::file_for_database(database_path)
        .load_or_mint_initial(now_ms, &crate::auth::crypto::OsRandom)
        .map_err(|error| fork_error("SNAPBACK_FORK_KEYRING_MINT_FAILED", error.to_string()))?;
    sync_file(&auth_keyring_path, "sync fork auth keyring")?;
    maybe_cut(cut_at, PublicationCut::AfterAuthSidecar)?;
    if !snapback_kernel::instance_fork::mint_resume_keyring_for_fork(&resume_path, now_ms) {
        return Err(fork_error(
            "SNAPBACK_FORK_KEYRING_MINT_FAILED",
            "fork resume keyring was not durably minted",
        ));
    }
    sync_file(&resume_path, "sync fork resume keyring")?;
    maybe_cut(cut_at, PublicationCut::AfterResumeSidecar)?;
    crate::operation_detail::mint_new_sidecar(database_path)?;
    sync_file(&operation_detail_path, "sync fork operation detail keyring")?;

    let mut custody = classified.into_iter().collect::<BTreeMap<_, _>>();
    custody.extend(
        SIDECAR_CUSTODY
            .iter()
            .map(|rule| (format!("sidecar:{}", rule.name), rule.disposition)),
    );
    if with_secrets {
        custody.insert("sidecar:*.config.json".to_owned(), CustodyDisposition::Copy);
    }
    let tx = conn.transaction()?;
    let quarantine = serde_json::to_string(&lineage)
        .map_err(|error| fork_error("SNAPBACK_FORK_LINEAGE_INVALID", error.to_string()))?;
    tx.execute(
        "INSERT INTO _snapback_meta(key,value) VALUES(?1,?2)",
        params![QUARANTINE_META_KEY, quarantine],
    )?;
    for rule in TABLE_CUSTODY {
        if rule.disposition == CustodyDisposition::Scrub && table_exists(&tx, rule.name)? {
            delete_table(&tx, rule.name)?;
        }
    }
    // @ref LLP 0165#open-items — a fork cannot inherit the parent's active
    // protected-erasure fence generation, but the required singleton remains
    // present as fresh child authority.
    rotate_protected_erasure_generation(&tx)?;
    // History post-images remain useful copied application evidence, but an
    // inherited operation id would falsely name parent-stream provenance after
    // its operation ledger, envelope, and suppression records were scrubbed.
    // NULL is the existing honest "no owning operation identity" projection.
    if table_exists(&tx, "_snapback_record_history_v1")? {
        tx.execute(
            "UPDATE _snapback_record_history_v1 SET operation_id=NULL WHERE operation_id IS NOT NULL",
            [],
        )?;
    }
    let authorization = crate::storage::auth_stream::rotate_authorization_version_in(&tx)?;
    crate::storage::auth_invalidation::clear_retry_episodes_in(&tx)?;
    let data_version_stream =
        crate::storage::auth_invalidation::rotate_data_version_stream_in(&tx)?;
    if table_exists(&tx, "_snapback_asset_signing_keys_v1")? {
        crate::assets::rotate_signing_key(&tx, now_ms)?;
    }
    tx.execute(
        "CREATE TABLE IF NOT EXISTS _snapback_fork_egress_attempts_v1 (
           family TEXT PRIMARY KEY,
           attempts INTEGER NOT NULL CHECK(attempts >= 1),
           first_attempt_at_ms INTEGER NOT NULL,
           last_attempt_at_ms INTEGER NOT NULL
         )",
        [],
    )?;
    let lineage_json = serde_json::to_string(&lineage)
        .map_err(|error| fork_error("SNAPBACK_FORK_LINEAGE_INVALID", error.to_string()))?;
    // Quarantine disappears only in the same transaction that publishes the
    // permanent, explicitly non-promotable lineage.
    tx.execute(
        "DELETE FROM _snapback_meta WHERE key=?1",
        [QUARANTINE_META_KEY],
    )?;
    tx.execute(
        "INSERT INTO _snapback_meta(key,value) VALUES(?1,?2)",
        params![LINEAGE_META_KEY, lineage_json],
    )?;
    tx.commit()?;
    maybe_cut(cut_at, PublicationCut::AfterDatabaseMint)?;

    let receipt = ForkMintReceiptV1 {
        format_version: 1,
        lineage,
        database_file,
        authorization_stream_incarnation: authorization.incarnation,
        data_version_stream,
        custody,
    };
    let receipt_path = database_path.with_file_name(MINT_RECEIPT_FILE);
    write_json_sync(&receipt_path, &receipt)?;
    maybe_cut(cut_at, PublicationCut::AfterMintReceipt)?;
    sync_sqlite_set(database_path, &conn, cut_at)?;
    maybe_cut(cut_at, PublicationCut::AfterSqliteSync)?;
    sync_directory(database_path.parent().unwrap_or_else(|| Path::new(".")))?;
    Ok(receipt)
}

/// Remove every copied bearer, grant, retry, operation-identity, and other
/// closed `Scrub` table from an in-app branch head without minting a second
/// deployment identity or any replacement credential. The immutable base is
/// left byte-exact for diff proof; only the writable head is executable.
///
/// @ref LLP 0162#acceptance — canonical credentials are not branch authority;
///   branch execution is admitted only through its stored scoped grant.
pub(crate) fn scrub_copied_authority_for_in_app_branch(
    conn: &mut Connection,
) -> SnapbackResult<()> {
    let tx = conn.transaction()?;
    for rule in TABLE_CUSTODY {
        if rule.disposition == CustodyDisposition::Scrub && table_exists(&tx, rule.name)? {
            delete_table(&tx, rule.name)?;
        }
    }
    rotate_protected_erasure_generation(&tx)?;
    if table_exists(&tx, "_snapback_record_history_v1")? {
        tx.execute(
            "UPDATE _snapback_record_history_v1 SET operation_id=NULL
              WHERE operation_id IS NOT NULL",
            [],
        )?;
    }
    crate::storage::auth_stream::rotate_authorization_version_in(&tx)?;
    crate::storage::auth_invalidation::clear_retry_episodes_in(&tx)?;
    crate::storage::auth_invalidation::rotate_data_version_stream_in(&tx)?;
    tx.commit()?;
    Ok(())
}

/// Apply an optional dev-schema fixture before the fork becomes reachable,
/// then arm the existing generated-writer/SQLite-authorizer cut while the
/// child head still equals its fork point. Production `fork create` instead
/// calls [`arm_open_derived_fork_app_row_coverage`] after its complete cold
/// startup carrier has applied the schema and before listener bind.
///
/// @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 — the
///   upgraded app-row claim requires fork-point activation evidence, not an
///   authorizer manifest installed after a child write.
pub fn arm_derived_fork_app_row_coverage(
    database_path: &Path,
    schema: Option<crate::manifest::SchemaManifest>,
    activated_at_ms: u64,
) -> SnapbackResult<ForkAppRowCoverageReceiptV1> {
    let mut database = crate::storage::LocalDatabase::open(database_path)?;
    if let Some(schema) = schema {
        database.schema_seed().apply_schema(schema)?;
    }
    arm_open_derived_fork_app_row_coverage(&mut database, activated_at_ms)
}

/// Arm writer coverage on the exact database connection that will serve the
/// fork. Cold-start composition has already admitted and applied the complete
/// schema/function pair; this cut must still precede listener bind.
///
/// @ref LLP 0058#cold-startup-artifact-carrier — settled Sessions consumes a
///   complete owner-only pair before this activation cut.
/// @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 — the
///   manifest is active from the fork point on the process-owned connection.
pub fn arm_open_derived_fork_app_row_coverage(
    database: &mut crate::storage::LocalDatabase,
    activated_at_ms: u64,
) -> SnapbackResult<ForkAppRowCoverageReceiptV1> {
    let runtime = database
        .branch_ops_read()
        .derived_fork()
        .cloned()
        .ok_or_else(|| {
            writer_coverage_invalid("writer coverage activation requires a minted derived fork")
        })?;
    let database_path = database
        .database_path()
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            writer_coverage_invalid("writer coverage activation requires a file-backed fork")
        })?;
    if database.versions_read().current_version()? != runtime.lineage.fork_point_version {
        return Err(writer_coverage_invalid(
            "derived-fork writer coverage must arm before the first post-fork commit",
        ));
    }
    let activation_head_version = database.versions_read().current_version()?;
    if activation_head_version != runtime.lineage.fork_point_version {
        return Err(writer_coverage_invalid(
            "worktree schema preparation advanced the app-row head before writer coverage armed",
        ));
    }
    let manifest = database.activate_derived_fork_app_row_journal_coverage(activated_at_ms)?;
    if !database.derived_fork_exact_app_row_journal_coverage_active()?
        || database.versions_read().current_version()? != activation_head_version
    {
        return Err(writer_coverage_invalid(
            "derived-fork writer coverage did not arm the exact manifest at the fork point",
        ));
    }
    let mut receipt = ForkAppRowCoverageReceiptV1 {
        schema_version: "snapback.fork-app-row-coverage.v1".to_owned(),
        profile: "derived-fork-app-rows-v1".to_owned(),
        fork_id: runtime.lineage.fork_id,
        data_version_stream: manifest.stream_id.clone(),
        fork_point_version: runtime.lineage.fork_point_version,
        activation_head_version,
        activated_at_ms,
        manifest_version: manifest.manifest_version,
        manifest_digest: manifest.coverage_digest.clone(),
        covered_lanes: fork_app_row_covered_lanes(),
        uncovered_lanes: fork_app_row_uncovered_lanes(),
        writer_choke_points: fork_app_row_writer_choke_points(),
        receipt_digest: String::new(),
    };
    receipt.receipt_digest = fork_app_row_coverage_digest(&receipt)?;

    let encoded = serde_json::to_string(&receipt)
        .map_err(|error| writer_coverage_invalid(format!("coverage receipt encode: {error}")))?;
    if manifest.manifest_version != receipt.manifest_version
        || manifest.coverage_digest != receipt.manifest_digest
        || manifest.covered_lanes != receipt.covered_lanes
        || manifest.writer_choke_points != receipt.writer_choke_points
    {
        return Err(writer_coverage_invalid(
            "active manifest does not match the fork-point coverage receipt",
        ));
    }
    // Keep the durable receipt write on the serving connection and fsync its
    // WAL set without draining it. Opening or checkpointing through a
    // short-lived second connection here can unlink the live WAL on macOS
    // while the server keeps writing its now-invisible inode.
    database
        .persist_derived_fork_app_row_coverage_receipt(&encoded)
        .map_err(|error| {
            writer_coverage_invalid(format!("persist derived-fork coverage fact: {error}"))
        })?;
    sync_sqlite_files(&database_path, None)?;
    write_json_sync(
        &database_path.with_file_name(APP_ROW_COVERAGE_RECEIPT_FILE),
        &receipt,
    )?;
    sync_directory(database_path.parent().unwrap_or_else(|| Path::new(".")))?;
    Ok(receipt)
}

fn inspect_published_evidence(database_path: &Path) -> SnapbackResult<Option<DerivedForkRuntime>> {
    let directory = database_path.parent().unwrap_or_else(|| Path::new("."));
    if directory.join(STAGING_SENTINEL).exists() {
        return Err(fork_error(
            "SNAPBACK_FORK_PUBLICATION_PARTIAL",
            "fork publication is incomplete; run `snapback fork recover` for the exact destination",
        ));
    }
    inspect_evidence(database_path)
}

fn inspect_evidence(database_path: &Path) -> SnapbackResult<Option<DerivedForkRuntime>> {
    let directory = database_path.parent().unwrap_or_else(|| Path::new("."));
    if !database_path.exists() {
        return Ok(None);
    }
    let conn = open_fork_connection_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    if !table_exists(&conn, "_snapback_meta")? {
        return Ok(None);
    }
    let quarantine = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key=?1",
            [QUARANTINE_META_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if quarantine.is_some() {
        return Err(fork_error(
            "SNAPBACK_FORK_QUARANTINED",
            "fork mint quarantine is still present",
        ));
    }
    let lineage = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key=?1",
            [LINEAGE_META_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let receipt_path = directory.join(MINT_RECEIPT_FILE);
    match (lineage, receipt_path.exists()) {
        (None, false) => Ok(None),
        (Some(lineage), true) => {
            let lineage: DerivedForkLineageV1 = serde_json::from_str(&lineage).map_err(|_| {
                fork_error("SNAPBACK_FORK_LINEAGE_INVALID", "fork lineage is malformed")
            })?;
            if lineage.format_version != 1
                || lineage.promotable
                || lineage
                    .expires_at_ms
                    .is_some_and(|expires_at_ms| expires_at_ms <= lineage.created_at_ms)
            {
                return Err(fork_error(
                    "SNAPBACK_FORK_LINEAGE_INVALID",
                    "fork lineage version, class, or finite expiry is invalid",
                ));
            }
            let receipt: ForkMintReceiptV1 = serde_json::from_slice(
                &fs::read(&receipt_path).map_err(|error| io_error("read fork receipt", error))?,
            )
            .map_err(|_| {
                fork_error(
                    "SNAPBACK_FORK_RECEIPT_INVALID",
                    "fork mint receipt is malformed",
                )
            })?;
            if receipt.lineage != lineage
                || receipt.database_file
                    != database_path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                || lineage.promotable
            {
                return Err(fork_error(
                    "SNAPBACK_FORK_EVIDENCE_MISMATCH",
                    "fork lineage and mint receipt do not identify the same non-promotable instance",
                ));
            }
            validate_minted_sidecars(database_path)?;
            Ok(Some(DerivedForkRuntime {
                database_path: database_path.to_path_buf(),
                lineage,
            }))
        }
        _ => Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
            "fork lineage and mint receipt must either both be present or both be absent",
        )),
    }
}

fn validate_minted_sidecars(database_path: &Path) -> SnapbackResult<()> {
    fn require_regular(path: &Path, sidecar: &'static str) -> SnapbackResult<()> {
        let metadata = fs::symlink_metadata(path).map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                fork_error(
                    "SNAPBACK_FORK_SIDECAR_MISSING",
                    format!("required minted {sidecar} sidecar is missing"),
                )
                .with_details(json!({ "sidecar": sidecar }))
            } else {
                io_error("inspect minted fork sidecar", error)
            }
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(fork_error(
                "SNAPBACK_FORK_SIDECAR_MALFORMED",
                format!("minted {sidecar} sidecar is not a regular file"),
            )
            .with_details(json!({ "sidecar": sidecar })));
        }
        Ok(())
    }

    let admin_path = snapback_auth::auth::admin_token::admin_token_sibling(database_path);
    require_regular(&admin_path, "admin-token")?;
    let admin = crate::secure_file::read_owner_only(&admin_path).map_err(|_| {
        fork_error(
            "SNAPBACK_FORK_SIDECAR_MALFORMED",
            "minted admin-token sidecar cannot be read with owner-only custody",
        )
        .with_details(json!({ "sidecar": "admin-token" }))
    })?;
    let admin = std::str::from_utf8(&admin)
        .map_err(|_| {
            fork_error(
                "SNAPBACK_FORK_SIDECAR_MALFORMED",
                "minted admin-token sidecar is not UTF-8",
            )
            .with_details(json!({ "sidecar": "admin-token" }))
        })?
        .trim();
    if admin.len() != 37 || !admin.starts_with("sbat_") {
        return Err(fork_error(
            "SNAPBACK_FORK_SIDECAR_MALFORMED",
            "minted admin-token sidecar does not contain a Snapback admin token",
        )
        .with_details(json!({ "sidecar": "admin-token" })));
    }
    let auth_path = crate::auth::keyring::AuthKeyringStore::keyring_path(database_path);
    require_regular(&auth_path, "auth-keyring")?;
    crate::auth::keyring::AuthKeyringStore::file_for_database(database_path)
        .load_existing()
        .map_err(|_| {
            fork_error(
                "SNAPBACK_FORK_SIDECAR_MALFORMED",
                "minted auth-keyring sidecar is malformed",
            )
            .with_details(json!({ "sidecar": "auth-keyring" }))
        })?;
    let resume_path = database_path.with_file_name(crate::rqs_contract::RESUME_KEYRING_FILE_NAME);
    require_regular(&resume_path, "resume-keyring")?;
    if !snapback_kernel::instance_fork::persisted_resume_file_has_active_key(&resume_path) {
        return Err(fork_error(
            "SNAPBACK_FORK_SIDECAR_MALFORMED",
            "minted resume-keyring sidecar has no active key",
        )
        .with_details(json!({ "sidecar": "resume-keyring" })));
    }
    let operation_detail_path = crate::operation_detail::keyring_path(database_path);
    require_regular(&operation_detail_path, "operation-detail-keyring")?;
    if !crate::operation_detail::persisted_file_has_key(database_path) {
        return Err(fork_error(
            "SNAPBACK_FORK_SIDECAR_MALFORMED",
            "minted operation-detail-keyring sidecar has no valid key",
        )
        .with_details(json!({ "sidecar": "operation-detail-keyring" })));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublicationCut {
    AfterSentinelWrite,
    AfterSentinelDirectorySync,
    AfterClone,
    AfterAdminSidecar,
    AfterAuthSidecar,
    AfterResumeSidecar,
    AfterDatabaseMint,
    AfterMintReceipt,
    AfterSqliteDatabaseSync,
    AfterSqliteWalSync,
    AfterSqliteShmSync,
    AfterSqliteJournalSync,
    AfterSqliteSync,
    AfterAssetCopy,
    AfterStagingDirectorySync,
    AfterRegistryIntent,
    AfterRename,
    AfterParentDirectorySync,
    AfterRegistryFinalize,
    AfterSentinelUnlink,
    AfterPublishedDirectorySync,
}

fn crash(cut: PublicationCut) -> SnapbackError {
    fork_error(
        "SNAPBACK_FORK_TEST_CRASH_CUT",
        format!("injected crash after {cut:?}"),
    )
}

fn maybe_cut(cut_at: Option<PublicationCut>, point: PublicationCut) -> SnapbackResult<()> {
    if cut_at == Some(point) {
        Err(crash(point))
    } else {
        Ok(())
    }
}

fn registry_path(parent: &Path, fork_id: &str) -> PathBuf {
    parent
        .join(REGISTRY_DIRECTORY)
        .join(format!("{fork_id}.json"))
}

fn registry_entry(
    state: &str,
    destination: &Path,
    receipt: &ForkMintReceiptV1,
    app_binding: Option<&ForkAppBindingReceiptV1>,
) -> ForkRegistryEntryV1 {
    ForkRegistryEntryV1 {
        format_version: 1,
        state: state.to_owned(),
        destination: destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_owned(),
        lineage: receipt.lineage.clone(),
        database_file: receipt.database_file.clone(),
        ready_file: None,
        app_root: app_binding.map(|binding| binding.canonical_app_root.clone()),
    }
}

fn reconcile_registry(parent: &Path, destination: &Path, receipt: &ForkMintReceiptV1) {
    // Advisory bookkeeping must never become recovery authority. Reconcile
    // when reachable and deliberately discard every registry error.
    let _ = (|| -> SnapbackResult<()> {
        let directory = parent.join(REGISTRY_DIRECTORY);
        fs::create_dir_all(&directory)
            .map_err(|error| io_error("create fork registry during recovery", error))?;
        let app_binding = read_fork_app_binding(destination, receipt)?;
        write_json_sync(
            &registry_path(parent, &receipt.lineage.fork_id),
            &registry_entry("published", destination, receipt, Some(&app_binding)),
        )?;
        sync_directory(&directory)
    })();
}

/// Publish a derived deployment using rename as the sole authoritative commit.
/// `cut_at` exists only for the exhaustive crash matrix.
///
/// @ref LLP 0158#design-sketch — S0-S5 local evidence is authoritative;
/// registry state is reconciled bookkeeping and never boot authority.
pub fn publish(
    source_database: &Path,
    destination: &Path,
    app_id: &str,
    parent_instance_id: &str,
    now_ms: u64,
    cut_at: Option<PublicationCut>,
) -> SnapbackResult<ForkMintReceiptV1> {
    publish_with_options(
        source_database,
        destination,
        app_id,
        parent_instance_id,
        now_ms,
        cut_at,
        false,
        None,
        false,
        None,
    )
}

/// Product-level F0b publication. Unlike the lower-level crash-matrix entry
/// point, this always stamps a finite expiry and records an explicit choice
/// about the only inheritable secret carrier (the database config sibling).
// @ref LLP 0158#implementation-path-local-v1-explored-2026-08-03 — F0b
// packages F0a with a finite TTL and optional, explicit config inheritance.
#[allow(clippy::too_many_arguments)]
pub fn publish_managed(
    source_database: &Path,
    destination: &Path,
    expected: &ExpectedForkAppV1,
    parent_instance_id: &str,
    now_ms: u64,
    expires_at_ms: u64,
    with_secrets: bool,
) -> SnapbackResult<ForkMintReceiptV1> {
    publish_managed_with_base(
        source_database,
        destination,
        expected,
        parent_instance_id,
        now_ms,
        expires_at_ms,
        with_secrets,
        false,
    )
}

/// [`publish_managed`] with an opt-in retained post-mint base snapshot, the
/// local target's chosen substrate for the exact net diff. Retention doubles
/// the fork's byte footprint; creation admission accounts for it.
#[allow(clippy::too_many_arguments)]
pub fn publish_managed_with_base(
    source_database: &Path,
    destination: &Path,
    expected: &ExpectedForkAppV1,
    parent_instance_id: &str,
    now_ms: u64,
    expires_at_ms: u64,
    with_secrets: bool,
    retain_base: bool,
) -> SnapbackResult<ForkMintReceiptV1> {
    // @ref LLP 0158#design-sketch — managed S0 starts with canonical invoking
    // app identity, so a never-launched fork carries the same lifecycle
    // authority evidence as one that later publishes runtime readiness.
    validate_expected_app(expected)?;
    if expires_at_ms <= now_ms || expires_at_ms > crate::manifest::PORTABLE_TIMESTAMP_MAX_MS {
        return Err(fork_error(
            "SNAPBACK_FORK_TTL_INVALID",
            "fork expiry must be later than creation and within the portable timestamp range",
        ));
    }
    if expires_at_ms.saturating_sub(now_ms) > MANAGED_FORK_MAX_LIFETIME_MS {
        return Err(fork_error(
            RESOURCE_LIMIT_REFUSED_CODE,
            "fork create refused: the requested TTL exceeds the maximum fork lifetime",
        )
        .with_details(json!({
            "resource": "fork-lifetime",
            "requestedExpiresAtMs": expires_at_ms,
            "maxLifetimeMs": MANAGED_FORK_MAX_LIFETIME_MS,
        })));
    }
    publish_with_options(
        source_database,
        destination,
        &expected.app_id,
        parent_instance_id,
        now_ms,
        None,
        with_secrets,
        Some(expires_at_ms),
        retain_base,
        Some(expected),
    )
}

/// Attach the independently written runtime handshake to advisory lifecycle
/// bookkeeping. The fork remains self-authenticating from its local evidence;
/// this update exists for list/drop/reap ergonomics only.
pub fn record_managed_runtime(
    fork_root: &Path,
    fork_id: &str,
    ready_file: &Path,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ForkRegistryEntryV1> {
    let target = managed_target(fork_root, fork_id, expected)?;
    let path = registry_path(fork_root, fork_id);
    let mut entry = target.entry;
    let destination = target.destination;
    let ready_parent = ready_file.parent().ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_READY_INVALID",
            "managed ready file has no parent",
        )
    })?;
    let ready_parent = fs::canonicalize(ready_parent)
        .map_err(|error| io_error("resolve managed ready-file parent", error))?;
    if ready_parent != destination {
        return Err(fork_error(
            "SNAPBACK_FORK_READY_INVALID",
            "managed ready file must be a direct child of the fork directory",
        ));
    }
    entry.state = "ready".to_owned();
    let ready_name = ready_file.file_name().ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_READY_INVALID",
            "managed ready file has no file name",
        )
    })?;
    entry.ready_file = Some(destination.join(ready_name).display().to_string());
    entry.app_root = Some(target.app_binding.canonical_app_root);
    write_json_sync(&path, &entry)?;
    sync_directory(&fork_root.join(REGISTRY_DIRECTORY))?;
    Ok(entry)
}

/// Enumerate the fork ids recorded in the advisory registry without binding
/// them to local evidence. Lifecycle sweeps use this so one stale or
/// concurrently-removed entry cannot wedge every other fork's cleanup.
pub fn managed_registry_ids(fork_root: &Path) -> SnapbackResult<Vec<String>> {
    let registry = fork_root.join(REGISTRY_DIRECTORY);
    if !registry.exists() {
        return Ok(Vec::new());
    }
    let registry_metadata = fs::symlink_metadata(&registry)
        .map_err(|error| io_error("inspect fork registry", error))?;
    if registry_metadata.file_type().is_symlink() || !registry_metadata.is_dir() {
        return Err(fork_error(
            "SNAPBACK_FORK_REGISTRY_INVALID",
            "fork registry is not a real directory",
        ));
    }
    let mut ids = Vec::new();
    for child in fs::read_dir(&registry).map_err(|error| io_error("scan fork registry", error))? {
        let child = child.map_err(|error| io_error("read fork registry entry", error))?;
        if child.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let recorded_id = child
            .path()
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or_else(|| {
                fork_error(
                    "SNAPBACK_FORK_REGISTRY_INVALID",
                    "registry entry needs a UTF-8 fork-id file name",
                )
            })?
            .to_owned();
        validate_fork_id(&recorded_id)?;
        ids.push(recorded_id);
    }
    ids.sort();
    Ok(ids)
}

pub fn list_managed(
    fork_root: &Path,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<Vec<ForkRegistryEntryV1>> {
    let mut entries = Vec::new();
    for recorded_id in managed_registry_ids(fork_root)? {
        entries.push(managed_target(fork_root, &recorded_id, expected)?.entry);
    }
    entries.sort_by(|left, right| left.lineage.fork_id.cmp(&right.lineage.fork_id));
    Ok(entries)
}

pub fn managed_entry(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ForkRegistryEntryV1> {
    Ok(managed_target(fork_root, fork_id, expected)?.entry)
}

fn validate_fork_id(fork_id: &str) -> SnapbackResult<()> {
    if Uuid::parse_str(fork_id).is_err() {
        return Err(fork_error(
            "SNAPBACK_FORK_ID_INVALID",
            "fork id must be a UUID",
        ));
    }
    Ok(())
}

fn validate_registry_destination(destination: &str) -> SnapbackResult<()> {
    let mut components = Path::new(destination).components();
    if destination.is_empty()
        || !matches!(components.next(), Some(std::path::Component::Normal(_)))
        || components.next().is_some()
    {
        return Err(fork_error(
            "SNAPBACK_FORK_REGISTRY_INVALID",
            "registry destination is not one direct child of the fork root",
        ));
    }
    Ok(())
}

fn validate_direct_child_name(value: &str, what: &'static str) -> SnapbackResult<()> {
    let mut components = Path::new(value).components();
    if value.is_empty()
        || !matches!(components.next(), Some(std::path::Component::Normal(_)))
        || components.next().is_some()
    {
        return Err(fork_error(
            "SNAPBACK_FORK_REGISTRY_INVALID",
            format!("registry {what} is not one direct-child file name"),
        ));
    }
    Ok(())
}

fn load_registry_entry(fork_root: &Path, fork_id: &str) -> SnapbackResult<ForkRegistryEntryV1> {
    validate_fork_id(fork_id)?;
    let registry_directory = fork_root.join(REGISTRY_DIRECTORY);
    let registry_metadata = fs::symlink_metadata(&registry_directory).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            fork_error(
                "SNAPBACK_FORK_NOT_FOUND",
                "the requested fork is not in this lifecycle registry",
            )
        } else {
            io_error("inspect fork registry directory", error)
        }
    })?;
    if registry_metadata.file_type().is_symlink() || !registry_metadata.is_dir() {
        return Err(fork_error(
            "SNAPBACK_FORK_REGISTRY_INVALID",
            "fork registry is not a real directory",
        ));
    }
    let path = registry_path(fork_root, fork_id);
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            fork_error(
                "SNAPBACK_FORK_NOT_FOUND",
                "the requested fork is not in this lifecycle registry",
            )
        } else {
            io_error("inspect fork registry entry", error)
        }
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(fork_error(
            "SNAPBACK_FORK_REGISTRY_INVALID",
            "fork registry entry is not a real file",
        ));
    }
    let entry: ForkRegistryEntryV1 = serde_json::from_slice(
        &fs::read(&path).map_err(|error| io_error("read fork registry entry", error))?,
    )
    .map_err(|error| {
        fork_error(
            "SNAPBACK_FORK_REGISTRY_INVALID",
            format!("fork registry entry is malformed: {error}"),
        )
    })?;
    if entry.format_version != 1
        || entry.lineage.format_version != 1
        || entry.lineage.promotable
        || entry.lineage.fork_id != fork_id
        || !matches!(entry.state.as_str(), "intent" | "published" | "ready")
    {
        return Err(fork_error(
            "SNAPBACK_FORK_REGISTRY_INVALID",
            "fork registry identity, format, class, or state is invalid",
        ));
    }
    validate_registry_destination(&entry.destination)?;
    validate_direct_child_name(&entry.database_file, "databaseFile")?;
    Ok(entry)
}

fn validate_registry_app_binding(
    entry: &ForkRegistryEntryV1,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<()> {
    let recorded_root = entry.app_root.as_deref().ok_or_else(|| {
        fork_error(
            APP_BINDING_REQUIRED_CODE,
            "registry entry has no app-root identity; legacy/unbound lifecycle selection is refused",
        )
    })?;
    let expected_root = expected.canonical_app_root.to_str().ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_APP_ROOT_INVALID",
            "invoking app root must have a UTF-8 canonical path",
        )
    })?;
    if recorded_root != expected_root || entry.lineage.app_id != expected.app_id {
        return Err(fork_error(
            APP_BINDING_MISMATCH_CODE,
            "registry entry is bound to a different invoking app root or logical app id",
        )
        .with_details(json!({
            "expectedAppRoot": expected_root,
            "expectedAppId": expected.app_id,
        })));
    }
    Ok(())
}

/// Re-bind advisory lifecycle state to the fork's local mint receipt and DB
/// lineage before any read, signal, deletion, or expiry decision.
// @ref LLP 0158#design-sketch — registry state is advisory bookkeeping; local
// S0-S5 evidence is the authority for a derived deployment.
fn managed_target_evidence(fork_root: &Path, fork_id: &str) -> SnapbackResult<ManagedForkTargetV1> {
    let root = fs::canonicalize(fork_root)
        .map_err(|error| io_error("resolve managed fork root", error))?;
    let entry = load_registry_entry(&root, fork_id)?;
    let destination_path = root.join(&entry.destination);
    let destination_metadata = fs::symlink_metadata(&destination_path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            fork_error(
                "SNAPBACK_FORK_REGISTRY_STALE",
                "registry entry names a fork destination that no longer exists",
            )
            .with_details(json!({ "forkId": fork_id }))
        } else {
            io_error("inspect managed fork destination", error)
        }
    })?;
    if destination_metadata.file_type().is_symlink() || !destination_metadata.is_dir() {
        return Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_MISMATCH",
            "registered fork destination is not a real directory",
        ));
    }
    let destination = fs::canonicalize(&destination_path)
        .map_err(|error| io_error("resolve managed fork destination", error))?;
    if destination.parent() != Some(root.as_path())
        || destination.file_name() != Path::new(&entry.destination).file_name()
    {
        return Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_MISMATCH",
            "registered fork destination is not the named direct child of the fork root",
        ));
    }

    let database_path = destination.join(&entry.database_file);
    let database_metadata = fs::symlink_metadata(&database_path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            fork_error(
                "SNAPBACK_FORK_REGISTRY_STALE",
                "registry entry names a fork database that no longer exists",
            )
            .with_details(json!({ "forkId": fork_id }))
        } else {
            io_error("inspect managed fork database", error)
        }
    })?;
    if database_metadata.file_type().is_symlink() || !database_metadata.is_file() {
        return Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_MISMATCH",
            "registered fork database is not a real direct-child file",
        ));
    }
    let database = fs::canonicalize(&database_path)
        .map_err(|error| io_error("resolve managed fork database", error))?;
    if database.parent() != Some(destination.as_path()) {
        return Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_MISMATCH",
            "registered fork database resolves outside its fork directory",
        ));
    }

    let receipt_path = destination.join(MINT_RECEIPT_FILE);
    let receipt_metadata = fs::symlink_metadata(&receipt_path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            fork_error(
                "SNAPBACK_FORK_EVIDENCE_MISMATCH",
                "registered destination has no local fork mint receipt",
            )
        } else {
            io_error("inspect managed fork mint receipt", error)
        }
    })?;
    if receipt_metadata.file_type().is_symlink() || !receipt_metadata.is_file() {
        return Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_MISMATCH",
            "fork mint receipt is not a real direct-child file",
        ));
    }
    let receipt: ForkMintReceiptV1 = serde_json::from_slice(
        &fs::read(&receipt_path).map_err(|error| io_error("read fork mint receipt", error))?,
    )
    .map_err(|_| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            "fork mint receipt is malformed",
        )
    })?;
    let runtime = inspect_published_evidence(&database)?.ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
            "registered fork has no authoritative local lineage",
        )
    })?;
    if receipt.format_version != 1
        || receipt.database_file != entry.database_file
        || receipt.lineage != entry.lineage
        || runtime.lineage != entry.lineage
    {
        return Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_MISMATCH",
            "registry, mint receipt, and database lineage do not identify the same fork",
        ));
    }
    let app_binding = read_fork_app_binding(&destination, &receipt)?;
    let recorded_app_root = entry.app_root.as_deref().ok_or_else(|| {
        fork_error(
            APP_BINDING_REQUIRED_CODE,
            "registry entry has no app-root identity; legacy/unbound lifecycle selection is refused",
        )
    })?;
    if recorded_app_root != app_binding.canonical_app_root {
        return Err(fork_error(
            APP_BINDING_MISMATCH_CODE,
            "registry and fork-local app-root binding receipts disagree",
        ));
    }

    let ready_file = entry
        .ready_file
        .as_deref()
        .map(PathBuf::from)
        .map(|path| {
            let file_name = path.file_name().ok_or_else(|| {
                fork_error(
                    "SNAPBACK_FORK_READY_INVALID",
                    "managed ready file has no direct-child file name",
                )
            })?;
            let expected = destination.join(file_name);
            if path != expected {
                return Err(fork_error(
                    "SNAPBACK_FORK_READY_INVALID",
                    "managed ready file is not the exact direct child recorded for this fork",
                ));
            }
            match fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                    return Err(fork_error(
                        "SNAPBACK_FORK_READY_INVALID",
                        "managed ready file is not a real file",
                    ));
                }
                Ok(_) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(io_error("inspect managed ready file", error)),
            }
            Ok(path)
        })
        .transpose()?;

    Ok(ManagedForkTargetV1 {
        entry,
        receipt,
        app_binding,
        destination,
        database,
        ready_file,
    })
}

/// Re-bind advisory lifecycle state to local fork evidence and the invoking
/// app identity before returning any selected fork facts. Same-app-id roots
/// remain distinct; either the canonical root or logical id mismatch refuses.
// @ref LLP 0158#open-questions — OQ9 requires exact instance selection and
// rejects app-id-only control in every multi-instance lifecycle operation.
pub fn managed_target(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ManagedForkTargetV1> {
    validate_expected_app(expected)?;
    let root = fs::canonicalize(fork_root)
        .map_err(|error| io_error("resolve managed fork root", error))?;
    let registry_entry = load_registry_entry(&root, fork_id)?;
    validate_registry_app_binding(&registry_entry, expected)?;
    let target = managed_target_evidence(fork_root, fork_id)?;
    let expected_root = expected.canonical_app_root.to_str().ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_APP_ROOT_INVALID",
            "invoking app root must have a UTF-8 canonical path",
        )
    })?;
    if target.app_binding.canonical_app_root != expected_root
        || target.app_binding.app_id != expected.app_id
    {
        return Err(fork_error(
            APP_BINDING_MISMATCH_CODE,
            "selected fork is bound to a different invoking app root or logical app id",
        )
        .with_details(json!({
            "expectedAppRoot": expected_root,
            "expectedAppId": expected.app_id,
        })));
    }
    Ok(target)
}

/// A per-fork advisory lock serializing destructive lifecycle actions. A
/// cleanup actor that loses the race then observes complete absence
/// (`SNAPBACK_FORK_NOT_FOUND`) instead of a torn mid-teardown state — the
/// 2026-08-03 fleet-dogfood drop/reap race was exactly that torn window.
/// The serialization guarantee is Unix-only (flock); elsewhere the lock file
/// is advisory bookkeeping without mutual exclusion.
pub struct ForkCleanupLock {
    _file: File,
    path: PathBuf,
}

pub fn lock_cleanup(fork_root: &Path, fork_id: &str) -> SnapbackResult<ForkCleanupLock> {
    validate_fork_id(fork_id)?;
    let directory = fork_root.join(REGISTRY_DIRECTORY);
    fs::create_dir_all(&directory)
        .map_err(|error| io_error("create fork registry for cleanup lock", error))?;
    let path = directory.join(format!("{fork_id}.cleanup-lock"));
    let file = File::create(&path).map_err(|error| io_error("create fork cleanup lock", error))?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd as _;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(io_error(
                "acquire fork cleanup lock",
                std::io::Error::last_os_error(),
            ));
        }
    }
    Ok(ForkCleanupLock { _file: file, path })
}

impl ForkCleanupLock {
    /// Remove the lock file once the fork it guarded is fully gone. Actors
    /// already queued on this inode wake to plain absence; later actors
    /// create a fresh lock and equally observe absence.
    pub fn dispose(self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Remove exactly one registry-bound fork directory. Callers stop a live
/// child first; path validation prevents registry corruption from widening the
/// deletion target.
pub fn drop_managed(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ForkRegistryEntryV1> {
    let lock = lock_cleanup(fork_root, fork_id)?;
    let entry = drop_managed_locked(fork_root, fork_id, expected)?;
    lock.dispose();
    Ok(entry)
}

/// The teardown body. Callers must hold this fork's [`ForkCleanupLock`];
/// re-binding evidence under the lock is what makes concurrent cleanup
/// observe all-or-nothing states.
pub fn drop_managed_locked(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<ForkRegistryEntryV1> {
    let target = managed_target(fork_root, fork_id, expected)?;
    let entry = target.entry;
    // A concurrent drop/reap may win the directory removal between the
    // evidence re-bind above and this call. Duplicate cleanup of the same
    // fork is idempotent, not an I/O fault.
    match fs::remove_dir_all(&target.destination) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(io_error("drop fork directory", error)),
    }
    sync_directory(fork_root)?;
    let registry = registry_path(fork_root, fork_id);
    match fs::remove_file(&registry) {
        Ok(()) => sync_directory(&fork_root.join(REGISTRY_DIRECTORY))?,
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(io_error("remove fork registry entry", error)),
    }
    Ok(entry)
}

/// Complete a partial cleanup: remove one registry entry whose recorded fork
/// directory is already gone. Refuses while the destination still exists, so
/// this can never widen into deleting fork state — only stale bookkeeping.
pub fn clear_stale_registry_entry(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<()> {
    let lock = lock_cleanup(fork_root, fork_id)?;
    clear_stale_registry_entry_locked(fork_root, fork_id, expected)?;
    lock.dispose();
    Ok(())
}

/// See [`clear_stale_registry_entry`]; callers must hold the cleanup lock.
pub fn clear_stale_registry_entry_locked(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<()> {
    let root = fs::canonicalize(fork_root)
        .map_err(|error| io_error("resolve managed fork root", error))?;
    let entry = load_registry_entry(&root, fork_id)?;
    validate_registry_app_binding(&entry, expected)?;
    if root.join(&entry.destination).exists() {
        return Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_MISMATCH",
            "registry entry is not stale: its recorded fork destination still exists",
        )
        .with_details(json!({ "forkId": fork_id })));
    }
    match fs::remove_file(registry_path(&root, fork_id)) {
        Ok(()) => sync_directory(&root.join(REGISTRY_DIRECTORY)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error("remove stale fork registry entry", error)),
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ForkRenewIntentV1 {
    format_version: u32,
    lineage: DerivedForkLineageV1,
    previous_expires_at_ms: u64,
    renewed_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenewCut {
    AfterSentinelWrite,
    AfterIntentWrite,
    AfterDatabaseUpdate,
    AfterReceiptRewrite,
    AfterRegistryRewrite,
    AfterRenewReceipt,
    AfterIntentRemoval,
}

fn maybe_renew_cut(cut_at: Option<RenewCut>, point: RenewCut) -> SnapbackResult<()> {
    if cut_at == Some(point) {
        Err(fork_error(
            "SNAPBACK_FORK_TEST_CRASH_CUT",
            format!("injected crash after {point:?}"),
        ))
    } else {
        Ok(())
    }
}

/// Extend one managed fork's finite expiry (LLP 0185 Phase 3 item 6).
/// Renewal requires the exact registry-bound identity, refuses an already-
/// expired fork (expiry is authority, not advisory metadata to resurrect),
/// must strictly move the expiry later — it can never shorten or clear it —
/// and is bounded by [`MANAGED_FORK_MAX_LIFETIME_MS`] from creation. The
/// three expiry carriers (database lineage, mint receipt, registry entry)
/// update behind a staging sentinel plus a renewal-intent file so a crash at
/// any point recovers to one consistent expiry via [`recover`].
pub fn renew_managed(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
    now_ms: u64,
    ttl_ms: u64,
) -> SnapbackResult<ForkRenewReceiptV1> {
    renew_managed_with_cut(fork_root, fork_id, expected, now_ms, ttl_ms, None)
}

/// Deterministic crash-cut entry used by the executable acceptance corpus.
/// Product callers use [`renew_managed`].
#[doc(hidden)]
pub fn renew_managed_with_crash_cut_for_test(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
    now_ms: u64,
    ttl_ms: u64,
    cut: RenewCut,
) -> SnapbackResult<ForkRenewReceiptV1> {
    renew_managed_with_cut(fork_root, fork_id, expected, now_ms, ttl_ms, Some(cut))
}

fn renew_managed_with_cut(
    fork_root: &Path,
    fork_id: &str,
    expected: &ExpectedForkAppV1,
    now_ms: u64,
    ttl_ms: u64,
    cut_at: Option<RenewCut>,
) -> SnapbackResult<ForkRenewReceiptV1> {
    let _lock = lock_cleanup(fork_root, fork_id)?;
    let target = managed_target(fork_root, fork_id, expected)?;
    let lineage = target.receipt.lineage.clone();
    let previous_expires_at_ms = lineage.expires_at_ms.ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_TTL_INVALID",
            "only finite managed forks can renew",
        )
    })?;
    if previous_expires_at_ms <= now_ms {
        return Err(fork_error(
            RENEW_EXPIRED_CODE,
            "renewal refused: the fork is already past its finite expiry; reap it and create a fresh fork",
        )
        .with_details(json!({
            "forkId": lineage.fork_id,
            "expiresAtMs": previous_expires_at_ms,
            "observedAtMs": now_ms,
        })));
    }
    let expires_at_ms = now_ms
        .checked_add(ttl_ms)
        .filter(|expiry| *expiry <= crate::manifest::PORTABLE_TIMESTAMP_MAX_MS)
        .ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_TTL_INVALID",
                "renewed expiry exceeds the portable clock",
            )
        })?;
    if expires_at_ms <= previous_expires_at_ms {
        return Err(fork_error(
            "SNAPBACK_FORK_TTL_INVALID",
            "renewal must move the finite expiry later; it never shortens or clears it",
        )
        .with_details(json!({
            "expiresAtMs": previous_expires_at_ms,
            "requestedExpiresAtMs": expires_at_ms,
        })));
    }
    if expires_at_ms.saturating_sub(lineage.created_at_ms) > MANAGED_FORK_MAX_LIFETIME_MS {
        return Err(fork_error(
            RESOURCE_LIMIT_REFUSED_CODE,
            "renewal refused: requested expiry exceeds the configured maximum fork lifetime",
        )
        .with_details(json!({
            "resource": "renewal-lifetime",
            "createdAtMs": lineage.created_at_ms,
            "requestedExpiresAtMs": expires_at_ms,
            "maxLifetimeMs": MANAGED_FORK_MAX_LIFETIME_MS,
        })));
    }

    let mut renewed = lineage;
    renewed.expires_at_ms = Some(expires_at_ms);
    let sentinel = target.destination.join(STAGING_SENTINEL);
    File::create(&sentinel)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("write fork renewal sentinel", error))?;
    sync_directory(&target.destination)?;
    maybe_renew_cut(cut_at, RenewCut::AfterSentinelWrite)?;
    let intent = ForkRenewIntentV1 {
        format_version: 1,
        lineage: renewed.clone(),
        previous_expires_at_ms,
        renewed_at_ms: now_ms,
    };
    write_json_sync(&target.destination.join(RENEW_INTENT_FILE), &intent)?;
    sync_directory(&target.destination)?;
    maybe_renew_cut(cut_at, RenewCut::AfterIntentWrite)?;
    apply_renewal(
        fork_root,
        &target.destination,
        &target.database,
        &intent,
        cut_at,
    )
}

/// Carry a validated renewal intent through every expiry carrier. Idempotent:
/// the crash-recovery path re-runs it from the durable intent file. Both live
/// renewal and recovery leave the registry in exact lineage agreement before
/// the sentinel clears; ordinary failures compensate to the previous cut.
fn apply_renewal(
    fork_root: &Path,
    destination: &Path,
    database: &Path,
    intent: &ForkRenewIntentV1,
    cut_at: Option<RenewCut>,
) -> SnapbackResult<ForkRenewReceiptV1> {
    let renewed = &intent.lineage;
    let receipt_path = destination.join(MINT_RECEIPT_FILE);
    let original_mint_bytes = fs::read(&receipt_path)
        .map_err(|error| io_error("read fork receipt for renewal", error))?;
    let original_mint: ForkMintReceiptV1 =
        serde_json::from_slice(&original_mint_bytes).map_err(|_| {
            fork_error(
                "SNAPBACK_FORK_RECEIPT_INVALID",
                "fork mint receipt is malformed",
            )
        })?;
    let mut previous_lineage = renewed.clone();
    previous_lineage.expires_at_ms = Some(intent.previous_expires_at_ms);
    let mut rollback_mint = original_mint.clone();
    rollback_mint.lineage = previous_lineage.clone();
    let rollback_mint_bytes = serde_json::to_vec(&rollback_mint).map_err(|error| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            format!("encode rollback mint receipt: {error}"),
        )
    })?;
    let mut renewed_mint = original_mint.clone();
    renewed_mint.lineage = renewed.clone();
    let registry_file = registry_path(fork_root, &renewed.fork_id);
    let rollback_registry_bytes = fs::read(&registry_file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ForkRegistryEntryV1>(&bytes).ok())
        .map(|mut entry| {
            entry.lineage = previous_lineage.clone();
            serde_json::to_vec(&entry).map_err(|error| {
                fork_error(
                    "SNAPBACK_FORK_REGISTRY_INVALID",
                    format!("encode rollback registry entry: {error}"),
                )
            })
        })
        .transpose()?
        .or_else(|| {
            read_fork_app_binding(destination, &rollback_mint)
                .ok()
                .and_then(|binding| {
                    serde_json::to_vec(&registry_entry(
                        "published",
                        destination,
                        &rollback_mint,
                        Some(&binding),
                    ))
                    .ok()
                })
        });
    let renew_receipt_path = destination.join(RENEW_RECEIPT_FILE);
    let rollback_renew_receipt_bytes = fs::read(&renew_receipt_path).ok().filter(|bytes| {
        serde_json::from_slice::<ForkRenewReceiptV1>(bytes)
            .ok()
            .is_some_and(|receipt| receipt.expires_at_ms == intent.previous_expires_at_ms)
    });

    let result = (|| -> SnapbackResult<ForkRenewReceiptV1> {
        write_renewal_database_lineage(database, renewed, true)?;
        maybe_renew_cut(cut_at, RenewCut::AfterDatabaseUpdate)?;

        replace_json_sync(&receipt_path, &renewed_mint)?;
        maybe_renew_cut(cut_at, RenewCut::AfterReceiptRewrite)?;

        // The registry entry must return to exact lineage equality or
        // managed_target refuses the fork. Recovery rebuilds a missing or
        // malformed advisory row, but it must durably publish the rebuilt row
        // before the sentinel can clear.
        let registry = registry_path(fork_root, &renewed.fork_id);
        let registry_directory = fork_root.join(REGISTRY_DIRECTORY);
        fs::create_dir_all(&registry_directory)
            .map_err(|error| io_error("create fork registry for renewal", error))?;
        let app_binding = read_fork_app_binding(destination, &renewed_mint)?;
        let mut entry = fs::read(&registry)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ForkRegistryEntryV1>(&bytes).ok())
            .unwrap_or_else(|| {
                registry_entry("published", destination, &renewed_mint, Some(&app_binding))
            });
        entry.lineage = renewed.clone();
        entry.app_root = Some(app_binding.canonical_app_root);
        replace_json_sync(&registry, &entry)?;
        sync_directory(&registry_directory)?;
        maybe_renew_cut(cut_at, RenewCut::AfterRegistryRewrite)?;

        let receipt = ForkRenewReceiptV1 {
            schema_version: "snapback.fork-renew.v1".to_owned(),
            fork_id: renewed.fork_id.clone(),
            renewed_at_ms: intent.renewed_at_ms,
            previous_expires_at_ms: intent.previous_expires_at_ms,
            expires_at_ms: renewed.expires_at_ms.expect("renewed lineage is finite"),
            created_at_ms: renewed.created_at_ms,
            max_lifetime_ms: MANAGED_FORK_MAX_LIFETIME_MS,
        };
        replace_json_sync(&renew_receipt_path, &receipt)?;
        maybe_renew_cut(cut_at, RenewCut::AfterRenewReceipt)?;
        fs::remove_file(destination.join(RENEW_INTENT_FILE))
            .map_err(|error| io_error("remove fork renewal intent", error))?;
        maybe_renew_cut(cut_at, RenewCut::AfterIntentRemoval)?;
        fs::remove_file(destination.join(STAGING_SENTINEL))
            .map_err(|error| io_error("remove fork renewal sentinel", error))?;
        sync_directory(destination)?;
        Ok(receipt)
    })();

    match result {
        Ok(receipt) => Ok(receipt),
        Err(error) if error.diagnostic.code == "SNAPBACK_FORK_TEST_CRASH_CUT" => Err(error),
        Err(error) => {
            let rollback = rollback_renewal(
                fork_root,
                destination,
                database,
                intent,
                &rollback_mint_bytes,
                rollback_registry_bytes.as_deref(),
                rollback_renew_receipt_bytes.as_deref(),
            );
            match rollback {
                Ok(()) => Err(error.with_details(json!({
                    "renewalRollback": "previous-cut-restored",
                }))),
                Err(rollback_error) => Err(error.with_details(json!({
                    "renewalRollback": "incomplete-recover-required",
                    "rollbackCode": rollback_error.diagnostic.code,
                }))),
            }
        }
    }
}

fn write_renewal_database_lineage(
    database: &Path,
    lineage: &DerivedForkLineageV1,
    checkpoint_first: bool,
) -> SnapbackResult<()> {
    crate::storage::renew_derived_fork_lineage_v1(database, lineage, checkpoint_first)?;
    sync_sqlite_files(database, None)
}

fn rollback_renewal(
    fork_root: &Path,
    destination: &Path,
    database: &Path,
    intent: &ForkRenewIntentV1,
    original_mint_bytes: &[u8],
    original_registry_bytes: Option<&[u8]>,
    original_renew_receipt_bytes: Option<&[u8]>,
) -> SnapbackResult<()> {
    let sentinel = destination.join(STAGING_SENTINEL);
    File::create(&sentinel)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("restore fork renewal sentinel for rollback", error))?;
    sync_directory(destination)?;

    let mut previous = intent.lineage.clone();
    previous.expires_at_ms = Some(intent.previous_expires_at_ms);
    write_renewal_database_lineage(database, &previous, true)?;
    replace_bytes_sync(&destination.join(MINT_RECEIPT_FILE), original_mint_bytes)?;

    let registry = registry_path(fork_root, &intent.lineage.fork_id);
    match original_registry_bytes {
        Some(bytes) => replace_bytes_sync(&registry, bytes)?,
        None => match fs::remove_file(&registry) {
            Ok(()) => sync_directory(&fork_root.join(REGISTRY_DIRECTORY))?,
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("remove rolled-back renewal registry", error)),
        },
    }
    let renewal_receipt = destination.join(RENEW_RECEIPT_FILE);
    match original_renew_receipt_bytes {
        Some(bytes) => replace_bytes_sync(&renewal_receipt, bytes)?,
        None => match fs::remove_file(&renewal_receipt) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("remove rolled-back renewal receipt", error)),
        },
    }
    match fs::remove_file(destination.join(RENEW_INTENT_FILE)) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(io_error("remove rolled-back renewal intent", error)),
    }
    fs::remove_file(&sentinel)
        .map_err(|error| io_error("remove rolled-back renewal sentinel", error))?;
    sync_directory(destination)
}

fn database_set_size(database_path: &Path) -> SnapbackResult<u64> {
    let mut total = 0;
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = PathBuf::from(format!("{}{suffix}", database_path.display()));
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() => total += metadata.len(),
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("measure fork source database", error)),
        }
    }
    Ok(total)
}

pub fn directory_tree_bytes(path: &Path) -> SnapbackResult<u64> {
    let mut total = 0;
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(io_error("measure fork root usage", error)),
        };
        for entry in entries {
            let entry = entry.map_err(|error| io_error("measure fork root usage", error))?;
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(io_error("measure fork root usage", error)),
            };
            if metadata.is_dir() {
                stack.push(entry.path());
            } else if metadata.is_file() {
                total += metadata.len();
            }
        }
    }
    Ok(total)
}

/// Deterministic admission for `fork create` (LLP 0185 Phase 3 item 7): the
/// fork-count, per-fork-byte, and total-byte bounds refuse *before* any
/// staging I/O, with the observed usage in the diagnostic. The byte check is
/// an estimate from the source database set; it exists to refuse oversized
/// parents predictably, not to meter the copy after the fact.
pub fn enforce_creation_limits(
    fork_root: &Path,
    source_database: &Path,
    limits: &ForkResourceLimits,
    retain_base: bool,
) -> SnapbackResult<ForkResourceUsageV1> {
    let fork_count = managed_registry_ids(fork_root)?.len();
    if fork_count >= limits.max_forks {
        return Err(fork_error(
            RESOURCE_LIMIT_REFUSED_CODE,
            "fork create refused: the managed fork-count limit is reached; drop or reap a fork first",
        )
        .with_details(json!({
            "resource": "fork-count",
            "limit": limits.max_forks,
            "currentForkCount": fork_count,
        })));
    }
    let copies = if retain_base { 2 } else { 1 };
    let parent_assets = source_database
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("assets")
        .join("blobs");
    let estimated_fork_bytes = database_set_size(source_database)?
        .saturating_mul(copies)
        .saturating_add(directory_tree_bytes(&parent_assets)?);
    if estimated_fork_bytes > limits.max_fork_bytes {
        return Err(fork_error(
            RESOURCE_LIMIT_REFUSED_CODE,
            "fork create refused: the source database set exceeds the per-fork byte limit",
        )
        .with_details(json!({
            "resource": "fork-bytes",
            "limitBytes": limits.max_fork_bytes,
            "estimatedBytes": estimated_fork_bytes,
        })));
    }
    let existing_bytes = directory_tree_bytes(fork_root)?;
    if existing_bytes.saturating_add(estimated_fork_bytes) > limits.max_total_bytes {
        return Err(fork_error(
            RESOURCE_LIMIT_REFUSED_CODE,
            "fork create refused: existing forks plus this copy exceed the total byte budget",
        )
        .with_details(json!({
            "resource": "total-bytes",
            "limitBytes": limits.max_total_bytes,
            "existingBytes": existing_bytes,
            "estimatedBytes": estimated_fork_bytes,
        })));
    }
    Ok(ForkResourceUsageV1 {
        fork_count,
        existing_bytes,
        estimated_fork_bytes,
    })
}

/// Root-wide admission guard. The caller keeps this value alive from the
/// count/byte observation through registry intent and directory publication,
/// making a boundary decision linearizable across concurrent creators.
pub struct ForkCreationAdmission {
    _file: File,
    usage: ForkResourceUsageV1,
}

impl ForkCreationAdmission {
    pub fn usage(&self) -> ForkResourceUsageV1 {
        self.usage
    }
}

pub fn admit_creation(
    fork_root: &Path,
    source_database: &Path,
    limits: &ForkResourceLimits,
    retain_base: bool,
) -> SnapbackResult<ForkCreationAdmission> {
    admit_creation_with_timeout(
        fork_root,
        source_database,
        limits,
        retain_base,
        Duration::from_millis(FORK_CREATION_ADMISSION_TIMEOUT_MS),
    )
}

fn admit_creation_with_timeout(
    fork_root: &Path,
    source_database: &Path,
    limits: &ForkResourceLimits,
    retain_base: bool,
    timeout: Duration,
) -> SnapbackResult<ForkCreationAdmission> {
    let registry = fork_root.join(REGISTRY_DIRECTORY);
    fs::create_dir_all(&registry)
        .map_err(|error| io_error("create fork registry for admission lock", error))?;
    let path = registry.join("root.admission-lock");
    let file = fs::OpenOptions::new()
        .create(true)
        // This file is an admission lock, not an output payload. Existing
        // contents must survive every opener; no caller writes through it.
        .truncate(false)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|error| io_error("open fork admission lock", error))?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd as _;
        // @ref LLP 0158#lifecycle-and-gc — quota linearization is required,
        // but a crashed or externally wedged creator cannot leave every later
        // lifecycle request sleeping forever in a blocking `flock`.
        let started = Instant::now();
        loop {
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
                break;
            }
            let error = std::io::Error::last_os_error();
            if error.kind() != ErrorKind::WouldBlock {
                return Err(io_error("acquire fork-root admission lock", error));
            }
            let elapsed = started.elapsed();
            if elapsed >= timeout {
                return Err(fork_error(
                    ADMISSION_TIMEOUT_CODE,
                    "fork create timed out waiting for the root-wide admission interval; inspect the active creator before retrying",
                )
                .with_details(json!({
                    "timeoutMs": timeout.as_millis().min(u128::from(u64::MAX)) as u64,
                })));
            }
            std::thread::park_timeout(
                timeout
                    .saturating_sub(elapsed)
                    .min(Duration::from_millis(FORK_CREATION_ADMISSION_POLL_MS)),
            );
        }
    }
    let usage = enforce_creation_limits(fork_root, source_database, limits, retain_base)?;
    Ok(ForkCreationAdmission { _file: file, usage })
}

/// Re-read the lineage currently persisted in a fork database, ignoring the
/// staging sentinel. The serving watchdog uses this at its expiry deadline so
/// a completed renewal extends the running server instead of being ignored.
pub fn refreshed_lineage(database_path: &Path) -> SnapbackResult<Option<DerivedForkLineageV1>> {
    Ok(inspect_evidence(database_path)?.map(|runtime| runtime.lineage))
}

pub fn expired_managed(
    fork_root: &Path,
    expected: &ExpectedForkAppV1,
    now_ms: u64,
) -> SnapbackResult<Vec<ForkRegistryEntryV1>> {
    if now_ms > crate::manifest::PORTABLE_TIMESTAMP_MAX_MS {
        return Err(fork_error(
            "SNAPBACK_FORK_REAP_CLOCK_INVALID",
            "reap clock exceeds the portable timestamp range",
        ));
    }
    Ok(list_managed(fork_root, expected)?
        .into_iter()
        .filter(|entry| {
            entry
                .lineage
                .expires_at_ms
                .is_some_and(|expires| expires <= now_ms)
        })
        .collect())
}

fn diff_commit_boundaries(
    conn: &Connection,
    database_path: &Path,
    runtime: &DerivedForkRuntime,
    observed_head_version: u64,
) -> SnapbackResult<(ForkDiffCommitBoundaryV1, ForkDiffCommitBoundaryV1)> {
    let directory = database_path.parent().unwrap_or_else(|| Path::new("."));
    let mint: ForkMintReceiptV1 = serde_json::from_slice(
        &fs::read(directory.join(MINT_RECEIPT_FILE))
            .map_err(|error| io_error("read fork mint receipt for diff boundary", error))?,
    )
    .map_err(|_| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            "fork mint receipt is malformed while binding diff boundaries",
        )
    })?;
    if mint.format_version != 1 || mint.lineage != runtime.lineage {
        return Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_MISMATCH",
            "fork mint receipt does not bind the diff base identity",
        ));
    }
    let head_stream =
        crate::seed_identity::strict_current_data_version_stream(conn)?.ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_EVIDENCE_MISMATCH",
                "fork diff head has no active data-version stream",
            )
        })?;
    if head_stream != mint.data_version_stream {
        return Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_MISMATCH",
            "fork diff cannot span a data-version stream rotation",
        )
        .with_details(json!({
            "baseDataVersionStream": mint.data_version_stream,
            "headDataVersionStream": head_stream,
        })));
    }
    Ok((
        ForkDiffCommitBoundaryV1 {
            data_version_stream: mint.data_version_stream.clone(),
            commit_version: runtime.lineage.fork_point_version,
            version_boundary: "exclusive".to_owned(),
        },
        ForkDiffCommitBoundaryV1 {
            data_version_stream: head_stream,
            commit_version: observed_head_version,
            version_boundary: "inclusive".to_owned(),
        },
    ))
}

/// Render the app-row-only inspection artifact promised by LLP 0158 with the
/// default diff-work bound. The explicit omissions are part of the contract,
/// not documentation garnish.
pub fn diff_receipt(database_path: &Path) -> SnapbackResult<ForkDiffReceiptV3> {
    diff_receipt_bounded(database_path, FORK_DIFF_MAX_ROWS)
}

/// [`diff_receipt`] with an explicit diff-work limit (LLP 0185 Phase 3 item
/// 7): a journal span larger than `max_rows` refuses deterministically with
/// the observed row count instead of materializing an unbounded receipt.
pub fn diff_receipt_bounded(
    database_path: &Path,
    max_rows: u64,
) -> SnapbackResult<ForkDiffReceiptV3> {
    // Diff is an offline lifecycle inspection surface, not serving admission.
    // It must remain available to explain or clean up an expired fork even
    // though LocalDatabase::open refuses to boot that same database.
    let runtime = inspect_published_evidence(database_path)?.ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
            "diff requires a minted derived deployment",
        )
    })?;
    let mut conn =
        open_fork_connection_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    // One read transaction pins the floor, head, and rows to the same SQLite
    // snapshot. A later writer can advance or prune without creating a
    // receipt whose header and body describe different moments.
    let tx = conn.transaction()?;
    let observed_head_version = tx.query_row(
        "SELECT version FROM _snapback_version WHERE id=1",
        [],
        |row| row.get::<_, u64>(0),
    )?;
    let retention_floor = crate::storage::change_journal_floor_on(&tx)?;
    if retention_floor > runtime.lineage.fork_point_version {
        return Err(fork_error(
            "SNAPBACK_FORK_DIFF_RETENTION_GAP",
            format!(
                "journal retention floor {retention_floor} is newer than fork point {}; an exact journal sequence is no longer available",
                runtime.lineage.fork_point_version
            ),
        ));
    }
    run_diff_after_header_hook();
    let journal_rows: u64 = tx.query_row(
        "SELECT COUNT(*)
           FROM _snapback_changes
          WHERE version > ?1
            AND table_name NOT GLOB '_snapback_*'
            AND table_name NOT GLOB '_auth_*'",
        [runtime.lineage.fork_point_version],
        |row| row.get(0),
    )?;
    if journal_rows > max_rows {
        return Err(fork_error(
            RESOURCE_LIMIT_REFUSED_CODE,
            "fork diff refused: the journal span exceeds the diff-work limit",
        )
        .with_details(json!({
            "resource": "diff-work",
            "limitRows": max_rows,
            "journalRows": journal_rows,
        })));
    }
    let mut statement = tx.prepare(
        "SELECT version,table_name,row_id,op,row_json
           FROM _snapback_changes
          WHERE version > ?1
            AND table_name NOT GLOB '_snapback_*'
            AND table_name NOT GLOB '_auth_*'
          ORDER BY version,id",
    )?;
    let rows = statement
        .query_map([runtime.lineage.fork_point_version], |row| {
            Ok((
                row.get::<_, u64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .map(|row| {
            let (version, table, row_id, operation, post_image) = row?;
            let post_image = post_image
                .map(|value| serde_json::from_str(&value))
                .transpose()
                .map_err(|error| {
                    fork_error(
                        "SNAPBACK_FORK_DIFF_INVALID",
                        format!("change journal post-image is malformed: {error}"),
                    )
                })?;
            Ok(ForkDiffRowV1 {
                version,
                table,
                row_id,
                operation,
                post_image,
            })
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    let mut table_counts = BTreeMap::new();
    for row in &rows {
        *table_counts.entry(row.table.clone()).or_insert(0) += 1;
    }
    let (base, head) = diff_commit_boundaries(&tx, database_path, &runtime, observed_head_version)?;
    let mut receipt = ForkDiffReceiptV3 {
        schema_version: "snapback.fork-journal-diff.v3".to_owned(),
        fork_id: runtime.lineage.fork_id,
        app_id: runtime.lineage.app_id,
        parent_instance_id: runtime.lineage.parent_instance_id,
        fork_point_version: runtime.lineage.fork_point_version,
        observed_head_version,
        base,
        head,
        attribution: "absent-v1".to_owned(),
        rows,
        table_counts,
        coverage: vec!["committed app-row journal entries in (base, head]".to_owned()],
        omissions: BTreeSet::from([
            "asset blob operations".to_owned(),
            "auth and credential state".to_owned(),
            "captured or refused egress payloads".to_owned(),
            "privileged or raw-SQL writes outside the app journal".to_owned(),
            "sidecar files and telemetry".to_owned(),
        ])
        .into_iter()
        .collect(),
        receipt_digest: String::new(),
    };
    receipt.receipt_digest = journal_diff_receipt_digest(&receipt)?;
    Ok(receipt)
}

fn verified_fork_app_row_coverage(
    conn: &Connection,
    directory: &Path,
    runtime: &DerivedForkRuntime,
) -> SnapbackResult<Option<ForkAppRowCoverageReceiptV1>> {
    if directory.join(APP_ROW_COVERAGE_GAP_FILE).exists() {
        return Err(writer_coverage_gap(
            "the fork recorded a registered-writer coverage gap; restoring older carrier bytes cannot re-earn completeness",
        ));
    }
    let file_path = directory.join(APP_ROW_COVERAGE_RECEIPT_FILE);
    let file_body = match fs::read(&file_path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == ErrorKind::NotFound => None,
        Err(error) => return Err(io_error("read fork app-row coverage receipt", error)),
    };
    let database_body = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key=?1",
            [APP_ROW_COVERAGE_META_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let (file_body, database_body) = match (file_body, database_body) {
        (None, None) => return Ok(None),
        (Some(file_body), Some(database_body)) => (file_body, database_body),
        _ => {
            return Err(writer_coverage_invalid(
                "derived-fork writer coverage evidence is present in only one durable carrier",
            ));
        }
    };
    let file_receipt: ForkAppRowCoverageReceiptV1 = serde_json::from_slice(&file_body)
        .map_err(|error| writer_coverage_invalid(format!("coverage file decode: {error}")))?;
    let database_receipt: ForkAppRowCoverageReceiptV1 = serde_json::from_str(&database_body)
        .map_err(|error| writer_coverage_invalid(format!("coverage database decode: {error}")))?;
    if file_receipt != database_receipt {
        return Err(writer_coverage_invalid(
            "database and filesystem writer coverage receipts disagree",
        ));
    }
    let receipt = file_receipt;
    if receipt.schema_version != "snapback.fork-app-row-coverage.v1"
        || receipt.profile != "derived-fork-app-rows-v1"
        || receipt.fork_id != runtime.lineage.fork_id
        || receipt.fork_point_version != runtime.lineage.fork_point_version
        || receipt.activation_head_version != runtime.lineage.fork_point_version
        || receipt.covered_lanes != fork_app_row_covered_lanes()
        || receipt.uncovered_lanes != fork_app_row_uncovered_lanes()
        || receipt.writer_choke_points != fork_app_row_writer_choke_points()
        || receipt.receipt_digest != fork_app_row_coverage_digest(&receipt)?
    {
        return Err(writer_coverage_invalid(
            "derived-fork writer coverage receipt does not bind the exact fork-point profile",
        ));
    }
    let stream = crate::seed_identity::strict_current_data_version_stream(conn)?
        .ok_or_else(|| writer_coverage_invalid("fork has no active data-version stream"))?;
    let manifest = crate::operation_ledger::active_coverage_manifest(conn, &stream)?
        .ok_or_else(|| writer_coverage_invalid("fork coverage manifest is no longer active"))?;
    let continuity = crate::operation_ledger::operation_coverage_continuity(conn, &stream)?
        .ok_or_else(|| writer_coverage_gap("fork coverage continuity evidence is missing"))?;
    if receipt.data_version_stream != stream
        || receipt.manifest_version != manifest.manifest_version
        || receipt.manifest_digest != manifest.coverage_digest
        || receipt.covered_lanes != manifest.covered_lanes
        || receipt.writer_choke_points != manifest.writer_choke_points
    {
        return Err(writer_coverage_invalid(
            "active writer manifest does not match the fork-point receipt",
        ));
    }
    if continuity.state != "continuous"
        || continuity.expected_manifest_version != receipt.manifest_version
        || continuity.expected_coverage_digest != receipt.manifest_digest
    {
        return Err(writer_coverage_gap(
            "fork coverage continuity is broken or disagrees with the fork-point receipt",
        ));
    }
    let activated_at_ms: u64 = conn.query_row(
        "SELECT activated_at_ms FROM _snapback_operation_coverage_v1
          WHERE manifest_version=?1 AND stream_id=?2 AND coverage_digest=?3",
        params![
            receipt.manifest_version,
            receipt.data_version_stream,
            receipt.manifest_digest
        ],
        |row| row.get(0),
    )?;
    if activated_at_ms != receipt.activated_at_ms {
        return Err(writer_coverage_invalid(
            "coverage activation time does not match its durable manifest row",
        ));
    }
    Ok(Some(receipt))
}

/// Re-read both durable coverage carriers and the active manifest through a
/// read-only lifecycle handle. Fork creation uses this after readiness so its
/// response never trusts the mere presence of the child-written receipt file.
pub fn verified_derived_fork_app_row_coverage(
    database_path: &Path,
) -> SnapbackResult<Option<ForkAppRowCoverageReceiptV1>> {
    let runtime = inspect_published_evidence(database_path)?.ok_or_else(|| {
        writer_coverage_invalid("writer coverage verification requires a minted derived fork")
    })?;
    let conn = open_fork_connection_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    verified_fork_app_row_coverage(
        &conn,
        database_path.parent().unwrap_or_else(|| Path::new(".")),
        &runtime,
    )
}

#[derive(Clone, Copy, Debug)]
struct NetDiffWorkLimitsV1 {
    max_journal_rows: u64,
    max_scanned_rows: u64,
    max_bytes: u64,
    max_output_rows: u64,
}

#[derive(Default)]
struct NetDiffWorkV1 {
    journal_rows: u64,
    scanned_rows: u64,
    observed_bytes: u64,
}

impl NetDiffWorkV1 {
    fn observe_journal(&mut self, bytes: u64, limits: NetDiffWorkLimitsV1) -> SnapbackResult<()> {
        self.journal_rows = self.journal_rows.saturating_add(1);
        self.observed_bytes = self.observed_bytes.saturating_add(bytes);
        self.enforce("journal", limits)
    }

    fn observe_scan(
        &mut self,
        bytes: u64,
        limits: NetDiffWorkLimitsV1,
        phase: &str,
    ) -> SnapbackResult<()> {
        self.scanned_rows = self.scanned_rows.saturating_add(1);
        self.observed_bytes = self.observed_bytes.saturating_add(bytes);
        self.enforce(phase, limits)
    }

    fn enforce(&self, phase: &str, limits: NetDiffWorkLimitsV1) -> SnapbackResult<()> {
        let exceeded = if self.journal_rows > limits.max_journal_rows {
            Some(("journal-rows", limits.max_journal_rows, self.journal_rows))
        } else if self.scanned_rows > limits.max_scanned_rows {
            Some(("scanned-rows", limits.max_scanned_rows, self.scanned_rows))
        } else if self.observed_bytes > limits.max_bytes {
            Some(("bytes", limits.max_bytes, self.observed_bytes))
        } else {
            None
        };
        let Some((limit_kind, limit, observed)) = exceeded else {
            return Ok(());
        };
        Err(fork_error(
            RESOURCE_LIMIT_REFUSED_CODE,
            "fork net diff refused while streaming bounded work",
        )
        .with_details(json!({
            "resource": "diff-work",
            "phase": phase,
            "limitKind": limit_kind,
            "limit": limit,
            "observed": observed,
            "journalRows": self.journal_rows,
            "scannedRows": self.scanned_rows,
            "observedBytes": self.observed_bytes,
            "limits": {
                "journalRows": limits.max_journal_rows,
                "scannedRows": limits.max_scanned_rows,
                "bytes": limits.max_bytes,
            }
        })))
    }
}

/// The exact net base-to-head diff (LLP 0185 Phase 4). The row set is
/// computed by comparing the digest-verified retained base against the
/// current head directly — an oracle independent of the journal — and the
/// journal is then cross-checked against it (every net-changed row must be
/// explained by a journal entry) wherever retention still covers the fork
/// point. A fork created without a retained base refuses deterministically.
pub fn net_diff_receipt(
    database_path: &Path,
    max_rows: u64,
) -> SnapbackResult<ForkNetDiffReceiptV3> {
    net_diff_receipt_with_limits(
        database_path,
        NetDiffWorkLimitsV1 {
            max_journal_rows: max_rows,
            max_scanned_rows: max_rows,
            max_bytes: FORK_DIFF_MAX_BYTES,
            max_output_rows: max_rows,
        },
    )
}

fn net_diff_receipt_with_limits(
    database_path: &Path,
    limits: NetDiffWorkLimitsV1,
) -> SnapbackResult<ForkNetDiffReceiptV3> {
    let runtime = inspect_published_evidence(database_path)?.ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
            "net diff requires a minted derived deployment",
        )
    })?;
    let directory = database_path.parent().unwrap_or_else(|| Path::new("."));
    let base_receipt_path = directory.join(BASE_RECEIPT_FILE);
    if !base_receipt_path.exists() {
        return Err(fork_error(
            NET_DIFF_UNAVAILABLE_CODE,
            "this fork has no retained base snapshot; create it with --retain-base to enable the exact net diff",
        ));
    }
    let base_receipt: ForkBaseReceiptV1 = serde_json::from_slice(
        &fs::read(&base_receipt_path).map_err(|error| io_error("read fork base receipt", error))?,
    )
    .map_err(|_| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            "fork base receipt is malformed",
        )
    })?;
    validate_direct_child_name(&base_receipt.database_file, "baseDatabaseFile")?;
    let base_path = directory.join(&base_receipt.database_file);
    if base_receipt.schema_version != "snapback.fork-base.v1"
        || base_receipt.fork_id != runtime.lineage.fork_id
        || file_sha256(&base_path)? != base_receipt.sha256
    {
        return Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_MISMATCH",
            "retained base snapshot does not match its digest-bound receipt for this fork",
        ));
    }

    let base = open_fork_connection_with_flags(&base_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let base_schema = crate::storage::active_schema_manifest_from_connection(&base)?;
    let mut head =
        open_fork_connection_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let tx = head.transaction()?;
    let wal_bytes = validate_sqlite_wal_integrity(database_path, limits.max_bytes)?;
    let head_schema = crate::storage::active_schema_manifest_from_connection(&tx)?;
    let observed_head_version = tx.query_row(
        "SELECT version FROM _snapback_version WHERE id=1",
        [],
        |row| row.get::<_, u64>(0),
    )?;
    let retention_floor = crate::storage::change_journal_floor_on(&tx)?;
    let coverage_receipt = verified_fork_app_row_coverage(&tx, directory, &runtime)?;
    let journal_cross_check_available = retention_floor <= runtime.lineage.fork_point_version;
    let mut work = NetDiffWorkV1 {
        observed_bytes: wal_bytes,
        ..NetDiffWorkV1::default()
    };
    let mut journaled = BTreeSet::new();
    let mut latest_covered_journal_post_images =
        BTreeMap::<String, BTreeMap<String, Option<Value>>>::new();
    if journal_cross_check_available {
        let mut statement = tx.prepare(
            "SELECT table_name,row_id,op,row_json,
                    length(CAST(table_name AS BLOB))
                      + length(CAST(row_id AS BLOB))
                      + length(CAST(op AS BLOB))
                      + COALESCE(length(CAST(row_json AS BLOB)), 0)
               FROM _snapback_changes
              WHERE version > ?1
                AND table_name NOT GLOB '_snapback_*'
                AND table_name NOT GLOB '_auth_*'
              ORDER BY version,id",
        )?;
        let mut rows = statement.query([runtime.lineage.fork_point_version])?;
        while let Some(row) = rows.next()? {
            // Read SQLite's byte count before materializing any untrusted text
            // into Rust-owned strings or inserting it into the diff maps.
            let journal_bytes = row.get::<_, u64>(4)?;
            work.observe_journal(journal_bytes, limits)?;
            let table = row.get::<_, String>(0)?;
            let row_id = row.get::<_, String>(1)?;
            let operation = row.get::<_, String>(2)?;
            let row_json = row.get::<_, Option<String>>(3)?;
            journaled.insert((table.clone(), row_id.clone()));
            if coverage_receipt.is_some() {
                let post_image = match (operation.as_str(), row_json) {
                    ("insert" | "update", Some(row_json)) => {
                        Some(serde_json::from_str(&row_json).map_err(|error| {
                            fork_error(
                                "SNAPBACK_FORK_DIFF_INVALID",
                                format!("covered journal post-image is malformed: {error}"),
                            )
                            .with_details(json!({
                                "table": table,
                                "rowId": row_id,
                                "operation": operation,
                            }))
                        })?)
                    }
                    ("delete", None) => None,
                    ("insert" | "update" | "delete", _) => {
                        return Err(fork_error(
                            "SNAPBACK_FORK_DIFF_INVALID",
                            "covered journal operation and post-image disagree",
                        )
                        .with_details(json!({
                            "table": table,
                            "rowId": row_id,
                            "operation": operation,
                        })));
                    }
                    _ => {
                        return Err(fork_error(
                            "SNAPBACK_FORK_DIFF_INVALID",
                            "covered journal operation is not recognized",
                        )
                        .with_details(json!({
                            "table": table,
                            "rowId": row_id,
                            "operation": operation,
                        })));
                    }
                };
                latest_covered_journal_post_images
                    .entry(table)
                    .or_default()
                    .insert(row_id, post_image);
            }
        }
    }

    let mut tables = BTreeSet::new();
    for conn in [&base, &*tx] {
        let mut statement = conn.prepare(
            "SELECT name FROM sqlite_schema
             WHERE type='table'
               AND name NOT GLOB '_snapback_*'
               AND name NOT GLOB '_auth_*'
               AND name NOT GLOB 'sqlite_*'
             ORDER BY name",
        )?;
        for name in statement.query_map([], |row| row.get::<_, String>(0))? {
            tables.insert(name?);
        }
    }

    let mut rows = Vec::new();
    let mut table_counts = BTreeMap::new();
    for table in &tables {
        let base_table = base_schema.as_ref().and_then(|schema| {
            schema
                .tables
                .iter()
                .find(|candidate| candidate.name == *table)
        });
        let head_table = head_schema.as_ref().and_then(|schema| {
            schema
                .tables
                .iter()
                .find(|candidate| candidate.name == *table)
        });
        let base_rows =
            read_app_table_rows(&base, table, base_table, &mut work, limits, "base-scan")?;
        let head_rows =
            read_app_table_rows(&tx, table, head_table, &mut work, limits, "head-scan")?;
        if let Some(latest_rows) = latest_covered_journal_post_images.get(table) {
            for (row_id, journal_post_image) in latest_rows {
                if head_rows.get(row_id) != journal_post_image.as_ref() {
                    return Err(fork_error(
                        DIFF_ORACLE_MISMATCH_CODE,
                        "the covered journal's final post-image disagrees with the base/head oracle",
                    )
                    .with_details(json!({
                        "table": table,
                        "rowId": row_id,
                        "reason": "journal-head-postimage-mismatch",
                    })));
                }
            }
        }
        let mut row_ids = BTreeSet::new();
        row_ids.extend(base_rows.keys().cloned());
        row_ids.extend(head_rows.keys().cloned());
        for row_id in row_ids {
            let entry = match (base_rows.get(&row_id), head_rows.get(&row_id)) {
                (None, Some(post)) => Some(("insert", None, Some(post.clone()))),
                (Some(pre), None) => Some(("delete", Some(pre.clone()), None)),
                (Some(pre), Some(post)) if pre != post => {
                    Some(("update", Some(pre.clone()), Some(post.clone())))
                }
                _ => None,
            };
            if let Some((operation, pre_image, post_image)) = entry {
                *table_counts.entry(table.clone()).or_insert(0) += 1;
                rows.push(ForkNetDiffRowV1 {
                    table: table.clone(),
                    row_id,
                    operation: operation.to_owned(),
                    pre_image,
                    post_image,
                });
            }
        }
    }
    if rows.len() as u64 > limits.max_output_rows {
        return Err(fork_error(
            RESOURCE_LIMIT_REFUSED_CODE,
            "fork net diff refused: the net row set exceeds the diff-work limit",
        )
        .with_details(json!({
            "resource": "diff-work",
            "limitRows": limits.max_output_rows,
            "netRows": rows.len(),
            "journalRows": work.journal_rows,
            "scannedRows": work.scanned_rows,
            "observedBytes": work.observed_bytes,
        })));
    }

    // @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 — an
    //   armed receipt cannot let an out-of-process write borrow an earlier
    //   legitimate journal entry for the same row.
    // Journal cross-check: within retention, every net-changed row must be
    // explained by at least one journal entry. For the authorizer-backed
    // class, the last journal post-image for every touched row must also equal
    // the independently scanned head. This prevents an out-of-process write
    // from borrowing an earlier legitimate journal entry for the same row.
    let journal_consistency = if !journal_cross_check_available {
        "journal-cross-check-unavailable-retention-gap".to_owned()
    } else {
        if let Some((table, rows)) = latest_covered_journal_post_images
            .iter()
            .find(|(table, rows)| !tables.contains(*table) && rows.values().any(Option::is_some))
        {
            let row_id = rows
                .iter()
                .find_map(|(row_id, post_image)| post_image.as_ref().map(|_| row_id))
                .expect("the predicate requires one retained post-image");
            return Err(fork_error(
                DIFF_ORACLE_MISMATCH_CODE,
                "the covered journal retains a row that is absent from the base/head oracle",
            )
            .with_details(json!({
                "table": table,
                "rowId": row_id,
                "reason": "journal-head-table-missing",
            })));
        }
        if let Some(unexplained) = rows
            .iter()
            .find(|row| !journaled.contains(&(row.table.clone(), row.row_id.clone())))
        {
            return Err(fork_error(
                DIFF_ORACLE_MISMATCH_CODE,
                "the journal does not explain a net base-to-head change; the journal receipt cannot be trusted for this span",
            )
            .with_details(json!({
                "table": unexplained.table,
                "rowId": unexplained.row_id,
                "operation": unexplained.operation,
            })));
        }
        "journal-cross-check-verified".to_owned()
    };

    let writer_coverage = match coverage_receipt.as_ref() {
        Some(receipt) => ForkNetDiffWriterCoverageV1 {
            coverage_window: "fork-point-to-observed-head-verified".to_owned(),
            manifest_digest: Some(receipt.manifest_digest.clone()),
            covered_lanes: receipt.covered_lanes.clone(),
            uncovered_lanes: receipt.uncovered_lanes.clone(),
        },
        None => ForkNetDiffWriterCoverageV1 {
            coverage_window: "unverified".to_owned(),
            manifest_digest: None,
            covered_lanes: Vec::new(),
            uncovered_lanes: fork_app_row_all_lanes(),
        },
    };
    let completeness =
        if coverage_receipt.is_some() && journal_consistency == "journal-cross-check-verified" {
            "registered-connection-defensive-app-rows-v1"
        } else {
            "journal-enumerated-v1"
        };

    // @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 —
    //   writer authority and journal consistency are separate receipt facts;
    //   both must pass before the app-row completeness spelling upgrades.
    let (base, head) = diff_commit_boundaries(&tx, database_path, &runtime, observed_head_version)?;
    let mut receipt = ForkNetDiffReceiptV3 {
        schema_version: "snapback.fork-net-diff.v3".to_owned(),
        fork_id: runtime.lineage.fork_id,
        app_id: runtime.lineage.app_id,
        parent_instance_id: runtime.lineage.parent_instance_id,
        fork_point_version: runtime.lineage.fork_point_version,
        observed_head_version,
        base,
        head,
        substrate: "retained-base-v1".to_owned(),
        completeness: completeness.to_owned(),
        journal_consistency,
        writer_coverage,
        attribution: "absent-v1".to_owned(),
        rows,
        table_counts,
        domains: BTreeMap::from([
            ("appRows".to_owned(), "net-covered".to_owned()),
            ("schema".to_owned(), "omitted".to_owned()),
            ("auth".to_owned(), "omitted".to_owned()),
            ("operational".to_owned(), "omitted".to_owned()),
            ("configuration".to_owned(), "omitted".to_owned()),
            ("assets".to_owned(), "omitted".to_owned()),
            ("egressAttempts".to_owned(), "omitted".to_owned()),
            ("telemetry".to_owned(), "omitted".to_owned()),
            ("sidecars".to_owned(), "omitted".to_owned()),
        ]),
        receipt_digest: String::new(),
    };
    receipt.receipt_digest = net_diff_receipt_digest(&receipt)?;
    Ok(receipt)
}

/// Every row of one app table as a canonical JSON object keyed by `_id`.
/// Values come from the live column bytes — SQLite storage classes map to
/// JSON directly, blobs render as lowercase hex — so two identical rows
/// compare equal regardless of which database file they were read from.
fn read_app_table_rows(
    conn: &Connection,
    table: &str,
    manifest: Option<&crate::manifest::TableManifest>,
    work: &mut NetDiffWorkV1,
    limits: NetDiffWorkLimitsV1,
    phase: &str,
) -> SnapbackResult<BTreeMap<String, Value>> {
    let quoted = format!("\"{}\"", table.replace('"', "\"\""));
    let mut statement = match conn.prepare(&format!("SELECT * FROM {quoted}")) {
        Ok(statement) => statement,
        // A table existing on only one side (schema divergence) reads as
        // empty on the other; the row-level diff then reports its rows.
        Err(rusqlite::Error::SqliteFailure(_, Some(message)))
            if message.contains("no such table") =>
        {
            return Ok(BTreeMap::new());
        }
        Err(error) => return Err(error.into()),
    };
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut rows = BTreeMap::new();
    let mut raw = statement.query([])?;
    while let Some(row) = raw.next()? {
        // Inspect borrowed SQLite values before any owned decoding. Text JSON
        // escaping, blob-to-hex expansion, parsed JSON, and vector arrays are
        // charged conservatively at this cut, so one oversized value refuses
        // before `row_to_document` or the generic converter can allocate a
        // proportional Rust object.
        let row_work_bytes = preflight_app_row_work(row, table, manifest, &columns)?;
        work.observe_scan(row_work_bytes, limits, phase)?;
        if let Some(manifest) = manifest {
            let document = crate::storage::row_to_document(row, manifest, &columns)?;
            let row_id = document
                .get("_id")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    fork_error(
                        "SNAPBACK_FORK_DIFF_INVALID",
                        format!("app table {table} has a row without a string _id"),
                    )
                })?
                .to_owned();
            verify_bounded_row_serialization(&document, row_work_bytes, table, &row_id)?;
            rows.insert(row_id, document);
            continue;
        }
        let mut object = serde_json::Map::new();
        let mut row_id = None;
        for (index, column) in columns.iter().enumerate() {
            let value = match row.get_ref(index)? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(value) => Value::from(value),
                rusqlite::types::ValueRef::Real(value) => Value::from(value),
                rusqlite::types::ValueRef::Text(bytes) => Value::from(
                    std::str::from_utf8(bytes)
                        .map_err(|error| {
                            fork_error(
                                "SNAPBACK_FORK_DIFF_INVALID",
                                format!("app table {table} contains non-UTF-8 text: {error}"),
                            )
                        })?
                        .to_owned(),
                ),
                rusqlite::types::ValueRef::Blob(bytes) => Value::from(
                    bytes
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect::<String>(),
                ),
            };
            if column == "_id"
                && let Value::String(id) = &value
            {
                row_id = Some(id.clone());
            }
            object.insert(column.clone(), value);
        }
        let Some(row_id) = row_id else {
            return Err(fork_error(
                "SNAPBACK_FORK_DIFF_INVALID",
                format!("app table {table} has a row without a string _id"),
            ));
        };
        let document = Value::Object(object);
        verify_bounded_row_serialization(&document, row_work_bytes, table, &row_id)?;
        rows.insert(row_id, document);
    }
    Ok(rows)
}

fn preflight_app_row_work(
    row: &rusqlite::Row<'_>,
    table: &str,
    manifest: Option<&crate::manifest::TableManifest>,
    columns: &[String],
) -> SnapbackResult<u64> {
    // @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 —
    // charge borrowed physical values before any proportional owned decode.
    let mut document_bytes = 2u64; // `{}`
    let mut row_id_bytes = None;
    for (index, column) in columns.iter().enumerate() {
        if index > 0 {
            document_bytes = document_bytes.saturating_add(1); // comma
        }
        document_bytes = document_bytes
            .saturating_add(json_string_serialized_len(column)? as u64)
            .saturating_add(1); // colon
        let value = row.get_ref(index)?;
        if column == "_id" {
            let rusqlite::types::ValueRef::Text(bytes) = value else {
                return Err(fork_error(
                    "SNAPBACK_FORK_DIFF_INVALID",
                    format!("app table {table} has a non-text _id"),
                ));
            };
            std::str::from_utf8(bytes).map_err(|error| {
                fork_error(
                    "SNAPBACK_FORK_DIFF_INVALID",
                    format!("app table {table} has a non-UTF-8 _id: {error}"),
                )
            })?;
            row_id_bytes = Some(bytes.len() as u64);
        }
        document_bytes = document_bytes.saturating_add(match manifest {
            Some(manifest) => manifest_value_work_bound(value, manifest, column)?,
            None => generic_value_work_bound(value, table, column)?,
        });
    }
    let row_id_bytes = row_id_bytes.ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_DIFF_INVALID",
            format!("app table {table} has a row without _id"),
        )
    })?;
    Ok((table.len() as u64)
        .saturating_add(row_id_bytes)
        .saturating_add(document_bytes))
}

fn manifest_value_work_bound(
    value: rusqlite::types::ValueRef<'_>,
    manifest: &crate::manifest::TableManifest,
    column: &str,
) -> SnapbackResult<u64> {
    use crate::manifest::FieldType;
    use rusqlite::types::ValueRef;

    if matches!(value, ValueRef::Null) {
        return Ok(4);
    }
    let field = manifest.field(column);
    let bound = match (column, field.map(|field| &field.field_type), value) {
        ("_id", _, ValueRef::Text(bytes)) => json_text_bytes_len(bytes, &manifest.name, column)?,
        ("_version" | "_createdAt" | "_updatedAt", _, ValueRef::Integer(value)) => {
            decimal_i64_len(value)
        }
        (
            _,
            Some(
                FieldType::String
                | FieldType::Enum { .. }
                | FieldType::Principal
                | FieldType::Id { .. }
                | FieldType::RelationIncarnation { .. }
                | FieldType::AssetRef { .. },
            ),
            ValueRef::Text(bytes),
        ) => json_text_bytes_len(bytes, &manifest.name, column)?,
        (_, Some(FieldType::Boolean), ValueRef::Integer(0)) => 5,
        (_, Some(FieldType::Boolean), ValueRef::Integer(1)) => 4,
        (_, Some(FieldType::Integer), ValueRef::Integer(value)) => decimal_i64_len(value),
        (_, Some(FieldType::Real), ValueRef::Real(_)) => 32,
        (_, Some(FieldType::Json), ValueRef::Text(bytes)) => {
            std::str::from_utf8(bytes).map_err(|error| {
                fork_error(
                    "SNAPBACK_FORK_DIFF_INVALID",
                    format!(
                        "app table {} field {column} contains non-UTF-8 JSON: {error}",
                        manifest.name
                    ),
                )
            })?;
            // Parsing JSON into `Value` has node overhead beyond the input
            // bytes. Charge a conservative multiplier before parsing so a
            // token-dense document cannot evade the byte-work budget.
            (bytes.len() as u64).saturating_mul(8).saturating_add(2)
        }
        (_, Some(FieldType::Vector { dimensions }), ValueRef::Blob(bytes)) => {
            let expected = (*dimensions as usize).saturating_mul(std::mem::size_of::<f64>());
            if bytes.len() != expected {
                return Err(fork_error(
                    "SNAPBACK_FORK_DIFF_INVALID",
                    format!(
                        "app table {} field {column} has a vector blob of {} bytes; expected {expected}",
                        manifest.name,
                        bytes.len()
                    ),
                ));
            }
            // The decoded f64 buffer and `Value::Array` nodes are both owned;
            // charge them before either allocation. The serialized upper
            // bound for one finite f64 is smaller than this 40-byte factor.
            (bytes.len() as u64)
                .saturating_add((*dimensions as u64).saturating_mul(40))
                .saturating_add(2)
        }
        (_, None, ValueRef::Integer(value)) => decimal_i64_len(value),
        (_, None, ValueRef::Real(_)) => 32,
        (_, None, ValueRef::Text(bytes)) => json_text_bytes_len(bytes, &manifest.name, column)?,
        (_, None, ValueRef::Null) => 4,
        _ => {
            // The strict storage decoder will return the detailed physical-
            // representation diagnostic. This preflight allocates nothing.
            return Ok(match value {
                ValueRef::Null => 4,
                ValueRef::Integer(value) => decimal_i64_len(value),
                ValueRef::Real(_) => 32,
                ValueRef::Text(bytes) => (bytes.len() as u64).saturating_mul(6).saturating_add(2),
                ValueRef::Blob(bytes) => (bytes.len() as u64).saturating_mul(2).saturating_add(2),
            });
        }
    };
    Ok(bound)
}

fn generic_value_work_bound(
    value: rusqlite::types::ValueRef<'_>,
    table: &str,
    column: &str,
) -> SnapbackResult<u64> {
    use rusqlite::types::ValueRef;
    Ok(match value {
        ValueRef::Null => 4,
        ValueRef::Integer(value) => decimal_i64_len(value),
        ValueRef::Real(_) => 32,
        ValueRef::Text(bytes) => json_text_bytes_len(bytes, table, column)?,
        ValueRef::Blob(bytes) => (bytes.len() as u64).saturating_mul(2).saturating_add(2),
    })
}

fn decimal_i64_len(value: i64) -> u64 {
    value.to_string().len() as u64
}

fn json_text_bytes_len(bytes: &[u8], table: &str, column: &str) -> SnapbackResult<u64> {
    let text = std::str::from_utf8(bytes).map_err(|error| {
        fork_error(
            "SNAPBACK_FORK_DIFF_INVALID",
            format!("app table {table} field {column} contains non-UTF-8 text: {error}"),
        )
    })?;
    Ok(json_string_serialized_len(text)? as u64)
}

fn json_string_serialized_len(value: &str) -> SnapbackResult<usize> {
    let mut length = 2usize;
    for character in value.chars() {
        let encoded = match character {
            '"' | '\\' | '\u{0008}' | '\u{000c}' | '\n' | '\r' | '\t' => 2,
            '\u{0000}'..='\u{001f}' => 6,
            _ => character.len_utf8(),
        };
        length = length.checked_add(encoded).ok_or_else(|| {
            fork_error(
                RESOURCE_LIMIT_REFUSED_CODE,
                "fork net diff row serialization length overflowed",
            )
        })?;
    }
    Ok(length)
}

struct BoundedCountingWriter {
    written: u64,
    limit: u64,
}

impl std::io::Write for BoundedCountingWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let next = self.written.saturating_add(bytes.len() as u64);
        if next > self.limit {
            return Err(std::io::Error::other(
                "row serialization exceeded its preflight work bound",
            ));
        }
        self.written = next;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn verify_bounded_row_serialization(
    document: &Value,
    row_work_bytes: u64,
    table: &str,
    row_id: &str,
) -> SnapbackResult<()> {
    let non_document_bytes = (table.len() as u64).saturating_add(row_id.len() as u64);
    let mut writer = BoundedCountingWriter {
        written: 0,
        limit: row_work_bytes.saturating_sub(non_document_bytes),
    };
    serde_json::to_writer(&mut writer, document).map_err(|error| {
        fork_error(
            RESOURCE_LIMIT_REFUSED_CODE,
            format!("fork net diff row serialization exceeded preflight: {error}"),
        )
        .with_details(json!({
            "resource": "diff-work",
            "phase": "row-serialization",
            "limitKind": "bytes",
            "limit": writer.limit,
            "observed": writer.written,
            "table": table,
            "rowId": row_id,
        }))
    })
}

#[allow(clippy::too_many_arguments)]
fn publish_with_options(
    source_database: &Path,
    destination: &Path,
    app_id: &str,
    parent_instance_id: &str,
    now_ms: u64,
    cut_at: Option<PublicationCut>,
    with_secrets: bool,
    expires_at_ms: Option<u64>,
    retain_base: bool,
    expected_app: Option<&ExpectedForkAppV1>,
) -> SnapbackResult<ForkMintReceiptV1> {
    if destination.exists() {
        return Err(fork_error(
            "SNAPBACK_FORK_DESTINATION_EXISTS",
            "fork destination already exists",
        ));
    }
    if inspect_boot(source_database)?.is_some() {
        return Err(fork_error(
            "SNAPBACK_FORK_NESTED_REFUSED",
            "v1 does not fork a derived deployment",
        ));
    }
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|error| io_error("create fork parent", error))?;
    let destination_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_PATH_INVALID",
                "fork destination needs a UTF-8 name",
            )
        })?;
    let staging = parent.join(format!(".{destination_name}.staging-{}", Uuid::now_v7()));
    fs::create_dir(&staging).map_err(|error| io_error("create fork staging directory", error))?;
    let result = (|| -> SnapbackResult<ForkMintReceiptV1> {
        let sentinel = staging.join(STAGING_SENTINEL);
        File::create(&sentinel)
            .and_then(|file| file.sync_all())
            .map_err(|error| io_error("write fork staging sentinel", error))?;
        if let Some(expected) = expected_app {
            write_staging_app_binding(&staging, expected)?;
        }
        maybe_cut(cut_at, PublicationCut::AfterSentinelWrite)?;
        sync_directory(&staging)?;
        maybe_cut(cut_at, PublicationCut::AfterSentinelDirectorySync)?;

        let database_file = source_database
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| {
                fork_error(
                    "SNAPBACK_FORK_PATH_INVALID",
                    "source database needs a UTF-8 file name",
                )
            })?;
        let staging_database = staging.join(database_file);
        let source = open_fork_connection(source_database)?;
        audit_connection(&source)?;
        let mut target = open_fork_connection(&staging_database)?;
        {
            let backup = rusqlite::backup::Backup::new(&source, &mut target)?;
            backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
        }
        drop(target);
        maybe_cut(cut_at, PublicationCut::AfterClone)?;

        if with_secrets {
            let source_config = crate::local::config_path_for_database(source_database);
            if source_config.exists() {
                let bytes =
                    crate::secure_file::read_owner_only(&source_config).map_err(|error| {
                        io_error("read parent config for explicit fork copy", error)
                    })?;
                let target_config = crate::local::config_path_for_database(&staging_database);
                crate::secure_file::write_new_owner_only(&target_config, &bytes)
                    .map_err(|error| io_error("copy config into fork staging", error))?;
                sync_file(&target_config, "sync copied fork config")?;
            }
        }

        let receipt = scrub_and_mint_with_cut(
            &staging_database,
            app_id,
            parent_instance_id,
            now_ms,
            cut_at,
            with_secrets,
            expires_at_ms,
        )?;
        let app_binding = expected_app
            .map(|expected| write_fork_app_binding(&staging, &receipt, expected))
            .transpose()?;
        if app_binding.is_some() {
            fs::remove_file(staging.join(APP_BINDING_INTENT_FILE))
                .map_err(|error| io_error("remove staged app binding intent", error))?;
        }
        copy_fork_private_assets(source_database, &staging, &staging_database)?;
        maybe_cut(cut_at, PublicationCut::AfterAssetCopy)?;
        if retain_base {
            retain_base_snapshot(&staging, &staging_database, &receipt, now_ms)?;
        }
        sync_directory(&staging)?;
        maybe_cut(cut_at, PublicationCut::AfterStagingDirectorySync)?;

        let registry_directory = parent.join(REGISTRY_DIRECTORY);
        fs::create_dir_all(&registry_directory)
            .map_err(|error| io_error("create fork registry", error))?;
        let registry = registry_path(parent, &receipt.lineage.fork_id);
        write_json_sync(
            &registry,
            &registry_entry("intent", destination, &receipt, app_binding.as_ref()),
        )?;
        sync_directory(&registry_directory)?;
        maybe_cut(cut_at, PublicationCut::AfterRegistryIntent)?;

        fs::rename(&staging, destination)
            .map_err(|error| io_error("commit fork directory rename", error))?;
        maybe_cut(cut_at, PublicationCut::AfterRename)?;
        sync_directory(parent)?;
        maybe_cut(cut_at, PublicationCut::AfterParentDirectorySync)?;
        let registry_result = write_json_sync(
            &registry,
            &registry_entry("published", destination, &receipt, app_binding.as_ref()),
        );
        if registry_result.is_ok() {
            let _ = sync_directory(&registry_directory);
        }
        maybe_cut(cut_at, PublicationCut::AfterRegistryFinalize)?;
        fs::remove_file(destination.join(STAGING_SENTINEL))
            .map_err(|error| io_error("remove published fork sentinel", error))?;
        maybe_cut(cut_at, PublicationCut::AfterSentinelUnlink)?;
        sync_directory(destination)?;
        maybe_cut(cut_at, PublicationCut::AfterPublishedDirectorySync)?;
        Ok(receipt)
    })();
    if result
        .as_ref()
        .is_err_and(|error| error.diagnostic.code != "SNAPBACK_FORK_TEST_CRASH_CUT")
    {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Same-cut fork-private asset custody (LLP 0185 Phase 5). The staged
/// database is the frozen metadata cut; every blob it names must copy into
/// the fork's own assets tree, digest- and length-verified, or publication
/// refuses — there is never a metadata-only success naming missing or
/// parent-controlled blobs. Unknown stores and digest algorithms fail
/// closed (the future-family rule applied to custody).
fn copy_fork_private_assets(
    source_database: &Path,
    staging: &Path,
    staging_database: &Path,
) -> SnapbackResult<()> {
    let conn = open_fork_connection(staging_database)?;
    if !table_exists(&conn, "_snapback_asset_blobs_v1")? {
        return Ok(());
    }
    let mut statement = conn.prepare(
        "SELECT physical_key, store, digest_algorithm, digest, byte_length
           FROM _snapback_asset_blobs_v1 ORDER BY physical_key",
    )?;
    let blobs = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, u64>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if blobs.is_empty() {
        return Ok(());
    }
    let parent_blobs = source_database
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("assets")
        .join("blobs");
    let fork_blobs = staging.join("assets").join("blobs");
    fs::create_dir_all(&fork_blobs)
        .map_err(|error| io_error("create fork asset blob tree", error))?;
    fs::create_dir_all(staging.join("assets").join("staging"))
        .map_err(|error| io_error("create fork asset staging tree", error))?;
    for (physical_key, store, digest_algorithm, digest, byte_length) in blobs {
        if store != "local-fs" {
            return Err(fork_error(
                ASSET_CUT_UNSUPPORTED_CODE,
                "only local-fs asset custody has a proven fork-private copy; other stores remain refusal-scope",
            )
            .with_details(json!({ "physicalKey": physical_key, "store": store })));
        }
        if digest_algorithm != "sha256" {
            return Err(fork_error(
                ASSET_CUT_UNSUPPORTED_CODE,
                "unclassified asset digest algorithm fails closed",
            )
            .with_details(json!({
                "physicalKey": physical_key,
                "digestAlgorithm": digest_algorithm,
            })));
        }
        validate_direct_child_name(&physical_key, "assetPhysicalKey")?;
        let source_path = parent_blobs.join(&physical_key);
        let bytes = match fs::read(&source_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Err(fork_error(
                    ASSET_CUT_INCOMPLETE_CODE,
                    "a blob named by the metadata cut is missing from the parent store; refusing a torn asset custody cut",
                )
                .with_details(json!({ "physicalKey": physical_key })));
            }
            Err(error) => return Err(io_error("read parent asset blob", error)),
        };
        let observed = {
            use sha2::Digest as _;
            let mut hasher = sha2::Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };
        if bytes.len() as u64 != byte_length || observed != digest {
            return Err(fork_error(
                ASSET_CUT_INCOMPLETE_CODE,
                "a parent blob does not match the digest the metadata cut recorded; refusing a torn asset custody cut",
            )
            .with_details(json!({
                "physicalKey": physical_key,
                "expectedDigest": digest,
                "observedDigest": observed,
                "expectedBytes": byte_length,
                "observedBytes": bytes.len(),
            })));
        }
        let target = fork_blobs.join(&physical_key);
        fs::write(&target, &bytes).map_err(|error| io_error("write fork asset blob", error))?;
        sync_file(&target, "sync fork asset blob")?;
    }
    // The durability chain is staging → assets → blobs: each directory's
    // entries bind the level below, so every level syncs (2026-08-05 review
    // blocker: the middle link was missing).
    sync_directory(&fork_blobs)?;
    sync_directory(&staging.join("assets"))?;
    Ok(())
}

/// Copy the freshly minted database as the fork's immutable base snapshot,
/// digest-bound so later net diffs can prove the base is untampered. The
/// copy happens inside private staging, so publication atomicity (rename)
/// covers it exactly like every other fork artifact.
fn retain_base_snapshot(
    staging: &Path,
    staging_database: &Path,
    receipt: &ForkMintReceiptV1,
    now_ms: u64,
) -> SnapbackResult<()> {
    let base_path = staging.join(BASE_SNAPSHOT_FILE);
    let source = open_fork_connection(staging_database)?;
    let mut target = open_fork_connection(&base_path)?;
    {
        let backup = rusqlite::backup::Backup::new(&source, &mut target)?;
        backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
    }
    drop(target);
    drop(source);
    sync_file(&base_path, "sync retained fork base")?;
    let base_receipt = ForkBaseReceiptV1 {
        schema_version: "snapback.fork-base.v1".to_owned(),
        fork_id: receipt.lineage.fork_id.clone(),
        database_file: BASE_SNAPSHOT_FILE.to_owned(),
        sha256: file_sha256(&base_path)?,
        retained_at_ms: now_ms,
    };
    write_json_sync(&staging.join(BASE_RECEIPT_FILE), &base_receipt)
}

fn file_sha256(path: &Path) -> SnapbackResult<String> {
    use sha2::Digest as _;
    let mut hasher = sha2::Sha256::new();
    let mut file = File::open(path).map_err(|error| io_error("open file for digest", error))?;
    std::io::copy(&mut file, &mut hasher)
        .map_err(|error| io_error("digest fork base snapshot", error))?;
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn wal_integrity_error(reason: impl Into<String>) -> SnapbackError {
    fork_error(
        "SNAPBACK_FORK_EVIDENCE_MISMATCH",
        "fork diff refused a malformed or concurrently changing SQLite WAL",
    )
    .with_details(json!({
        "evidence": "sqlite-wal",
        "reason": reason.into(),
    }))
}

fn wal_checksum_words(bytes: &[u8], big_endian: bool, mut checksum: [u32; 2]) -> [u32; 2] {
    debug_assert_eq!(bytes.len() % 8, 0);
    for words in bytes.chunks_exact(8) {
        let first = if big_endian {
            u32::from_be_bytes(words[0..4].try_into().expect("four-byte WAL word"))
        } else {
            u32::from_le_bytes(words[0..4].try_into().expect("four-byte WAL word"))
        };
        let second = if big_endian {
            u32::from_be_bytes(words[4..8].try_into().expect("four-byte WAL word"))
        } else {
            u32::from_le_bytes(words[4..8].try_into().expect("four-byte WAL word"))
        };
        checksum[0] = checksum[0].wrapping_add(first).wrapping_add(checksum[1]);
        checksum[1] = checksum[1].wrapping_add(second).wrapping_add(checksum[0]);
    }
    checksum
}

/// SQLite deliberately treats a malformed WAL header or invalid trailing
/// frame as an absent/shorter log during recovery. That is correct database
/// recovery behavior, but a diff receipt must not silently bind the older
/// visible prefix after raw file tampering. Validate the documented WAL
/// header, salts, and cumulative frame checksums within the diff byte budget
/// before emitting evidence.
fn validate_sqlite_wal_integrity(database_path: &Path, max_bytes: u64) -> SnapbackResult<u64> {
    let wal_path = PathBuf::from(format!("{}-wal", database_path.display()));
    let mut file = match File::open(&wal_path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(io_error("open fork WAL for diff validation", error)),
    };
    let metadata = file
        .metadata()
        .map_err(|error| io_error("inspect fork WAL for diff validation", error))?;
    let observed_bytes = metadata.len();
    if observed_bytes > max_bytes {
        return Err(fork_error(
            RESOURCE_LIMIT_REFUSED_CODE,
            "fork net diff refused before reading an oversized WAL",
        )
        .with_details(json!({
            "resource": "diff-work",
            "phase": "wal-integrity",
            "limitKind": "bytes",
            "limit": max_bytes,
            "observed": observed_bytes,
            "observedBytes": observed_bytes,
        })));
    }
    let mut bytes = Vec::with_capacity(observed_bytes as usize);
    (&mut file)
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("read fork WAL for diff validation", error))?;
    let final_len = file
        .metadata()
        .map_err(|error| io_error("reinspect fork WAL for diff validation", error))?
        .len();
    if bytes.len() as u64 != observed_bytes || final_len != observed_bytes {
        return Err(wal_integrity_error("wal-changed-during-validation"));
    }
    if bytes.is_empty() {
        return Ok(0);
    }
    if bytes.len() < 32 {
        return Err(wal_integrity_error("truncated-header"));
    }
    let magic = u32::from_be_bytes(bytes[0..4].try_into().expect("WAL magic"));
    if magic & !1 != 0x377f_0682 {
        return Err(wal_integrity_error("invalid-magic"));
    }
    if u32::from_be_bytes(bytes[4..8].try_into().expect("WAL version")) != 3_007_000 {
        return Err(wal_integrity_error("unsupported-format-version"));
    }
    let page_size = u32::from_be_bytes(bytes[8..12].try_into().expect("WAL page size"));
    if !(512..=65_536).contains(&page_size) || !page_size.is_power_of_two() {
        return Err(wal_integrity_error("invalid-page-size"));
    }
    let checksum_big_endian = magic & 1 == 1;
    let mut checksum = wal_checksum_words(&bytes[..24], checksum_big_endian, [0, 0]);
    let stored_header_checksum = [
        u32::from_be_bytes(bytes[24..28].try_into().expect("WAL checksum one")),
        u32::from_be_bytes(bytes[28..32].try_into().expect("WAL checksum two")),
    ];
    if checksum != stored_header_checksum {
        return Err(wal_integrity_error("header-checksum-mismatch"));
    }
    let frame_size = 24usize.saturating_add(page_size as usize);
    if (bytes.len() - 32) % frame_size != 0 {
        return Err(wal_integrity_error("truncated-frame"));
    }
    let salt = &bytes[16..24];
    for frame in bytes[32..].chunks_exact(frame_size) {
        if u32::from_be_bytes(frame[0..4].try_into().expect("WAL frame page")) == 0 {
            return Err(wal_integrity_error("zero-frame-page"));
        }
        if &frame[8..16] != salt {
            return Err(wal_integrity_error("frame-salt-mismatch"));
        }
        checksum = wal_checksum_words(&frame[..8], checksum_big_endian, checksum);
        checksum = wal_checksum_words(&frame[24..], checksum_big_endian, checksum);
        let stored_frame_checksum = [
            u32::from_be_bytes(frame[16..20].try_into().expect("frame checksum one")),
            u32::from_be_bytes(frame[20..24].try_into().expect("frame checksum two")),
        ];
        if checksum != stored_frame_checksum {
            return Err(wal_integrity_error("frame-checksum-mismatch"));
        }
    }
    Ok(observed_bytes)
}

fn validate_destination_app_binding(
    destination: &Path,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<()> {
    let receipt: ForkMintReceiptV1 = serde_json::from_slice(
        &fs::read(destination.join(MINT_RECEIPT_FILE)).map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                fork_error(
                    APP_BINDING_REQUIRED_CODE,
                    "published destination has no mint receipt for app-root binding",
                )
            } else {
                io_error("read recovery mint receipt", error)
            }
        })?,
    )
    .map_err(|error| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            format!("recovery mint receipt is malformed: {error}"),
        )
    })?;
    let binding = read_fork_app_binding(destination, &receipt)?;
    let expected_root = expected.canonical_app_root.to_str().ok_or_else(|| {
        fork_error(
            "SNAPBACK_FORK_APP_ROOT_INVALID",
            "invoking app root must have a UTF-8 canonical path",
        )
    })?;
    if binding.canonical_app_root != expected_root || binding.app_id != expected.app_id {
        return Err(fork_error(
            APP_BINDING_MISMATCH_CODE,
            "recovery destination is bound to a different invoking app root or logical app id",
        ));
    }
    Ok(())
}

/// Product recovery validates the invoking app before completing or reaping
/// any exact destination or staging publication. Unknown legacy staging is
/// left untouched and refused rather than becoming cross-root cleanup.
pub fn recover_bound(
    parent: &Path,
    destination: &Path,
    expected: &ExpectedForkAppV1,
) -> SnapbackResult<()> {
    if destination.exists() {
        validate_destination_app_binding(destination, expected)?;
        let receipt: ForkMintReceiptV1 = serde_json::from_slice(
            &fs::read(destination.join(MINT_RECEIPT_FILE))
                .map_err(|error| io_error("read bound recovery mint receipt", error))?,
        )
        .map_err(|error| {
            fork_error(
                "SNAPBACK_FORK_RECEIPT_INVALID",
                format!("recovery mint receipt is malformed: {error}"),
            )
        })?;
        if receipt.lineage.expires_at_ms.is_none() {
            return Err(fork_error(
                "SNAPBACK_FORK_TTL_INVALID",
                "product recovery refuses an unbounded derived fork",
            ));
        }
    } else if let Some(name) = destination.file_name().and_then(|value| value.to_str()) {
        let prefix = format!(".{name}.staging-");
        for entry in fs::read_dir(parent)
            .map_err(|error| io_error("scan bound fork staging directories", error))?
        {
            let entry = entry.map_err(|error| io_error("read bound fork staging entry", error))?;
            if !entry.file_name().to_string_lossy().starts_with(&prefix) {
                continue;
            }
            if entry.path().join(MINT_RECEIPT_FILE).is_file() {
                validate_destination_app_binding(&entry.path(), expected)?;
            } else {
                validate_staging_app_binding(&entry.path(), expected)?;
            }
        }
    }
    recover(parent, destination)
}

/// Recover solely from local staging/published evidence after the product
/// caller has established app-root authority. A missing or corrupt advisory
/// registry is deliberately ignored.
#[doc(hidden)]
pub fn recover(parent: &Path, destination: &Path) -> SnapbackResult<()> {
    if destination.exists() && destination.join(STAGING_SENTINEL).exists() {
        let receipt_path = destination.join(MINT_RECEIPT_FILE);
        let receipt: ForkMintReceiptV1 = serde_json::from_slice(
            &fs::read(&receipt_path)
                .map_err(|error| io_error("read recovered fork receipt", error))?,
        )
        .map_err(|_| {
            fork_error(
                "SNAPBACK_FORK_RECEIPT_INVALID",
                "recovered fork mint receipt is malformed",
            )
        })?;
        let database = destination.join(&receipt.database_file);
        if !database.is_file() {
            return Err(fork_error(
                "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
                "published fork database is missing",
            ));
        }
        // A crash-interrupted renewal leaves its durable intent behind the
        // sentinel; completing it restores all three expiry carriers to the
        // intent's one lineage before the fork becomes bootable again.
        let intent_path = destination.join(RENEW_INTENT_FILE);
        if intent_path.exists() {
            let intent: ForkRenewIntentV1 = serde_json::from_slice(
                &fs::read(&intent_path)
                    .map_err(|error| io_error("read fork renewal intent", error))?,
            )
            .map_err(|_| {
                fork_error(
                    "SNAPBACK_FORK_RECEIPT_INVALID",
                    "fork renewal intent is malformed",
                )
            })?;
            let mut expected = receipt.lineage.clone();
            expected.expires_at_ms = intent.lineage.expires_at_ms;
            if intent.format_version != 1
                || intent.lineage.promotable
                || intent.lineage.expires_at_ms.is_none()
                || intent.lineage != expected
            {
                return Err(fork_error(
                    "SNAPBACK_FORK_EVIDENCE_MISMATCH",
                    "fork renewal intent does not identify this fork",
                ));
            }
            apply_renewal(parent, destination, &database, &intent, None)?;
            if inspect_evidence(&database)?.is_none() {
                return Err(fork_error(
                    "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
                    "renewed fork lost its local lineage evidence",
                ));
            }
            return Ok(());
        }
        // @ref LLP 0158#design-sketch — keep quarantine
        // present through the complete local-evidence check; a recovery crash
        // must never expose a bootable derived deployment.
        let sentinel = destination.join(STAGING_SENTINEL);
        match inspect_evidence(&database) {
            Ok(Some(_)) => {
                reconcile_registry(parent, destination, &receipt);
                fs::remove_file(&sentinel)
                    .map_err(|error| io_error("clear recovered sentinel", error))?;
                sync_directory(destination)?;
                sync_directory(parent)?;
                return Ok(());
            }
            other => {
                other?;
            }
        }
    }
    let prefix = destination
        .file_name()
        .and_then(|value| value.to_str())
        .map(|name| format!(".{name}.staging-"));
    if let Some(prefix) = prefix {
        for entry in fs::read_dir(parent)
            .map_err(|error| io_error("scan fork staging directories", error))?
        {
            let entry = entry.map_err(|error| io_error("read fork staging entry", error))?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let Some(suffix) = name.strip_prefix(&prefix) else {
                continue;
            };
            // Evidence-bound reaping (2026-08-05 review blocker): only a
            // directory whose suffix is the publish-minted UUID and which
            // carries the staging sentinel is provably fork staging. A
            // same-prefix bystander directory is never deleted. Note the
            // remaining caveat: recovery cannot distinguish crashed staging
            // from a publication racing it this instant — recover is a
            // repair verb for a destination with no live publisher.
            if Uuid::parse_str(suffix).is_err() {
                continue;
            }
            if !entry.path().join(STAGING_SENTINEL).is_file() {
                // A crash between mkdir and the sentinel write leaves an
                // empty shell; removing an empty directory loses nothing.
                // Anything non-empty without a sentinel is not provably
                // ours and stays.
                let empty = fs::read_dir(entry.path())
                    .map(|mut entries| entries.next().is_none())
                    .unwrap_or(false);
                if empty {
                    let _ = fs::remove_dir(entry.path());
                }
                continue;
            }
            fs::remove_dir_all(entry.path())
                .map_err(|error| io_error("reap unpublished fork staging", error))?;
        }
        sync_directory(parent)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
