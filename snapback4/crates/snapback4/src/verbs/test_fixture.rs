//! The same fixture loader serves query testing and residency at either CLI entry point.
use super::Options;
use crate::project::Project;
use snapback4_core::{Engine, wire};
use snapback4_lang::Bound;

pub(super) fn engine(project: &Project, bound: &Bound, options: &Options) -> Result<Engine, String> {
    let Some(fixture) = options.flags.get("fixture") else { return project.open_engine(bound).map_err(|error| format!("cannot open the store: {error}")); };
    let started = std::time::Instant::now();
    let mut schema = bound.schema.clone();
    // Rebuild maintains once after bulk loading, through ordinary adoption.
    if options.flags.contains_key("residency") { schema.maintains.clear(); }
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
