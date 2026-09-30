//! Execution facts shared by check, dev, the generated API and /schema.
use super::{Bound, catalog::Catalog};
use crate::diag::Diagnostic;
use snapback4_core::ir::{self, Expr, LoopDomain, Program, ProgramKind, Stmt};
use snapback4_core::schema::{Audience, Execution, ResidencySite, RuleExpr, Schema, SiteClass};
use std::collections::{BTreeMap, BTreeSet};
mod presence;
mod inserts;
mod horizons;
mod components;
mod effect_reads;
pub(super) use horizons::{guard_notes, incompatible_horizon_pages, needs_whole_partition, sync_order_notes};

pub fn execution(schema: &Schema, program: &Program) -> Execution {
    execution_with_presence(schema, program, None)
}

pub(super) fn presence_facts(schema: &Schema, program: &Program, ownership: &super::program::setup::Ownership, sources: &[(Expr, crate::diag::Site, String)]) -> Execution {
    let mut fact = Execution::default();
    fact.prediction_skips = effect_reads::plan(schema, program);
    let local = effect_reads::prediction_program(program, &fact.prediction_skips);
    presence::inspect(program, &local.body, &mut fact, ownership, sources);
    let retained: BTreeSet<_> = ir::read_sites(&local).into_iter().map(|read| read.site).collect();
    for read in ir::read_sites(program).into_iter().filter(|read| !retained.contains(&read.site)) {
        fact.effect_payload_reads.push(ResidencySite {
            reason: format!("{} {} by {}: server-only, feeds an effect", read.kind, read.table, read.index),
            site: read.site, table: read.table, index: read.index, kind: read.kind.into(),
            class: SiteClass::Server, rewrite: String::new(),
        });
    }
    fact
}

pub(super) fn execution_with_presence(schema: &Schema, program: &Program, presence: Option<&Execution>) -> Execution {
    let mut fact = Execution::default();
    let presence = (program.kind == ProgramKind::Mutation).then(|| presence.cloned().unwrap_or_else(|| presence_facts(schema, program, &BTreeMap::new(), &[])));
    for read in ir::read_sites(program) {
        if presence.as_ref().is_some_and(|fact| fact.effect_payload_reads.iter().any(|site| site.site == read.site)) { continue; }
        fact.sites.push(site(schema, &read.site, &read.table, &read.index, read.kind));
        if let Some(table) = schema.tables.get(&read.table)
            && table.leave != snapback4_core::schema::LeavePolicy::DeliveredHistory
            && table.sync.as_ref().is_some_and(|sync| match &sync.audience { Audience::Target { table, .. } => schema.tables[table].is_expiring(), _ => false }) {
            rule_sites(schema, &table.rules.read, &format!("{} temporary audience", read.site), &mut fact.sites, &mut BTreeSet::new());
        }
        aggregate_source_site(schema, &read.table, &read.site, &mut fact.sites);
        let parent = schema.tables.get(&read.table).and_then(|t|t.through.as_ref())
            .or_else(||schema.maintain_for(&read.table).and_then(|m|m.parent_key.as_ref()));
        if let Some(parent) = parent {
            fact.sites.push(site(schema,&read.site,&parent.parent,"byId","read through parent"));
            rule_sites(schema,&schema.tables[&parent.parent].rules.read,&read.site,&mut fact.sites,&mut BTreeSet::new());
        }
        if matches!(read.index.as_str(), "byReaderTime" | "byReaderPage") {
            if let Some(t) = schema.timelines.iter().find(|t| read.table == t.table("Feed")) {
                fact.sites.push(site(schema, &read.site, &t.table("Work"), "byReader", "timeline pending work"));
            }
        }
    }
    let mut requires = BTreeSet::new();
    let mut inspected_sites = Vec::new();
    inspect(schema, &program.body, &mut requires, &mut inspected_sites);
    for refined in inspected_sites.iter().filter(|site| site.kind == "timeline event") {
        for original in fact.sites.iter_mut().filter(|site| site.site == refined.site && site.table == refined.table && site.index == refined.index) {
            original.class = refined.class.clone();
            original.reason = refined.reason.clone();
            original.rewrite = refined.rewrite.clone();
        }
    }
    if program.kind == ProgramKind::Mutation {
        let presence = presence.unwrap();
        fact.connected_effects_only = presence.connected_effects_only;
        fact.prediction_guards = presence.prediction_guards;
        fact.prediction_skips = presence.prediction_skips;
        fact.effect_payload_reads = presence.effect_payload_reads;
        fact.sites.extend(presence.sites);
    }
    fact.sites.extend(inspected_sites.into_iter().filter(|site| site.kind != "timeline event" && if program.kind == ProgramKind::Mutation { site.kind != "presence" } else { site.kind == "presence" }));
    fact.requires = requires.into_iter().collect();
    if program.native {
        fact.sites.push(ResidencySite { site: program.name.clone(), table: "native".into(), index: program.name.clone(), kind: "native".into(), class: SiteClass::Server, reason: "native read needs the app's module; held on a device with the module".into(), rewrite: "install the app's native module on this device".into() });
    }
    super::timeline::aggregate_sites(schema, program, &mut fact);
    for (table, kind) in ir::write_tables(program) {
        super::timeline::write_site(schema, &table, kind, &mut fact);
        if !matches!(kind, "insert" | "insert-if-absent") && schema.receipts.iter().any(|f| f.members == table || f.runs == table) {
            fact.sites.push(ResidencySite { site: format!("{kind} {table}"), table: table.clone(), index: "byId".into(), kind: "receipt accounting".into(), class: SiteClass::Server,
                reason: "receipt membership changes and progress need settled state".into(), rewrite: "queue until server settlement".into() });
        }
        if schema.tables.get(&table).is_none_or(|t| t.sync.is_none()) { fact.sites.push(site(schema, &format!("{kind} {table}"), &table, "byId", "write")); }
        if let Some(definition) = schema.tables.get(&table) {
            if matches!(kind, "insert" | "insert-if-absent" | "upsert") {
                if let Some(parent) = &definition.through {
                    if kind == "insert-if-absent" {
                        let reason = format!("{kind} on a read-through child queues without a row; use upsert for a set-state write (guide prediction)");
                        fact.sites.push(ResidencySite { site: format!("{kind} {table}"), table: table.clone(), index: "byId".into(), kind: kind.into(), class: SiteClass::Server,
                            reason, rewrite: String::new() });
                    }
                    fact.sites.push(site(schema,&format!("{kind} {table}"),&parent.parent,"byId","read through capture"));
                    rule_sites(schema,&schema.tables[&parent.parent].rules.read,&format!("{kind} {table} parent rule"),&mut fact.sites,&mut BTreeSet::new());
                }
                for (path, recorded) in &definition.recorded {
                    let mut dependency = site(schema, &format!("{kind} {table}"), &recorded.table, "byId", "recorded attribution");
                    dependency.reason = format!("{table}.{path} implicitly reads {}.byId: prediction needs the target row live and covered by the current partition; otherwise queues unpredicted", recorded.table);
                    fact.sites.push(dependency);
                }
            }
            let rule = match kind { "insert" | "insert-if-absent" => &definition.rules.insert, "delete" => &definition.rules.delete, _ => &definition.rules.update };
            // Owner-only point updates do not evaluate an ordinary row grant.
            // Named transitions still run and retain every dependency.
            if kind != "update" || definition.update_transition || !field_only_updates(&program.body, &table, definition) {
                rule_sites(schema, rule, &format!("{kind} {table} rule"), &mut fact.sites, &mut BTreeSet::new());
            }
            if kind == "upsert" { rule_sites(schema, &definition.rules.insert, &format!("upsert {table} insert rule"), &mut fact.sites, &mut BTreeSet::new()); }
            // Final-exists constraints retain declaration order; target and
            // index are not identities when several declarations probe them.
            for (ordinal, (target, index)) in definition.constraints.iter().filter_map(|constraint| match constraint {
                snapback4_core::schema::Constraint::FinalExistsOnInsert { table, index, .. } => Some((table, index)),
                _ => None,
            }).enumerate() {
                let location = format!("after insert {table} constraint {ordinal}");
                fact.sites.push(site(schema, &location, target, index, "rule"));
                aggregate_source_site(schema, target, &location, &mut fact.sites);
            }
        }
    }
    let server = fact.sites.iter().any(|site| site.class == SiteClass::Server);
    match program.kind {
        ProgramKind::Query => fact.runs = Some(if server { "server" } else { "device" }.into()),
        ProgramKind::Mutation => fact.predicts = Some(if server { "never" } else { "eligible" }.into()),
        ProgramKind::Job => fact.runs = Some("server".into()),
        ProgramKind::Action => { fact.runs = Some("server".into()); fact.predicts = Some("never".into()); }
    }
    fact.components = components::plan(program);
    fact
}

fn field_only_updates(body: &[Stmt], table: &str, definition: &snapback4_core::schema::Table) -> bool {
    let owned = |patch: &Expr| matches!(patch, Expr::Object(fields) if !fields.is_empty() && fields.keys().all(|field| definition.written_by.contains_key(field)));
    body.iter().all(|stmt| match stmt {
        Stmt::Update { table: target, patch, .. } if target == table => owned(patch),
        Stmt::WriteTarget { target, patch, upsert: false, .. } if target.table == table => owned(patch),
        Stmt::If { then_body, else_body, .. } => field_only_updates(then_body, table, definition) && field_only_updates(else_body, table, definition),
        Stmt::For { body, .. } => field_only_updates(body, table, definition),
        _ => true,
    })
}

// @ref LLP 3000.007#6.3 — the printed reason belongs to its read, write or rule declaration, in every residency class.
pub(super) fn locate_sites(catalog: &Catalog, program: &super::BoundProgram, fact: &mut Execution) {
    // Use the same source map and chosen-index explanation for both classes.
    let effects = std::mem::take(&mut fact.effect_payload_reads);
    if !effects.is_empty() {
        let mut effect_fact = Execution { sites: effects, ..Execution::default() };
        locate_sites(catalog, program, &mut effect_fact);
        fact.effect_payload_reads = effect_fact.sites;
    }
    let mut located = Vec::new();
    for mut site in std::mem::take(&mut fact.sites) {
        if matches!(site.kind.as_str(), "point" | "scan") && let Some(selection) = program.selections.get(&site.site) {
            site.reason.push_str(&format!("; {selection}"));
        }
        let mut locations = BTreeSet::new();
        if let Some((location, name)) = program.sources.get(&site.site) {
            let name = program.canonical_sources.get(&site.site).unwrap_or(name);
            locations.insert(format!("{location} ({name})"));
        } else if let Some(read) = site.site.strip_suffix(" temporary audience") {
            if let Some((location, name)) = program.sources.get(read) {
                let name = program.canonical_sources.get(read).unwrap_or(name);
                locations.insert(format!("{location} ({name}; temporary audience rule: {} by {})", site.table, site.index));
            }
        } else if let Some(path) = site.site.strip_prefix("after insert ") {
            if let Some((table, ordinal)) = path.split_once(" constraint ")
                && let Some(info) = catalog.tables.get(table)
                && let Some((_, location)) = ordinal.parse::<usize>().ok().and_then(|ordinal| info.decl.final_exists.get(ordinal)) {
                locations.insert(format!("{location} ({table} after insert rule: {} by {})", site.table, site.index));
            }
        } else if site.site.ends_with(" rule") {
            let parts: Vec<_> = site.site.split_whitespace().collect();
            if let [verb, table, rest @ ..] = parts.as_slice() && catalog.tables.contains_key(*table) {
                let effect = if rest == ["insert", "rule"] { "insert" } else if *verb == "upsert" { "update" } else { verb };
                let location = catalog.site_for(&format!("tables.{table}.rules.{effect}"));
                locations.insert(format!("{location} ({table} {effect} rule: {} by {})", site.table, site.index));
            }
        } else if site.kind == "native" {
            locations.insert(format!("{} (native {})", program.site, program.program.name));
        } else {
            // The IR coalesces writes by table. Expand those facts to all
            // retained source occurrences, including writes inside helpers.
            let write = site.site.replace("insert if absent ", "insert ");
            for (key, (location, name)) in &program.sources {
                if (key.starts_with("write/") && *name == write) || (site.site == "connected" && key.starts_with("presence/")) {
                    locations.insert(format!("{location} ({name})"));
                }
            }
        }
        if locations.is_empty() && site.site.starts_with("programs.") {
            // A lowered helper can have no separate source expression. Its
            // owning operation is real source; never print an IR path.
            site.site = format!("{} ({}: {} {} by {})", program.site, program.program.name, site.kind, site.table, site.index);
        }
        if locations.is_empty() { located.push(site); }
        else {
            for location in locations {
                let mut copy = site.clone();
                copy.site = location;
                if !located.contains(&copy) { located.push(copy); }
            }
        }
    }
    fact.sites = located;
}

fn site(schema: &Schema, location: &str, table: &str, index: &str, kind: &str) -> ResidencySite {
    if let Some(maintain) = schema.maintain_for(table).filter(|m| m.parent_key.is_some()) {
        let mut dependency = site(schema, location, &maintain.source, index, "parent-key aggregate source");
        dependency.reason = format!("{table}: counts current held {} rows after resolving its parent; {}", maintain.source, dependency.reason);
        return dependency;
    }
    let sync = schema.tables.get(table).and_then(|table| table.sync.as_ref());
    let (class, reason, rewrite) = match sync {
        _ if snapback4_core::schema::timeline::partial_read(schema, table, index, &[]) =>
            (SiteClass::Horizon, format!("{kind} {table} by {index}: Following events follow their sources; a missing event or a range with an unheld kind withholds the query"),
                "read the Following view with held cards, or answer this event read on the server".into()),
        _ if schema.maintain_subset_unknown(table) => (SiteClass::Server, format!("{kind} {table} by {index}: public source has subset delivery; aggregate coverage is unknown"), "read this aggregate on the server, or sync its public source to every device".into()),
        None => (SiteClass::Server, format!("{kind} {table} by {index}: online only"), if schema.maintain_for(table).is_some() { format!("remove `online only` from view {table} to inherit its source's sync, or read a compact synced projection") } else { format!("sync {table} to its read-rule audience, or read a compact synced projection") }),
        Some(sync) if sync.horizon.is_some() => (SiteClass::Horizon, format!("{kind} {table} by {index}: {}", sync.line()), if kind == "write target" { String::new() } else { "remove a redundant guard, or read a synced fact without a horizon".into() }),
        Some(_) => (SiteClass::Held, format!("{kind} {table} by {index}: held, no horizon"), String::new()),
    };
    ResidencySite { site: location.into(), table: table.into(), index: index.into(), kind: kind.into(), class, reason, rewrite }
}

// @ref LLP 3000.007#6.2 — rule probes and explicit reads both need the expiring source to establish a live aggregate on a device.
fn aggregate_source_site(schema: &Schema, table: &str, location: &str, sites: &mut Vec<ResidencySite>) {
    if let Some(maintain) = schema.maintain_for(table)
        && schema.tables[&maintain.source].is_expiring() {
        let index = schema.tables[&maintain.source].indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(&maintain.by)).map(|(name, _)| name.as_str()).unwrap_or("byId");
        sites.push(site(schema, location, &maintain.source, index, "aggregate source"));
    }
}

fn rule_sites(schema: &Schema, rule: &RuleExpr, location: &str, sites: &mut Vec<ResidencySite>, seen: &mut BTreeSet<String>) {
    match rule {
        RuleExpr::Exists { table, index, key, .. } => {
            let values: Vec<_> = key.iter().map(|term| match term { snapback4_core::schema::RuleTerm::Literal(value) => value.clone(), _ => snapback4_core::Value::Null }).collect();
            sites.push(event_site(schema, location, table, index, "rule", &values));
            aggregate_source_site(schema, table, location, sites);
            if seen.insert(table.clone()) && let Some(table) = schema.tables.get(table) { rule_sites(schema, &table.rules.read, location, sites, seen); }
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => for rule in rules { rule_sites(schema, rule, location, sites, seen); },
        RuleExpr::Not(rule) => rule_sites(schema, rule, location, sites, seen),
        _ => {}
    }
}

fn inspect(schema: &Schema, stmts: &[Stmt], codes: &mut BTreeSet<String>, sites: &mut Vec<ResidencySite>) {
    let mut known = BTreeMap::new();
    let mut minted_aliases = BTreeSet::new();
    for stmt in stmts {
        inserts::track_minted_alias(stmt, &mut known, &mut minted_aliases);
        match stmt {
            Stmt::Require { condition, code, .. } => { codes.insert(code.clone()); expr(schema, condition, codes, sites); }
            Stmt::If { condition, then_body, else_body } => { expr(schema, condition, codes, sites); inspect(schema, then_body, codes, sites); inspect(schema, else_body, codes, sites); }
            Stmt::For { domain, body, .. } => {
                match domain {
                    LoopDomain::Page(scan) => scan_exprs(schema, scan, codes, sites),
                    LoopDomain::ExpressionRange { start, end_exclusive } => { expr(schema, start, codes, sites); expr(schema, end_exclusive, codes, sites); }
                    LoopDomain::DerivedArray { value, .. } => expr(schema, value, codes, sites),
                    LoopDomain::Recurse(recurse) => expr(schema, &recurse.seed, codes, sites),
                    _ => {}
                }
                inspect(schema, body, codes, sites);
            }
            Stmt::Const { name, value } => { known.insert(name.clone(), inserts::image(value, &known)); expr(schema, value, codes, sites); }
            Stmt::Let { name, value } if name.starts_with("$value") => { known.insert(name.clone(), inserts::image(value, &known)); expr(schema, value, codes, sites); }
            Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) => expr(schema, value, codes, sites),
            Stmt::Emit { payload: value, once, .. } => { expr(schema, value, codes, sites); if let Some(value) = once { expr(schema, value, codes, sites); } },
            Stmt::Check { condition, current } => { expr(schema, condition, codes, sites); for key in &current.key { expr(schema, key, codes, sites); } }
            Stmt::Insert { row, .. } => expr(schema, row, codes, sites),
            Stmt::InsertIfAbsent { table, row, .. } => {
                sites.push(inserts::insert_site(schema, &format!("insert if absent {table}"), table, None, &inserts::image(row, &known)));
                expr(schema, row, codes, sites);
            }
            Stmt::Update { key, patch, .. } => { expr(schema, key, codes, sites); expr(schema, patch, codes, sites); }
            Stmt::Upsert { table, key, row } => {
                sites.push(inserts::insert_site(schema, "upsert", table, Some(("byId", std::slice::from_ref(key))), &inserts::image(row, &known)));
                expr(schema, key, codes, sites); expr(schema, row, codes, sites);
            }
            Stmt::WriteTarget { target, patch, condition, upsert, .. } => {
                if *upsert { sites.push(inserts::insert_site(schema, &target.site, &target.table, Some((&target.index, &target.key)), &inserts::image(patch, &known))); }
                for key in &target.key { expr(schema, key, codes, sites); }
                expr(schema, patch, codes, sites);
                if let Some(condition) = condition { inspect(schema, &condition.setup, codes, sites); expr(schema, &condition.value, codes, sites); }
            }
            Stmt::Delete { key, .. } => expr(schema, key, codes, sites),
            Stmt::DeleteTarget { target } => expr(schema, &Expr::Get(target.clone()), codes, sites),
            _ => {}
        }
    }
}
fn scan_exprs(schema: &Schema, scan: &ir::Scan, codes: &mut BTreeSet<String>, sites: &mut Vec<ResidencySite>) {
    if schema.timelines.iter().any(|t| scan.table == t.table("Posts")) {
        let key = scan.prefix.iter().map(|part| match part { ir::IndexKeyExpr::Scalar(Expr::Literal(v)) => v.clone(), _ => snapback4_core::Value::Null }).collect::<Vec<_>>();
        sites.push(event_site(schema, &scan.site, &scan.table, &scan.index, "timeline event", &key));
    }
    if let Some(filter) = &scan.filter { expr(schema, filter, codes, sites); }
    for key in &scan.prefix { let (ir::IndexKeyExpr::Scalar(value) | ir::IndexKeyExpr::WordPrefix(value)) = key; expr(schema, value, codes, sites); }
    if let Some(after) = &scan.after { expr(schema, after, codes, sites); }
    if let Some(range) = &scan.range {
        for value in [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten() { expr(schema, value, codes, sites); }
    }
}
fn expr(schema: &Schema, value: &Expr, codes: &mut BTreeSet<String>, sites: &mut Vec<ResidencySite>) {
    match value {
        Expr::Block { body, value } => { inspect(schema, body, codes, sites); expr(schema, value, codes, sites); }
        Expr::Builtin { builtin, args } => {
            if *builtin == ir::Builtin::Connected { sites.push(ResidencySite { site: "connected".into(), table: "connected".into(), index: "principal".into(), kind: "presence".into(), class: SiteClass::Server, reason: "connected[principal] is known only by the server".into(), rewrite: "remove connected from this query; observe presence separately online".into() }); }
            for value in args { expr(schema, value, codes, sites); }
        }
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => expr(schema, base, codes, sites),
        Expr::Array(values) => for value in values { expr(schema, value, codes, sites); },
        Expr::Object(fields) => for value in fields.values() { expr(schema, value, codes, sites); },
        Expr::Shape { base, fields } => { expr(schema, base, codes, sites); for value in fields.values() { expr(schema, value, codes, sites); } }
        Expr::Binary { left, right, .. } => { expr(schema, left, codes, sites); expr(schema, right, codes, sites); }
        Expr::Get(read) | Expr::Exists(read) => {
            if schema.timelines.iter().any(|t| read.table == t.table("Posts")) {
                let key = read.key.iter().map(|part| match part { Expr::Literal(v) => v.clone(), _ => snapback4_core::Value::Null }).collect::<Vec<_>>();
                sites.push(event_site(schema, &read.site, &read.table, &read.index, "timeline event", &key));
            }
            for key in &read.key { expr(schema, key, codes, sites); }
        },
        Expr::Scan(scan) => scan_exprs(schema, scan, codes, sites),
        Expr::Merge(merge) => for lane in &merge.lanes { inspect(schema, &lane.setup, codes, sites); scan_exprs(schema, &lane.scan, codes, sites); if let Some(source) = &lane.source { if let Some(scan) = source.scan() { scan_exprs(schema, scan, codes, sites); } for value in source.expressions() { expr(schema, value, codes, sites); } } },
        _ => {}
    }
}

fn event_site(schema: &Schema, location: &str, table: &str, index: &str, kind: &str, key: &[snapback4_core::Value]) -> ResidencySite {
    let mut result = site(schema, location, table, index, kind);
    if result.class == SiteClass::Horizon && schema.timelines.iter().any(|t| table == t.table("Posts"))
        && !snapback4_core::schema::timeline::partial_read(schema, table, index, key) {
        result.class = SiteClass::Held;
        result.reason = format!("{kind} {table} by {index}: key names a fully synced event kind");
        result.rewrite.clear();
    }
    result
}

/// A single human reason for the first site that prevents prediction.
pub fn prediction_reason(schema: &Schema, site: &ResidencySite) -> String {
    if matches!(site.kind.as_str(), "presence" | "dispatch" | "native" | "upsert" | "insert-if-absent")
        || schema.tables.get(&site.table).is_some_and(|table| table.sync.is_some()) { return site.reason.clone(); }
    let verb = match site.kind.as_str() { "write" | "write target" | inserts::UPSERT_BLOCKED | inserts::ABSENT_BLOCKED => "writes", "rule" => "a write rule reads", _ => "reads" };
    let noun = if schema.maintain_for(&site.table).is_some() { "maintain" } else { "table" };
    format!("{verb} online-only {noun} {}", site.table)
}

pub fn prediction_summary(bound: &Bound) -> Option<String> {
    prediction_report(bound, true)
}

pub fn prediction_overview(bound: &Bound) -> Option<String> {
    prediction_report(bound, false)
}

fn prediction_report(bound: &Bound, detailed: bool) -> Option<String> {
    let mut never = Vec::new();
    let mut inserts = Vec::new();
    let mut horizons = Vec::new();
    for (name, fact) in &bound.schema.operations {
        if !bound.programs.iter().any(|p| p.program.name == *name && p.program.kind == ProgramKind::Mutation) { continue; }
        if fact.predicts.as_deref() == Some("never") && let Some(site) = fact.sites.iter().find(|site| site.class == SiteClass::Server) {
            never.push(format!("{name} ({})", prediction_reason(&bound.schema, site)));
        }
        if let Some(site) = fact.sites.iter().find(|site| inserts::blocked(site)) {
            inserts.push(format!("{name} ({})", site.reason));
        }
        let reads = horizons::reads(fact);
        if fact.predicts.as_deref() == Some("eligible") && !reads.is_empty() {
            horizons.push(format!("{name} ({})", reads.join(", ")));
        }
    }
    let mut parts = Vec::new();
    if !never.is_empty() { parts.push(format!("{} mutations never predict: {}", never.len(), never.join(", "))); }
    if !inserts.is_empty() { parts.push(if detailed { format!("{} {} insert arms that never predict: {}", inserts.len(), if inserts.len() == 1 { "mutation has" } else { "mutations have" }, inserts.join(", ")) } else { format!("{} mutations have insert arms that may queue", inserts.len()) }); }
    if !horizons.is_empty() { parts.push(if detailed { format!("{} {} eligible, but these reads queue without a row past a horizon: {}", horizons.len(), if horizons.len() == 1 { "mutation" } else { "mutations" }, horizons.join(", ")) } else { format!("{} eligible mutations may queue past a horizon", horizons.len()) }); }
    (!parts.is_empty()).then(|| format!("{} — snapback4 why <op>", parts.join("; ")))
}

pub(super) fn maintain_notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    // @ref LLP 3000.007#6.8 — check states inheritance; test --residency measures the adopted fixture's cold rows.
    let mut notes: Vec<_> = schema.synced().filter_map(|(name, table, sync)| {
        let source = table.residency.inherited_from.as_ref()?;
        match &sync.audience {
            Audience::Column(_) => return None,
            Audience::Target { table: target, .. } => {
                if let Ok(binding) = snapback4_core::schema::audience_binding(schema, name, table, sync)
                    && schema.tables[target].cap(&binding.columns).is_some() && schema.maintain_for(name)?.by.len() == binding.columns.len() { return None; }
            }
            Audience::Public => {}
        }
        let readers: Vec<_> = schema.operations.iter().filter(|(_, fact)| fact.predicts.as_deref() == Some("eligible") && fact.sites.iter().any(|site| site.table == name)).map(|(name, _)| name.as_str()).collect();
        let consequence = if readers.is_empty() { "no currently eligible mutation reads it".into() } else { format!("{} would stop predicting if {name} goes `online only`", readers.join(", ")) };
        Some(Diagnostic::new(&catalog.site_for(&format!("tables.{name}")), "N_MAINTAIN_SYNCED", format!("maintain {name}: {} inherited from {source}, no horizon; one value row per {} reaches {}; {consequence}", sync.line(), schema.maintain_for(name)?.by.join(", "), if sync.audience == Audience::Public { "every device" } else { "every member of the group" }), "keep inherited sync for local readers and offline absence coverage, or add `online only` and lose that offline coverage; measure cold rows with `snapback4 test --residency`; guide maintains; guide offline-interactions").guide("residency"))
    }).collect();
    if notes.len() > 1 {
        let message = format!("{} synced maintains:\n{}", notes.len(), notes.iter().map(|note| format!("  {} (site {})", note.message, note.site)).collect::<Vec<_>>().join("\n"));
        notes[0].message = message;
        notes.truncate(1);
    }
    // @ref LLP 3000.007#8 — item 7: a readable maintain can disclose a hidden source's write delta.
    for maintain in &schema.maintains {
        let (Some(source), Some(target)) = (schema.table(&maintain.source), schema.table(&maintain.target)) else { continue };
        if source.rules.read.is_uniformly_readable() || target.rules.read == RuleExpr::Deny { continue; }
        // Same read predicate over the grouped fields cannot give a hidden writer this aggregate.
        let mut fields = BTreeSet::new();
        source.rules.read.fields(&mut fields);
        if source.through.is_some() && fields.iter().all(|field| maintain.bare_key(field) || maintain.aliases.values().any(|c| c == field)) {
            let derived = source.rules.read.map_fields(&|field| maintain.aliases.iter().find(|(_,capture)| capture.as_str() == field).map_or_else(|| field.into(),|(output,_)| output.clone()));
            if derived == target.rules.read { continue; }
        }
        if target.rules.read == source.rules.read && !fields.contains("id") && fields.iter().all(|field| maintain.bare_key(field)) { continue; }
        // An old-image guard that entails the source read rule does not widen write authority.
        if implies(&source.rules.insert, &source.rules.read) && implies(&source.rules.delete, &source.rules.read) && implies(&source.rules.update, &old_read(&source.rules.read)) { continue; }
        notes.push(Diagnostic::new(&catalog.site_for(&format!("tables.{}", maintain.target)), "N_MAINTAIN_DELTA", format!("maintain {} may disclose the delta of a hidden {} row: insert/delete and a potentially wider update rule affect this readable target; filter/key/value dependencies: {}", maintain.target, maintain.source, maintain.dependencies().into_iter().collect::<Vec<_>>().join(", ")), "treat the view as a declared read channel; restrict its read rule or the source update rule if the delta is private").guide("rules"));
    }
    notes
}

/// The cold-snapshot report identifies which maintains the grouped fact names.
pub fn maintain_note_names(note: &Diagnostic, name: &str) -> bool {
    note.code == "N_MAINTAIN_SYNCED" && note.message.lines().any(|line| line.trim_start().starts_with(&format!("maintain {name}:")))
}

fn old_read(rule: &RuleExpr) -> RuleExpr {
    use snapback4_core::schema::RuleTerm;
    fn old(term: &RuleTerm) -> RuleTerm { match term { RuleTerm::Field(field) => RuleTerm::OldField(field.clone()), other => other.clone() } }
    match rule {
        RuleExpr::Eq(a, b) => RuleExpr::Eq(old(a), old(b)),
        RuleExpr::Ne(a, b) => RuleExpr::Ne(old(a), old(b)),
        RuleExpr::Compare(op,a,b) => RuleExpr::Compare(*op,old(a),old(b)),
        RuleExpr::And(rules) => RuleExpr::And(rules.iter().map(old_read).collect()),
        RuleExpr::Or(rules) => RuleExpr::Or(rules.iter().map(old_read).collect()),
        RuleExpr::Not(rule) => RuleExpr::Not(Box::new(old_read(rule))),
        RuleExpr::Exists { table, index, key, provenance, equalities } => RuleExpr::Exists { table: table.clone(), index: index.clone(), key: key.iter().map(old).collect(), provenance: *provenance, equalities: equalities.iter().map(|(column, term)| (column.clone(), old(term))).collect() },
        other => other.clone(),
    }
}

// A sufficient implication proof, not a rule satisfiability solver. Unproved
// cases carry a "may disclose" note, so a complex author policy remains visible.
fn implies(update: &RuleExpr, read: &RuleExpr) -> bool {
    if update == read || read.is_uniformly_readable() || *update == RuleExpr::Deny { return true; }
    match (update, read) {
        (_, RuleExpr::And(rules)) => rules.iter().all(|r| implies(update, r)),
        (RuleExpr::Or(rules), _) => rules.iter().all(|r| implies(r, read)),
        (RuleExpr::And(rules), _) => rules.iter().any(|r| implies(r, read)),
        (_, RuleExpr::Or(rules)) => rules.iter().any(|r| implies(update, r)),
        _ => false,
    }
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
        let new_insert_limit = new_horizon && new.sites.iter().any(|site| inserts::blocked(site) && !old.sites.iter().any(|before| before.kind == site.kind && before.table == site.table && before.index == site.index && before.reason == site.reason));
        let risks: Vec<_> = new.sites.iter().filter(|site| {
            (new_insert_limit && inserts::blocked(site)) || ((lost || moved) && site.class == SiteClass::Server)
                || (new_horizon && site.class == SiteClass::Horizon && !old.sites.iter().any(|before| before.class == site.class && before.table == site.table && before.index == site.index && before.kind == site.kind))
        }).collect();
        if moved {
            for site in risks { notes.push(Diagnostic::new(&program.site, "N_NOW_SERVER", format!("{name} now runs on the server: {} (site {})", site.reason, site.site), &site.rewrite).guide("residency")); }
        } else if !risks.is_empty() {
            // @ref LLP 3000.007#20 — one changed-mutation note names distinct causes; repeated reads and the upsert's two arms share a cause.
            let mut causes: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
            let mut rewrites = BTreeSet::new();
            for site in risks {
                let cause = if site.class == SiteClass::Server && !matches!(site.kind.as_str(), "presence" | "dispatch" | "native") && bound.schema.tables.get(&site.table).is_some_and(|table| table.sync.is_none()) {
                    format!("online-only {} {}", if bound.schema.maintain_for(&site.table).is_some() { "maintain" } else { "table" }, site.table)
                } else if inserts::blocked(site) { format!("insert queues without a row: {}; {}", site.reason, inserts::PENDING) } else { site.reason.clone() };
                causes.entry(cause).or_default().extend(note_sites(program, site));
                if !site.rewrite.is_empty() { rewrites.insert(site.rewrite.as_str()); }
            }
            let reasons = causes.into_iter().map(|(cause, sites)| format!("{cause} (sites: {})", sites.into_iter().collect::<Vec<_>>().join(", "))).collect::<Vec<_>>().join("; ");
            let message = if new.ephemeral { "fails offline and is not queued" } else if lost { "is no longer eligible to predict; queued without a row" } else if new_insert_limit { "has insert arms that never predict" } else { "remains eligible; may queue without a row past the horizon" };
            notes.push(Diagnostic::new(&program.site, "N_NOT_PREDICTABLE", format!("{name} {message}: {reasons}"), rewrites.into_iter().collect::<Vec<_>>().join("; ")).guide("residency"));
        }
    }
    notes
}

fn note_sites(program: &super::BoundProgram, site: &ResidencySite) -> BTreeSet<String> {
    let location = site.site.replace("insert if absent ", "insert ");
    let write = location.strip_suffix(" insert rule").or_else(|| location.strip_suffix(" rule")).unwrap_or(&location);
    let locations: BTreeSet<_> = program.sources.iter().filter(|(key, (_, name))| key.starts_with("write/") && name == write).map(|(_, (location, _))| location.to_string()).collect();
    if !locations.is_empty() { return locations; }
    // Read facts already carry their source and spelling. A grouped site list
    // needs just the location; its root cause names the table or maintain.
    [site.site.split_once(" (").map_or(site.site.clone(), |(location, _)| location.to_owned())].into()
}

pub fn table_line(schema: &Schema, name: &str) -> String {
    let table = &schema.tables[name];
    if let Some(e) = &table.ephemeral {
        let life = if e.life_ms % 1000 == 0 { format!("{}s", e.life_ms / 1000) } else { format!("{}ms", e.life_ms) };
        return format!("ephemeral {life}: server memory, never on a device");
    }
    let mut line = match &table.sync {
        Some(sync) => format!("{}{}{}", sync.line(), if table.residency.inferred { " (from the read rule)" } else { "" }, table.residency.inherited_from.as_ref().map(|source| format!(" (inherited from {source})")).unwrap_or_default()),
        None => format!("online only{}", if table.residency.online_only { "" } else { " (no sync line)" }),
    };
    let grants: BTreeSet<_> = table.rules.read.disjuncts().into_iter().filter_map(RuleExpr::service_grant).collect();
    if !grants.is_empty() { line.push_str(&format!("; service grants: {}", grants.into_iter().collect::<Vec<_>>().join(", "))); }
    line
}

pub fn operation_lines(name: &str, fact: &Execution) -> String {
    let blocked = fact.sites.iter().find(|site| inserts::blocked(site));
    let mut word = match (fact.runs.as_deref(), fact.predicts.as_deref()) { (Some(runs), _) => format!("runs: {runs}"), (_, Some("eligible")) => match blocked {
        Some(site) if site.kind == inserts::UPSERT_BLOCKED => format!("predicts: conditional updates — inserts into {} queue without a row", site.table),
        Some(site) => format!("predicts: inserts queue without a row — insert if absent into {} cannot prove absence", site.table),
        None => "predicts: eligible".into(),
    }, _ => "predicts: never; queued without a row".into() };
    if fact.ephemeral { word = format!("{}; fails offline and is not queued", if fact.renews { "ephemeral, renews" } else { "ephemeral" }); }
    if fact.held { word.push_str(" (held; server refuses E_QUERY_HELD; no server fallback)"); }
    if !fact.components.is_empty() { word.push_str(&format!("; components: {}", fact.components.iter().map(|component| component.field.as_str()).collect::<Vec<_>>().join(", "))); }
    let reads = horizons::reads(fact);
    if fact.predicts.as_deref() == Some("eligible") && !reads.is_empty() {
        word.push_str(&format!("{} past the horizon at {}", if blocked.is_some() { "; also queues" } else { " except" }, reads.join(", ")));
    }
    let mut lines = vec![format!("  {name}: {word}")];
    // @ref LLP 3000.007#6.2 — held sites establish source coverage; temporary audiences and execution limits still affect answer completeness.
    if fact.held && !fact.sites.is_empty() && fact.sites.iter().all(|site| site.class == SiteClass::Held) {
        lines.push("    horizon-free source coverage — all sources sync without a horizon; answer completeness still depends on runtime authorization and limits".into());
    }
    if fact.connected_effects_only { lines.push(format!("    {CONNECTED_EFFECTS}")); }
    for site in &fact.effect_payload_reads {
        lines.push(format!("    {} (site {}); charged on the server only", site.reason, site.site));
    }
    for site in &fact.sites {
        // The insert explanation also names the upsert target; do not follow it
        // with the generic horizon warning that used to contradict that proof.
        if site.kind == "write target" && fact.sites.iter().any(|insert| inserts::blocked(insert) && insert.site == site.site && insert.table == site.table && insert.index == site.index) { continue; }
        if fact.ephemeral {
            lines.push(format!("    {:?}: {} (site {}); fails offline and is not queued", site.class, site.reason, site.site));
            continue;
        }
        if inserts::blocked(site) {
            let kind = if site.kind == inserts::UPSERT_BLOCKED { "upsert insert" } else { "insert if absent" };
            lines.push(format!("    {:?}: {kind} queues without a row: {} (site {}); {}", site.class, site.reason, site.site, inserts::PENDING));
            continue;
        }
        lines.push(format!("    {:?}: {} (site {}){}", site.class, site.reason, site.site, if site.class == SiteClass::Horizon { if fact.predicts.as_deref() == Some("eligible") { "; may queue without a row past the horizon" } else if fact.held { "; incomplete past the horizon; no server fallback" } else { "; server past the horizon" } } else { "" }));
        if !site.rewrite.is_empty() { lines.push(format!("      rewrite: {}", site.rewrite)); }
    }
    lines.join("\n")
}

pub const CONNECTED_EFFECTS: &str = "connected: decides effects only — the server decides who is notified at commit";
