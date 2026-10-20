//! SQLite read-only inspection connection and generated application views.
// @ref LLP 3000.009.001.000#32-the-rule — inspection SQL stays inside the adapter.
use super::{Store, Tx};
use crate::inspection::{CATALOG_HINT, InspectionCatalog, InspectionResult as Result, PRIVATE};
use crate::schema::{ColumnDefault, ColumnType, Schema};
use rusqlite::{
    Connection, OpenFlags, OptionalExtension,
    hooks::{AuthAction, AuthContext, Authorization},
    types::ValueRef,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
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
    pub fn build_views(&self, schema: &Schema, mut ephemeral: impl FnMut(&str)) -> Result<()> {
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
            let number: i64 = conn
                .query_row("SELECT num FROM _catalog WHERE name = ?1", [name], |row| {
                    row.get(0)
                })
                .map_err(store_error)?;
            let private = format!("{PRIVATE}{number}");
            let mut columns = vec!["id".to_owned()];
            for (column, kind) in &table.columns {
                if column == "id" {
                    continue;
                }
                let tag = match kind.required() {
                    ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => ".Id",
                    ColumnType::Text { .. } | ColumnType::Enum { .. } => ".String",
                    ColumnType::Int
                    | ColumnType::IntRange { .. }
                    | ColumnType::Time
                    | ColumnType::Decimal { .. }
                    | ColumnType::Money { .. } => ".Int",
                    ColumnType::Bool => ".Bool",
                    ColumnType::Bytes { .. } => ".Bytes",
                    _ => "", // Compound values remain canonical tagged JSON, as stored.
                };
                let path = format!("$.Row.{}{tag}", ident(column));
                let mut value = format!("json_extract(data, {})", literal(&path));
                if table.maintained.contains_key(column) {
                    value = format!("coalesce({value}, 0)");
                }
                // @ref LLP 3000.007#18.3 — inspection projects required literal defaults, while optional absence remains SQL null.
                if !kind.is_optional()
                    && let Some(ColumnDefault::Literal(default)) = table.defaults.get(column)
                {
                    let default = format!(
                        "json_extract({}, {})",
                        literal(&crate::value::canonical_json(default)),
                        literal(&format!("${tag}"))
                    );
                    let field = literal(&format!("$.Row.{}", ident(column)));
                    value = format!(
                        "CASE WHEN json_type(data, {field}) IS NULL THEN {default} ELSE {value} END"
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
            // The private backing name cannot occur in submitted SQL. A public
            // view alone is unsafe: a WITH of the same name spoofs its authorizer
            // accessor when reading r. This extra view makes that context unforgeable.
            conn.execute_batch(&format!("CREATE TEMP VIEW {} AS SELECT {} FROM main.r WHERE t = {number}; CREATE TEMP VIEW {} AS SELECT * FROM temp.{};", ident(&private), columns.join(", "), ident(name), ident(&private))).map_err(store_error)?;
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
                    if context.database_name == Some("main") && name == "r" && private_context {
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
            for i in 0..columns.len() {
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
