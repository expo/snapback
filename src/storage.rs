use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::manifest::{
    CTX_ANSWER_LEDGER_MAX_IDS, CTX_ANSWER_LEDGER_VERSION, CtxAnswerLedger, FieldManifest,
    FieldType, FilterOp, HandlerInput, MutationOutput, MutationPlan, MutationStep, OrderDirection,
    QueryOutput, QueryPlan, ReadDependency, ReturnValue, SchemaManifest, SeedData, TableManifest,
    ValueExpr, auth_fingerprint, replay_opaque_id_is_valid,
};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value, json};
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const META_SCHEMA_MANIFEST: &str = "schema_manifest";
const META_CRON_STATE: &str = "cron_state";
// @ref LLP 0032 L3 — the monotonic replay floor: the highest change version
// that pruning has removed. A resume from at/above it is guaranteed replayable;
// below it, a change may be gone, so the client must resnapshot.
const META_RETENTION_FLOOR: &str = "retention_floor";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct StorageInfo {
    #[serde(rename = "sqlitePath", alias = "sqlite_path")]
    pub sqlite_path: Option<PathBuf>,
    pub version: u64,
    pub tables: Vec<String>,
}

/// A page of rows read through the schema-aware storage layer for the admin
/// data explorer.
///
/// @ref LLP 0017#durable-data-exploration-and-edits — exploration reads go
/// through schema-aware storage and expose system fields, never raw SQLite
/// physical details.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TableScan {
    pub table: String,
    /// Stable display order: `_id`, declared fields, then system timestamps.
    pub columns: Vec<String>,
    pub rows: Vec<Value>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum ChangeOp {
    Insert,
    Update,
    Delete,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ChangedRow {
    pub table: String,
    pub id: String,
    pub op: ChangeOp,
    pub row: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_fields: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MutationCommit {
    pub output: MutationOutput,
    pub changes: Vec<ChangedRow>,
    #[serde(default)]
    pub read_dependencies: Vec<CapturedReadDependency>,
    #[serde(default)]
    pub write_dependencies: Vec<CapturedWriteDependency>,
}

/// Durable identity for one queued client mutation. The server stores this in
/// the same SQLite transaction as the mutation result, closing the
/// response-loss/reconnect duplicate window (LLP 0043 M2).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClientMutationIdentity {
    pub id: String,
    pub function: String,
    pub auth_fingerprint: String,
    pub input_fingerprint: String,
}

struct BufferedCommitOptions<'a> {
    ctx_ledger: Option<CtxAnswerLedger>,
    apply: bool,
    identity: Option<&'a ClientMutationIdentity>,
}

pub(crate) struct BufferedCommitPayload {
    pub writes: Vec<BufferedWrite>,
    pub read_dependencies: Vec<CapturedReadDependency>,
    pub result: Value,
    pub ctx_ledger: CtxAnswerLedger,
}

struct BufferedEffects {
    writes: Vec<BufferedWrite>,
    read_dependencies: Vec<CapturedReadDependency>,
    result: Value,
}

impl ClientMutationIdentity {
    pub fn new(id: impl Into<String>, function: impl Into<String>, input: &HandlerInput) -> Self {
        Self {
            id: id.into(),
            function: function.into(),
            auth_fingerprint: auth_fingerprint(&input.auth),
            input_fingerprint: mutation_input_fingerprint(input),
        }
    }
}

/// One executed IR mutation plan with its recorded deterministic answers —
/// what the plan wrote (or would write), every host-generated id in answer
/// order, and the frozen evaluation clock. The commit path discards the
/// ledger halves; the dry-run path reports them as `deterministicInputs`
/// (LLP 0051 D8).
pub struct MutationPlanExecution {
    pub commit: MutationCommit,
    /// Host-generated ids in answer order (`Insert`/`InsertEach` row ids) —
    /// the IR half of LLP 0051 D1's one ordered `generatedIds` sequence.
    pub generated_ids: Vec<String>,
    /// The frozen evaluation clock every clock expression answered with.
    pub now_ms: u64,
    /// The database version the plan evaluated against.
    pub snapshot_version: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CapturedReadDependency {
    pub kind: CapturedReadKind,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CapturedReadKind {
    Row,
    MissingRow,
    Query,
    Auth,
    Permission,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CapturedWriteDependency {
    pub table: String,
    pub id: String,
    pub op: ChangeOp,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum BufferedWrite {
    Insert {
        table: String,
        id: String,
        values: Map<String, Value>,
    },
    Patch {
        table: String,
        id: String,
        values: Map<String, Value>,
    },
    Delete {
        table: String,
        id: String,
    },
}

impl BufferedWrite {
    pub fn table(&self) -> &str {
        match self {
            BufferedWrite::Insert { table, .. }
            | BufferedWrite::Patch { table, .. }
            | BufferedWrite::Delete { table, .. } => table,
        }
    }

    pub fn id(&self) -> &str {
        match self {
            BufferedWrite::Insert { id, .. }
            | BufferedWrite::Patch { id, .. }
            | BufferedWrite::Delete { id, .. } => id,
        }
    }
}

pub struct LocalDatabase {
    conn: Connection,
    path: Option<PathBuf>,
    schema: SchemaManifest,
    // @ref LLP 0003#database-model — reads use a separate pool of WAL reader
    // connections so queries do not queue behind writes. `None` for in-memory
    // databases, which cannot run WAL; those fall back to the serialized lane.
    reader_pool: Option<Arc<ReaderPool>>,
}

impl LocalDatabase {
    pub fn memory() -> SnapbackResult<Self> {
        let conn = Connection::open_in_memory()?;
        let mut db = Self {
            conn,
            path: None,
            schema: SchemaManifest::default(),
            reader_pool: None,
        };
        db.configure(false)?;
        db.create_infra()?;
        Ok(db)
    }

    pub fn open(path: impl AsRef<Path>) -> SnapbackResult<Self> {
        let path = path.as_ref().to_path_buf();
        let conn = Connection::open(&path)?;
        let mut db = Self {
            conn,
            path: Some(path.clone()),
            schema: SchemaManifest::default(),
            reader_pool: None,
        };
        db.configure(true)?;
        db.create_infra()?;
        db.schema = db.load_schema_manifest()?.unwrap_or_default();
        // The pool is created after configure/create_infra so readers open an
        // existing WAL database with the infra tables committed.
        db.reader_pool = Some(Arc::new(ReaderPool::new(path)));
        Ok(db)
    }

    /// The WAL reader pool for lock-free read-lane queries; `None` for
    /// in-memory databases (no WAL, reads stay on the serialized write lane).
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
    pub fn reader_pool(&self) -> Option<Arc<ReaderPool>> {
        self.reader_pool.clone()
    }

    /// Capture an owned, in-memory read snapshot for detached handler
    /// execution when the live database has no WAL reader pool (`:memory:`).
    /// The backup runs while the caller holds the short instance lock; handler
    /// JavaScript runs only after this owned copy has been returned.
    ///
    /// @ref LLP 0028#execution-the-action-class — ENG-24340 isolates nested
    /// mutation execution from the live in-memory write connection.
    pub(crate) fn detached_read_snapshot(&self) -> SnapbackResult<Self> {
        let mut conn = Connection::open_in_memory()?;
        {
            let backup = rusqlite::backup::Backup::new(&self.conn, &mut conn)?;
            backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
        }
        Ok(Self {
            conn,
            path: None,
            schema: self.schema.clone(),
            reader_pool: None,
        })
    }

    pub fn schema(&self) -> &SchemaManifest {
        &self.schema
    }

    pub fn info(&self) -> SnapbackResult<StorageInfo> {
        Ok(StorageInfo {
            sqlite_path: self.path.clone(),
            version: self.current_version()?,
            tables: self
                .schema
                .tables
                .iter()
                .map(|table| table.name.clone())
                .collect(),
        })
    }

    /// Return the durably settled result for a client mutation identity.
    /// Function/auth mismatches fail closed instead of treating the key as a
    /// cache hit under different authority.
    pub fn client_mutation_result(
        &self,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<Option<MutationOutput>> {
        validate_client_mutation_identity(identity)?;
        let row: Option<(String, String, String, String)> = self
            .conn
            .query_row(
                "SELECT function, auth_fingerprint, input_fingerprint, output_json
                 FROM _snapback_client_mutations WHERE client_mutation_id = ?1",
                params![identity.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        let Some((function, retained_auth, retained_input, output_json)) = row else {
            return Ok(None);
        };
        if function != identity.function {
            return Err(SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                "sync",
                "client mutation id was already used for another function",
            )
            .with_details(json!({
                "clientMutationId": identity.id,
                "expectedFunction": function,
                "actualFunction": identity.function,
            })));
        }
        if retained_auth != identity.auth_fingerprint {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_STALE_RESULT",
                "auth",
                "client mutation was recorded under another auth context",
            )
            .with_details(json!({ "clientMutationId": identity.id })));
        }
        if retained_input != identity.input_fingerprint {
            return Err(SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                "sync",
                "client mutation id was already used with another mutation payload",
            )
            .with_details(json!({
                "clientMutationId": identity.id,
                "reason": "input_fingerprint_mismatch",
            })));
        }
        let output = serde_json::from_str(&output_json).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_RESULT_INVALID",
                "storage",
                "stored client mutation result could not be decoded",
            )
            .with_details(json!({
                "clientMutationId": identity.id,
                "error": error.to_string(),
            }))
        })?;
        Ok(Some(output))
    }

    pub fn current_version(&self) -> SnapbackResult<u64> {
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
    pub fn prune_change_journal(
        &self,
        now_ms: u64,
        retain_versions: u64,
        retain_ms: u64,
    ) -> SnapbackResult<u64> {
        let version_floor = self.current_version()?.saturating_sub(retain_versions);
        let time_floor = now_ms.saturating_sub(retain_ms);
        // Predicate for a prunable row: outside both windows, and not its
        // table's high-water change (which read-set validation still needs).
        let prunable = "version < ?1 AND changed_at_ms < ?2 \
             AND version < (SELECT MAX(version) FROM _snapback_changes t2 \
                            WHERE t2.table_name = _snapback_changes.table_name)";
        // Advance the monotonic replay floor to the highest version actually
        // pruned this pass, so a resume at/above the floor is guaranteed to have
        // a contiguous journal.
        let highest_pruned: Option<i64> = self.conn.query_row(
            &format!("SELECT MAX(version) FROM _snapback_changes WHERE {prunable}"),
            params![version_floor as i64, time_floor as i64],
            |row| row.get(0),
        )?;
        if let Some(highest_pruned) = highest_pruned {
            let floor = self.load_retention_floor()?.max(highest_pruned as u64 + 1);
            self.save_retention_floor(floor)?;
        }
        let deleted = self.conn.execute(
            &format!("DELETE FROM _snapback_changes WHERE {prunable}"),
            params![version_floor as i64, time_floor as i64],
        )?;
        Ok(deleted as u64)
    }

    /// The monotonic replay floor: the highest change version pruning has
    /// removed (0 if nothing has ever been pruned). A version-based resume from
    /// below this may hit a pruned gap and must resnapshot; from at/above it the
    /// journal is contiguous. Distinct from a table's validation high-water,
    /// which pruning preserves.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3.
    pub fn journal_floor_version(&self) -> SnapbackResult<u64> {
        self.load_retention_floor()
    }

    fn load_retention_floor(&self) -> SnapbackResult<u64> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_RETENTION_FLOOR],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
    }

    fn save_retention_floor(&self, floor: u64) -> SnapbackResult<()> {
        self.conn.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_RETENTION_FLOOR, floor.to_string()],
        )?;
        Ok(())
    }

    pub fn change_journal_len(&self) -> SnapbackResult<u64> {
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
    pub fn resume_requires_resnapshot(&self, from_version: u64) -> SnapbackResult<bool> {
        Ok(from_version < self.journal_floor_version()?)
    }

    /// The `EXPLAIN QUERY PLAN` detail for the per-mutation read-set validation
    /// query, so a test can assert it uses the `(table_name, version)` index
    /// rather than scanning. @ref LLP 0032 L3.
    pub fn explain_table_change_version_plan(&self, table: &str) -> SnapbackResult<String> {
        let mut statement = self.conn.prepare(
            "EXPLAIN QUERY PLAN SELECT MAX(version) FROM _snapback_changes WHERE table_name = ?1",
        )?;
        let rows = statement.query_map(params![table], |row| row.get::<_, String>(3))?;
        let mut detail = String::new();
        for row in rows {
            detail.push_str(&row?);
            detail.push('\n');
        }
        Ok(detail)
    }

    pub fn apply_schema(&mut self, manifest: SchemaManifest) -> SnapbackResult<Vec<Diagnostic>> {
        validate_schema(&manifest)?;
        reject_field_retypes(&self.schema, &manifest)?;

        let schema_json = serde_json::to_string(&manifest).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_SCHEMA_SERIALIZE_FAILED",
                "schema",
                "schema manifest could not be serialized",
            )
            .with_detail("error", error.to_string())
        })?;

        let tx = self.conn.transaction()?;
        for table in &manifest.tables {
            create_or_update_table(&tx, table)?;
            for index in &table.indexes {
                create_index(&tx, table, index.name.as_str(), &index.fields)?;
            }
        }
        tx.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_SCHEMA_MANIFEST, schema_json],
        )?;
        tx.commit()?;

        self.schema = manifest;
        Ok(Vec::new())
    }

    pub fn reset(&mut self) -> SnapbackResult<()> {
        let tx = self.conn.transaction()?;
        for table in &self.schema.tables {
            tx.execute(&format!("DELETE FROM {}", quote_ident(&table.name)?), [])?;
        }
        tx.execute("DELETE FROM _snapback_changes", [])?;
        tx.execute("DELETE FROM _snapback_client_mutations", [])?;
        tx.execute(
            "DELETE FROM _snapback_meta WHERE key = ?1",
            params![META_RETENTION_FLOOR],
        )?;
        tx.execute("UPDATE _snapback_version SET version = 0 WHERE id = 1", [])?;
        tx.commit()?;
        Ok(())
    }

    pub fn load_cron_state(&self) -> SnapbackResult<Option<Value>> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_CRON_STATE],
                |row| row.get(0),
            )
            .optional()?;

        value
            .map(|value| {
                serde_json::from_str(&value).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_CRON_STATE_PARSE_FAILED",
                        "cron",
                        "stored cron runtime state could not be parsed",
                    )
                    .with_detail("error", error.to_string())
                })
            })
            .transpose()
    }

    pub fn save_cron_state(&mut self, value: &Value) -> SnapbackResult<()> {
        let state_json = serde_json::to_string(value).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CRON_STATE_SERIALIZE_FAILED",
                "cron",
                "cron runtime state could not be serialized",
            )
            .with_detail("error", error.to_string())
        })?;
        self.conn.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_CRON_STATE, state_json],
        )?;
        Ok(())
    }

    pub fn seed(&mut self, seed: SeedData) -> SnapbackResult<MutationOutput> {
        let mut changed_count = 0usize;
        let now_ms = now_millis();
        let next_version = self.current_version()? + 1;
        let schema = self.schema.clone();
        let tx = self.conn.transaction()?;

        for (table_name, rows) in seed.tables {
            let table = schema_table(&schema, &table_name)?;
            for mut row in rows {
                // Declarative seeds may choose a stable id, but every other
                // system field remains host-owned. Remove the seed identity
                // carrier before entering the same insert validator used by
                // handler/derived writes.
                let id = match row.remove("_id") {
                    None => new_id(),
                    Some(Value::String(id)) if !id.is_empty() => id,
                    Some(_) => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SEED_INVALID",
                            "storage",
                            format!("seed _id for {table_name} must be a nonempty string"),
                        ));
                    }
                };
                let document = insert_document(&tx, table, &id, &row, next_version, now_ms)?;
                record_change(
                    &tx,
                    next_version,
                    &table.name,
                    &id,
                    ChangeOp::Insert,
                    Some(&document),
                    now_ms,
                )?;
                changed_count += 1;
            }
        }

        if changed_count > 0 {
            set_version(&tx, next_version)?;
        }
        tx.commit()?;

        Ok(MutationOutput {
            version: if changed_count > 0 {
                next_version
            } else {
                self.current_version()?
            },
            changed_count,
            result: Value::Null,
            ctx_ledger: None,
        })
    }

    pub fn query(&self, plan: &QueryPlan, input: &HandlerInput) -> SnapbackResult<QueryOutput> {
        query_on(&self.conn, &self.schema, plan, input)
    }

    pub fn get(&self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        get_on(&self.conn, &self.schema, table, id)
    }

    pub fn table_change_version(&self, table: &str) -> SnapbackResult<u64> {
        let table = schema_table(&self.schema, table)?;
        table_change_version_from_connection(&self.conn, &table.name)
    }

    pub fn generate_id(&self) -> String {
        new_id()
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
    pub fn scan_table(
        &self,
        table: &str,
        limit: usize,
        offset: usize,
    ) -> SnapbackResult<TableScan> {
        let table_manifest = schema_table(&self.schema, table)?;
        let quoted = quote_ident(table)?;

        let total: i64 =
            self.conn
                .query_row(&format!("SELECT COUNT(*) FROM {quoted}"), [], |row| {
                    row.get(0)
                })?;

        let sql = format!(
            "SELECT * FROM {quoted} ORDER BY \"_createdAt\" ASC, \"_id\" ASC LIMIT ?1 OFFSET ?2"
        );
        let mut statement = self.conn.prepare(&sql)?;
        let columns = statement
            .column_names()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let mut sql_rows = statement.query(params![limit as i64, offset as i64])?;
        let mut rows = Vec::new();
        while let Some(row) = sql_rows.next()? {
            rows.push(row_to_document(row, table_manifest, &columns)?);
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
    }

    pub fn execute_mutation(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<MutationCommit> {
        Ok(self.execute_mutation_plan(plan, input, true, None)?.commit)
    }

    /// Execute a host plan with lifecycle checks throughout its finite step
    /// loops, then acquire a caller-owned guard only for the final SQLite
    /// commit. Detached actions use this to keep untrusted/data-dependent plan
    /// execution outside their abandonment gate while still linearizing the
    /// durable commit against the public watchdog.
    pub(crate) fn execute_mutation_guarded<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        Ok(self
            .execute_mutation_plan_with_lifecycle(
                plan,
                input,
                true,
                None,
                &check_live,
                before_commit,
            )?
            .commit)
    }

    pub fn execute_mutation_idempotent(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<MutationCommit> {
        Ok(self
            .execute_mutation_plan(plan, input, true, Some(identity))?
            .commit)
    }

    /// Dry-run an IR mutation (LLP 0051 D8): the identical step loop, binding
    /// environment, in-transaction `Get` reads, and read-set validation as
    /// `execute_mutation` — then the transaction is rolled back instead of
    /// committed. Fidelity is by construction: this *is* the commit path with
    /// the final `COMMIT` swapped for `ROLLBACK`, so the answer is evidence,
    /// not a lower-fidelity evaluator (LLP 0024 §Dry-Run rule).
    ///
    /// @ref LLP 0051#d8-the-agent-surface-dry-run-becomes-cheap-and-trustworthy —
    ///   plan evaluation against a snapshot with a recorded ledger;
    ///   execute-and-discard on the buffered substrate.
    pub fn dry_run_mutation(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<MutationPlanExecution> {
        self.execute_mutation_plan(plan, input, false, None)
    }

    fn execute_mutation_plan(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        apply: bool,
        identity: Option<&ClientMutationIdentity>,
    ) -> SnapbackResult<MutationPlanExecution> {
        self.execute_mutation_plan_with_lifecycle(plan, input, apply, identity, &|| Ok(()), || {
            Ok(())
        })
    }

    fn execute_mutation_plan_with_lifecycle<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        apply: bool,
        identity: Option<&ClientMutationIdentity>,
        check_live: &Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationPlanExecution>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        crate::exec_guard::debug_assert_off_async_worker("a SQLite mutation");
        check_live()?;
        // @ref LLP 0003#execution-and-write-semantics — one mutation commits all buffered writes at one version.
        let schema = self.schema.clone();
        let replay_ledger = validate_plan_replay_ledger(input)?;
        let now_ms = replay_ledger
            .as_ref()
            .map(|ledger| ledger.now)
            .unwrap_or_else(now_millis);
        let current_version = self.current_version()?;
        let next_version = current_version + 1;
        let tx = self.conn.transaction()?;

        // @ref LLP 0032#phase-2--execution-semantics-honesty — E3 (Option A),
        // ratified-and-extended by LLP 0051 D2: the client-supplied read_set
        // remains the isolation baseline for *plain* plans (their reads happened
        // on the client, so the client declares the baseline and the server
        // enforces it atomically here). Since `Get`/`Guard` landed, a plan is no
        // longer necessarily an unconditional write sequence — plan `Get` reads
        // execute inside this same transaction (they can never be stale relative
        // to the commit, so they need no conflict validation) and are captured
        // server-side into `read_dependencies` for receipts and derived
        // overlays. (Ibex handlers still differ: they read → await → commit
        // across an async window, so their reads are captured server-side and
        // validated in `commit_buffered_writes`.)
        validate_read_set(&tx, &schema, &input.read_set)?;

        // Fail closed on bounds/profile violations before any step executes.
        crate::value_expr::validate_mutation_plan(plan)?;

        let mut bindings = BTreeMap::new();
        let mut changes = Vec::new();
        let mut read_dependencies: Vec<CapturedReadDependency> = Vec::new();
        // Every host-generated id in answer order — the IR half of the
        // ctx-answer ledger (LLP 0051 D1's `generatedIds`), reported by
        // dry-run as `deterministicInputs`.
        let plan_ids = RefCell::new(PlanIdSource::new(replay_ledger));
        let next_id = || plan_ids.borrow_mut().next();

        for step in &plan.steps {
            check_live()?;
            match step {
                MutationStep::Insert {
                    table,
                    values,
                    bind_id_as,
                } => {
                    let table = schema_table(&schema, table)?;
                    let id = next_id()?;
                    if let Some(binding) = bind_id_as {
                        bindings.insert(binding.clone(), Value::String(id.clone()));
                    }

                    let row = eval_value_map(values, input, &bindings, now_ms, &next_id)?;
                    let changed_fields = changed_field_names(&row);
                    let document = insert_document(&tx, table, &id, &row, next_version, now_ms)?;
                    record_change(
                        &tx,
                        next_version,
                        &table.name,
                        &id,
                        ChangeOp::Insert,
                        Some(&document),
                        now_ms,
                    )?;
                    changes.push(ChangedRow {
                        table: table.name.clone(),
                        id,
                        op: ChangeOp::Insert,
                        row: Some(document),
                        changed_fields,
                    });
                }
                MutationStep::Patch { table, id, values } => {
                    let table = schema_table(&schema, table)?;
                    if values.is_empty() {
                        continue;
                    }
                    let id = expect_string(
                        eval_expr(id, input, &bindings, now_ms, Some(&next_id))?,
                        "patch id",
                    )?;
                    let row = eval_value_map(values, input, &bindings, now_ms, &next_id)?;
                    let changed_fields = changed_field_names(&row);
                    if patch_document(&tx, table, &id, &row, next_version, now_ms)? {
                        let document = get_document_from_tx(&tx, table, &id)?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Update,
                            document.as_ref(),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Update,
                            row: document,
                            changed_fields,
                        });
                    }
                }
                MutationStep::Delete { table, id } => {
                    let table = schema_table(&schema, table)?;
                    let id = expect_string(
                        eval_expr(id, input, &bindings, now_ms, Some(&next_id))?,
                        "delete id",
                    )?;
                    let document = get_document_from_tx(&tx, table, &id)?;
                    if delete_document(&tx, table, &id)? {
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Delete,
                            None,
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Delete,
                            row: document,
                            changed_fields: Vec::new(),
                        });
                    }
                }
                // @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
                // Get binds the row or null; missing is data, not failure. The
                // read runs inside the commit transaction (never stale) and is
                // captured server-side for receipts/overlays; a missing row is a
                // MissingRow entry pinned to the table's change version, the
                // per-row validation shape the buffered path already uses.
                MutationStep::Get {
                    table,
                    id,
                    bind_as,
                    else_error,
                } => {
                    let table = schema_table(&schema, table)?;
                    let id = expect_string(
                        eval_expr(id, input, &bindings, now_ms, Some(&next_id))?,
                        "get id",
                    )?;
                    let document = get_document_from_tx(&tx, table, &id)?;
                    let dependency = match &document {
                        Some(_) => CapturedReadDependency {
                            kind: CapturedReadKind::Row,
                            table: Some(table.name.clone()),
                            id: Some(id.clone()),
                            version: get_row_version(&tx, table, &id)?,
                            predicate: None,
                            rows: Vec::new(),
                            field: None,
                            value: None,
                            order: None,
                            limit: None,
                            result_count: None,
                            boundary: None,
                        },
                        None => CapturedReadDependency {
                            kind: CapturedReadKind::MissingRow,
                            table: Some(table.name.clone()),
                            id: Some(id.clone()),
                            version: Some(table_change_version_from_tx(&tx, &table.name)?),
                            predicate: None,
                            rows: Vec::new(),
                            field: None,
                            value: None,
                            order: None,
                            limit: None,
                            result_count: None,
                            boundary: None,
                        },
                    };
                    read_dependencies.push(dependency);
                    match document {
                        Some(row) => {
                            bindings.insert(bind_as.clone(), row);
                        }
                        None => {
                            if let Some(code) = else_error {
                                return Err(SnapbackError::error(
                                    code.clone(),
                                    "handler",
                                    format!("get on {} {id} found no row", table.name),
                                )
                                .with_details(json!({
                                    "table": table.name,
                                    "id": id,
                                    "step": "Get",
                                })));
                            }
                            bindings.insert(bind_as.clone(), Value::Null);
                        }
                    }
                }
                MutationStep::Guard { cond, else_error } => {
                    let value = eval_expr(cond, input, &bindings, now_ms, Some(&next_id))?;
                    if !crate::value_expr::truthy(&value) {
                        return Err(SnapbackError::error(
                            else_error.clone(),
                            "handler",
                            "mutation guard failed",
                        )
                        .with_details(json!({ "step": "Guard" })));
                    }
                }
                MutationStep::Let { bind_as, expr } => {
                    let value = eval_expr(expr, input, &bindings, now_ms, Some(&next_id))?;
                    bindings.insert(bind_as.clone(), value);
                }
                MutationStep::DeleteWhere { table, filter } => {
                    let table = schema_table(&schema, table)?;
                    // Reuse the query WHERE builder so DeleteWhere filters share
                    // matcher/SQL semantics with reads (empty filter = clear).
                    let scan_plan = QueryPlan {
                        table: table.name.clone(),
                        filters: filter.clone(),
                        order: Vec::new(),
                        limit: None,
                        indexed_by: None,
                    };
                    let (sql, params) = build_query_sql(
                        table,
                        &scan_plan,
                        input,
                        &bindings,
                        now_ms,
                        Some(&next_id),
                    )?;
                    let rows = {
                        let mut statement = tx.prepare(&sql)?;
                        let columns = statement
                            .column_names()
                            .into_iter()
                            .map(ToOwned::to_owned)
                            .collect::<Vec<_>>();
                        let mut matched = statement.query(params_from_iter(params.iter()))?;
                        let mut rows = Vec::new();
                        while let Some(row) = matched.next()? {
                            check_live()?;
                            rows.push(row_to_document(row, table, &columns)?);
                        }
                        rows
                    };
                    // Row-granular deletes so live_delta membership maintenance
                    // sees each removal, exactly as per-row Delete steps.
                    for row in rows {
                        check_live()?;
                        let Some(id) = row.get("_id").and_then(Value::as_str).map(str::to_owned)
                        else {
                            continue;
                        };
                        if delete_document(&tx, table, &id)? {
                            record_change(
                                &tx,
                                next_version,
                                &table.name,
                                &id,
                                ChangeOp::Delete,
                                None,
                                now_ms,
                            )?;
                            changes.push(ChangedRow {
                                table: table.name.clone(),
                                id,
                                op: ChangeOp::Delete,
                                row: Some(row.clone()),
                                changed_fields: Vec::new(),
                            });
                        }
                    }
                }
                MutationStep::InsertEach {
                    table,
                    source,
                    item_as,
                    values,
                } => {
                    let table = schema_table(&schema, table)?;
                    let source_value = eval_expr(source, input, &bindings, now_ms, Some(&next_id))?;
                    let Value::Array(items) = source_value else {
                        return Err(SnapbackError::error(
                            "SNAPBACK_PLAN_SOURCE_INVALID",
                            "runtime",
                            "InsertEach source must evaluate to an array",
                        )
                        .with_details(json!({ "table": table.name })));
                    };
                    if items.len() > crate::value_expr::MAX_INSERT_EACH_FANOUT {
                        return Err(SnapbackError::error(
                            "SNAPBACK_PLAN_BOUNDS",
                            "runtime",
                            format!(
                                "InsertEach fan-out {} exceeds the declared bound ({})",
                                items.len(),
                                crate::value_expr::MAX_INSERT_EACH_FANOUT
                            ),
                        ));
                    }
                    for item in items {
                        check_live()?;
                        // The item binding is scoped to this step's value maps.
                        let mut item_bindings = bindings.clone();
                        item_bindings.insert(item_as.clone(), item);
                        let id = next_id()?;
                        let row = eval_value_map(values, input, &item_bindings, now_ms, &next_id)?;
                        let changed_fields = changed_field_names(&row);
                        let document =
                            insert_document(&tx, table, &id, &row, next_version, now_ms)?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Insert,
                            Some(&document),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Insert,
                            row: Some(document),
                            changed_fields,
                        });
                    }
                }
            }
        }

        if !changes.is_empty() {
            set_version(&tx, next_version)?;
        }

        let result = match &plan.return_value {
            Some(ReturnValue::Literal(value)) => value.clone(),
            Some(ReturnValue::Binding(name)) => bindings.get(name).cloned().unwrap_or(Value::Null),
            Some(ReturnValue::Document { table, id }) => {
                let table = schema_table(&schema, table)?;
                let id = expect_string(
                    eval_expr(id, input, &bindings, now_ms, Some(&next_id))?,
                    "document id",
                )?;
                get_document_from_tx(&tx, table, &id)?.unwrap_or(Value::Null)
            }
            Some(ReturnValue::ChangedCount) | None => json!(changes.len()),
            Some(ReturnValue::Expr(expr)) => {
                eval_expr(expr, input, &bindings, now_ms, Some(&next_id))?
            }
        };

        plan_ids.borrow().ensure_exact_consumption()?;
        let generated_ids = plan_ids.borrow().generated.clone();

        let version = if changes.is_empty() {
            current_version
        } else {
            next_version
        };
        let output_ledger = CtxAnswerLedger {
            version: CTX_ANSWER_LEDGER_VERSION,
            ids: match replay_ledger.as_ref() {
                Some(ledger) => ledger.ids.clone(),
                None => generated_ids.clone(),
            },
            now: now_ms,
            auth_fingerprint: None,
        };
        let output = MutationOutput {
            version,
            changed_count: changes.len(),
            result,
            ctx_ledger: Some(output_ledger),
        };
        if apply {
            check_live()?;
            // The returned guard deliberately lives through tx.commit(). The
            // caller chooses the linearization primitive; no plan step, row
            // scan, expression evaluation, or live fan-out runs while held.
            let _commit_guard = before_commit()?;
            check_live()?;
            if let Some(identity) = identity {
                record_client_mutation_result(&tx, identity, &output)?;
            }
            tx.commit()?;
        } else {
            // Execute-and-discard (LLP 0051 D8): everything above — writes,
            // change-log records, the version bump — evaporates here.
            tx.rollback()?;
        }

        Ok(MutationPlanExecution {
            commit: MutationCommit {
                output,
                write_dependencies: captured_writes_from_changes(&changes),
                changes,
                read_dependencies,
            },
            generated_ids,
            now_ms,
            snapshot_version: current_version,
        })
    }

    pub fn commit_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
    ) -> SnapbackResult<MutationCommit> {
        self.apply_buffered_writes(
            input,
            writes,
            read_dependencies,
            result,
            BufferedCommitOptions {
                ctx_ledger: None,
                apply: true,
                identity: None,
            },
        )
    }

    pub(crate) fn commit_buffered_writes_idempotent(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
        ctx_ledger: CtxAnswerLedger,
        identity: Option<&ClientMutationIdentity>,
    ) -> SnapbackResult<MutationCommit> {
        self.apply_buffered_writes(
            input,
            writes,
            read_dependencies,
            result,
            BufferedCommitOptions {
                ctx_ledger: Some(ctx_ledger),
                apply: true,
                identity,
            },
        )
    }

    /// Detached-action buffered commit with the same lifecycle split as
    /// [`Self::execute_mutation_guarded`]: build and validate the transaction
    /// under caller checks, then hold the caller's guard only across COMMIT.
    pub(crate) fn commit_buffered_writes_idempotent_guarded<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        identity: Option<&ClientMutationIdentity>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        let BufferedCommitPayload {
            writes,
            read_dependencies,
            result,
            ctx_ledger,
        } = payload;
        self.apply_buffered_writes_with_lifecycle(
            input,
            BufferedEffects {
                writes,
                read_dependencies,
                result,
            },
            BufferedCommitOptions {
                ctx_ledger: Some(ctx_ledger),
                apply: true,
                identity,
            },
            &check_live,
            before_commit,
        )
    }

    /// Dry-run the buffered-write commit (LLP 0051 D8): identical read-set
    /// validation and write application as `commit_buffered_writes`, rolled
    /// back instead of committed. The JS-tier half of execute-and-discard —
    /// the handler already ran against the buffered ctx; this answers what
    /// its writes would do without keeping them.
    pub fn dry_run_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
    ) -> SnapbackResult<MutationCommit> {
        self.apply_buffered_writes(
            input,
            writes,
            read_dependencies,
            result,
            BufferedCommitOptions {
                ctx_ledger: None,
                apply: false,
                identity: None,
            },
        )
    }

    fn apply_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
        options: BufferedCommitOptions<'_>,
    ) -> SnapbackResult<MutationCommit> {
        self.apply_buffered_writes_with_lifecycle(
            input,
            BufferedEffects {
                writes,
                read_dependencies,
                result,
            },
            options,
            &|| Ok(()),
            || Ok(()),
        )
    }

    fn apply_buffered_writes_with_lifecycle<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        effects: BufferedEffects,
        options: BufferedCommitOptions<'_>,
        check_live: &Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        crate::exec_guard::debug_assert_off_async_worker("a SQLite commit");
        check_live()?;
        let BufferedEffects {
            writes,
            read_dependencies,
            result,
        } = effects;
        // @ref LLP 0003#execution-and-write-semantics — JS ctx.db writes are buffered during handler execution and committed once after completion.
        let schema = self.schema.clone();
        let now_ms = now_millis();
        let current_version = self.current_version()?;
        let next_version = current_version + 1;
        let tx = self.conn.transaction()?;

        validate_read_set(&tx, &schema, &input.read_set)?;
        // @ref LLP 0020#phase-3-capture-read-sets-during-handler-execution — handler-captured dependencies are validated at commit so callers no longer own the read-set.
        validate_captured_read_set(&tx, &schema, input, &read_dependencies)?;

        let mut changes = Vec::new();
        for write in writes {
            check_live()?;
            match write {
                BufferedWrite::Insert { table, id, values } => {
                    let table = schema_table(&schema, &table)?;
                    let changed_fields = changed_field_names(&values);
                    let document = insert_document(&tx, table, &id, &values, next_version, now_ms)?;
                    record_change(
                        &tx,
                        next_version,
                        &table.name,
                        &id,
                        ChangeOp::Insert,
                        Some(&document),
                        now_ms,
                    )?;
                    changes.push(ChangedRow {
                        table: table.name.clone(),
                        id,
                        op: ChangeOp::Insert,
                        row: Some(document),
                        changed_fields,
                    });
                }
                BufferedWrite::Patch { table, id, values } => {
                    let table = schema_table(&schema, &table)?;
                    if values.is_empty() {
                        continue;
                    }
                    let changed_fields = changed_field_names(&values);
                    if patch_document(&tx, table, &id, &values, next_version, now_ms)? {
                        let document = get_document_from_tx(&tx, table, &id)?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Update,
                            document.as_ref(),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Update,
                            row: document,
                            changed_fields,
                        });
                    }
                }
                BufferedWrite::Delete { table, id } => {
                    let table = schema_table(&schema, &table)?;
                    let document = get_document_from_tx(&tx, table, &id)?;
                    if delete_document(&tx, table, &id)? {
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Delete,
                            None,
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Delete,
                            row: document,
                            changed_fields: Vec::new(),
                        });
                    }
                }
            }
        }

        if !changes.is_empty() {
            set_version(&tx, next_version)?;
        }

        let version = if changes.is_empty() {
            current_version
        } else {
            next_version
        };
        let output = MutationOutput {
            version,
            changed_count: changes.len(),
            result,
            ctx_ledger: options.ctx_ledger,
        };
        if options.apply {
            check_live()?;
            // No handler/plan work runs under this guard; it linearizes only
            // identity recording plus the final SQLite COMMIT.
            let _commit_guard = before_commit()?;
            check_live()?;
            if let Some(identity) = options.identity {
                record_client_mutation_result(&tx, identity, &output)?;
            }
            tx.commit()?;
        } else {
            // Execute-and-discard (LLP 0051 D8): validated and applied above,
            // discarded here.
            tx.rollback()?;
        }

        Ok(MutationCommit {
            output,
            write_dependencies: captured_writes_from_changes(&changes),
            changes,
            read_dependencies,
        })
    }

    fn configure(&mut self, file_backed: bool) -> SnapbackResult<()> {
        self.conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        if file_backed {
            self.conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        }
        Ok(())
    }

    fn create_infra(&mut self) -> SnapbackResult<()> {
        // @ref LLP 0003#database-model — the local SQLite core owns meta, version, and change tables.
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS _snapback_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS _snapback_version (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              version INTEGER NOT NULL
            );
            INSERT INTO _snapback_version(id, version)
            VALUES(1, 0)
            ON CONFLICT(id) DO NOTHING;
            CREATE TABLE IF NOT EXISTS _snapback_changes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              version INTEGER NOT NULL,
              table_name TEXT NOT NULL,
              row_id TEXT NOT NULL,
              op TEXT NOT NULL,
              row_json TEXT,
              changed_at_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS _snapback_changes_by_version
              ON _snapback_changes(version, id);
            -- @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3: the
            -- per-mutation read-set validation runs MAX(version) WHERE
            -- table_name = ?, which was a full scan on the (version, id) index.
            CREATE INDEX IF NOT EXISTS _snapback_changes_by_table_version
              ON _snapback_changes(table_name, version);
            -- LLP 0043 M2: exactly-once queued replay. The settled output and
            -- data changes are written in one SQLite transaction.
            CREATE TABLE IF NOT EXISTS _snapback_client_mutations (
              client_mutation_id TEXT PRIMARY KEY,
              function TEXT NOT NULL,
              auth_fingerprint TEXT NOT NULL,
              input_fingerprint TEXT NOT NULL,
              output_json TEXT NOT NULL,
              settled_at_ms INTEGER NOT NULL
            );
            ",
        )?;
        Ok(())
    }

    fn load_schema_manifest(&self) -> SnapbackResult<Option<SchemaManifest>> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_SCHEMA_MANIFEST],
                |row| row.get(0),
            )
            .optional()?;

        value
            .map(|value| {
                serde_json::from_str(&value).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_SCHEMA_PARSE_FAILED",
                        "schema",
                        "stored schema manifest could not be parsed",
                    )
                    .with_detail("error", error.to_string())
                })
            })
            .transpose()
    }
}

/// Read a query plan against any connection: shared by the write lane (the
/// live connection, serialized under the global mutex) and the read lane (a
/// pooled reader inside a pinned WAL read transaction). The version is read
/// after the rows on purpose — inside a read transaction both come from the
/// pinned snapshot; on the write lane the global mutex serializes writers.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6: the
/// version/rows pair must come from one snapshot; the read lane guarantees it
/// with a pinned read transaction instead of the global mutex.
pub(crate) fn query_on(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
) -> SnapbackResult<QueryOutput> {
    crate::exec_guard::debug_assert_off_async_worker("a SQLite query");
    let table = schema_table(schema, &plan.table)?;
    validate_query_index(table, plan)?;
    let (sql, values) = build_query_sql(table, plan, input, &BTreeMap::new(), now_millis(), None)?;
    let mut statement = conn.prepare(&sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params_from_iter(values.iter()))?;
    let mut output = Vec::new();

    while let Some(row) = rows.next()? {
        output.push(row_to_document(row, table, &columns)?);
    }

    Ok(QueryOutput {
        version: current_version_on(conn)?,
        rows: output,
    })
}

pub(crate) fn get_on(
    conn: &Connection,
    schema: &SchemaManifest,
    table: &str,
    id: &str,
) -> SnapbackResult<Option<Value>> {
    crate::exec_guard::debug_assert_off_async_worker("a SQLite point read");
    let table = schema_table(schema, table)?;
    let sql = format!("SELECT * FROM {} WHERE _id = ?1", quote_ident(&table.name)?);
    let mut statement = conn.prepare(&sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row_to_document(row, table, &columns)?))
    } else {
        Ok(None)
    }
}

pub(crate) fn current_version_on(conn: &Connection) -> SnapbackResult<u64> {
    crate::exec_guard::debug_assert_off_async_worker("a SQLite version read");
    let version: i64 = conn.query_row(
        "SELECT version FROM _snapback_version WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    Ok(version as u64)
}

/// A read-only storage view for query execution on either lane.
///
/// `Live` borrows the write connection (serialized under the global instance
/// mutex). `Pinned` is a pooled read-only connection inside a WAL read
/// transaction: every read through it (rows, versions, change high-waters)
/// comes from one snapshot. Actions carry no view at all — their `ctx.db`
/// reads route through the action host, which chooses the locking policy per
/// call (ENG-23324).
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
pub enum DbRead<'a> {
    Live(&'a LocalDatabase),
    Pinned {
        conn: &'a Connection,
        schema: &'a SchemaManifest,
    },
}

impl DbRead<'_> {
    fn live(&self) -> Option<&LocalDatabase> {
        match self {
            DbRead::Live(db) => Some(db),
            DbRead::Pinned { .. } => None,
        }
    }

    pub fn query(&self, plan: &QueryPlan, input: &HandlerInput) -> SnapbackResult<QueryOutput> {
        match self {
            DbRead::Pinned { conn, schema } => query_on(conn, schema, plan, input),
            _ => self.live().expect("live db").query(plan, input),
        }
    }

    pub fn get(&self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        match self {
            DbRead::Pinned { conn, schema } => get_on(conn, schema, table, id),
            _ => self.live().expect("live db").get(table, id),
        }
    }

    pub fn table_change_version(&self, table: &str) -> SnapbackResult<u64> {
        match self {
            DbRead::Pinned { conn, schema } => {
                let table = schema_table(schema, table)?;
                table_change_version_from_connection(conn, &table.name)
            }
            _ => self.live().expect("live db").table_change_version(table),
        }
    }

    pub fn current_version(&self) -> SnapbackResult<u64> {
        match self {
            DbRead::Pinned { conn, .. } => current_version_on(conn),
            _ => self.live().expect("live db").current_version(),
        }
    }

    pub fn generate_id(&self) -> String {
        new_id()
    }
}

/// How many idle reader connections the pool retains. Checkout never waits:
/// an empty pool opens a fresh read-only connection on demand, and check-in
/// drops connections beyond this cap, so the pool itself has no blocking or
/// deadlock surface.
const READER_POOL_RETAINED: usize = 4;

/// A pool of read-only WAL connections for the lock-free read lane.
///
/// @ref LLP 0003#database-model — queries run read-only against a WAL reader
/// pool and need not take the write lock at all.
pub struct ReaderPool {
    path: PathBuf,
    idle: Mutex<Vec<Connection>>,
}

impl ReaderPool {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            idle: Mutex::new(Vec::new()),
        }
    }

    pub fn checkout(&self) -> SnapbackResult<PooledReader<'_>> {
        crate::exec_guard::debug_assert_off_async_worker("a reader-pool checkout");
        let pooled = self
            .idle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pop();
        let conn = match pooled {
            Some(conn) => conn,
            None => self.open_reader()?,
        };
        Ok(PooledReader {
            pool: self,
            conn: Some(conn),
        })
    }

    fn open_reader(&self) -> SnapbackResult<Connection> {
        let conn = Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.execute_batch(
            "
            PRAGMA query_only = ON;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        Ok(conn)
    }

    fn check_in(&self, conn: Connection) {
        let mut idle = self
            .idle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if idle.len() < READER_POOL_RETAINED {
            idle.push(conn);
        }
    }
}

/// A checked-out reader connection; returns to the pool on drop.
pub struct PooledReader<'a> {
    pool: &'a ReaderPool,
    conn: Option<Connection>,
}

impl PooledReader<'_> {
    pub fn conn(&self) -> &Connection {
        self.conn.as_ref().expect("pooled reader connection")
    }
}

impl Drop for PooledReader<'_> {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            self.pool.check_in(conn);
        }
    }
}

trait WithDetail {
    fn with_detail(self, key: &str, value: impl Into<Value>) -> Self;
}

impl WithDetail for SnapbackError {
    fn with_detail(mut self, key: &str, value: impl Into<Value>) -> Self {
        if !self.diagnostic.details.is_object() {
            self.diagnostic.details = Value::Object(Map::new());
        }
        self.diagnostic.details[key] = value.into();
        self
    }
}

fn validate_schema(manifest: &SchemaManifest) -> SnapbackResult<()> {
    let mut tables = BTreeSet::new();
    // SQLite index names are database-global, and the physical name is
    // `{table}_{index}` joined with `_` — a character both identifiers may
    // contain — so distinct declarations can join to the same physical name
    // (table `foo` + index `bar_baz` vs table `foo_bar` + index `baz`).
    // Validate joined names globally; otherwise the second index would
    // silently never be created (`create_index` would find the first one).
    let mut physical_index_names: BTreeMap<String, String> = BTreeMap::new();
    for table in &manifest.tables {
        validate_user_identifier("table", &table.name)?;
        if !tables.insert(table.name.clone()) {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_DUPLICATE_TABLE",
                "schema",
                format!("duplicate table {}", table.name),
            ));
        }

        let mut fields = BTreeSet::new();
        for field in &table.fields {
            validate_user_identifier("field", &field.name)?;
            if is_system_field(&field.name) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_SYSTEM_FIELD",
                    "schema",
                    format!("{} is managed by Snapback", field.name),
                ));
            }
            if !fields.insert(field.name.clone()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_DUPLICATE_FIELD",
                    "schema",
                    format!("duplicate field {}.{}", table.name, field.name),
                ));
            }
        }

        let mut indexes = BTreeSet::new();
        for index in &table.indexes {
            validate_user_identifier("index", &index.name)?;
            if !indexes.insert(index.name.clone()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_DUPLICATE_INDEX",
                    "schema",
                    format!("duplicate index {}.{}", table.name, index.name),
                ));
            }
            let physical = format!("{}_{}", table.name, index.name);
            let declaration = format!("{}.{}", table.name, index.name);
            if let Some(previous) = physical_index_names.insert(physical.clone(), declaration) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_INDEX_NAME_COLLISION",
                    "schema",
                    format!(
                        "index {}.{} and {previous} share the physical index name \
                         {physical}; SQLite index names are database-global — \
                         rename one of them",
                        table.name, index.name
                    ),
                )
                .with_detail("physicalName", physical)
                .with_detail(
                    "declarations",
                    json!([previous, format!("{}.{}", table.name, index.name)]),
                ));
            }
            if index.fields.is_empty() {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_EMPTY_INDEX",
                    "schema",
                    format!("index {}.{} has no fields", table.name, index.name),
                ));
            }
            for field in &index.fields {
                ensure_field(table, field)?;
            }
        }
    }

    Ok(())
}

/// Reject a manifest that redeclares an existing field with a different type.
///
/// The migrator never rewrites stored data, so a retyped field would leave the
/// physical column carrying values encoded under the old declaration while the
/// stored manifest — and every generated client type — promises the new one.
/// Even affinity-preserving changes (string → json, boolean → integer) change
/// how stored values decode, so any declared-type change is refused.
///
/// @ref LLP 0003#database-model — the migrator must "reject type changes that
/// would require rewriting existing data"; the read lane's schema-race safety
/// argument also assumes fields are never retyped.
fn reject_field_retypes(current: &SchemaManifest, next: &SchemaManifest) -> SnapbackResult<()> {
    for table in &next.tables {
        let Some(current_table) = current.tables.iter().find(|t| t.name == table.name) else {
            continue;
        };
        for field in &table.fields {
            let Some(current_field) = current_table.field(&field.name) else {
                continue;
            };
            if current_field.field_type != field.field_type {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_FIELD_RETYPED",
                    "schema",
                    format!(
                        "field {}.{} cannot change type from {} to {}; \
                         retyping stored data is not supported — add a new field instead",
                        table.name,
                        field.name,
                        field_type_name(&current_field.field_type),
                        field_type_name(&field.field_type)
                    ),
                )
                .with_detail("table", table.name.clone())
                .with_detail("field", field.name.clone())
                .with_detail("existingType", field_type_name(&current_field.field_type))
                .with_detail("requestedType", field_type_name(&field.field_type)));
            }
        }
    }
    Ok(())
}

/// The manifest wire name of a field type (matches `FieldType`'s serde
/// serialization), for error messages and diagnostics.
fn field_type_name(field_type: &FieldType) -> &'static str {
    match field_type {
        FieldType::String => "String",
        FieldType::Boolean => "Boolean",
        FieldType::Integer => "Integer",
        FieldType::Real => "Real",
        FieldType::Json => "Json",
    }
}

fn create_or_update_table(tx: &Transaction<'_>, table: &TableManifest) -> SnapbackResult<()> {
    let mut columns = vec![
        "_id TEXT PRIMARY KEY".to_owned(),
        "_version INTEGER NOT NULL".to_owned(),
        "_createdAt INTEGER NOT NULL".to_owned(),
        "_updatedAt INTEGER NOT NULL".to_owned(),
    ];
    for field in &table.fields {
        columns.push(format!(
            "{} {}",
            quote_ident(&field.name)?,
            sqlite_type(&field.field_type)
        ));
    }

    tx.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {} ({})",
            quote_ident(&table.name)?,
            columns.join(", ")
        ),
        [],
    )?;

    let existing = existing_columns(tx, &table.name)?;
    for field in &table.fields {
        match existing.get(&field.name) {
            None => {
                tx.execute(
                    &format!(
                        "ALTER TABLE {} ADD COLUMN {} {}",
                        quote_ident(&table.name)?,
                        quote_ident(&field.name)?,
                        sqlite_type(&field.field_type)
                    ),
                    [],
                )?;
            }
            // @ref LLP 0003#database-model — the migrator is additive-only and
            // must reject type changes that would require rewriting existing
            // data. The physical column keeps its declared affinity forever,
            // so silently accepting a retyped manifest would hand back values
            // decoded under the old declaration while schema and generated
            // types promise the new one.
            Some(column_type) => {
                let declared = sqlite_type(&field.field_type);
                if !column_type.eq_ignore_ascii_case(declared) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SCHEMA_FIELD_RETYPED",
                        "schema",
                        format!(
                            "field {}.{} cannot change storage type from {} to {}; \
                             retyping stored data is not supported — add a new field instead",
                            table.name, field.name, column_type, declared
                        ),
                    )
                    .with_detail("table", table.name.clone())
                    .with_detail("field", field.name.clone())
                    .with_detail("existingType", column_type.clone())
                    .with_detail("requestedType", declared));
                }
            }
        }
    }

    Ok(())
}

/// Create or rebuild a declared index so the physical index always matches
/// the manifest.
///
/// SQLite index names are database-global and `CREATE INDEX IF NOT EXISTS`
/// matches on name alone, so a bare create has two silent no-op modes: the
/// physical name may already belong to a stale index (left on another table
/// by an earlier schema epoch), or the index may exist with an outdated
/// field list after the manifest changed. Either way the declared index
/// would never exist, while `validate_query_index` keeps accepting
/// `indexed_by` hints for it (it checks only the manifest). Compare the
/// existing definition from `sqlite_master`/`PRAGMA index_info` and drop and
/// recreate on any mismatch — index rebuilds are non-destructive.
///
/// @ref LLP 0003#database-model — the migrator keeps declared indexes in
/// sync with the manifest rather than treating name existence as done.
fn create_index(
    tx: &Transaction<'_>,
    table: &TableManifest,
    name: &str,
    fields: &[String],
) -> SnapbackResult<()> {
    let mut columns = fields
        .iter()
        .map(|field| {
            ensure_field(table, field)?;
            quote_ident(field)
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    columns.push(quote_ident("_id")?);

    let physical_name = format!("{}_{}", table.name, name);
    if let Some(existing) = physical_index(tx, &physical_name)? {
        let desired: Vec<String> = fields.iter().cloned().chain(["_id".to_owned()]).collect();
        if existing.table == table.name && existing.columns == desired {
            return Ok(());
        }
        tx.execute(&format!("DROP INDEX {}", quote_ident(&physical_name)?), [])?;
    }
    tx.execute(
        &format!(
            "CREATE INDEX {} ON {} ({})",
            quote_ident(&physical_name)?,
            quote_ident(&table.name)?,
            columns.join(", ")
        ),
        [],
    )?;
    Ok(())
}

/// A physical SQLite index's owning table and ordered column list, read from
/// `sqlite_master` and `PRAGMA index_info` so schema apply can compare it
/// against the manifest's declaration.
struct PhysicalIndex {
    table: String,
    columns: Vec<String>,
}

fn physical_index(tx: &Transaction<'_>, name: &str) -> SnapbackResult<Option<PhysicalIndex>> {
    let table = tx
        .query_row(
            "SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?1",
            params![name],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(table) = table else {
        return Ok(None);
    };
    let mut statement = tx.prepare(&format!("PRAGMA index_info({})", quote_ident(name)?))?;
    let mut rows = statement.query([])?;
    let mut columns = Vec::new();
    while let Some(row) = rows.next()? {
        // The column name is NULL for rowid or expression members, which a
        // manifest index never declares; mapping those to "" can never match
        // a declared column, so the caller rebuilds the index.
        columns.push(row.get::<_, Option<String>>(2)?.unwrap_or_default());
    }
    Ok(Some(PhysicalIndex { table, columns }))
}

/// Existing column names and their declared SQLite types from
/// `PRAGMA table_info`, so schema apply can detect retyped fields rather than
/// only missing ones.
fn existing_columns(tx: &Transaction<'_>, table: &str) -> SnapbackResult<BTreeMap<String, String>> {
    let mut statement = tx.prepare(&format!("PRAGMA table_info({})", quote_ident(table)?))?;
    let mut rows = statement.query([])?;
    let mut columns = BTreeMap::new();
    while let Some(row) = rows.next()? {
        columns.insert(row.get::<_, String>(1)?, row.get::<_, String>(2)?);
    }
    Ok(columns)
}

/// Fail closed when a query declares `indexed_by` for an index the table's
/// schema does not define. The v0 SQLite target does not yet consult the hint
/// for planning, but silently accepting an unknown index name is a
/// silent-drop-class violation: the hint would be a no-op the author believes
/// is load-bearing. Validating it here makes the honest state explicit until
/// the hint is wired into planning (or removed).
///
/// @ref LLP 0032#phase-2--execution-semantics-honesty — E5: `indexed_by` is
/// validated rather than silently ignored.
fn validate_query_index(table: &TableManifest, plan: &QueryPlan) -> SnapbackResult<()> {
    let Some(index_name) = &plan.indexed_by else {
        return Ok(());
    };
    if table.indexes.iter().any(|index| &index.name == index_name) {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_QUERY_UNKNOWN_INDEX",
        "storage",
        format!(
            "query declares index {index_name:?} which table {:?} does not define",
            table.name
        ),
    )
    .with_details(json!({
        "table": table.name,
        "requestedIndex": index_name,
        "knownIndexes": table.indexes.iter().map(|index| &index.name).collect::<Vec<_>>(),
    })))
}

fn build_query_sql(
    table: &TableManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn() -> SnapbackResult<String>>,
) -> SnapbackResult<(String, Vec<SqlValue>)> {
    let mut sql = format!("SELECT * FROM {}", quote_ident(&table.name)?);
    let mut values = Vec::new();
    let mut where_parts = Vec::new();

    for filter in &plan.filters {
        ensure_field_or_system(table, &filter.field)?;
        match filter.op {
            FilterOp::Eq => {
                let field_type = field_type(table, &filter.field);
                let value = eval_expr(&filter.value, input, bindings, now_ms, runtime_id)?;
                values.push(json_to_sql_value(&value, field_type)?);
                where_parts.push(format!("{} = ?", quote_ident(&filter.field)?));
            }
            FilterOp::In => {
                let field_type = field_type(table, &filter.field);
                let value = eval_expr(&filter.value, input, bindings, now_ms, runtime_id)?;
                let Some(items) = value.as_array() else {
                    return Err(SnapbackError::error(
                        "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
                        "query",
                        format!(
                            "query filter {}.{} In expects an array",
                            table.name, filter.field
                        ),
                    )
                    .with_detail("field", Value::String(filter.field.clone()))
                    .with_detail("op", Value::String("In".to_owned()))
                    .with_detail("value", value));
                };
                if items.is_empty() {
                    where_parts.push("1 = 0".to_owned());
                } else {
                    for item in items {
                        values.push(json_to_sql_value(item, field_type)?);
                    }
                    let placeholders = (0..items.len()).map(|_| "?").collect::<Vec<_>>().join(", ");
                    where_parts.push(format!(
                        "{} IN ({placeholders})",
                        quote_ident(&filter.field)?
                    ));
                }
            }
            FilterOp::Lt | FilterOp::Lte | FilterOp::Gt | FilterOp::Gte => {
                let field_type = field_type(table, &filter.field);
                let value = eval_expr(&filter.value, input, bindings, now_ms, runtime_id)?;
                values.push(json_to_sql_value(&value, field_type)?);
                let op = match filter.op {
                    FilterOp::Lt => "<",
                    FilterOp::Lte => "<=",
                    FilterOp::Gt => ">",
                    FilterOp::Gte => ">=",
                    FilterOp::Eq | FilterOp::In => unreachable!("handled above"),
                };
                where_parts.push(format!("{} {op} ?", quote_ident(&filter.field)?));
            }
        }
    }

    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }

    if !plan.order.is_empty() {
        let mut order_parts = Vec::new();
        for order in &plan.order {
            ensure_field_or_system(table, &order.field)?;
            let direction = match order.direction {
                OrderDirection::Asc => "ASC",
                OrderDirection::Desc => "DESC",
            };
            order_parts.push(format!("{} {direction}", quote_ident(&order.field)?));
        }
        sql.push_str(" ORDER BY ");
        sql.push_str(&order_parts.join(", "));
    }

    if let Some(limit) = plan.limit {
        sql.push_str(" LIMIT ");
        sql.push_str(&limit.to_string());
    }

    Ok((sql, values))
}

fn validate_read_set(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    read_set: &[ReadDependency],
) -> SnapbackResult<()> {
    for dependency in read_set {
        let table = schema_table(schema, &dependency.table)?;
        let current = get_row_version(tx, table, &dependency.id)?;
        if current != Some(dependency.version) {
            return Err(SnapbackError::error(
                "SNAPBACK_MUTATION_CONFLICT",
                "storage",
                "mutation read set changed before commit",
            )
            .with_detail(
                "dependency",
                json!({
                    "table": dependency.table,
                    "id": dependency.id,
                    "expected": dependency.version,
                    "actual": current,
                }),
            ));
        }
    }
    Ok(())
}

fn validate_captured_read_set(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    input: &HandlerInput,
    read_set: &[CapturedReadDependency],
) -> SnapbackResult<()> {
    for dependency in read_set {
        match dependency.kind {
            CapturedReadKind::Row => {
                let table_name = dependency_table(dependency)?;
                let id = dependency_id(dependency)?;
                let expected = dependency.version.ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_CAPTURED_READ_INVALID",
                        "storage",
                        "captured row dependency is missing a version",
                    )
                })?;
                let table = schema_table(schema, table_name)?;
                let current = get_row_version(tx, table, id)?;
                if current != Some(expected) {
                    return Err(captured_conflict(
                        "captured row read changed before commit",
                        dependency,
                        json!({
                            "kind": "row",
                            "table": table_name,
                            "id": id,
                            "expected": expected,
                            "actual": current,
                        }),
                        read_set,
                    ));
                }
            }
            CapturedReadKind::MissingRow => {
                let table_name = dependency_table(dependency)?;
                let id = dependency_id(dependency)?;
                let table = schema_table(schema, table_name)?;
                let current = get_row_version(tx, table, id)?;
                // @ref LLP 0032#phase-2--execution-semantics-honesty — E4: a
                // "row X was absent" read is invalidated only if X is present
                // now — a current-state check, not a whole-table version bump.
                // A disjoint write that inserts a *different* row no longer
                // conflicts.
                if current.is_some() {
                    return Err(captured_conflict(
                        "captured missing-row read changed before commit",
                        dependency,
                        json!({
                            "kind": "missingRow",
                            "table": table_name,
                            "id": id,
                            "expected": dependency.version,
                            "actual": current,
                        }),
                        read_set,
                    ));
                }
            }
            CapturedReadKind::Query => {
                let table_name = dependency_table(dependency)?;
                let expected = dependency.version.ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_CAPTURED_READ_INVALID",
                        "storage",
                        "captured query dependency is missing a table version",
                    )
                })?;
                schema_table(schema, table_name)?;
                let current = table_change_version_from_tx(tx, table_name)?;
                if current == expected {
                    // Fast path: the table has not changed at all.
                    continue;
                }
                // @ref LLP 0032#phase-2--execution-semantics-honesty — E4:
                // the table changed, but only conflict if a change since the
                // read actually affects *this query's* result — reuse the live
                // matcher's predicate so a disjoint-row write (one that does not
                // match the query) no longer conflicts every mutation. If the
                // captured version is below the retention floor the intervening
                // changes were pruned and we cannot tell, so conflict
                // conservatively.
                let floor = retention_floor_from_tx(tx)?;
                let affected = if expected.saturating_add(1) < floor {
                    true
                } else {
                    changes_to_table_since(tx, table_name, expected)?
                        .iter()
                        .any(|change| {
                            crate::live_matcher::query_dependency_change_may_affect(
                                input, dependency, change,
                            )
                        })
                };
                if affected {
                    return Err(captured_conflict(
                        "captured query read changed before commit",
                        dependency,
                        json!({
                            "kind": "query",
                            "table": table_name,
                            "expected": expected,
                            "actual": current,
                            "predicate": dependency.predicate,
                            "rows": dependency.rows,
                        }),
                        read_set,
                    ));
                }
            }
            CapturedReadKind::Auth => {}
            CapturedReadKind::Permission => {}
        }
    }
    Ok(())
}

fn dependency_table(dependency: &CapturedReadDependency) -> SnapbackResult<&str> {
    dependency.table.as_deref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_INVALID",
            "storage",
            "captured dependency is missing a table",
        )
    })
}

fn dependency_id(dependency: &CapturedReadDependency) -> SnapbackResult<&str> {
    dependency.id.as_deref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_INVALID",
            "storage",
            "captured dependency is missing a row id",
        )
    })
}

fn captured_conflict(
    message: &str,
    dependency: &CapturedReadDependency,
    details: Value,
    read_set: &[CapturedReadDependency],
) -> SnapbackError {
    SnapbackError::error("SNAPBACK_MUTATION_CONFLICT", "storage", message)
        .with_detail("dependency", details)
        .with_detail("capturedDependency", json!(dependency))
        .with_detail("capturedReads", json!(read_set))
        .with_detail("retryPolicy", "reject")
}

fn get_row_version(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
) -> SnapbackResult<Option<u64>> {
    let mut statement = tx.prepare_cached(&format!(
        "SELECT _version FROM {} WHERE _id = ?1",
        quote_ident(&table.name)?
    ))?;
    let version: Option<i64> = statement
        .query_row(params![id], |row| row.get(0))
        .optional()?;
    Ok(version.map(|version| version as u64))
}

fn table_change_version_from_connection(conn: &Connection, table: &str) -> SnapbackResult<u64> {
    let version: Option<i64> = conn.query_row(
        "SELECT MAX(version) FROM _snapback_changes WHERE table_name = ?1",
        params![table],
        |row| row.get(0),
    )?;
    Ok(version.unwrap_or(0) as u64)
}

fn table_change_version_from_tx(tx: &Transaction<'_>, table: &str) -> SnapbackResult<u64> {
    let mut statement =
        tx.prepare_cached("SELECT MAX(version) FROM _snapback_changes WHERE table_name = ?1")?;
    let version: Option<i64> = statement.query_row(params![table], |row| row.get(0))?;
    Ok(version.unwrap_or(0) as u64)
}

/// The changes to `table` committed after `version`, reconstructed as
/// `ChangedRow`s. `changed_fields` is not journaled, so it is left empty (the
/// matcher treats an update with unknown changed fields conservatively).
///
/// @ref LLP 0032#phase-2--execution-semantics-honesty — E4: predicate-granularity validation.
fn changes_to_table_since(
    tx: &Transaction<'_>,
    table: &str,
    version: u64,
) -> SnapbackResult<Vec<ChangedRow>> {
    let mut statement = tx.prepare_cached(
        "SELECT row_id, op, row_json FROM _snapback_changes \
         WHERE table_name = ?1 AND version > ?2 ORDER BY version, id",
    )?;
    let rows = statement.query_map(params![table, version as i64], |row| {
        let id: String = row.get(0)?;
        let op: String = row.get(1)?;
        let row_json: Option<String> = row.get(2)?;
        Ok((id, op, row_json))
    })?;
    let mut changes = Vec::new();
    for row in rows {
        let (id, op, row_json) = row?;
        let op = match op.as_str() {
            "insert" => ChangeOp::Insert,
            "update" => ChangeOp::Update,
            _ => ChangeOp::Delete,
        };
        let row = row_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<Value>(json).ok());
        changes.push(ChangedRow {
            table: table.to_owned(),
            id,
            op,
            row,
            changed_fields: Vec::new(),
        });
    }
    Ok(changes)
}

/// The monotonic retention floor recorded by pruning (0 if none). A captured
/// read below it cannot be validated precisely — the changes it would need were
/// pruned — so validation must fall back to a conservative conflict.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3 / E4.
fn retention_floor_from_tx(tx: &Transaction<'_>) -> SnapbackResult<u64> {
    let value: Option<String> = tx
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_RETENTION_FLOOR],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
}

fn captured_writes_from_changes(changes: &[ChangedRow]) -> Vec<CapturedWriteDependency> {
    changes
        .iter()
        .map(|change| CapturedWriteDependency {
            table: change.table.clone(),
            id: change.id.clone(),
            op: change.op.clone(),
        })
        .collect()
}

fn changed_field_names(values: &Map<String, Value>) -> Vec<String> {
    let mut fields = values.keys().cloned().collect::<Vec<_>>();
    fields.sort();
    fields
}

fn eval_value_map(
    values: &BTreeMap<String, ValueExpr>,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
    runtime_id: &dyn Fn() -> SnapbackResult<String>,
) -> SnapbackResult<Map<String, Value>> {
    let mut output = Map::new();
    for (key, expr) in values {
        output.insert(
            key.clone(),
            eval_expr(expr, input, bindings, now_ms, Some(runtime_id))?,
        );
    }
    Ok(output)
}

// One shared evaluator (crate::value_expr) serves mutation execution, the
// live matcher, and filter→SQL compilation, so semantics cannot drift per
// call site (LLP 0051 D2's analyzability invariant).
fn eval_expr(
    expr: &ValueExpr,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn() -> SnapbackResult<String>>,
) -> SnapbackResult<Value> {
    let default_id = || Ok(new_id());
    let env = crate::value_expr::ExprEnv {
        args: &input.args,
        auth_user_id: input.auth.user_id.as_deref(),
        bindings: Some(bindings),
        now_ms: Some(now_ms),
        runtime_id: Some(runtime_id.unwrap_or(&default_id)),
    };
    crate::value_expr::eval_value_expr(expr, &env).map_err(|error| error.into_snapback())
}

fn insert_document(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    row: &Map<String, Value>,
    version: u64,
    now_ms: u64,
) -> SnapbackResult<Value> {
    for key in row.keys() {
        if is_system_field(key) {
            return Err(SnapbackError::error(
                "SNAPBACK_SYSTEM_FIELD_WRITE",
                "storage",
                format!("{key} is managed by Snapback"),
            ));
        }
        ensure_field(table, key)?;
    }

    let mut document = Map::new();
    document.insert("_id".to_owned(), Value::String(id.to_owned()));
    document.insert("_version".to_owned(), json!(version));
    document.insert("_createdAt".to_owned(), json!(now_ms));
    document.insert("_updatedAt".to_owned(), json!(now_ms));

    let mut columns = vec![
        "_id".to_owned(),
        "_version".to_owned(),
        "_createdAt".to_owned(),
        "_updatedAt".to_owned(),
    ];
    let mut values = vec![
        SqlValue::Text(id.to_owned()),
        SqlValue::Integer(version as i64),
        SqlValue::Integer(now_ms as i64),
        SqlValue::Integer(now_ms as i64),
    ];

    for field in &table.fields {
        let value = match row.get(&field.name) {
            Some(value) => {
                validate_declared_field_value(field, value)?;
                value.clone()
            }
            None if field.optional => Value::Null,
            None => {
                return Err(SnapbackError::error(
                    "SNAPBACK_FIELD_MISSING",
                    "storage",
                    format!("required field {}.{} is missing", table.name, field.name),
                ));
            }
        };
        values.push(json_to_sql_value(&value, Some(&field.field_type))?);
        columns.push(field.name.clone());
        document.insert(
            field.name.clone(),
            normalize_json_value(value, &field.field_type)?,
        );
    }

    let placeholders = (0..columns.len())
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    let quoted_columns = columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<SnapbackResult<Vec<_>>>()?
        .join(", ");
    let mut statement = tx.prepare_cached(&format!(
        "INSERT INTO {} ({quoted_columns}) VALUES ({placeholders})",
        quote_ident(&table.name)?
    ))?;
    statement.execute(params_from_iter(values.iter()))?;

    Ok(Value::Object(document))
}

fn patch_document(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    row: &Map<String, Value>,
    version: u64,
    now_ms: u64,
) -> SnapbackResult<bool> {
    let mut assignments = vec!["_version = ?".to_owned(), "_updatedAt = ?".to_owned()];
    let mut values = vec![
        SqlValue::Integer(version as i64),
        SqlValue::Integer(now_ms as i64),
    ];

    for (field, value) in row {
        if is_system_field(field) {
            return Err(SnapbackError::error(
                "SNAPBACK_SYSTEM_FIELD_WRITE",
                "storage",
                format!("{field} is managed by Snapback"),
            ));
        }
        let field_manifest = ensure_field(table, field)?;
        validate_declared_field_value(field_manifest, value)?;
        assignments.push(format!("{} = ?", quote_ident(field)?));
        values.push(json_to_sql_value(value, Some(&field_manifest.field_type))?);
    }
    // Validate the complete patch before consulting row existence. The
    // portable contract rejects malformed writes independent of current
    // state; a missing id must not turn protected/unknown/wrong-type values
    // into an accepted no-op while the hosted target rejects them.
    if get_row_version(tx, table, id)?.is_none() {
        return Ok(false);
    }
    values.push(SqlValue::Text(id.to_owned()));

    let mut statement = tx.prepare_cached(&format!(
        "UPDATE {} SET {} WHERE _id = ?",
        quote_ident(&table.name)?,
        assignments.join(", ")
    ))?;
    statement.execute(params_from_iter(values.iter()))?;
    Ok(true)
}

fn delete_document(tx: &Transaction<'_>, table: &TableManifest, id: &str) -> SnapbackResult<bool> {
    let mut statement = tx.prepare_cached(&format!(
        "DELETE FROM {} WHERE _id = ?1",
        quote_ident(&table.name)?
    ))?;
    let changed = statement.execute(params![id])?;
    Ok(changed > 0)
}

fn get_document_from_tx(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
) -> SnapbackResult<Option<Value>> {
    let sql = format!("SELECT * FROM {} WHERE _id = ?1", quote_ident(&table.name)?);
    let mut statement = tx.prepare_cached(&sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row_to_document(row, table, &columns)?))
    } else {
        Ok(None)
    }
}

fn record_change(
    tx: &Transaction<'_>,
    version: u64,
    table: &str,
    id: &str,
    op: ChangeOp,
    row: Option<&Value>,
    now_ms: u64,
) -> SnapbackResult<()> {
    let mut statement = tx.prepare_cached(
        "INSERT INTO _snapback_changes(version, table_name, row_id, op, row_json, changed_at_ms)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    statement.execute(params![
        version as i64,
        table,
        id,
        match op {
            ChangeOp::Insert => "insert",
            ChangeOp::Update => "update",
            ChangeOp::Delete => "delete",
        },
        row.map(Value::to_string),
        now_ms as i64
    ])?;
    Ok(())
}

fn set_version(tx: &Transaction<'_>, version: u64) -> SnapbackResult<()> {
    tx.execute(
        "UPDATE _snapback_version SET version = ?1 WHERE id = 1",
        params![version as i64],
    )?;
    Ok(())
}

fn row_to_document(
    row: &rusqlite::Row<'_>,
    table: &TableManifest,
    columns: &[String],
) -> SnapbackResult<Value> {
    let mut document = Map::new();
    for (index, column) in columns.iter().enumerate() {
        let field_type = field_type(table, column);
        document.insert(
            column.clone(),
            sqlite_to_json(row.get_ref(index)?, field_type)?,
        );
    }
    Ok(Value::Object(document))
}

fn sqlite_to_json(value: ValueRef<'_>, field_type: Option<&FieldType>) -> SnapbackResult<Value> {
    match value {
        ValueRef::Null => Ok(Value::Null),
        ValueRef::Integer(value) => {
            if matches!(field_type, Some(FieldType::Boolean)) {
                Ok(Value::Bool(value != 0))
            } else {
                Ok(Value::Number(Number::from(value)))
            }
        }
        ValueRef::Real(value) => Number::from_f64(value).map(Value::Number).ok_or_else(|| {
            SnapbackError::error("SNAPBACK_INVALID_FLOAT", "storage", "SQLite returned NaN")
        }),
        ValueRef::Text(value) => {
            let text = String::from_utf8_lossy(value).into_owned();
            if matches!(field_type, Some(FieldType::Json)) {
                serde_json::from_str(&text).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_JSON_PARSE_FAILED",
                        "storage",
                        "stored JSON field could not be parsed",
                    )
                    .with_detail("error", error.to_string())
                })
            } else {
                Ok(Value::String(text))
            }
        }
        ValueRef::Blob(_) => Err(SnapbackError::error(
            "SNAPBACK_UNSUPPORTED_BLOB",
            "storage",
            "blob values are not supported in the v0 local store",
        )),
    }
}

fn json_to_sql_value(value: &Value, field_type: Option<&FieldType>) -> SnapbackResult<SqlValue> {
    if value.is_null() {
        return Ok(SqlValue::Null);
    }

    match field_type {
        None if value.is_string() => value
            .as_str()
            .map(|value| SqlValue::Text(value.to_owned()))
            .ok_or_else(|| type_error("string", value)),
        None if value.is_boolean() => value
            .as_bool()
            .map(|value| SqlValue::Integer(i64::from(value)))
            .ok_or_else(|| type_error("boolean", value)),
        None if value.as_i64().is_some() || value.as_u64().is_some() => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| {
                value.as_u64().and_then(|value| {
                    if value <= i64::MAX as u64 {
                        Some(SqlValue::Integer(value as i64))
                    } else {
                        None
                    }
                })
            })
            .ok_or_else(|| type_error("integer", value)),
        None if value.is_number() => value
            .as_f64()
            .map(SqlValue::Real)
            .ok_or_else(|| type_error("real", value)),
        None => Err(type_error("portable scalar", value)),
        Some(FieldType::String) => value
            .as_str()
            .map(|value| SqlValue::Text(value.to_owned()))
            .ok_or_else(|| type_error("string", value)),
        Some(FieldType::Boolean) => value
            .as_bool()
            .map(|value| SqlValue::Integer(i64::from(value)))
            .ok_or_else(|| type_error("boolean", value)),
        Some(FieldType::Integer) => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| {
                value.as_u64().and_then(|value| {
                    if value <= i64::MAX as u64 {
                        Some(SqlValue::Integer(value as i64))
                    } else {
                        None
                    }
                })
            })
            .ok_or_else(|| type_error("integer", value)),
        Some(FieldType::Real) => value
            .as_f64()
            .map(SqlValue::Real)
            .ok_or_else(|| type_error("real", value)),
        Some(FieldType::Json) => {
            serde_json::to_string(value)
                .map(SqlValue::Text)
                .map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_JSON_SERIALIZE_FAILED",
                        "storage",
                        "JSON field could not be serialized",
                    )
                    .with_detail("error", error.to_string())
                })
        }
    }
}

fn normalize_json_value(value: Value, field_type: &FieldType) -> SnapbackResult<Value> {
    match field_type {
        FieldType::Json => Ok(value),
        _ => {
            json_to_sql_value(&value, Some(field_type))?;
            Ok(value)
        }
    }
}

fn validate_declared_field_value(field: &FieldManifest, value: &Value) -> SnapbackResult<()> {
    if value.is_null() && !field.optional {
        return Err(type_error(field_type_name(&field.field_type), value));
    }
    Ok(())
}

fn type_error(expected: &str, value: &Value) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_FIELD_TYPE_MISMATCH",
        "storage",
        format!("expected {expected} value"),
    )
    .with_detail("value", value.clone())
}

fn schema_table<'a>(schema: &'a SchemaManifest, table: &str) -> SnapbackResult<&'a TableManifest> {
    schema.table(table).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_UNKNOWN_TABLE",
            "schema",
            format!("unknown table {table}"),
        )
    })
}

fn ensure_field<'a>(table: &'a TableManifest, field: &str) -> SnapbackResult<&'a FieldManifest> {
    table.field(field).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_UNKNOWN_FIELD",
            "schema",
            format!("unknown field {}.{field}", table.name),
        )
    })
}

fn ensure_field_or_system(table: &TableManifest, field: &str) -> SnapbackResult<()> {
    if is_system_field(field) {
        return Ok(());
    }
    ensure_field(table, field).map(|_| ())
}

fn field_type<'a>(table: &'a TableManifest, field: &str) -> Option<&'a FieldType> {
    table.field(field).map(|field| &field.field_type)
}

fn is_system_field(field: &str) -> bool {
    matches!(field, "_id" | "_version" | "_createdAt" | "_updatedAt")
}

fn sqlite_type(field_type: &FieldType) -> &'static str {
    match field_type {
        FieldType::String | FieldType::Json => "TEXT",
        FieldType::Boolean | FieldType::Integer => "INTEGER",
        FieldType::Real => "REAL",
    }
}

fn validate_user_identifier(kind: &str, value: &str) -> SnapbackResult<()> {
    if !is_identifier(value) || value.starts_with("_snapback") {
        return Err(SnapbackError::error(
            "SNAPBACK_INVALID_IDENTIFIER",
            "schema",
            format!("invalid {kind} identifier {value}"),
        ));
    }
    Ok(())
}

fn quote_ident(value: &str) -> SnapbackResult<String> {
    if !is_identifier(value) {
        return Err(SnapbackError::error(
            "SNAPBACK_INVALID_IDENTIFIER",
            "storage",
            format!("invalid SQL identifier {value}"),
        ));
    }
    Ok(format!("\"{value}\""))
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        return false;
    }
    chars.all(|char| char == '_' || char.is_ascii_alphanumeric())
}

fn expect_string(value: Value, label: &str) -> SnapbackResult<String> {
    value.as_str().map(ToOwned::to_owned).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_EXPECTED_STRING",
            "runtime",
            format!("{label} must evaluate to a string"),
        )
    })
}

fn validate_plan_replay_ledger(input: &HandlerInput) -> SnapbackResult<Option<&CtxAnswerLedger>> {
    let Some(ledger) = input.ctx_ledger.as_ref() else {
        return Ok(None);
    };
    if ledger.version != CTX_ANSWER_LEDGER_VERSION {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED",
            "runtime",
            format!(
                "ctx-answer ledger version {} is not supported (current: {})",
                ledger.version, CTX_ANSWER_LEDGER_VERSION
            ),
        ));
    }
    if ledger.ids.len() > CTX_ANSWER_LEDGER_MAX_IDS {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
            "runtime",
            format!(
                "ctx-answer ledger contains {} ids, past the declared bound ({})",
                ledger.ids.len(),
                CTX_ANSWER_LEDGER_MAX_IDS
            ),
        ));
    }
    if let Some((index, _)) = ledger
        .ids
        .iter()
        .enumerate()
        .find(|(_, id)| !replay_opaque_id_is_valid(id))
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CTX_LEDGER_ID_INVALID",
            "runtime",
            format!("ctx-answer ledger id at index {index} is not a valid opaque replay id"),
        ));
    }
    if let Some(recorded) = ledger.auth_fingerprint.as_ref()
        && *recorded != auth_fingerprint(&input.auth)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_STALE_RESULT",
            "runtime",
            "ctx-answer ledger was recorded under a different auth context",
        ));
    }
    Ok(Some(ledger))
}

struct PlanIdSource<'a> {
    replay: Option<&'a CtxAnswerLedger>,
    cursor: usize,
    generated: Vec<String>,
}

impl<'a> PlanIdSource<'a> {
    fn new(replay: Option<&'a CtxAnswerLedger>) -> Self {
        Self {
            replay,
            cursor: 0,
            generated: Vec::new(),
        }
    }

    fn next(&mut self) -> SnapbackResult<String> {
        if self.generated.len() >= CTX_ANSWER_LEDGER_MAX_IDS {
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
                "runtime",
                format!(
                    "mutation requested more than {} host-generated ids",
                    CTX_ANSWER_LEDGER_MAX_IDS
                ),
            ));
        }
        let id = match self.replay {
            Some(ledger) => ledger.ids.get(self.cursor).cloned().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_CTX_LEDGER_EXHAUSTED",
                    "runtime",
                    format!(
                        "replay consumed all {} ledgered ids and the mutation asked for another",
                        ledger.ids.len()
                    ),
                )
            })?,
            None => new_id(),
        };
        self.cursor += 1;
        self.generated.push(id.clone());
        Ok(id)
    }

    fn ensure_exact_consumption(&self) -> SnapbackResult<()> {
        if let Some(ledger) = self.replay
            && self.cursor != ledger.ids.len()
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_UNUSED_IDS",
                "runtime",
                format!(
                    "replay consumed {} of {} ledgered ids; the mutation diverged from its recording",
                    self.cursor,
                    ledger.ids.len()
                ),
            ));
        }
        Ok(())
    }
}

fn validate_client_mutation_identity(identity: &ClientMutationIdentity) -> SnapbackResult<()> {
    if !replay_opaque_id_is_valid(&identity.id) {
        return Err(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_ID_INVALID",
            "sync",
            "client mutation id must match the declared opaque replay-id bounds/alphabet",
        ));
    }
    Ok(())
}

fn mutation_input_fingerprint(input: &HandlerInput) -> String {
    // Correlation is receipt-routing metadata and may legitimately change on
    // app reload. Args, optimistic baseline, and replay ledger identify the
    // logical mutation and must be byte-equivalent after canonical key sort.
    let value = canonical_json(json!({
        "args": input.args,
        "readSet": input.read_set,
        "ctxLedger": input.ctx_ledger,
    }));
    let encoded = serde_json::to_vec(&value).expect("mutation identity JSON serializes");
    let mut digest = Sha256::new();
    digest.update(encoded);
    format!("sha256:{:x}", digest.finalize())
}

fn canonical_json(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, canonical_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(canonical_json).collect()),
        other => other,
    }
}

fn record_client_mutation_result(
    tx: &Transaction<'_>,
    identity: &ClientMutationIdentity,
    output: &MutationOutput,
) -> SnapbackResult<()> {
    validate_client_mutation_identity(identity)?;
    let output_json = serde_json::to_string(output).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_RESULT_INVALID",
            "storage",
            "client mutation result could not be encoded",
        )
        .with_details(json!({ "error": error.to_string() }))
    })?;
    tx.execute(
        "INSERT INTO _snapback_client_mutations(
           client_mutation_id, function, auth_fingerprint, input_fingerprint,
           output_json, settled_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            identity.id,
            identity.function,
            identity.auth_fingerprint,
            identity.input_fingerprint,
            output_json,
            now_millis() as i64,
        ],
    )?;
    Ok(())
}

pub(crate) fn new_id() -> String {
    Uuid::now_v7().to_string()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod guarded_commit_tests {
    use super::*;
    use std::cell::Cell;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    fn schema() -> SchemaManifest {
        SchemaManifest {
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields: vec![FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                }],
                indexes: Vec::new(),
                syncable: true,
            }],
            ..SchemaManifest::default()
        }
    }

    fn database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.apply_schema(schema()).expect("apply test schema");
        db
    }

    fn file_database() -> (tempfile::TempDir, PathBuf, LocalDatabase) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("guarded.sqlite3");
        let mut db = LocalDatabase::open(&path).expect("file database");
        db.apply_schema(schema()).expect("apply test schema");
        (dir, path, db)
    }

    fn insert_plan() -> MutationPlan {
        let insert = |title: &str| {
            let mut values = BTreeMap::new();
            values.insert("title".to_owned(), ValueExpr::Literal(json!(title)));
            MutationStep::Insert {
                table: "items".to_owned(),
                values,
                bind_id_as: None,
            }
        };
        MutationPlan {
            steps: vec![insert("one"), insert("two")],
            return_value: Some(ReturnValue::ChangedCount),
        }
    }

    fn buffered_writes() -> Vec<BufferedWrite> {
        [("item_one", "one"), ("item_two", "two")]
            .into_iter()
            .map(|(id, title)| {
                let mut values = Map::new();
                values.insert("title".to_owned(), json!(title));
                BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: id.to_owned(),
                    values,
                }
            })
            .collect()
    }

    fn ledger() -> CtxAnswerLedger {
        CtxAnswerLedger {
            version: CTX_ANSWER_LEDGER_VERSION,
            ids: Vec::new(),
            now: 0,
            auth_fingerprint: None,
        }
    }

    fn buffered_payload() -> BufferedCommitPayload {
        BufferedCommitPayload {
            writes: buffered_writes(),
            read_dependencies: Vec::new(),
            result: json!(2),
            ctx_ledger: ledger(),
        }
    }

    fn cancelled() -> SnapbackError {
        SnapbackError::error(
            "SNAPBACK_ACTION_TIMEOUT",
            "runtime",
            "guarded commit test cancellation",
        )
    }

    fn assert_empty(db: &LocalDatabase) {
        assert_eq!(db.current_version().expect("version"), 0);
        assert_eq!(db.scan_table("items", 10, 0).expect("scan").total, 0);
    }

    struct CommitVisibilityGuard {
        reader: Connection,
        active: Arc<AtomicBool>,
        dropped: Arc<AtomicBool>,
        expected_rows: i64,
    }

    impl Drop for CommitVisibilityGuard {
        fn drop(&mut self) {
            let visible: i64 = self
                .reader
                .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
                .expect("guard drop visibility query");
            assert_eq!(
                visible, self.expected_rows,
                "the caller's guard must remain alive through SQLite COMMIT"
            );
            self.active.store(false, Ordering::SeqCst);
            self.dropped.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn guarded_host_plan_cancellation_rolls_back_rows_version_and_idempotency() {
        let input = HandlerInput::default();
        let plan = insert_plan();

        let mut during_iteration = database();
        let checks = Cell::new(0_usize);
        let error = during_iteration
            .execute_mutation_guarded(
                &plan,
                &input,
                || {
                    checks.set(checks.get() + 1);
                    if checks.get() == 3 {
                        Err(cancelled())
                    } else {
                        Ok(())
                    }
                },
                || Ok(()),
            )
            .expect_err("second-step lifecycle check must cancel the transaction");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&during_iteration);

        let mut before_commit = database();
        let identity = ClientMutationIdentity::new("cm_host_guard", "hostPlan", &input);
        let error = match before_commit.execute_mutation_plan_with_lifecycle(
            &plan,
            &input,
            true,
            Some(&identity),
            &|| Ok(()),
            || -> SnapbackResult<()> { Err(cancelled()) },
        ) {
            Ok(_) => panic!("precommit cancellation must roll back the transaction"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&before_commit);
        assert_eq!(
            before_commit
                .client_mutation_result(&identity)
                .expect("idempotency lookup"),
            None,
            "a rejected precommit cannot retain an idempotency result"
        );
    }

    #[test]
    fn guarded_buffered_cancellation_rolls_back_rows_version_and_idempotency() {
        let input = HandlerInput::default();

        let mut during_iteration = database();
        let checks = Cell::new(0_usize);
        let error = during_iteration
            .commit_buffered_writes_idempotent_guarded(
                &input,
                buffered_payload(),
                None,
                || {
                    checks.set(checks.get() + 1);
                    if checks.get() == 3 {
                        Err(cancelled())
                    } else {
                        Ok(())
                    }
                },
                || Ok(()),
            )
            .expect_err("second-write lifecycle check must cancel the transaction");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&during_iteration);

        let mut before_commit = database();
        let identity = ClientMutationIdentity::new("cm_buffer_guard", "ibex", &input);
        let error = before_commit
            .commit_buffered_writes_idempotent_guarded(
                &input,
                buffered_payload(),
                Some(&identity),
                || Ok(()),
                || -> SnapbackResult<()> { Err(cancelled()) },
            )
            .expect_err("buffered precommit cancellation must roll back");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&before_commit);
        assert_eq!(
            before_commit
                .client_mutation_result(&identity)
                .expect("idempotency lookup"),
            None,
            "a rejected buffered precommit cannot retain an idempotency result"
        );
    }

    #[test]
    fn guarded_host_plan_guard_starts_after_iteration_and_spans_commit() {
        let (_dir, path, mut db) = file_database();
        let reader = Connection::open(path).expect("visibility reader");
        let active = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let saw_guarded_final_check = Arc::new(AtomicBool::new(false));
        let checks_before_guard = Arc::new(AtomicUsize::new(0));

        db.execute_mutation_guarded(
            &insert_plan(),
            &HandlerInput::default(),
            {
                let active = active.clone();
                let saw_guarded_final_check = saw_guarded_final_check.clone();
                let checks_before_guard = checks_before_guard.clone();
                move || {
                    if active.load(Ordering::SeqCst) {
                        saw_guarded_final_check.store(true, Ordering::SeqCst);
                    } else {
                        checks_before_guard.fetch_add(1, Ordering::SeqCst);
                    }
                    Ok(())
                }
            },
            {
                let active = active.clone();
                let dropped = dropped.clone();
                let checks_before_guard = checks_before_guard.clone();
                move || {
                    assert!(
                        checks_before_guard.load(Ordering::SeqCst) >= 3,
                        "plan iteration must finish before gate acquisition"
                    );
                    active.store(true, Ordering::SeqCst);
                    Ok(CommitVisibilityGuard {
                        reader,
                        active,
                        dropped,
                        expected_rows: 2,
                    })
                }
            },
        )
        .expect("guarded host plan commit");

        assert!(saw_guarded_final_check.load(Ordering::SeqCst));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!active.load(Ordering::SeqCst));
        assert_eq!(db.current_version().unwrap(), 1);
    }

    #[test]
    fn guarded_buffered_guard_starts_after_iteration_and_spans_commit() {
        let (_dir, path, mut db) = file_database();
        let reader = Connection::open(path).expect("visibility reader");
        let active = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let saw_guarded_final_check = Arc::new(AtomicBool::new(false));
        let checks_before_guard = Arc::new(AtomicUsize::new(0));

        db.commit_buffered_writes_idempotent_guarded(
            &HandlerInput::default(),
            buffered_payload(),
            None,
            {
                let active = active.clone();
                let saw_guarded_final_check = saw_guarded_final_check.clone();
                let checks_before_guard = checks_before_guard.clone();
                move || {
                    if active.load(Ordering::SeqCst) {
                        saw_guarded_final_check.store(true, Ordering::SeqCst);
                    } else {
                        checks_before_guard.fetch_add(1, Ordering::SeqCst);
                    }
                    Ok(())
                }
            },
            {
                let active = active.clone();
                let dropped = dropped.clone();
                let checks_before_guard = checks_before_guard.clone();
                move || {
                    assert!(
                        checks_before_guard.load(Ordering::SeqCst) >= 3,
                        "buffered iteration must finish before gate acquisition"
                    );
                    active.store(true, Ordering::SeqCst);
                    Ok(CommitVisibilityGuard {
                        reader,
                        active,
                        dropped,
                        expected_rows: 2,
                    })
                }
            },
        )
        .expect("guarded buffered commit");

        assert!(saw_guarded_final_check.load(Ordering::SeqCst));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!active.load(Ordering::SeqCst));
        assert_eq!(db.current_version().unwrap(), 1);
    }
}
