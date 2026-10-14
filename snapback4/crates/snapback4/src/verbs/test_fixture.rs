//! The same fixture loader serves query testing and residency at either CLI entry point.
use super::Options;
use crate::project::Project;
use snapback4_core::{Engine, wire};
use snapback4_lang::Bound;

pub(super) fn engine(project: &Project, bound: &Bound, options: &Options) -> Result<Engine, String> {
    engine_at(project, bound, options, snapback4_core::now_ms())
}

pub(super) fn engine_at(project: &Project, bound: &Bound, options: &Options, now: i64) -> Result<Engine, String> {
    let Some(fixture) = options.flags.get("fixture") else {
        if options.flags.contains_key("source") {
            let store = snapback4_core::Store::memory().map_err(|e| e.to_string())?;
            return Engine::new_at(store, bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone()), now).map_err(|e| e.to_string());
        }
        return project.open_engine(bound).map_err(|error| format!("cannot open the store: {error}"));
    };
    let started = std::time::Instant::now();
    let mut schema = bound.schema.clone();
    // Residency defers ordinary maintains until after bulk loading and builds
    // them once; column derives stay installed and maintain as rows insert.
    let residency = options.flags.contains_key("residency");
    if residency { schema.maintains.retain(|m| m.private.is_some()); }
    let store = snapback4_core::Store::memory().map_err(|error| format!("cannot open a store: {error}"))?;
    let mut engine = Engine::new_at(store, schema, bound.programs.iter().map(|p| p.program.clone()), now).map_err(|error| format!("cannot open a store: {error}"))?;
    let mut names = Vec::new();
    for entry in std::fs::read_dir(fixture).map_err(|error| format!("cannot read fixture directory {fixture}: {error}"))? {
        let entry = entry.map_err(|error| format!("cannot read fixture directory {fixture}: {error}"))?;
        names.push(entry.file_name().to_string_lossy().to_string());
    }
    names.sort();
    // One batch for the whole directory: the engine orders parents before
    // children within a batch, so file order (and read_dir order) cannot make
    // a read-through child or a reference miss its parent.
    let mut rows = Vec::new();
    let mut unknown = Vec::new();
    for name in names {
        let Some(table) = name.strip_suffix(".jsonl") else { continue };
        if name == super::test_cases::FILE { continue; }
        let path = std::path::Path::new(fixture).join(&name);
        let Some(definition) = bound.schema.tables.get(table) else {
            // @ref LLP 3000.011.003.000#7.4 — the starter's own unmodified sample is skipped loudly; a project's file for a missing table still refuses.
            if super::init::starter_fixture(&name).is_some_and(|starter| std::fs::read_to_string(&path).is_ok_and(|text| text == starter)) {
                eprintln!("test: WARNING: skipped {} — the todo starter's unmodified sample rows for a `{table}` table your snapback/*.q does not declare; `snapback4 init --adapt` removes it and the starter's other leftovers", path.display());
                continue;
            }
            unknown.push(name);
            continue;
        };
        let text = std::fs::read_to_string(&path).map_err(|error| format!("cannot read fixture file {}: {error}", path.display()))?;
        for (line_number, line) in text.lines().enumerate().filter(|(_, line)| !line.trim().is_empty()) {
            let at = format!("{name}:{}", line_number + 1);
            let mut json: serde_json::Value = serde_json::from_str(line).map_err(|error| format!("{at}: {error}"))?;
            // A residency fixture is often an exported store: engine-maintained
            // columns are dropped and rebuilt from the source rows. `test`
            // refuses them as an insert and `/seed` do (E_MAINTAINED_COLUMN).
            if residency && let Some(fields) = json.as_object_mut() { fields.retain(|field, _| !definition.maintained.contains_key(field)); }
            relative_times(definition, &mut json, now).map_err(|why| format!("{at}: {why}"))?;
            if let Some(why) = wire::bare_principal(definition, &json) { return Err(format!("{at}: {why}")); }
            let row = wire::row_from_json(definition, &json).map_err(|error| format!("{at}: {error}\n  hint: a fixture row is one JSON object per line with the table's fields and an \"id\"; see snapback4 guide testing"))?;
            rows.push((table.to_owned(), row));
        }
    }
    // A misspelled file name would otherwise load nothing and still pass.
    if !unknown.is_empty() {
        let tables: Vec<&str> = bound.schema.visible_tables().map(|(name, _)| name.as_str()).collect();
        // 0.4.17's init wrote the todo starter's rows beside a project's own schema.
        let starter = unknown.iter().any(|name| name == "todos.jsonl")
            && std::fs::read_to_string(std::path::Path::new(fixture).join("todos.jsonl")).is_ok_and(|text| text.contains("\"id\":\"todo-milk\""));
        let starter = if starter { format!("\n  hint: todos.jsonl is the todo starter's sample that `snapback4 init` wrote; `snapback4 init --adapt` removes it and the starter's {} while they are unmodified (or delete them, and the starter's list/add/toggle/remove lines, yourself)", super::test_cases::FILE) } else { String::new() };
        return Err(format!("{fixture}: {} name{} no table in snapback/*.q; nothing was run{starter}\n  hint: a fixture file is <table>.jsonl for a declared table ({}), plus {}; see snapback4 guide testing",
            unknown.join(", "), if unknown.len() == 1 { "s" } else { "" }, tables.join(", "), super::test_cases::FILE));
    }
    // Fixture rows take `/seed`'s insert path (defaults, sequences, unique with the author's codes, caps, maintained views), not the trusted bulk import.
    let loaded = engine.seed_at(rows, now).map_err(|error| {
        let text = error.to_string();
        let hint = if text.contains("NOT_FOUND") { "\n  hint: every fixture file loads as one batch, parents first; NOT_FOUND means a referenced or read-through parent row is in no fixture file (check the id)" } else { "" };
        format!("{fixture}: {text}{hint}")
    })?;
    if residency {
        engine.adopt_at(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone()), now).map_err(|error| format!("cannot build fixture maintains: {error}"))?;
    }
    if !options.json { println!("test: loaded {loaded} rows from {fixture} in {:.1} s", started.elapsed().as_secs_f64()); }
    Ok(engine)
}

// @ref LLP 3000.000.000.000#5-fixtures-and-dev-evidence — relative time leaves, seeds and operations share one captured clock.
/// Only typed time leaves interpret `now`: text and JSON retain their literals.
fn relative_times(table: &snapback4_core::schema::Table, row: &mut serde_json::Value, now: i64) -> Result<(), String> {
    if let Some(fields) = row.as_object_mut() {
        for (name, value) in fields {
            if let Some(kind) = table.columns.get(name) { time_value(kind, value, now).map_err(|why| format!("{name}: {why}"))?; }
        }
    }
    Ok(())
}

pub(super) fn time_value(kind: &snapback4_core::schema::ColumnType, value: &mut serde_json::Value, now: i64) -> Result<(), String> {
    use snapback4_core::schema::ColumnType;
    match (kind, value) {
        (ColumnType::Optional(inner), value) if !value.is_null() => time_value(inner, value, now),
        (ColumnType::List { of, .. } | ColumnType::ListRange { of, .. }, serde_json::Value::Array(items)) => {
            for item in items { time_value(of, item, now)?; }
            Ok(())
        }
        (ColumnType::Time, value) => {
            let Some(text) = value.as_str().filter(|text| text.starts_with("now")) else { return Ok(()) };
            let delta = if text == "now" { 0 } else {
                let offset = text.strip_prefix("now").unwrap();
                if !offset.starts_with(['+', '-']) { return Err(format!("E_FIXTURE_TIME: {text:?}: expected now or now±duration (ms, s, m, h, d, w)")); }
                crate::dev_clock::offset(offset).map_err(|why| format!("E_FIXTURE_TIME: {text:?}: {}", why.message))?
            };
            let resolved = now.checked_add(delta).filter(|time| (0..=snapback4_core::value::I53_MAX).contains(time))
                .ok_or_else(|| format!("E_FIXTURE_TIME: {text:?} is outside Unix milliseconds 0..9007199254740991"))?;
            *value = resolved.into();
            Ok(())
        }
        _ => Ok(()),
    }
}
pub(super) fn argument_times(kinds: &std::collections::BTreeMap<String, snapback4_core::ir::ArgType>, args: &mut serde_json::Value, now: i64) -> Result<(), String> {
    if let Some(fields) = args.as_object_mut() {
        for (name, value) in fields {
            if let Some(kind) = kinds.get(name).and_then(snapback4_core::schema::arg_as_column) {
                time_value(&kind, value, now).map_err(|why| format!("{name}: {why}"))?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod column_tests {
    use super::*;
    use snapback4_core::{Context, Value};
    #[test]
    fn residency_fixture_import_rebuilds_poisoned_columns() {
        let source=include_str!("../../../snapback4-lang/tests/fixtures/maintained-columns.q");
        let bound=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(bound.diagnostics.is_empty());
        let root=std::env::temp_dir().join(format!("f1a-fixture-{}",std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        {
            let files=[("posts",r#"{"id":"p","at":1,"likeCount":999,"selected":999,"total":999}"#),
                ("likes",r#"{"id":"l","postId":"p","active":true,"amount":7}"#)];
            for index in [0,1] {std::fs::write(root.join(format!("{}.jsonl",files[index].0)),files[index].1).unwrap();}
            let options=Options {positionals:vec![],json:true,flags:[("fixture".into(),root.to_str().unwrap().into()),("residency".into(),String::new())].into()};
            let project=Project {root:root.clone()};
            let mut engine=engine(&project,&bound,&options).unwrap();
            let row=engine.query("postRow",Context::new("alice",[("id".into(),Value::Id("p".into()))].into()).at(1000)).unwrap().data;
            assert_eq!(["likeCount","selected","total"].map(|field|row.field(field).unwrap().as_int().unwrap()),[1,1,7]);
            assert_eq!(engine.store().rows("posts").unwrap(),vec![row]);
            for m in &engine.schema().maintains {
                let rows=engine.store().rows(&m.target).unwrap();
                assert_eq!(rows.len(),1);
                assert_eq!(rows[0].field("value").unwrap(),&Value::Int(if m.private.as_ref().unwrap().column=="total" {7} else {1}));
            }
            for (table,_) in files {std::fs::remove_file(root.join(format!("{table}.jsonl"))).unwrap();}
        }
        std::fs::remove_dir(&root).unwrap();
    }
}

#[cfg(test)]
mod order_tests {
    use super::*;
    // `items` sorts before `lists`: the child's file is read first, yet the
    // directory loads as one batch with parents ordered before children.
    #[test]
    fn read_through_child_file_before_parent_file_loads() {
        let source = "use personas alice, bob\n\ntable lists:\n  owner: principal\n  title: text 1..80\n  immutable owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  cap 50 by owner\n  sync to .owner\n\ntable items:\n  parent: lists\n  text: text 1..200\n  immutable parent\n  read through .parent\n  insert <- .parent.owner = viewer\n  cap 50 by parent\n";
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let root = std::env::temp_dir().join(format!("fixture-order-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("items.jsonl"), "{\"id\":\"00000000000000000000000C01\",\"parent\":\"00000000000000000000000B01\",\"text\":\"wash\"}\n").unwrap();
        std::fs::write(root.join("lists.jsonl"), "{\"id\":\"00000000000000000000000B01\",\"owner\":\"dev:alice\",\"title\":\"Home\"}\n").unwrap();
        let options = Options { positionals: vec![], json: true, flags: [("fixture".into(), root.to_str().unwrap().into())].into() };
        let project = Project { root: root.clone() };
        let engine = engine(&project, &bound, &options);
        std::fs::remove_dir_all(&root).unwrap();
        let engine = engine.unwrap();
        assert_eq!(engine.store().rows("items").unwrap().len(), 1);
        assert_eq!(engine.store().rows("lists").unwrap().len(), 1);
    }
}

#[cfg(test)]
mod relative_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn relative_time_is_typed_checked_and_does_not_rewrite_text_or_json() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table notes:\n  at: time\n  optionalAt: time ?\n  title: text <=80\n  payload: json <=200\n  public 'fixture'\n  online only\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut table = bound.schema.tables["notes"].clone();
        use snapback4_core::schema::ColumnType;
        table.columns.insert("times".into(), ColumnType::List { of: Box::new(ColumnType::Optional(Box::new(ColumnType::Time))), max: 4 });
        let now = 1_000_000_000;
        for (text, expected) in [("now", now), ("now-1h", now-3_600_000), ("now+2d", now+172_800_000), ("now+1ms", now+1)] {
            let mut row = json!({"at":text, "optionalAt":text, "title":"now-1h", "payload":{"time":"now"}});
            relative_times(&table, &mut row, now).unwrap();
            assert_eq!(row, json!({"at":expected,"optionalAt":expected,"title":"now-1h","payload":{"time":"now"}}));
        }
        for text in ["nowsoon", "now+0h", "now+1.5h", "now-9999999999999999999h", "now-100w"] {
            let error = relative_times(&table, &mut json!({"at":text}), now).unwrap_err();
            assert!(error.contains("E_FIXTURE_TIME") && error.contains(text), "{error}");
        }
        let mut null = json!({"at":42,"optionalAt":null});
        relative_times(&table, &mut null, now).unwrap();
        assert_eq!(null, json!({"at":42,"optionalAt":null}));
        let mut list = json!({"times":["now", null, "now-1s"]});
        relative_times(&table, &mut list, now).unwrap();
        assert_eq!(list, json!({"times":[now, null, now-1000]}));
    }
    #[test]
    fn seed_defaults_and_relative_rows_share_the_captured_clock() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table notes:\n  at: time default now\n  ends: time\n  expire at .ends\n  public 'fixture'\n  online only\nquery one():\n  return notes[\"n\"]\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let root = std::env::temp_dir().join(format!("rel3-relative-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("notes.jsonl"), r#"{"id":"n","ends":"now+1ms"}"#).unwrap();
        let options = Options { positionals: vec![], json: true, flags: [("fixture".into(),root.to_str().unwrap().into())].into() };
        let now = snapback4_core::now_ms();
        let mut engine = engine_at(&Project { root:root.clone() }, &bound, &options, now).unwrap();
        let row = engine.query("one", snapback4_core::Context::new("dev:alice", Default::default()).at(now)).unwrap().data;
        assert_eq!(row.field("at").unwrap(), &snapback4_core::Value::Int(now));
        assert_eq!(row.field("ends").unwrap(), &snapback4_core::Value::Int(now+1));
        let gone = engine.query("one", snapback4_core::Context::new("dev:alice", Default::default()).at(now+1)).unwrap().data;
        assert_eq!(gone, snapback4_core::Value::Null);
        std::fs::remove_dir_all(root).unwrap();
    }
}
