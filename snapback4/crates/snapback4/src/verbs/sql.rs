//! Developer inspection, attached to the persisted generation, without an engine writer.

use super::{Options, project_or_exit};
use rusqlite::{Connection, OpenFlags, hooks::{AuthAction, AuthContext, Authorization}, types::ValueRef};
use serde_json::{Value, json};
use snapback4_core::schema::{ColumnDefault, ColumnType, Schema, Table};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::{Arc, atomic::{AtomicU8, Ordering}};

type Result<T> = std::result::Result<T, (&'static str, String)>;
const PRIVATE: &str = "_snapback_sql_";
const CATALOG_HINT: &str = "`\\dt` lists tables; `\\d messages` describes one";
const STATE: &str = "_snapback_state";
const SOURCE: &str = "_snapback_source";
const COLUMNS: &str = "_snapback_columns";
#[path = "sql_catalog.rs"]
mod catalog;
#[path = "sql_objects.rs"]
mod objects;

pub fn sql(options: &Options) -> i32 {
    match inspect(options) {
        Ok(()) => 0,
        Err((code, message)) => {
            if options.json { println!("{}", json!({ "denied": { "code": code, "message": message } })); }
            else { eprintln!("{code}: {message}"); }
            1
        }
    }
}

fn inspect(options: &Options) -> Result<()> {
    let [statement] = options.positionals.as_slice() else { return Err(("E_INPUT", format!("usage: {}; {CATALOG_HINT}", crate::cli_flags::synopsis("sql")))); };
    if let Some(flag) = misplaced_flag(statement) {
        return Err(("E_INPUT", format!("{flag} is inside the SQL argument; put CLI options after its closing quote: snapback4 sql 'SELECT …' {flag}{}", if flag == "--release" { " <dir>" } else if flag == "--limit" { " N" } else { "" })));
    }
    let command = catalog::command(statement)?;
    let body = if command.is_none() { select_body(statement)? } else { String::new() };
    let limit = match options.flags.get("limit") {
        None => 200,
        Some(value) => value.parse::<u32>().ok().filter(|n| *n > 0).ok_or(("E_INPUT", "--limit must be a positive 32-bit integer".into()))?,
    };
    let dormant = options.flags.contains_key("dormant");
    let all_releases = options.flags.contains_key("all-releases");
    if dormant && all_releases { return Err(("E_INPUT", "sql takes either --dormant or --all-releases, not both".into())); }
    if (dormant || all_releases) && !options.flags.contains_key("release") {
        return Err(("E_INPUT", "sql --dormant and --all-releases require an explicit --release <dir> deployment".into()));
    }
    let path = match options.flags.get("release") {
        Some(dir) => Path::new(dir).join("store.sqlite"),
        None => project_or_exit().store_path(),
    };
    // @ref LLP 3000.007#8 — developer SQL is read-only, never rule-filtered
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|error| {
        let (code, message) = store_error(error);
        (code, format!("{message}{}", store_hint(&path, options)))
    })?;
    conn.execute_batch("BEGIN DEFERRED").map_err(store_error)?;
    // Catalog, compiled columns and rows all belong to the same WAL snapshot.
    let (generation, active_schema) = catalog::active_schema(&conn)?;
    let schema = if dormant || all_releases { retained_schema(&conn, active_schema)? } else { active_schema };
    let mode = if dormant { "dormant retained records" } else if all_releases { "active and retained records" } else { "active records" };
    let header = format!("sql: developer's own store {} — {mode}; read-only, not rule-filtered", path.display());
    if let Some(command) = command {
        let result = catalog::inspect(&conn, &schema, command)?;
        if options.json {
            println!("{}", json!({ "header": header, "generation": generation, "tables": result, "ruleFiltered": false }));
        } else {
            eprintln!("{header}");
            catalog::print(&result, generation);
        }
        return Ok(());
    }
    let mut views = BTreeSet::new();
    let mut backing = BTreeSet::new();
    for (name, table) in schema.visible_tables() {
        if table.ephemeral.is_some() {
            eprintln!("sql: skipping {name}: ephemeral rows live only in the serving process's memory");
            continue;
        }
        if internal(name) { continue; }
        if (dormant || all_releases) && table.columns.keys().any(|column| matches!(column.as_str(), STATE | SOURCE | COLUMNS)) {
            return Err(("E_SQL_INTERNAL", format!("{name} declares {STATE}, {SOURCE} or {COLUMNS}; retained inspection reserves those result columns")));
        }
        let number: i64 = conn.query_row("SELECT num FROM _catalog WHERE name = ?1", [name], |row| row.get(0)).map_err(store_error)?;
        let private = format!("{PRIVATE}{number}");
        let projected = |data: &str, defaults: bool| {
            let mut columns = vec!["id".to_owned()];
            for (column, kind) in &table.columns {
                if column == "id" { continue; }
                let tag = scalar_tag(kind);
                let path = format!("$.Row.{}{tag}", ident(column));
                let mut value = format!("json_extract({data}, {})", literal(&path));
                if table.maintained.contains_key(column) { value = format!("coalesce({value}, 0)"); }
                // @ref LLP 3000.007#18.3 — inspection projects required literal defaults, while optional absence remains SQL null.
                if defaults && !kind.is_optional() && let Some(ColumnDefault::Literal(default)) = table.defaults.get(column) {
                    let default = format!("json_extract({}, {})", literal(&snapback4_core::value::canonical_json(default)), literal(&format!("${tag}")));
                    let field = literal(&format!("$.Row.{}", ident(column)));
                    value = format!("CASE WHEN json_type({data}, {field}) IS NULL THEN {default} ELSE {value} END");
                }
                columns.push(format!("{} AS {}", if tag.is_empty() { format!("nullif({value}, 'Null')") } else { value }, ident(column)));
            }
            columns
        };
        let columns = projected("data", true);
        let provided = |data:&str| {
            let values=table.columns.keys().filter(|column|column.as_str()!="id" && !table.engine_field(column)).map(|column|format!("CASE WHEN json_type({data},{}) IS NOT NULL THEN {} ELSE '' END",literal(&format!("$.Row.{}",ident(column))),literal(&format!("{},",serde_json::to_string(column).unwrap())))).collect::<Vec<_>>();
            if values.is_empty() {"'[]'".to_owned()} else {format!("'[' || rtrim({}, ',') || ']'",values.join(" || "))}
        };
        let mut source_views=String::new();
        let backing_sql = if dormant || all_releases {
            let active_view=format!("{private}_active");
            let table_view=format!("{private}_table");
            let narrowed_view=format!("{private}_narrowed");
            let cells_view=format!("{private}_cells");
            source_views=format!("CREATE TEMP VIEW {} AS SELECT id,data FROM main.r WHERE t={number}; CREATE TEMP VIEW {} AS SELECT id,data FROM main._dormant_rows WHERE t={number}; CREATE TEMP VIEW {} AS SELECT id,data FROM main._dormant_narrow_rows WHERE t={number}; CREATE TEMP VIEW {} AS SELECT t,id,column_name,data FROM main._dormant_values WHERE t={number};",ident(&active_view),ident(&table_view),ident(&narrowed_view),ident(&cells_view));
            backing.extend([active_view.clone(),table_view.clone(),narrowed_view.clone(),cells_view.clone()]);
            let mut parts=Vec::new();
            if all_releases {parts.push(format!("SELECT {},'active' AS {STATE},NULL AS {SOURCE},{} AS {COLUMNS} FROM temp.{} a",projected("a.data",true).join(", "),provided("a.data"),ident(&active_view)));}
            parts.push(format!("SELECT {},'dormant-row' AS {STATE},'table' AS {SOURCE},{} AS {COLUMNS} FROM temp.{} d",projected("d.data",false).join(", "),provided("d.data"),ident(&table_view)));
            parts.push(format!("SELECT {},'dormant-row' AS {STATE},'narrowed' AS {SOURCE},{} AS {COLUMNS} FROM temp.{} d",projected("d.data",false).join(", "),provided("d.data"),ident(&narrowed_view)));
            let mut cells=vec!["x.id AS id".to_owned()];
            for (column,kind) in &table.columns {
                if column=="id" {continue;}
                let tag=scalar_tag(kind);
                let value=format!("(SELECT json_extract(v.data,{}) FROM temp.{} v WHERE v.id=x.id AND v.column_name={})",literal(&format!("${tag}")),ident(&cells_view),literal(column));
                cells.push(format!("{} AS {}",if tag.is_empty(){format!("nullif({value}, 'Null')")}else{value},ident(column)));
            }
            let cell_columns=format!("(SELECT json_group_array(column_name) FROM (SELECT column_name FROM temp.{} v WHERE v.id=x.id ORDER BY column_name))",ident(&cells_view));
            parts.push(format!("SELECT {},'dormant-cell' AS {STATE},'column' AS {SOURCE},{cell_columns} AS {COLUMNS} FROM (SELECT DISTINCT id FROM temp.{}) x",cells.join(", "),ident(&cells_view)));
            parts.join(" UNION ALL ")
        } else {format!("SELECT {} FROM main.r WHERE t = {number}",columns.join(", "))};
        // The private backing name cannot occur in submitted SQL. A public
        // view alone is unsafe: a WITH of the same name spoofs its authorizer
        // accessor when reading r. This extra view makes that context unforgeable.
        conn.execute_batch(&format!("{source_views} CREATE TEMP VIEW {} AS {backing_sql}; CREATE TEMP VIEW {} AS SELECT * FROM temp.{};", ident(&private), ident(name), ident(&private))).map_err(store_error)?;
        views.insert(name.to_ascii_lowercase());
        backing.insert(private);
    }
    let denied = Arc::new(AtomicU8::new(0));
    let reason = denied.clone();
    conn.authorizer(Some(move |context: AuthContext<'_>| {
        let code = match context.action {
            AuthAction::Select | AuthAction::Recursive => return Authorization::Allow,
            AuthAction::Function { function_name } if !["load_extension", "writefile", "readfile", "eval"].contains(&function_name.to_ascii_lowercase().as_str()) => return Authorization::Allow,
            AuthAction::Read { table_name, .. } => {
                let name = table_name.to_ascii_lowercase();
                let private_context = context.accessor.is_some_and(|name| backing.contains(name));
                if context.database_name == Some("main") && private_context && matches!(name.as_str(), "r" | "_dormant_rows" | "_dormant_narrow_rows" | "_dormant_values") { return Authorization::Allow; }
                if context.database_name == Some("temp") && (views.contains(&name) || backing.contains(&name)) { return Authorization::Allow; }
                2
            }
            _ => 1,
        };
        reason.store(code, Ordering::Relaxed);
        Authorization::Deny
    })).map_err(store_error)?;
    let query_error = |e: rusqlite::Error| match denied.load(Ordering::Relaxed) {
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
    };
    // Prepare the original as well: WITH … UPDATE must hit the authorizer
    // before wrapping, rather than surfacing as a generic subquery syntax error.
    let original = conn.prepare(&body).map_err(query_error)?;
    if !original.readonly() { return Err(("E_SQL_READ_ONLY", "sql accepts only a SELECT".into())); }
    if options.flags.contains_key("json-objects") {
        let mut names = BTreeSet::new();
        if original.column_names().iter().any(|name| !names.insert(name.to_ascii_lowercase())) {
            return Err(("E_INPUT", "--json-objects needs unique output names; alias duplicate columns".into()));
        }
    }
    drop(original);
    let wrapped = format!("SELECT * FROM (\n{body}\n) LIMIT {}", u64::from(limit) + 1);
    let mut query = conn.prepare(&wrapped).map_err(query_error)?;
    let columns = query.column_names().into_iter().map(str::to_owned).collect::<Vec<_>>();
    let object_rows = options.flags.contains_key("json-objects");
    let booleans = if object_rows {
        let mut names = BTreeSet::new();
        if columns.iter().any(|name| !names.insert(name.to_ascii_lowercase())) {
            return Err(("E_INPUT", "--json-objects needs unique output names; alias duplicate columns".into()));
        }
        objects::booleans(&body, &schema, columns.len(), dormant || all_releases).map_err(|e| ("E_INPUT", e))?
    } else { vec![false; columns.len()] };
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
                ValueRef::Blob(value) => json!(value.iter().map(|b| format!("{b:02x}")).collect::<String>()),
            });
        }
        rows.push(values);
    }
    let more = rows.len() > limit as usize;
    if more { rows.pop(); }
    if options.json {
        let rows = if object_rows {
            Value::Array(rows.into_iter().map(|values| Value::Object(columns.iter().cloned().zip(values).collect())).collect())
        } else { json!(rows) };
        println!("{}", json!({ "header": header, "columns": columns, "rows": rows, "limit": limit, "more": more, "ruleFiltered": false, "inspection": mode }));
    } else {
        eprintln!("{header}");
        let cells: Vec<Vec<String>> = rows.iter().map(|row| row.iter().map(|v| match v { Value::String(s) => s.escape_debug().to_string(), _ => v.to_string() }).collect()).collect();
        let widths: Vec<usize> = columns.iter().enumerate().map(|(i, name)| cells.iter().map(|row| row[i].chars().count()).chain([name.chars().count()]).max().unwrap()).collect();
        let line = |cells: &[String]| cells.iter().zip(&widths).map(|(cell, width)| format!("{cell}{}", " ".repeat(width.saturating_sub(cell.chars().count())))).collect::<Vec<_>>().join(" | ");
        println!("{}", line(&columns));
        println!("{}", widths.iter().map(|n| "-".repeat(*n)).collect::<Vec<_>>().join("-+-"));
        for row in &cells { println!("{}", line(row)); }
        eprintln!("{} row(s){}", rows.len(), if more { " — more rows exist; increase --limit or refine the SELECT" } else { "" });
    }
    Ok(())
}

fn store_error(error: rusqlite::Error) -> (&'static str, String) { ("E_STORE", error.to_string()) }
fn ident(name: &str) -> String { format!("\"{}\"", name.replace('"', "\"\"")) }
fn literal(value: &str) -> String { format!("'{}'", value.replace('\'', "''")) }
fn internal(name: &str) -> bool { name.starts_with('_') || matches!(name.to_ascii_lowercase().as_str(), "r" | "i") || name.to_ascii_lowercase().starts_with("sqlite_") }

fn scalar_tag(kind: &ColumnType) -> &'static str {
    match kind.required() {
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => ".Id",
        ColumnType::Text { .. } | ColumnType::Enum { .. } => ".String",
        ColumnType::Int | ColumnType::IntRange { .. } | ColumnType::Time | ColumnType::Decimal { .. } | ColumnType::Money { .. } => ".Int",
        ColumnType::Bool => ".Bool",
        ColumnType::Bytes { .. } => ".Bytes",
        _ => "",
    }
}

#[derive(serde::Deserialize)]
struct RetainedColumn { kind: ColumnType, default: Option<ColumnDefault>, authoritative: bool }

fn retained_schema(conn:&Connection,mut schema:Schema)->Result<Schema> {
    let mut historical=BTreeMap::<String,Table>::new();
    let mut statement=conn.prepare("SELECT table_name,definition FROM _dormant_tables UNION SELECT c.name,n.definition FROM _dormant_narrow_rows n JOIN _catalog c ON c.num=n.t ORDER BY 1").map_err(store_error)?;
    let rows=statement.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(store_error)?;
    for row in rows {
        let (name,definition)=row.map_err(store_error)?;
        let table:Table=serde_json::from_str(&definition).map_err(|e|("E_SCHEMA",e.to_string()))?;
        historical.entry(name).or_insert(table);
    }
    for (name,old) in historical {
        if let Some(table)=schema.tables.get_mut(&name) {
            for (column,kind) in &old.columns {if !old.engine_field(column) {table.columns.entry(column.clone()).or_insert(kind.clone());if let Some(default)=old.defaults.get(column){table.defaults.entry(column.clone()).or_insert(default.clone());}}}
        } else {schema.tables.insert(name,old);}
    }
    let mut statement=conn.prepare("SELECT table_name,column_name,definition FROM _dormant_columns ORDER BY table_name,column_name").map_err(store_error)?;
    let rows=statement.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?))).map_err(store_error)?;
    for row in rows {
        let (table,column,definition)=row.map_err(store_error)?;
        let retained:RetainedColumn=serde_json::from_str(&definition).map_err(|e|("E_SCHEMA",e.to_string()))?;
        if !retained.authoritative {continue;}
        if let Some(target)=schema.tables.get_mut(&table) {target.columns.entry(column.clone()).or_insert(retained.kind);if let Some(default)=retained.default{target.defaults.entry(column).or_insert(default);}}
    }
    Ok(schema)
}

/// Population advice only for a newly declared/changed window, before adoption.
// @ref LLP 3000.007#8 — bounded catalog probes never adopt or acquire a writer lock.
pub(super) fn window_populations(path: &Path, candidate: &Schema) -> Result<Vec<(String, u32, u64)>> {
    if !candidate.visible_tables().any(|(_, table)| table.ephemeral.is_none() && table.sync.as_ref().is_some_and(|s| s.horizon.is_some())) { return Ok(Vec::new()); }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(store_error)?;
    conn.execute_batch("BEGIN DEFERRED").map_err(store_error)?;
    let adopted: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM _generations WHERE generation = (SELECT value FROM _meta WHERE key = 'generation'))", [], |row| row.get(0)).map_err(store_error)?;
    if !adopted { return Ok(Vec::new()); }
    let (_, active) = catalog::active_schema(&conn)?;
    let mut populations = Vec::new();
    for (name, table) in candidate.visible_tables() {
        let Some(sync) = &table.sync else { continue; };
        let Some(horizon) = &sync.horizon else { continue; };
        let Some(previous) = active.tables.get(name) else { continue; };
        if previous.sync == table.sync || table.ephemeral.is_some() { continue; }
        let threshold = u64::from(horizon.last) * 10;
        if threshold == 0 || threshold > catalog::COUNT_LIMIT { continue; }
        let count = catalog::row_count(&conn, name, threshold)?;
        if count == threshold { populations.push((name.clone(), horizon.last, count)); }
    }
    Ok(populations)
}

/// Strip SQL comments without disturbing quotes, and permit a single trailing
/// terminator. SQLite still parses and authorizes the actual statement.
fn select_body(sql: &str) -> Result<String> {
    if sql.to_ascii_lowercase().contains(PRIVATE) { return Err(("E_SQL_INTERNAL", format!("private inspection views cannot be named in SQL; {CATALOG_HINT}"))); }
    let mut chars = sql.chars().peekable();
    let mut body = String::new();
    let mut ended = false;
    while let Some(c) = chars.next() {
        if c == '-' && chars.peek() == Some(&'-') {
            for c in chars.by_ref() { if c == '\n' { break; } }
            body.push('\n');
        } else if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            while let Some(c) = chars.next() { if c == '*' && chars.peek() == Some(&'/') { chars.next(); break; } }
            body.push(' ');
        } else if c.is_whitespace() { body.push(c); }
        else if ended { return Err(("E_SQL_READ_ONLY", "sql accepts exactly one SELECT statement".into())); }
        else if c == ';' { ended = true; }
        else if matches!(c, '\'' | '"' | '`' | '[') {
            let end = if c == '[' { ']' } else { c };
            body.push(c);
            while let Some(c) = chars.next() {
                body.push(c);
                if c == end {
                    if end != ']' && chars.peek() == Some(&end) { body.push(chars.next().unwrap()); }
                    else { break; }
                }
            }
        } else { body.push(c); }
    }
    let first = body.trim_start().split(|c: char| !c.is_ascii_alphabetic()).next().unwrap_or_default();
    if !first.eq_ignore_ascii_case("select") && !first.eq_ignore_ascii_case("with") {
        return Err(("E_SQL_READ_ONLY", "sql accepts one SELECT or WITH … SELECT statement".into()));
    }
    Ok(body)
}

// A quoted SQL string may itself contain a CLI-looking value. Only flag tokens
// outside SQLite quotes are a misplaced option (including SQLite line comments).
fn misplaced_flag(statement: &str) -> Option<&'static str> {
    let mut chars = statement.char_indices().peekable();
    while let Some((offset, c)) = chars.next() {
        if matches!(c, '\'' | '"' | '`' | '[') {
            let end = if c == '[' { ']' } else { c };
            while let Some((_, c)) = chars.next() {
                if c == end {
                    if end != ']' && chars.peek().is_some_and(|(_, c)| *c == end) { chars.next(); }
                    else { break; }
                }
            }
        } else if c == '/' && chars.peek().is_some_and(|(_, c)| *c == '*') {
            chars.next();
            while let Some((_, c)) = chars.next() {
                if c == '*' && chars.peek().is_some_and(|(_, c)| *c == '/') { chars.next(); break; }
            }
        } else if c == '-' {
            for flag in ["--release", "--dormant", "--all-releases", "--limit", "--json-objects", "--json"] {
                if let Some(tail) = statement[offset..].strip_prefix(flag) {
                    if tail.is_empty() || tail.starts_with(char::is_whitespace) || tail.starts_with('=') { return Some(flag); }
                }
            }
        }
    }
    None
}

/// Missing development stores never imply that a neighbouring release is the
/// store to inspect. Name the explicit selection without opening or adopting it.
pub(super) fn store_hint(path: &Path, options: &Options) -> String {
    if options.flags.contains_key("release") || path.exists() { return String::new(); }
    let Some(root) = path.parent().and_then(Path::parent) else { return String::new(); };
    let mut dirs = Vec::new();
    if root.join("store.sqlite").is_file() { dirs.push(root.to_path_buf()); }
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.file_name() != ".snapback4" && entry.file_type().is_ok_and(|kind| kind.is_dir())
                && entry.path().join("store.sqlite").is_file() { dirs.push(entry.path()); }
        }
    }
    dirs.sort();
    if dirs.is_empty() { return String::new(); }
    format!("; no development store at {}. Deployment stores are present at {}; select one explicitly with --release <dir>",
        path.display(), dirs.iter().map(|dir| dir.display().to_string()).collect::<Vec<_>>().join(", "))
}
