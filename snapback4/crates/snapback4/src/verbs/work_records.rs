//! Operator inspection, never an application result-collection endpoint.
use super::*;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use snapback4_core::store::{canonical_payload, payload_digest};

pub(super) fn store_path(options: &Options) -> std::path::PathBuf {
    options.flags.get("release").map(|dir| Path::new(dir).join("store.sqlite"))
        .unwrap_or_else(|| project_or_exit().store_path())
}

pub(super) fn project(options: &Options) -> Result<Project, String> {
    let Some(dir) = options.flags.get("release") else { return Ok(project_or_exit()); };
    let conn = Connection::open_with_flags(store_path(options), OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let release: String = conn.query_row("SELECT value FROM _meta WHERE key = 'release'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    Ok(Project { root: Path::new(dir).join("releases").join(release) })
}

// Read optional columns by name so even a never-upgraded legacy store is inspectable.
fn records(conn: &Connection, table: &str, key: &str, id: &str) -> rusqlite::Result<Vec<Json>> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)", [table], |row| row.get(0))?;
    if !exists { return Ok(Vec::new()); }
    let mut query = conn.prepare(&format!("SELECT * FROM {table} WHERE {key} = ?1"))?;
    let columns: Vec<String> = query.column_names().iter().map(|s| s.to_string()).collect();
    query.query_map([id], |row| {
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
    })?.collect()
}

fn plain(record: &Json, key: &str, tagged: bool) -> Option<Json> {
    let text = record[key].as_str()?;
    if tagged {
        serde_json::from_str::<snapback4_core::Value>(text).ok().map(|value| wire::to_json(&value))
    } else { serde_json::from_str(text).ok() }
}

fn describe_payload(label: &str, value: Option<Json>, values: bool) {
    match value {
        Some(value) => {
            println!("  {label}: {} bytes, sha256 {}", canonical_payload(&value).len(), payload_digest(&value));
            if values { println!("  {label} value: {}", canonical_payload(&value)); }
        }
        None => println!("  {label}: not recorded"),
    }
}

fn show(value: &Json) -> String {
    if value.is_null() { "not recorded".into() } else { value.to_string() }
}

// @ref LLP 3000.009#9-one-release-evolution-and-recovery — correlation reveals metadata, with payloads opt-in.
pub(super) fn explain(options: &Options, id: &str) -> Result<bool, String> {
    let path = store_path(options);
    if !path.is_file() { return Ok(false); }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    conn.execute_batch("BEGIN DEFERRED").map_err(|e| e.to_string())?;
    let values = options.flags.contains_key("values");
    let mut found = false;
    for (table, kind) in [("_requests", "action"), ("_ops", "mutation"), ("_outbox", "effect")] {
        for record in records(&conn, table, "id", id).map_err(|e| e.to_string())? {
            found = true;
            let commit: Option<(String, String, i64)> = if kind != "action" && !record["seq"].is_null() {
                conn.query_row("SELECT program, principal, at FROM _commits WHERE seq = ?1", [record["seq"].as_i64()], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional().map_err(|e| e.to_string())?
            } else { None };
            let receipt = plain(&record, "outcome", false).unwrap_or(Json::Null);
            let operation = if kind == "effect" { record["effect"].clone() } else if !record["name"].is_null() { record["name"].clone() }
                else if kind == "mutation" && receipt["state"] == "sent" { commit.as_ref().map(|c| json!(c.0)).unwrap_or(Json::Null) } else { Json::Null };
            let principal = if kind == "effect" { commit.as_ref().map(|c| json!(c.1)).unwrap_or(Json::Null) } else { record["principal"].clone() };
            let at = if !record["at"].is_null() { record["at"].clone() } else if kind == "mutation" && receipt["state"] == "sent" { commit.as_ref().map(|c| json!(c.2)).unwrap_or(Json::Null) } else { Json::Null };
            println!("{kind} {id}");
            println!("  operation: {}\n  principal: {}\n  admitted at: {}", show(&operation), show(&principal), show(&at));
            if let Some(family) = record["family"].as_str() {
                println!("  binding: family {}, generation {}, admitted expiry {}", family.chars().take(12).collect::<String>(), show(&record["principal_generation"]), show(&record["admitted_expires_at"]));
            } else { println!("  binding: not recorded"); }
            let state = if kind == "mutation" { &receipt["state"] } else { &record["state"] };
            let attempts = if kind == "mutation" { json!(1) } else { record["attempts"].clone() };
            println!("  state: {}\n  attempts: {}\n  lease until: {}\n  claimed by: {}", show(state), show(&attempts), show(&record["lease_until"]), show(&record["claimed_by"]));
            let error = if kind == "mutation" { &receipt["why"] } else { &record["error"] };
            println!("  last error: {}\n  error code: {}", show(error), show(&record["error_code"]));
            println!("  settled at: {}", show(if kind == "mutation" { &at } else { &record["settled_at"] }));
            if kind != "mutation" {
                println!("  release: {}\n  deadline: {}\n  cancelled: {}", show(&record["release"]), show(&record["deadline"]), show(&record["cancelled"]));
            }
            if kind != "action" { println!("  commit sequence: {}", if kind == "mutation" && receipt["state"] != "sent" { "none (refused)".into() } else { show(&record["seq"]) }); }
            let args = match kind {
                "action" => record["args"].as_str().and_then(|s| serde_json::from_str::<BTreeMap<String, snapback4_core::Value>>(s).ok()).map(|args| Json::Object(wire::map_to_json(&args))),
                "effect" => plain(&record, "payload", true),
                _ => None,
            };
            describe_payload("arguments", args, values);
            describe_payload("result", if kind == "mutation" { None } else { plain(&record, "result", kind == "effect") }, values);
            if kind == "action" {
                println!("  contract: {}", show(&record["contract"]));
                for step in records(&conn, "_action_steps", "invocation", id).map_err(|e| e.to_string())? {
                    println!("  step {}: {}\n    input digest: {}\n    provider key: {}\n    admitted at: {}\n    settled at: {}", show(&step["name"]), show(&step["state"]), show(&step["input_digest"]), show(&step["provider_key"]), show(&step["at"]), show(&step["settled_at"]));
                    describe_payload("step result", plain(&step, "result", false), values);
                }
            }
        }
    }
    Ok(found)
}

/// Keep successfully settled attempts visible even when they requeued for retry.
pub(super) fn handler_failures(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut lines = Vec::new();
    for (table, kind, name) in [("_requests", "action", "name"), ("_outbox", "effect", "effect")] {
        let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)", [table], |row| row.get(0))?;
        if !exists { continue; }
        let mut query = conn.prepare(&format!("SELECT id, {name}, state, attempts, error FROM {table} WHERE error IS NOT NULL ORDER BY at DESC, id DESC LIMIT 3"))?;
        let records = query.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?, row.get::<_, String>(4)?)))?;
        for record in records { let (id, name, state, attempts, error) = record?; lines.push(format!("{kind}    {name} {id} {state} after {attempts} attempt(s): {}", serde_json::to_string(&error).unwrap_or_default())); }
    }
    Ok(lines)
}
