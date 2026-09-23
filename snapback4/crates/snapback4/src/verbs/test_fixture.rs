//! The same fixture loader serves query testing and residency at either CLI entry point.
use super::Options;
use crate::project::Project;
use snapback4_core::{Engine, wire};
use snapback4_lang::Bound;

pub(super) fn engine(project: &Project, bound: &Bound, options: &Options) -> Result<Engine, String> {
    let Some(fixture) = options.flags.get("fixture") else { return project.open_engine(bound).map_err(|error| format!("cannot open the store: {error}")); };
    let started = std::time::Instant::now();
    let mut schema = bound.schema.clone();
    // Defer ordinary maintains until after bulk loading. Column derives must
    // remain installed for authoritative import, which strips and rebuilds them.
    if options.flags.contains_key("residency") { schema.maintains.retain(|m| m.private.is_some()); }
    let mut engine = Engine::memory(schema, bound.programs.iter().map(|p| p.program.clone())).map_err(|error| format!("cannot open a store: {error}"))?;
    let entries = std::fs::read_dir(fixture).map_err(|error| format!("cannot read fixture directory {fixture}: {error}"))?;
    let mut loaded = 0;
    for entry in entries {
        let entry = entry.map_err(|error| format!("cannot read fixture directory {fixture}: {error}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(table) = name.strip_suffix(".jsonl") else { continue };
        let Some(definition) = bound.schema.tables.get(table) else { continue };
        let text = std::fs::read_to_string(entry.path()).map_err(|error| format!("cannot read fixture file {}: {error}", entry.path().display()))?;
        let mut rows = Vec::new();
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            let json = serde_json::from_str(line).map_err(|error| format!("{name}: {error}"))?;
            let row = wire::row_from_json(definition, &json).map_err(|error| format!("{name}: {error}"))?;
            rows.push((table.to_owned(), row));
        }
        loaded += engine.load(rows).map_err(|error| format!("{name}: {error}"))?;
    }
    if options.flags.contains_key("residency") {
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
    fn residency_fixture_import_rebuilds_poisoned_columns_once() {
        let source=include_str!("../../../snapback4-lang/tests/fixtures/maintained-columns.q");
        let bound=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(bound.diagnostics.is_empty());
        let root=std::env::temp_dir().join(format!("f1a-fixture-{}",std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        for parent_first in [true,false] {
            let files=[("posts",r#"{"id":"p","at":1,"likeCount":999,"selected":999,"total":999}"#),
                ("likes",r#"{"id":"l","postId":"p","active":true,"amount":7}"#)];
            for index in if parent_first {[0,1]} else {[1,0]} {std::fs::write(root.join(format!("{}.jsonl",files[index].0)),files[index].1).unwrap();}
            let options=Options {positionals:vec![],json:true,flags:[("fixture".into(),root.to_str().unwrap().into()),("residency".into(),String::new())].into()};
            let project=Project {root:root.clone()};
            let mut engine=engine(&project,&bound,&options).unwrap();
            let row=engine.query("postRow",Context::new("alice",[("id".into(),Value::Id("p".into()))].into()).at(1000)).unwrap().data;
            assert_eq!(["likeCount","selected","total"].map(|field|row.field(field).unwrap().as_int().unwrap()),[1,1,7]);
            for (table,_) in files {std::fs::remove_file(root.join(format!("{table}.jsonl"))).unwrap();}
        }
        std::fs::remove_dir(&root).unwrap();
    }
}
