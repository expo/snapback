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

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};

/// Stable identity of an ephemeral branch within one logical app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchId(pub String);

/// Identity of a branch's typed ephemeral **child version-stream**.
///
/// @ref LLP 0097#1-the-branch-is-an-ephemeral-child-of-a-logical-app — the
/// normative amendment to LLP 0007/0018: a logical app owns one canonical stream
/// plus zero-or-more typed ephemeral child streams. A child stream's versions are
/// never numerically comparable to the canonical stream; `base_version` is a fork
/// pointer, not a shared coordinate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChildStreamId(pub String);

/// Lifecycle state of a branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchRecord {
    pub branch_id: BranchId,
    pub child_stream_id: ChildStreamId,
    /// Canonical version the branch forked from — its compare-and-swap base for
    /// promotion.
    ///
    /// @ref LLP 0097#5-promotion-command-replay-staged-effect-settlement — v1
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
    conn: &Connection,
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
pub fn get_branch(
    conn: &Connection,
    branch_id: &BranchId,
) -> SnapbackResult<Option<BranchRecord>> {
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
    let current = child_current_version(conn, branch_id)?.ok_or_else(|| {
        invalid(format!("no child version stream for branch {:?}", branch_id.0))
    })?;
    // Reuse the canonical portable-max guard so a branch stream can never
    // advance past the durable ordering domain either.
    let next = crate::storage::next_storage_version(current)?;
    conn.execute(
        "UPDATE _snapback_branch_versions SET current_version = ?2 WHERE branch_id = ?1",
        params![branch_id.0, next as i64],
    )?;
    Ok(next)
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
        invalid(format!("no child version stream for branch {:?}", branch_id.0))
    })?;
    let existing = child_replay_floor(conn, branch_id)?.unwrap_or(0);
    if floor < existing {
        return Err(invalid("branch replay floor cannot move backward"));
    }
    if floor > current {
        return Err(invalid("branch replay floor cannot exceed the current version"));
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

/// An isolated, writable copy of the source database seeded from a consistent
/// snapshot at `base_version`. Overlay writes (P0.4) land in this database's own
/// change journal; canonical is never touched.
pub struct MaterializedBase {
    /// The branch's own database connection (base + future overlay).
    pub conn: Connection,
    /// The canonical head captured in this snapshot — the CAS anchor for
    /// promotion (P3). Read back FROM the snapshot, so it is exactly consistent
    /// with the captured pages regardless of concurrent writers on the source.
    pub base_version: u64,
    /// The on-disk location, or `None` for an in-memory base (ephemeral/tests).
    pub path: Option<PathBuf>,
}

impl MaterializedBase {
    /// Materialize a branch base by snapshotting `source` into a fresh database.
    ///
    /// `target` = `Some(path)` writes an on-disk base (teardown deletes it);
    /// `None` keeps it in memory. The recorded `base_version` is read back from
    /// the snapshot itself, making it atomically consistent with the copied
    /// pages even if the source advances mid-backup.
    pub fn materialize(source: &Connection, target: Option<&Path>) -> SnapbackResult<Self> {
        let mut conn = match target {
            Some(p) => Connection::open(p)?,
            None => Connection::open_in_memory()?,
        };
        {
            // @ref LLP 0028 — same backup primitive used by detached_read_snapshot.
            let backup = rusqlite::backup::Backup::new(source, &mut conn)?;
            backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
        }
        let base_version = crate::storage::current_version_on(&conn)?;
        Ok(Self {
            conn,
            base_version,
            path: target.map(|p| p.to_path_buf()),
        })
    }

    /// Tear down the base: drop the connection and delete the backing file (if
    /// any). Idempotent — a missing file is not an error.
    pub fn teardown(self) -> SnapbackResult<()> {
        let path = self.path.clone();
        drop(self); // close the connection before unlinking
        if let Some(p) = path {
            match std::fs::remove_file(&p) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(invalid(format!(
                    "failed to delete branch base {:?}: {e}",
                    p
                ))),
            }
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        Connection::open_in_memory().expect("in-memory sqlite")
    }

    fn ids(n: &str) -> (BranchId, ChildStreamId) {
        (BranchId(format!("branch-{n}")), ChildStreamId(format!("cs-{n}")))
    }

    #[test]
    fn create_then_get_round_trips() {
        let c = conn();
        let (bid, cs) = ids("a");
        let created = create_branch(&c, &bid, &cs, "canonical", 42, 1_000, Some(60_000))
            .expect("create");
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
        assert!(get_branch(&c, &BranchId("nope".into())).expect("get").is_none());
    }

    #[test]
    fn duplicate_branch_id_fails_closed() {
        let c = conn();
        let (bid, cs) = ids("dup");
        create_branch(&c, &bid, &cs, "canonical", 1, 1, None).expect("first");
        let again = create_branch(&c, &bid, &ChildStreamId("cs-other".into()), "canonical", 1, 2, None);
        assert!(again.is_err(), "reusing a branch id must fail closed");
    }

    #[test]
    fn duplicate_child_stream_fails_closed() {
        let c = conn();
        let (bid, cs) = ids("x");
        create_branch(&c, &bid, &cs, "canonical", 1, 1, None).expect("first");
        let again = create_branch(&c, &BranchId("branch-y".into()), &cs, "canonical", 1, 2, None);
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
    fn allocate_on_missing_branch_fails_closed() {
        let c = conn();
        ensure_branch_registry(&c).expect("ensure");
        assert!(allocate_child_version(&c, &BranchId("ghost".into())).is_err());
        assert_eq!(child_current_version(&c, &BranchId("ghost".into())).expect("cur"), None);
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
        c.execute("INSERT INTO widgets (id, name) VALUES (1, 'alpha'), (2, 'beta')", [])
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
        assert_eq!(base_count, 3, "base has the 2 snapshot rows + its own write");
        // The base never saw the source's post-snapshot 'gamma'.
        let has_gamma: i64 = base
            .conn
            .query_row("SELECT COUNT(*) FROM widgets WHERE name = 'gamma'", [], |r| r.get(0))
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
}
