use super::*;

impl LocalDatabase {
    pub(super) fn query(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<QueryOutput> {
        query_on(&self.conn, &self.schema, plan, input)
    }

    /// Execute a closed relational plan under `root-window-v1`.
    ///
    /// @ref LLP 0080#2-portable-evaluation-semantics — the normative
    ///   pipeline: visible root filter → root order → take N roots → join +
    ///   joined visibility → projection. Both source predicates execute
    ///   inside one pinned read snapshot; `take` bounds consumed authorized
    ///   roots; `inner` omits an unmatched or invisible joined row without
    ///   refilling the page; `left` emits null joined leaves.
    pub(super) fn query_relational(
        &self,
        plan: &crate::manifest::RelationalQueryPlan,
        input: &HandlerInput,
        cursor: Option<&KeysetAfter>,
    ) -> SnapbackResult<(QueryOutput, Option<KeysetAfter>)> {
        self.with_pinned_read_view(|db| query_relational_on(&db, plan, input, cursor))
    }

    /// Run one complete query invocation against a snapshot-bound view of this
    /// database. The file-backed read lane already supplies a transaction; this
    /// gives direct-library, live-subscription, and in-memory fallback queries
    /// the same rows/dependency-cursor boundary on the serialized connection.
    ///
    /// @ref LLP 0003#execution-and-write-semantics — every query-handler read
    /// and its reported/dependency versions come from one snapshot.
    pub(super) fn with_pinned_read_view<T>(
        &self,
        read: impl FnOnce(DbRead<'_>) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        with_pinned_read_snapshot(&self.conn, |conn| {
            read(DbRead::pinned_bound(
                conn,
                &self.schema,
                self.binding(),
                Arc::clone(&self.vector_quarantine_gate),
            ))
        })
    }

    pub(super) fn query_with_storage_limit(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
        storage_limit: usize,
    ) -> SnapbackResult<QueryOutput> {
        query_on_with_storage_limit(&self.conn, &self.schema, plan, input, storage_limit)
    }

    pub(super) fn get(&self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        get_on(&self.conn, &self.schema, table, id)
    }

    /// Read a page of a table for the admin data explorer.
    ///
    /// Schema-aware and read-only: the table must be a known schema table, rows
    /// decode through the same field-type rules as `query`, and ordering is a
    /// stable `(_createdAt, _id)` so paging is deterministic. This is the paved
    /// read path; it is not raw SQL.
    ///
    /// @ref LLP 0017#durable-data-exploration-and-edits — read-only exploration
    /// through schema-aware storage with system fields shown.
    pub(super) fn scan_table(
        &self,
        table: &str,
        limit: usize,
        offset: usize,
    ) -> SnapbackResult<TableScan> {
        let table_manifest = schema_table(&self.schema, table)?;
        with_pinned_read_snapshot(&self.conn, |conn| {
            let snapshot_version = current_version_on(conn)?;
            let quoted = quote_ident(table)?;

            let total: i64 =
                conn.query_row(&format!("SELECT COUNT(*) FROM {quoted}"), [], |row| {
                    row.get(0)
                })?;

            let sql = format!(
                "SELECT * FROM {quoted} ORDER BY \"_createdAt\" ASC, \"_id\" ASC LIMIT ?1 OFFSET ?2"
            );
            // @ref LLP 0162#measurement-gate — ordinary current-range reads
            // preserve the pinned pre-profile per-call preparation boundary.
            let mut statement = conn.prepare(&sql)?;
            let columns = statement
                .column_names()
                .into_iter()
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            let mut sql_rows = statement.query(params![limit as i64, offset as i64])?;
            let mut rows = Vec::new();
            while let Some(row) = sql_rows.next()? {
                let document = row_to_document(row, table_manifest, &columns)?;
                validate_document_version_at_most(&document, snapshot_version, table)?;
                rows.push(document);
            }

            let mut display_columns = vec!["_id".to_owned()];
            display_columns.extend(table_manifest.fields.iter().map(|field| field.name.clone()));
            display_columns.extend([
                "_version".to_owned(),
                "_createdAt".to_owned(),
                "_updatedAt".to_owned(),
            ]);

            Ok(TableScan {
                table: table.to_owned(),
                columns: display_columns,
                rows,
                total: total as usize,
                limit,
                offset,
            })
        })
    }
}

/// Narrow typed access to application queries, point reads, and schema-aware scans.
///
/// @ref LLP 0225#1-ownership-map — storage callers enter the kernel
/// through typed operations instead of the wide `LocalDatabase` surface.
pub struct QueryReadsKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> QueryReadsKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn query(&self, plan: &QueryPlan, input: &HandlerInput) -> SnapbackResult<QueryOutput> {
        self.db.query(plan, input)
    }

    pub fn query_relational(
        &self,
        plan: &crate::manifest::RelationalQueryPlan,
        input: &HandlerInput,
        cursor: Option<&KeysetAfter>,
    ) -> SnapbackResult<(QueryOutput, Option<KeysetAfter>)> {
        self.db.query_relational(plan, input, cursor)
    }

    pub fn with_pinned_read_view<T>(
        &self,
        read: impl FnOnce(DbRead<'_>) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        self.db.with_pinned_read_view(read)
    }

    pub fn query_with_storage_limit(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
        storage_limit: usize,
    ) -> SnapbackResult<QueryOutput> {
        self.db.query_with_storage_limit(plan, input, storage_limit)
    }

    pub fn get(&self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        self.db.get(table, id)
    }

    pub fn scan_table(
        &self,
        table: &str,
        limit: usize,
        offset: usize,
    ) -> SnapbackResult<TableScan> {
        self.db.scan_table(table, limit, offset)
    }
}

/// Shared-borrow query/read operations for callers holding `&LocalDatabase`.
pub struct QueryReadsReadKernel<'a> {
    db: &'a LocalDatabase,
}

impl<'a> QueryReadsReadKernel<'a> {
    pub(super) fn new(db: &'a LocalDatabase) -> Self {
        Self { db }
    }

    pub fn query(&self, plan: &QueryPlan, input: &HandlerInput) -> SnapbackResult<QueryOutput> {
        self.db.query(plan, input)
    }

    pub fn query_relational(
        &self,
        plan: &crate::manifest::RelationalQueryPlan,
        input: &HandlerInput,
        cursor: Option<&KeysetAfter>,
    ) -> SnapbackResult<(QueryOutput, Option<KeysetAfter>)> {
        self.db.query_relational(plan, input, cursor)
    }

    pub fn with_pinned_read_view<T>(
        &self,
        read: impl FnOnce(DbRead<'_>) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        self.db.with_pinned_read_view(read)
    }

    pub fn query_with_storage_limit(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
        storage_limit: usize,
    ) -> SnapbackResult<QueryOutput> {
        self.db.query_with_storage_limit(plan, input, storage_limit)
    }

    pub fn get(&self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        self.db.get(table, id)
    }

    pub fn scan_table(
        &self,
        table: &str,
        limit: usize,
        offset: usize,
    ) -> SnapbackResult<TableScan> {
        self.db.scan_table(table, limit, offset)
    }
}
