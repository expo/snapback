use super::{
    LocalDatabase, SnapbackResult, SqlValue, Transaction, TransactionBehavior, current_version_on,
    decode_optional_storage_version, decode_required_storage_version,
    ensure_change_journal_versions_valid, get_on, next_storage_version, retention_floor_at_most,
    save_retention_floor_on, schema_table, table_change_version_from_connection,
    timestamp_to_sql_millis, validate_change_journal_head, validate_portable_timestamp_millis,
    version_to_sql_integer, with_pinned_read_snapshot, write_authority,
};
use rusqlite::params;
use serde_json::Value;

impl LocalDatabase {
    pub(super) fn current_version(&self) -> SnapbackResult<u64> {
        current_version_on(&self.conn)
    }

    /// Prune the change journal to bound its growth: delete changes that are
    /// outside **both** the version window (older than `retain_versions` behind
    /// the current version) and the time window (older than `retain_ms`). A
    /// change is kept if it is within either window, so a burst of writes and a
    /// long-idle table are both retained conservatively.
    ///
    /// A table's **newest** change is never pruned, even when cold. Read-set
    /// validation uses `MAX(version) WHERE table_name = ?` and treats
    /// captured-version-equals-current as "unchanged since the read"; if the
    /// last change of a cold table were pruned, that `MAX` would drop to 0 and
    /// spuriously conflict a mutation that only *read* the table. Retaining the
    /// per-table high-water row keeps the invariant while still bounding the
    /// journal (at most one version's worth of rows per table survives the
    /// window, and table count is bounded by the schema).
    ///
    /// @ref LLP 0008#retention-and-resume — version-and-time-bounded retention.
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3.
    pub(super) fn prune_change_journal(
        &self,
        now_ms: u64,
        retain_versions: u64,
        retain_ms: u64,
    ) -> SnapbackResult<u64> {
        // Validate the supplied clock before arithmetic. Saturation is useful
        // for an ordinary window larger than the current age, but it must not
        // turn a non-portable caller value into an apparently valid floor.
        validate_portable_timestamp_millis(now_ms)?;
        // Journal retention is a process-owned system writer. On an armed
        // fork it receives exactly the DELETE authority for
        // `_snapback_changes`; it cannot write app rows, advance the storage
        // version, or originate journal entries.
        //
        // @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06
        //   — maintenance stays inside the registered writer class instead
        //   of silently failing every sweep after coverage activation.
        let _writer = self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::JournalMaintenance)?;
        let tx = Transaction::new_unchecked(&self.conn, TransactionBehavior::Immediate)?;
        let head = current_version_on(&tx)?;
        let mut version_floor = head.saturating_sub(retain_versions);
        // @ref LLP 0073#rebuilds-and-migrations — an unexpired derived-index
        // journal-floor lease prevents pruning the suffix an approved catch-up
        // operation still needs. A snapshot at S needs every change > S, so
        // pruning may advance through S but no farther.
        let vector_lease_floor: Option<i64> = tx.query_row(
            "SELECT MIN(floor_version) FROM _snapback_vector_journal_leases
             WHERE expires_at_ms >= ?1",
            params![timestamp_to_sql_millis(now_ms)?],
            |row| row.get(0),
        )?;
        if let Some(vector_lease_floor) = vector_lease_floor {
            let vector_lease_floor = decode_required_storage_version(
                SqlValue::Integer(vector_lease_floor),
                "vector journal lease floor",
            )?;
            version_floor = version_floor.min(next_storage_version(vector_lease_floor)?);
        }
        let version_floor = version_to_sql_integer(version_floor)?;
        let time_floor = timestamp_to_sql_millis(now_ms.saturating_sub(retain_ms))?;
        // A corrupt older version can sort below both floors while a later,
        // valid row remains the prunable MAX. Validate the whole journal via
        // the partial invalid-version index before either advancing the replay
        // floor or deleting anything.
        ensure_change_journal_versions_valid(&tx, None)?;
        validate_change_journal_head(&tx, head)?;
        let existing_floor = retention_floor_at_most(&tx, head)?;
        // Predicate for a prunable row: outside both windows, and not its
        // table's high-water change (which read-set validation still needs).
        let prunable = "version < ?1 AND changed_at_ms < ?2 \
             AND version < (SELECT MAX(version) FROM _snapback_changes t2 \
                            WHERE t2.table_name = _snapback_changes.table_name)";
        // Advance the monotonic replay floor to the highest version actually
        // pruned this pass, so a resume at/above the floor is guaranteed to have
        // a contiguous journal.
        let highest_pruned: SqlValue = tx.query_row(
            &format!("SELECT MAX(version) FROM _snapback_changes WHERE {prunable}"),
            params![version_floor, time_floor],
            |row| row.get(0),
        )?;
        if let Some(highest_pruned) = decode_optional_storage_version(
            highest_pruned,
            "highest prunable change-journal version",
        )? {
            let floor = existing_floor.max(next_storage_version(highest_pruned)?);
            save_retention_floor_on(&tx, floor)?;
        }
        let deleted = tx.execute(
            &format!("DELETE FROM _snapback_changes WHERE {prunable}"),
            params![version_floor, time_floor],
        )?;
        tx.commit()?;
        Ok(deleted as u64)
    }

    /// The monotonic replay floor: one past the highest change version pruning
    /// has removed (0 if nothing has ever been pruned). A version-based resume
    /// below this may hit a pruned gap and must resnapshot; from at/above it the
    /// journal is contiguous. Distinct from a table's validation high-water,
    /// which pruning preserves.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3.
    pub(super) fn journal_floor_version(&self) -> SnapbackResult<u64> {
        with_pinned_read_snapshot(&self.conn, |conn| {
            retention_floor_at_most(conn, current_version_on(conn)?)
        })
    }

    /// Configure the legacy v1 finite table-wide `maxRows` history policy.
    /// New schema-declared history uses the distinct v2 per-record projection;
    /// capability publication remains gated by LLP 0162's corpus.
    pub(super) fn configure_history_policy(
        &self,
        policy: &crate::proof_checkpoint::HistoryRetentionPolicyV1,
    ) -> SnapbackResult<()> {
        crate::proof_checkpoint::configure_history_policy(&self.conn, &self.schema, policy)
    }

    /// Prune only the history clock. This deliberately does not read or write
    /// the sync replay floor.
    pub(super) fn prune_record_history(&self, now_ms: u64) -> SnapbackResult<u64> {
        crate::proof_checkpoint::prune_record_history(&self.conn, now_ms)
    }

    /// Read retained versions under current-record plus per-post-image
    /// authorization. Pagination occurs after elision so its cursor exposes
    /// only the count of versions this caller could see.
    pub(super) fn record_history(
        &self,
        table: &str,
        row_id: &str,
        visible_offset: u64,
        limit: u32,
        authorize_current: impl FnOnce(Option<&Value>) -> bool,
        authorize_historical: impl FnMut(Option<&Value>) -> bool,
    ) -> SnapbackResult<crate::proof_checkpoint::RecordHistoryPageV1> {
        with_pinned_read_snapshot(&self.conn, |conn| {
            let current = get_on(conn, &self.schema, table, row_id)?;
            crate::proof_checkpoint::read_record_history(
                conn,
                table,
                row_id,
                visible_offset,
                limit,
                current.as_ref(),
                authorize_current,
                authorize_historical,
            )
        })
    }

    pub(super) fn change_journal_len(&self) -> SnapbackResult<u64> {
        let count: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                    row.get(0)
                })?;
        Ok(count as u64)
    }

    /// Whether a client must resnapshot rather than replay. `from_version` is
    /// the earliest change version the client still needs (it has applied every
    /// version before it, and wants `[from_version, current]`). If that is below
    /// the monotonic replay floor, a needed change may have been pruned, so the
    /// client must resnapshot; at/above the floor the journal is contiguous and
    /// can be replayed. A floor of 0 (nothing ever pruned) never forces a
    /// resnapshot.
    ///
    /// This is the retention contract for the version-based replay path; the
    /// consumer is future sync work ([LLP 0032](./0032-decision-and-implementation-hardening.plan.md)
    /// P4 / DK-3), and this primitive keeps the floor authoritative meanwhile.
    ///
    /// @ref LLP 0008#retention-and-resume — resume below the retained floor requires resnapshot.
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3.
    pub(super) fn resume_requires_resnapshot(&self, from_version: u64) -> SnapbackResult<bool> {
        Ok(from_version < self.journal_floor_version()?)
    }

    /// Distinct row ids journaled for `table` strictly after `version` — the
    /// rung-2 replay's journal-affected id set (LLP 0090 D1.3): only these
    /// ids are touched in the accumulator update; untouched witness leaves
    /// remain. Returns at most `limit + 1` ids, so a caller comparing against
    /// its replay-vs-replace threshold detects "over threshold" without
    /// unbounded work. The caller must already have checked
    /// `resume_requires_resnapshot` — below the retained floor, absence from
    /// the journal proves nothing.
    pub(super) fn changed_row_ids_for_table_since(
        &self,
        table: &str,
        version: u64,
        limit: usize,
    ) -> SnapbackResult<Vec<String>> {
        let table = schema_table(&self.schema, table)?;
        let mut statement = self.conn.prepare_cached(
            "SELECT DISTINCT row_id FROM _snapback_changes \
             WHERE table_name = ?1 AND version > ?2 LIMIT ?3",
        )?;
        let version = version_to_sql_integer(version)?;
        let fetch = i64::try_from(limit.saturating_add(1)).unwrap_or(i64::MAX);
        let rows = statement.query_map(params![table.name, version, fetch], |row| {
            row.get::<_, String>(0)
        })?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        Ok(ids)
    }

    /// The `EXPLAIN QUERY PLAN` detail for the per-mutation read-set validation
    /// query, so a test can assert it uses the `(table_name, version)` index
    /// rather than scanning.
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3 index gate.
    pub(super) fn explain_table_change_version_plan(&self, table: &str) -> SnapbackResult<String> {
        let table = schema_table(&self.schema, table)?;
        let mut statement = self.conn.prepare(
            "EXPLAIN QUERY PLAN SELECT MAX(version) FROM _snapback_changes WHERE table_name = ?1",
        )?;
        let rows = statement.query_map(params![table.name], |row| row.get::<_, String>(3))?;
        let mut detail = String::new();
        for row in rows {
            detail.push_str(&row?);
            detail.push('\n');
        }
        Ok(detail)
    }

    pub(super) fn table_change_version(&self, table: &str) -> SnapbackResult<u64> {
        let table = schema_table(&self.schema, table)?;
        table_change_version_from_connection(&self.conn, &table.name)
    }
}

/// Narrow typed access to version counters, the change journal, and record history.
///
/// @ref LLP 0225#1-ownership-map — storage callers enter the kernel
/// through typed operations instead of the wide `LocalDatabase` surface.
pub struct VersionsKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> VersionsKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn current_version(&self) -> SnapbackResult<u64> {
        self.db.current_version()
    }

    pub fn table_change_version(&self, table: &str) -> SnapbackResult<u64> {
        self.db.table_change_version(table)
    }

    pub fn prune_change_journal(
        &self,
        now_ms: u64,
        retain_versions: u64,
        retain_ms: u64,
    ) -> SnapbackResult<u64> {
        self.db
            .prune_change_journal(now_ms, retain_versions, retain_ms)
    }

    pub fn journal_floor_version(&self) -> SnapbackResult<u64> {
        self.db.journal_floor_version()
    }

    pub fn configure_history_policy(
        &self,
        policy: &crate::proof_checkpoint::HistoryRetentionPolicyV1,
    ) -> SnapbackResult<()> {
        self.db.configure_history_policy(policy)
    }

    pub fn prune_record_history(&self, now_ms: u64) -> SnapbackResult<u64> {
        self.db.prune_record_history(now_ms)
    }

    pub fn record_history(
        &self,
        table: &str,
        row_id: &str,
        visible_offset: u64,
        limit: u32,
        authorize_current: impl FnOnce(Option<&Value>) -> bool,
        authorize_historical: impl FnMut(Option<&Value>) -> bool,
    ) -> SnapbackResult<crate::proof_checkpoint::RecordHistoryPageV1> {
        self.db.record_history(
            table,
            row_id,
            visible_offset,
            limit,
            authorize_current,
            authorize_historical,
        )
    }

    pub fn change_journal_len(&self) -> SnapbackResult<u64> {
        self.db.change_journal_len()
    }

    pub fn resume_requires_resnapshot(&self, from_version: u64) -> SnapbackResult<bool> {
        self.db.resume_requires_resnapshot(from_version)
    }

    pub fn changed_row_ids_for_table_since(
        &self,
        table: &str,
        version: u64,
        limit: usize,
    ) -> SnapbackResult<Vec<String>> {
        self.db
            .changed_row_ids_for_table_since(table, version, limit)
    }

    pub fn explain_table_change_version_plan(&self, table: &str) -> SnapbackResult<String> {
        self.db.explain_table_change_version_plan(table)
    }
}

/// Shared-borrow version/journal/history operations for callers holding `&LocalDatabase`.
pub struct VersionsReadKernel<'a> {
    db: &'a LocalDatabase,
}

impl<'a> VersionsReadKernel<'a> {
    pub(super) fn new(db: &'a LocalDatabase) -> Self {
        Self { db }
    }

    pub fn current_version(&self) -> SnapbackResult<u64> {
        self.db.current_version()
    }

    pub fn table_change_version(&self, table: &str) -> SnapbackResult<u64> {
        self.db.table_change_version(table)
    }

    pub fn prune_change_journal(
        &self,
        now_ms: u64,
        retain_versions: u64,
        retain_ms: u64,
    ) -> SnapbackResult<u64> {
        self.db
            .prune_change_journal(now_ms, retain_versions, retain_ms)
    }

    pub fn journal_floor_version(&self) -> SnapbackResult<u64> {
        self.db.journal_floor_version()
    }

    pub fn configure_history_policy(
        &self,
        policy: &crate::proof_checkpoint::HistoryRetentionPolicyV1,
    ) -> SnapbackResult<()> {
        self.db.configure_history_policy(policy)
    }

    pub fn prune_record_history(&self, now_ms: u64) -> SnapbackResult<u64> {
        self.db.prune_record_history(now_ms)
    }

    pub fn record_history(
        &self,
        table: &str,
        row_id: &str,
        visible_offset: u64,
        limit: u32,
        authorize_current: impl FnOnce(Option<&Value>) -> bool,
        authorize_historical: impl FnMut(Option<&Value>) -> bool,
    ) -> SnapbackResult<crate::proof_checkpoint::RecordHistoryPageV1> {
        self.db.record_history(
            table,
            row_id,
            visible_offset,
            limit,
            authorize_current,
            authorize_historical,
        )
    }

    pub fn change_journal_len(&self) -> SnapbackResult<u64> {
        self.db.change_journal_len()
    }

    pub fn resume_requires_resnapshot(&self, from_version: u64) -> SnapbackResult<bool> {
        self.db.resume_requires_resnapshot(from_version)
    }

    pub fn changed_row_ids_for_table_since(
        &self,
        table: &str,
        version: u64,
        limit: usize,
    ) -> SnapbackResult<Vec<String>> {
        self.db
            .changed_row_ids_for_table_since(table, version, limit)
    }

    pub fn explain_table_change_version_plan(&self, table: &str) -> SnapbackResult<String> {
        self.db.explain_table_change_version_plan(table)
    }
}
