//! Application catalog inspection; never prepare caller-supplied SQL here.
// @ref LLP 3000.007#8 — catalog commands share SQL inspection's active read-only snapshot.
use super::{CATALOG_HINT, Connection, Result, Schema, internal, json, store_error};
use snapback4_core::schema::{IndexComponent, inspection::{Declarations, Record, META_KEY}};
use rusqlite::OptionalExtension;
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

fn index_generated(declared: Option<&Declarations>, table: &str, index: &str) -> Option<bool> {
    declared.map(|declared|
        !declared.get(table).is_some_and(|indexes| indexes.contains(index)))
}

fn provenance(conn: &Connection, schema: &Schema) -> Result<Option<Declarations>> {
    let encoded: Option<(i64, String)> = conn.query_row(
        "SELECT CAST(g.value AS INTEGER), p.value FROM _meta g JOIN _meta p ON p.key = ?1 WHERE g.key = 'generation'",
        [META_KEY], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(store_error)?;
    let Some((generation, encoded)) = encoded else { return Ok(None); };
    let record: Record = serde_json::from_str(&encoded).map_err(|e| ("E_SCHEMA", e.to_string()))?;
    Ok((i64::try_from(record.generation).ok() == Some(generation) && record.schema_hash == schema.hash()).then_some(record.indexes))
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
    let declared = if requested.is_some() { provenance(conn, schema)? } else { None };
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
            let generated = |index: &str| index_generated(declared.as_ref(), name, index);
            let public_column = |name: &str| !table.engine_field(name) && !snapback4_core::schema::timeline::is_slot(name);
            let mut columns = vec![json!({"name": "id", "type": "id", "nullable": false})];
            // Match the generated Rows surface: captures, expiry bookkeeping
            // and timeline slots are not application column declarations.
            columns.extend(table.columns.iter().filter(|(name, _)| name.as_str() != "id" && public_column(name)).map(|(name, kind)|
                json!({"name": name, "type": kind.required().to_string(), "nullable": kind.is_optional(),
                    "maintained": table.maintained.contains_key(name)})));
            description["columns"] = json!(columns);
            let mut indexes = vec![json!({"name": null, "keys": ["id"], "unique": true, "primary": true, "generated": generated("byId")})];
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
                // Source-declared unnamed unique keys are authored, but their
                // internal spelling is still not an authorable index name.
                let generated = generated(name);
                json!({"name": if generated == Some(false) && !name.starts_with('$') { Some(name) } else { None }, "keys": keys,
                    "unique": index.unique, "primary": false, "generated": generated})
            }));
            description["indexes"] = json!(indexes);
            if declared.is_none() {
                description["indexProvenance"] = json!("unavailable for this generation; adopt the schema with a current compiler to record it");
            }
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
            if let Some(note) = table["indexProvenance"].as_str() { println!("  Index provenance: {note}"); }
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

    fn assert_source_provenance(schema: &Schema, declared: Option<&Declarations>, source: &str) {
        let (document, diagnostics) = snapback4_lang::parse_document("schema.q", source);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let source_declared: std::collections::BTreeSet<_> = document.tables.iter().map(|t| (&t.name, &t.indexes))
            .chain(document.maintains.iter().map(|m| (&m.name, &m.indexes)))
            .flat_map(|(table, indexes)| indexes.iter().map(move |index| (table.as_str(), index.name.as_str()))).collect();
        // Walk every physical index, including intrinsic, hidden and private
        // ones. No name prefix or generated-table family decides provenance.
        for (table, definition) in &schema.tables {
            for index in definition.indexes.keys() {
                assert_eq!(index_generated(declared, table, index), Some(!source_declared.contains(&(table.as_str(), index.as_str()))), "{table}.{index}");
            }
        }
        for (table, index) in source_declared { assert!(schema.tables[table].indexes.contains_key(index), "{table}.{index}"); }
    }

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
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let engine = Engine::new(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let conn = engine.store().conn();
        let (_, schema) = active_schema(conn).unwrap();
        assert_source_provenance(&schema, provenance(conn, &schema).unwrap().as_ref(), &source);
        let describe = |name| inspect(conn, &schema, Command::Describe(name)).unwrap().remove(0);
        let sequence = describe("catalogSequence");
        assert!(schema.tables["catalogSequence"].indexes.contains_key("$sequence:ordinal"));
        assert!(sequence["indexes"].as_array().unwrap().iter().any(|i|
            i["keys"] == json!(["root", "ordinal"]) && i["unique"] == false && i["generated"] == true && i["name"].is_null()));
        let children = describe("catalogChildren");
        for name in ["$expiry", "$children"] { assert!(schema.tables["catalogChildren"].indexes.contains_key(name)); }
        assert!(!children.to_string().contains('$'), "{children}");
        assert_eq!(children["indexes"], json!([{"name":null, "keys":["id"], "unique":true, "primary":true, "generated":true}]));
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
                if index["name"].is_null() { unnamed += 1; }
            }
            // Every ordinary-column key whose inputs are public survives intact;
            // verify provenance against the compiled starter, including $intent.
            for (identity, index) in &table.indexes {
                if !index.is_plain() || index.columns().iter().any(|c| c.starts_with('$')) { continue; }
                let generated = index_generated(provenance(conn, &schema).unwrap().as_ref(), name, identity).unwrap();
                let public_name = if generated || identity.starts_with('$') { None } else { Some(identity) };
                assert!(description["indexes"].as_array().unwrap().iter().any(|i|
                    i["keys"] == json!(index.columns()) && i["unique"] == index.unique && i["name"] == json!(public_name) && i["generated"] == generated), "{identity}: {description}");
            }
        }
        assert!(unnamed > 0);
    }

    #[test]
    fn social_starter_index_names_and_keys_are_public() { starter_indexes(include_str!("init/social/schema.q"), true); }

    #[test]
    fn chat_starter_index_names_and_keys_are_public() { starter_indexes(include_str!("../../../../apps/chat/snapback/schema.q"), false); }

    #[test]
    fn unmodified_starters_record_only_source_declared_indexes() {
        for source in [include_str!("init/social/schema.q"), include_str!("../../../../apps/chat/snapback/schema.q")] {
            let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            let schema: Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
            assert_source_provenance(&schema, bound.schema.authored_indexes.0.as_ref(), source);
            assert!(schema.authored_indexes.0.is_none());
            assert_eq!(schema, bound.schema);
            assert_eq!(schema.hash(), bound.schema.hash());
            let engine = Engine::new(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
            let (generation, schema) = active_schema(engine.store().conn()).unwrap();
            assert!(generation > 0);
            assert_source_provenance(&schema, provenance(engine.store().conn(), &schema).unwrap().as_ref(), source);
            for (table, index) in [("followingFeed", "byReaderPage"), ("$ownKeys:likes", "byGroup"), ("messageCounts", "byGroup")] {
                let Some(definition) = schema.tables.get(table) else { continue; };
                let described = inspect(engine.store().conn(), &schema, Command::Describe(table)).unwrap();
                assert!(described[0]["indexes"].as_array().unwrap().iter().any(|i|
                    i["keys"] == json!(definition.indexes[index].columns()) && i["generated"] == true && i["name"].is_null()), "{table}.{index}: {described:?}");
            }
        }
    }

    #[test]
    fn declared_unique_and_maintained_keys_survive_and_legacy_provenance_is_unknown() {
        let source = SOURCE.replace("maintain counts: count messages by owner\n", "maintain counts: count messages by owner\n  by byValue: value, id\n");
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert_source_provenance(&bound.schema, bound.schema.authored_indexes.0.as_ref(), &source);
        let projection = bound.schema.public_projection();
        assert!(projection.authored_indexes.0.is_none());
        assert!(serde_json::to_value(&projection).unwrap().get("authored_indexes").is_none());
        let engine = Engine::new(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let conn = engine.store().conn();
        let (_, schema) = active_schema(conn).unwrap();
        let declared = inspect(conn, &schema, Command::Describe("counts")).unwrap();
        assert!(declared[0]["indexes"].as_array().unwrap().iter().any(|i| i["name"] == "byValue" && i["generated"] == false));
        let declared = inspect(conn, &schema, Command::Describe("messages")).unwrap();
        assert!(declared[0]["indexes"].as_array().unwrap().iter().any(|i| i["keys"] == json!(["body"]) && i["generated"] == false && i["name"].is_null()));
        assert!(serde_json::to_value(&schema).unwrap().get("authored_indexes").is_none());
        assert!(schema.authored_indexes.0.is_none());
        conn.execute("DELETE FROM _meta WHERE key = ?1", [META_KEY]).unwrap();
        let unknown = inspect(conn, &schema, Command::Describe("messages")).unwrap();
        assert!(unknown[0]["indexProvenance"].as_str().unwrap().contains("unavailable"));
        assert!(unknown[0]["indexes"].as_array().unwrap().iter().all(|i| i["generated"].is_null() && i["name"].is_null()));
    }

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
    fn main_store_reopens_and_describes_before_and_after_metadata_only_adoption() {
        // Exact SQL dump of a populated store made by main a8762e055641.
        // No schema reconstruction or field stripping on either side.
        let directory = std::env::temp_dir().join(format!("sb4-sx-main-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("store.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(include_str!("../../../snapback4-core/tests/fixtures/capability-free-main.sql")).unwrap();
        drop(conn);
        let mut engine = Engine::open(Store::open(&path).unwrap()).unwrap();
        let conn = engine.store().conn();
        let (generation, schema) = active_schema(conn).unwrap();
        assert_eq!(generation, 1);
        assert_eq!(serde_json::to_string(&schema).unwrap(), include_str!("../../../snapback4-core/tests/fixtures/capability-free.schema.json"));
        assert_eq!(inspect(conn, &schema, Command::Tables).unwrap().len(), 2);
        for table in ["likes", "posts"] {
            let description = inspect(conn, &schema, Command::Describe(table)).unwrap();
            assert_eq!(description[0]["rows"], json!({"count":1,"exact":true}));
            assert!(description[0]["indexProvenance"].as_str().unwrap().contains("unavailable"));
            assert!(description[0]["indexes"].as_array().unwrap().iter().all(|i| i["generated"].is_null()));
        }
        let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../snapback4-core/tests/fixtures/capability-free.q").into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert_eq!(engine.adopt(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap(), generation);
        drop(engine);
        let engine = Engine::open(Store::open(&path).unwrap()).unwrap();
        let conn = engine.store().conn();
        let (after, schema) = active_schema(conn).unwrap();
        assert_eq!(after, generation);
        let bytes: String = conn.query_row("SELECT schema FROM _generations WHERE generation = ?1", [generation as i64], |r| r.get(0)).unwrap();
        assert_eq!(bytes, include_str!("../../../snapback4-core/tests/fixtures/capability-free.schema.json"));
        let before = conn.total_changes();
        conn.execute_batch("PRAGMA query_only = ON; BEGIN DEFERRED").unwrap();
        for table in ["likes", "posts"] {
            let description = inspect(conn, &schema, Command::Describe(table)).unwrap();
            assert!(description[0].get("indexProvenance").is_none());
            assert!(description[0]["indexes"].as_array().unwrap().iter().all(|i| i["generated"] == true && i["name"].is_null()));
        }
        assert_eq!(conn.total_changes(), before);
        conn.execute_batch("ROLLBACK").unwrap();
        drop(engine);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn catalog_side_record_is_atomic_and_rejects_stale_identity() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        let mut engine = Engine::new(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let table = engine.schema().tables["messages"].clone();
        engine.seed((0..2).map(|n| ("messages".into(), wire::row_from_json(&table,
            &json!({"id":format!("m{n}"), "body":format!("b{n}"), "owner":"alice"})).unwrap()))).unwrap();
        let previous = engine.store().meta(META_KEY).unwrap().unwrap();
        let generation = engine.generation();
        let next = snapback4_lang::compile(&[("schema.q".into(), SOURCE.replace("by byOwner: owner, id", "unique owner"))]);
        assert!(next.diagnostics.is_empty(), "{:?}", next.diagnostics);
        assert!(engine.adopt(next.schema, next.programs.into_iter().map(|p| p.program)).is_err());
        assert_eq!(engine.generation(), generation);
        assert_eq!(engine.store().meta(META_KEY).unwrap().unwrap(), previous);
        let conn = engine.store().conn();
        let (_, schema) = active_schema(conn).unwrap();
        for stale_generation in [true, false] {
            let mut record: Record = serde_json::from_str(&previous).unwrap();
            if stale_generation { record.generation += 1; } else { record.schema_hash = "obsolete".into(); }
            conn.execute("UPDATE _meta SET value = ?1 WHERE key = ?2", [serde_json::to_string(&record).unwrap(), META_KEY.into()]).unwrap();
            let description = inspect(conn, &schema, Command::Describe("messages")).unwrap();
            assert!(description[0]["indexes"].as_array().unwrap().iter().all(|i| i["generated"].is_null() && i["name"].is_null()));
        }
    }

    #[test]
    fn commands_are_exact_and_never_combine_with_sql() {
        for input in ["\\dt", ".tables", " \\dt\n"] { assert!(matches!(command(input).unwrap(), Some(Command::Tables))); }
        for input in ["\\d messages", ".schema messages", "\\d scope.messages"] { assert!(matches!(command(input).unwrap(), Some(Command::Describe(_)))); }
        for input in ["\\dt; SELECT 1", ".tables messages", "\\d", ".schema", "\\d messages extra", ".shell rm -rf x"] { assert!(command(input).is_err(), "{input}"); }
    }
}
