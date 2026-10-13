//! Read-only production and fixture authoring notes; never an execution gate.
use std::collections::{BTreeMap, BTreeSet};
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
    let blocked: BTreeSet<String> = bound.schema.visible_tables().filter(|(name, table)|
        table.ephemeral.is_none() && bound.schema.maintain_for(name).is_none() && !reachable.contains(name.as_str()))
        .map(|(name, _)| name.clone()).collect();
    let site = |name: &str| sources.iter().find_map(|(file, source)| source.lines().enumerate()
        .find(|(_, line)| line.trim_start().starts_with(&format!("table {name}:")))
        .map(|(line, _)| Site::new(file, line as u32 + 1, 1)))
        .unwrap_or_else(|| Site::new(&format!("table {name}"), 1, 1));
    if !bound.personas.is_empty() && !bound.schema.auth.password && !bound.schema.auth.guests {
        {
            let at = blocked.first().map(|name| site(name)).unwrap_or_else(|| Site::new("schema", 1, 1));
            notes.push(Diagnostic::new(&at, "N_NO_PRODUCTION_WRITER",
                format!("persona-only: no production identity{}", if blocked.is_empty() { String::new() } else { format!("; review bootstrap for {}", blocked.iter().cloned().collect::<Vec<_>>().join(", ")) }),
                "add use identity password, map roles and relationships to account principals, and provision the first admin; snapback4 guide deploy --section first admin").guide("deploy"));
        }
    } else {
        // @ref LLP 3000.036.002#3 — root components explain blocked descendants once.
        let graph: BTreeMap<String, BTreeSet<String>> = blocked.iter().map(|name| {
            let table = bound.schema.table(name).unwrap();
            let mut deps = BTreeSet::new();
            if writers.contains(name) {
                dependencies(&table.rules.insert, &mut deps);
                if let Some(through) = &table.through { deps.insert(through.parent.clone()); }
            }
            deps.retain(|dep| blocked.contains(dep));
            (name.clone(), deps)
        }).collect();
        let closure = |name: &str| {
            let mut seen = BTreeSet::from([name.to_owned()]);
            loop {
                let next: BTreeSet<_> = seen.iter().flat_map(|name| graph[name].iter().cloned()).collect();
                let count = seen.len(); seen.extend(next);
                if seen.len() == count { break; }
            }
            seen
        };
        let paths: BTreeMap<_, _> = blocked.iter().map(|name| (name.clone(), closure(name))).collect();
        for root in &blocked {
            let component: BTreeSet<_> = paths[root].iter().filter(|dep| paths[*dep].contains(root)).cloned().collect();
            if component.first() != Some(root) || paths[root].iter().any(|dep| !component.contains(dep)) { continue; }
            let dependents: Vec<_> = blocked.iter().filter(|name| !component.contains(*name) && paths[*name].contains(root)).cloned().collect();
            let cycle = if component.len() > 1 { format!(" (bootstrap cycle: {})", component.iter().cloned().collect::<Vec<_>>().join(", ")) } else { String::new() };
            let dependent = if dependents.is_empty() { String::new() } else { format!("; {} depend on it", dependents.join(", ")) };
            notes.push(Diagnostic::new(&site(root), "N_NO_PRODUCTION_WRITER",
                format!("{root}: no production writer can bootstrap this root{cycle}{dependent}; fixtures and /seed are dev-only"),
                "add an insert mutation with a declared service seat to bootstrap the first row; snapback4 guide deploy --section first admin").guide("deploy"));
        }
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
            if let Some(name) = principal.and_then(|p| p.strip_prefix("service:")) {
                return !name.is_empty() && name.len() <= 64 && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-');
            }
            if principal.is_some_and(|p| p.starts_with("dev:")) { return false; }
            left.references().chain(right.references()).all(|(table, _)| rows.contains(table))
        }
        // Unknown predicates are potentially satisfiable: this lint is not a theorem of reachability.
        RuleExpr::Ne(_, _) | RuleExpr::Compare(_, _, _) | RuleExpr::Not(_) => true,
    }
}
fn dependencies(rule: &RuleExpr, out: &mut BTreeSet<String>) {
    match rule {
        RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. } => { out.insert(table.clone()); }
        RuleExpr::And(items) | RuleExpr::Or(items) => for item in items { dependencies(item, out); },
        RuleExpr::Eq(left, right) => out.extend(left.references().chain(right.references()).map(|(table, _)| table.to_owned())),
        _ => {}
    }
}
fn fixture_notes(project: &Project, bound: &Bound, fixture: Option<&String>) -> Vec<Diagnostic> {
    let path = fixture.map(std::path::PathBuf::from).unwrap_or_else(|| project.root.join("fixtures")).join(super::test_cases::FILE);
    let Ok(text) = std::fs::read_to_string(&path) else { return vec![]; };
    let mut notes = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("//") { continue; }
        let case: Result<serde_json::Value, _> = serde_json::from_str(line);
        // Shared cases may include operations added after the schema being checked.
        if case.as_ref().ok().and_then(|case| case["op"].as_str())
            .is_some_and(|op| !bound.programs.iter().any(|p| p.program.name == op)) { continue; }
        let expects_input = case.as_ref().ok().is_some_and(|case| case["expect"] == "E_INPUT"
            && case["op"].as_str().is_some_and(|op| bound.programs.iter().any(|p| p.program.name == op)));
        let check = || -> Result<(), String> {
            let case = case.as_ref().map_err(|e| e.to_string())?;
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
            // Only argument refusals satisfy E_INPUT; malformed case JSON/metadata does not.
            if expects_input && case.as_ref().ok().is_some_and(|case| case.get("args").is_none_or(|args| args.is_object())) { continue; }
            notes.push(Diagnostic::new(&Site::new(&path.to_string_lossy(), index as u32 + 1, 1), "N_FIXTURE_ARGUMENT_DRIFT", reason,
                "update this case's arguments to the operation's current signature; run snapback4 test").guide("testing"));
        }
    }
    notes
}
fn saved(value: &serde_json::Value) -> bool {
    match value { serde_json::Value::String(s) => s.starts_with('$') && s.len() > 1, serde_json::Value::Array(items) => items.iter().any(saved), serde_json::Value::Object(items) => items.values().any(saved), _ => false }
}
