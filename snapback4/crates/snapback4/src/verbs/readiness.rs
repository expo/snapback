//! Read-only production and fixture authoring notes; never an execution gate.
mod production;
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
                format!("persona-only: safe to ignore without `use identity`; no production identity{}", if blocked.is_empty() { String::new() } else { format!("; review bootstrap for {}", blocked.iter().cloned().collect::<Vec<_>>().join(", ")) }),
                "safe to ignore without `use identity`; when moving to production, add use identity password, map roles and relationships to account principals, and provision the first admin; snapback4 guide deploy --section first admin").guide("deploy"));
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
                bootstrap_recipe(bound, root)).guide("deploy"));
        }
    }
    notes.extend(fixture_notes(project, bound, fixture));
    notes
}
fn bootstrap_recipe(bound: &Bound, table: &str) -> String {
    let writers: Vec<_> = bound.programs.iter().filter(|p| ir::write_tables(&p.program).iter().any(|(target,effect)| target==table && matches!(*effect,"insert"|"upsert"))).map(|p|p.program.name.clone()).collect();
    let missing = if writers.is_empty() { format!("missing mutation path: no mutation inserts {table}") }
        else { format!("missing service-seat bootstrap path through {} (their {table} insert rule depends on rows not yet provisioned)",writers.join(", ")) };
    let proposal = production::proposal(&bound.schema, table);
    format!("{missing}; add a bootstrap{table} mutation that requires `viewer = 'service:ops'`, allow that branch in {table}'s insert rule, and make its required probes readable to the seat. Mint `snapback4 token --service ops --release ./deployment`, then call the mutation with the real account principal and its bearer token. For synced rosters use the independent seat-or-member branch; snapback4 guide deploy --section first admin\n{proposal}")
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
    let now = snapback4_core::now_ms();
    for (index, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("//") { continue; }
        let case: Result<serde_json::Value, _> = serde_json::from_str(line);
        // Shared cases may include operations added after the schema being checked.
        if case.as_ref().ok().and_then(|case| case["op"].as_str())
            .is_some_and(|op| !bound.programs.iter().any(|p| p.program.name == op)) { continue; }
        // @ref LLP 3000.036.002#9 — any authored refusal case owns its deliberately invalid arguments.
        let expects_refusal = case.as_ref().ok().is_some_and(|case| {
            super::test_cases::validate(case).is_ok() && case["expect"].as_str().is_some_and(|expect| {
                !matches!(expect, "ok" | "complete" | "capped" | "sent")
                    && case["op"].as_str().is_some_and(|op| bound.programs.iter().any(|p| p.program.name == op))
            })
        });
        let check = || -> Result<(), String> {
            let case = case.as_ref().map_err(|e| e.to_string())?;
            let op = case["op"].as_str().ok_or("case needs op")?;
            let program = &bound.programs.iter().find(|p| p.program.name == op).ok_or_else(|| format!("unknown operation {op}"))?.program;
            let mut args = super::test_cases::literal_escapes(case.get("args").cloned().unwrap_or_else(|| serde_json::json!({})));
            super::test_fixture::argument_times(&program.args, &mut args, now)?;
            let args = args.as_object().ok_or("args must be an object")?;
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
            // An authored refusal expectation may deliberately supply values
            // outside the operation's accepted input domain.
            let time_error = reason.contains("E_FIXTURE_TIME:");
            if expects_refusal && !time_error { continue; }
            notes.push(Diagnostic::new(&Site::new(&path.to_string_lossy(), index as u32 + 1, 1), if time_error { "E_FIXTURE_TIME" } else { "N_FIXTURE_ARGUMENT_DRIFT" }, reason,
                "update this case's arguments to the operation's current signature; run snapback4 test").guide("testing"));
        }
    }
    notes
}
fn saved(value: &serde_json::Value) -> bool {
    match value { serde_json::Value::String(s) => s.starts_with('$') && s.len() > 1, serde_json::Value::Array(items) => items.iter().any(saved), serde_json::Value::Object(items) => items.values().any(saved), _ => false }
}
