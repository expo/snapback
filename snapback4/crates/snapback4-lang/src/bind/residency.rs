//! Execution facts shared by check, dev, the generated API and /schema.
use super::{Bound, catalog::Catalog};
use crate::diag::Diagnostic;
use snapback4_core::ir::{self, Expr, LoopDomain, Program, ProgramKind, Stmt};
use snapback4_core::schema::{Audience, Execution, ResidencySite, RuleExpr, Schema, SiteClass};
use std::collections::{BTreeMap, BTreeSet};

pub fn execution(schema: &Schema, program: &Program) -> Execution {
    let mut fact = Execution::default();
    for read in ir::read_sites(program) {
        fact.sites.push(site(schema, &read.site, &read.table, &read.index, read.kind));
        if let Some(table) = schema.tables.get(&read.table)
            && table.leave != snapback4_core::schema::LeavePolicy::DeliveredHistory
            && table.sync.as_ref().is_some_and(|sync| match &sync.audience { Audience::Target { table, .. } => schema.tables[table].expire.is_some(), _ => false }) {
            rule_sites(schema, &table.rules.read, &format!("{} temporary audience", read.site), &mut fact.sites, &mut BTreeSet::new());
        }
        // An expiring aggregate is recomputed from its source on the device.
        if let Some(maintain) = schema.maintain_for(&read.table)
            && schema.tables[&maintain.source].expire.is_some() {
            let index = schema.tables[&maintain.source].indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(&maintain.by)).map(|(name, _)| name.as_str()).unwrap_or("byId");
            fact.sites.push(site(schema, &read.site, &maintain.source, index, "aggregate source"));
        }
    }
    let mut requires = BTreeSet::new();
    inspect(&program.body, &mut requires, &mut fact.sites);
    fact.requires = requires.into_iter().collect();
    if program.native {
        fact.sites.push(ResidencySite { site: program.name.clone(), table: "native".into(), index: program.name.clone(), kind: "native".into(), class: SiteClass::Server, reason: "native read needs the app's module; held on a device with the module".into(), rewrite: "install the app's native module on this device".into() });
    }
    for (table, kind) in ir::write_tables(program) {
        if schema.tables.get(&table).is_none_or(|t| t.sync.is_none()) { fact.sites.push(site(schema, &format!("{kind} {table}"), &table, "byId", "write")); }
        if let Some(definition) = schema.tables.get(&table) {
            let rule = match kind { "insert" | "insert-if-absent" => &definition.rules.insert, "delete" => &definition.rules.delete, _ => &definition.rules.update };
            rule_sites(schema, rule, &format!("{kind} {table} rule"), &mut fact.sites, &mut BTreeSet::new());
            if kind == "upsert" { rule_sites(schema, &definition.rules.insert, &format!("upsert {table} insert rule"), &mut fact.sites, &mut BTreeSet::new()); }
            for constraint in &definition.constraints {
                if let snapback4_core::schema::Constraint::FinalExistsOnInsert { table, index, .. } = constraint {
                    fact.sites.push(site(schema, "after insert", table, index, "rule"));
                }
            }
        }
    }
    let server = fact.sites.iter().any(|site| site.class == SiteClass::Server);
    match program.kind {
        ProgramKind::Query => fact.runs = Some(if server { "server" } else { "device" }.into()),
        ProgramKind::Mutation => fact.predicts = Some(if server { "never" } else { "eligible" }.into()),
        ProgramKind::Job => fact.runs = Some("server".into()),
    }
    fact
}

fn site(schema: &Schema, location: &str, table: &str, index: &str, kind: &str) -> ResidencySite {
    let sync = schema.tables.get(table).and_then(|table| table.sync.as_ref());
    let (class, reason, rewrite) = match sync {
        None => (SiteClass::Server, format!("{kind} {table} by {index}: online only"), format!("sync {table} to its read-rule audience, or read a compact synced projection")),
        Some(sync) if sync.horizon.is_some() => (SiteClass::Horizon, format!("{kind} {table} by {index}: {}", sync.line()), "remove a redundant guard, or read a synced fact without a horizon".into()),
        Some(_) => (SiteClass::Held, format!("{kind} {table} by {index}: held, no horizon"), String::new()),
    };
    ResidencySite { site: location.into(), table: table.into(), index: index.into(), kind: kind.into(), class, reason, rewrite }
}

fn rule_sites(schema: &Schema, rule: &RuleExpr, location: &str, sites: &mut Vec<ResidencySite>, seen: &mut BTreeSet<String>) {
    match rule {
        RuleExpr::Exists { table, index, .. } => {
            sites.push(site(schema, location, table, index, "rule"));
            if seen.insert(table.clone()) && let Some(table) = schema.tables.get(table) { rule_sites(schema, &table.rules.read, location, sites, seen); }
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => for rule in rules { rule_sites(schema, rule, location, sites, seen); },
        RuleExpr::Not(rule) => rule_sites(schema, rule, location, sites, seen),
        _ => {}
    }
}

fn inspect(stmts: &[Stmt], codes: &mut BTreeSet<String>, sites: &mut Vec<ResidencySite>) {
    for stmt in stmts {
        match stmt {
            Stmt::Require { condition, code, .. } => { codes.insert(code.clone()); expr(condition, codes, sites); }
            Stmt::If { condition, then_body, else_body } => { expr(condition, codes, sites); inspect(then_body, codes, sites); inspect(else_body, codes, sites); }
            Stmt::For { domain, body, .. } => {
                match domain {
                    LoopDomain::Page(scan) => scan_exprs(scan, codes, sites),
                    LoopDomain::DerivedArray { value, .. } => expr(value, codes, sites),
                    LoopDomain::Recurse(recurse) => expr(&recurse.seed, codes, sites),
                    _ => {}
                }
                inspect(body, codes, sites);
            }
            Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) | Stmt::Emit { payload: value, .. } => expr(value, codes, sites),
            Stmt::Check { condition, current } => { expr(condition, codes, sites); for key in &current.key { expr(key, codes, sites); } }
            Stmt::Insert { row, .. } | Stmt::InsertIfAbsent { row, .. } => expr(row, codes, sites),
            Stmt::Update { key, patch, .. } => { expr(key, codes, sites); expr(patch, codes, sites); }
            Stmt::Upsert { key, row, .. } => { expr(key, codes, sites); expr(row, codes, sites); }
            Stmt::Delete { key, .. } => expr(key, codes, sites),
            _ => {}
        }
    }
}
fn scan_exprs(scan: &ir::Scan, codes: &mut BTreeSet<String>, sites: &mut Vec<ResidencySite>) {
    for key in &scan.prefix { let (ir::IndexKeyExpr::Scalar(value) | ir::IndexKeyExpr::WordPrefix(value)) = key; expr(value, codes, sites); }
    if let Some(after) = &scan.after { expr(after, codes, sites); }
}
fn expr(value: &Expr, codes: &mut BTreeSet<String>, sites: &mut Vec<ResidencySite>) {
    match value {
        Expr::Builtin { builtin, args } => {
            if *builtin == ir::Builtin::Connected { sites.push(ResidencySite { site: "connected".into(), table: "connected".into(), index: "principal".into(), kind: "presence".into(), class: SiteClass::Server, reason: "connected[principal] is known only by the server".into(), rewrite: "remove connected from this query; observe presence separately online".into() }); }
            for value in args { expr(value, codes, sites); }
        }
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => expr(base, codes, sites),
        Expr::Array(values) => for value in values { expr(value, codes, sites); },
        Expr::Object(fields) => for value in fields.values() { expr(value, codes, sites); },
        Expr::Binary { left, right, .. } => { expr(left, codes, sites); expr(right, codes, sites); }
        Expr::Get(read) | Expr::Exists(read) => for key in &read.key { expr(key, codes, sites); },
        Expr::Scan(scan) => scan_exprs(scan, codes, sites),
        Expr::Merge(merge) => for lane in &merge.lanes { inspect(&lane.setup, codes, sites); scan_exprs(&lane.scan, codes, sites); if let Some(source) = &lane.source { scan_exprs(source, codes, sites); } },
        _ => {}
    }
}

pub(super) fn maintain_notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    schema.synced().filter_map(|(name, table, sync)| {
        let source = table.residency.inherited_from.as_ref()?;
        match &sync.audience {
            Audience::Column(_) => return None,
            Audience::Target { table: target, .. } => {
                if let Ok(binding) = snapback4_core::schema::audience_binding(schema, name, table, sync)
                    && schema.tables[target].cap(&binding.columns).is_some() && schema.maintain_for(name)?.by.len() == binding.columns.len() { return None; }
            }
            Audience::Public => {}
        }
        Some(Diagnostic::new(&catalog.site_for(&format!("tables.{name}")), "N_MAINTAIN_SYNCED", format!("maintain {name}: {} inherited from {source}; one value row per {} reaches {}", sync.line(), schema.maintain_for(name)?.by.join(", "), if sync.audience == Audience::Public { "every device" } else { "every member of the group" }), "add `online only` to the maintain to opt out of inherited sync; measure with `test --residency`").guide("residency"))
    }).collect()
}

// @ref LLP 3000.007#6.4 — compare facts with the last successful generation, never a failed edit.
pub fn change_notes(bound: &Bound, previous: &BTreeMap<String, Execution>) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for program in &bound.programs {
        let name = &program.program.name;
        let (Some(old), Some(new)) = (previous.get(name), bound.schema.operations.get(name)) else { continue };
        let lost = old.predicts.as_deref() == Some("eligible") && new.predicts.as_deref() == Some("never");
        let moved = old.runs.as_deref() == Some("device") && new.runs.as_deref() == Some("server");
        // The acceptance case's added id guard stays statically eligible, but
        // can now queue without a row. Name that new horizon risk as well.
        let new_horizon = old.predicts.as_deref() == Some("eligible") && new.predicts.as_deref() == Some("eligible");
        for site in &new.sites {
            let new_risk = new_horizon && site.class == SiteClass::Horizon && !old.sites.iter().any(|before| before.class == site.class && before.table == site.table && before.index == site.index && before.kind == site.kind);
            if ((lost || moved) && site.class == SiteClass::Server) || new_risk {
                let message = if new_risk { "remains eligible; may queue without a row past the horizon" } else if moved { "now runs on the server" } else { "is no longer eligible to predict; queued without a row" };
                notes.push(Diagnostic::new(&program.site, if moved { "N_NOW_SERVER" } else { "N_NOT_PREDICTABLE" }, format!("{name} {message}: {} (site {})", site.reason, site.site), &site.rewrite).guide("residency"));
            }
        }
    }
    notes
}

pub fn table_line(schema: &Schema, name: &str) -> String {
    let table = &schema.tables[name];
    match &table.sync {
        Some(sync) => format!("{}{}{}", sync.line(), if table.residency.inferred { " (from the read rule)" } else { "" }, table.residency.inherited_from.as_ref().map(|source| format!(" (inherited from {source})")).unwrap_or_default()),
        None => format!("online only{}", if table.residency.online_only { "" } else { " (no sync line)" }),
    }
}

pub fn operation_lines(name: &str, fact: &Execution) -> String {
    let word = match (fact.runs.as_deref(), fact.predicts.as_deref()) { (Some(runs), _) => format!("runs: {runs}"), (_, Some("eligible")) => "predicts: eligible".into(), _ => "predicts: never; queued without a row".into() };
    let mut lines = vec![format!("  {name}: {word}")];
    for site in &fact.sites {
        lines.push(format!("    {:?}: {} (site {}){}", site.class, site.reason, site.site, if site.class == SiteClass::Horizon { if fact.predicts.as_deref() == Some("eligible") { "; may queue without a row past the horizon" } else { "; server past the horizon" } } else { "" }));
        if site.class != SiteClass::Held { lines.push(format!("      rewrite: {}", site.rewrite)); }
    }
    lines.join("\n")
}
