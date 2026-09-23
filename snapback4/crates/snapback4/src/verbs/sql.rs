//! Developer inspection, attached to the persisted generation, without an engine writer.

use super::{Options, project_or_exit};
use rusqlite::{Connection, OpenFlags, hooks::{AuthAction, AuthContext, Authorization}, types::ValueRef};
use serde_json::{Value, json};
use snapback4_core::schema::{ColumnDefault, ColumnType, Schema};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, atomic::{AtomicU8, Ordering}};

type Result<T> = std::result::Result<T, (&'static str, String)>;
const PRIVATE: &str = "_snapback_sql_";

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
    let [statement] = options.positionals.as_slice() else { return Err(("E_INPUT", "usage: snapback4 sql '<SELECT …>' [--release dir] [--limit N] [--json]".into())); };
    let body = select_body(statement)?;
    let limit = match options.flags.get("limit") {
        None => 200,
        Some(value) => value.parse::<u32>().ok().filter(|n| *n > 0).ok_or(("E_INPUT", "--limit must be a positive 32-bit integer".into()))?,
    };
    let path = match options.flags.get("release") {
        Some(dir) => Path::new(dir).join("store.sqlite"),
        None => project_or_exit().store_path(),
    };
    // @ref LLP 3000.007#8 — developer SQL is read-only, never rule-filtered
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(store_error)?;
    conn.execute_batch("BEGIN DEFERRED").map_err(store_error)?;
    // Catalog, compiled columns and rows all belong to the same WAL snapshot.
    let encoded: String = conn.query_row("SELECT schema FROM _generations WHERE generation = (SELECT value FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).map_err(store_error)?;
    let schema: Schema = serde_json::from_str(&encoded).map_err(|e| ("E_SCHEMA", e.to_string()))?;
    let mut views = BTreeSet::new();
    let mut backing = BTreeSet::new();
    for (name, table) in schema.visible_tables() {
        if internal(name) { continue; }
        let number: i64 = conn.query_row("SELECT num FROM _catalog WHERE name = ?1", [name], |row| row.get(0)).map_err(store_error)?;
        let private = format!("{PRIVATE}{number}");
        let mut columns = vec!["id".to_owned()];
        for (column, kind) in &table.columns {
            if column == "id" { continue; }
            let tag = match kind.required() {
                ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => ".Id",
                ColumnType::Text { .. } | ColumnType::Enum { .. } => ".String",
                ColumnType::Int | ColumnType::Time | ColumnType::Decimal { .. } | ColumnType::Money { .. } => ".Int",
                ColumnType::Bool => ".Bool",
                ColumnType::Bytes { .. } => ".Bytes",
                _ => "", // Compound values remain canonical tagged JSON, as stored.
            };
            let path = format!("$.Row.{}{tag}", ident(column));
            let mut value = format!("json_extract(data, {})", literal(&path));
            if table.maintained.contains_key(column) { value = format!("coalesce({value}, 0)"); }
            // @ref LLP 3000.007#18.3 — inspection projects required literal defaults, while optional absence remains SQL null.
            if !kind.is_optional() && let Some(ColumnDefault::Literal(default)) = table.defaults.get(column) {
                let default = format!("json_extract({}, {})", literal(&snapback4_core::value::canonical_json(default)), literal(&format!("${tag}")));
                let field = literal(&format!("$.Row.{}", ident(column)));
                value = format!("CASE WHEN json_type(data, {field}) IS NULL THEN {default} ELSE {value} END");
            }
            columns.push(format!("{} AS {}", if tag.is_empty() { format!("nullif({value}, 'Null')") } else { value }, ident(column)));
        }
        // The private backing name cannot occur in submitted SQL. A public
        // view alone is unsafe: a WITH of the same name spoofs its authorizer
        // accessor when reading r. This extra view makes that context unforgeable.
        conn.execute_batch(&format!("CREATE TEMP VIEW {} AS SELECT {} FROM main.r WHERE t = {number}; CREATE TEMP VIEW {} AS SELECT * FROM temp.{};", ident(&private), columns.join(", "), ident(name), ident(&private))).map_err(store_error)?;
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
                if context.database_name == Some("main") && name == "r" && private_context { return Authorization::Allow; }
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
        2 => ("E_SQL_INTERNAL", "sql reads application views only; internal tables, r, i and SQLite metadata are refused".into()),
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
    drop(original);
    let wrapped = format!("SELECT * FROM (\n{body}\n) LIMIT {}", u64::from(limit) + 1);
    let mut query = conn.prepare(&wrapped).map_err(query_error)?;
    let columns = query.column_names().into_iter().map(str::to_owned).collect::<Vec<_>>();
    let mut cursor = query.query([]).map_err(query_error)?;
    let mut rows = Vec::new();
    while let Some(row) = cursor.next().map_err(query_error)? {
        let mut values = Vec::new();
        for i in 0..columns.len() {
            values.push(match row.get_ref(i).map_err(query_error)? {
                ValueRef::Null => Value::Null,
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
    let header = format!("sql: developer's own store {} — read-only, not rule-filtered", path.display());
    if options.json {
        println!("{}", json!({ "header": header, "columns": columns, "rows": rows, "limit": limit, "more": more, "ruleFiltered": false }));
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

/// Strip SQL comments without disturbing quotes, and permit a single trailing
/// terminator. SQLite still parses and authorizes the actual statement.
fn select_body(sql: &str) -> Result<String> {
    if sql.to_ascii_lowercase().contains(PRIVATE) { return Err(("E_SQL_INTERNAL", "private inspection views cannot be named in SQL".into())); }
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
