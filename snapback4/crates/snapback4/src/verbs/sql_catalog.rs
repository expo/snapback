//! Application catalog inspection; never prepare caller-supplied SQL here.
// @ref LLP 3000.007#8 — catalog commands share SQL inspection's active read-only snapshot.
use super::{CATALOG_HINT, Connection, Result, Schema, internal, json, store_error};
use snapback4_core::schema::IndexComponent;
use serde_json::Value;

pub(super) enum Command<'a> { Tables, Describe(&'a str) }

pub(super) fn command(statement: &str) -> Result<Option<Command<'_>>> {
    let statement = statement.trim();
    if !statement.starts_with(['\\', '.']) { return Ok(None); }
    let parts: Vec<_> = statement.split_whitespace().collect();
    match parts.as_slice() {
        ["\\dt" | ".tables"] => Ok(Some(Command::Tables)),
        ["\\d" | ".schema", name] => Ok(Some(Command::Describe(name))),
        _ => Err(("E_INPUT", format!("use \\dt or .tables; \\d <table> or .schema <table>; {CATALOG_HINT}"))),
    }
}

pub(super) fn active_schema(conn: &Connection) -> Result<(u64, Schema)> {
    let (generation, encoded): (i64, String) = conn.query_row(
        "SELECT generation, schema FROM _generations WHERE generation = (SELECT value FROM _meta WHERE key = 'generation')",
        [], |row| Ok((row.get(0)?, row.get(1)?))).map_err(store_error)?;
    let generation = u64::try_from(generation).map_err(|e| ("E_SCHEMA", e.to_string()))?;
    Ok((generation, serde_json::from_str(&encoded).map_err(|e| ("E_SCHEMA", e.to_string()))?))
}

// Bound inspection cost even on a scale fixture. An exhausted probe is a lower
// bound, never an estimated exact count; no row JSON or SQLite metadata is read.
pub(super) const COUNT_LIMIT: u64 = 10_000;
pub(super) fn row_count(conn: &Connection, name: &str, limit: u64) -> Result<u64> {
    conn.query_row("SELECT count(*) FROM (SELECT 1 FROM r WHERE t = (SELECT num FROM _catalog WHERE name = ?1) LIMIT ?2)",
        rusqlite::params![name, limit as i64], |r| r.get::<_, i64>(0)).map(|n| n as u64).map_err(store_error)
}

pub(super) fn inspect(conn: &Connection, schema: &Schema, command: Command<'_>) -> Result<Vec<Value>> {
    let requested = match command { Command::Tables => None, Command::Describe(name) => Some(name) };
    // @ref LLP 3000.007.001#3.2 — refusals identify the owning column, never its private target.
    if let Some(maintain) = schema.maintains.iter().find(|m| m.private.is_some()
        && requested.is_some_and(|name| m.target.eq_ignore_ascii_case(name))) {
        return Err(("E_MAINTAINED_COLUMN_PRIVATE", format!("{} is engine-maintained; read its parent column (guide maintains); {CATALOG_HINT}", maintain.label())));
    }
    if requested.is_some_and(internal) {
        return Err(("E_SQL_INTERNAL", format!("internal tables are refused; {CATALOG_HINT}")));
    }
    let mut tables = Vec::new();
    for (name, table) in schema.visible_tables().filter(|(name, _)| !internal(name)) {
        if requested.is_some_and(|wanted| !name.eq_ignore_ascii_case(wanted)) { continue; }
        let maintain = schema.maintains.iter().find(|m| &m.target == name);
        let kind = if table.ephemeral.is_some() { "ephemeral table" }
            else if maintain.is_some() { "maintained view" }
            else if schema.timelines.iter().any(|t| t.owns(name)) { "timeline" }
            else { "table" };
        let rows = if table.ephemeral.is_some() {
            json!({"count": null, "exact": false, "reason": "ephemeral rows live only in the serving process's memory"})
        } else {
            let count = row_count(conn, name, COUNT_LIMIT + 1)?;
            json!({"count": count, "exact": count <= COUNT_LIMIT})
        };
        let mut description = json!({"name": name, "kind": kind, "rows": rows});
        if requested.is_some() {
            let public_column = |name: &str| !table.engine_field(name) && !snapback4_core::schema::timeline::is_slot(name);
            let mut columns = vec![json!({"name": "id", "type": "id", "nullable": false})];
            // Match the generated Rows surface: captures, expiry bookkeeping
            // and timeline slots are not application column declarations.
            columns.extend(table.columns.iter().filter(|(name, _)| name.as_str() != "id" && public_column(name)).map(|(name, kind)|
                json!({"name": name, "type": kind.required().to_string(), "nullable": kind.is_optional(),
                    "maintained": table.maintained.contains_key(name)})));
            description["columns"] = json!(columns);
            let mut indexes = vec![json!({"name": "id", "keys": ["id"], "unique": true, "primary": true})];
            // Omit bookkeeping indexes with hidden inputs rather than presenting
            // a shortened tuple as the full index (or changing a unique key).
            indexes.extend(table.indexes.iter().filter(|(name, index)|
                !(name.as_str() == "byId" && index.unique && index.is_plain() && index.columns() == ["id"])
                && index.components.iter().all(|c| match c {
                    IndexComponent::Column(name) => public_column(name),
                    IndexComponent::Calendar(key) => public_column(&key.column),
                    IndexComponent::WordPrefixes { fields, .. } => fields.iter().all(|name| public_column(name)),
                    IndexComponent::Contribution(_) => false,
                })).map(|(name, index)| {
                let keys: Vec<_> = index.components.iter().map(|c| match c {
                    IndexComponent::Column(name) => name.clone(),
                    IndexComponent::Calendar(key) => {
                        let mut args = vec![key.column.clone()];
                        if key.function == "bucket" { args.push(format!("{}ms", key.millis)); }
                        if key.offset != 0 { args.push(format!("{}ms", key.offset)); }
                        format!("{}({})", key.function, args.join(", "))
                    }
                    IndexComponent::WordPrefixes { fields, .. } => format!("words({})", fields.join(", ")),
                    IndexComponent::Contribution(_) => unreachable!(),
                }).collect();
                // Generated identities are not authorable index names. Keep the
                // complete key while distinguishing them from named declarations.
                let generated = name.starts_with('$');
                json!({"name": if generated { None } else { Some(name) }, "keys": keys,
                    "unique": index.unique, "primary": false, "generated": generated})
            }));
            description["indexes"] = json!(indexes);
            if let Some(maintain) = maintain {
                description["maintainedFrom"] = json!(maintain.source);
            }
        }
        tables.push(description);
    }
    if requested.is_some() && tables.is_empty() {
        return Err(("E_INPUT", format!("no application table named {}; {CATALOG_HINT}", requested.unwrap())));
    }
    Ok(tables)
}

pub(super) fn print(tables: &[Value], generation: u64) {
    println!("Schema generation: {generation}");
    for table in tables {
        let count = &table["rows"];
        let rows = if count["count"].is_null() { "unavailable (ephemeral, serving-process memory)".into() }
            else { format!("{}{}", if count["exact"] == true { "" } else { ">=" }, count["count"]) };
        println!("{} | {} | rows: {rows}", table["name"].as_str().unwrap(), table["kind"].as_str().unwrap());
        if let Some(columns) = table["columns"].as_array() {
            for column in columns {
                println!("  {}: {} — {}{}", column["name"].as_str().unwrap(), column["type"].as_str().unwrap(),
                    if column["nullable"] == true { "nullable" } else { "not null" },
                    if column["maintained"] == true { "; maintained" } else { "" });
            }
            for index in table["indexes"].as_array().unwrap() {
                let name = index["name"].as_str().map(|n| format!(" {n}")).unwrap_or_default();
                println!("  {}{name} ({})", if index["primary"] == true { "primary key" } else if index["unique"] == true { "unique" } else { "index" },
                    index["keys"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>().join(", "));
            }
            if let Some(source) = table["maintainedFrom"].as_str() { println!("  maintained from {source}"); }
        }
    }
    if tables.is_empty() { println!("(no application tables)"); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback4_core::{Engine, Store, wire};

    const SOURCE: &str = "table messages:\n  body: text <=100\n  note: text ?\n  owner: principal\n  at: time default 0\n  unique body\n  search body\n  by byOwner: owner, id\n  by byBucket: bucket(at, 2h, 30m), at, id\n  by id: owner\n  public\n  online only\nmaintain counts: count messages by owner\n  read <- allow\n  online only\ntable typing:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  insert <- .principal = viewer\n  ephemeral 4s\nquery find(q: text <=20, c: cursor ?):\n  return messages matching q last 10 by .id after c\n";

    fn exercise(store: Store) {
        let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::new(store, bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let table = engine.schema().tables["messages"].clone();
        engine.seed((0..10_025).map(|n| ("messages".into(), wire::row_from_json(&table,
            &json!({"id": format!("m{n}"), "body": format!("body {n}"), "owner": "alice"})).unwrap()))).unwrap();
        let conn = engine.store().conn();
        conn.execute_batch("PRAGMA query_only = ON; BEGIN DEFERRED").unwrap();
        let before = conn.total_changes();
        let (generation, schema) = active_schema(conn).unwrap();
        assert_eq!(generation, engine.generation());
        let list = inspect(conn, &schema, Command::Tables).unwrap();
        assert_eq!(list.iter().map(|t| t["name"].as_str().unwrap()).collect::<Vec<_>>(), ["counts", "messages", "typing"]);
        assert_eq!(list[0]["kind"], "maintained view");
        assert_eq!(list[0]["rows"], json!({"count": 1, "exact": true}));
        assert_eq!(list[1]["rows"], json!({"count": 10_001, "exact": false}));
        assert!(list[2]["rows"]["count"].is_null());
        let describe = inspect(conn, &schema, Command::Describe("MeSsAgEs")).unwrap();
        let columns = describe[0]["columns"].as_array().unwrap();
        assert!(columns.iter().any(|c| c["name"] == "body" && c["type"] == "text <=100" && c["nullable"] == false));
        assert!(columns.iter().any(|c| c["name"] == "note" && c["type"].as_str().unwrap().starts_with("text") && c["nullable"] == true));
        let indexes = describe[0]["indexes"].as_array().unwrap();
        assert_eq!(indexes.iter().filter(|i| i["keys"] == json!(["id"])).count(), 1);
        assert!(!describe[0].to_string().contains("$intent:"));
        assert!(indexes.iter().any(|i| i["name"] == "id" && i["keys"] == json!(["owner"])));
        assert!(indexes.iter().any(|i| i["name"] == "byBucket" && i["keys"] == json!(["bucket(at, 7200000ms, 1800000ms)", "at", "id"])));
        assert!(indexes.iter().any(|i| i["keys"].as_array().unwrap().iter().any(|k| k == "words(body)")));
        assert!(indexes.iter().any(|i| i["unique"] == true && i["keys"] == json!(["body"])));
        assert!(indexes.iter().any(|i| i["name"] == "byOwner" && i["keys"] == json!(["owner", "id"])));
        assert_eq!(inspect(conn, &schema, Command::Describe("counts")).unwrap()[0]["maintainedFrom"], "messages");
        for name in ["sqlite_master", "sqlite_schema", "_meta", "r", "I"] {
            let (code, message) = inspect(conn, &schema, Command::Describe(name)).unwrap_err();
            assert_eq!(code, "E_SQL_INTERNAL");
            assert!(message.contains(CATALOG_HINT));
        }
        let (code, message) = inspect(conn, &schema, Command::Describe("scope.messages")).unwrap_err();
        assert_eq!(code, "E_INPUT");
        assert!(message.contains("no application table named scope.messages"));
        assert!(inspect(conn, &schema, Command::Describe("messages;DELETE")).is_err());
        assert_eq!(conn.total_changes(), before);
        conn.execute_batch("ROLLBACK").unwrap();
    }

    #[test]
    fn catalog_on_populated_memory_store() { exercise(Store::memory().unwrap()); }

    #[test]
    fn catalog_on_populated_sqlite_store() {
        let directory = std::env::temp_dir().join(format!("sb4-sx-catalog-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        exercise(Store::open(&directory.join("store.sqlite")).unwrap());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn catalog_recognizes_the_starters_maintained_timeline() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("init/social/schema.q").into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let feeds: Vec<_> = bound.schema.timelines.iter().map(|t| t.table("Feed")).collect();
        assert!(!feeds.is_empty());
        let engine = Engine::new(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let (_, schema) = active_schema(engine.store().conn()).unwrap();
        let tables = inspect(engine.store().conn(), &schema, Command::Tables).unwrap();
        for feed in feeds { assert!(tables.iter().any(|t| t["name"] == feed && t["kind"] == "timeline")); }
        let posts = inspect(engine.store().conn(), &schema, Command::Describe("posts")).unwrap();
        assert!(!posts[0].to_string().contains("$timeline:"));
    }

    fn starter_indexes(source: &str, social: bool) {
        // Extend each real starter with expiry inheritance and automatic
        // allocation, which the starter apps do not currently declare.
        let source = format!("{source}\ntable catalogRoots:\n  owner: principal\n  until: time\n  immutable owner, until\n  expire at .until\n  read <- .owner = viewer\n  insert <- allow\n  online only\ntable catalogChildren:\n  root: catalogRoots\n  immutable root\n  read through .root\n  insert <- allow\n  online only\ntable catalogSequence:\n  root: catalogRoots\n  ordinal: sequence by root\n  public\n  online only\n");
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let engine = Engine::new(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let conn = engine.store().conn();
        let (_, schema) = active_schema(conn).unwrap();
        let describe = |name| inspect(conn, &schema, Command::Describe(name)).unwrap().remove(0);
        let sequence = describe("catalogSequence");
        assert!(schema.tables["catalogSequence"].indexes.contains_key("$sequence:ordinal"));
        assert!(sequence["indexes"].as_array().unwrap().iter().any(|i|
            i["keys"] == json!(["root", "ordinal"]) && i["unique"] == false && i["generated"] == true && i["name"].is_null()));
        let children = describe("catalogChildren");
        for name in ["$expiry", "$children"] { assert!(schema.tables["catalogChildren"].indexes.contains_key(name)); }
        assert!(!children.to_string().contains('$'), "{children}");
        assert_eq!(children["indexes"], json!([{"name":"id", "keys":["id"], "unique":true, "primary":true}]));
        if social {
            assert!(schema.tables["typing"].indexes.contains_key("$expiry"));
            assert!(!describe("typing").to_string().contains('$'));
            assert!(schema.tables["follows"].indexes.contains_key("$timeline:following:followers"));
            assert!(describe("follows")["indexes"].as_array().unwrap().iter().any(|i|
                i["keys"] == json!(["followedId", "followerId"]) && i["generated"] == true && i["name"].is_null()));
        } else {
            assert!(describe("messages")["indexes"].as_array().unwrap().iter().any(|i|
                i["name"] == "byConvTime" && i["generated"] == false && i["keys"] == json!(["conversationId", "at", "id"])));
        }
        let mut unnamed = 0;
        for (name, table) in schema.visible_tables() {
            let description = describe(name);
            assert!(!description["columns"].to_string().contains('$'), "{description}");
            for index in description["indexes"].as_array().unwrap() {
                assert!(!index.to_string().contains('$'), "{description}");
                if index["name"].is_null() { unnamed += 1; assert_eq!(index["generated"], true); }
            }
            // Every ordinary-column key whose inputs are public survives intact;
            // verify provenance against the compiled starter, including $intent.
            for (identity, index) in &table.indexes {
                if !identity.starts_with('$') || !index.is_plain() || index.columns().iter().any(|c| c.starts_with('$')) { continue; }
                assert!(description["indexes"].as_array().unwrap().iter().any(|i|
                    i["keys"] == json!(index.columns()) && i["unique"] == index.unique && i["name"].is_null() && i["generated"] == true), "{identity}: {description}");
            }
        }
        assert!(unnamed > 0);
    }

    #[test]
    fn social_starter_index_names_and_keys_are_public() { starter_indexes(include_str!("init/social/schema.q"), true); }

    #[test]
    fn chat_starter_index_names_and_keys_are_public() { starter_indexes(include_str!("../../../../apps/chat/snapback/schema.q"), false); }

    #[test]
    fn catalog_private_targets_name_the_parent_column() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../snapback4-lang/tests/fixtures/maintained-columns.q").into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let engine = Engine::new(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let conn = engine.store().conn();
        let (_, schema) = active_schema(conn).unwrap();
        assert!(schema.maintains.iter().any(|m| m.private.is_some()));
        for maintain in schema.maintains.iter().filter(|m| m.private.is_some()) {
            for name in [&maintain.target, &maintain.target.to_uppercase()] {
                for alias in ["\\d", ".schema"] {
                    let input = format!("{alias} {name}");
                    let (code, message) = inspect(conn, &schema, command(&input).unwrap().unwrap()).unwrap_err();
                    assert_eq!(code, "E_MAINTAINED_COLUMN_PRIVATE");
                    assert!(message.contains(&maintain.label()));
                    assert!(message.contains(CATALOG_HINT));
                    assert!(!message.to_lowercase().contains(&maintain.target));
                }
            }
        }
    }

    #[test]
    fn commands_are_exact_and_never_combine_with_sql() {
        for input in ["\\dt", ".tables", " \\dt\n"] { assert!(matches!(command(input).unwrap(), Some(Command::Tables))); }
        for input in ["\\d messages", ".schema messages", "\\d scope.messages"] { assert!(matches!(command(input).unwrap(), Some(Command::Describe(_)))); }
        for input in ["\\dt; SELECT 1", ".tables messages", "\\d", ".schema", "\\d messages extra", ".shell rm -rf x"] { assert!(command(input).is_err(), "{input}"); }
    }
}
