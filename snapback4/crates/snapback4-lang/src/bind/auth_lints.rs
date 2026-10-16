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
//! - `N_REQUIRE_HIDDEN` (wave 7, lane 001): `require exists t[col = x]` where
//!   every disjunct of t's read rule admits only the row whose `col` is the
//!   caller: a program probe reads under the read rule, so it passes only
//!   when `x` is the caller.
//! - `N_REQUIRE_REFUSED` (wave 7, lane 072): a disjunct of a `require` admits
//!   callers (`person = viewer`, the deleted row's member) whom no disjunct of
//!   the table's delete rule admits: they pass the require and are refused
//!   `E_RULE` at the delete.
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
    // @ref LLP 3000.036#17.5 — wave 7 lanes 001 072: a `require` the table's own rules decide against.
    let programs: Vec<&ProgramDecl> = catalog.documents.iter().flat_map(|doc| &doc.programs)
        .filter(|program| matches!(program.kind, ProgramKind::Mutation | ProgramKind::Query) && !program.native).collect();
    hidden_requires(catalog, schema, &programs, &mut notes);
    let guard_programs = catalog.documents.iter().flat_map(|doc| &doc.programs).filter(|p| !p.native).collect::<Vec<_>>();
    unreadable_guards(catalog, schema, &guard_programs, &mut notes);
    refused_requires(catalog, schema, &mutations, &mut notes);
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

fn is_viewer(expr: &Expr) -> bool { matches!(expr, Expr::Name { name, .. } if name == "viewer" || name == "$input:viewer") }

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
                format!("table authorization layer (update old/next images): mutation {}: `{}` is a counter it keeps on {name}, but {name}'s update rule `{}`{site} admits only that role, and {} does not require it: every other caller is refused E_RULE at this write", program.name, field.name, table.rules.update.quarry(), program.name),
                format!("keep the count from the rows the callers write instead, as a maintained view the engine keeps as the system (`view <name>: sum <rows> of .<amount> by .<reference to {name}>`, or `count <rows> by .<reference>`, read as `<name>[id]` and tested in `require`; guide maintains), and drop the column; or `require` the role first in {} with your own code if only its holders should call it; see: guide rule-recipes quantified-consent", program.name)).guide("rules"));
        }
    }
}

// ---- N_REQUIRE_HIDDEN (wave 7, lane 001) ----

/// `{ column: value }` a read pins, its keys resolved against the table's
/// indexes (named keys, or positional keys of the one unique index of that
/// width) and its `where` equalities. None when a positional key is ambiguous.
pub(super) fn pins(catalog: &Catalog, read: &ReadExpr) -> Option<BTreeMap<String, Expr>> {
    let info = catalog.tables.get(&read.table)?;
    let mut out = BTreeMap::new();
    let positional: Vec<&KeyPart> = read.keys.iter().filter(|k| k.column.is_none()).collect();
    if !positional.is_empty() {
        let columns = match read.index.as_ref().and_then(|name| info.indexes.iter().find(|index| &index.name == name)) {
            Some(index) => index.columns.clone(),
            None => {
                let unique: Vec<&IndexDecl> = info.indexes.iter().filter(|index| index.unique && index.is_plain() && index.columns.len() == read.keys.len() && !index.columns.iter().any(|c| c == "id")).collect();
                match unique.as_slice() { [index] => index.columns.clone(), _ => return None }
            }
        };
        if columns.len() < read.keys.len() { return None; }
        for (column, key) in columns.iter().zip(&read.keys) { out.insert(key.column.clone().unwrap_or_else(|| column.clone()), key.value.clone()); }
    } else {
        for key in &read.keys { out.insert(key.column.clone()?, key.value.clone()); }
    }
    let mut filters = Vec::new();
    if let Some(filter) = &read.filter { super::intent::split((**filter).clone(), &mut filters); }
    for filter in filters {
        if let Expr::Binary { op, left, right, .. } = &filter && op == "="
            && let Some(column) = super::intent::column(left) { out.entry(column.to_owned()).or_insert_with(|| (**right).clone()); }
    }
    Some(out)
}

/// Every `exists` a condition asserts (outside `not`): `a and exists t[…]`, either side of `or`.
fn asserted_probes<'a>(condition: &'a Expr, out: &mut Vec<&'a ReadExpr>) {
    match condition {
        Expr::Exists { read, .. } => out.push(read),
        Expr::Binary { op, left, right, .. } if op == "and" || op == "or" => { asserted_probes(left, out); asserted_probes(right, out); }
        _ => {}
    }
}

fn requires(body: &[Stmt], out: &mut Vec<(Expr, String)>) {
    for statement in body {
        match statement {
            Stmt::Require { condition, code, .. } => out.push((condition.clone(), code.clone())),
            Stmt::If { then_body, else_body, .. } => { requires(then_body, out); requires(else_body, out); }
            Stmt::For { body, .. } | Stmt::As { body, .. } => requires(body, out),
            _ => {}
        }
    }
}

fn hidden_requires(catalog: &Catalog, schema: &Schema, programs: &[&ProgramDecl], notes: &mut Vec<Diagnostic>) {
    let mut seen = BTreeSet::new();
    for program in programs {
        let mut tested = Vec::new();
        requires(&program.prelude, &mut tested);
        requires(&program.body, &mut tested);
        for (condition, code) in &tested {
            let mut probes = Vec::new();
            asserted_probes(condition, &mut probes);
            for read in probes {
                let Some(table) = schema.table(&read.table) else { continue };
                let Some(info) = catalog.tables.get(&read.table) else { continue };
                if table.through.is_some() || info.maintained.is_some() || table.rules.read.is_uniformly_readable() { continue; }
                let Some(pinned) = pins(catalog, read) else { continue };
                // Every read disjunct admits only the row whose pinned `column` is the caller,
                // and the probe pins that column to something else.
                let owners: Vec<Option<(String, String)>> = table.rules.read.disjuncts().into_iter().map(|disjunct| conjuncts(disjunct).into_iter().find_map(|c| match c {
                    RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) =>
                        pinned.get(column).filter(|value| !is_viewer(value)).map(|value| (column.clone(), crate::print::expression(value))),
                    _ => None,
                })).collect();
                if owners.is_empty() || owners.iter().any(Option::is_none) { continue; }
                let Some((column, value)) = owners[0].clone() else { continue };
                if !seen.insert((program.name.clone(), read.site.to_string())) { continue; }
                let probe = crate::print::expression(&Expr::Exists { read: read.clone(), site: read.site.clone() });
                let site = rule_site(catalog, &read.table, Effect::Read).map(|s| format!(" ({s})")).unwrap_or_default();
                notes.push(Diagnostic::new(&read.site, "N_REQUIRE_HIDDEN",
                    format!("{} {}: `{probe}` reads {} under its read rule `{}`{site}, which admits only the row whose {column} is the caller, so this require passes only when `{value}` is the caller: for every other {} row, which exists but is hidden, it refuses {code} (a program `exists` sees only readable rows; a rule probe sees every row)",
                        if program.kind == ProgramKind::Query { "query" } else { "mutation" }, program.name, read.table, table.rules.read.quarry(), read.table),
                    format!("let the callers who run this check read those rows: `read <- {} or exists {}[viewer]` (a roster its members read), or a role (`… or exists staff[viewer]`); if only the caller's own row is meant, write `{column} = viewer`", table.rules.read.quarry(), read.table)).guide("rules"));
            }
        }
    }
}

// ---- N_REQUIRE_REFUSED (wave 7, lane 072) ----

/// A program condition, rewritten as a rule over the row `delete t[key]` removes:
/// a name the key pins becomes `.column`, a lookup of that row (`m = t[key]`)
/// its columns, and `y.c = viewer` on a lookup `y = u[e]` of a row `e` the key
/// pins becomes the probe `exists u[.column, c = viewer]`. None for anything else.
struct Row<'a> {
    table: &'a str,
    pinned: BTreeMap<String, String>,
    rows: BTreeSet<String>,
    lookups: BTreeMap<String, (String, String)>,
}

impl Row<'_> {
    fn focal(column: &str, site: &Site) -> Expr {
        Expr::Member { base: Box::new(Expr::Focal { site: site.clone() }), name: column.to_owned(), site: site.clone() }
    }

    fn term(&self, value: &Expr) -> Option<Expr> {
        match value {
            Expr::Literal { .. } => Some(value.clone()),
            _ if is_viewer(value) => Some(value.clone()),
            Expr::Member { base, name, site } if matches!(base.as_ref(), Expr::Name { name: row, .. } if self.rows.contains(row)) => Some(Self::focal(name, site)),
            _ => self.pinned.iter().find(|(_, text)| **text == crate::print::expression(value)).map(|(column, _)| Self::focal(column, value.site())),
        }
    }

    fn rule(&self, condition: &Expr) -> Option<Expr> {
        match condition {
            Expr::Binary { op, left, right, site } if op == "and" || op == "or" =>
                Some(Expr::Binary { op: op.clone(), left: Box::new(self.rule(left)?), right: Box::new(self.rule(right)?), site: site.clone() }),
            Expr::Binary { op, left, right, site } if op == "=" || op == "!=" => {
                // `t.captain = viewer`, `t = teams[team]`, the row's `.team` is `team`: `exists teams[.team, captain = viewer]`.
                let hop = |member: &Expr, other: &Expr| match member {
                    Expr::Member { base, name, .. } if op == "=" && is_viewer(other) => match base.as_ref() {
                        Expr::Name { name: lookup, .. } => self.lookups.get(lookup).and_then(|(target, key)| {
                            let column = self.pinned.iter().find(|(_, text)| *text == key)?.0;
                            let read = ReadExpr { table: target.clone(), keys: vec![
                                KeyPart { column: None, value: Self::focal(column, site), site: site.clone() },
                                KeyPart { column: Some(name.clone()), value: other.clone(), site: site.clone() },
                            ], ..empty_read(target, site) };
                            Some(Expr::Exists { read, site: site.clone() })
                        }),
                        _ => None,
                    },
                    _ => None,
                };
                if let Some(probe) = hop(left, right).or_else(|| hop(right, left)) { return Some(probe); }
                Some(Expr::Binary { op: op.clone(), left: Box::new(self.term(left)?), right: Box::new(self.term(right)?), site: site.clone() })
            }
            Expr::Exists { read, site } => {
                let mut read = read.clone();
                for key in &mut read.keys { key.value = self.term(&key.value)?; }
                if read.filter.is_some() || read.range.is_some() || read.table == self.table { return None; }
                Some(Expr::Exists { read, site: site.clone() })
            }
            _ => None,
        }
    }
}

fn refused_requires(catalog: &Catalog, schema: &Schema, mutations: &[&ProgramDecl], notes: &mut Vec<Diagnostic>) {
    for program in mutations {
        // `delete t[key]` anywhere; the requires and lookups at the top of the body.
        for (op, name, keys, _, write_site) in writes(program) {
            if !matches!(op, WriteOp::Delete) || keys.is_empty() { continue; }
            let (Some(table), Some(info)) = (schema.table(&name), catalog.tables.get(&name)) else { continue };
            if table.through.is_some() || info.maintained.is_some() || matches!(table.rules.delete, RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. }) { continue; }
            let key_read = ReadExpr { keys: keys.clone(), ..empty_read(&name, &write_site) };
            let Some(pinned) = pins(catalog, &key_read) else { continue };
            let pinned: BTreeMap<String, String> = pinned.into_iter().map(|(column, value)| (column, crate::print::expression(&value))).collect();
            let key_text = |read: &ReadExpr| pins(catalog, read).map(|p| p.into_iter().map(|(c, v)| (c, crate::print::expression(&v))).collect::<BTreeMap<_, _>>());
            let mut rows = BTreeSet::new();
            let mut lookups = BTreeMap::new();
            for statement in &program.body {
                let Stmt::Bind { names, value, .. } = statement else { continue };
                let [bound] = names.as_slice() else { continue };
                let read = match value { Expr::Assert { value, .. } => value.as_ref(), other => other };
                let Expr::Read(read) = read else { continue };
                if read.table == name && key_text(read).as_ref() == Some(&pinned) { rows.insert(bound.clone()); }
                else if let [key] = read.keys.as_slice() && key.column.is_none() && read.filter.is_none() && read.range.is_none() {
                    lookups.insert(bound.clone(), (read.table.clone(), crate::print::expression(&key.value)));
                }
            }
            let row = Row { table: &name, pinned, rows, lookups };
            let decl = |value: Expr| RuleDecl { effect: Effect::Delete, bindings: Vec::new(), site: value.site().clone(), value };
            let bind = |value: Expr| super::schema::bind_rule(catalog, info, &decl(value)).ok();
            let top: Vec<(&Expr, &String, &Site)> = program.body.iter().filter_map(|s| match s { Stmt::Require { condition, code, site, .. } => Some((condition, code, site)), _ => None }).collect();
            // What every caller past the top-level requires holds: their single-disjunct
            // conditions, and a key column the delete pins to `viewer` itself.
            let mut facts: Vec<RuleExpr> = top.iter().filter_map(|(condition, ..)| bind(row.rule(condition)?))
                .filter(|rule| rule.disjuncts().len() == 1).flat_map(|rule| conjuncts(&rule).into_iter().cloned().collect::<Vec<_>>()).collect();
            facts.extend(row.pinned.iter().filter(|(_, value)| value.as_str() == "viewer").map(|(column, _)| RuleExpr::Eq(RuleTerm::Field(column.clone()), RuleTerm::Viewer)));
            let parties = |rule: &RuleExpr| -> Vec<RuleExpr> { conjuncts(rule).into_iter().filter(|c| mentions_viewer(c)).cloned().collect() };
            let row_party = |rule: &RuleExpr| match rule { RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => Some(column.clone()), _ => None };
            for (condition, code, _) in &top {
                if !names_viewer(condition) { continue; }
                let Some(rule) = row.rule(condition).and_then(bind) else { continue };
                for disjunct in rule.disjuncts() {
                    // A caller identified by a column of the deleted row (`person = viewer`, the
                    // row's member), and only by positive identity tests.
                    let own = parties(disjunct);
                    let Some(column) = own.iter().find_map(row_party) else { continue };
                    if !own.iter().all(|c| matches!(c, RuleExpr::Eq(..) | RuleExpr::Exists { .. })) { continue; }
                    let mut have: Vec<RuleExpr> = conjuncts(disjunct).into_iter().cloned().collect();
                    have.extend(facts.iter().cloned());
                    let delete = table.rules.delete.disjuncts();
                    // Another column of the row naming the caller may equal this one by the app's own invariant.
                    if delete.iter().flat_map(|d| parties(d)).filter_map(|c| row_party(&c)).any(|other| other != column) { continue; }
                    let admitted = delete.into_iter().any(|option| parties(option).iter().all(|need| have.iter().any(|h| same_test(schema, h, need))));
                    if admitted { continue; }
                    let site = rule_site(catalog, &name, Effect::Delete).map(|s| format!(" ({s})")).unwrap_or_default();
                    let party = disjunct.quarry();
                    notes.push(Diagnostic::new(&write_site, "N_REQUIRE_REFUSED",
                        format!("mutation {}: `require {}` admits a caller by `{party}` (on the deleted {name} row), but {name}'s delete rule `{}`{site} admits no such caller: they pass the require, then the delete refuses them E_RULE, never your {code}", program.name, crate::print::expression(condition), table.rules.delete.quarry()),
                        format!("if that caller may delete the row, add them to the rule (`delete <- {} or {party}`); otherwise drop that branch from the require so they get {code}", table.rules.delete.quarry())).guide("rules"));
                    break;
                }
            }
        }
    }
}

/// `have` decides `need`: `implies`, or the same parent test spelled as a
/// probe (`exists teams[.team, captain = viewer]`) and as a hop
/// (`teams[.team].captain = viewer`).
fn same_test(schema: &Schema, have: &RuleExpr, need: &RuleExpr) -> bool {
    fn canon(schema: &Schema, rule: &RuleExpr) -> Option<(String, BTreeSet<(String, String)>)> {
        let term = |t: &RuleTerm| format!("{t:?}");
        match rule {
            RuleExpr::Eq(RuleTerm::Reference { table, column, field, old: false }, RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Reference { table, column, field, old: false }) =>
                Some((table.clone(), BTreeSet::from([("id".to_owned(), term(&RuleTerm::Field(column.clone()))), (field.clone(), term(&RuleTerm::Viewer))]))),
            RuleExpr::Exists { table, index, key, equalities, .. } => {
                let columns = schema.table(table)?.index(index)?.columns();
                let mut pairs: BTreeSet<(String, String)> = columns.into_iter().zip(key.iter().map(term)).collect();
                pairs.extend(equalities.iter().map(|(column, t)| (column.clone(), term(t))));
                Some((table.clone(), pairs))
            }
            _ => None,
        }
    }
    if implies(have, need) { return true; }
    match (canon(schema, have), canon(schema, need)) {
        (Some((a, have)), Some((b, need))) => a == b && need.is_subset(&have),
        _ => false,
    }
}

pub(super) fn empty_read(table: &str, site: &Site) -> ReadExpr {
    ReadExpr { cursor_prefix: None, computed: BTreeMap::new(), order_keys: Vec::new(), table: table.to_owned(), keys: Vec::new(), seeks: Vec::new(), filter: None, index: None, range: None, matching: None, site: site.clone() }
}

// @ref LLP 3000.036.002#4 — program guards observe the caller's reads, never global absence.
fn unreadable_guards(catalog: &Catalog, schema: &Schema, programs: &[&ProgramDecl], notes: &mut Vec<Diagnostic>) {
    fn expand_shorthand(expr: &mut Expr) {
        if let Expr::Object { fields, .. } | Expr::Write { fields, .. } = expr {
            for field in fields {
                if field.value.is_none() && !field.spread { field.value = Some(Expr::Name { name: field.name.clone(), site: field.site.clone() }); }
            }
        }
    }
    fn analysis_expr(value: &Expr) -> Expr {
        let mut copy = value.clone(); super::intent_walk::expression(&mut copy, &mut expand_shorthand); copy
    }
    fn analysis_body(body: &[Stmt]) -> Vec<Stmt> {
        let mut copy = body.to_vec(); super::intent_walk::statements(&mut copy, &mut expand_shorthand); copy
    }
    fn fact_text(value: &Expr) -> String {
        let mut value = analysis_expr(value);
        super::intent_walk::expression(&mut value, &mut |expr| {
            if is_viewer(expr) { *expr = Expr::Name { name: "viewer".into(), site: expr.site().clone() }; }
        });
        crate::print::expression(&value)
    }
    fn facts(condition: &Expr, out: &mut BTreeSet<String>) {
        if let Expr::Binary { op, left, right, .. } = condition && op == "and" { facts(left, out); facts(right, out); }
        else { out.insert(fact_text(condition)); }
    }
    fn proven_facts(catalog: &Catalog, schema: &Schema, condition: &Expr, out: &mut BTreeSet<String>) {
        facts(condition, out);
        if let Expr::Binary { op, left, right, .. } = condition && op == "and" {
            proven_facts(catalog, schema, left, out); proven_facts(catalog, schema, right, out);
        } else if let Expr::Exists { read, .. } = condition
            && let Some(fact) = point_fact(catalog, schema, read) { out.insert(fact); }
    }
    fn read_dependencies(rule: &RuleExpr, out: &mut BTreeSet<String>) {
        match rule {
            RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. } => {
                out.insert(table.clone());
            }
            RuleExpr::And(items) | RuleExpr::Or(items) => {
                for item in items { read_dependencies(item, out); }
            }
            RuleExpr::Not(rule) => read_dependencies(rule, out),
            _ => {}
        }
    }
    fn readable(catalog: &Catalog, schema: &Schema, read: &ReadExpr, known: &BTreeSet<String>) -> bool {
        let Some(table) = schema.table(&read.table) else { return true };
        if super::owner_equality::readable(catalog, schema, read, known) { return true; }
        let Some(info) = catalog.tables.get(&read.table) else { return table.rules.read.is_uniformly_readable(); };
        let mut pinned = BTreeMap::new();
        // Unlike older advisory lints, proof cannot guess a non-id key: typed ids
        // may select byId even beside one same-width principal/composite key.
        let selected = read.index.as_ref().and_then(|name| info.indexes.iter().find(|index| &index.name == name));
        let inferred: Vec<_> = info.indexes.iter().filter(|index| index.unique && index.is_plain() && index.columns.len() == read.keys.len()).collect();
        let positional_index = if read.index.is_some() { selected.filter(|index| index.is_plain()) }
            else { match inferred.as_slice() { [index] => Some(*index), _ => None } };
        if let Some(index) = positional_index {
            for (column, key) in index.columns.iter().zip(&read.keys) {
                pinned.insert(key.column.clone().unwrap_or_else(|| column.clone()), key.value.clone());
            }
        }
        // Extra named tests pin fields even when the positional prefix is unresolved.
        if selected.is_none_or(|index| index.computed.is_empty()) {
            for part in &read.keys { if let Some(column) = &part.column { pinned.insert(column.clone(), part.value.clone()); } }
        }
        if read.index.is_none() && read.keys.iter().filter(|key| key.column.is_none()).count() == 1 && read.keys.first().is_some_and(|part| part.column.is_none() && is_viewer(&part.value)) {
            let principal_keys: Vec<_> = table.indexes.values().filter(|index| index.unique && index.columns().len() == 1
                && table.columns.get(&index.columns()[0]) == Some(&snapback4_core::schema::ColumnType::Principal)).collect();
            if let [index] = principal_keys.as_slice() { pinned.insert(index.columns()[0].clone(), read.keys[0].value.clone()); }
        }
        let mut filters = Vec::new();
        if let Some(filter) = &read.filter { super::intent::split((**filter).clone(), &mut filters); }
        for filter in filters {
            if let Expr::Binary { op, left, right, .. } = &filter && op == "="
                && let Some(column) = super::intent::column(left) { pinned.entry(column.to_owned()).or_insert_with(|| (**right).clone()); }
        }
        // A total self-membership key is witnessed by the probed row itself.
        if table.rules.read.disjuncts().iter().any(|rule| {
            let RuleExpr::Exists { table: target, index, key, equalities, .. } = rule else { return false };
            target == &read.table && equalities.is_empty() && table.index(index).is_some_and(|index|
                index.unique && index.columns().len() == key.len() && index.columns().iter().zip(key).all(|(column, value)| {
                    let required = column == "id" || table.columns.get(column).is_some_and(|kind| !matches!(kind, snapback4_core::schema::ColumnType::Optional(_)));
                    required && (matches!(value, RuleTerm::Field(field) if field == column)
                        || matches!(value, RuleTerm::Viewer) && pinned.get(column).is_some_and(is_viewer))
                }))
        }) { return true; }
        let term = |term: &RuleTerm| -> Option<String> {
            match term {
                RuleTerm::Viewer => Some("viewer".into()),
                RuleTerm::Literal(value) => Some(RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Literal(value.clone())).quarry().trim_start_matches("viewer = ").to_owned()),
                RuleTerm::Field(column) => pinned.get(column).map(fact_text),
                _ => None,
            }
        };
        fn holds(rule: &RuleExpr, term: &impl Fn(&RuleTerm) -> Option<String>, schema: &Schema, known: &BTreeSet<String>) -> bool {
            match rule {
                RuleExpr::Allow | RuleExpr::Public { .. } => true,
                RuleExpr::Eq(a, b) => match (term(a), term(b)) {
                    (Some(a), Some(b)) => a == b || known.contains(&format!("({a} = {b})")) || known.contains(&format!("({b} = {a})")),
                    _ => false,
                },
                RuleExpr::And(items) => items.iter().all(|rule| holds(rule, term, schema, known)),
                RuleExpr::Or(items) => items.iter().any(|rule| holds(rule, term, schema, known)),
                RuleExpr::Exists { table, index, key, equalities, .. } => {
                    let Some(target) = schema.table(table).and_then(|t| t.index(index)) else { return false };
                    let Some(key) = key.iter().map(term).collect::<Option<Vec<_>>>() else { return false };
                    let plain = format!("exists {table}[{}]", key.join(", "));
                    let Some(extra) = equalities.iter().map(|(c, t)| term(t).map(|v| format!("{c} = {v}"))).collect::<Option<Vec<_>>>() else { return false };
                    let named = target.columns().iter().zip(&key).map(|(c, v)| format!("{c} = {v}"))
                        .chain(extra.iter().cloned()).collect::<Vec<_>>().join(", ");
                    let mixed = format!("exists {table}[{}]",key.iter().cloned().chain(extra).collect::<Vec<_>>().join(", "));
                    // Positional spellings with multiple compatible index widths
                    // are not evidence for this particular raw-rule key.
                    let source = schema.table(table).unwrap();
                    let unambiguous = source.indexes.values().filter(|candidate| candidate.unique && candidate.columns().len() == key.len()).count() == 1
                        || key.len() == 1 && key[0] == "viewer" && target.columns().len() == 1
                            && source.columns.get(&target.columns()[0]) == Some(&snapback4_core::schema::ColumnType::Principal)
                            && source.indexes.values().filter(|candidate| candidate.unique && candidate.columns().len() == 1
                                && source.columns.get(&candidate.columns()[0]) == Some(&snapback4_core::schema::ColumnType::Principal)).count() == 1;
                    (unambiguous && (known.contains(&mixed) || equalities.is_empty() && known.contains(&plain)))
                        || known.contains(&format!("exists {table}[{named}]"))
                },
                _ => false,
            }
        }
        holds(&table.rules.read, &term, schema, known)
    }
    fn guard(catalog: &Catalog, schema: &Schema, program: &str, condition: &Expr, known: &BTreeSet<String>, system: bool, notes: &mut Vec<Diagnostic>) {
        if system { return; }
        let mut reads = Vec::new();
        let mut copy = analysis_expr(condition);
        super::intent_walk::expression(&mut copy, &mut |expr| {
            if let Expr::Exists { read, .. } = expr { reads.push(read.clone()); }
            if let Expr::Binary { op,left,right,.. } = expr && op == "=" {
                if let (Expr::Read(read),Expr::Literal { value:Literal::Null,.. }) | (Expr::Literal { value:Literal::Null,.. },Expr::Read(read)) = (left.as_ref(),right.as_ref()) { reads.push(read.clone()); }
            }
        });
        for read in reads {
            let Some(table) = schema.table(&read.table) else { continue };
            if readable(catalog, schema, &read, known) { continue; }
            if notes.iter().any(|note| note.site == read.site && note.code == "N_REQUIRE_HIDDEN" || note.site.file == read.site.file && note.site.line == read.site.line && note.code == "N_UNREADABLE_PROBE" && note.message.starts_with(&format!("{program}: this probe reads {} under", read.table))) { continue; }
            let rule_site = rule_site(catalog, &read.table, Effect::Read).map(|site| format!(" ({site})")).unwrap_or_default();
            // @ref LLP 3000.036.002#9 — acknowledge an existing readable path while retaining conservative probe advice.
            let mut rule_dependencies = BTreeSet::new();
            read_dependencies(&table.rules.read, &mut rule_dependencies);
            let established: Vec<_> = rule_dependencies.into_iter().filter(|dependency| {
                known.iter().any(|fact| fact.starts_with(&format!("exists {dependency}[")))
            }).collect();
            let path = if established.is_empty() {
                String::new()
            } else {
                format!(" This require/read path already established a readable {} row; the note remains because the compiler cannot prove that fact admits every {} row this negative probe must observe.", established.join(" or "), read.table)
            };
            notes.push(Diagnostic::new(&read.site, "N_UNREADABLE_PROBE",
                format!("{program}: this probe reads {} under its read rule `{}`{rule_site}; rows hidden from the caller do not satisfy a program exists, so using this value as a negative guard cannot enforce absence across those rows (table-rule probes see all rows).{path}", read.table, table.rules.read.quarry()),
                "use a unique/cap/after insert constraint for an invariant across hidden rows, or authorize this caller to read the rows the guard must observe; keep this probe only when caller-visible existence is intended").guide("rules"));
        }
    }
    fn absence(condition: &Expr, inverted: bool) -> Vec<ReadExpr> {
        match condition {
            Expr::Exists { read, .. } => {
                let mut out = if inverted { vec![read.clone()] } else { vec![] };
                out.extend(absence(&Expr::Read(read.clone()), false)); out
            },
            Expr::Unary { op, value, .. } if op == "not" => absence(value, !inverted),
            Expr::Binary { op, left, right, .. } if op == "=" || op == "!=" => {
                let pair = match (left.as_ref(), right.as_ref()) {
                    (value, Expr::Literal { value: Literal::Bool(b), .. }) | (Expr::Literal { value: Literal::Bool(b), .. }, value) => Some((value, *b)),
                    _ => None,
                };
                pair.map(|(value, b)| absence(value, inverted ^ (op == "=" && !b || op == "!=" && b))).unwrap_or_else(|| absence(left, inverted).into_iter().chain(absence(right, inverted)).collect())
            }
            Expr::Binary { left, right, .. } => absence(left, inverted).into_iter().chain(absence(right, inverted)).collect(),
            Expr::If { then, condition, otherwise, .. } => {
                let mut all = Vec::new(); let mut copy = (**condition).clone();
                super::intent_walk::expression(&mut copy, &mut |expr| { if let Expr::Exists { read, .. } = expr { all.push(read.clone()); } });
                all.extend(absence(then, inverted)); all.extend(absence(otherwise, inverted)); all
            }
            Expr::Unary { value, .. } | Expr::Member { base: value, .. } | Expr::Assert { value, .. }
                | Expr::ShapeUse { base: value, .. } | Expr::Walk { seed: value, .. } => absence(value, inverted),
            Expr::Array { items, .. } | Expr::Call { args: items, .. } => items.iter().flat_map(|value| absence(value, inverted)).collect(),
            Expr::Object { fields, .. } => fields.iter().filter_map(|field| field.value.as_ref()).flat_map(|value| absence(value, inverted)).collect(),
            Expr::Shape { base, fields, .. } => absence(base, inverted).into_iter().chain(fields.iter().filter_map(|field| match field {
                ShapeField::Field { value, .. } => Some(value), _ => None,
            }).flat_map(|value| absence(value, inverted))).collect(),
            Expr::Read(read) | Expr::Created { read, .. } => {
                let mut values: Vec<_> = read.keys.iter().map(|key| &key.value).chain(read.seeks.iter().map(|key| &key.value)).collect();
                values.extend(read.filter.as_deref()); values.extend(read.matching.as_deref());
                values.extend(read.range.as_ref().and_then(|range| range.cursor.as_deref()));
                values.into_iter().flat_map(|value| absence(value, false)).collect()
            },
            Expr::Write { keys, fields, condition, .. } => keys.iter().map(|key| &key.value)
                .chain(fields.iter().filter_map(|field| field.value.as_ref())).chain(condition.as_deref())
                .flat_map(|value| absence(value, inverted)).collect(),
            Expr::Merge(merge) => {
                let mut values: Vec<Expr> = [&merge.matching, &merge.filter, &merge.cursor].into_iter().filter_map(|value| value.as_deref().cloned()).collect();
                for lane in &merge.lanes {
                    values.extend(lane.admission.as_deref().cloned()); values.extend(lane.distinct.clone());
                    values.extend(lane.prefix.iter().cloned()); values.extend(lane.loop_.as_ref().map(|(_, value)| value.clone()));
                    for read in lane.planned.iter().chain(lane.nulls.as_ref().map(|(_, read)| read)) { values.push(Expr::Read(*read.clone())); }
                    if let Some(fields) = &lane.project { values.extend(fields.iter().filter_map(|field| if let ShapeField::Field { value, .. } = field { Some(value.clone()) } else { None })); }
                }
                values.iter().flat_map(|value| absence(value, inverted)).collect()
            },
            Expr::Name { .. } | Expr::Focal { .. } | Expr::Literal { .. } => vec![],
        }
    }
    // Reverse dependency closure identifies query values consumed by guards,
    // across aliases/objects and all possible rebinding paths. The observation
    // is checked at its original statement, with that statement's authority.
    fn has_guard(catalog: &Catalog, statements: &[Stmt], visiting: &mut BTreeSet<String>) -> bool {
        if statements.iter().any(|stmt| matches!(stmt, Stmt::Require { .. } | Stmt::If { .. })) { return true; }
        let mut copy = analysis_body(statements); let mut found = false;
        super::intent_walk::statements(&mut copy, &mut |expr| {
            if matches!(expr, Expr::If { .. }) { found = true; }
            for (name, shape) in definitions(catalog, expr) {
                let key = format!("{shape}:{name}");
                if !visiting.insert(key.clone()) { found = true; continue; }
                found |= helper_body(catalog, &name, shape).is_some_and(|body| has_guard(catalog, &body, visiting));
                visiting.remove(&key);
            }
        });
        // Explicit guards can also be nested in loops/viewer scopes.
        found || statements.iter().any(|stmt| match stmt { Stmt::For { body, .. } | Stmt::As { body, .. } => has_guard(catalog, body, visiting), _ => false })
    }
    fn guarded_inputs(catalog: &Catalog, expr: &Expr) -> Vec<Expr> {
        let consumed = definitions(catalog, expr).iter().any(|(name, shape)| helper_body(catalog, name, *shape)
            .is_some_and(|body| has_guard(catalog, &body, &mut BTreeSet::from([format!("{shape}:{name}")]))));
        match expr {
            Expr::Call { args, .. } if consumed => args.clone(),
            Expr::ShapeUse { base, .. } if consumed => vec![(**base).clone()],
            Expr::Shape { base, fields, .. } => {
                let values: Vec<_> = fields.iter().filter_map(|field| if let ShapeField::Field { value, site, .. } = field { Some(Stmt::Expr { value: value.clone(), site: site.clone() }) } else { None }).collect();
                if consumed || has_guard(catalog, &values, &mut BTreeSet::new()) { vec![(**base).clone()] } else { vec![] }
            },
            _ => vec![],
        }
    }
    fn guard_bindings(catalog: &Catalog, statements: &[Stmt]) -> BTreeSet<String> {
        fn add_names(expr: &Expr, out: &mut BTreeSet<String>) {
            if let Expr::Name { name, .. } = expr { out.insert(name.clone()); }
            if let Expr::Object { fields, .. } | Expr::Write { fields, .. } = expr {
                out.extend(fields.iter().filter(|field| field.value.is_none() && !field.spread).map(|field| field.name.clone()));
            }
        }
        fn names(value: &Expr) -> BTreeSet<String> {
            let mut out = BTreeSet::new(); let mut copy = analysis_expr(value);
            super::intent_walk::expression(&mut copy, &mut |expr| add_names(expr, &mut out)); out
        }
        fn input_names(value: &Expr) -> BTreeSet<String> {
            let mut out = BTreeSet::new(); value_nodes(value, &mut |expr| add_names(expr, &mut out)); out
        }
        fn gather(catalog: &Catalog, statements: &[Stmt], guards: &mut BTreeSet<String>, edges: &mut BTreeMap<String, BTreeSet<String>>) {
            let mut copy = analysis_body(statements);
            super::intent_walk::statements(&mut copy, &mut |expr| {
                if let Expr::If { condition, .. } = expr { guards.extend(names(condition)); }
                // A definition can consume its input as a guard even when the
                // call itself is not a conditional. Conservatively track all
                // argument/base dependencies of such definitions.
                for input in guarded_inputs(catalog, expr) { guards.extend(input_names(&input)); }
            });
            for statement in statements {
                match statement {
                    Stmt::Bind { names: bindings, value, .. } => for name in bindings { edges.entry(name.clone()).or_default().extend(names(value)); },
                    Stmt::Require { condition, .. } => guards.extend(names(condition)),
                    Stmt::If { condition, then_body, else_body, .. } => { guards.extend(names(condition)); gather(catalog, then_body, guards, edges); gather(catalog, else_body, guards, edges); }
                    Stmt::For { name, domain, body, .. } => { edges.entry(name.clone()).or_default().extend(names(domain)); gather(catalog, body, guards, edges); }
                    Stmt::As { body, .. } => gather(catalog, body, guards, edges),
                    _ => {}
                }
            }
        }
        let mut guards = BTreeSet::new(); let mut edges = BTreeMap::new(); gather(catalog, statements, &mut guards, &mut edges);
        loop {
            let count = guards.len();
            let next: Vec<_> = guards.iter().filter_map(|name| edges.get(name)).flat_map(|values| values.iter().cloned()).collect();
            guards.extend(next); if count == guards.len() { return guards; }
        }
    }
    fn helper_body(catalog: &Catalog, name: &str, shape: bool) -> Option<Vec<Stmt>> {
        if shape {
            let decl = catalog.shapes.get(name)?;
            Some(decl.fields.iter().filter_map(|field| match field {
                ShapeField::Field { value, site, .. } => Some(Stmt::Expr { value: value.clone(), site: site.clone() }),
                ShapeField::NamedSpread { name, site } => Some(Stmt::Expr { value: Expr::ShapeUse { base: Box::new(Expr::Focal { site: site.clone() }), name: name.clone(), site: site.clone() }, site: site.clone() }),
                _ => None,
            }).collect())
        } else {
            let helper = catalog.functions.get(name)?;
            Some(match &helper.body {
                FunctionBody::Block(body) => body.clone(),
                FunctionBody::Expression(value) => vec![Stmt::Return { value: value.clone(), site: value.site().clone() }],
            })
        }
    }
    fn definitions(catalog: &Catalog, expr: &Expr) -> Vec<(String, bool)> {
        match expr {
            Expr::Call { name, .. } if catalog.functions.contains_key(name) => vec![(name.clone(), false)],
            Expr::ShapeUse { name, .. } => vec![(name.clone(), true)],
            Expr::Name { name, .. } if catalog.shapes.contains_key(name) => vec![(name.clone(), true)],
            Expr::Shape { fields, .. } => fields.iter().filter_map(|field| if let ShapeField::NamedSpread { name, .. } = field { Some((name.clone(), true)) } else { None }).collect(),
            _ => vec![],
        }
    }
    fn effects(catalog: &Catalog, statements: &[Stmt], visiting: &mut BTreeSet<String>) -> (bool, bool) {
        let mut copy = analysis_body(statements);
        let mut writes = false;
        let mut binds = false;
        fn bindings(body: &[Stmt]) -> bool {
            body.iter().any(|stmt| match stmt {
                Stmt::Bind { .. } => true,
                Stmt::If { then_body, else_body, .. } => bindings(then_body) || bindings(else_body),
                Stmt::For { body, .. } | Stmt::As { body, .. } => bindings(body),
                _ => false,
            })
        }
        binds |= bindings(statements);
        super::intent_walk::statements(&mut copy, &mut |expr| {
            if matches!(expr, Expr::Write { .. }) { writes = true; }
            for (name, shape) in definitions(catalog, expr) {
                let key = format!("{shape}:{name}");
                if !visiting.insert(key.clone()) { writes = true; binds = true; continue; }
                if let Some(body) = helper_body(catalog, &name, shape) {
                    let (w, b) = effects(catalog, &body, visiting); writes |= w; binds |= b;
                } else { writes = true; binds = true; }
                visiting.remove(&key);
            }
        });
        (writes, binds)
    }
    // @ref LLP 3000.036.002#12 — unrelated writes cannot revoke a proven roster.
    // Helpers, maintenance and row-derived facts keep the old barrier.
    // Deletes include every schema-declared cascade/set-null destination.
    fn preserve_rosters(catalog: &Catalog, schema: &Schema, statements: &[Stmt], known: &mut BTreeSet<String>) {
        let mut written = BTreeSet::new();
        let mut opaque = false;
        let mut copy = statements.to_vec();
        super::intent_walk::statements(&mut copy, &mut |expr| match expr {
            Expr::Write { op: WriteOp::Delete, table, .. } => {
                let mut todo=vec![table.clone()]; let mut visited=BTreeSet::new();
                while let Some(parent)=todo.pop() {
                    if !visited.insert(parent.clone()) {continue;}
                    written.insert(parent.clone());
                    for edge in schema.referencing(&parent) {
                        if edge.action.writes() {todo.push(edge.child.into());}
                    }
                }
            },
            Expr::Write { table, .. } => { written.insert(table.clone()); },
            _ if !definitions(catalog, expr).is_empty() => opaque = true,
            _ => {},
        });
        if opaque { known.clear(); return; }
        known.retain(|fact| {
            let (doc, errors) = crate::parser::parse_document("fact.q", &format!("query fact():\n  return {fact}\n"));
            if !errors.is_empty() { return false; }
            let Some(Stmt::Return { value: Expr::Exists { read, .. }, .. }) = doc.programs.first().and_then(|p| p.body.first()) else { return false };
            fn safe(schema: &Schema, name: &str, written: &BTreeSet<String>, seen: &mut BTreeSet<String>) -> bool {
                if written.contains(name) { return false; }
                if !seen.insert(name.into()) { return true; }
                let Some(table) = schema.table(name) else { return false };
                if table.through.is_some() || table.ephemeral.is_some() || schema.maintain_for(name).is_some() || !table.maintained.is_empty() { return false; }
                let mut dependencies = BTreeSet::new();
                read_dependencies(&table.rules.read, &mut dependencies);
                dependencies.iter().all(|name| safe(schema, name, written, seen))
            }
            read.keys.iter().all(|key| matches!(key.value, Expr::Name { .. } | Expr::Literal { .. }))
                && safe(schema, &read.table, &written, &mut BTreeSet::new())
        });
    }
    fn effectful(catalog: &Catalog, value: &Expr) -> bool {
        effects(catalog, &[Stmt::Expr { value: value.clone(), site: value.site().clone() }], &mut BTreeSet::new()).0
    }
    fn ordered_call(catalog: &Catalog, value: &Expr) -> bool {
        matches!(value, Expr::Call { name, args, .. } if catalog.functions.contains_key(name) && args.iter().all(|arg| !effectful(catalog, arg)))
    }
    fn call_facts(catalog: &Catalog, name: &str, args: &[Expr], known: &BTreeSet<String>, global: &BTreeSet<String>) -> BTreeSet<String> {
        let mut out: BTreeSet<_> = known.intersection(global).cloned().collect();
        let Some(helper) = catalog.functions.get(name) else { return out };
        let readonly = helper_body(catalog, name, false).is_some_and(|body| !effects(catalog, &body, &mut BTreeSet::new()).0);
        // Use fresh intermediate names so caller variables that happen to share
        // a formal's spelling cannot be mistaken for transferred evidence.
        for fact in known {
            let source = format!("query guardFact():\n  require {fact} else GUARD\n  return null\n");
            let (doc, errors) = crate::parser::parse_document("guard.q", &source);
            if !errors.is_empty() { continue; }
            let Some(Stmt::Require { condition, .. }) = doc.programs.first().and_then(|p| p.body.first()) else { continue };
            let mut condition = condition.clone();
            let mut used = BTreeSet::new();
            super::intent_walk::expression(&mut condition, &mut |expr| { if let Expr::Name { name, .. } = expr { used.insert(name.clone()); } });
            used.extend(helper.args.iter().map(|param| param.name.clone()));
            for arg in args {
                let mut copy = analysis_expr(arg);
                super::intent_walk::expression(&mut copy, &mut |expr| { if let Expr::Name { name, .. } = expr { used.insert(name.clone()); } });
            }
            let mut substitutions = Vec::new();
            for (param, arg) in helper.args.iter().zip(args) {
                if is_viewer(arg) || (!readonly && !matches!(arg, Expr::Name { .. })) { continue; }
                let mut marker = "diagSnapshot".to_owned();
                while used.contains(&marker) { marker.push('_'); }
                used.insert(marker.clone());
                substitutions.push((fact_text(arg), marker, param.name.clone()));
            }
            super::intent_walk::expression(&mut condition, &mut |expr| {
                let text = fact_text(expr);
                if let Some((_, marker, _)) = substitutions.iter().find(|(arg, _, _)| *arg == text) {
                    *expr = Expr::Name { name: marker.clone(), site: expr.site().clone() };
                }
            });
            let mut valid = true;
            super::intent_walk::expression(&mut condition, &mut |expr| {
                if let Expr::Name { name, .. } = expr && name != "viewer" && !substitutions.iter().any(|(_, marker, _)| marker == name) { valid = false; }
                if matches!(expr, Expr::Focal { .. }) { valid = false; }
            });
            if valid {
                super::intent_walk::expression(&mut condition, &mut |expr| {
                    if let Expr::Name { name, .. } = expr && let Some((_, _, param)) = substitutions.iter().find(|(_, marker, _)| marker == name) { *name = param.clone(); }
                });
                out.insert(fact_text(&condition));
            }
        }
        for (param, arg) in helper.args.iter().zip(args) {
            if is_viewer(arg) { out.insert(format!("({} = viewer)", param.name)); }
        }
        out
    }
    fn rebound_names(statements: &[Stmt], out: &mut BTreeSet<String>) {
        for statement in statements {
            match statement {
                Stmt::Bind { names, .. } => out.extend(names.iter().cloned()),
                Stmt::If { then_body, else_body, .. } => { rebound_names(then_body, out); rebound_names(else_body, out); }
                Stmt::For { body, .. } | Stmt::As { body, .. } => rebound_names(body, out),
                _ => {}
            }
        }
    }
    fn lookup_fact(catalog: &Catalog, schema: &Schema, names: &[String], value: &Expr, known: &mut BTreeSet<String>) {
        let mut shadowed = false;
        let mut copy = analysis_expr(value);
        super::intent_walk::expression(&mut copy, &mut |expr| { if matches!(expr, Expr::Name { name, .. } if names.contains(name)) { shadowed = true; } });
        if shadowed { return; }
        let Expr::Assert { value, .. } = value else { return };
        let Expr::Read(read) = value.as_ref() else { return };
        if let Some(fact) = point_fact(catalog, schema, read) { known.insert(fact); }
    }
    fn point_fact(catalog: &Catalog, schema: &Schema, read: &ReadExpr) -> Option<String> {
        if schema.maintain_for(&read.table).is_some() || !point_probe(catalog, read) { return None; }
        let info = catalog.tables.get(&read.table)?;
        let named = read.keys.iter().all(|key| key.column.is_some());
        let mut indexes: Vec<_> = info.indexes.iter().filter(|index| index.unique && index.is_plain() && read.index.as_ref().is_none_or(|name| name == &index.name)
            && if named { index.columns.iter().all(|column| read.keys.iter().any(|key| key.column.as_ref() == Some(column))) } else { index.columns.len() == read.keys.len() }).collect();
        if !named && read.index.is_none() && read.keys.len() == 1 && is_viewer(&read.keys[0].value) {
            indexes.retain(|index| info.columns.get(&index.columns[0]).is_some_and(|kind| kind.kind == TypeKind::Principal));
        }
        if !named && read.index.is_none() && super::owner_equality::typed_id(catalog, read) { indexes.retain(|index| index.name == "byId"); }
        let [index] = indexes.as_slice() else { return None };
        let keys = index.columns.iter().enumerate().filter_map(|(at, column)| {
            let key = if named { read.keys.iter().find(|key| key.column.as_ref() == Some(column)) } else { read.keys.get(at) }?;
            Some(format!("{column} = {}", fact_text(&key.value)))
        }).collect::<Vec<_>>().join(", ");
        // A successful ruled row lookup proves the indexed row exists. Extra
        // projected-field tests are not raw rule evidence and are deliberately omitted.
        Some(format!("exists {}[{keys}]", read.table))
    }
    fn point_probe(catalog: &Catalog, read: &ReadExpr) -> bool {
        if read.matching.is_some() || !read.seeks.is_empty() { return false; }
        let Some(info) = catalog.tables.get(&read.table) else { return false };
        let named = read.keys.iter().all(|key| key.column.is_some());
        info.indexes.iter().any(|index| index.unique && index.is_plain() && read.index.as_ref().is_none_or(|name| name == &index.name)
            && if named { index.columns.iter().all(|column| read.keys.iter().any(|key| key.column.as_ref() == Some(column))) }
                else { index.columns.len() == read.keys.len() })
    }
    fn quiet_proven_lookup(catalog: &Catalog, schema: &Schema, expr: &Expr, known: &BTreeSet<String>, notes: &mut Vec<Diagnostic>) {
        if let Expr::Write { op: WriteOp::Update | WriteOp::Delete, table, keys, site, .. } = expr {
            fn stable_key(value: &Expr) -> bool {
                match value {
                    Expr::Literal { .. } => true,
                    Expr::Name { name, .. } => name != "new",
                    Expr::Member { base, .. } => stable_key(base),
                    _ => false,
                }
            }
            if !keys.iter().all(|key| stable_key(&key.value)) { return; }
            let mut read = empty_read(table, site);
            read.keys = keys.clone();
            let witness = Expr::Exists { read: read.clone(), site: site.clone() };
            if readable(catalog, schema, &read, known) || known.contains(&fact_text(&witness))
                || point_fact(catalog, schema, &read).is_some_and(|fact| known.contains(&fact)) {
                notes.retain(|note| !(note.code == "N_LOOKUP_HIDDEN" && note.site == *site));
            }
        }
    }
    fn expression_guard_node(catalog: &Catalog, schema: &Schema, program: &str, expr: &Expr, known: &BTreeSet<String>, global: &BTreeSet<String>, system: bool, observe_prefix: bool, visiting: &mut BTreeSet<String>, notes: &mut Vec<Diagnostic>) {
        quiet_proven_lookup(catalog, schema, expr, known, notes);
        if !observe_prefix {
            for input in guarded_inputs(catalog, expr) {
                input_guards(catalog, schema, program, &input, known, global, system, visiting, notes);
            }
        }
        if let Expr::Exists { read, site } = expr && (observe_prefix || point_probe(catalog, read)) {
            guard(catalog, schema, program, &Expr::Exists { read: read.clone(), site: site.clone() }, known, system, notes);
        }
        if let Expr::If { condition, .. } = expr {
            guard(catalog, schema, program, condition, known, system, notes);
            expression_guards(catalog, schema, program, condition, known, global, system, true, visiting, notes);
        }
        for (name, shape) in definitions(catalog, expr) {
            let key = format!("{shape}:{name}");
            if !visiting.insert(key.clone()) { continue; }
            if let Some(inner) = helper_body(catalog, &name, shape) {
                // Parameters and focal rows belong to the definition's scope. Only
                // viewer/literal facts about the same world cross that boundary.
                let entry = if let Expr::Call { args, .. } = expr && !shape { call_facts(catalog, &name, args, known, global) } else { known.intersection(global).cloned().collect() };
                body(catalog, schema, program, &inner, entry, global, &guard_bindings(catalog, &inner), system, observe_prefix, visiting, notes);
            }
            visiting.remove(&key);
        }
    }
    // Immutable input-value traversal: candidate predicates determine a
    // returned row/page, not a boolean field received by a guard. Never erase
    // predicates from an AST used as readability/argument proof.
    fn value_nodes(value: &Expr, visit: &mut impl FnMut(&Expr)) {
        fn read(read: &ReadExpr, predicates: bool, visit: &mut impl FnMut(&Expr)) {
            for key in &read.keys { value_nodes(&key.value, visit); }
            for key in &read.seeks { value_nodes(&key.value, visit); }
            if predicates { for value in [&read.filter, &read.matching].into_iter().filter_map(|value| value.as_deref()) { value_nodes(value, visit); } }
            if let Some(value) = read.range.as_ref().and_then(|range| range.cursor.as_deref()) { value_nodes(value, visit); }
        }
        fn fields(fields: &[ShapeField], visit: &mut impl FnMut(&Expr)) {
            for field in fields { if let ShapeField::Field { value, .. } = field { value_nodes(value, visit); } }
        }
        match value {
            Expr::Read(source) => read(source, false, visit),
            Expr::Exists { read: source, .. } | Expr::Created { read: source, .. } => read(source, true, visit),
            Expr::Unary { value, .. } | Expr::Member { base: value, .. } | Expr::Assert { value, .. }
                | Expr::ShapeUse { base: value, .. } | Expr::Walk { seed: value, .. } => value_nodes(value, visit),
            Expr::Binary { left, right, .. } => { value_nodes(left, visit); value_nodes(right, visit); },
            Expr::Array { items, .. } | Expr::Call { args: items, .. } => { for item in items { value_nodes(item, visit); } },
            Expr::Object { fields, .. } => { for field in fields { if let Some(value) = &field.value { value_nodes(value, visit); } } },
            Expr::Shape { base, fields: shape, .. } => { value_nodes(base, visit); fields(shape, visit); },
            Expr::If { then, condition, otherwise, .. } => { value_nodes(then, visit); value_nodes(condition, visit); value_nodes(otherwise, visit); },
            Expr::Write { keys, fields, condition, .. } => {
                for key in keys { value_nodes(&key.value, visit); }
                for field in fields { if let Some(value) = &field.value { value_nodes(value, visit); } }
                if let Some(value) = condition { value_nodes(value, visit); }
            },
            Expr::Merge(merge) => {
                if let Some(cursor) = &merge.cursor { value_nodes(cursor, visit); }
                for lane in &merge.lanes {
                    for value in &lane.prefix { value_nodes(value, visit); }
                    if let Some((_, value)) = &lane.loop_ { value_nodes(value, visit); }
                    if let Some(value) = &lane.distinct { value_nodes(value, visit); }
                    if let Some(shape) = &lane.project { fields(shape, visit); }
                    for source in lane.planned.iter().chain(lane.nulls.as_ref().map(|(_, source)| source)) { read(source, false, visit); }
                }
            },
            Expr::Name { .. } | Expr::Focal { .. } | Expr::Literal { .. } => {}
        }
        visit(value);
    }
    fn input_guards(catalog: &Catalog, schema: &Schema, program: &str, value: &Expr, known: &BTreeSet<String>, global: &BTreeSet<String>, system: bool, visiting: &mut BTreeSet<String>, notes: &mut Vec<Diagnostic>) {
        value_nodes(value, &mut |expr| expression_guard_node(catalog, schema, program, expr, known, global, system, true, visiting, notes));
    }
    fn expression_guards(catalog: &Catalog, schema: &Schema, program: &str, value: &Expr, known: &BTreeSet<String>, global: &BTreeSet<String>, system: bool, observe_prefix: bool, visiting: &mut BTreeSet<String>, notes: &mut Vec<Diagnostic>) {
        let mut copy = analysis_expr(value);
        if observe_prefix {
            super::intent_walk::expression(&mut copy, &mut |expr| expression_guard_node(catalog, schema, program, expr, known, global, system, true, visiting, notes));
        } else {
            // Ordinary query values share the input-value boundary: point and
            // prefix probes in row-dependent candidate filters are visible hits.
            value_nodes(&copy, &mut |expr| expression_guard_node(catalog, schema, program, expr, known, global, system, false, visiting, notes));
        }
    }
    fn invalidate(names: &[String], known: &mut BTreeSet<String>) {
        known.retain(|fact| !fact.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| names.iter().any(|name| name == word)));
    }
    fn body(catalog: &Catalog, schema: &Schema, program: &str, statements: &[Stmt], mut known: BTreeSet<String>, global: &BTreeSet<String>, guard_names: &BTreeSet<String>, system: bool, observe_prefix: bool, visiting: &mut BTreeSet<String>, notes: &mut Vec<Diagnostic>) -> BTreeSet<String> {
        for statement in statements {
            match statement {
                Stmt::Require { condition, .. } => {
                    let writes = effectful(catalog, condition);
                    if writes { known.clear(); }
                    for read in absence(condition, false) {
                        guard(catalog, schema, program, &Expr::Exists { site: read.site.clone(), read }, &known, system, notes);
                    }
                    // Calls can return an existence value even when no probe is spelled here.
                    let mut copy = analysis_expr(condition);
                    super::intent_walk::expression(&mut copy, &mut |expr| {
                        if let Expr::Shape { base, .. } = expr {
                            input_guards(catalog, schema, program, base, &known, global, system, visiting, notes);
                        }
                        for (name, shape) in definitions(catalog, expr) {
                            // In a requirement, a helper can invert an input
                            // solely in its returned expression. Inspect all
                            // actual values, not just guard-consuming definitions.
                            let inputs = match expr {
                                Expr::Call { args, .. } => args.clone(),
                                Expr::ShapeUse { base, .. } | Expr::Shape { base, .. } => vec![(**base).clone()],
                                _ => vec![],
                            };
                            for input in inputs { input_guards(catalog, schema, program, &input, &known, global, system, visiting, notes); }
                            let key = format!("{shape}:{name}");
                            if !visiting.insert(key.clone()) { continue; }
                            if let Some(inner) = helper_body(catalog, &name, shape) {
                                let entry = if let Expr::Call { args, .. } = expr && !shape { call_facts(catalog, &name, args, &known, global) } else { known.intersection(global).cloned().collect() };
                                body(catalog, schema, program, &inner, entry, global, &guard_bindings(catalog, &inner), system, true, visiting, notes);
                            }
                            visiting.remove(&key);
                        }
                    });
                    if !writes { proven_facts(catalog, schema, condition, &mut known); }
                }
                Stmt::If { condition, then_body, else_body, .. } => {
                    let writes = effectful(catalog, condition);
                    if writes { known.clear(); }
                    guard(catalog, schema, program, condition, &known, system, notes);
                    expression_guards(catalog, schema, program, condition, &known, global, system, true, visiting, notes);
                    let mut yes = known.clone(); if !writes { proven_facts(catalog, schema, condition, &mut yes); }
                    let yes = body(catalog, schema, program, then_body, yes, global, guard_names, system, observe_prefix, visiting, notes);
                    let no = body(catalog, schema, program, else_body, known.clone(), global, guard_names, system, observe_prefix, visiting, notes);
                    known = yes.intersection(&no).cloned().collect();
                }
                Stmt::For { body: inner, domain, name, .. } => {
                    if effectful(catalog, domain) { known.clear(); }
                    expression_guards(catalog, schema, program, domain, &known, global, system, observe_prefix || guard_names.contains(name), visiting, notes);
                    // Any later iteration can begin after an earlier iteration's helper/write.
                    let (writes, binds) = effects(catalog, inner, &mut BTreeSet::new());
                    let mut changed = BTreeSet::new(); if binds { rebound_names(inner, &mut changed); }
                    let changed = changed.into_iter().collect::<Vec<_>>();
                    let mut entry = if writes { BTreeSet::new() } else { known.clone() };
                    invalidate(&changed, &mut entry);
                    invalidate(std::slice::from_ref(name), &mut entry);
                    let after = body(catalog, schema, program, inner, entry, global, guard_names, system, observe_prefix, visiting, notes);
                    // Break/continue paths may bypass evidence near the body's end.
                    if writes { known.clear(); } else if binds { invalidate(&changed, &mut known); } else { known = known.intersection(&after).cloned().collect(); }
                }
                // Viewer scopes differ from the surrounding principal; never carry its facts in.
                Stmt::As { body: inner, principal, .. } => {
                    expression_guards(catalog, schema, program, principal, &known, global, system, observe_prefix, visiting, notes);
                    body(catalog, schema, program, inner, BTreeSet::new(), global, guard_names, false, true, visiting, notes); known.clear();
                }
                Stmt::Break { .. } | Stmt::Continue { .. } => break,
                _ => {
                    // Values can contain conditional guards too; writes invalidate earlier role facts.
                    let one = vec![statement.clone()];
                    let wrote = effects(catalog, &one, &mut BTreeSet::new()).0;
                    // A direct write's lookup occurs before its own row change.
                    // Use the entry facts only when evaluating its operands cannot
                    // write first; nested/helper writes keep the ordinary barrier.
                    if let Stmt::Bind { value, .. } | Stmt::Expr { value, .. } | Stmt::Return { value, .. } = statement
                        && let Expr::Write { keys, fields, .. } = value
                        && keys.iter().all(|key| !effectful(catalog, &key.value))
                        && fields.iter().all(|field| field.value.as_ref().is_none_or(|value| !effectful(catalog, value))) {
                        quiet_proven_lookup(catalog, schema, value, &known, notes);
                    }
                    // Operand order can hide the grant before a later condition in this expression.
                    if wrote && !matches!(statement, Stmt::Bind { value, .. } | Stmt::Expr { value, .. } | Stmt::Return { value, .. } if ordered_call(catalog, value)) {
                        preserve_rosters(catalog, schema, &one, &mut known);
                    }
                    match statement {
                        Stmt::Bind { value, names, .. } => expression_guards(catalog, schema, program, value, &known, global, system, observe_prefix || names.iter().any(|name| guard_names.contains(name)), visiting, notes),
                        Stmt::Expr { value, .. } | Stmt::Return { value, .. } => expression_guards(catalog, schema, program, value, &known, global, system, observe_prefix, visiting, notes),
                        Stmt::Emit { payload, once, .. } => {
                            expression_guards(catalog, schema, program, payload, &known, global, system, observe_prefix, visiting, notes);
                            if let Some(value) = once { expression_guards(catalog, schema, program, value, &known, global, system, observe_prefix, visiting, notes); }
                        }
                        _ => {}
                    }
                    if wrote { preserve_rosters(catalog, schema, &one, &mut known); }
                    if let Stmt::Bind { names, .. } = statement {
                        invalidate(names, &mut known);
                        if !wrote && let Stmt::Bind { value, .. } = statement { lookup_fact(catalog, schema, names, value, &mut known); }
                    }
                    if matches!(statement, Stmt::Return { .. }) { break; }
                }
            }
        }
        known
    }
    let mut global = BTreeSet::new();
    let mut tested = Vec::new();
    for program in programs { conditions(&program.prelude, &mut tested); conditions(&program.body, &mut tested); }
    for helper in catalog.functions.values() { if let FunctionBody::Block(body) = &helper.body { conditions(body, &mut tested); } }
    for condition in tested {
        let mut parts = Vec::new(); super::intent::split(condition, &mut parts);
        for part in parts {
            let mut part = analysis_expr(&part);
            let text = fact_text(&part);
            let mut stable = true;
            super::intent_walk::expression(&mut part, &mut |expr| {
                if matches!(expr, Expr::Name { name, .. } if name != "viewer")
                    || matches!(expr, Expr::Focal { .. } | Expr::Call { .. } | Expr::Write { .. } | Expr::Shape { .. } | Expr::ShapeUse { .. }) { stable = false; }
            });
            if stable { global.insert(text); }
        }
    }
    for program in programs {
        let system = program.kind == ProgramKind::Job;
        let mut visiting = BTreeSet::new();
        let mut statements = program.prelude.clone(); statements.extend(program.body.iter().cloned());
        let guarded = guard_bindings(catalog, &statements);
        body(catalog, schema, &program.name, &statements, BTreeSet::new(), &global, &guarded, system, program.kind != ProgramKind::Query, &mut visiting, notes);
    }
    // Group only surviving occurrences: a guarded first write must not hide
    // a later unguarded write to the same table under the same effect.
    let mut shown = BTreeSet::new();
    notes.retain(|note| note.code != "N_LOOKUP_HIDDEN" || shown.insert(note.message.clone()));
}
