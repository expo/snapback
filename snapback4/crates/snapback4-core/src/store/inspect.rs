//! SQLite read-only inspection connection and generated application views.
// @ref LLP 3000.009.001.000#32-the-rule — inspection SQL stays inside the adapter.
use super::{Store, Tx};
use crate::inspection::{CATALOG_HINT, InspectionCatalog, InspectionResult as Result, PRIVATE};
use crate::schema::{ColumnDefault, ColumnType, Schema, Table};
use rusqlite::{
    Connection, OpenFlags, OptionalExtension,
    hooks::{AuthAction, AuthContext, Authorization},
    types::ValueRef,
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
};

pub struct Inspection {
    conn: Connection,
    denied: Arc<AtomicU8>,
}
pub struct InspectionRows {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub more: bool,
}
impl Inspection {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(store_error)?;
        Ok(Self {
            conn,
            denied: Arc::new(AtomicU8::new(0)),
        })
    }
    pub fn begin_snapshot(&self) -> Result<()> {
        self.conn
            .execute_batch("BEGIN DEFERRED")
            .map_err(store_error)
    }
    pub fn build_views(&self, schema: &Schema, ephemeral: impl FnMut(&str)) -> Result<()> {
        self.build_retained_views(schema, false, false, ephemeral)
    }
    // @ref LLP 3000.000.000#19.4 — active and retained records share one snapshot and authorizer.
    pub fn build_retained_views(
        &self,
        schema: &Schema,
        dormant: bool,
        all_releases: bool,
        mut ephemeral: impl FnMut(&str),
    ) -> Result<()> {
        let conn = &self.conn;
        let mut views = BTreeSet::new();
        let mut backing = BTreeSet::new();
        for (name, table) in schema.visible_tables() {
            if table.ephemeral.is_some() {
                ephemeral(name);
                continue;
            }
            if internal(name) {
                continue;
            }
            if (dormant || all_releases)
                && table
                    .columns
                    .keys()
                    .any(|column| matches!(column.as_str(), STATE | SOURCE | COLUMNS))
            {
                return Err((
                    "E_SQL_INTERNAL",
                    format!(
                        "{name} declares {STATE}, {SOURCE} or {COLUMNS}; retained inspection reserves those result columns"
                    ),
                ));
            }
            let number: i64 = conn
                .query_row("SELECT num FROM _catalog WHERE name = ?1", [name], |row| {
                    row.get(0)
                })
                .map_err(store_error)?;
            let private = format!("{PRIVATE}{number}");
            let projected = |data: &str, defaults: bool| {
                let mut columns = vec!["id".to_owned()];
                for (column, kind) in &table.columns {
                    if column == "id" {
                        continue;
                    }
                    let tag = scalar_tag(kind);
                    let path = format!("$.Row.{}{tag}", ident(column));
                    let mut value = format!("json_extract({data}, {})", literal(&path));
                    if table.maintained.contains_key(column) {
                        value = format!("coalesce({value}, 0)");
                    }
                    // @ref LLP 3000.007#18.3 — inspection projects required literal defaults, while optional absence remains SQL null.
                    if defaults
                        && !kind.is_optional()
                        && let Some(ColumnDefault::Literal(default)) = table.defaults.get(column)
                    {
                        let default = format!(
                            "json_extract({}, {})",
                            literal(&crate::value::canonical_json(default)),
                            literal(&format!("${tag}"))
                        );
                        let field = literal(&format!("$.Row.{}", ident(column)));
                        value = format!(
                            "CASE WHEN json_type({data}, {field}) IS NULL THEN {default} ELSE {value} END"
                        );
                    }
                    columns.push(format!(
                        "{} AS {}",
                        if tag.is_empty() {
                            format!("nullif({value}, 'Null')")
                        } else {
                            value
                        },
                        ident(column)
                    ));
                }
                columns
            };
            let columns = projected("data", true);
            let provided = |data: &str| {
                let values = table
                    .columns
                    .keys()
                    .filter(|column| column.as_str() != "id" && !table.engine_field(column))
                    .map(|column| {
                        format!(
                            "CASE WHEN json_type({data},{}) IS NOT NULL THEN {} ELSE '' END",
                            literal(&format!("$.Row.{}", ident(column))),
                            literal(&format!("{},", serde_json::to_string(column).unwrap()))
                        )
                    })
                    .collect::<Vec<_>>();
                if values.is_empty() {
                    "'[]'".to_owned()
                } else {
                    format!("'[' || rtrim({}, ',') || ']'", values.join(" || "))
                }
            };
            let mut source_views = String::new();
            let backing_sql = if dormant || all_releases {
                let active_view = format!("{private}_active");
                let table_view = format!("{private}_table");
                let narrowed_view = format!("{private}_narrowed");
                let cells_view = format!("{private}_cells");
                source_views = format!(
                    "CREATE TEMP VIEW {} AS SELECT id,data FROM main.r WHERE t={number}; CREATE TEMP VIEW {} AS SELECT id,data FROM main._dormant_rows WHERE t={number}; CREATE TEMP VIEW {} AS SELECT id,data FROM main._dormant_narrow_rows WHERE t={number}; CREATE TEMP VIEW {} AS SELECT t,id,column_name,data FROM main._dormant_values WHERE t={number};",
                    ident(&active_view),
                    ident(&table_view),
                    ident(&narrowed_view),
                    ident(&cells_view)
                );
                backing.extend([
                    active_view.clone(),
                    table_view.clone(),
                    narrowed_view.clone(),
                    cells_view.clone(),
                ]);
                let mut parts = Vec::new();
                if all_releases {
                    parts.push(format!("SELECT {},'active' AS {STATE},NULL AS {SOURCE},{} AS {COLUMNS} FROM temp.{} a",projected("a.data",true).join(", "),provided("a.data"),ident(&active_view)));
                }
                parts.push(format!("SELECT {},'dormant-row' AS {STATE},'table' AS {SOURCE},{} AS {COLUMNS} FROM temp.{} d",projected("d.data",false).join(", "),provided("d.data"),ident(&table_view)));
                parts.push(format!("SELECT {},'dormant-row' AS {STATE},'narrowed' AS {SOURCE},{} AS {COLUMNS} FROM temp.{} d",projected("d.data",false).join(", "),provided("d.data"),ident(&narrowed_view)));
                let mut cells = vec!["x.id AS id".to_owned()];
                for (column, kind) in &table.columns {
                    if column == "id" {
                        continue;
                    }
                    let tag = scalar_tag(kind);
                    let value = format!(
                        "(SELECT json_extract(v.data,{}) FROM temp.{} v WHERE v.id=x.id AND v.column_name={})",
                        literal(&format!("${tag}")),
                        ident(&cells_view),
                        literal(column)
                    );
                    cells.push(format!(
                        "{} AS {}",
                        if tag.is_empty() {
                            format!("nullif({value}, 'Null')")
                        } else {
                            value
                        },
                        ident(column)
                    ));
                }
                let cell_columns = format!(
                    "(SELECT json_group_array(column_name) FROM (SELECT column_name FROM temp.{} v WHERE v.id=x.id ORDER BY column_name))",
                    ident(&cells_view)
                );
                parts.push(format!("SELECT {},'dormant-cell' AS {STATE},'column' AS {SOURCE},{cell_columns} AS {COLUMNS} FROM (SELECT DISTINCT id FROM temp.{}) x",cells.join(", "),ident(&cells_view)));
                parts.join(" UNION ALL ")
            } else {
                format!(
                    "SELECT {} FROM main.r WHERE t = {number}",
                    columns.join(", ")
                )
            };
            // The private backing name cannot occur in submitted SQL. A public
            // view alone is unsafe: a WITH of the same name spoofs its authorizer
            // accessor when reading r. This extra view makes that context unforgeable.
            conn.execute_batch(&format!("{source_views} CREATE TEMP VIEW {} AS {backing_sql}; CREATE TEMP VIEW {} AS SELECT * FROM temp.{};", ident(&private), ident(name), ident(&private))).map_err(store_error)?;
            views.insert(name.to_ascii_lowercase());
            backing.insert(private);
        }
        self.authorize(views, backing)?;
        Ok(())
    }
    fn authorize(&self, views: BTreeSet<String>, backing: BTreeSet<String>) -> Result<()> {
        let conn = &self.conn;
        let denied = self.denied.clone();
        let reason = denied.clone();
        conn.authorizer(Some(move |context: AuthContext<'_>| {
            let code = match context.action {
                AuthAction::Select | AuthAction::Recursive => return Authorization::Allow,
                AuthAction::Function { function_name }
                    if !["load_extension", "writefile", "readfile", "eval"]
                        .contains(&function_name.to_ascii_lowercase().as_str()) =>
                {
                    return Authorization::Allow;
                }
                AuthAction::Read { table_name, .. } => {
                    let name = table_name.to_ascii_lowercase();
                    let private_context =
                        context.accessor.is_some_and(|name| backing.contains(name));
                    if context.database_name == Some("main")
                        && private_context
                        && matches!(
                            name.as_str(),
                            "r" | "_dormant_rows" | "_dormant_narrow_rows" | "_dormant_values"
                        )
                    {
                        return Authorization::Allow;
                    }
                    if context.database_name == Some("temp")
                        && (views.contains(&name) || backing.contains(&name))
                    {
                        return Authorization::Allow;
                    }
                    2
                }
                _ => 1,
            };
            reason.store(code, Ordering::Relaxed);
            Authorization::Deny
        }))
        .map_err(store_error)?;
        Ok(())
    }
    pub fn query(
        &self,
        body: &str,
        schema: &Schema,
        limit: u32,
        object_rows: bool,
        booleans: impl FnOnce(usize) -> Result<Vec<bool>>,
    ) -> Result<InspectionRows> {
        let conn = &self.conn;
        let denied = &self.denied;
        let query_error = |e: rusqlite::Error| {
            match denied.load(Ordering::Relaxed) {
        1 => ("E_SQL_READ_ONLY", "sql accepts one read-only SELECT or WITH … SELECT; writes and side effects are refused".into()),
        2 => ("E_SQL_INTERNAL", format!("sql reads application views only; internal tables, r, i and SQLite metadata are refused; {CATALOG_HINT}")),
        _ => {
            let message = e.to_string();
            // SQLite identifiers are case-insensitive, including the spelling
            // repeated by a missing-view diagnostic.
            let folded = message.to_ascii_lowercase();
            if let Some(m) = schema.maintains.iter().find(|m|m.private.is_some() && folded.contains(&m.target.to_ascii_lowercase())) {
                ("E_MAINTAINED_COLUMN_PRIVATE", format!("{} is engine-maintained; read its parent column (guide maintains)",m.label()))
            } else { ("E_INPUT", format!("SQL: {e}")) }
        },
    }
        };
        // Prepare the original as well: WITH … UPDATE must hit the authorizer
        // before wrapping, rather than surfacing as a generic subquery syntax error.
        let original = conn.prepare(body).map_err(query_error)?;
        if !original.readonly() {
            return Err(("E_SQL_READ_ONLY", "sql accepts only a SELECT".into()));
        }
        if object_rows {
            let mut names = BTreeSet::new();
            if original
                .column_names()
                .iter()
                .any(|name| !names.insert(name.to_ascii_lowercase()))
            {
                return Err((
                    "E_INPUT",
                    "--json-objects needs unique output names; alias duplicate columns".into(),
                ));
            }
        }
        drop(original);
        let wrapped = format!("SELECT * FROM (\n{body}\n) LIMIT {}", u64::from(limit) + 1);
        let mut query = conn.prepare(&wrapped).map_err(query_error)?;
        let columns = query
            .column_names()
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let booleans = if object_rows {
            let mut names = BTreeSet::new();
            if columns
                .iter()
                .any(|name| !names.insert(name.to_ascii_lowercase()))
            {
                return Err((
                    "E_INPUT",
                    "--json-objects needs unique output names; alias duplicate columns".into(),
                ));
            }
            booleans(columns.len())?
        } else {
            vec![false; columns.len()]
        };
        let mut cursor = query.query([]).map_err(query_error)?;
        let mut rows = Vec::new();
        while let Some(row) = cursor.next().map_err(query_error)? {
            let mut values = Vec::new();
            for (i, _) in columns.iter().enumerate() {
                values.push(match row.get_ref(i).map_err(query_error)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(value) if booleans[i] => json!(value != 0),
                    ValueRef::Integer(value) => json!(value),
                    ValueRef::Real(value) => json!(value),
                    ValueRef::Text(value) => json!(String::from_utf8_lossy(value)),
                    ValueRef::Blob(value) => {
                        json!(value.iter().map(|b| format!("{b:02x}")).collect::<String>())
                    }
                });
            }
            rows.push(values);
        }
        let more = rows.len() > limit as usize;
        if more {
            rows.pop();
        }
        Ok(InspectionRows {
            columns,
            rows,
            more,
        })
    }
}
fn store_error(error: rusqlite::Error) -> (&'static str, String) {
    ("E_STORE", error.to_string())
}
fn ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
fn literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
fn internal(name: &str) -> bool {
    name.starts_with('_')
        || matches!(name.to_ascii_lowercase().as_str(), "r" | "i")
        || name.to_ascii_lowercase().starts_with("sqlite_")
}

struct Catalog<'a>(&'a Connection);
impl InspectionCatalog for Catalog<'_> {
    fn active_schema_record(&self) -> Result<(i64, String)> {
        let conn = self.0;
        let (generation, encoded): (i64, String) = conn.query_row(
        "SELECT generation, schema FROM _generations WHERE generation = (SELECT value FROM _meta WHERE key = 'generation')",
        [], |row| Ok((row.get(0)?, row.get(1)?))).map_err(store_error)?;
        Ok((generation, encoded))
    }
    fn inspection_row_count(&self, name: &str, limit: u64) -> Result<u64> {
        let conn = self.0;
        conn.query_row("SELECT count(*) FROM (SELECT 1 FROM r WHERE t = (SELECT num FROM _catalog WHERE name = ?1) LIMIT ?2)",
        rusqlite::params![name, limit as i64], |r| r.get::<_, i64>(0)).map(|n| n as u64).map_err(store_error)
    }
    fn inspection_provenance(&self) -> Result<Option<(i64, String)>> {
        let conn = self.0;
        let encoded: Option<(i64, String)> = conn.query_row(
        "SELECT CAST(g.value AS INTEGER), p.value FROM _meta g JOIN _meta p ON p.key = ?1 WHERE g.key = 'generation'",
        [crate::schema::inspection::META_KEY], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(store_error)?;
        Ok(encoded)
    }
    fn inspection_adopted(&self) -> Result<bool> {
        let conn = self.0;
        conn.query_row("SELECT EXISTS(SELECT 1 FROM _generations WHERE generation = (SELECT value FROM _meta WHERE key = 'generation'))", [], |row| row.get(0)).map_err(store_error)
    }
}
macro_rules! catalog_access {
    ($ty:ty, $field:ident) => {
        impl InspectionCatalog for $ty {
            fn active_schema_record(&self) -> Result<(i64, String)> {
                Catalog(&self.$field).active_schema_record()
            }
            fn inspection_row_count(&self, name: &str, limit: u64) -> Result<u64> {
                Catalog(&self.$field).inspection_row_count(name, limit)
            }
            fn inspection_provenance(&self) -> Result<Option<(i64, String)>> {
                Catalog(&self.$field).inspection_provenance()
            }
            fn inspection_adopted(&self) -> Result<bool> {
                Catalog(&self.$field).inspection_adopted()
            }
        }
    };
}
catalog_access!(Inspection, conn);
catalog_access!(Store, conn);
catalog_access!(Tx<'_>, tx);

// P1: work inspection uses the Postgres read-only role.
use crate::inspection::WorkRecordKind;
use serde_json::Value as Json;
impl Inspection {
    /// Retain the URI connection for the whole stopped-release inspection.
    pub fn open_uri(uri: &str) -> Result<Self> {
        let conn = Connection::open_with_flags(
            uri,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(store_error)?;
        Ok(Self {
            conn,
            denied: Arc::new(AtomicU8::new(0)),
        })
    }
    pub fn optional_release(&self) -> Result<Option<String>> {
        self.conn
            .query_row("SELECT value FROM _meta WHERE key='release'", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(store_error)
    }
    pub fn required_release(&self) -> Result<String> {
        self.conn
            .query_row("SELECT value FROM _meta WHERE key = 'release'", [], |row| {
                row.get(0)
            })
            .map_err(store_error)
    }
    pub fn witness_generation(&self) -> Result<(i64, String, String, String)> {
        self.conn.query_row("SELECT generation, schema, programs, (SELECT value FROM _meta WHERE key='store_id') FROM _generations WHERE generation=(SELECT value FROM _meta WHERE key='generation')",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(store_error)
    }
    pub fn work_commit(
        &self,
        seq: Option<i64>,
    ) -> std::result::Result<Option<(String, String, i64)>, String> {
        self.conn
            .query_row(
                "SELECT program, principal, at FROM _commits WHERE seq = ?1",
                [seq],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())
    }
    // Read optional columns by name so even a never-upgraded legacy store is inspectable.
    pub fn work_records(
        &self,
        kind: WorkRecordKind,
        id: &str,
    ) -> std::result::Result<Vec<Json>, String> {
        self.work_records_raw(kind, id).map_err(|e| e.to_string())
    }
    fn work_records_raw(&self, kind: WorkRecordKind, id: &str) -> rusqlite::Result<Vec<Json>> {
        let conn = &self.conn;
        let (table, key) = match kind {
            WorkRecordKind::Action => ("_requests", "id"),
            WorkRecordKind::Mutation => ("_ops", "id"),
            WorkRecordKind::Effect => ("_outbox", "id"),
            WorkRecordKind::ActionStep => ("_action_steps", "invocation"),
        };
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [table],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(Vec::new());
        }
        let mut query = conn.prepare(&format!("SELECT * FROM {table} WHERE {key} = ?1"))?;
        let columns: Vec<String> = query.column_names().iter().map(|s| s.to_string()).collect();
        query
            .query_map([id], |row| {
                let mut fields = serde_json::Map::new();
                for (i, name) in columns.iter().enumerate() {
                    let value = match row.get_ref(i)? {
                        rusqlite::types::ValueRef::Integer(n) => json!(n),
                        rusqlite::types::ValueRef::Text(s) => json!(String::from_utf8_lossy(s)),
                        _ => Json::Null,
                    };
                    fields.insert(name.clone(), value);
                }
                Ok(Json::Object(fields))
            })?
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog_case(reader: &impl InspectionCatalog) {
        assert_eq!(reader.active_schema_record().unwrap(), (7, "{}".into()));
        assert!(reader.inspection_adopted().unwrap());
        assert_eq!(reader.inspection_row_count("probe", 1).unwrap(), 1);
        assert_eq!(reader.inspection_row_count("probe", 10).unwrap(), 2);
        assert_eq!(reader.inspection_row_count("absent", 10).unwrap(), 0);
        assert_eq!(
            reader.inspection_provenance().unwrap(),
            Some((7, "provenance bytes".into()))
        );
    }

    #[test]
    fn catalog_contract_on_store_transaction_and_read_only_snapshot() {
        let store = Store::memory().unwrap();
        store
            .conn
            .execute_batch(
                "INSERT OR REPLACE INTO _meta VALUES('generation','7');
            INSERT INTO _generations VALUES(7,'{}','{}',0);
            INSERT INTO _catalog VALUES('probe',91);
            INSERT INTO r VALUES(91,'a','{}'),(91,'b','{}');",
            )
            .unwrap();
        store
            .conn
            .execute(
                "INSERT OR REPLACE INTO _meta VALUES(?1,'provenance bytes')",
                [crate::schema::inspection::META_KEY],
            )
            .unwrap();
        catalog_case(&store);
        let path = std::env::temp_dir().join(format!(
            "sb4-inspection-contract-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        store.snapshot_to(&path).unwrap();
        let mut persisted = Store::open_read_only(&path).unwrap();
        let tx = persisted.read_transaction().unwrap();
        catalog_case(&tx);
        tx.rollback().unwrap();
        drop(persisted);
        let inspection = Inspection::open(&path).unwrap();
        inspection.begin_snapshot().unwrap();
        catalog_case(&inspection);
        assert!(inspection.conn.execute("DELETE FROM r", []).is_err());
        drop(inspection);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn generated_query_authorizer_and_limits() {
        let inspection = Inspection {
            conn: Connection::open_in_memory().unwrap(),
            denied: Arc::new(AtomicU8::new(0)),
        };
        inspection
            .conn
            .execute_batch("CREATE TABLE r(t INTEGER); INSERT INTO r VALUES(1);")
            .unwrap();
        let schema = Schema::default();
        inspection.build_views(&schema, |_| {}).unwrap();
        let rows = inspection
            .query(
                "SELECT 1 AS n UNION ALL SELECT 2",
                &schema,
                1,
                false,
                |_| unreachable!(),
            )
            .unwrap();
        assert_eq!(rows.columns, ["n"]);
        assert_eq!(rows.rows, [vec![json!(1)]]);
        assert!(rows.more);
        for (body, code) in [
            (
                "WITH spoof AS (SELECT * FROM r) SELECT * FROM spoof",
                "E_SQL_INTERNAL",
            ),
            ("WITH x AS (SELECT 1) DELETE FROM r", "E_SQL_READ_ONLY"),
        ] {
            let error = inspection
                .query(body, &schema, 1, false, |_| unreachable!())
                .err()
                .unwrap();
            assert_eq!(error.0, code);
        }
    }
}

const STATE: &str = "_snapback_state";
const SOURCE: &str = "_snapback_source";
const COLUMNS: &str = "_snapback_columns";
fn scalar_tag(kind: &ColumnType) -> &'static str {
    match kind.required() {
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => ".Id",
        ColumnType::Text { .. } | ColumnType::Enum { .. } => ".String",
        ColumnType::Int
        | ColumnType::IntRange { .. }
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => ".Int",
        ColumnType::Bool => ".Bool",
        ColumnType::Bytes { .. } => ".Bytes",
        _ => "",
    }
}

#[derive(serde::Deserialize)]
struct RetainedColumn {
    kind: ColumnType,
    default: Option<ColumnDefault>,
    authoritative: bool,
}

impl Inspection {
    pub fn retained_schema(&self, mut schema: Schema) -> Result<Schema> {
        let conn = &self.conn;
        let mut historical = BTreeMap::<String, Table>::new();
        let mut statement=conn.prepare("SELECT table_name,definition FROM _dormant_tables UNION SELECT c.name,n.definition FROM _dormant_narrow_rows n JOIN _catalog c ON c.num=n.t ORDER BY 1").map_err(store_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(store_error)?;
        for row in rows {
            let (name, definition) = row.map_err(store_error)?;
            let table: Table =
                serde_json::from_str(&definition).map_err(|e| ("E_SCHEMA", e.to_string()))?;
            historical.entry(name).or_insert(table);
        }
        for (name, old) in historical {
            if let Some(table) = schema.tables.get_mut(&name) {
                for (column, kind) in &old.columns {
                    if !old.engine_field(column) {
                        table.columns.entry(column.clone()).or_insert(kind.clone());
                        if let Some(default) = old.defaults.get(column) {
                            table
                                .defaults
                                .entry(column.clone())
                                .or_insert(default.clone());
                        }
                    }
                }
            } else {
                schema.tables.insert(name, old);
            }
        }
        let mut statement=conn.prepare("SELECT table_name,column_name,definition FROM _dormant_columns ORDER BY table_name,column_name").map_err(store_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(store_error)?;
        for row in rows {
            let (table, column, definition) = row.map_err(store_error)?;
            let retained: RetainedColumn =
                serde_json::from_str(&definition).map_err(|e| ("E_SCHEMA", e.to_string()))?;
            if !retained.authoritative {
                continue;
            }
            if let Some(target) = schema.tables.get_mut(&table) {
                target
                    .columns
                    .entry(column.clone())
                    .or_insert(retained.kind);
                if let Some(default) = retained.default {
                    target.defaults.entry(column).or_insert(default);
                }
            }
        }
        Ok(schema)
    }
}
