//! Guards that prove a delete finds no referencing row (LLP 3000.036 §16.2,
//! §17.4), for `N_DELETE_RESTRICTED` (LLP 3000.039 §7): an unfiltered count
//! of the child by the reference required zero, a `sum` view over a
//! count-like column, or a status the deleted row must hold that every child
//! insert flips away from. Where such a guard holds, the `restrict` default
//! cannot refuse that delete, so `check` does not name it. (These proofs were
//! the 0.4 orphans note's silencers; under 0.5 an undeclared reference
//! refuses instead of orphaning, and the note became `N_DELETE_RESTRICTED`.)
// @ref LLP 3000.039#7 — the wave 6–7 guards prove no child exists, so the restrict default cannot change that delete.
use super::catalog::Catalog;
use crate::ast::*;
use std::collections::{BTreeMap, BTreeSet};

/// What one deleting program's guards prove, from the whole catalog.
pub(super) struct Guards {
    /// count view -> (child, reference): includes `sum`s over count-like columns.
    pub counts: BTreeMap<String, (String, String)>,
    /// sum view -> (child, reference, summed column), not count-like.
    pub sums: BTreeMap<String, (String, String, String)>,
    facts: Facts,
    all: Vec<ProgramDecl>,
    functions: Vec<FunctionDecl>,
}

impl Guards {
    pub fn new(catalog: &Catalog) -> Self {
        // A count of the child by the reference (`view rsvpCount: count rsvps by
        // .night`, no filter): `require rsvpCount[night] = 0` before the delete
        // is the documented guard that no child exists, as a direct read is.
        // @ref LLP 3000.036#16.2 — wave 6 R2: the count-view guard handles the children.
        let mut counts: BTreeMap<String, (String, String)> = catalog.maintains.iter().filter_map(|(name, m)| {
            let [by] = m.by.as_slice() else { return None };
            (m.aggregate == "count" && m.filter.is_none() && m.row_key.is_none()).then(|| (name.clone(), (m.source.clone(), by.trim_start_matches('.').to_owned())))
        }).collect();
        let facts = Facts {
            immutable: catalog.tables.iter().map(|(name, info)| (name.clone(), info.decl.immutable.iter().flat_map(|(columns, _)| columns.iter().map(|c| c.trim_start_matches('.').to_owned())).collect())).collect(),
            inserts: catalog.tables.iter().map(|(name, info)| (name.clone(), info.decl.rules.iter().filter(|rule| rule.effect == crate::ast::Effect::Insert).map(|rule| rule.value.clone()).collect())).collect(),
        };
        let all: Vec<ProgramDecl> = catalog.documents.iter().flat_map(|doc| doc.programs.clone()).collect();
        let functions: Vec<FunctionDecl> = catalog.documents.iter().flat_map(|doc| doc.functions.clone()).collect();
        // A `sum` by the reference proves "no children" only when every row adds at
        // least one: the summed column is count-like (17.4). Otherwise it is named,
        // so the note can say why it does not silence it.
        // @ref LLP 3000.036#17.4 — wave 7 lanes 024 034: a zero sum is a zero count only for a column every row holds ≥ 1 in.
        let mut sums: BTreeMap<String, (String, String, String)> = BTreeMap::new();
        for (name, m) in &catalog.maintains {
            let ([by], Some(column)) = (m.by.as_slice(), m.column.as_ref()) else { continue };
            if m.aggregate != "sum" || m.filter.is_some() || m.row_key.is_some() { continue; }
            let by = by.trim_start_matches('.').to_owned();
            let column = column.trim_start_matches('.').to_owned();
            if count_like(&facts, &all, &functions, &m.source, &column) { counts.insert(name.clone(), (m.source.clone(), by)); }
            else { sums.insert(name.clone(), (m.source.clone(), by, column)); }
        }
        Self { counts, sums, facts, all, functions }
    }

    /// The program requires a status of the deleted `parent` row that every
    /// program keeps false while a `child` row names it through `reference`.
    // @ref LLP 3000.036#17.4 — wave 7 lane 021: a status the deleted row must hold, which every child insert flips away from.
    pub fn status_guarded(&self, program: &ProgramDecl, site: &crate::diag::Site, parent: &str, child: &str, reference: &str) -> bool {
        let Some(decl) = self.all.iter().find(|decl| decl.name == program.name && decl.site == program.site) else { return false };
        status_guarded(&self.facts, &self.all, &self.functions, decl, site, parent, child, reference)
    }

    /// Why a `sum` guard the program reads does not prove there are none.
    pub fn sum_reason(&self, view: &str, child: &str, column: &str, summed: &str) -> String {
        format!("; the `{view}` guard does not prove there are none: it sums {child}.{summed}, and a row whose .{summed} is 0 (or rows that cancel) sums to 0 too — count the rows instead (`view {child}By{}: count {child} by .{column}`), or make the column count-like (every insert rule branch requires `.{summed} >= 1`, `immutable {summed}`, and no job writes {child})", capital(column))
    }
}

fn capital(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map(|first| first.to_ascii_uppercase().to_string() + chars.as_str()).unwrap_or_default()
}

/// What the proofs below read from the catalog, taken before the programs are walked mutably.
struct Facts {
    immutable: BTreeMap<String, BTreeSet<String>>,
    inserts: BTreeMap<String, Vec<Expr>>,
}

/// Every write in a body, with the statement list it sits in and its index there
/// (the path of `(list, index)` from the body down), for "before" questions.
fn writes<'a>(body: &'a [Stmt], path: &mut Vec<(&'a [Stmt], usize)>, out: &mut Vec<(&'a Expr, Vec<(&'a [Stmt], usize)>)>) {
    fn expression<'a>(value: &'a Expr, path: &[(&'a [Stmt], usize)], out: &mut Vec<(&'a Expr, Vec<(&'a [Stmt], usize)>)>) {
        if matches!(value, Expr::Write { .. }) { out.push((value, path.to_vec())); }
        match value {
            Expr::Unary { value, .. } | Expr::Member { base: value, .. } | Expr::Assert { value, .. } | Expr::ShapeUse { base: value, .. } => expression(value, path, out),
            Expr::Binary { left, right, .. } => { expression(left, path, out); expression(right, path, out); }
            Expr::Array { items, .. } | Expr::Call { args: items, .. } => for item in items { expression(item, path, out) },
            Expr::Object { fields, .. } => for value in fields.iter().filter_map(|f| f.value.as_ref()) { expression(value, path, out) },
            Expr::If { then, condition, otherwise, .. } => { expression(then, path, out); expression(condition, path, out); expression(otherwise, path, out); }
            Expr::Write { keys, fields, condition, .. } => {
                for key in keys { expression(&key.value, path, out); }
                for value in fields.iter().filter_map(|f| f.value.as_ref()) { expression(value, path, out); }
                if let Some(value) = condition { expression(value, path, out); }
            }
            _ => {}
        }
    }
    for (index, statement) in body.iter().enumerate() {
        path.push((body, index));
        match statement {
            Stmt::Bind { value, .. } | Stmt::Expr { value, .. } | Stmt::Return { value, .. } => expression(value, path, out),
            Stmt::Require { condition, .. } => expression(condition, path, out),
            Stmt::Emit { payload, .. } => expression(payload, path, out),
            Stmt::If { condition, then_body, else_body, .. } => { expression(condition, path, out); writes(then_body, path, out); writes(else_body, path, out); }
            Stmt::As { principal: domain, body, .. } | Stmt::For { domain, body, .. } => { expression(domain, path, out); writes(body, path, out); }
            Stmt::Break { .. } | Stmt::Continue { .. } => {}
        }
        path.pop();
    }
}

fn program_writes(decl: &ProgramDecl) -> Vec<(&Expr, Vec<(&[Stmt], usize)>)> {
    let mut out = Vec::new();
    writes(&decl.prelude, &mut Vec::new(), &mut out);
    writes(&decl.body, &mut Vec::new(), &mut out);
    out
}

fn function_writes(functions: &[FunctionDecl]) -> Vec<&Expr> {
    let mut out = Vec::new();
    for function in functions {
        match &function.body {
            FunctionBody::Block(body) => writes(body, &mut Vec::new(), &mut out),
            FunctionBody::Expression(value) => { let body = [Stmt::Expr { value: value.clone(), site: function.site.clone() }]; let mut found = Vec::new(); writes(&body, &mut Vec::new(), &mut found); if !found.is_empty() { return vec![value]; } }
        }
    }
    out.into_iter().map(|(write, _)| write).collect()
}

/// Something a proof over every program cannot see through: a native job
/// (its body is the app's Rust), or `as` (another principal's authority).
fn opaque(all: &[ProgramDecl]) -> bool {
    fn has_as(body: &[Stmt]) -> bool {
        body.iter().any(|s| match s {
            Stmt::As { .. } => true,
            Stmt::If { then_body, else_body, .. } => has_as(then_body) || has_as(else_body),
            Stmt::For { body, .. } => has_as(body),
            _ => false,
        })
    }
    all.iter().any(|decl| decl.native || has_as(&decl.prelude) || has_as(&decl.body))
}

/// The value a write gives a field (`{ artwork }` is `{ artwork: artwork }`).
fn field<'a>(fields: &'a [ObjectField], name: &str) -> Option<Option<&'a Expr>> {
    fields.iter().find(|f| !f.spread && f.name == name).map(|f| f.value.as_ref())
}

fn field_text(fields: &[ObjectField], name: &str) -> Option<String> {
    field(fields, name).map(|value| value.map_or_else(|| name.to_owned(), crate::print::expression))
}

/// `t.column` holds at least 1 in every row: every insert rule branch requires
/// `.column >= k` (k ≥ 1) or `.column > k` (k ≥ 0), the column is immutable, and
/// no job (the system, which no rule binds) writes the table.
fn count_like(facts: &Facts, all: &[ProgramDecl], functions: &[FunctionDecl], table: &str, column: &str) -> bool {
    fn positive(rule: &Expr, column: &str) -> bool {
        match rule {
            Expr::Binary { op, left, right, .. } if op == "or" => positive(left, column) && positive(right, column),
            Expr::Binary { op, left, right, .. } if op == "and" => positive(left, column) || positive(right, column),
            Expr::Binary { op, left, right, .. } => {
                let focal = |e: &Expr| matches!(e, Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) && name == column);
                let int = |e: &Expr| match e { Expr::Literal { value: Literal::Number(n), .. } => n.parse::<i64>().ok(), _ => None };
                match (op.as_str(), focal(left), focal(right)) {
                    (">=", true, _) => int(right).is_some_and(|k| k >= 1),
                    (">", true, _) => int(right).is_some_and(|k| k >= 0),
                    ("<=", _, true) => int(left).is_some_and(|k| k >= 1),
                    ("<", _, true) => int(left).is_some_and(|k| k >= 0),
                    _ => false,
                }
            }
            _ => false,
        }
    }
    let rules = facts.inserts.get(table).map(Vec::as_slice).unwrap_or_default();
    if rules.is_empty() || !rules.iter().all(|rule| positive(rule, column)) { return false; }
    if !facts.immutable.get(table).is_some_and(|columns| columns.contains(column)) || opaque(all) { return false; }
    let system = all.iter().filter(|decl| decl.kind == ProgramKind::Job).flat_map(program_writes).map(|(write, _)| write);
    !system.chain(function_writes(functions)).any(|write| matches!(write, Expr::Write { op, table: written, .. } if written == table && *op != WriteOp::Delete))
}

/// The deleting program requires a status of the deleted row (`require
/// a.status = 'available'`, `a = artworks[artwork] !`, before `delete
/// artworks[artwork]`), and every program keeps "a child exists ⇒ the parent
/// is not in that status": each child insert follows an unconditional flip of
/// its own parent (`update artworks[artwork] { status: 'sold' }`) to a status
/// the guard refuses, no write ever sets an admitted status on an existing
/// row, and no child is moved to another parent. Rows written outside the
/// programs (a fixture, `POST /seed`) are the author's to keep consistent.
// @ref LLP 3000.036#17.4 — sound over every program write; anything the walk cannot see (a native job, `as`, a helper's write) refuses the proof.
fn stable_key(value: &Expr) -> bool {
    matches!(value, Expr::Name { name, .. } if name != "new") || matches!(value, Expr::Literal { .. })
}

fn stable_bindings(decl: &ProgramDecl) -> bool {
    let mut bound: BTreeSet<&str> = decl.args.iter().map(|arg| arg.name.as_str()).collect();
    for statement in decl.prelude.iter().chain(&decl.body) {
        match statement {
            Stmt::Bind { names, .. } if names.iter().any(|name| !bound.insert(name.as_str())) => return false,
            Stmt::If { .. } | Stmt::For { .. } | Stmt::As { .. } => return false,
            _ => {}
        }
    }
    true
}

fn status_guarded(facts: &Facts, all: &[ProgramDecl], functions: &[FunctionDecl], decl: &ProgramDecl, site: &crate::diag::Site, parent: &str, child: &str, reference: &str) -> bool {
    if !stable_bindings(decl) { return false; }
    let strip = |e: &Expr| match e { Expr::Assert { value, .. } => (**value).clone(), other => other.clone() };
    let key_of = |e: &Expr| match strip(e) {
        Expr::Read(read) if read.table == parent && read.keys.len() == 1 && read.filter.is_none() && read.range.is_none() && stable_key(&read.keys[0].value) => Some(crate::print::expression(&read.keys[0].value)),
        _ => None,
    };
    // The delete, at the top level of the body.
    let Some((at, key)) = decl.body.iter().enumerate().find_map(|(i, s)| match s {
        Stmt::Expr { value: Expr::Write { op: WriteOp::Delete, table, keys, condition: None, site: delete_site, .. }, .. } if delete_site == site && table == parent && keys.len() == 1 && stable_key(&keys[0].value) => Some((i, crate::print::expression(&keys[0].value))),
        _ => None,
    }) else { return false };
    // Names bound to that row before it.
    let rows: BTreeSet<&str> = decl.body[..at].iter().filter_map(|s| match s {
        Stmt::Bind { names, value, .. } if names.len() == 1 && key_of(value).as_deref() == Some(key.as_str()) => Some(names[0].as_str()),
        _ => None,
    }).collect();
    // `row.col = 'a' [or row.col = 'b' …]`: (column, admitted literals, true); `!=` joined by `and`: (column, refused, false).
    fn test(e: &Expr, rows: &BTreeSet<&str>, key: &str, key_of: &dyn Fn(&Expr) -> Option<String>) -> Option<(String, BTreeSet<String>, bool)> {
        match e {
            Expr::Binary { op, left, right, .. } if op == "or" || op == "and" => {
                let (l, r) = (test(left, rows, key, key_of)?, test(right, rows, key, key_of)?);
                let joined = (op == "or") == l.2;
                (l.0 == r.0 && l.2 == r.2 && joined).then(|| (l.0, l.1.union(&r.1).cloned().collect(), l.2))
            }
            Expr::Binary { op, left, right, .. } if op == "=" || op == "!=" => {
                let side = |m: &Expr, lit: &Expr| match (m, lit) {
                    (Expr::Member { base, name, .. }, Expr::Literal { value: Literal::Str(text), .. })
                        if matches!(base.as_ref(), Expr::Name { name: row, .. } if rows.contains(row.as_str())) || key_of(base).as_deref() == Some(key) => Some((name.clone(), text.clone())),
                    _ => None,
                };
                let (column, text) = side(left, right).or_else(|| side(right, left))?;
                Some((column, BTreeSet::from([text]), op == "="))
            }
            _ => None,
        }
    }
    let guards: Vec<(String, BTreeSet<String>, bool)> = decl.body[..at].iter().filter_map(|s| match s {
        Stmt::Require { condition, .. } => test(condition, &rows, &key, &key_of),
        _ => None,
    }).collect();
    if guards.is_empty() || opaque(all) { return false; }
    let child_immutable = facts.immutable.get(child).is_some_and(|columns| columns.contains(reference));
    let helpers = function_writes(functions);
    guards.iter().any(|(column, literals, admitted_listed)| {
        let admitted = |value: &str| literals.contains(value) == *admitted_listed;
        // A flip: an unconditional update of the parent, by key, to a literal status the guard refuses.
        let flip = |write: &Expr| match write {
            Expr::Write { op: WriteOp::Update, table, keys, fields, condition: None, if_absent: false, .. } if table == parent && keys.len() == 1 && stable_key(&keys[0].value) =>
                match field(fields, column) { Some(Some(Expr::Literal { value: Literal::Str(text), .. })) if !admitted(text) => Some(crate::print::expression(&keys[0].value)), _ => None },
            _ => None,
        };
        let sets_admitted = |write: &Expr| match write {
            Expr::Write { op: WriteOp::Update | WriteOp::Upsert, table, fields, .. } if table == parent =>
                fields.iter().any(|f| f.spread) || match field(fields, column) { None => false, Some(Some(Expr::Literal { value: Literal::Str(text), .. })) => admitted(text), Some(_) => true },
            _ => false,
        };
        let moves_child = |write: &Expr| matches!(write, Expr::Write { op: WriteOp::Update | WriteOp::Upsert, table, fields, .. } if table == child && !child_immutable && (fields.iter().any(|f| f.spread) || field(fields, reference).is_some()));
        if helpers.iter().any(|w| sets_admitted(w) || moves_child(w) || matches!(w, Expr::Write { op: WriteOp::Insert | WriteOp::Upsert, table, .. } if table == child)) { return false; }
        all.iter().all(|program| {
            let found = program_writes(program);
            if found.iter().any(|(write, _)| matches!(write, Expr::Write { op: WriteOp::Insert | WriteOp::Upsert, table, .. } if table == child)) && !stable_bindings(program) { return false; }
            let rebound = |name: &str| program.body.iter().chain(&program.prelude).filter(|s| matches!(s, Stmt::Bind { names, .. } if names.iter().any(|n| n == name))).count() > 1;
            found.iter().all(|(write, path)| {
                if sets_admitted(write) || moves_child(write) { return false; }
                let Expr::Write { op: WriteOp::Insert | WriteOp::Upsert, table, fields, .. } = write else { return true };
                if table != child { return true; }
                if !matches!(field(fields, reference), Some(None)) && !matches!(field(fields, reference), Some(Some(value)) if stable_key(value)) { return false; }
                let Some(value) = field_text(fields, reference) else { return false };
                if value.split(|c: char| !c.is_alphanumeric() && c != '_').next().is_some_and(rebound) { return false; }
                // An earlier statement of the same list, or of an enclosing list before the branch holding the insert.
                path.iter().any(|(list, index)| list[..*index].iter().any(|s| match s {
                    Stmt::Expr { value: write, .. } | Stmt::Bind { value: write, .. } => flip(write).as_deref() == Some(value.as_str()),
                    _ => false,
                }))
            })
        })
    })
}
