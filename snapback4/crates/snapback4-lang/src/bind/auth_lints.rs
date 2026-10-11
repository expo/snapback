//! Authorization shapes that compile and run, but grant or withhold more than
//! the author meant (app-farm wave 6 #22, lanes 001 061 062 073). Each is a
//! review note decided from the schema and the programs' own text; none
//! changes a rule.
//!
//! - `N_PROBE_ONLY_READ`: a read-rule disjunct probes a private table through
//!   the row's reference but names no caller (`exists applications[.application]`).
//!   A rule probe sees every row, so it admits every caller whenever the
//!   parent exists, including callers who cannot read the parent.
//! - `N_VACUOUS_RULE`: an insert rule that every inserting mutation satisfies
//!   for every caller, by writing `viewer` into the column it tests, on a row
//!   that names another principal the caller chose as a reader.
//! - `N_LOOKUP_HIDDEN`: an update or delete rule admits callers the read rule
//!   does not, and a mutation looks the row up by key, so those callers get
//!   `NOT_FOUND` before the write rule runs.
//! - `N_WRITE_DENIED` (counter): a mutation increments a column whose table's
//!   update rule admits only role holders, without requiring the role, so
//!   every other caller is refused `E_RULE` at the counter.
// @ref LLP 3000.036#16.4 — the four lints: precise conditions, so the guide and the farm corpus stay silent.
use super::catalog::Catalog;
use crate::{Site, ast::*, diag::Diagnostic};
use snapback4_core::schema::{RuleExpr, RuleTerm, Schema};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    probe_only_reads(catalog, schema, &mut notes);
    let mutations: Vec<&ProgramDecl> = catalog.documents.iter().flat_map(|doc| &doc.programs)
        .filter(|program| program.kind == ProgramKind::Mutation && !program.native).collect();
    vacuous_inserts(catalog, schema, &mutations, &mut notes);
    hidden_lookups(catalog, schema, &mutations, &mut notes);
    denied_counters(catalog, schema, &mutations, &mut notes);
    notes
}

fn rule_site<'a>(catalog: &'a Catalog, table: &str, effect: Effect) -> Option<&'a Site> {
    catalog.tables.get(table)?.decl.rules.iter().find(|rule| rule.effect == effect).map(|rule| &rule.site)
}

fn mentions_viewer(rule: &RuleExpr) -> bool {
    let term = |t: &RuleTerm| matches!(t, RuleTerm::Viewer);
    match rule {
        RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) | RuleExpr::Compare(_, a, b) => term(a) || term(b),
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().any(mentions_viewer),
        RuleExpr::Not(inner) => mentions_viewer(inner),
        RuleExpr::Exists { key, equalities, .. } | RuleExpr::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_, t)| t)).any(term),
        RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. } => false,
    }
}

fn conjuncts(rule: &RuleExpr) -> Vec<&RuleExpr> {
    match rule { RuleExpr::And(items) => items.iter().flat_map(conjuncts).collect(), other => vec![other] }
}

/// The probes in `rule`, outside any `not`, of a table whose read rule is not public.
fn private_probes<'a>(schema: &Schema, rule: &'a RuleExpr) -> Vec<&'a RuleExpr> {
    match rule {
        RuleExpr::Exists { table, key, .. } if key.iter().any(|t| matches!(t, RuleTerm::Field(_)))
            && schema.table(table).is_some_and(|target| !target.rules.read.is_uniformly_readable() && target.through.is_none()) => vec![rule],
        RuleExpr::And(items) => items.iter().flat_map(|item| private_probes(schema, item)).collect(),
        _ => Vec::new(),
    }
}

// ---- N_PROBE_ONLY_READ (lane 073) ----

fn probe_only_reads(catalog: &Catalog, schema: &Schema, notes: &mut Vec<Diagnostic>) {
    for (name, table) in &schema.tables {
        let Some(info) = catalog.tables.get(name) else { continue };
        if info.maintained.is_some() || info.decl.ephemeral.is_some() || table.through.is_some() { continue; }
        let Some(site) = rule_site(catalog, name, Effect::Read) else { continue };
        for disjunct in table.rules.read.disjuncts() {
            if mentions_viewer(disjunct) { continue; }
            // A probe whose own tests make the parent readable to everyone
            // (`exists decks[.deck, isPublic = true]` under `read <- … or .isPublic = true`)
            // discloses nothing the parent does not.
            let public_by_probe = |probe: &RuleExpr| {
                let RuleExpr::Exists { table: parent, equalities, .. } = probe else { return false };
                let pins: BTreeMap<String, snapback4_core::Value> = equalities.iter().filter_map(|(column, term)| match term { RuleTerm::Literal(value) => Some((column.clone(), value.clone())), _ => None }).collect();
                snapback4_core::engine::rules::pinned_probe_readable(schema, probe)
                    || schema.table(parent).is_some_and(|target| decided(&target.rules.read, &pins) == Some(true))
            };
            let Some(RuleExpr::Exists { table: parent, key, .. }) = private_probes(schema, disjunct).into_iter().find(|probe| !public_by_probe(probe)) else { continue };
            let Some(RuleTerm::Field(reference)) = key.iter().find(|t| matches!(t, RuleTerm::Field(_))) else { continue };
            let Some(parent_table) = schema.table(parent) else { continue };
            // The parent's own reader, to name in the probe.
            let owner = parent_table.rules.read.disjuncts().into_iter().find_map(|d| match d {
                RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => Some(column.clone()),
                _ => None,
            });
            let named = owner.map(|column| format!("; or name the caller in the probe (`exists {parent}[.{reference}, {column} = viewer]`) to admit only that reader")).unwrap_or_default();
            let through = if table.rules.read.disjuncts().len() == 1 { format!("`read through .{reference}` admits exactly the {parent} row's readers") } else { format!("to admit the {parent} row's readers, name them in this disjunct, or make the whole rule `read through .{reference}`") };
            notes.push(Diagnostic::new(site, "N_PROBE_ONLY_READ",
                format!("table {name}: the read rule's `{}` names no caller, so it admits every signed-in caller whenever that {parent} row exists, including callers who cannot read it: a rule probe sees every {parent} row, it does not inherit {parent}'s read rule", disjunct.quarry()),
                format!("{through}{named}; keep it as written only if every caller may read these {name} rows while the {parent} row exists")).guide("rules"));
            break;
        }
    }
}

/// `rule` for every caller, given only the literal values `pins` of some
/// columns: `Some(true)` when it holds whoever reads, `None` when it depends
/// on the caller or an unpinned column.
fn decided(rule: &RuleExpr, pins: &BTreeMap<String, snapback4_core::Value>) -> Option<bool> {
    let value = |t: &RuleTerm| match t { RuleTerm::Field(column) => pins.get(column).cloned(), RuleTerm::Literal(v) => Some(v.clone()), _ => None };
    match rule {
        RuleExpr::Allow | RuleExpr::Public { .. } => Some(true),
        RuleExpr::Deny => Some(false),
        RuleExpr::Eq(a, b) => Some(value(a)? == value(b)?),
        RuleExpr::Ne(a, b) => Some(value(a)? != value(b)?),
        RuleExpr::Not(inner) => decided(inner, pins).map(|v| !v),
        RuleExpr::And(items) => items.iter().map(|item| decided(item, pins)).try_fold(true, |all, v| match v { Some(false) => Err(()), Some(true) => Ok(all), None => Ok(false) }).map_or(Some(false), |all| all.then_some(true)),
        RuleExpr::Or(items) => {
            let values: Vec<Option<bool>> = items.iter().map(|item| decided(item, pins)).collect();
            if values.contains(&Some(true)) { Some(true) } else if values.iter().all(|v| *v == Some(false)) { Some(false) } else { None }
        }
        _ => None,
    }
}

// ---- N_VACUOUS_RULE (lane 061) ----

/// `{ field: value }` of one insert, with `{ name }` read as `name: name`; None with a spread.
fn written(fields: &[ObjectField]) -> Option<BTreeMap<String, Expr>> {
    fields.iter().map(|field| {
        if field.spread { return None; }
        let value = field.value.clone().unwrap_or_else(|| Expr::Name { name: field.name.clone(), site: field.site.clone() });
        Some((field.name.clone(), value))
    }).collect()
}

fn is_viewer(expr: &Expr) -> bool { matches!(expr, Expr::Name { name, .. } if name == "viewer") }

/// Every write (op, table, keys, fields, site) a program makes, in source order.
fn writes(program: &ProgramDecl) -> Vec<(WriteOp, String, Vec<KeyPart>, Vec<ObjectField>, Site)> {
    let mut out = Vec::new();
    let mut body = program.prelude.clone();
    body.extend(program.body.iter().cloned());
    super::intent_walk::statements(&mut body, &mut |expr: &mut Expr| {
        if let Expr::Write { op, table, keys, fields, site, .. } = expr { out.push((op.clone(), table.clone(), keys.clone(), fields.clone(), site.clone())); }
    });
    out
}

/// Every condition the program tests before acting: `require`s and `if`s, at any depth.
fn conditions(body: &[Stmt], out: &mut Vec<Expr>) {
    for statement in body {
        match statement {
            Stmt::Require { condition, .. } => out.push(condition.clone()),
            Stmt::If { condition, then_body, else_body, .. } => { out.push(condition.clone()); conditions(then_body, out); conditions(else_body, out); }
            Stmt::For { body, .. } | Stmt::As { body, .. } => conditions(body, out),
            _ => {}
        }
    }
}

fn names_viewer(expr: &Expr) -> bool {
    let mut found = false;
    let mut copy = expr.clone();
    super::intent_walk::expression(&mut copy, &mut |e: &mut Expr| { if is_viewer(e) { found = true; } });
    found || is_viewer(expr)
}

fn vacuous_inserts(catalog: &Catalog, schema: &Schema, mutations: &[&ProgramDecl], notes: &mut Vec<Diagnostic>) {
    for (name, table) in &schema.tables {
        let Some(site) = rule_site(catalog, name, Effect::Insert) else { continue };
        let rule = &table.rules.insert;
        if matches!(rule, RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. }) { continue; }
        // The columns each owner disjunct pins to the caller, or None for a disjunct that tests more.
        let owners: Vec<Option<Vec<String>>> = rule.disjuncts().into_iter().map(|d| conjuncts(d).into_iter().map(|c| match c {
            RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => Some(column.clone()),
            _ => None,
        }).collect()).collect();
        let readers: BTreeSet<String> = table.rules.read.disjuncts().into_iter().filter_map(|d| match d {
            RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => Some(column.clone()),
            _ => None,
        }).collect();
        let mut inserts = Vec::new();
        let mut every = true;
        for program in mutations {
            for (op, target, _, fields, write_site) in writes(program) {
                if target != *name || !matches!(op, WriteOp::Insert) { continue; }
                let Some(values) = written(&fields) else { every = false; continue };
                let vacuous = owners.iter().flatten().any(|columns| columns.iter().all(|column| values.get(column).is_some_and(is_viewer)));
                every &= vacuous;
                inserts.push((program, values, write_site));
            }
        }
        if !every || inserts.is_empty() { continue; }
        // The hole: the caller names another principal, who then reads the row,
        // and nothing in the mutation tests who the caller is.
        let Some((program, column, write_site)) = inserts.iter().find_map(|(program, values, write_site)| {
            let mut tested = Vec::new();
            conditions(&program.prelude, &mut tested);
            conditions(&program.body, &mut tested);
            if tested.iter().any(names_viewer) { return None; }
            values.iter().find(|(column, value)| readers.contains(*column) && matches!(value, Expr::Name { name, .. } if program.args.iter().any(|arg| &arg.name == name)))
                .map(|(column, _)| (*program, column.clone(), write_site.clone()))
        }) else { continue };
        let owner = owners.iter().flatten().next().and_then(|columns| columns.first()).cloned().unwrap_or_default();
        // And the self-written column is authority elsewhere: another rule
        // trusts `exists sessions[.session, therapist = viewer]` (lane 061's
        // notes), so writing it makes the caller that principal's counterpart.
        // A row that only grants the other principal access to the caller's
        // own data (a patient naming a doctor) is consent, not a hole.
        let Some(trusted) = schema.tables.iter().find_map(|(other, t)| {
            [&t.rules.read, &t.rules.insert, &t.rules.update, &t.rules.delete].into_iter()
                .find_map(|rule| trusts(rule, name, &owner)).map(|probe| (other.clone(), probe))
        }) else { continue };
        notes.push(Diagnostic::new(&write_site, "N_VACUOUS_RULE",
            format!("table {name}: `insert <- {}` ({site}) holds for every caller of {}, which writes `{owner}: viewer` itself, with a `{column}` the caller chooses; {} trusts `{}`, so any signed-in caller can create {name} rows naming any {column} and then act as their {owner} there", rule.quarry(), program.name, trusted.0, trusted.1),
            format!("if being a {owner} is a role only some callers hold, test it: `insert <- {} and exists <roles>[viewer]` (a roster table the role's holders can read), or `require` it in {} with your own code; if any caller may be a {owner}, nothing changes", rule.quarry(), program.name)).guide("rules"));
    }
}

/// A test in `rule` (outside `not`) that the caller is `table`'s `column` on
/// a referenced row: `exists sessions[.session, therapist = viewer]`, or the
/// hop `.session.therapist = viewer` an insert rule keeps.
fn trusts(rule: &RuleExpr, table: &str, column: &str) -> Option<String> {
    match rule {
        RuleExpr::Exists { table: target, equalities, .. } if target == table
            && equalities.iter().any(|(name, term)| name == column && matches!(term, RuleTerm::Viewer)) => Some(rule.quarry()),
        RuleExpr::Eq(RuleTerm::Reference { table: target, column: reference, field, old }, RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Reference { table: target, column: reference, field, old })
            if target == table && field == column => Some(format!("{}.{reference}.{field} = viewer", if *old { "old" } else { "" })),
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().find_map(|item| trusts(item, table, column)),
        _ => None,
    }
}

// ---- N_LOOKUP_HIDDEN (lane 001) ----

/// Whether any term reads the row: its columns, before or after the write, or through a reference.
fn reads_row(rule: &RuleExpr) -> bool {
    let term = |t: &RuleTerm| !matches!(t, RuleTerm::Viewer | RuleTerm::Literal(_));
    match rule {
        RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) | RuleExpr::Compare(_, a, b) => term(a) || term(b),
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().any(reads_row),
        RuleExpr::Not(inner) => reads_row(inner),
        RuleExpr::Exists { key, equalities, .. } | RuleExpr::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_, t)| t)).any(term),
        RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. } => false,
    }
}

/// A role: a disjunct that names the caller and reads no column of the row.
fn role(rule: &RuleExpr) -> bool { !reads_row(rule) && mentions_viewer(rule) && rule.service_grant().is_none() }

/// A conjunct as it reads for implication: `old.x` is the row's `.x` before the write.
fn plain(rule: &RuleExpr) -> RuleExpr {
    let term = |t: &RuleTerm| match t { RuleTerm::OldField(f) => RuleTerm::Field(f.clone()), other => other.clone() };
    match rule {
        RuleExpr::Eq(a, b) => RuleExpr::Eq(term(a), term(b)),
        RuleExpr::Ne(a, b) => RuleExpr::Ne(term(a), term(b)),
        other => other.clone(),
    }
}

/// `weaker` holds whenever `stronger` does: the same probe with fewer named equalities, or the same test.
fn implies(stronger: &RuleExpr, weaker: &RuleExpr) -> bool {
    match (stronger, weaker) {
        (RuleExpr::Exists { table: a, index: ai, key: ak, equalities: ae, .. }, RuleExpr::Exists { table: b, index: bi, key: bk, equalities: be, .. }) =>
            a == b && ai == bi && ak == bk && be.iter().all(|pair| ae.contains(pair)),
        _ => plain(stronger) == plain(weaker),
    }
}

/// Whether every caller `disjunct` admits, on a row it admits, also passes one disjunct of `read`.
fn reads_what_it_writes(disjunct: &RuleExpr, read: &RuleExpr) -> bool {
    let have = conjuncts(disjunct);
    read.disjuncts().into_iter().any(|option| conjuncts(option).into_iter().all(|need| have.iter().any(|h| implies(h, need))))
}

fn hidden_lookups(catalog: &Catalog, schema: &Schema, mutations: &[&ProgramDecl], notes: &mut Vec<Diagnostic>) {
    let mut seen = BTreeSet::new();
    for program in mutations {
        for (op, name, keys, _, write_site) in writes(program) {
            let effect = match op { WriteOp::Update => Effect::Update, WriteOp::Delete => Effect::Delete, _ => continue };
            if keys.is_empty() { continue; }
            let Some(table) = schema.table(&name) else { continue };
            let Some(info) = catalog.tables.get(&name) else { continue };
            if table.through.is_some() || info.maintained.is_some() || info.decl.ephemeral.is_some() || table.rules.read.is_uniformly_readable() { continue; }
            let rule = match effect { Effect::Update => &table.rules.update, _ => &table.rules.delete };
            if matches!(rule, RuleExpr::Deny | RuleExpr::Allow | RuleExpr::Public { .. }) { continue; }
            // A role (a disjunct that reads no row column) the read rule never admits:
            // a row-dependent party is often a reader by the app's own invariant
            // (a facilitator is a member), which no rule states, so it is not named.
            // A role that helps no read disjunct at all: its holders find no row by it.
            let helps = |d: &RuleExpr| table.rules.read.disjuncts().into_iter().any(|option| conjuncts(option).into_iter().any(|need| conjuncts(d).into_iter().any(|have| implies(have, need))));
            let Some(disjunct) = rule.disjuncts().into_iter().find(|d| role(d) && !helps(d) && !reads_what_it_writes(d, &table.rules.read)) else { continue };
            if !seen.insert((program.name.clone(), name.clone(), effect.word())) { continue; }
            let site = rule_site(catalog, &name, effect).cloned().unwrap_or_else(|| info.decl.site.clone());
            let read = rule_site(catalog, &name, Effect::Read).map(|s| format!(" ({s})")).unwrap_or_default();
            notes.push(Diagnostic::new(&write_site, "N_LOOKUP_HIDDEN",
                format!("mutation {}: the {} rule of {name} ({site}) admits the role `{}`, which no disjunct of its read rule `{}`{read} uses; the {} looks the row up first under the read rule, so a holder of that role who reads the row no other way gets NOT_FOUND before the {} rule runs", program.name, effect.word(), disjunct.quarry(), table.rules.read.quarry(), op.word(), effect.word()),
                format!("if the role's holders act on rows they cannot otherwise read, let them read those rows (`read <- {} or {}`, or narrower, such as `… or .status = 'open' and {}`); if they always read the row another way, the role only widens the {} rule for them and nothing changes", table.rules.read.quarry(), disjunct.quarry(), disjunct.quarry(), effect.word())).guide("rules"));
        }
    }
}

// ---- N_WRITE_DENIED for a counter only role holders can write (lane 062) ----

/// `x.f + …`, `x.f - …` or `… + x.f`: the patched field read from the row it patches.
fn counter(field: &str, value: &Expr) -> bool {
    let reads = |e: &Expr| matches!(e, Expr::Member { name, base, .. } if name == field && matches!(base.as_ref(), Expr::Name { .. }));
    matches!(value, Expr::Binary { op, left, right, .. } if (op == "+" || op == "-") && (reads(left) || reads(right)))
}

fn probes_table(expr: &Expr, table: &str) -> bool {
    let mut found = false;
    let mut copy = expr.clone();
    super::intent_walk::expression(&mut copy, &mut |e: &mut Expr| { if let Expr::Exists { read, .. } | Expr::Read(read) = e && read.table == table { found = true; } });
    found
}

/// Whether the program reads `table` anywhere (a lookup, a probe, a page).
fn looks_up(program: &ProgramDecl, table: &str) -> bool {
    let mut found = false;
    let mut body = program.prelude.clone();
    body.extend(program.body.iter().cloned());
    super::intent_walk::statements(&mut body, &mut |e: &mut Expr| { if let Expr::Exists { read, .. } | Expr::Read(read) = e && read.table == table { found = true; } });
    found
}

fn denied_counters(catalog: &Catalog, schema: &Schema, mutations: &[&ProgramDecl], notes: &mut Vec<Diagnostic>) {
    for program in mutations {
        let mut tested = Vec::new();
        conditions(&program.prelude, &mut tested);
        conditions(&program.body, &mut tested);
        for (op, name, _, fields, write_site) in writes(program) {
            if !matches!(op, WriteOp::Update) { continue; }
            let Some(table) = schema.table(&name) else { continue };
            let Some(field) = fields.iter().find(|f| !f.spread && f.value.as_ref().is_some_and(|value| counter(&f.name, value))) else { continue };
            // Only role grants: every disjunct reads no column of the row.
            let grants = table.rules.update.disjuncts();
            let roles_only = !matches!(table.rules.update, RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. })
                && grants.iter().all(|d| role(d));
            if !roles_only { continue; }
            let probed: Vec<&str> = grants.iter().flat_map(|d| conjuncts(d)).filter_map(|c| if let RuleExpr::Exists { table, .. } = c { Some(table.as_str()) } else { None }).collect();
            // A `require` or `if` on the role, or a lookup of the caller's role row
            // (`account = accounts[principal = viewer] ! else …`), guards the write.
            if probed.is_empty() || tested.iter().any(|condition| probed.iter().any(|t| probes_table(condition, t))) || probed.iter().any(|t| looks_up(program, t)) { continue; }
            // The mutation serves ordinary callers: it also inserts a row they own
            // elsewhere (a donation by its grower). A staff-only action keeps the counter.
            let ordinary = writes(program).into_iter().any(|(op, other, _, _, _)| matches!(op, WriteOp::Insert) && other != name
                && schema.table(&other).is_some_and(|t| t.rules.insert.disjuncts().into_iter().any(|d| conjuncts(d).into_iter().any(|c| matches!(c, RuleExpr::Eq(RuleTerm::Field(_), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(_)))))));
            if !ordinary { continue; }
            let site = rule_site(catalog, &name, Effect::Update).map(|s| format!(" ({s})")).unwrap_or_default();
            notes.push(Diagnostic::new(&write_site, "N_WRITE_DENIED",
                format!("mutation {}: `{}` is a counter it keeps on {name}, but {name}'s update rule `{}`{site} admits only that role, and {} does not require it: every other caller is refused E_RULE at this write", program.name, field.name, table.rules.update.quarry(), program.name),
                format!("keep the count from the rows the callers write instead, as a maintained view the engine keeps as the system (`view <name>: sum <rows> of .<amount> by .<reference to {name}>`, or `count <rows> by .<reference>`, read as `<name>[id]` and tested in `require`; guide maintains), and drop the column; or `require` the role first in {} with your own code if only its holders should call it", program.name)).guide("rules"));
        }
    }
}
