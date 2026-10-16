//! Optional per-query persona matrix; explicit --as remains a global override.
use std::{collections::BTreeMap, path::Path};
use snapback4_lang::Bound;

pub const FILE: &str = "test.sweep.json";

// @ref LLP 3000.000.000.000.000#2-fixture-semantics — sweep personas are explicit and validated before cases execute.
pub fn load(fixture: Option<&String>, bound: &Bound) -> Result<BTreeMap<String, Vec<String>>, String> {
    let Some(fixture) = fixture else { return Ok(BTreeMap::new()); };
    let path = Path::new(fixture).join(FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let matrix: BTreeMap<String, Vec<String>> = serde_json::from_str(&text).map_err(|e| format!("{FILE}: expected {{\"queryName\":[\"persona\",..]}}: {e}"))?;
    for (name, personas) in &matrix {
        if !bound.programs.iter().any(|p| p.program.name == *name && p.program.kind == snapback4_core::ir::ProgramKind::Query) {
            return Err(format!("{FILE}: {name} is not a declared query"));
        }
        if personas.is_empty() { return Err(format!("{FILE}: {name} needs at least one persona (queries cannot be silently skipped)")); }
        let mut seen = std::collections::BTreeSet::new();
        for persona in personas {
            if persona.is_empty() || !seen.insert(persona) { return Err(format!("{FILE}: {name}: empty or duplicate persona {persona:?}")); }
            if let Some(why) = super::test_cases::undeclared_persona(persona, &bound.personas) { return Err(format!("{FILE}: {name}: {why}")); }
        }
    }
    Ok(matrix)
}
