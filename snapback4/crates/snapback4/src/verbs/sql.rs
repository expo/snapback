//! Developer inspection, attached to the persisted generation, without an engine writer.

use super::{Options, project_or_exit};
use snapback4_core::{inspection::{InspectionCatalog, PRIVATE, CATALOG_HINT, internal}, store_port::AnyInspection};
use serde_json::{Value, json};
use snapback4_core::schema::Schema;
use std::path::Path;

type Result<T> = std::result::Result<T, (&'static str, String)>;
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
    if crate::store_config::StoreConfig::resolve(options).map_err(|e| ("E_STORE_CONFIG", e))?.is_some() { return Err(("E_STORE_UNSUPPORTED", "inspection is outside the admitted store profile".into())); }
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
    let conn = AnyInspection::open(&path).map_err(|error| {
        let (code, message) = error;
        (code, format!("{message}{}", store_hint(&path, options)))
    })?;
    conn.begin_snapshot()?;
    // Catalog, compiled columns and rows all belong to the same WAL snapshot.
    let (generation, active_schema) = catalog::active_schema(&conn)?;
    let schema = if dormant || all_releases { conn.retained_schema(active_schema)? } else { active_schema };
    let retained = conn.dormant_inventory()?;
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
        if !dormant && !all_releases { dormant_notice(dormant_rows(&retained), "rerun SQL with --dormant and an explicit --release to inspect them"); }
        return Ok(());
    }
    conn.build_retained_views(&schema, dormant, all_releases, |name| eprintln!("sql: skipping {name}: ephemeral rows live only in the serving process's memory"))?;
    let object_rows = options.flags.contains_key("json-objects");
    let snapback4_core::store_port::InspectionRows { columns, rows, more } = conn.query(&body, limit, object_rows,
        |message| query_error(&schema, &retained, message),
        |columns| snapback4_core::inspection::check_output_names(columns, object_rows),
        |columns| objects::kinds(&body, &schema, columns, dormant || all_releases).map_err(|e| ("E_INPUT", e)))?;
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
    if options.json && more { eprintln!("sql: result truncated at {limit} rows; increase --limit or refine the SELECT"); }
    if !dormant && !all_releases { dormant_notice(dormant_rows(&retained), "rerun SQL with --dormant and an explicit --release to inspect them"); }
    Ok(())
}

pub(super) fn dormant_rows(items: &[snapback4_core::release_history::DormantItem]) -> u64 {
    items.iter().filter(|item| matches!(item.kind.as_str(), "table" | "rows")).map(|item| item.rows).sum()
}

pub(super) fn dormant_notice(rows: u64, advice: &str) {
    if rows > 0 {
        eprintln!("{rows} dormant {} retained; {advice}", if rows == 1 { "row" } else { "rows" });
    }
}

pub(super) fn retained_table_rows(items: &[snapback4_core::release_history::DormantItem], table: &str) -> u64 {
    items.iter().filter(|item| matches!(item.kind.as_str(), "table" | "rows") && item.path.eq_ignore_ascii_case(table)).map(|item| item.rows).sum()
}

fn query_error(schema: &Schema, retained: &[snapback4_core::release_history::DormantItem], message: String) -> (&'static str, String) {
    let missing = message.strip_prefix("no such table: ").map(str::trim);
    if let Some(table) = missing {
        let rows = retained_table_rows(retained, table.trim_matches(['`', '"', '\'']));
        if rows > 0 {
            return ("E_INPUT", format!("SQL: {message}; {rows} retained dormant {} exist for {table}; rerun with --dormant and an explicit --release", if rows == 1 { "row" } else { "rows" }));
        }
    }
    snapback4_core::inspection::query_error(schema, message)
}



/// Population advice only for a newly declared/changed window, before adoption.
// @ref LLP 3000.007#8 — bounded catalog probes never adopt or acquire a writer lock.
pub(super) fn window_populations(path: &Path, candidate: &Schema) -> Result<Vec<(String, u32, u64)>> {
    if !candidate.visible_tables().any(|(_, table)| table.ephemeral.is_none() && table.sync.as_ref().is_some_and(|s| s.horizon.is_some())) { return Ok(Vec::new()); }
    let conn = AnyInspection::open(path)?;
    conn.begin_snapshot()?;
    let adopted = conn.inspection_adopted()?;
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
