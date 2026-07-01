use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::manifest::{
    FieldManifest, FieldType, FilterOp, HandlerInput, MutationOutput, MutationPlan, MutationStep,
    OrderDirection, QueryOutput, QueryPlan, ReadDependency, ReturnValue, SchemaManifest, SeedData,
    TableManifest, ValueExpr,
};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OptionalExtension, Transaction, params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const META_SCHEMA_MANIFEST: &str = "schema_manifest";
const META_CRON_STATE: &str = "cron_state";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct StorageInfo {
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

pub struct LocalDatabase {
    conn: Connection,
    path: Option<PathBuf>,
    schema: SchemaManifest,
}

impl LocalDatabase {
    pub fn memory() -> SnapbackResult<Self> {
        let conn = Connection::open_in_memory()?;
        let mut db = Self {
            conn,
            path: None,
            schema: SchemaManifest::default(),
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
            path: Some(path),
            schema: SchemaManifest::default(),
        };
        db.configure(true)?;
        db.create_infra()?;
        db.schema = db.load_schema_manifest()?.unwrap_or_default();
        Ok(db)
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

    pub fn current_version(&self) -> SnapbackResult<u64> {
        let version: i64 = self.conn.query_row(
            "SELECT version FROM _snapback_version WHERE id = 1",
            [],
            |row| row.get(0),
        )?;
        Ok(version as u64)
    }

    pub fn apply_schema(&mut self, manifest: SchemaManifest) -> SnapbackResult<Vec<Diagnostic>> {
        validate_schema(&manifest)?;

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
            for row in rows {
                let id = row
                    .get("_id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(new_id);
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
        })
    }

    pub fn query(&self, plan: &QueryPlan, input: &HandlerInput) -> SnapbackResult<QueryOutput> {
        let table = schema_table(&self.schema, &plan.table)?;
        let (sql, values) = build_query_sql(table, plan, input, &BTreeMap::new(), now_millis())?;
        let mut statement = self.conn.prepare(&sql)?;
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
            version: self.current_version()?,
            rows: output,
        })
    }

    pub fn get(&self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        let table = schema_table(&self.schema, table)?;
        let sql = format!("SELECT * FROM {} WHERE _id = ?1", quote_ident(&table.name)?);
        let mut statement = self.conn.prepare(&sql)?;
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
        // @ref LLP 0003#execution-and-write-semantics — one mutation commits all buffered writes at one version.
        let schema = self.schema.clone();
        let now_ms = now_millis();
        let current_version = self.current_version()?;
        let next_version = current_version + 1;
        let tx = self.conn.transaction()?;

        validate_read_set(&tx, &schema, &input.read_set)?;

        let mut bindings = BTreeMap::new();
        let mut changes = Vec::new();

        for step in &plan.steps {
            match step {
                MutationStep::Insert {
                    table,
                    values,
                    bind_id_as,
                } => {
                    let table = schema_table(&schema, table)?;
                    let id = new_id();
                    if let Some(binding) = bind_id_as {
                        bindings.insert(binding.clone(), Value::String(id.clone()));
                    }

                    let row = eval_value_map(values, input, &bindings, now_ms)?;
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
                    let id = expect_string(eval_expr(id, input, &bindings, now_ms)?, "patch id")?;
                    let row = eval_value_map(values, input, &bindings, now_ms)?;
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
                    let id = expect_string(eval_expr(id, input, &bindings, now_ms)?, "delete id")?;
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

        let result = match &plan.return_value {
            Some(ReturnValue::Literal(value)) => value.clone(),
            Some(ReturnValue::Binding(name)) => bindings.get(name).cloned().unwrap_or(Value::Null),
            Some(ReturnValue::Document { table, id }) => {
                let table = schema_table(&schema, table)?;
                let id = expect_string(eval_expr(id, input, &bindings, now_ms)?, "document id")?;
                get_document_from_tx(&tx, table, &id)?.unwrap_or(Value::Null)
            }
            Some(ReturnValue::ChangedCount) | None => json!(changes.len()),
        };

        let version = if changes.is_empty() {
            current_version
        } else {
            next_version
        };
        tx.commit()?;

        Ok(MutationCommit {
            output: MutationOutput {
                version,
                changed_count: changes.len(),
                result,
            },
            write_dependencies: captured_writes_from_changes(&changes),
            changes,
            read_dependencies: Vec::new(),
        })
    }

    pub fn commit_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
    ) -> SnapbackResult<MutationCommit> {
        // @ref LLP 0003#execution-and-write-semantics — JS ctx.db writes are buffered during handler execution and committed once after completion.
        let schema = self.schema.clone();
        let now_ms = now_millis();
        let current_version = self.current_version()?;
        let next_version = current_version + 1;
        let tx = self.conn.transaction()?;

        validate_read_set(&tx, &schema, &input.read_set)?;
        // @ref LLP 0020#phase-3-capture-read-sets-during-handler-execution — handler-captured dependencies are validated at commit so callers no longer own the read-set.
        validate_captured_read_set(&tx, &schema, &read_dependencies)?;

        let mut changes = Vec::new();
        for write in writes {
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
        tx.commit()?;

        Ok(MutationCommit {
            output: MutationOutput {
                version,
                changed_count: changes.len(),
                result,
            },
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
        if !existing.contains(&field.name) {
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
    }

    Ok(())
}

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
    tx.execute(
        &format!(
            "CREATE INDEX IF NOT EXISTS {} ON {} ({})",
            quote_ident(&format!("{}_{}", table.name, name))?,
            quote_ident(&table.name)?,
            columns.join(", ")
        ),
        [],
    )?;
    Ok(())
}

fn existing_columns(tx: &Transaction<'_>, table: &str) -> SnapbackResult<BTreeSet<String>> {
    let mut statement = tx.prepare(&format!("PRAGMA table_info({})", quote_ident(table)?))?;
    let mut rows = statement.query([])?;
    let mut columns = BTreeSet::new();
    while let Some(row) = rows.next()? {
        columns.insert(row.get::<_, String>(1)?);
    }
    Ok(columns)
}

fn build_query_sql(
    table: &TableManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
) -> SnapbackResult<(String, Vec<SqlValue>)> {
    let mut sql = format!("SELECT * FROM {}", quote_ident(&table.name)?);
    let mut values = Vec::new();
    let mut where_parts = Vec::new();

    for filter in &plan.filters {
        ensure_field_or_system(table, &filter.field)?;
        match filter.op {
            FilterOp::Eq => {
                let field_type = field_type(table, &filter.field);
                let value = eval_expr(&filter.value, input, bindings, now_ms)?;
                values.push(json_to_sql_value(&value, field_type)?);
                where_parts.push(format!("{} = ?", quote_ident(&filter.field)?));
            }
            FilterOp::In => {
                let field_type = field_type(table, &filter.field);
                let value = eval_expr(&filter.value, input, bindings, now_ms)?;
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
                let value = eval_expr(&filter.value, input, bindings, now_ms)?;
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
                let current_table_version = table_change_version_from_tx(tx, table_name)?;
                if current.is_some() || dependency.version != Some(current_table_version) {
                    return Err(captured_conflict(
                        "captured missing-row read changed before commit",
                        dependency,
                        json!({
                            "kind": "missingRow",
                            "table": table_name,
                            "id": id,
                            "expected": dependency.version,
                            "actual": current,
                            "actualTableVersion": current_table_version,
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
                if current != expected {
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
    let version: Option<i64> = tx
        .query_row(
            &format!(
                "SELECT _version FROM {} WHERE _id = ?1",
                quote_ident(&table.name)?
            ),
            params![id],
            |row| row.get(0),
        )
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
    let version: Option<i64> = tx.query_row(
        "SELECT MAX(version) FROM _snapback_changes WHERE table_name = ?1",
        params![table],
        |row| row.get(0),
    )?;
    Ok(version.unwrap_or(0) as u64)
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
) -> SnapbackResult<Map<String, Value>> {
    let mut output = Map::new();
    for (key, expr) in values {
        output.insert(key.clone(), eval_expr(expr, input, bindings, now_ms)?);
    }
    Ok(output)
}

fn eval_expr(
    expr: &ValueExpr,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
) -> SnapbackResult<Value> {
    match expr {
        ValueExpr::Arg(path) => lookup_path(&input.args, path).cloned().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ARG_MISSING",
                "runtime",
                format!("handler arg {path} was not provided"),
            )
        }),
        ValueExpr::AuthUserId => input
            .auth
            .user_id
            .clone()
            .map(Value::String)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_USER_MISSING",
                    "runtime",
                    "handler requested auth.user_id but no user was supplied",
                )
            }),
        ValueExpr::Binding(name) => bindings.get(name).cloned().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BINDING_MISSING",
                "runtime",
                format!("handler binding {name} was not available"),
            )
        }),
        ValueExpr::Literal(value) => Ok(value.clone()),
        ValueExpr::RuntimeId => Ok(Value::String(new_id())),
        ValueExpr::RuntimeNow => Ok(json!(now_ms)),
    }
}

fn lookup_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        current = current.as_object()?.get(part)?;
    }
    Some(current)
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
        if !is_system_field(key) {
            ensure_field(table, key)?;
        }
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
            Some(value) => value.clone(),
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
    tx.execute(
        &format!(
            "INSERT INTO {} ({quoted_columns}) VALUES ({placeholders})",
            quote_ident(&table.name)?
        ),
        params_from_iter(values.iter()),
    )?;

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
    if get_row_version(tx, table, id)?.is_none() {
        return Ok(false);
    }

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
        assignments.push(format!("{} = ?", quote_ident(field)?));
        values.push(json_to_sql_value(value, Some(&field_manifest.field_type))?);
    }
    values.push(SqlValue::Text(id.to_owned()));

    tx.execute(
        &format!(
            "UPDATE {} SET {} WHERE _id = ?",
            quote_ident(&table.name)?,
            assignments.join(", ")
        ),
        params_from_iter(values.iter()),
    )?;
    Ok(true)
}

fn delete_document(tx: &Transaction<'_>, table: &TableManifest, id: &str) -> SnapbackResult<bool> {
    let changed = tx.execute(
        &format!("DELETE FROM {} WHERE _id = ?1", quote_ident(&table.name)?),
        params![id],
    )?;
    Ok(changed > 0)
}

fn get_document_from_tx(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
) -> SnapbackResult<Option<Value>> {
    let sql = format!("SELECT * FROM {} WHERE _id = ?1", quote_ident(&table.name)?);
    let mut statement = tx.prepare(&sql)?;
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
    tx.execute(
        "INSERT INTO _snapback_changes(version, table_name, row_id, op, row_json, changed_at_ms)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
        params![
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
        ],
    )?;
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

fn new_id() -> String {
    Uuid::now_v7().to_string()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
