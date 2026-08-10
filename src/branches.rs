//! Ephemeral data branches — registry & lifecycle (LLP 0097, phase P0.1).
//!
//! @ref LLP 0097#1-the-branch-is-an-ephemeral-child-of-a-logical-app — a branch
//! is a short-lived, writable child within one logical app's trust boundary.
//! @ref LLP 0097#design — a full branch is a materialized base at version V + an
//! operation/command log + a copy-on-write overlay; this module implements only
//! the additive **registry + lifecycle** slice (P0.1). It does not touch the
//! canonical change journal or version stream — those are later increments
//! (P0.2 child stream, P0.3 materialized base, P0.4 COW reads/writes).

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub use crate::contract_types::BranchId;
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};

/// Identity of a branch's typed ephemeral **child version-stream**.
///
/// @ref LLP 0097#1-the-branch-is-an-ephemeral-child-of-a-logical-app — the
/// normative amendment to LLP 0007/0018: a logical app owns one canonical stream
/// plus zero-or-more typed ephemeral child streams. A child stream's versions are
/// never numerically comparable to the canonical stream; `base_version` is a fork
/// pointer, not a shared coordinate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ChildStreamId(pub String);

/// Lifecycle state of a branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum BranchState {
    /// Live: divergent reads/writes resolve against the branch overlay.
    Active,
    /// Marked for teardown; admits no new work. Cleared by GC (LLP 0097 §4).
    TearingDown,
}

impl BranchState {
    fn as_str(self) -> &'static str {
        match self {
            BranchState::Active => "active",
            BranchState::TearingDown => "tearing_down",
        }
    }

    fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "active" => Ok(BranchState::Active),
            "tearing_down" => Ok(BranchState::TearingDown),
            other => Err(invalid(format!("unknown branch state {other:?}"))),
        }
    }
}

/// A registered ephemeral branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct BranchRecord {
    pub branch_id: BranchId,
    pub child_stream_id: ChildStreamId,
    /// Canonical version the branch forked from — its compare-and-swap base for
    /// promotion.
    ///
    /// @ref LLP 0097#5 — v1
    /// promotion requires the canonical head to equal `base_version`.
    pub base_version: u64,
    /// Canonical data-version-stream identity the branch forked from.
    pub base_stream: String,
    pub state: BranchState,
    /// Server-clock creation time (caller-supplied; the store never reads a wall
    /// clock, per Snapback's injected-clock discipline).
    pub created_at_ms: i64,
    /// Optional TTL for ephemeral teardown (LLP 0097 §4). `None` = no TTL.
    pub ttl_ms: Option<i64>,
}

fn invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::new(Diagnostic::error(
        "SNAPBACK_BRANCH_INVALID",
        "storage",
        message,
    ))
}

/// A row read straight from SQLite, before the fallible `state` parse.
struct RawRow {
    branch_id: String,
    child_stream_id: String,
    base_version: i64,
    base_stream: String,
    state: String,
    created_at_ms: i64,
    ttl_ms: Option<i64>,
}

fn read_raw(row: &Row<'_>) -> rusqlite::Result<RawRow> {
    Ok(RawRow {
        branch_id: row.get(0)?,
        child_stream_id: row.get(1)?,
        base_version: row.get(2)?,
        base_stream: row.get(3)?,
        state: row.get(4)?,
        created_at_ms: row.get(5)?,
        ttl_ms: row.get(6)?,
    })
}

impl RawRow {
    fn into_record(self) -> SnapbackResult<BranchRecord> {
        if self.base_version < 0 {
            return Err(invalid("branch base_version is negative"));
        }
        Ok(BranchRecord {
            branch_id: BranchId(self.branch_id),
            child_stream_id: ChildStreamId(self.child_stream_id),
            base_version: self.base_version as u64,
            base_stream: self.base_stream,
            state: BranchState::parse(&self.state)?,
            created_at_ms: self.created_at_ms,
            ttl_ms: self.ttl_ms,
        })
    }
}

const SELECT_COLUMNS: &str =
    "branch_id, child_stream_id, base_version, base_stream, state, created_at_ms, ttl_ms";

/// Ensure the branch registry table exists. Idempotent and additive — it never
/// touches the canonical journal or version stream.
pub fn ensure_branch_registry(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_branches (
           branch_id       TEXT PRIMARY KEY,
           child_stream_id TEXT NOT NULL UNIQUE,
           base_version    INTEGER NOT NULL CHECK(base_version >= 0),
           base_stream     TEXT NOT NULL,
           state           TEXT NOT NULL,
           created_at_ms   INTEGER NOT NULL,
           ttl_ms          INTEGER
         );
         CREATE INDEX IF NOT EXISTS _snapback_branches_by_state
           ON _snapback_branches(state);
         -- @ref LLP 0097#1-the-branch-is-an-ephemeral-child-of-a-logical-app —
         -- the typed ephemeral child version-stream: its own gap-free monotonic
         -- versions and an independent replay floor, never comparable to the
         -- canonical stream. One row per branch, keyed by branch_id.
         CREATE TABLE IF NOT EXISTS _snapback_branch_versions (
           branch_id       TEXT PRIMARY KEY
                             REFERENCES _snapback_branches(branch_id) ON DELETE CASCADE,
           current_version INTEGER NOT NULL CHECK(current_version >= 0),
           replay_floor    INTEGER NOT NULL CHECK(replay_floor >= 0)
         );",
    )?;
    Ok(())
}

/// Register a new ephemeral branch forked from `(base_stream, base_version)`.
///
/// Fails closed if `branch_id` or `child_stream_id` already exists (both are
/// unique) — a branch identity is never silently reused.
#[allow(clippy::too_many_arguments)]
pub fn create_branch(
    conn: &Transaction<'_>,
    branch_id: &BranchId,
    child_stream_id: &ChildStreamId,
    base_stream: &str,
    base_version: u64,
    created_at_ms: i64,
    ttl_ms: Option<i64>,
) -> SnapbackResult<BranchRecord> {
    ensure_branch_registry(conn)?;
    let record = BranchRecord {
        branch_id: branch_id.clone(),
        child_stream_id: child_stream_id.clone(),
        base_version,
        base_stream: base_stream.to_string(),
        state: BranchState::Active,
        created_at_ms,
        ttl_ms,
    };
    conn.execute(
        "INSERT INTO _snapback_branches
           (branch_id, child_stream_id, base_version, base_stream, state, created_at_ms, ttl_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            record.branch_id.0,
            record.child_stream_id.0,
            record.base_version as i64,
            record.base_stream,
            record.state.as_str(),
            record.created_at_ms,
            record.ttl_ms,
        ],
    )?;
    // Initialize the branch's child version stream at version 0, floor 0.
    conn.execute(
        "INSERT INTO _snapback_branch_versions (branch_id, current_version, replay_floor)
         VALUES (?1, 0, 0)",
        params![record.branch_id.0],
    )?;
    Ok(record)
}

/// Look up a branch by id.
pub fn get_branch(conn: &Connection, branch_id: &BranchId) -> SnapbackResult<Option<BranchRecord>> {
    ensure_branch_registry(conn)?;
    let raw = conn
        .query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM _snapback_branches WHERE branch_id = ?1"),
            params![branch_id.0],
            read_raw,
        )
        .optional()?;
    raw.map(RawRow::into_record).transpose()
}

/// List every registered branch, newest first.
pub fn list_branches(conn: &Connection) -> SnapbackResult<Vec<BranchRecord>> {
    ensure_branch_registry(conn)?;
    let mut statement = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM _snapback_branches ORDER BY created_at_ms DESC, branch_id"
    ))?;
    let raws = statement
        .query_map([], read_raw)?
        .collect::<rusqlite::Result<Vec<RawRow>>>()?;
    raws.into_iter().map(RawRow::into_record).collect()
}

/// Mark a branch for teardown. Returns whether the branch existed.
pub fn mark_teardown(conn: &Connection, branch_id: &BranchId) -> SnapbackResult<bool> {
    ensure_branch_registry(conn)?;
    let updated = conn.execute(
        "UPDATE _snapback_branches SET state = ?2 WHERE branch_id = ?1",
        params![branch_id.0, BranchState::TearingDown.as_str()],
    )?;
    Ok(updated > 0)
}

// ---------------------------------------------------------------------------
// Child version stream (LLP 0097 P0.2) — the typed ephemeral child stream.
//
// @ref LLP 0097#1-the-branch-is-an-ephemeral-child-of-a-logical-app — gap-free
// monotonic versions with an independent replay floor, NEVER numerically
// comparable to the canonical stream. `base_version` on the branch record is a
// fork pointer into canonical, not a shared coordinate with this stream.
// ---------------------------------------------------------------------------

/// The current (highest-allocated) version in a branch's child stream, or `None`
/// if the branch has no version-stream row (never created, or torn down).
pub fn child_current_version(
    conn: &Connection,
    branch_id: &BranchId,
) -> SnapbackResult<Option<u64>> {
    ensure_branch_registry(conn)?;
    let value: Option<i64> = conn
        .query_row(
            "SELECT current_version FROM _snapback_branch_versions WHERE branch_id = ?1",
            params![branch_id.0],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value.map(|n| n.max(0) as u64))
}

/// Allocate the next version in a branch's child stream — gap-free, monotonic,
/// independent of canonical. Fails closed if the branch has no version stream.
pub fn allocate_child_version(conn: &Connection, branch_id: &BranchId) -> SnapbackResult<u64> {
    ensure_branch_registry(conn)?;
    // @ref LLP 0097#1-the-branch-is-an-ephemeral-child-of-a-logical-app — the
    // child stream is gap-free even when independent connections allocate at
    // once. One SQLite statement both increments and returns the winning value.
    let next: Option<i64> = conn
        .query_row(
            "UPDATE _snapback_branch_versions
                SET current_version = current_version + 1
              WHERE branch_id = ?1 AND current_version < ?2
              RETURNING current_version",
            params![
                branch_id.0,
                crate::manifest::PORTABLE_STORAGE_VERSION_MAX as i64
            ],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(next) = next {
        return Ok(next as u64);
    }

    // Distinguish a missing stream from portable-domain exhaustion without
    // reintroducing a read/increment/write race on the successful path.
    match child_current_version(conn, branch_id)? {
        Some(current) => crate::storage::next_storage_version(current),
        None => Err(invalid(format!(
            "no child version stream for branch {:?}",
            branch_id.0
        ))),
    }
}

/// The replay floor of a branch's child stream (the oldest version a consumer may
/// still resume from). `None` if the branch has no version stream.
pub fn child_replay_floor(conn: &Connection, branch_id: &BranchId) -> SnapbackResult<Option<u64>> {
    ensure_branch_registry(conn)?;
    let value: Option<i64> = conn
        .query_row(
            "SELECT replay_floor FROM _snapback_branch_versions WHERE branch_id = ?1",
            params![branch_id.0],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value.map(|n| n.max(0) as u64))
}

/// Advance a branch's child-stream replay floor. The floor is monotonic and may
/// never exceed the current allocated version (fail-closed).
pub fn set_child_replay_floor(
    conn: &Connection,
    branch_id: &BranchId,
    floor: u64,
) -> SnapbackResult<()> {
    ensure_branch_registry(conn)?;
    let current = child_current_version(conn, branch_id)?.ok_or_else(|| {
        invalid(format!(
            "no child version stream for branch {:?}",
            branch_id.0
        ))
    })?;
    let existing = child_replay_floor(conn, branch_id)?.unwrap_or(0);
    if floor < existing {
        return Err(invalid("branch replay floor cannot move backward"));
    }
    if floor > current {
        return Err(invalid(
            "branch replay floor cannot exceed the current version",
        ));
    }
    conn.execute(
        "UPDATE _snapback_branch_versions SET replay_floor = ?2 WHERE branch_id = ?1",
        params![branch_id.0, floor as i64],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Materialized base (LLP 0097 P0.3) — a consistent snapshot of the source at a
// specific canonical head, in its own isolated SQLite database.
//
// @ref LLP 0097#design — a branch is a materialized base at version V + a
// command log + a COW overlay. This slice captures the base and the exact V it
// represents. First cut: one SQLite database per branch, seeded via the backup
// API; teardown = drop the handle + delete the file.
// ---------------------------------------------------------------------------

/// A branch workspace with a query-only immutable base and a separate writable
/// head seeded from the same consistent snapshot.
///
/// The original P0.3 substrate used one writable copy as both "base" and head,
/// which could not prove an exact net diff after a revert. The comparison base
/// is private and SQLite-enforced query-only; callers mutate only [`Self::conn`].
///
/// @ref LLP 0164#contract-summary-normative-details-per-llp-0162-3-5 — exact
///   net diff requires an immutable retained base or first-write preimages.
pub struct MaterializedBase {
    /// The branch's writable materialized overlay head.
    pub conn: Connection,
    immutable_base: Connection,
    /// The canonical head captured in this snapshot — the CAS anchor for
    /// promotion (P3). Read back FROM the snapshot, so it is exactly consistent
    /// with the captured pages regardless of concurrent writers on the source.
    pub base_version: u64,
    /// The on-disk location, or `None` for an in-memory base (ephemeral/tests).
    pub path: Option<PathBuf>,
    immutable_base_path: Option<PathBuf>,
}

impl MaterializedBase {
    /// Materialize a branch base by snapshotting `source` into a fresh database.
    ///
    /// `target` = `Some(path)` writes an on-disk base (teardown deletes it);
    /// `None` keeps it in memory. The recorded `base_version` is read back from
    /// the snapshot itself, making it atomically consistent with the copied
    /// pages even if the source advances mid-backup.
    pub fn materialize(source: &Connection, target: Option<&Path>) -> SnapbackResult<Self> {
        let immutable_base_path = target.map(|path| {
            let mut value = path.as_os_str().to_os_string();
            value.push(".immutable-base");
            PathBuf::from(value)
        });
        let mut immutable_base = match immutable_base_path.as_deref() {
            Some(p) => Connection::open(p)?,
            None => Connection::open_in_memory()?,
        };
        {
            // @ref LLP 0028 — same backup primitive used by detached_read_snapshot.
            let backup = rusqlite::backup::Backup::new(source, &mut immutable_base)?;
            backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
        }
        let base_version = crate::storage::current_version_on(&immutable_base)?;
        immutable_base.execute_batch("PRAGMA query_only = ON;")?;
        let mut conn = match target {
            Some(p) => Connection::open(p)?,
            None => Connection::open_in_memory()?,
        };
        {
            let backup = rusqlite::backup::Backup::new(&immutable_base, &mut conn)?;
            backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
        }
        Ok(Self {
            conn,
            immutable_base,
            base_version,
            path: target.map(|p| p.to_path_buf()),
            immutable_base_path,
        })
    }

    /// Reopen a file-backed workspace previously produced by
    /// [`Self::materialize`]. Both files are required: silently rebuilding the
    /// immutable comparison base from the writable head would bless branch
    /// writes as pre-fork state and make an exact diff impossible.
    ///
    /// @ref LLP 0162#acceptance — the DenyAll marker and immutable base must
    ///   survive process crash/reopen without weakening sibling or canonical
    ///   isolation.
    pub fn reopen(path: &Path) -> SnapbackResult<Self> {
        let mut immutable_base_path = path.as_os_str().to_os_string();
        immutable_base_path.push(".immutable-base");
        let immutable_base_path = PathBuf::from(immutable_base_path);
        let real_file = |candidate: &Path| {
            std::fs::symlink_metadata(candidate)
                .is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        };
        if !real_file(path) || !real_file(&immutable_base_path) {
            return Err(invalid(
                "a managed branch workspace requires real, non-symlink writable-head and immutable-base files",
            ));
        }
        let conn = Connection::open(path)?;
        let immutable_base = Connection::open(&immutable_base_path)?;
        let base_version = crate::storage::current_version_on(&immutable_base)?;
        immutable_base.execute_batch("PRAGMA query_only = ON;")?;
        Ok(Self {
            conn,
            immutable_base,
            base_version,
            path: Some(path.to_path_buf()),
            immutable_base_path: Some(immutable_base_path),
        })
    }

    /// The retained comparison base. SQLite enforces query-only access.
    pub fn immutable_base(&self) -> &Connection {
        &self.immutable_base
    }

    /// Tear down the base: drop the connection and delete the backing file (if
    /// any). Idempotent — a missing file is not an error.
    pub fn teardown(self) -> SnapbackResult<()> {
        let operation_detail_sidecar = self
            .path
            .as_deref()
            .map(crate::operation_detail::keyring_path);
        let primary = [self.path.clone(), self.immutable_base_path.clone()];
        let mut paths = primary
            .iter()
            .flatten()
            .flat_map(|path| {
                ["", "-wal", "-shm"].map(|suffix| {
                    let mut value = path.as_os_str().to_os_string();
                    value.push(suffix);
                    PathBuf::from(value)
                })
            })
            .collect::<Vec<_>>();
        paths.extend(operation_detail_sidecar);
        drop(self); // close the connection before unlinking
        for p in paths {
            match std::fs::remove_file(&p) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    return Err(invalid(format!(
                        "failed to delete branch base {:?}: {e}",
                        p
                    )));
                }
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// COW overlay ledger (LLP 0097 P0.4) — the enumerable divergence of a branch.
//
// The writable head starts as a byte-equivalent copy of the immutable retained
// base. This legacy ledger remains attributed change inventory only; it is never
// a promotion input. `fork_promotion` accepts only replay-sufficient invocations.
//
// @ref LLP 0097#design — materialized base + operation/command log + COW overlay.
// ---------------------------------------------------------------------------

/// The kind of logical write recorded in a branch overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OverlayOp {
    /// Insert-or-update of a keyed row.
    Upsert,
    /// Deletion of a keyed row.
    Delete,
}

impl OverlayOp {
    fn as_str(self) -> &'static str {
        match self {
            OverlayOp::Upsert => "upsert",
            OverlayOp::Delete => "delete",
        }
    }

    fn parse(raw: &str) -> SnapbackResult<Self> {
        match raw {
            "upsert" => Ok(OverlayOp::Upsert),
            "delete" => Ok(OverlayOp::Delete),
            other => Err(invalid(format!("unknown overlay op {other:?}"))),
        }
    }
}

/// A single logical write in a branch's overlay ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverlayWrite {
    pub table_name: String,
    pub row_id: String,
    pub op: OverlayOp,
    /// Serialized row payload for `Upsert`; `None` for `Delete`.
    pub payload: Option<String>,
}

/// Create the branch overlay ledger in a branch database (idempotent). One
/// branch per materialized database, so `child_version` is a sufficient key.
pub fn ensure_branch_overlay(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_branch_overlay (
            child_version  INTEGER PRIMARY KEY,
            branch_id      TEXT NOT NULL,
            table_name     TEXT NOT NULL,
            row_id         TEXT NOT NULL,
            op             TEXT NOT NULL,
            payload        TEXT,
            recorded_at_ms INTEGER NOT NULL
         );",
    )?;
    Ok(())
}

/// Record a branch-local logical write into the overlay ledger, allocating the
/// next child-stream version atomically with the ledger append. Returns the
/// child version assigned to this write.
///
/// The physical data mutation is the caller's responsibility; wrap it in the
/// same transaction as this call for atomic overlay-over-base semantics.
/// Requires the branch's child version-stream row (copied into the branch DB at
/// materialization) to exist — fails closed otherwise.
pub fn record_overlay_write(
    conn: &mut Connection,
    branch_id: &BranchId,
    write: &OverlayWrite,
    now_ms: i64,
) -> SnapbackResult<u64> {
    ensure_branch_overlay(conn)?;
    let tx = conn.transaction()?;
    // Allocation participates in this transaction; a rolled-back ledger append
    // rolls back the version bump too — no gaps, no orphaned versions.
    let version = allocate_child_version(&tx, branch_id)?;
    tx.execute(
        "INSERT INTO _snapback_branch_overlay
           (child_version, branch_id, table_name, row_id, op, payload, recorded_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            version as i64,
            branch_id.0,
            write.table_name,
            write.row_id,
            write.op.as_str(),
            write.payload,
            now_ms,
        ],
    )?;
    tx.commit()?;
    Ok(version)
}

/// Enumerate a branch's divergence in child-version order — the replay list for
/// promotion (P3). Empty if the branch never diverged.
pub fn overlay_writes(conn: &Connection) -> SnapbackResult<Vec<(u64, OverlayWrite)>> {
    ensure_branch_overlay(conn)?;
    let mut stmt = conn.prepare(
        "SELECT child_version, table_name, row_id, op, payload
           FROM _snapback_branch_overlay
          ORDER BY child_version ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (version, table_name, row_id, op, payload) = row?;
        out.push((
            version.max(0) as u64,
            OverlayWrite {
                table_name,
                row_id,
                op: OverlayOp::parse(&op)?,
                payload,
            },
        ));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Effect isolation — capture-don't-fire (LLP 0097 P1).
//
// When a handler runs in an ephemeral branch, host-mediated egress must NOT
// fire. Instead each egress attempt is classified against a CLOSED set of
// host-mediated classes and appended to a captured-effect ledger sharing the
// branch's child version-stream (so data writes and effects share one total
// order for promotion replay). The closed enum is the fail-closed contract: an
// egress path that cannot be classified cannot be captured and must be refused
// — it may never silently fire from within a branch.
//
// @ref LLP 0097#2 — HostMediated vs EndToEnd; v1 capability is HostMediated.
// @ref LLP 0070 — the CaptureOnly idiom this generalizes.
// ---------------------------------------------------------------------------

/// Whether an execution fires host egress or captures it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchExecutionMode {
    /// Execution against canonical — effects fire for real.
    Canonical,
    /// Ephemeral-branch execution — host egress is captured, never fired.
    Branch,
}

/// What to do with a host-egress attempt under a given execution mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EgressDisposition {
    Fire,
    Capture,
}

impl BranchExecutionMode {
    /// The egress routing decision for this mode.
    pub fn egress_disposition(self) -> EgressDisposition {
        match self {
            BranchExecutionMode::Canonical => EgressDisposition::Fire,
            BranchExecutionMode::Branch => EgressDisposition::Capture,
        }
    }
}

/// The closed set of host-mediated egress classes (LLP 0097 OQ3 exhaustiveness).
/// Closed by construction: an egress path that does not map to one of these
/// cannot be represented, so it fails closed at classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EffectClass {
    Fetch,
    Notification,
    Payment,
    Cron,
    Outbox,
    Uses,
}

impl EffectClass {
    fn as_str(self) -> &'static str {
        match self {
            EffectClass::Fetch => "fetch",
            EffectClass::Notification => "notification",
            EffectClass::Payment => "payment",
            EffectClass::Cron => "cron",
            EffectClass::Outbox => "outbox",
            EffectClass::Uses => "uses",
        }
    }

    /// Classify a raw egress kind. Fails closed on anything unrecognized — an
    /// unclassifiable egress path may never fire nor be silently captured.
    pub fn classify(kind: &str) -> SnapbackResult<Self> {
        match kind {
            "fetch" => Ok(EffectClass::Fetch),
            "notification" => Ok(EffectClass::Notification),
            "payment" => Ok(EffectClass::Payment),
            "cron" => Ok(EffectClass::Cron),
            "outbox" => Ok(EffectClass::Outbox),
            "uses" => Ok(EffectClass::Uses),
            other => Err(invalid(format!(
                "unclassifiable host egress {other:?} — refused in branch execution (fail-closed)"
            ))),
        }
    }
}

/// Capture scope. v1 admits `HostMediated` only; `EndToEnd` is refused until the
/// end-to-end capture story lands.
///
/// @ref LLP 0097#2
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EffectScope {
    HostMediated,
    EndToEnd,
}

impl EffectScope {
    fn as_str(self) -> &'static str {
        match self {
            EffectScope::HostMediated => "host_mediated",
            EffectScope::EndToEnd => "end_to_end",
        }
    }
}

/// An egress attempt to capture instead of fire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedEffectInput {
    pub class: EffectClass,
    pub scope: EffectScope,
    /// Logical destination (url, topic, payment target, `uses` id, …).
    pub target: String,
    pub payload: Option<String>,
    /// The declared deterministic outcome handed back to the handler in place
    /// of the real effect's result (simulation adapter). `None` = no return.
    pub simulated_outcome: Option<String>,
}

/// A captured effect as recorded in the ledger, keyed by its position in the
/// branch's child version-stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedEffect {
    pub child_version: u64,
    pub class: EffectClass,
    pub scope: EffectScope,
    pub target: String,
    pub payload: Option<String>,
    pub simulated_outcome: Option<String>,
}

/// Create the captured-effect ledger in a branch database (idempotent).
pub fn ensure_captured_effects(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_captured_effects (
            child_version     INTEGER PRIMARY KEY,
            branch_id         TEXT NOT NULL,
            class             TEXT NOT NULL,
            scope             TEXT NOT NULL,
            target            TEXT NOT NULL,
            payload           TEXT,
            simulated_outcome TEXT,
            recorded_at_ms    INTEGER NOT NULL
         );",
    )?;
    Ok(())
}

/// Capture a host-egress attempt into the ledger instead of firing it. Allocates
/// the next child-stream version atomically with the ledger append, so effects
/// and data writes share one total order. Fails closed if the scope is not
/// `HostMediated` (v1 capability), or if the branch has no child stream.
pub fn capture_effect(
    conn: &mut Connection,
    branch_id: &BranchId,
    effect: &CapturedEffectInput,
    now_ms: i64,
) -> SnapbackResult<u64> {
    if effect.scope != EffectScope::HostMediated {
        return Err(invalid(
            "only HostMediated effects can be captured in v1 (fail-closed)",
        ));
    }
    ensure_captured_effects(conn)?;
    let tx = conn.transaction()?;
    let version = allocate_child_version(&tx, branch_id)?;
    tx.execute(
        "INSERT INTO _snapback_captured_effects
           (child_version, branch_id, class, scope, target, payload, simulated_outcome, recorded_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            version as i64,
            branch_id.0,
            effect.class.as_str(),
            effect.scope.as_str(),
            effect.target,
            effect.payload,
            effect.simulated_outcome,
            now_ms,
        ],
    )?;
    tx.commit()?;
    Ok(version)
}

/// Enumerate captured effects in child-version order — the effect-replay list
/// for promotion (P3), interleaved with overlay writes by shared version.
pub fn captured_effects(conn: &Connection) -> SnapbackResult<Vec<CapturedEffect>> {
    ensure_captured_effects(conn)?;
    let mut stmt = conn.prepare(
        "SELECT child_version, class, scope, target, payload, simulated_outcome
           FROM _snapback_captured_effects
          ORDER BY child_version ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (version, class, scope, target, payload, simulated_outcome) = row?;
        let class = EffectClass::classify(&class)?;
        let scope = match scope.as_str() {
            "host_mediated" => EffectScope::HostMediated,
            "end_to_end" => EffectScope::EndToEnd,
            other => return Err(invalid(format!("unknown effect scope {other:?}"))),
        };
        out.push(CapturedEffect {
            child_version: version.max(0) as u64,
            class,
            scope,
            target,
            payload,
            simulated_outcome,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Promotion — op-log, receipts, revalidated authority, staged settlement
// (LLP 0097 P2 + P3).
//
// Promotion re-plays a branch's operation log (overlay writes + captured
// effects, merged by their shared child version = causal order) into canonical:
//   - authority is REVALIDATED at promotion, never preserved from the fork;
//   - v1 requires canonical head == base_version (refuse on ANY advance);
//   - one canonical transaction advances canonical by exactly ONE version;
//   - effect-dependent writes commit PROVISIONALLY and land in a reconciliation
//     ledger (pending → succeeded|rejected|ambiguous), settled after the real
//     effects fire ("never rolled back after initiation");
//   - branch-tagged receipts record every op's promotion outcome.
//
// @ref LLP 0097#design — staged promotion + provisional/pending + transitive
//   effect-dependence.
// @ref LLP 0055 — authority revalidated per attempt, never preserved from fork.
// @ref LLP 0070 — durable background work / capture-and-settle semantics.
// ---------------------------------------------------------------------------

/// A branch operation in causal (child-version) order — the promotion op-log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BranchOp {
    Write(u64, OverlayWrite),
    Effect(CapturedEffect),
}

impl BranchOp {
    pub fn child_version(&self) -> u64 {
        match self {
            BranchOp::Write(v, _) => *v,
            BranchOp::Effect(e) => e.child_version,
        }
    }
}

/// The full branch op-log: overlay writes and captured effects merged into one
/// causal order by their shared child version.
pub fn branch_op_log(conn: &Connection) -> SnapbackResult<Vec<BranchOp>> {
    let mut ops: Vec<BranchOp> = overlay_writes(conn)?
        .into_iter()
        .map(|(v, w)| BranchOp::Write(v, w))
        .chain(captured_effects(conn)?.into_iter().map(BranchOp::Effect))
        .collect();
    ops.sort_by_key(|op| op.child_version());
    Ok(ops)
}

/// Authority is revalidated at promotion (and at each async effect attempt),
/// never carried over from the fork. A `Denied` decision fails promotion closed.
///
/// @ref LLP 0055
/// @ref LLP 0070
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthorityDecision {
    Revalidated,
    Denied,
}

/// Promotion outcome for a single branch op — the branch-tagged receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchReceiptOutcome {
    /// Committed unconditionally (no effect dependence).
    Confirmed,
    /// Committed provisionally; awaits effect settlement + reconciliation.
    Provisional,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BranchReceiptKind {
    Mutation { table_name: String, row_id: String },
    Effect { class: EffectClass },
}

/// A branch-tagged receipt (extends LLP 0043 mutation receipts + the new
/// external-effect receipt, OQ6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchReceipt {
    pub branch_id: String,
    pub child_version: u64,
    pub kind: BranchReceiptKind,
    pub outcome: BranchReceiptOutcome,
}

/// The result of promoting a branch into canonical.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromotionResult {
    /// The single new canonical version after promotion.
    pub canonical_version: u64,
    /// Writes committed unconditionally.
    pub committed: Vec<(u64, OverlayWrite)>,
    /// Effect-dependent writes committed provisionally (pending reconciliation).
    pub provisional: Vec<(u64, OverlayWrite)>,
    /// Captured effects to settle asynchronously (NOT fired by promotion).
    pub effect_intents: Vec<CapturedEffect>,
    /// Branch-tagged receipts, one per replayed op, in causal order.
    pub receipts: Vec<BranchReceipt>,
}

/// Settlement of a captured effect after it really fires (P3 reconciliation).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectSettlement {
    Succeeded,
    Rejected,
    Ambiguous,
}

impl EffectSettlement {
    fn as_str(self) -> &'static str {
        match self {
            EffectSettlement::Succeeded => "succeeded",
            EffectSettlement::Rejected => "rejected",
            EffectSettlement::Ambiguous => "ambiguous",
        }
    }
}

/// Create the promotion reconciliation ledger on canonical (idempotent).
pub fn ensure_promotion_pending(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_promotion_pending (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            branch_id           TEXT NOT NULL,
            child_version       INTEGER NOT NULL,
            kind                TEXT NOT NULL,
            table_name          TEXT,
            row_id              TEXT,
            op                  TEXT,
            payload             TEXT,
            effect_class        TEXT,
            target              TEXT,
            simulated_outcome   TEXT,
            status              TEXT NOT NULL DEFAULT 'pending',
            promoted_at_version INTEGER NOT NULL
         );",
    )?;
    Ok(())
}

/// Promote a branch into canonical.
///
/// `apply_write` performs the physical mutation for one overlay write inside the
/// single canonical transaction (schema-specific; injected so this stays generic
/// over the app's tables). `authority` MUST be freshly `Revalidated` — a value
/// preserved from the fork is exactly what this refuses.
///
/// Effect-dependent writes are identified conservatively (transitive
/// over-approximation): any overlay write ordered at/after the first captured
/// effect may have observed a simulated outcome, so it commits provisionally.
/// Writes strictly before any effect commit unconditionally.
/// Disabled in every build: promotion from `OverlayWrite` post-images violates
/// Accepted LLP 0097. `fork_promotion::promote_by_reexecution` is the sole
/// replacement surface.
///
/// @ref LLP 0164#contract-summary-normative-details-per-llp-0162-3-5 — no
///   product path may promote branch post-images.
#[cfg(any())]
pub fn promote<F>(
    canonical: &mut Connection,
    base: &Connection,
    branch_id: &BranchId,
    base_version: u64,
    authority: AuthorityDecision,
    apply_write: F,
) -> SnapbackResult<PromotionResult>
where
    F: Fn(&rusqlite::Transaction, &OverlayWrite) -> SnapbackResult<()>,
{
    // Authority is revalidated, not preserved from fork.
    if authority != AuthorityDecision::Revalidated {
        return Err(invalid(
            "promotion authority not revalidated — refused (authority is never preserved from fork)",
        ));
    }
    // v1 base-equality: refuse if canonical advanced past the fork point.
    let head = crate::storage::current_version_on(canonical)?;
    if head != base_version {
        return Err(invalid(format!(
            "promotion base-equality violated: canonical head {head} != base_version {base_version} (v1 refuses on any advance)"
        )));
    }

    let ops = branch_op_log(base)?;
    let effects: Vec<CapturedEffect> = captured_effects(base)?;
    let first_effect_version = effects.iter().map(|e| e.child_version).min();

    // Partition overlay writes into unconditional vs effect-dependent.
    let mut committed: Vec<(u64, OverlayWrite)> = Vec::new();
    let mut provisional: Vec<(u64, OverlayWrite)> = Vec::new();
    for op in &ops {
        if let BranchOp::Write(v, w) = op {
            let dependent = first_effect_version.map(|fe| *v >= fe).unwrap_or(false);
            if dependent {
                provisional.push((*v, w.clone()));
            } else {
                committed.push((*v, w.clone()));
            }
        }
    }

    ensure_promotion_pending(canonical)?;
    let new_version = crate::storage::next_storage_version(base_version)?;
    let tx = canonical.transaction()?;
    // Apply every write (committed + provisional) so canonical is consistent at
    // one version; provisional ones are additionally tracked for reconciliation.
    for (_, w) in committed.iter().chain(provisional.iter()) {
        apply_write(&tx, w)?;
    }
    for (v, w) in &provisional {
        tx.execute(
            "INSERT INTO _snapback_promotion_pending
               (branch_id, child_version, kind, table_name, row_id, op, payload, promoted_at_version)
             VALUES (?1, ?2, 'write', ?3, ?4, ?5, ?6, ?7)",
            params![branch_id.0, *v as i64, w.table_name, w.row_id, w.op.as_str(), w.payload, new_version as i64],
        )?;
    }
    for e in &effects {
        tx.execute(
            "INSERT INTO _snapback_promotion_pending
               (branch_id, child_version, kind, effect_class, target, simulated_outcome, promoted_at_version)
             VALUES (?1, ?2, 'effect', ?3, ?4, ?5, ?6)",
            params![branch_id.0, e.child_version as i64, e.class.as_str(), e.target, e.simulated_outcome, new_version as i64],
        )?;
    }
    // One canonical version bump for the whole promotion.
    tx.execute(
        "UPDATE _snapback_version SET version = ?1 WHERE id = 1",
        params![new_version as i64],
    )?;
    tx.commit()?;

    // Branch-tagged receipts, one per op, in causal order.
    let mut receipts = Vec::new();
    for op in &ops {
        match op {
            BranchOp::Write(v, w) => {
                let dependent = first_effect_version.map(|fe| *v >= fe).unwrap_or(false);
                receipts.push(BranchReceipt {
                    branch_id: branch_id.0.clone(),
                    child_version: *v,
                    kind: BranchReceiptKind::Mutation {
                        table_name: w.table_name.clone(),
                        row_id: w.row_id.clone(),
                    },
                    outcome: if dependent {
                        BranchReceiptOutcome::Provisional
                    } else {
                        BranchReceiptOutcome::Confirmed
                    },
                });
            }
            BranchOp::Effect(e) => receipts.push(BranchReceipt {
                branch_id: branch_id.0.clone(),
                child_version: e.child_version,
                kind: BranchReceiptKind::Effect { class: e.class },
                outcome: BranchReceiptOutcome::Provisional,
            }),
        }
    }

    Ok(PromotionResult {
        canonical_version: new_version,
        committed,
        provisional,
        effect_intents: effects,
        receipts,
    })
}

/// Reconcile a settled effect against the pending ledger (P3 fenced
/// reconciliation). Resolves the effect's pending row to the settlement status;
/// idempotent-safe (returns how many pending rows it resolved). Never rolls back
/// an already-initiated promotion — it only advances pending → resolved.
pub fn reconcile_effect(
    conn: &Connection,
    branch_id: &BranchId,
    effect_version: u64,
    settlement: EffectSettlement,
) -> SnapbackResult<usize> {
    ensure_promotion_pending(conn)?;
    let updated = conn.execute(
        "UPDATE _snapback_promotion_pending
            SET status = ?3
          WHERE branch_id = ?1 AND child_version = ?2 AND kind = 'effect' AND status = 'pending'",
        params![branch_id.0, effect_version as i64, settlement.as_str()],
    )?;
    Ok(updated)
}

/// The unresolved pending rows for a branch (for reconciliation/observability).
pub fn pending_promotions(
    conn: &Connection,
    branch_id: &BranchId,
) -> SnapbackResult<Vec<(u64, String, String)>> {
    ensure_promotion_pending(conn)?;
    let mut stmt = conn.prepare(
        "SELECT child_version, kind, status
           FROM _snapback_promotion_pending
          WHERE branch_id = ?1
          ORDER BY child_version ASC",
    )?;
    let rows = stmt.query_map(params![branch_id.0], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (v, kind, status) = row?;
        out.push((v.max(0) as u64, kind, status));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        Connection::open_in_memory().expect("in-memory sqlite")
    }

    fn ids(n: &str) -> (BranchId, ChildStreamId) {
        (
            BranchId(format!("branch-{n}")),
            ChildStreamId(format!("cs-{n}")),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn create_branch(
        conn: &Connection,
        branch_id: &BranchId,
        child_stream_id: &ChildStreamId,
        base_stream: &str,
        base_version: u64,
        created_at_ms: i64,
        ttl_ms: Option<i64>,
    ) -> SnapbackResult<BranchRecord> {
        let tx = conn.unchecked_transaction()?;
        let record = super::create_branch(
            &tx,
            branch_id,
            child_stream_id,
            base_stream,
            base_version,
            created_at_ms,
            ttl_ms,
        )?;
        tx.commit()?;
        Ok(record)
    }

    #[test]
    fn branch_registration_is_one_caller_owned_transaction() {
        let c = conn();
        ensure_branch_registry(&c).expect("registry");
        let (bid, cs) = ids("atomic");
        {
            let tx = c.unchecked_transaction().expect("transaction");
            super::create_branch(&tx, &bid, &cs, "canonical", 1, 1, None)
                .expect("create in transaction");
            // Dropping the caller-owned transaction rolls back both dependent
            // inserts. There is no API shape that can commit only the registry
            // row and strand the child version stream.
        }
        let branches: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM _snapback_branches WHERE branch_id = ?1",
                params![bid.0],
                |row| row.get(0),
            )
            .expect("branch count");
        let versions: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM _snapback_branch_versions WHERE branch_id = ?1",
                params![bid.0],
                |row| row.get(0),
            )
            .expect("version count");
        assert_eq!((branches, versions), (0, 0));
    }

    #[test]
    fn create_then_get_round_trips() {
        let c = conn();
        let (bid, cs) = ids("a");
        let created =
            create_branch(&c, &bid, &cs, "canonical", 42, 1_000, Some(60_000)).expect("create");
        assert_eq!(created.base_version, 42);
        assert_eq!(created.state, BranchState::Active);

        let fetched = get_branch(&c, &bid).expect("get").expect("present");
        assert_eq!(fetched, created);
        assert_eq!(fetched.child_stream_id, cs);
        assert_eq!(fetched.base_stream, "canonical");
        assert_eq!(fetched.ttl_ms, Some(60_000));
    }

    #[test]
    fn get_missing_is_none() {
        let c = conn();
        assert!(
            get_branch(&c, &BranchId("nope".into()))
                .expect("get")
                .is_none()
        );
    }

    #[test]
    fn duplicate_branch_id_fails_closed() {
        let c = conn();
        let (bid, cs) = ids("dup");
        create_branch(&c, &bid, &cs, "canonical", 1, 1, None).expect("first");
        let again = create_branch(
            &c,
            &bid,
            &ChildStreamId("cs-other".into()),
            "canonical",
            1,
            2,
            None,
        );
        assert!(again.is_err(), "reusing a branch id must fail closed");
    }

    #[test]
    fn duplicate_child_stream_fails_closed() {
        let c = conn();
        let (bid, cs) = ids("x");
        create_branch(&c, &bid, &cs, "canonical", 1, 1, None).expect("first");
        let again = create_branch(
            &c,
            &BranchId("branch-y".into()),
            &cs,
            "canonical",
            1,
            2,
            None,
        );
        assert!(again.is_err(), "reusing a child stream id must fail closed");
    }

    #[test]
    fn list_is_newest_first() {
        let c = conn();
        let (b1, s1) = ids("1");
        let (b2, s2) = ids("2");
        create_branch(&c, &b1, &s1, "canonical", 1, 100, None).expect("b1");
        create_branch(&c, &b2, &s2, "canonical", 2, 200, None).expect("b2");
        let listed = list_branches(&c).expect("list");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].branch_id, b2, "newest (created_at_ms 200) first");
        assert_eq!(listed[1].branch_id, b1);
    }

    #[test]
    fn mark_teardown_transitions_state() {
        let c = conn();
        let (bid, cs) = ids("t");
        create_branch(&c, &bid, &cs, "canonical", 1, 1, None).expect("create");
        assert!(mark_teardown(&c, &bid).expect("teardown"));
        let after = get_branch(&c, &bid).expect("get").expect("present");
        assert_eq!(after.state, BranchState::TearingDown);
        // Idempotent-ish: marking a missing branch reports false.
        assert!(!mark_teardown(&c, &BranchId("ghost".into())).expect("teardown missing"));
    }

    #[test]
    fn child_stream_starts_at_zero_and_allocates_gap_free() {
        let c = conn();
        let (bid, cs) = ids("cs");
        create_branch(&c, &bid, &cs, "canonical", 7, 1, None).expect("create");
        assert_eq!(child_current_version(&c, &bid).expect("cur"), Some(0));
        assert_eq!(allocate_child_version(&c, &bid).expect("a1"), 1);
        assert_eq!(allocate_child_version(&c, &bid).expect("a2"), 2);
        assert_eq!(allocate_child_version(&c, &bid).expect("a3"), 3);
        assert_eq!(child_current_version(&c, &bid).expect("cur"), Some(3));
    }

    #[test]
    fn child_streams_are_independent_per_branch() {
        let c = conn();
        let (b1, s1) = ids("i1");
        let (b2, s2) = ids("i2");
        create_branch(&c, &b1, &s1, "canonical", 1, 1, None).expect("b1");
        create_branch(&c, &b2, &s2, "canonical", 1, 2, None).expect("b2");
        allocate_child_version(&c, &b1).expect("b1 a1");
        allocate_child_version(&c, &b1).expect("b1 a2");
        allocate_child_version(&c, &b2).expect("b2 a1");
        assert_eq!(child_current_version(&c, &b1).expect("b1"), Some(2));
        assert_eq!(child_current_version(&c, &b2).expect("b2"), Some(1));
    }

    #[test]
    fn concurrent_child_allocations_are_unique_and_gap_free() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("branches.sqlite3");
        let setup = Connection::open(&path).expect("setup connection");
        let (bid, cs) = ids("concurrent");
        create_branch(&setup, &bid, &cs, "canonical", 1, 1, None).expect("branch");
        drop(setup);

        let workers = 8;
        let allocations_per_worker = 16;
        let mut handles = Vec::new();
        for _ in 0..workers {
            let path = path.clone();
            let bid = bid.clone();
            handles.push(std::thread::spawn(move || {
                let connection = Connection::open(path).expect("worker connection");
                connection
                    .busy_timeout(std::time::Duration::from_secs(5))
                    .expect("busy timeout");
                (0..allocations_per_worker)
                    .map(|_| allocate_child_version(&connection, &bid).expect("allocate"))
                    .collect::<Vec<_>>()
            }));
        }
        let mut allocated = handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("worker"))
            .collect::<Vec<_>>();
        allocated.sort_unstable();
        let expected = (1..=(workers * allocations_per_worker) as u64).collect::<Vec<_>>();
        assert_eq!(allocated, expected);
    }

    #[test]
    fn child_allocation_refuses_past_the_portable_version_max() {
        let c = conn();
        let (bid, cs) = ids("max");
        create_branch(&c, &bid, &cs, "canonical", 1, 1, None).expect("branch");
        c.execute(
            "UPDATE _snapback_branch_versions SET current_version = ?2 WHERE branch_id = ?1",
            params![bid.0, crate::manifest::PORTABLE_STORAGE_VERSION_MAX as i64],
        )
        .expect("set max");
        assert_eq!(
            allocate_child_version(&c, &bid)
                .expect_err("portable maximum must refuse")
                .diagnostic
                .code,
            "SNAPBACK_STORAGE_VERSION_EXHAUSTED"
        );
    }

    #[test]
    fn allocate_on_missing_branch_fails_closed() {
        let c = conn();
        ensure_branch_registry(&c).expect("ensure");
        assert!(allocate_child_version(&c, &BranchId("ghost".into())).is_err());
        assert_eq!(
            child_current_version(&c, &BranchId("ghost".into())).expect("cur"),
            None
        );
    }

    #[test]
    fn replay_floor_is_monotonic_and_bounded() {
        let c = conn();
        let (bid, cs) = ids("rf");
        create_branch(&c, &bid, &cs, "canonical", 1, 1, None).expect("create");
        assert_eq!(child_replay_floor(&c, &bid).expect("floor"), Some(0));
        for _ in 0..5 {
            allocate_child_version(&c, &bid).expect("alloc");
        }
        set_child_replay_floor(&c, &bid, 3).expect("set 3");
        assert_eq!(child_replay_floor(&c, &bid).expect("floor"), Some(3));
        // Cannot move backward.
        assert!(set_child_replay_floor(&c, &bid, 2).is_err());
        // Cannot exceed current (5).
        assert!(set_child_replay_floor(&c, &bid, 6).is_err());
        set_child_replay_floor(&c, &bid, 5).expect("set 5 == current ok");
        assert_eq!(child_replay_floor(&c, &bid).expect("floor"), Some(5));
    }

    /// Build a minimal source database with a populated `_snapback_version` row
    /// and a user table, standing in for a real snapback store so the P0.3
    /// snapshot/version-readback mechanics can be exercised in isolation.
    fn source_with_head(version: u64) -> Connection {
        let c = Connection::open_in_memory().expect("source");
        c.execute_batch(
            "CREATE TABLE _snapback_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
             CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
        )
        .expect("source schema");
        c.execute(
            "INSERT INTO _snapback_version (id, version) VALUES (1, ?1)",
            params![version as i64],
        )
        .expect("seed version");
        c.execute(
            "INSERT INTO widgets (id, name) VALUES (1, 'alpha'), (2, 'beta')",
            [],
        )
        .expect("seed rows");
        c
    }

    #[test]
    fn materialize_copies_pages_and_reads_head_from_snapshot() {
        let source = source_with_head(42);
        let base = MaterializedBase::materialize(&source, None).expect("materialize");
        assert_eq!(base.base_version, 42);
        // The snapshot is a full, independent copy of the source pages.
        let names: Vec<String> = base
            .conn
            .prepare("SELECT name FROM widgets ORDER BY id")
            .expect("prep")
            .query_map([], |r| r.get::<_, String>(0))
            .expect("query")
            .map(|r| r.expect("row"))
            .collect();
        assert_eq!(names, vec!["alpha".to_string(), "beta".to_string()]);
    }

    #[test]
    fn materialized_base_is_isolated_from_source() {
        let source = source_with_head(7);
        let base = MaterializedBase::materialize(&source, None).expect("materialize");
        // Diverge the source AFTER the snapshot.
        source
            .execute("INSERT INTO widgets (id, name) VALUES (3, 'gamma')", [])
            .expect("source write");
        // Diverge the base independently.
        base.conn
            .execute("INSERT INTO widgets (id, name) VALUES (99, 'delta')", [])
            .expect("base write");
        let source_count: i64 = source
            .query_row("SELECT COUNT(*) FROM widgets", [], |r| r.get(0))
            .expect("source count");
        let base_count: i64 = base
            .conn
            .query_row("SELECT COUNT(*) FROM widgets", [], |r| r.get(0))
            .expect("base count");
        assert_eq!(source_count, 3, "source has its own write, not the base's");
        assert_eq!(
            base_count, 3,
            "base has the 2 snapshot rows + its own write"
        );
        // The base never saw the source's post-snapshot 'gamma'.
        let has_gamma: i64 = base
            .conn
            .query_row(
                "SELECT COUNT(*) FROM widgets WHERE name = 'gamma'",
                [],
                |r| r.get(0),
            )
            .expect("gamma");
        assert_eq!(has_gamma, 0);
    }

    #[test]
    fn on_disk_base_materializes_and_tears_down() {
        let source = source_with_head(3);
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "snapback-branch-base-{}-{:?}.db",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_file(&path);
        let base = MaterializedBase::materialize(&source, Some(&path)).expect("materialize");
        assert_eq!(base.base_version, 3);
        assert!(path.exists(), "on-disk base file was created");
        base.teardown().expect("teardown");
        assert!(!path.exists(), "teardown deleted the base file");
    }

    fn widget_names(c: &Connection) -> Vec<String> {
        c.prepare("SELECT name FROM widgets ORDER BY id")
            .expect("prep")
            .query_map([], |r| r.get::<_, String>(0))
            .expect("query")
            .map(|r| r.expect("row"))
            .collect()
    }

    #[test]
    fn p0_4_overlay_isolation_and_ledger() {
        // Canonical source with data + two registered branches.
        let source = source_with_head(5);
        let (a, csa) = ids("A");
        let (b, csb) = ids("B");
        create_branch(&source, &a, &csa, "canonical", 5, 1, None).expect("register A");
        create_branch(&source, &b, &csb, "canonical", 5, 1, None).expect("register B");

        // Two independent materialized branch databases off the same head.
        let mut base_a = MaterializedBase::materialize(&source, None).expect("base A");
        let mut base_b = MaterializedBase::materialize(&source, None).expect("base B");
        assert_eq!(base_a.base_version, 5);
        assert_eq!(base_b.base_version, 5);

        // Branch A mutates widget 1 in place; records the divergence.
        base_a
            .conn
            .execute("UPDATE widgets SET name='ALPHA' WHERE id=1", [])
            .expect("A physical write");
        let va = record_overlay_write(
            &mut base_a.conn,
            &a,
            &OverlayWrite {
                table_name: "widgets".into(),
                row_id: "1".into(),
                op: OverlayOp::Upsert,
                payload: Some("ALPHA".into()),
            },
            100,
        )
        .expect("A overlay");
        assert_eq!(va, 1, "first overlay write is child version 1");

        // Branch B inserts a new widget; records the divergence.
        base_b
            .conn
            .execute("INSERT INTO widgets (id, name) VALUES (3, 'gamma')", [])
            .expect("B physical write");
        let vb = record_overlay_write(
            &mut base_b.conn,
            &b,
            &OverlayWrite {
                table_name: "widgets".into(),
                row_id: "3".into(),
                op: OverlayOp::Upsert,
                payload: Some("gamma".into()),
            },
            100,
        )
        .expect("B overlay");
        assert_eq!(vb, 1, "branch B's stream is independent — also starts at 1");

        // Canonical is untouched by either branch.
        assert_eq!(widget_names(&source), vec!["alpha", "beta"]);
        // Branch A reads-its-own-writes; never sees B's insert.
        assert_eq!(widget_names(&base_a.conn), vec!["ALPHA", "beta"]);
        // Branch B sees its insert; never sees A's rename.
        assert_eq!(widget_names(&base_b.conn), vec!["alpha", "beta", "gamma"]);

        // Overlay ledgers enumerate exactly each branch's divergence, in order.
        assert_eq!(
            overlay_writes(&base_a.conn).expect("A ledger"),
            vec![(
                1,
                OverlayWrite {
                    table_name: "widgets".into(),
                    row_id: "1".into(),
                    op: OverlayOp::Upsert,
                    payload: Some("ALPHA".into()),
                }
            )]
        );
        assert_eq!(
            overlay_writes(&base_b.conn).expect("B ledger"),
            vec![(
                1,
                OverlayWrite {
                    table_name: "widgets".into(),
                    row_id: "3".into(),
                    op: OverlayOp::Upsert,
                    payload: Some("gamma".into()),
                }
            )]
        );
    }

    #[test]
    fn overlay_write_advances_child_stream_and_orders_ledger() {
        let source = source_with_head(2);
        let (bid, cs) = ids("ov");
        create_branch(&source, &bid, &cs, "canonical", 2, 1, None).expect("register");
        let mut base = MaterializedBase::materialize(&source, None).expect("base");

        for (i, name) in ["one", "two", "three"].iter().enumerate() {
            let v = record_overlay_write(
                &mut base.conn,
                &bid,
                &OverlayWrite {
                    table_name: "widgets".into(),
                    row_id: (i + 1).to_string(),
                    op: OverlayOp::Upsert,
                    payload: Some((*name).into()),
                },
                (i as i64) + 1,
            )
            .expect("overlay");
            assert_eq!(v as usize, i + 1, "child stream is gap-free");
        }
        let ledger = overlay_writes(&base.conn).expect("ledger");
        assert_eq!(ledger.len(), 3);
        assert_eq!(
            ledger.iter().map(|(v, _)| *v).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(
            child_current_version(&base.conn, &bid).expect("cur"),
            Some(3)
        );
    }

    #[test]
    fn execution_mode_routes_egress() {
        assert_eq!(
            BranchExecutionMode::Canonical.egress_disposition(),
            EgressDisposition::Fire
        );
        assert_eq!(
            BranchExecutionMode::Branch.egress_disposition(),
            EgressDisposition::Capture
        );
    }

    #[test]
    fn effect_classification_is_closed_and_fail_closed() {
        for kind in ["fetch", "notification", "payment", "cron", "outbox", "uses"] {
            assert_eq!(EffectClass::classify(kind).expect("known").as_str(), kind);
        }
        // Anything not in the closed set is refused — never silently fired.
        assert!(EffectClass::classify("websocket").is_err());
        assert!(EffectClass::classify("").is_err());
        assert!(EffectClass::classify("FETCH").is_err());
    }

    #[test]
    fn captured_effects_share_the_child_stream_and_order() {
        let source = source_with_head(9);
        let (bid, cs) = ids("fx");
        create_branch(&source, &bid, &cs, "canonical", 9, 1, None).expect("register");
        let mut base = MaterializedBase::materialize(&source, None).expect("base");

        // A data write, then two effects — all share one total order.
        let w = record_overlay_write(
            &mut base.conn,
            &bid,
            &OverlayWrite {
                table_name: "widgets".into(),
                row_id: "1".into(),
                op: OverlayOp::Upsert,
                payload: Some("x".into()),
            },
            10,
        )
        .expect("write");
        assert_eq!(w, 1);

        let e1 = capture_effect(
            &mut base.conn,
            &bid,
            &CapturedEffectInput {
                class: EffectClass::Fetch,
                scope: EffectScope::HostMediated,
                target: "https://api.example.com/charge".into(),
                payload: Some("{\"amt\":100}".into()),
                simulated_outcome: Some("{\"ok\":true}".into()),
            },
            20,
        )
        .expect("effect 1");
        let e2 = capture_effect(
            &mut base.conn,
            &bid,
            &CapturedEffectInput {
                class: EffectClass::Notification,
                scope: EffectScope::HostMediated,
                target: "topic:orders".into(),
                payload: None,
                simulated_outcome: None,
            },
            30,
        )
        .expect("effect 2");
        assert_eq!((e1, e2), (2, 3), "effects continue the shared child stream");

        let effects = captured_effects(&base.conn).expect("effects");
        assert_eq!(effects.len(), 2);
        assert_eq!(effects[0].child_version, 2);
        assert_eq!(effects[0].class, EffectClass::Fetch);
        assert_eq!(
            effects[0].simulated_outcome.as_deref(),
            Some("{\"ok\":true}")
        );
        assert_eq!(effects[1].child_version, 3);
        assert_eq!(effects[1].class, EffectClass::Notification);
        assert_eq!(effects[1].payload, None);
        // The whole branch log is one gap-free ordered stream.
        assert_eq!(
            child_current_version(&base.conn, &bid).expect("cur"),
            Some(3)
        );
    }

    #[test]
    fn end_to_end_scope_is_refused_in_v1() {
        let source = source_with_head(1);
        let (bid, cs) = ids("e2e");
        create_branch(&source, &bid, &cs, "canonical", 1, 1, None).expect("register");
        let mut base = MaterializedBase::materialize(&source, None).expect("base");
        let err = capture_effect(
            &mut base.conn,
            &bid,
            &CapturedEffectInput {
                class: EffectClass::Fetch,
                scope: EffectScope::EndToEnd,
                target: "https://example.com".into(),
                payload: None,
                simulated_outcome: None,
            },
            5,
        );
        assert!(err.is_err(), "EndToEnd capture must fail closed in v1");
        // Nothing was recorded and no version was consumed.
        assert!(captured_effects(&base.conn).expect("effects").is_empty());
        assert_eq!(
            child_current_version(&base.conn, &bid).expect("cur"),
            Some(0)
        );
    }

    // ---- P2 + P3: promotion ------------------------------------------------

    /// Reference physical applier over the demo `widgets(id, name)` table.
    #[cfg(any())]
    fn apply_widget(tx: &rusqlite::Transaction, w: &OverlayWrite) -> SnapbackResult<()> {
        let id: i64 = w.row_id.parse().expect("widget id");
        match w.op {
            OverlayOp::Upsert => {
                tx.execute(
                    "INSERT INTO widgets (id, name) VALUES (?1, ?2)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name",
                    params![id, w.payload.clone().unwrap_or_default()],
                )?;
            }
            OverlayOp::Delete => {
                tx.execute("DELETE FROM widgets WHERE id = ?1", params![id])?;
            }
        }
        Ok(())
    }

    #[cfg(any())]
    fn canonical_version(c: &Connection) -> u64 {
        c.query_row(
            "SELECT version FROM _snapback_version WHERE id = 1",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|v| v.max(0) as u64)
        .expect("version")
    }

    fn upsert(row_id: &str, name: &str) -> OverlayWrite {
        OverlayWrite {
            table_name: "widgets".into(),
            row_id: row_id.into(),
            op: OverlayOp::Upsert,
            payload: Some(name.into()),
        }
    }

    #[cfg(any())]
    #[test]
    fn promote_applies_writes_and_bumps_version_once() {
        let mut canonical = source_with_head(5);
        let (bid, cs) = ids("promo");
        create_branch(&canonical, &bid, &cs, "canonical", 5, 1, None).expect("register");
        let mut base = MaterializedBase::materialize(&canonical, None).expect("base");

        base.conn
            .execute("UPDATE widgets SET name='ALPHA' WHERE id=1", [])
            .expect("phys");
        record_overlay_write(&mut base.conn, &bid, &upsert("1", "ALPHA"), 1).expect("w1");
        record_overlay_write(&mut base.conn, &bid, &upsert("3", "gamma"), 2).expect("w2");

        let result = promote(
            &mut canonical,
            &base.conn,
            &bid,
            5,
            AuthorityDecision::Revalidated,
            apply_widget,
        )
        .expect("promote");

        // Exactly one canonical version bump.
        assert_eq!(result.canonical_version, 6);
        assert_eq!(canonical_version(&canonical), 6);
        // No effects → everything committed unconditionally.
        assert_eq!(result.committed.len(), 2);
        assert!(result.provisional.is_empty());
        assert!(result.effect_intents.is_empty());
        assert!(
            result
                .receipts
                .iter()
                .all(|r| r.outcome == BranchReceiptOutcome::Confirmed)
        );
        // Canonical now reflects the promoted writes.
        assert_eq!(widget_names(&canonical), vec!["ALPHA", "beta", "gamma"]);
        assert!(
            pending_promotions(&canonical, &bid)
                .expect("pending")
                .is_empty()
        );
    }

    #[cfg(any())]
    #[test]
    fn promote_marks_effect_dependent_writes_provisional() {
        let mut canonical = source_with_head(2);
        let (bid, cs) = ids("prov");
        create_branch(&canonical, &bid, &cs, "canonical", 2, 1, None).expect("register");
        let mut base = MaterializedBase::materialize(&canonical, None).expect("base");

        // w1 before any effect → unconditional; effect; w2 after → effect-dependent.
        record_overlay_write(&mut base.conn, &bid, &upsert("1", "pre"), 1).expect("w1");
        capture_effect(
            &mut base.conn,
            &bid,
            &CapturedEffectInput {
                class: EffectClass::Payment,
                scope: EffectScope::HostMediated,
                target: "charge:acct".into(),
                payload: None,
                simulated_outcome: Some("ok".into()),
            },
            2,
        )
        .expect("effect");
        record_overlay_write(&mut base.conn, &bid, &upsert("2", "post"), 3).expect("w2");

        let result = promote(
            &mut canonical,
            &base.conn,
            &bid,
            2,
            AuthorityDecision::Revalidated,
            apply_widget,
        )
        .expect("promote");

        assert_eq!(result.canonical_version, 3);
        assert_eq!(
            result.committed.iter().map(|(v, _)| *v).collect::<Vec<_>>(),
            vec![1]
        );
        assert_eq!(
            result
                .provisional
                .iter()
                .map(|(v, _)| *v)
                .collect::<Vec<_>>(),
            vec![3]
        );
        assert_eq!(result.effect_intents.len(), 1);

        // Receipts: w1 Confirmed, effect Provisional, w2 Provisional.
        let by_v: std::collections::BTreeMap<u64, BranchReceiptOutcome> = result
            .receipts
            .iter()
            .map(|r| (r.child_version, r.outcome))
            .collect();
        assert_eq!(by_v[&1], BranchReceiptOutcome::Confirmed);
        assert_eq!(by_v[&2], BranchReceiptOutcome::Provisional);
        assert_eq!(by_v[&3], BranchReceiptOutcome::Provisional);

        // Pending ledger holds the provisional write + the effect intent.
        let pending = pending_promotions(&canonical, &bid).expect("pending");
        assert_eq!(pending.len(), 2);
        assert!(pending.iter().all(|(_, _, status)| status == "pending"));

        // Reconcile the effect → resolves its pending row; never rolls back.
        let n =
            reconcile_effect(&canonical, &bid, 2, EffectSettlement::Succeeded).expect("reconcile");
        assert_eq!(n, 1);
        let after = pending_promotions(&canonical, &bid).expect("pending after");
        let effect_status = after
            .iter()
            .find(|(v, kind, _)| *v == 2 && kind == "effect")
            .expect("effect row");
        assert_eq!(effect_status.2, "succeeded");
        // Idempotent: reconciling again resolves nothing.
        assert_eq!(
            reconcile_effect(&canonical, &bid, 2, EffectSettlement::Succeeded).expect("again"),
            0
        );
    }

    #[cfg(any())]
    #[test]
    fn promote_refuses_when_canonical_advanced() {
        let mut canonical = source_with_head(5);
        let (bid, cs) = ids("adv");
        create_branch(&canonical, &bid, &cs, "canonical", 5, 1, None).expect("register");
        let base = MaterializedBase::materialize(&canonical, None).expect("base");
        // Canonical advances past the fork point after the branch was cut.
        canonical
            .execute("UPDATE _snapback_version SET version=6 WHERE id=1", [])
            .expect("advance");
        let err = promote(
            &mut canonical,
            &base.conn,
            &bid,
            5,
            AuthorityDecision::Revalidated,
            apply_widget,
        );
        assert!(
            err.is_err(),
            "v1 must refuse promotion when canonical advanced"
        );
        assert_eq!(canonical_version(&canonical), 6, "canonical untouched");
    }

    #[cfg(any())]
    #[test]
    fn promote_refuses_authority_not_revalidated() {
        let mut canonical = source_with_head(1);
        let (bid, cs) = ids("auth");
        create_branch(&canonical, &bid, &cs, "canonical", 1, 1, None).expect("register");
        let mut base = MaterializedBase::materialize(&canonical, None).expect("base");
        record_overlay_write(&mut base.conn, &bid, &upsert("1", "x"), 1).expect("w1");
        let err = promote(
            &mut canonical,
            &base.conn,
            &bid,
            1,
            AuthorityDecision::Denied,
            apply_widget,
        );
        assert!(err.is_err(), "denied/preserved authority must fail closed");
        assert_eq!(
            canonical_version(&canonical),
            1,
            "no version bump on refusal"
        );
    }

    #[test]
    fn branch_op_log_merges_writes_and_effects_in_causal_order() {
        let source = source_with_head(1);
        let (bid, cs) = ids("log");
        create_branch(&source, &bid, &cs, "canonical", 1, 1, None).expect("register");
        let mut base = MaterializedBase::materialize(&source, None).expect("base");
        record_overlay_write(&mut base.conn, &bid, &upsert("1", "a"), 1).expect("w1");
        capture_effect(
            &mut base.conn,
            &bid,
            &CapturedEffectInput {
                class: EffectClass::Fetch,
                scope: EffectScope::HostMediated,
                target: "u".into(),
                payload: None,
                simulated_outcome: None,
            },
            2,
        )
        .expect("effect");
        record_overlay_write(&mut base.conn, &bid, &upsert("2", "b"), 3).expect("w2");

        let log = branch_op_log(&base.conn).expect("log");
        let versions: Vec<u64> = log.iter().map(|op| op.child_version()).collect();
        assert_eq!(versions, vec![1, 2, 3]);
        assert!(matches!(log[0], BranchOp::Write(1, _)));
        assert!(matches!(log[1], BranchOp::Effect(_)));
        assert!(matches!(log[2], BranchOp::Write(3, _)));
    }

    #[cfg(any())]
    #[test]
    fn transitive_effect_dependence_taints_all_later_writes() {
        // w1 (pre-effect) | effect | w2 | w3 (both post-effect) — transitive
        // over-approximation makes w2 AND w3 provisional, w1 unconditional.
        let mut canonical = source_with_head(4);
        let (bid, cs) = ids("trans");
        create_branch(&canonical, &bid, &cs, "canonical", 4, 1, None).expect("register");
        let mut base = MaterializedBase::materialize(&canonical, None).expect("base");
        record_overlay_write(&mut base.conn, &bid, &upsert("1", "a"), 1).expect("w1");
        capture_effect(
            &mut base.conn,
            &bid,
            &CapturedEffectInput {
                class: EffectClass::Outbox,
                scope: EffectScope::HostMediated,
                target: "q".into(),
                payload: None,
                simulated_outcome: Some("id-7".into()),
            },
            2,
        )
        .expect("effect");
        record_overlay_write(&mut base.conn, &bid, &upsert("2", "b"), 3).expect("w2");
        record_overlay_write(&mut base.conn, &bid, &upsert("3", "c"), 4).expect("w3");

        let result = promote(
            &mut canonical,
            &base.conn,
            &bid,
            4,
            AuthorityDecision::Revalidated,
            apply_widget,
        )
        .expect("promote");
        assert_eq!(
            result.committed.iter().map(|(v, _)| *v).collect::<Vec<_>>(),
            vec![1]
        );
        assert_eq!(
            result
                .provisional
                .iter()
                .map(|(v, _)| *v)
                .collect::<Vec<_>>(),
            vec![3, 4],
            "every write after the first effect is transitively provisional"
        );
    }

    #[cfg(any())]
    #[test]
    fn staged_settlement_is_never_rolled_back_after_initiation() {
        // Once promoted, a provisional write stays in canonical even if its
        // effect later settles Rejected — reconciliation resolves status only,
        // it does not undo the committed canonical row.
        let mut canonical = source_with_head(1);
        let (bid, cs) = ids("noroll");
        create_branch(&canonical, &bid, &cs, "canonical", 1, 1, None).expect("register");
        let mut base = MaterializedBase::materialize(&canonical, None).expect("base");
        capture_effect(
            &mut base.conn,
            &bid,
            &CapturedEffectInput {
                class: EffectClass::Payment,
                scope: EffectScope::HostMediated,
                target: "charge".into(),
                payload: None,
                simulated_outcome: Some("ok".into()),
            },
            1,
        )
        .expect("effect");
        record_overlay_write(&mut base.conn, &bid, &upsert("9", "provisional"), 2).expect("w");

        promote(
            &mut canonical,
            &base.conn,
            &bid,
            1,
            AuthorityDecision::Revalidated,
            apply_widget,
        )
        .expect("promote");
        // The provisional write is present in canonical post-promotion.
        assert_eq!(
            canonical
                .query_row("SELECT name FROM widgets WHERE id=9", [], |r| r
                    .get::<_, String>(0))
                .expect("row"),
            "provisional"
        );
        // Effect settles Rejected — status flips, canonical row is NOT undone.
        reconcile_effect(&canonical, &bid, 1, EffectSettlement::Rejected).expect("reconcile");
        assert!(
            canonical
                .query_row("SELECT name FROM widgets WHERE id=9", [], |r| r
                    .get::<_, String>(0))
                .is_ok(),
            "canonical write survives a rejected settlement (never rolled back after initiation)"
        );
        let pending = pending_promotions(&canonical, &bid).expect("pending");
        assert!(
            pending
                .iter()
                .any(|(v, kind, status)| *v == 1 && kind == "effect" && status == "rejected")
        );
    }
}
