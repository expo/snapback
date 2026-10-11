//! The same fixture loader serves query testing and residency at either CLI entry point.
use super::Options;
use crate::project::Project;
use snapback4_core::{Engine, wire};
use snapback4_lang::Bound;

pub(super) fn engine(project: &Project, bound: &Bound, options: &Options) -> Result<Engine, String> {
    let Some(fixture) = options.flags.get("fixture") else { return project.open_engine(bound).map_err(|error| format!("cannot open the store: {error}")); };
    let started = std::time::Instant::now();
    let mut schema = bound.schema.clone();
    // Residency defers ordinary maintains until after bulk loading and builds
    // them once; column derives stay installed and maintain as rows insert.
    let residency = options.flags.contains_key("residency");
    if residency { schema.maintains.retain(|m| m.private.is_some()); }
    let mut engine = Engine::memory(schema, bound.programs.iter().map(|p| p.program.clone())).map_err(|error| format!("cannot open a store: {error}"))?;
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
        let Some(definition) = bound.schema.tables.get(table) else { unknown.push(name); continue };
        let path = std::path::Path::new(fixture).join(&name);
        let text = std::fs::read_to_string(&path).map_err(|error| format!("cannot read fixture file {}: {error}", path.display()))?;
        for (line_number, line) in text.lines().enumerate().filter(|(_, line)| !line.trim().is_empty()) {
            let at = format!("{name}:{}", line_number + 1);
            let mut json: serde_json::Value = serde_json::from_str(line).map_err(|error| format!("{at}: {error}"))?;
            // A residency fixture is often an exported store: engine-maintained
            // columns are dropped and rebuilt from the source rows. `test`
            // refuses them as an insert and `/seed` do (E_MAINTAINED_COLUMN).
            if residency && let Some(fields) = json.as_object_mut() { fields.retain(|field, _| !definition.maintained.contains_key(field)); }
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
    let loaded = engine.seed(rows).map_err(|error| {
        let text = error.to_string();
        let hint = if text.contains("NOT_FOUND") { "\n  hint: every fixture file loads as one batch, parents first; NOT_FOUND means a referenced or read-through parent row is in no fixture file (check the id)" } else { "" };
        format!("{fixture}: {text}{hint}")
    })?;
    if residency {
        engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).map_err(|error| format!("cannot build fixture maintains: {error}"))?;
    }
    if !options.json { println!("test: loaded {loaded} rows from {fixture} in {:.1} s", started.elapsed().as_secs_f64()); }
    Ok(engine)
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
