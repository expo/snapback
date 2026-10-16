//! Referential actions (LLP 3000.039): each reference between ordinary durable
//! tables says what deleting its target does — `on delete restrict` (the
//! default), `cascade`, `set null` or `keep`. This pass synthesizes the index
//! a reference is probed through, lowers the action into the schema, refuses
//! what a column cannot carry, checks that a delete's cascade fits its
//! program, and names every delete whose behavior the restrict default changed.
// @ref LLP 3000.039#2 — restrict is the default; cascade and set null need a cap on the reference.
use super::catalog::Catalog;
use super::intent_walk as walk;
use crate::{ast::*, diag::Diagnostic};
use snapback4_core::schema::{self as core, references::{self, OnDelete as Action}};
use std::collections::{BTreeMap, BTreeSet};

fn action(declared: OnDelete) -> Action {
    match declared { OnDelete::Restrict => Action::Restrict, OnDelete::Cascade => Action::Cascade, OnDelete::SetNull => Action::SetNull, OnDelete::Keep => Action::Keep }
}

/// Before the schema is bound: every reference whose action probes its
/// children gets an index leading with the reference (then the child's
/// `expire at` column), unless one already exists. A `cap N by <column>` is
/// served by the same index.
pub(super) fn indexes(catalog: &mut Catalog) {
    let ordinary = |catalog: &Catalog, name: &str| catalog.tables.get(name).is_some_and(|info| info.maintained.is_none() && info.decl.ephemeral.is_none());
    let mut wanted = Vec::new();
    for (name, info) in &catalog.tables {
        if !ordinary(catalog, name) { continue; }
        for column in &info.decl.columns {
            let TypeKind::Ref { table: parent } = &column.type_.kind else { continue };
            if column.on_delete.as_ref().is_some_and(|(a, _)| *a == OnDelete::Keep) || column.written_by.is_some() || !ordinary(catalog, parent) { continue; }
            if info.through.as_ref().is_some_and(|through| through.reference == column.name) { continue; }
            // @ref LLP 3000.039#2.3 — the effective deadline: a read-through child's `$deadline`, else `expire at`.
            let mut leading = vec![column.name.clone()];
            if info.through.as_ref().is_some_and(|t| t.expiring) { leading.push(snapback4_core::schema::through::DEADLINE.to_owned()); }
            else if let Some((expire, _)) = &info.decl.expire { leading.push(expire.clone()); }
            if info.indexes.iter().any(|index| index.is_plain() && index.columns.starts_with(&leading)) { continue; }
            leading.push("id".into());
            wanted.push((name.clone(), IndexDecl { name: references::reference_index_name(&column.name), columns: leading, unique: false, refusal: None, words: None, computed: BTreeMap::new(), site: column.site.clone() }));
        }
    }
    for (table, index) in wanted {
        catalog.synthesized.insert((table.clone(), index.name.clone()));
        catalog.tables.get_mut(&table).expect("catalog table").indexes.push(index);
    }
}

/// After receipts and timelines are bound (they decide which tables are
/// engine bookkeeping): lower each action, refusing what a column cannot carry.
pub(super) fn bind(catalog: &Catalog, schema: &mut core::Schema, diagnostics: &mut Vec<Diagnostic>) {
    let mut lowered: Vec<(String, String, Action)> = Vec::new();
    let mut unbounded = BTreeMap::new();
    for (name, info) in &catalog.tables {
        if info.maintained.is_some() { continue; }
        for column in &info.decl.columns {
            let declared = column.on_delete.as_ref();
            let site = declared.map_or(&column.site, |(_, site)| site);
            let refuse = |diagnostics: &mut Vec<Diagnostic>, message: String, rewrite: String| diagnostics.push(Diagnostic::new(site, "E_REFERENCE_ACTION", message, rewrite).guide("writes"));
            let TypeKind::Ref { table: parent } = &column.type_.kind else {
                if declared.is_some() { refuse(diagnostics, format!("{name}.{} is not a reference; `on delete` belongs on a column whose type names a table", column.name), format!("{}: <table> on delete …, or remove `on delete`", column.name)); }
                continue;
            };
            if !schema.tables.contains_key(parent) || !schema.tables.contains_key(name) { continue; }
            // @ref LLP 3000.039#2.1 — a field-owned reference is private to its owner: probing it would disclose it.
            if column.written_by.is_some() {
                if declared.is_some() {
                    refuse(diagnostics, format!("{name}.{} is written by its field owner, so it carries no delete action: probing it would tell the parent's deleter about a private value", column.name), "remove `on delete`".into());
                }
                continue;
            }
            if !schema.actionable(name) || !schema.actionable(parent) {
                if declared.is_some() {
                    refuse(diagnostics, format!("{name}.{} -> {parent} carries no delete action: ephemeral tables, engine-maintained tables and receipt or timeline bookkeeping keep their own lifetimes, so the row stays when {parent} is deleted", column.name), "remove `on delete`".into());
                }
                continue;
            }
            let chosen = declared.map_or(Action::Restrict, |(a, _)| action(*a));
            let table = &schema.tables[name];
            let through = table.through.as_ref().is_some_and(|t| t.reference == column.name);
            if chosen.writes() && let Some(reason) = references::write_target_refusal(schema, name) {
                refuse(diagnostics, format!("{} on {name}.{}: {reason}; another row's delete may not delete or rewrite its rows", chosen.words(), column.name), if reason.contains("maintained sum") { format!("{}: {parent} on delete restrict   -- or keep. For a maintained sum source, unwind it with ordinary deletes in a system job: `job unwind():\n  for row in {name}:\n    delete {name}[row.id]`; each delete updates the sum. Mark the parent for cleanup, filter the job to those parents, and delete each parent only after its children are gone (guide writes)", column.name) } else { format!("{}: {parent} on delete restrict   -- or keep", column.name) });
                continue;
            }
            if chosen == Action::Keep && through {
                refuse(diagnostics, format!("on delete keep on read-through {name}.{}: a read-through child lives within its parent (LLP 3000.014 §3), so it cannot outlive it", column.name), format!("{}: {parent} on delete cascade, or leave it undeclared (restrict)", column.name));
                continue;
            }
            if chosen == Action::SetNull && let Some(reason) = references::set_null_refusal(schema, name, table, &column.name) {
                refuse(diagnostics, format!("on delete set null on {name}.{}: {reason}", column.name), format!("{}: {parent} on delete cascade, or {}: {parent} on delete restrict", column.name, column.name));
                continue;
            }
            if chosen == Action::Cascade && through && table.is_expiring() {
                refuse(diagnostics, format!("on delete cascade on read-through {name}.{} needs a child that never expires: an expired, unswept child still holds its parent (LLP 3000.014 §3.3)", column.name),
                    format!("keep `{}: {parent}` (restrict); delete live {name} rows, let the sweep take expired ones, then delete the {parent} row", column.name));
                continue;
            }
            if chosen.writes() && schema.reference_cap(name, &column.name).is_none() {
                unbounded.entry(parent.clone()).or_insert_with(|| site.clone());
            }
            // `keep` is the legacy meaning, so the schema spells it by absence: a
            // schema whose references all keep stays byte-identical and capability-free.
            if chosen != Action::Keep { lowered.push((name.clone(), column.name.clone(), chosen)); }
        }
    }
    for (name, column, chosen) in lowered {
        schema.tables.get_mut(&name).expect("bound table").on_delete.insert(column, chosen);
    }
    // Event prices depend on the actions just lowered and must precede bound checks.
    schema.prepare_write_reservations();
    // Diagnose an authored root's whole cascade once, including missing bounds
    // below an already-capped edge. Avoid contradictory parent/child recipes.
    let mut authored=BTreeSet::new();
    for doc in &catalog.documents {for program in &doc.programs {
        let mut body=program.prelude.clone();body.extend(program.body.clone());
        walk::statements(&mut body,&mut |expr| if let Expr::Write {op:WriteOp::Delete,table,..}=expr && schema.tables.contains_key(table) {authored.insert(table.clone());});
    }}
    for doc in &catalog.documents {for helper in &doc.functions {
        let collect=&mut |expr:&mut Expr| if let Expr::Write {op:WriteOp::Delete,table,..}=expr && schema.tables.contains_key(table) {authored.insert(table.clone());};
        match &helper.body {
            FunctionBody::Block(body)=>walk::statements(&mut body.clone(),collect),
            FunctionBody::Expression(expr)=>walk::expression(&mut expr.clone(),collect),
        }
    }}
    authored.extend(schema.tables.keys().filter(|name| references::delete_source(schema, name)).cloned());
    let mut roots=BTreeMap::new();
    for (parent,site) in &unbounded {
        let found=authored.iter().filter(|root|super::cascade_repair::reaches(schema,root,parent)).collect::<Vec<_>>();
        for root in found {roots.entry(root.clone()).or_insert_with(||site.clone());}
    }
    let names=roots.keys().cloned().collect::<Vec<_>>();
    roots.retain(|root,_|!names.iter().any(|other|other!=root && super::cascade_repair::reaches(schema,other,root) && !super::cascade_repair::reaches(schema,root,other)));
    for (parent,site) in roots {
        let missing=schema.tables.keys().filter(|table|super::cascade_repair::reaches(schema,&parent,table)).flat_map(|table|schema.referencing(table))
            .filter(|r|r.action.writes() && schema.reference_cap(r.child,r.column).is_none())
            .map(|r|format!("{}.{} needs `cap N by {}` or plain single-column `unique {}`",r.child,r.column,r.column,r.column)).collect::<Vec<_>>().join("; ");
        diagnostics.push(Diagnostic::new(&site,"E_CASCADE_BOUND",format!("delete {parent}: {missing}; all children share one reservation"),super::cascade_repair::recipe(schema,&parent,false)).guide("writes"));
    }
    // A cascade must end: no table reaches itself through cascades.
    let mut reported = BTreeSet::new();
    for name in schema.tables.keys().cloned().collect::<Vec<_>>() {
        if !unbounded.is_empty() || schema.delete_reservation(&name).is_some() || !schema.is_referenced(&name) { continue; }
        let Some(r) = schema.referencing(&name).into_iter().find(|r| r.action == Action::Cascade) else { continue };
        if !reported.insert((r.child.to_owned(), r.column.to_owned())) { continue; }
        let site = catalog.tables.get(r.child).and_then(|info| info.decl.columns.iter().find(|c| c.name == r.column)).map(|c| c.on_delete.as_ref().map_or(&c.site, |(_, s)| s).clone()).unwrap_or_default();
        diagnostics.push(Diagnostic::new(&site, "E_REFERENCE_ACTION", format!("on delete cascade from {name} reaches {name} again: a cascade must end, so the cascading references cannot form a cycle"),
            format!("{}: {name} on delete restrict   -- or set null on an optional reference", r.column)).guide("writes"));
    }
    if let Some(table) = schema.deletion_cycle() && !diagnostics.iter().any(|d| d.code == "E_REFERENCE_ACTION") {
        let site = catalog.tables.get(&table).map(|info| info.decl.site.clone()).unwrap_or_default();
        diagnostics.push(Diagnostic::new(&site, "E_REFERENCE_ACTION", format!("{table} reaches itself through `on delete cascade` and `read through`: a cascade deletes children before parents, and a read-through child must go before its parent, so no order can delete those rows"),
            "make one of the cascading references `on delete restrict`").guide("writes"));
    }
    for issue in references::validate(schema) {
        let site = catalog.site_for(&issue.path);
        if diagnostics.iter().any(|d| matches!(d.code.as_str(), "E_REFERENCE_ACTION" | "E_CASCADE_BOUND")) { break; }
        diagnostics.push(Diagnostic::new(&site, "E_REFERENCE_ACTION", issue.message, "declare the reference's action the line names (guide writes)").guide("writes"));
    }
}

/// Every delete site: a cascade whose reservation cannot fit its program is
/// `E_CASCADE_BOUND`; an undeclared reference that can now refuse the delete
/// is `N_DELETE_RESTRICTED` (it replaces the 0.4 orphans note).
// @ref LLP 3000.039#7 — the note fires exactly where the restrict default changed a delete's behavior.
pub(super) fn sites(catalog: &Catalog, schema: &core::Schema, diagnostics: &mut Vec<Diagnostic>) -> Vec<Diagnostic> {
    // parent -> the undeclared references that now refuse its delete.
    let mut undeclared: BTreeMap<&str, Vec<(&str, &str)>> = BTreeMap::new();
    for (name, info) in &catalog.tables {
        for column in info.decl.columns.iter().filter(|c| c.on_delete.is_none()) {
            let TypeKind::Ref { table: parent } = &column.type_.kind else { continue };
            // A read-through child refused its parent's delete before (E_PARENT_HAS_CHILDREN).
            if info.through.as_ref().is_some_and(|t| t.reference == column.name) { continue; }
            if schema.tables.get(name).and_then(|t| t.on_delete.get(&column.name)) == Some(&Action::Restrict) {
                undeclared.entry(parent.as_str()).or_default().push((name.as_str(), column.name.as_str()));
            }
        }
    }
    // Guards that prove no child exists (an unfiltered count required zero,
    // a count-like sum, a status every child insert flips away from): the
    // default cannot change that delete.
    let guards = super::delete_guards::Guards::new(catalog);
    let mut notes = Vec::new();
    let mut authored = BTreeSet::new();
    for document in &catalog.documents {
        let mut document = document.clone();
        walk::document(&mut document, &mut |expr| if let Expr::Write { op: WriteOp::Delete, table, .. } = expr { authored.insert(table.clone()); });
    }
    for (name, info) in &catalog.tables {
        for column in &info.decl.columns {
            let TypeKind::Ref { table: parent } = &column.type_.kind else { continue };
            if schema.tables.get(name).and_then(|table| table.on_delete.get(&column.name)).is_none_or(|action| !action.writes())
                || schema.reference_cap(name, &column.name).is_some() || references::delete_reachable(schema, parent)
                || authored.iter().any(|root| super::cascade_repair::reaches(schema, root, parent)) { continue; }
            notes.push(Diagnostic::new(&column.site, "N_CASCADE_DORMANT",
                format!("{name}.{} has an unbounded delete action, but no declared source can delete {parent}", column.name),
                format!("no cap is needed yet; when adding a delete rule, delete program or expiry, choose a product limit with `cap N by {}` on {name}; check will revalidate the whole action graph", column.name)).guide("writes"));
        }
    }
    for doc in &catalog.documents {
        for program in doc.programs.iter().filter(|p| !matches!(p.kind, ProgramKind::Query) && !p.native) {
            let original = program;
            let program = program.clone();
            // Each delete with the (child, reference) pairs a dominating zero-count
            // guard proves childless, and every sum view the program reads.
            let (deletes, summed) = guarded_deletes(&program, &guards, catalog, schema);
            let word = if program.kind == ProgramKind::Job { "job" } else { "mutation" };
            let mut noted: BTreeSet<String> = BTreeSet::new();
            let mut priced: BTreeSet<String> = BTreeSet::new();
            let mut read_noted: BTreeSet<String> = BTreeSet::new();
            for (parent, site, counted) in deletes {
                if noted.contains(&parent) { continue; }
                if priced.insert(parent.clone()) && let Some(price) = schema.delete_reservation(&parent) && let Some(over) = over_ceiling(&price, program.kind == ProgramKind::Job) {
                    let chain = schema.referencing(&parent).into_iter().filter(|r| r.action.writes())
                        .map(|r| format!("{}.{} ({}, cap {})", r.child, r.column, r.action.words(), schema.reference_cap(r.child, r.column).unwrap_or(0))).collect::<Vec<_>>().join(", ");
                    diagnostics.push(Diagnostic::new(&site, "E_CASCADE_BOUND",
                        format!("{word} {}: `delete {parent}[…]` reserves {over} for what it deletes or clears through {chain}, whether or not those rows exist, so the {word} can never commit", program.name),
                        super::cascade_repair::recipe(schema, &parent, program.kind == ProgramKind::Job)).guide("writes"));
                }
                // The delete reaches every table its cascades reach; their undeclared
                // references refuse it too.
                let mut reached = vec![parent.clone()];
                let mut at = 0;
                while at < reached.len() {
                    let next: Vec<String> = schema.referencing(&reached[at]).into_iter().filter(|r| r.action == Action::Cascade).map(|r| r.child.to_owned()).collect();
                    for table in next { if !reached.contains(&table) { reached.push(table); } }
                    at += 1;
                }
                let kept: Vec<(&str, &str, &str)> = reached.iter().flat_map(|table| undeclared.get(table.as_str()).into_iter().flatten().map(move |(c, col)| (table.as_str(), *c, *col)))
                    .filter(|(target, c, col)| !(*target == parent.as_str() && (counted.contains(&((*c).to_owned(), (*col).to_owned())) || guards.status_guarded(original, &site, &parent, c, col)))).collect();
                // @ref LLP 3000.039#7 — the read prerequisite is the other behavior change: name it where a deleter may not be a reader.
                if program.kind != ProgramKind::Job && read_noted.insert(parent.clone()) && schema.is_referenced(&parent) && !deleters_read(schema, &parent) && !schema.children(&parent).any(|_| true) {
                    notes.push(Diagnostic::new(&site, "N_DELETE_NEEDS_READ",
                        format!("mutation {}: `delete {parent}[…]` now also needs read authority on the row: other rows reference {parent} ({}), so a caller the delete rule admits but the read rule does not gets NOT_FOUND", program.name,
                            schema.referencing(&parent).into_iter().map(|r| format!("{}.{}", r.child, r.column)).collect::<Vec<_>>().join(", ")),
                        format!("make every {parent} deleter a reader (`delete <- <the read rule> and …`), or mark the reference `on delete keep` if deleting {parent} should not consult those rows")).guide("writes"));
                }
                let Some(&(target, child, column)) = kept.first() else { continue };
                noted.insert(parent.clone());
                let named = kept.iter().map(|(_, child, column)| format!("{child}.{column}")).collect::<Vec<_>>().join(", ");
                let through = if target == parent { String::new() } else { format!(" (through its cascade to {target})") };
                let sum = summed.iter().find(|(_, c, by, _)| target == parent && c == child && by == column).map(|(view, _, _, summed)| guards.sum_reason(view, child, column, summed)).unwrap_or_default();
                // @ref LLP 3000.036.002#9 — route multi-level keep/cascade choices to the focused guide section.
                notes.push(Diagnostic::new(&site, "N_DELETE_RESTRICTED",
                    format!("{word} {}: `delete {parent}[…]`{through} now refuses E_REFERENCED while a live row references it ({named}): an undeclared reference is `on delete restrict`; before 0.4.24 the referencing rows stayed and named a deleted row{sum}", program.name),
                    format!("declare what deleting a {target} row does to each: `{column}: {target} on delete cascade` deletes the {child} rows (with `cap N by {column}`), `{column}: {target} ? on delete set null` clears an optional reference, `on delete keep` keeps them as before, and `on delete restrict` preserves intended audit history and keeps this refusal; any declaration silences this note. Anyone whose insert rule admits a {child} row naming a {target} can hold it under restrict. Open `snapback4 guide writes --section \"On delete restrict\"` for keep-versus-cascade across multi-level chains")).guide("writes"));
            }
        }
    }
    notes
}

/// The meter a reservation exceeds for a mutation (or a job), if any.
pub(super) fn over_ceiling(price: &references::Price, job: bool) -> Option<String> {
    let c = if job { snapback4_core::Ceilings::job() } else { snapback4_core::Ceilings::default() };
    let limits = [(price[3], c.rows_written, "rows written"), (price[2], c.examined, "rows examined"), (price[1], c.index_entries, "index entries"), (price[0], c.steps, "steps"), (price[4], c.heap_bytes, "heap bytes"), (price[5], c.output_bytes, "output bytes"), (price[6], c.rule_probes, "rule probes")];
    limits.iter().find(|(used, limit, _)| used > limit).map(|(used, limit, kind)| format!("{used} {kind} (a {} may use {limit})", if job { "job chunk" } else { "mutation" }))
}

/// Whether every principal the delete rule admits can read the row, by a
/// structural sufficient implication proof. This is deliberately not a rule
/// satisfiability solver: an unproved application invariant keeps the note.
fn deleters_read(schema: &core::Schema, table: &str) -> bool {
    let Some(t) = schema.table(table) else { return true };
    fn required_bool_fact(table: &core::Table, rule: &core::RuleExpr) -> Option<(core::RuleTerm, bool)> {
        let comparison = |left: &core::RuleTerm, right: &core::RuleTerm, equal: bool| {
            let (term, core::RuleTerm::Literal(snapback4_core::Value::Bool(value))) = (match (left, right) {
                (term, literal @ core::RuleTerm::Literal(_)) | (literal @ core::RuleTerm::Literal(_), term) => (term, literal),
                _ => return None,
            }) else { return None };
            let core::RuleTerm::Field(field) = term else { return None };
            matches!(table.columns.get(field), Some(core::ColumnType::Bool)).then(|| (term.clone(), if equal { *value } else { !*value }))
        };
        match rule {
            core::RuleExpr::Eq(left, right) => comparison(left, right, true),
            core::RuleExpr::Ne(left, right) => comparison(left, right, false),
            core::RuleExpr::Not(inner) => required_bool_fact(table, inner).map(|(term, value)| (term, !value)),
            _ => None,
        }
    }
    fn implies(table: &core::Table, stronger: &core::RuleExpr, weaker: &core::RuleExpr) -> bool {
        if stronger == weaker || required_bool_fact(table, stronger).is_some_and(|fact| Some(fact) == required_bool_fact(table, weaker))
            || weaker.is_uniformly_readable() || matches!(stronger, core::RuleExpr::Deny) { return true; }
        match (stronger, weaker) {
            (_, core::RuleExpr::And(items)) => items.iter().all(|item| implies(table, stronger, item)),
            (core::RuleExpr::Or(items), _) => items.iter().all(|item| implies(table, item, weaker)),
            (core::RuleExpr::And(items), _) => items.iter().any(|item| implies(table, item, weaker)),
            (_, core::RuleExpr::Or(items)) => items.iter().any(|item| implies(table, stronger, item)),
            _ => false,
        }
    }
    implies(t, &t.rules.delete, &t.rules.read)
}

/// Every delete in a program, in order, each with the (child, reference)
/// pairs a guard proves have no row naming the deleted key: a top-level
/// `require <count>[<the deleted key>] = 0` earlier in the program, over an
/// unfiltered count (or count-like sum) of that child by that reference, with
/// no write of the child between it and the delete. A read of a count that
/// does not dominate the delete, names another key or is not required to be
/// zero proves nothing. Also every non-count-like sum view the program reads
/// (the note explains why it does not count).
// @ref LLP 3000.039#7 — only a dominating zero requirement on the deleted key proves the restrict cannot refuse.
fn guarded_deletes(program: &ProgramDecl, guards: &super::delete_guards::Guards, catalog: &Catalog, schema: &core::Schema) -> (Vec<(String, crate::diag::Site, BTreeSet<(String, String)>)>, Vec<(String, String, String, String)>) {
    let statements: Vec<Stmt> = program.prelude.iter().chain(&program.body).cloned().collect();
    let zero = |e: &Expr| matches!(e, Expr::Literal { value: Literal::Number(n), .. } if n.parse::<f64>().is_ok_and(|n| n == 0.0));
    let count_read = |e: &Expr| match e {
        Expr::Read(read) if read.keys.len() == 1 && read.filter.is_none() && read.range.is_none()
            && matches!(&read.keys[0].value, Expr::Name { name, .. } if name != "new") =>
            guards.counts.get(&read.table).map(|pair| (pair.clone(), crate::print::expression(&read.keys[0].value))),
        _ => None,
    };
    // (statement index, (child, reference), key text) for each zero requirement.
    let mut requires: Vec<(usize, (String, String), String)> = Vec::new();
    // Tables each statement writes other than by delete.
    let mut writes: Vec<BTreeSet<String>> = Vec::new();
    let mut uncertain = Vec::new();
    let mut deletes = Vec::new();
    let mut summed: Vec<(String, String, String, String)> = Vec::new();
    for (index, statement) in statements.iter().enumerate() {
        if let Stmt::Require { condition: Expr::Binary { op, left, right, .. }, .. } = statement && (op == "=" || op == "==") {
            let found = if zero(right) { count_read(left) } else if zero(left) { count_read(right) } else { None };
            if let Some((pair, key)) = found { requires.push((index, pair, key)); }
        }
        let mut body = vec![statement.clone()];
        let mut written = BTreeSet::new();
        let mut opaque = matches!(statement, Stmt::Bind { .. } | Stmt::If { .. } | Stmt::For { .. } | Stmt::As { .. });
        let mut found: Vec<(String, crate::diag::Site, Option<String>)> = Vec::new();
        walk::statements(&mut body, &mut |value: &mut Expr| match value {
            Expr::Write { op: WriteOp::Delete, table, keys, site, .. } =>
                found.push((table.clone(), site.clone(), (keys.len() == 1).then(|| crate::print::expression(&keys[0].value)))),
            Expr::Write { table, .. } => { written.insert(table.clone()); }
            Expr::Call { .. } => { opaque = true; }
            Expr::Read(read) | Expr::Exists { read, .. } => {
                if let Some((child, by, column)) = guards.sums.get(&read.table) && !summed.iter().any(|(view, ..)| view == &read.table) {
                    summed.push((read.table.clone(), child.clone(), by.clone(), column.clone()));
                }
            }
            _ => {}
        });
        if let Some((pair, key)) = ordered_delete(statement, catalog, schema, program.kind == ProgramKind::Job) {
            requires.push((index, pair, key));
            opaque = false;
        }
        writes.push(written);
        uncertain.push(opaque);
        for (table, site, key) in found {
            let proven = requires.iter().filter(|(at, (child, _), required)| *at < index && key.as_deref() == Some(required.as_str())
                && !uncertain[at + 1..=index].iter().any(|opaque| *opaque)
                && !writes[at + 1..=index].iter().any(|w| w.contains(child)))
                .map(|(_, pair, _)| pair.clone()).collect();
            deletes.push((table, site, proven));
        }
    }
    (deletes, summed)
}

// @ref LLP 3000.036.002#10 — only an unconditional whole-group deletion
// through an admitted population proves the later parent has no children.
fn ordered_delete(statement: &Stmt, catalog: &Catalog, schema: &core::Schema, system: bool) -> Option<((String,String),String)> {
    let Stmt::For { name, domain: Expr::Read(read), body, .. } = statement else { return None };
    if read.range.is_some() || read.filter.is_some() || read.matching.is_some() || !read.seeks.is_empty() || read.keys.len() != 1 { return None; }
    let child = catalog.tables.get(&read.table)?;
    if !system && child.decl.public.is_none() && !super::intent_branches::source_read_admitted(child, read) { return None; }
    let key = &read.keys[0];
    let column = key.column.as_ref()?;
    if !matches!(schema.table(&read.table)?.columns.get(column), Some(core::ColumnType::Ref { .. })) { return None; }
    if !matches!(&key.value, Expr::Name { name, .. } if name != "new") && !matches!(&key.value, Expr::Literal { .. }) { return None; }
    let [Stmt::Expr { value: Expr::Write { op: WriteOp::Delete, table, keys, .. }, .. }] = body.as_slice() else { return None };
    if table != &read.table || keys.len() != 1 { return None; }
    if !matches!(&keys[0].value, Expr::Member { base, name: field, .. } if field == "id" && matches!(base.as_ref(), Expr::Name { name: binding, .. } if binding == name)) { return None; }
    Some(((read.table.clone(), column.clone()),crate::print::expression(&key.value)))
}
