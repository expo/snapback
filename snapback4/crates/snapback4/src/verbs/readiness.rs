//! Read-only production and fixture authoring notes; never an execution gate.
use std::collections::BTreeSet;
use snapback4_lang::{bind::Bound, Diagnostic, Site};
use snapback4_core::{ir::{self, ProgramKind, ArgType}, schema::{RuleExpr, RuleTerm}, engine::validate, wire};
use crate::project::Project;

// @ref LLP 3000.011.003.000#8 — positive bootstrap dependencies form a least fixed point.
pub(super) fn notes(project: &Project, bound: &Bound, fixture: Option<&String>) -> Vec<Diagnostic> {
    let mut reachable = BTreeSet::new();
    let mut system = BTreeSet::new();
    let mut writers = BTreeSet::new();
    for p in &bound.programs {
        for (table, effect) in ir::write_tables(&p.program) {
            if matches!(effect, "insert" | "upsert") {
                writers.insert(table.clone());
                if p.program.kind == ProgramKind::Job { system.insert(table); }
            }
        }
        // Native jobs are opaque to the authoring analysis; no absence claim.
        if p.program.native { return fixture_notes(project, bound, fixture); }
    }
    loop {
        let previous = reachable.len();
        for (name, table) in bound.schema.visible_tables() {
            if bound.schema.maintain_for(name).is_some() { reachable.insert(name.to_owned()); continue; }
            if !writers.contains(name) { continue; }
            let refs_ready = table.through.as_ref().is_none_or(|through| reachable.contains(&through.parent));
            if refs_ready && (system.contains(name) || possible(&table.rules.insert, &reachable)) { reachable.insert(name.to_owned()); }
        }
        if reachable.len() == previous { break; }
    }
    let sources = project.sources().unwrap_or_default();
    let mut notes = Vec::new();
    for (name, table) in bound.schema.visible_tables() {
        if table.ephemeral.is_some() || bound.schema.maintain_for(name).is_some() || reachable.contains(name) { continue; }
        let site = sources.iter().find_map(|(file, source)| source.lines().enumerate().find(|(_, line)| line.trim_start().starts_with(&format!("table {name}:"))).map(|(line, _)| Site::new(file, line as u32 + 1, 1)))
            .unwrap_or_else(|| Site::new(&format!("table {name}"), 1, 1));
        notes.push(Diagnostic::new(&site, "N_NO_PRODUCTION_WRITER",
            format!("{name}: no production insert path can bootstrap this table; fixtures and /seed exist only in dev (an existing role/reference may be required)"),
            "add an insert mutation with a declared service seat to bootstrap the first row; snapback4 guide deploy --section first admin").guide("deploy"));
    }
    notes.extend(fixture_notes(project, bound, fixture));
    notes
}
fn possible(rule: &RuleExpr, rows: &BTreeSet<String>) -> bool {
    match rule {
        RuleExpr::Deny => false,
        RuleExpr::Allow | RuleExpr::Public { .. } => true,
        RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. } => rows.contains(table),
        RuleExpr::And(items) => items.iter().all(|item| possible(item, rows)),
        RuleExpr::Or(items) => items.iter().any(|item| possible(item, rows)),
        RuleExpr::Eq(left, right) => {
            if let (RuleTerm::Literal(a), RuleTerm::Literal(b)) = (left, right) { return a == b; }
            let principal = match (left, right) { (RuleTerm::Viewer, RuleTerm::Literal(v)) | (RuleTerm::Literal(v), RuleTerm::Viewer) => v.as_str().ok(), _ => None };
            if principal.is_some_and(|p| p.starts_with("service:")) { return true; }
            if principal.is_some_and(|p| p.starts_with("dev:")) { return false; }
            left.references().chain(right.references()).all(|(table, _)| rows.contains(table))
        }
        // Unknown predicates are potentially satisfiable: this lint is not a theorem of reachability.
        RuleExpr::Ne(_, _) | RuleExpr::Compare(_, _, _) | RuleExpr::Not(_) => true,
    }
}
fn fixture_notes(project: &Project, bound: &Bound, fixture: Option<&String>) -> Vec<Diagnostic> {
    let path = fixture.map(std::path::PathBuf::from).unwrap_or_else(|| project.root.join("fixtures")).join(super::test_cases::FILE);
    let Ok(text) = std::fs::read_to_string(&path) else { return vec![]; };
    let mut notes = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("//") { continue; }
        let check = || -> Result<(), String> {
            let case: serde_json::Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
            let op = case["op"].as_str().ok_or("case needs op")?;
            let program = &bound.programs.iter().find(|p| p.program.name == op).ok_or_else(|| format!("unknown operation {op}"))?.program;
            let empty = serde_json::json!({});
            let args = case.get("args").unwrap_or(&empty).as_object().ok_or("args must be an object")?;
            for (name, kind) in &program.args {
                if !args.contains_key(name) && !kind.is_optional() && !matches!(kind, ArgType::Cursor) { return Err(format!("{op}: missing argument {name}")); }
            }
            for (name, value) in args {
                let kind = program.args.get(name).ok_or_else(|| format!("{op} takes no argument {name}"))?;
                // Saved answers are runtime values; never claim a type failure for one.
                if saved(value) { continue; }
                let value = wire::from_json(kind, value).map_err(|e| format!("{name}: {e}"))?;
                validate::validate_arg(&bound.schema, kind, &value, name).map_err(|e| e.to_string())?;
            }
            Ok(())
        };
        if let Err(reason) = check() {
            notes.push(Diagnostic::new(&Site::new(&path.to_string_lossy(), index as u32 + 1, 1), "N_FIXTURE_ARGUMENT_DRIFT", reason,
                "update this case's arguments to the operation's current signature; run snapback4 test").guide("testing"));
        }
    }
    notes
}
fn saved(value: &serde_json::Value) -> bool {
    match value { serde_json::Value::String(s) => s.starts_with('$') && s.len() > 1, serde_json::Value::Array(items) => items.iter().any(saved), serde_json::Value::Object(items) => items.values().any(saved), _ => false }
}
